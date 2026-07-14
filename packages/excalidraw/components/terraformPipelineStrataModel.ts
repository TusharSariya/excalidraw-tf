/**
 * Strata engine — P1 model build (docs/strata-view-implementation-flow.md §3;
 * spec docs/rcll-v2-spec-v2.md §6 + v3.1 §1.4/§2.2).
 *
 * Turns a read-only `PipelineLayoutPrep` into the `StrataModel` every engine
 * phase (A3 → A1 → A0+A2 → A7 → A6) codes against:
 *  - the hull tree (provider→account→region→vpc→subnetZone), a **hardcoded
 *    in-engine copy** of `buildHullTree`/`buildCompoundTree` semantics
 *    (copy-then-parametrize, D6′; the shared builders are never imported or
 *    mutated — Strata owns its copy; pattern reference only:
 *    `terraformPipelineRcllModel.ts:75`). Per-role policy from
 *    `STRATA_HULL_POLICY` (root pinned "banded", v3.1 §1.4).
 *  - the deduped collapsed edge set E (self-loops split out, parallel edges
 *    folded into `multiplicity`), sequence-free (C4′) and content-keyed.
 *  - `addressOf`, the canonical address used by the pinned content comparator.
 *
 * Hull ids are content-addressed from the topology path (deterministic across
 * runs); ALL child ordering at build uses the pinned comparator on addresses —
 * never `firstSequence`/file position (C4′). Hull `placement` metadata is read
 * from the schema path, never first-writer-wins on input order.
 */
import {
  compareStrataContentKeys,
  resolveStrataHullPolicy,
} from "./terraformPipelineStrataTypes";
import {
  topologyPathForCluster,
  topologyRoleAndKeyFromPath,
} from "./terraformPipelineTopologyFrames";

import type {
  PipelineCluster,
  PipelineLayoutPrep,
} from "./terraformPipelineLayoutShared";
import type {
  StrataEdge,
  StrataEngineOptions,
  StrataHullNode,
  StrataHullRole,
  StrataModel,
} from "./terraformPipelineStrataTypes";

/** Sentinel id for the synthetic root hull (never collides with a topology key). */
export const STRATA_ROOT_ID = "__strata_root__";

// ── hull tree ─────────────────────────────────────────────────────────────────

/**
 * Build the provider→account→region→vpc→subnetZone hull tree from each cluster's
 * topology path. Container hulls are keyed by the canonical topology role/key
 * (`topologyRoleAndKeyFromPath`) — the id IS that content-addressed key; leaves
 * whose deepest hull is `h` land in `h.leafClusterIds` (keyed by cluster id so
 * two same-subnet siblings never collide). Children/leaves are ordered by the
 * pinned content comparator on canonical addresses (C4′). Each hull's `policy`
 * is resolved from the monotone band-depth cut `bandDepth` (default `"account"`
 * reproduces `STRATA_HULL_POLICY` element-for-element).
 */
function buildStrataHullTree(
  clusters: readonly PipelineCluster[],
  addressOf: (clusterId: string) => string,
  bandDepth: StrataHullRole,
): StrataHullNode {
  const root: StrataHullNode = {
    id: STRATA_ROOT_ID,
    role: "root",
    policy: resolveStrataHullPolicy("root", bandDepth),
    path: [],
    children: [],
    leafClusterIds: [],
  };
  const byId = new Map<string, StrataHullNode>([[STRATA_ROOT_ID, root]]);

  for (const cluster of clusters) {
    const path = topologyPathForCluster(cluster);
    let parent = root;
    for (let len = 1; len <= path.length; len++) {
      const rk = topologyRoleAndKeyFromPath(path.slice(0, len));
      if (!rk) {
        continue;
      }
      let node = byId.get(rk.key);
      if (!node) {
        node = {
          id: rk.key,
          role: rk.role,
          policy: resolveStrataHullPolicy(rk.role, bandDepth),
          path: path.slice(0, len),
          children: [],
          leafClusterIds: [],
        };
        byId.set(rk.key, node);
        parent.children.push(node);
      }
      parent = node;
    }
    parent.leafClusterIds.push(cluster.id);
  }

  finalizeStrataOrder(root, addressOf, new Map());
  return root;
}

/**
 * Post-order: sort each hull's leaves and children by the pinned content
 * comparator (min canonical address over the subtree's leaves; hull-id tiebreak)
 * and return the hull's minimum address. Deterministic — no `firstSequence`.
 */
function finalizeStrataOrder(
  hull: StrataHullNode,
  addressOf: (clusterId: string) => string,
  minCache: Map<string, string>,
): string {
  hull.leafClusterIds.sort(
    (a, b) =>
      compareStrataContentKeys(addressOf(a), addressOf(b)) ||
      compareStrataContentKeys(a, b),
  );
  let min: string | undefined;
  for (const leaf of hull.leafClusterIds) {
    const addr = addressOf(leaf);
    if (min === undefined || compareStrataContentKeys(addr, min) < 0) {
      min = addr;
    }
  }
  for (const child of hull.children) {
    const childMin = finalizeStrataOrder(child, addressOf, minCache);
    if (min === undefined || compareStrataContentKeys(childMin, min) < 0) {
      min = childMin;
    }
  }
  hull.children.sort(
    (a, b) =>
      compareStrataContentKeys(
        minCache.get(a.id) ?? "",
        minCache.get(b.id) ?? "",
      ) || compareStrataContentKeys(a.id, b.id),
  );
  const result = min ?? "";
  minCache.set(hull.id, result);
  return result;
}

/**
 * Band-row invariant (v3.1 §2.2, S0b assert), cut-aware. Two guards:
 *
 *  1. Structural band-row (kept from before, keyed on the RESOLVED
 *     `policy === "banded"`): every child of a banded hull occupies exactly one
 *     band-row — its child hulls plus its direct leaves, all distinct (no leaf
 *     folded into another row, no leaf id shadowing a child-hull id).
 *  2. Cut-driven monotonicity (replaces the old static-map equality throw): the
 *     root always resolves banded under `bandDepth` (root pinned banded, v3.1
 *     §1.4), and NO banded hull may nest under a packed ancestor. packed-below-
 *     banded is the ALLOWED direction (the cut walks banded → packed with
 *     depth); banded-below-packed is impossible for a monotone cut and throws.
 *
 * Throws (dev-visible) on violation so a future modeling regression voids loudly.
 */
export function assertStrataBandRowInvariant(
  hull: StrataHullNode,
  bandDepth: StrataHullRole,
  ancestorPacked = false,
): void {
  // Root pinned banded (v3.1 §1.4): no legal cut resolves the root as packed.
  if (hull.role === "root") {
    const resolvedRoot = resolveStrataHullPolicy("root", bandDepth);
    if (resolvedRoot !== "banded" || hull.policy !== "banded") {
      throw new Error(
        `Strata band-depth invariant: root hull ${hull.id} must be banded (resolved "${resolvedRoot}", stamped "${hull.policy}", cut "${bandDepth}") — root is pinned banded (v3.1 §1.4)`,
      );
    }
  }
  // Monotonicity: a banded hull can never sit under a packed ancestor.
  if (ancestorPacked && hull.policy === "banded") {
    throw new Error(
      `Strata band-depth invariant: banded hull ${hull.id} (role "${hull.role}") nests under a packed ancestor — monotonicity violated`,
    );
  }
  if (hull.policy === "banded") {
    const leafSet = new Set(hull.leafClusterIds);
    if (leafSet.size !== hull.leafClusterIds.length) {
      throw new Error(
        `Strata band-row invariant: duplicate direct leaf under banded hull ${hull.id}`,
      );
    }
    const childIds = new Set(hull.children.map((c) => c.id));
    for (const leaf of hull.leafClusterIds) {
      if (childIds.has(leaf)) {
        throw new Error(
          `Strata band-row invariant: direct leaf ${leaf} collides with a child hull id under banded hull ${hull.id}`,
        );
      }
    }
  }
  const childAncestorPacked = ancestorPacked || hull.policy === "packed";
  for (const child of hull.children) {
    assertStrataBandRowInvariant(child, bandDepth, childAncestorPacked);
  }
}

// ── edges ───────────────────────────────────────────────────────────────────

/** Canonical, direction-preserving, length-prefixed edge key (spec §A6 shape). */
function strataEdgeKey(
  source: string,
  target: string,
  relKind: string,
): string {
  return `${source.length}:${source}→${target.length}:${target}:${relKind}`;
}

/**
 * From `prep.collapsedEdges`: strip `sequence` (C4′), fold parallel edges (same
 * true-direction source/target/relKind) into `multiplicity`, and split
 * self-loops (source === target) into their own bucket — excluded from
 * ranking/ordering, kept for A6 render. `relKind` is the original declared
 * edge's `origin` (all "tfd" today; DeclaredDataFlowEdge carries no other kind).
 */
function buildStrataEdges(
  collapsedEdges: PipelineLayoutPrep["collapsedEdges"],
): { edges: StrataEdge[]; selfLoops: StrataEdge[] } {
  const main = new Map<string, StrataEdge>();
  const self = new Map<string, StrataEdge>();
  for (const e of collapsedEdges) {
    const relKind = e.original?.origin ?? "tfd";
    const key = strataEdgeKey(e.source, e.target, relKind);
    const bucket = e.source === e.target ? self : main;
    const existing = bucket.get(key);
    if (existing) {
      existing.multiplicity += 1;
    } else {
      bucket.set(key, {
        key,
        source: e.source,
        target: e.target,
        relKind,
        multiplicity: 1,
      });
    }
  }
  const byKey = (a: StrataEdge, b: StrataEdge): number =>
    compareStrataContentKeys(a.key, b.key);
  return {
    edges: [...main.values()].sort(byKey),
    selfLoops: [...self.values()].sort(byKey),
  };
}

// ── entry ─────────────────────────────────────────────────────────────────────

/**
 * Build the Strata model from prep. `options` is validated here (this is the
 * first engine phase) but otherwise not consumed at model build — `compact` is
 * already reflected in the prep skeleton sizes and `includeAncillary` is deferred
 * to the M3 port (honest-meta echo, SDEC-26). Deterministic: same prep ⇒ deeply
 * equal hull tree + edge set (only object identity of `addressOf` differs).
 */
export function buildStrataModel(
  prep: PipelineLayoutPrep,
  options: StrataEngineOptions,
): StrataModel {
  if (!Number.isInteger(options.sweeps) || options.sweeps < 0) {
    throw new Error(
      `Strata model: invalid sweeps option ${String(
        options.sweeps,
      )} (expected a non-negative integer)`,
    );
  }
  const clusters = new Map<string, PipelineCluster>(
    prep.clusters.map((c) => [c.id, c]),
  );
  const addressByCluster = new Map<string, string>(
    prep.clusters.map((c) => [c.id, c.primaryAddress]),
  );
  const addressOf = (clusterId: string): string =>
    addressByCluster.get(clusterId) ?? clusterId;

  // Monotone band-depth cut → hull policy (default "account" = the frozen map).
  const bandDepth: StrataHullRole = options.strataBandDepth ?? "account";
  const hullRoot = buildStrataHullTree(prep.clusters, addressOf, bandDepth);
  assertStrataBandRowInvariant(hullRoot, bandDepth);
  const { edges, selfLoops } = buildStrataEdges(prep.collapsedEdges);

  return { clusters, hullRoot, edges, selfLoops, addressOf };
}
