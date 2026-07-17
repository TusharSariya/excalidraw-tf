/**
 * Strata engine — ancillary ("All resources") band injection, host-interior
 * baseline (plan §3a-§3n; the greedy right-slack allocator §3o is deliberately
 * NOT built here — see "Deferred" below).
 *
 * WHAT THIS IS
 *
 * Strata derives rank only from TFD edges, so ancillary (edgeless) resources
 * can never enter the model: every strip would rank 0, a wide strip would widen
 * the GLOBAL `columnWidths` for every hull, and `StrataUnit` is a closed 2-kind
 * union (SDEC-29's three blockers). All three block an IN-MODEL port only.
 * RCLL's shipped ancillary is strictly POST-LAYOUT, and so is this: the whole
 * engine runs on a model with no ancillary in it, and bands are injected into
 * the finished placement afterward. Strips never reach the ranker, `columnX` is
 * already frozen, and strips never become units.
 *
 * 🔴 THE MEASURED DEAD END — READ BEFORE CHANGING ANYTHING HERE
 *
 * `docs/pipeline-rcll-layout-design.md` §"Dead ends (do not re-attempt)" records
 * that RCLL already implemented and measured this exact approach ("Export-phase
 * placement") on this exact preset: **90 collisions (Compact) / 86 (Full)**.
 * Root cause, in their words: *"a strip grows a region hull into the next region
 * and nothing re-stacks regions"* — the "unreserved-space failure", and every
 * collision was among CONNECTED frames.
 *
 * The ONLY difference between that dead end and RCLL's shipped solution is
 * `propagateBandGrowth` below (plan §3e): the downward propagation of a host's
 * growth to x-overlapping lower siblings, and the re-bounding of ancestors.
 * **That function is the entire difference between 90 collisions and zero. It is
 * not a detail and must never be trimmed for simplicity** — doing so reproduces
 * a measured failure. The same is true of §3f (wrap to the host's INTERIOR, never
 * to `ANCILLARY_DEFAULT_WRAP_WIDTH`) and §3g (`checkStrataAncillaryContainment`,
 * because `checkStrataStructure` walks the model and bands are not in it).
 *
 * ACCEPTED TRADEOFF (same one RCLL accepted, in its own words): this does not
 * rerun layering, crossing minimization, column compaction, straightening, or
 * placement after bands are inserted. Preserved invariant: **primary dataflow X
 * positions and frame dimensions are unchanged; Y may only grow downward.** No
 * `x` and no `width` is ever written on the normal path — that makes the
 * no-movement contract hold BY CONSTRUCTION rather than by test. (The single
 * documented exception is a card wider than its host's interior; it widens its
 * host and is counted as `hostWidenedCount` — §3f.)
 *
 * DEFERRED — the greedy right-slack allocator (plan §3o) is a separate, gated
 * commit. This module is its baseline and its fallback, never throwaway work:
 * RCLL's own `buildValidatedAncillaryInsertion` degrades to exactly this
 * ("injects at baseline wrap, which always applies"). The residual cost of the
 * baseline is HEIGHT — a narrow host wraps to few cards per row and the band
 * gets tall. Nothing here reclaims it; bands are invisible to every optimizer.
 *
 * Import-cycle rule (SDEC NaN): NO module-level constants derived from
 * `terraformPipelineLayoutShared` — this module sits inside the pre-existing
 * terraformPlanParsing→terraformLayoutCore cycle, where a module-level binding
 * can still be `undefined` at evaluation time and silently poison geometry with
 * NaN. Every gap/pad constant is read at CALL TIME.
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataAncillary.test.ts
 */
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import {
  ANCILLARY_STRIP_STROKE,
  PIPELINE_CLUSTER_GAP_Y,
  PIPELINE_FRAME_PAD,
  PIPELINE_LANE_GAP_Y,
  ancillaryStripFrameId,
  ancillaryStripRows,
  layoutAncillaryStrip,
  pipelineFrameCustomData,
  translateSkeleton,
} from "./terraformPipelineLayoutShared";
import { compareStrataContentKeys } from "./terraformPipelineStrataTypes";
import {
  dropY,
  strataTitleReserve,
  type SkylineRect,
} from "./terraformPipelineStrataPlacement";
import { STRATA_ROOT_ID } from "./terraformPipelineStrataModel";
import { strataHullLabel } from "./terraformPipelineStrataSceneBuild";
import {
  topologyRoleAndKeyFromPath,
  type TopologyFrameRole,
} from "./terraformPipelineTopologyFrames";
import { PIPELINE_FRAME_TITLE_HEIGHT } from "./terraformPipelineTopologyGeometry";

import type {
  AncillaryStrip,
  PipelinePlacement,
} from "./terraformPipelineLayoutShared";
import type {
  StrataBox,
  StrataBoxedHull,
  StrataHullNode,
  StrataModel,
  StrataPlacedUnit,
  StrataPlacementResult,
  StrataUnit,
} from "./terraformPipelineStrataTypes";

/**
 * One injected band: the "Unconnected" container hosted at the bottom of one
 * hull's interior. A side map — `StrataUnit` is NOT touched and a band is NEVER
 * written into `StrataBoxedHull.placed` (that union stays closed; §3i).
 */
export type StrataAncillaryBand = {
  /** Host hull id — a key of `placement.boxedHulls`. */
  hullId: string;
  /** ABSOLUTE box of the band's outer "Unconnected" frame. */
  box: StrataBox;
  /**
   * REAL skeleton, already translated to absolute coordinates.
   *
   * 🔴 NEVER build this via `ancillaryStripAsPseudoCluster`
   * (terraformPipelineLayoutShared.ts) — its `skeleton: []` would reserve a box,
   * inflate geometry, stamp nothing and DRAW NOTHING: silent, green, invisible
   * (plan §3h, THE LANDMINE). A band always carries a real strip skeleton.
   */
  skeleton: ExcalidrawElementSkeleton[];
  /** Frame id of the band's outer "Unconnected" frame. */
  frameId: string;
  stripCount: number;
  cardCount: number;
  /** 0 = flat (one strip, host is its own scope); ≥1 = nested scope groups. */
  nestDepth: number;
};

export type StrataAncillaryInjection = {
  /** A NEW placement — the input is never mutated (see `cloneStrataPlacement`). */
  placement: StrataPlacementResult;
  /** hullId → band, in deterministic (host-path, content-key) order. */
  bands: Map<string, StrataAncillaryBand>;
  /** Strips whose host hull is NOT their own scope hull (relocated by de-band). */
  relocatedStripCount: number;
  /** §3f edge: bands whose single widest card exceeded the host's interior. */
  hostWidenedCount: number;
  maxNestDepth: number;
};

// ── frame ids ─────────────────────────────────────────────────────────────────

/**
 * Nested scope-group frame id. The `ancillaryGroup` role segment keeps this
 * disjoint from a real hull frame's `tf-pipeline:${role}:${key}` id by
 * construction — never reuse `emitTopologyContextFrames`, whose ids COLLIDE with
 * the real hull's (§3k).
 */
export function ancillaryGroupFrameId(groupKey: string): string {
  return `tf-pipeline:ancillaryGroup:${encodeURIComponent(groupKey)}`;
}

// ── scope paths ───────────────────────────────────────────────────────────────

/**
 * A strip's topology path. Every scope-key builder is literally
 * `path.join("\0")` (`providerScopeKey`/`accountScopeKey`/`regionScopeKey`/
 * `vpcScopeKey`, terraformPipelineLayoutShared.ts), which is the SAME encoding
 * `topologyRoleAndKeyFromPath` produces — so a split is exact, and the strip's
 * scope key IS its hull id whenever that hull exists.
 */
const stripScopePath = (strip: AncillaryStrip): string[] =>
  strip.scopeKey.split("\0");

/**
 * Scope-level placement for a path prefix — mirrors `ancillaryScopeForPlacement`
 * (terraformPipelineLayoutAncillary.ts) so a group/band frame never stamps a
 * deeper scope's identity on a shallower frame (risk 10). Subnet detail is
 * dropped: strips deliberately carry none *"so no subnetZone frame forms"*.
 */
const placementForPath = (
  path: readonly string[],
  base: PipelinePlacement,
): PipelinePlacement => ({
  providerFamily: path[0] ?? base.providerFamily,
  accountId: path[1] ?? "unknown-account",
  region: path[2] ?? "unknown-region",
  vpcId: path[3] ?? null,
});

// ── geometry helpers ──────────────────────────────────────────────────────────

const boxesOverlap = (a: StrataBox, b: StrataBox): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

// ── the parent index (§3e.1) ──────────────────────────────────────────────────

/**
 * `StrataHullNode` is `{id, role, policy, path, children, leafClusterIds}` —
 * children only, NO parent link. RCLL's allocator walks a tree that has
 * parent/child links; strata's does not, so "recurse to ancestors" is not
 * directly expressible. Walk `model.hullRoot` ONCE up front to build the index.
 * Deterministic single pass; must run before any growth.
 */
const buildParentIndex = (
  root: StrataHullNode,
): {
  parentOf: Map<string, string>;
  nodeOf: Map<string, StrataHullNode>;
  depthOf: Map<string, number>;
} => {
  const parentOf = new Map<string, string>();
  const nodeOf = new Map<string, StrataHullNode>();
  const depthOf = new Map<string, number>();
  const walk = (node: StrataHullNode, depth: number): void => {
    nodeOf.set(node.id, node);
    depthOf.set(node.id, depth);
    for (const child of node.children) {
      parentOf.set(child.id, node.id);
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return { parentOf, nodeOf, depthOf };
};

// ── the clone (§3e.2) ─────────────────────────────────────────────────────────

type MutablePlacedUnit = {
  unit: StrataUnit;
  box: StrataBox;
  colSpan: StrataPlacedUnit["colSpan"];
};
type MutableBoxedHull = {
  hull: StrataHullNode;
  box: StrataBox;
  placed: MutablePlacedUnit[];
};
type MutablePlacement = {
  boxedHulls: Map<string, MutableBoxedHull>;
  leafBoxes: Map<string, StrataBox>;
};

/**
 * 🔴 `prep` is CACHED across builds (`clearTerraformImportPrepCache()` exists and
 * every probe calls it first), and `boxedHulls`/`leafBoxes` are `ReadonlyMap`s
 * over shared structures. Mutating them in place corrupts SUBSEQUENT builds — the
 * same shared-prep hazard `translateSkeleton`'s shallow clone already carries. So
 * return a NEW placement with fresh maps AND fresh box objects.
 *
 * `hull` nodes are intentionally NOT cloned: they belong to the model, are only
 * ever read here, and cloning them would fork the identity `boxedHulls` is keyed
 * by. Boxes are cloned WITHOUT aliasing (`placeStrataHulls` happens to share one
 * object between a leaf's `placed` box and its `leafBoxes` entry; reproducing that
 * aliasing would make a later pass's legitimately-divergent placement silently
 * "snap" to the leafBoxes value). Both copies are updated explicitly, in lockstep,
 * by `shiftPlacedSubtree` — §3e.4: `placed` carries per-unit boxes, so shifting
 * hulls/leaves without it leaves `placed` desynced from `boxedHulls`/`leafBoxes`:
 * silent, green, and wrong. Rewriting a `StrataPlacedUnit`'s BOX adds no union
 * kind — the union stays closed. Strips are simply never put IN `placed`.
 */
const cloneStrataPlacement = (
  placement: StrataPlacementResult,
): MutablePlacement => {
  const leafBoxes = new Map<string, StrataBox>();
  for (const [id, box] of placement.leafBoxes) {
    leafBoxes.set(id, { ...box });
  }
  const boxedHulls = new Map<string, MutableBoxedHull>();
  for (const [id, bh] of placement.boxedHulls) {
    boxedHulls.set(id, {
      hull: bh.hull,
      box: { ...bh.box },
      placed: bh.placed.map((pu) => ({
        unit: pu.unit,
        box: { ...pu.box },
        colSpan: pu.colSpan,
      })),
    });
  }
  return { boxedHulls, leafBoxes };
};

const freezePlacement = (m: MutablePlacement): StrataPlacementResult => {
  const boxedHulls = new Map<string, StrataBoxedHull>();
  for (const [id, bh] of m.boxedHulls) {
    boxedHulls.set(id, { hull: bh.hull, box: bh.box, placed: bh.placed });
  }
  return { boxedHulls, leafBoxes: m.leafBoxes };
};

// ── the band trie (§3c) ───────────────────────────────────────────────────────

type BandGroup = {
  /** Full topology path from root to this group (inclusive). */
  path: readonly string[];
  /** The strip whose scope path is EXACTLY this path (at most one). */
  strip?: AncillaryStrip;
  children: BandGroup[];
};

/**
 * Build the nested scope trie under one host. Nesting is BETWEEN strips, never
 * inside one: a strip is scope-homogeneous by construction (a region-scoped
 * strip's cards all have `vpcId == null` — that is *why* they are region-scoped),
 * so `ancillaryScopeForPlacement`/`buildAncillaryStrips` are consumed UNCHANGED.
 *
 * Never nests by subnet: strips deliberately drop subnet info *"so no subnetZone
 * frame forms"*, and a strip's scope path therefore stops at vpc ⇒ depth ≤ 3.
 */
const buildBandTrie = (
  hostPath: readonly string[],
  strips: readonly AncillaryStrip[],
): BandGroup => {
  const root: BandGroup = { path: hostPath, children: [] };
  for (const strip of strips) {
    const scopePath = stripScopePath(strip);
    let node = root;
    for (let len = hostPath.length + 1; len <= scopePath.length; len++) {
      const seg = scopePath.slice(0, len);
      let child = node.children.find(
        (c) => c.path.length === len && c.path[len - 1] === seg[len - 1],
      );
      if (!child) {
        child = { path: seg, children: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.strip = strip;
  }
  const sortGroup = (group: BandGroup): void => {
    // Pin EVERY map/array iteration with the content comparator — inherited or
    // insertion order leaks straight into element order → churn (§3b).
    group.children.sort((a, b) =>
      compareStrataContentKeys(a.path.join("\0"), b.path.join("\0")),
    );
    group.children.forEach(sortGroup);
  };
  sortGroup(root);
  return root;
};

// ── band layout (§3c) ─────────────────────────────────────────────────────────

type LaidOutContainer = {
  width: number;
  height: number;
  /** Local coords, origin at the container box's top-left. */
  skeleton: ExcalidrawElementSkeleton[];
  frameId: string;
  maxDepth: number;
  stripCount: number;
  cardCount: number;
};

/**
 * Lay out one container box — the band itself (`depth === 0`, labelled
 * "Unconnected") or a nested scope group (`depth ≥ 1`, labelled like its hull).
 *
 * `availWidth` is the width this box may occupy; its own cards wrap at it
 * (`ancillaryStripRows` carries the box's internal padding), and child groups get
 * `availWidth - 2*PAD` — i.e. `innerWrap(depth) = hostInterior - 2*depth*PAD`.
 * It is ALWAYS derived from the host hull's interior, NEVER from
 * `ANCILLARY_DEFAULT_WRAP_WIDTH` (§3f).
 *
 * Own-strip cards render ungrouped and FIRST (owner's explicit choice, made
 * against a rendered preview showing sibling groups present — file-tree shape:
 * files above folders). Do not "improve" this by wrapping them in a synthetic
 * "(no vpc)" group; that was proposed and explicitly not adopted.
 */
const layoutBandContainer = (
  group: BandGroup,
  availWidth: number,
  depth: number,
  hostHullId: string,
  basePlacement: PipelinePlacement,
): LaidOutContainer => {
  const pad = PIPELINE_FRAME_PAD;
  const gap = PIPELINE_CLUSTER_GAP_Y;
  const titleH = PIPELINE_FRAME_TITLE_HEIGHT;

  const frameId =
    depth === 0
      ? ancillaryStripFrameId(hostHullId)
      : ancillaryGroupFrameId(group.path.join("\0"));

  // FLAT CASE: one strip, no nesting ⇒ call `layoutAncillaryStrip` VERBATIM, so
  // the rendering is identical to v1/RCLL/v2 rather than merely equivalent.
  // (`layoutAncillaryStrip` always emits its own "Unconnected" frame, which is
  // wrong for a sub-box labelled `us-west-2` — hence `ancillaryStripRows` below
  // for every other case.)
  if (depth === 0 && group.strip && group.children.length === 0) {
    const laid = layoutAncillaryStrip(group.strip, availWidth);
    return {
      width: laid.width,
      height: laid.height,
      skeleton: laid.skeleton,
      frameId: group.strip.stripFrameId,
      maxDepth: 0,
      stripCount: 1,
      cardCount: group.strip.cards.length,
    };
  }

  const skeleton: ExcalidrawElementSkeleton[] = [];
  const childFrameIds: string[] = [];
  // A group reserves its own title band; the band frame does not — matching
  // `layoutAncillaryStrip`, whose cards start at `pad` and whose label renders
  // ABOVE the box (FRAME_STYLE.nameOffsetY), not inside it.
  const contentTop = depth === 0 ? 0 : titleH;
  let y = contentTop;
  let width = 0;
  let maxDepth = depth;
  let stripCount = 0;
  let cardCount = 0;
  // `ancillaryStripRows` already includes a bottom pad; a group box does not.
  let needsBottomPad = false;

  if (group.strip) {
    const rows = ancillaryStripRows(group.strip, availWidth);
    for (const { card, x, y: cardY } of rows.positions) {
      skeleton.push(...translateSkeleton(card.build.skeleton, x, y + cardY));
      childFrameIds.push(card.build.clusterFrameId);
    }
    width = Math.max(width, rows.width);
    y += rows.height;
    stripCount += 1;
    cardCount += group.strip.cards.length;
    needsBottomPad = false;
  }

  for (const child of group.children) {
    if (y > contentTop) {
      y += gap;
    }
    const sub = layoutBandContainer(
      child,
      Math.max(availWidth - 2 * pad, 0),
      depth + 1,
      hostHullId,
      basePlacement,
    );
    skeleton.push(...translateSkeleton(sub.skeleton, pad, y));
    childFrameIds.push(sub.frameId);
    width = Math.max(width, pad + sub.width + pad);
    y += sub.height;
    maxDepth = Math.max(maxDepth, sub.maxDepth);
    stripCount += sub.stripCount;
    cardCount += sub.cardCount;
    needsBottomPad = true;
  }

  const height = y + (needsBottomPad ? pad : 0);

  // §3n — visual language: extend the strip, invent nothing. The shipped strip is
  // muted grey + hollow and deliberately does NOT call `spreadContextFrameColors`
  // (hulls are tinted+filled by role). A group labelled `VPC vpc-a0fcf…` must not
  // read as a REAL VPC hull, or the diagram asserts a VPC the layout does not
  // contain — grey+hollow is exactly what stops that, and it is already proven
  // living beside real hulls in v1/RCLL.
  const p =
    depth === 0 ? basePlacement : placementForPath(group.path, basePlacement);
  const role = topologyRoleAndKeyFromPath(group.path)?.role;
  skeleton.push({
    type: "frame",
    id: frameId,
    name:
      depth === 0
        ? "Unconnected"
        : role
        ? strataHullLabel(role as TopologyFrameRole, p)
        : group.path[group.path.length - 1] ?? "",
    x: 0,
    y: 0,
    width,
    height,
    strokeColor: ANCILLARY_STRIP_STROKE,
    backgroundColor: "transparent",
    children: childFrameIds,
    // §3j — THE ROLE FIREWALL. `TOPOLOGY_ROLES` is duplicated in FOUR modules
    // (StrataPierceMetrics:38, CollisionDiagnostics:111, SliceMetrics:170,
    // StrataChurnMetrics:63), each filtering on a bare `terraformTopologyRole`
    // read with NO ancillary exclusion. Today's strip is invisible to metrics
    // ONLY because it is stamped `"ancillaryStrip"` — that string IS the entire
    // firewall. The firewall is not "have no role", it is "have a role that is
    // not a TOPOLOGY_ROLE": `role` is typed plain `string`, so this needs no type
    // change, and neither literal is in any of the four sets. Do EXACTLY what the
    // shipped strip does — never hand-roll customData, never stamp a topology
    // role (`role="vpc"` would cause false-positive pierces, double-counting, and
    // — via `resolvePath`'s longest-containing-rect fallback — silently deepened
    // card paths that FABRICATE contiguity violations).
    customData: pipelineFrameCustomData(
      depth === 0 ? "ancillaryStrip" : "ancillaryGroup",
      p,
      frameId,
      {
        terraformPipelineAncillary: true,
        // Stamped from the trie path, never re-derived: `pipelineFrameCustomData`
        // derives the path from the ROLE, and a non-topology role falls through to
        // its deepest branch — which would stamp a subnet-shaped path on a band.
        // Overriding here (extras spread last) makes divergence from the model
        // structurally impossible rather than merely tested.
        //
        // A ROOT-hosted band's host path is EMPTY, and the A6 finalize requires a
        // non-empty path on every non-primaryCluster frame (it content-addresses
        // frames as `${role}:${path}`). Root-hosted bands are real and common —
        // on `staging-extended-localstack-v2` the `random` and `time` providers
        // have no dataflow clusters at all, so no provider hull exists and their
        // 14 cards legitimately land on the root. Stamp the root sentinel: the
        // address stays stable and unique, and because the role is never a
        // TOPOLOGY_ROLE no topology consumer can read this back as a hull path.
        terraformTopologyPath:
          group.path.length > 0 ? [...group.path] : [STRATA_ROOT_ID],
      },
    ),
  } as unknown as ExcalidrawElementSkeleton);

  return { width, height, skeleton, frameId, maxDepth, stripCount, cardCount };
};

// ── growth propagation (§3e) ──────────────────────────────────────────────────

const bottomOf = (box: StrataBox): number => box.y + box.height;

/** Shift one placed unit and its whole subtree down. Every box object is touched
 * EXACTLY once (the clone is deliberately un-aliased), keeping `placed`,
 * `boxedHulls` and `leafBoxes` in lockstep (§3e.4). */
const shiftPlacedSubtree = (
  pu: MutablePlacedUnit,
  dy: number,
  m: MutablePlacement,
): void => {
  pu.box.y += dy;
  if (pu.unit.kind === "leaf") {
    const leaf = m.leafBoxes.get(pu.unit.clusterId);
    if (leaf) {
      leaf.y += dy;
    }
    return;
  }
  const bh = m.boxedHulls.get(pu.unit.hullId);
  if (!bh) {
    return;
  }
  bh.box.y += dy;
  for (const child of bh.placed) {
    shiftPlacedSubtree(child, dy, m);
  }
};

/**
 * Re-bound a hull from its children's ACTUAL post-shift extents — monotone, so it
 * can only grow (mirrors RCLL's `expandNodeToChildren`, which takes `Math.max`
 * against the existing edges).
 *
 * ⚠️ `ancestor.height += grow` is WRONG and does not mirror RCLL: a blind add
 * over-grows any ancestor whose bottom was set by a DIFFERENT, taller child.
 * RCLL computes the actual bottom delta and re-bounds; so does this.
 *
 * Monotonicity is also what keeps the no-movement contract: `width` can only
 * change if a child genuinely sticks out (the §3f host-widened case), so on the
 * normal path the root's width — a function of `rank.columnX` — is untouched.
 */
const reboundHull = (bh: MutableBoxedHull): void => {
  if (bh.placed.length === 0) {
    return;
  }
  const pad = PIPELINE_FRAME_PAD;
  let maxBottom = Number.NEGATIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  for (const pu of bh.placed) {
    maxBottom = Math.max(maxBottom, bottomOf(pu.box));
    maxRight = Math.max(maxRight, pu.box.x + pu.box.width);
  }
  const bottom = Math.max(bottomOf(bh.box), maxBottom + pad);
  const right = Math.max(bh.box.x + bh.box.width, maxRight + pad);
  bh.box.height = bottom - bh.box.y;
  bh.box.width = right - bh.box.x;
};

/** Copy a hull's box into its parent's `placed` record for that hull (they are
 * equal by construction in `placeStrataHulls` — `x0 = cl.boxXLeft`,
 * `height = cl.boxHeight` — and must stay equal). */
const syncPlacedForHull = (
  hullId: string,
  m: MutablePlacement,
  parentOf: ReadonlyMap<string, string>,
): void => {
  const parentId = parentOf.get(hullId);
  if (parentId === undefined) {
    return;
  }
  const parent = m.boxedHulls.get(parentId);
  const self = m.boxedHulls.get(hullId);
  if (!parent || !self) {
    return;
  }
  for (const pu of parent.placed) {
    if (pu.unit.kind === "hull" && pu.unit.hullId === hullId) {
      pu.box.x = self.box.x;
      pu.box.y = self.box.y;
      pu.box.width = self.box.width;
      pu.box.height = self.box.height;
    }
  }
};

/**
 * 🔴 THE STEP THAT IS THE DIFFERENCE BETWEEN 90 COLLISIONS AND ZERO.
 *
 * Re-settle one hull's children in Y after one of them grew, using the ENGINE'S
 * OWN step-4 placement rule over the CURRENT (grown) child boxes, in the existing
 * `placed` (A2 sequence) order:
 *  - packed ⇒ the `dropY` skyline (imported, not re-implemented);
 *  - banded ⇒ the LANE_GAP_Y cursor stack.
 *
 * ⚠️ WHY NOT RCLL's RULE. RCLL's `propagateInsertedBandGrowth` shifts only the
 * siblings that X-OVERLAP the grown child and sit below its old bottom. **That
 * rule is NOT TRANSITIVE, and strata violates its implicit assumption.** Measured
 * on `staging-extended-localstack-v2` (deBand=vpc): region `us-west-2`'s X-span
 * (5924..7814) is a strict SUBSET of `us-east-2`'s (5428..7814), so a third hull
 * pushed `us-east-2` down by 5897.5 while `us-west-2` — which it did not
 * X-overlap — moved only 4291. The two converged and collided:
 * `{bandOverlaps: 10}`, caught by §3g. A pairwise push cannot see that B's
 * displacement creates a NEW conflict with a C that never overlapped A.
 *
 * Re-running the hull's own stacking rule is transitive BY CONSTRUCTION (each
 * child settles against every earlier child's FINAL box) and is strictly the
 * minimal repair:
 *  - it is MONOTONE — `dropY` is monotone in its rects' heights, so growing a box
 *    can only push later children DOWN; every `dy` is ≥ 0 and is clamped so;
 *  - it is an IDENTITY when nothing grew (it recomputes the very placement
 *    `placeStrataHulls` produced), which is what keeps the off path byte-identical;
 *  - it never reads or writes `x`/`width`, never re-ranks, never re-orders.
 *
 * This is a Y re-settle under a fixed order, NOT "re-running placement" — no
 * layering, crossing-min, compaction or straightening is re-run, exactly the
 * tradeoff RCLL accepted in its own words.
 */
const restackHullChildren = (
  bh: MutableBoxedHull,
  m: MutablePlacement,
): void => {
  const topInset =
    PIPELINE_FRAME_PAD + (bh.hull.role === "root" ? 0 : strataTitleReserve());
  const rects: SkylineRect[] = [];
  let cursor = topInset;

  for (const pu of bh.placed) {
    const isHull = pu.unit.kind === "hull";
    const x0 = pu.box.x;
    const x1 = pu.box.x + pu.box.width;
    let localY: number;
    if (bh.hull.policy === "packed") {
      localY = dropY(rects, x0, x1, topInset, isHull);
      rects.push({ x0, x1, y1: localY + pu.box.height, isHull });
    } else {
      localY = cursor;
      cursor += pu.box.height + PIPELINE_LANE_GAP_Y;
    }
    // Y MAY ONLY GROW DOWNWARD — never let a re-settle reclaim slack, or the
    // "frame dimensions unchanged, Y only grows" contract stops holding by
    // construction and starts depending on this clamp being right.
    const dy = bh.box.y + localY - pu.box.y;
    if (dy > 0) {
      shiftPlacedSubtree(pu, dy, m);
    }
  }
};

/**
 * Walk host → root: at each ancestor, re-settle its children against the grown
 * child and re-bound it from their ACTUAL post-shift extents.
 */
const propagateBandGrowth = (
  hostId: string,
  m: MutablePlacement,
  parentOf: ReadonlyMap<string, string>,
): void => {
  let grownChildId = hostId;

  for (
    let parentId = parentOf.get(grownChildId);
    parentId !== undefined;
    parentId = parentOf.get(grownChildId)
  ) {
    const parent = m.boxedHulls.get(parentId);
    if (!parent) {
      return;
    }
    // The grown child's own box changed; its record in `placed` must agree
    // BEFORE the parent re-settles/re-bounds off it, or both read a stale box.
    syncPlacedForHull(grownChildId, m, parentOf);
    restackHullChildren(parent, m);
    reboundHull(parent);
    grownChildId = parentId;
  }
};

// ── host resolution (§3a) ─────────────────────────────────────────────────────

/**
 * `hostHull(strip)` = the longest prefix of the strip's scope path whose
 * `topologyRoleAndKeyFromPath(prefix).key` is present in `placement.boxedHulls`.
 *
 * Sound because `buildStrataHullTree` sets `node.id = rk.key`, `boxedHulls` is
 * keyed by `hull.id`, and the root is always present.
 *
 * ONE rule subsumes de-band AND sparsity — the injector never reads
 * `deBandLevel`, so there is no `floorLevel` param and no shared-code change:
 *  - `deBand=none` ⇒ the strip's own hull exists ⇒ flat, today's behavior.
 *  - `deBand=vpc`  ⇒ vpc hulls are gone ⇒ vpc strips land on the region hull
 *    beside its own strip ⇒ nesting. (Placement moves up; interior nests, so the
 *    VPC grouping survives INSIDE the band and provenance is preserved. A merge
 *    would destroy it; "strips ignore de-band" would keep a VPC hull in the main
 *    tree and defeat de-band's compaction.)
 *  - a region hull may be absent even at a KEPT depth (no dataflow cluster in
 *    that region) — a truncate-to-K clamp would target a nonexistent hull; the
 *    walk handles it for free.
 */
const resolveHostHullId = (
  strip: AncillaryStrip,
  boxedHulls: ReadonlyMap<string, unknown>,
  rootId: string,
): string => {
  const path = stripScopePath(strip);
  let host = rootId;
  for (let len = 1; len <= path.length; len++) {
    const rk = topologyRoleAndKeyFromPath(path.slice(0, len));
    if (rk && boxedHulls.has(rk.key)) {
      host = rk.key;
    }
  }
  return host;
};

// ── entry point ───────────────────────────────────────────────────────────────

/**
 * Inject ancillary bands into a finished strata placement.
 *
 * Returns a NEW placement (the input is never mutated) plus the band side map.
 * Never throws for an empty strip set — it simply returns the cloned placement
 * and no bands, so `bands.size > 0` naturally yields "no band at all" for a host
 * with zero ancillary cards (rather than an empty "Unconnected" box).
 */
export function injectStrataAncillaryBands(args: {
  model: StrataModel;
  placement: StrataPlacementResult;
  strips: readonly AncillaryStrip[];
}): StrataAncillaryInjection {
  const { model, placement, strips } = args;
  const pad = PIPELINE_FRAME_PAD;
  const laneGap = PIPELINE_LANE_GAP_Y;

  const m = cloneStrataPlacement(placement);
  const { parentOf, nodeOf, depthOf } = buildParentIndex(model.hullRoot);
  const bands = new Map<string, StrataAncillaryBand>();

  if (strips.length === 0) {
    return {
      placement: freezePlacement(m),
      bands,
      relocatedStripCount: 0,
      hostWidenedCount: 0,
      maxNestDepth: 0,
    };
  }

  // §3b — re-sort with strata's PINNED comparator. `buildAncillaryStrips` sorts
  // by `scopeKey.localeCompare`, which is ICU-dependent NONDETERMINISM; strata
  // pins code-unit ordering and warns "NEVER bare localeCompare". Never trust the
  // inherited order. (Card order WITHIN a strip is already fine —
  // `collectAncillaryAddresses` returns `out.sort()`.)
  const sortedStrips = [...strips].sort((a, b) =>
    compareStrataContentKeys(a.scopeKey, b.scopeKey),
  );

  // Group strips by resolved host hull.
  const byHost = new Map<string, AncillaryStrip[]>();
  let relocatedStripCount = 0;
  for (const strip of sortedStrips) {
    const hostId = resolveHostHullId(strip, m.boxedHulls, model.hullRoot.id);
    if (hostId !== strip.scopeKey) {
      relocatedStripCount += 1;
    }
    const list = byHost.get(hostId);
    if (list) {
      list.push(strip);
    } else {
      byHost.set(hostId, [strip]);
    }
  }

  // Deepest-host-first: a deeper host's growth must be settled before its own
  // ancestor re-bounds off it (§3e).
  const hostIds = [...byHost.keys()].sort(
    (a, b) =>
      (depthOf.get(b) ?? 0) - (depthOf.get(a) ?? 0) ||
      compareStrataContentKeys(a, b),
  );

  let hostWidenedCount = 0;
  let maxNestDepth = 0;

  /**
   * ⚠️ Bands are materialized in TWO PHASES, and that is load-bearing.
   *
   * A band's absolute box cannot be fixed at placement time: a LATER host's
   * growth propagates through the shared ancestors and can rigidly shift an
   * EARLIER host's whole subtree down (§3e). RCLL never hits this because its
   * bands are real `ancillaryBand` leaves IN the tree, so `translateSubtreeY`
   * moves them for free; strata's bands are a side map (§3i — deliberately, to
   * keep `StrataUnit` closed), so nothing moves them.
   *
   * Materializing at placement time left the band behind while its host moved:
   * measured on `staging-extended-localstack-v2` as
   * `{bandEscapesHost: 6, bandOverlaps: 54, bandTitleCollisions: 9}` — caught by
   * §3g's containment check, which is exactly the class of silent, green,
   * invisible failure that check exists for.
   *
   * So phase 1 records each band's offset RELATIVE to its host's box origin (the
   * content above a band never changes after it is placed, and a host's `x` never
   * moves at all), and phase 2 resolves every band against its host's FINAL box
   * once all growth has settled.
   */
  type PendingBand = {
    hostId: string;
    laid: LaidOutContainer;
    /** Offset from the host box's top-left — invariant under any later shift. */
    offsetX: number;
    offsetY: number;
  };
  const pending: PendingBand[] = [];

  for (const hostId of hostIds) {
    const hostStrips = byHost.get(hostId)!;
    const host = m.boxedHulls.get(hostId);
    const hostNode = nodeOf.get(hostId);
    if (!host || !hostNode) {
      continue;
    }

    // §3f — wrap to the HOST'S INTERIOR, never to `ANCILLARY_DEFAULT_WRAP_WIDTH`
    // (1268px). Emitted width is `min(effectiveWrap, usedWidth + pad)`, and P1
    // carries ~17 cards/strip, so most strips SATURATE 1268px — every host hull
    // with a narrower interior would have been suppressed, and the feature would
    // have rendered almost nothing. Wrapping to the host's interior is what v1
    // already does, deliberately, *"so the strip grows the hull downward, not
    // sideways"* — and it makes overflow structurally impossible, which is why
    // there is no suppression mechanism here at all.
    const hostInterior = Math.max(host.box.width - 2 * pad, 0);
    const trie = buildBandTrie(hostNode.path, hostStrips);
    const basePlacement = placementForPath(
      hostNode.path,
      hostStrips[0]!.placement,
    );
    const laid = layoutBandContainer(
      trie,
      hostInterior,
      0,
      hostId,
      basePlacement,
    );

    // The band sits below the host's existing content, cleared by the
    // hull-adjacent LANE gap (a band is a framed box, and its "Unconnected"
    // label renders ABOVE its box — the gap is what clears that label from the
    // content stacked above; 96 ≫ the 20.5px label band).
    const offsetX = pad;
    const offsetY = host.box.height - pad + laneGap;
    const grow = laid.height + laneGap;

    host.box.height += grow;
    // §3f's only genuinely irreducible case: a SINGLE card wider than the host's
    // interior (`ancillaryStripRows` floors `effectiveWrap` at
    // `maxCardWidth + 2*pad`, so it can never be split). That one band widens its
    // host — the one documented `width` write — and is counted.
    if (laid.width > hostInterior) {
      hostWidenedCount += 1;
      host.box.width = Math.max(host.box.width, laid.width + 2 * pad);
    }

    propagateBandGrowth(hostId, m, parentOf);

    pending.push({ hostId, laid, offsetX, offsetY });
    maxNestDepth = Math.max(maxNestDepth, laid.maxDepth);
  }

  // ── PHASE 2: resolve every band against its host's FINAL box (see above). ──
  for (const { hostId, laid, offsetX, offsetY } of pending) {
    const host = m.boxedHulls.get(hostId)!;
    const x = host.box.x + offsetX;
    const y = host.box.y + offsetY;
    bands.set(hostId, {
      hullId: hostId,
      box: { x, y, width: laid.width, height: laid.height },
      skeleton: translateSkeleton(laid.skeleton, x, y),
      frameId: laid.frameId,
      stripCount: laid.stripCount,
      cardCount: laid.cardCount,
      nestDepth: laid.maxDepth,
    });
  }

  // Deterministic band order (host depth then content key already applied above;
  // re-key into a stable content-ordered map so element order can never depend on
  // Map insertion order).
  const orderedBands = new Map<string, StrataAncillaryBand>();
  for (const id of [...bands.keys()].sort(compareStrataContentKeys)) {
    orderedBands.set(id, bands.get(id)!);
  }

  return {
    placement: freezePlacement(m),
    bands: orderedBands,
    relocatedStripCount,
    hostWidenedCount,
    maxNestDepth,
  };
}

// ── containment check (§3g) ───────────────────────────────────────────────────

/**
 * 🔴 HIGHEST-SEVERITY RISK IN THE PLAN — ships WITH the feature or the feature
 * does not ship.
 *
 * `checkStrataStructure` walks `model.hullRoot` for descendants, and bands are
 * NOT in the model. So strata's three R2 checks — `nonAncestorOverlaps`,
 * `titleCollisions`, `contiguityViolations` — cover everything EXCEPT the thing
 * this module adds. A band overlapping a leaf would be silent, green, invisible:
 * the exact `skeleton: []` failure class, and precisely the "unreserved-space
 * failure" that made the measured dead end emit 90 collisions.
 *
 * Mirrors all three R2 checks over the band set:
 *  - every band ⊆ its host hull box;
 *  - no band overlaps any `leafBox` or non-ancestor hull box;
 *  - no band overlaps any hull's top TITLE_RESERVE strip (the `titleCollisions`
 *    analog — strata counts this for model boxes and it is exactly the class the
 *    dead end tripped; do not omit it).
 *
 * Any nonzero count is a failure, exactly like `checkStrataStructure`.
 */
export function checkStrataAncillaryContainment(
  bands: ReadonlyMap<string, StrataAncillaryBand>,
  placement: StrataPlacementResult,
  model: StrataModel,
): {
  bandEscapesHost: number;
  bandOverlaps: number;
  bandTitleCollisions: number;
} {
  const pad = PIPELINE_FRAME_PAD;
  // Mirrors `strataTitleReserve()` + the strip geometry in `checkStrataStructure`
  // (terraformPipelineStrataPlacement.ts): the reserved strip is
  // `PIPELINE_FRAME_PAD + 2*PIPELINE_FRAME_PAD` tall at the hull's top edge.
  const titleStripHeight = pad + pad * 2;

  const descendantsOf = new Map<string, Set<string>>();
  const collect = (hull: StrataHullNode): Set<string> => {
    const set = new Set<string>();
    for (const leaf of hull.leafClusterIds) {
      set.add(leaf);
    }
    for (const child of hull.children) {
      set.add(child.id);
      for (const d of collect(child)) {
        set.add(d);
      }
    }
    descendantsOf.set(hull.id, set);
    return set;
  };
  collect(model.hullRoot);

  let bandEscapesHost = 0;
  let bandOverlaps = 0;
  let bandTitleCollisions = 0;

  for (const [hostId, band] of bands) {
    const host = placement.boxedHulls.get(hostId);
    if (!host) {
      bandEscapesHost += 1;
      continue;
    }
    // ⊆ host (a half-pixel tolerance, matching the engine's ±0.5 convention).
    if (
      band.box.x < host.box.x - 0.5 ||
      band.box.y < host.box.y - 0.5 ||
      band.box.x + band.box.width > host.box.x + host.box.width + 0.5 ||
      band.box.y + band.box.height > host.box.y + host.box.height + 0.5
    ) {
      bandEscapesHost += 1;
    }

    // A leaf is never a container of a band — the band is placed BELOW the
    // host's content, so ANY leaf overlap (inside the host or not) is a bug.
    for (const box of placement.leafBoxes.values()) {
      if (boxesOverlap(band.box, box)) {
        bandOverlaps += 1;
      }
    }

    for (const [hullId, bh] of placement.boxedHulls) {
      if (hullId === hostId) {
        continue; // the band's own host contains it by design
      }
      const desc = descendantsOf.get(hullId);
      if (desc && desc.has(hostId)) {
        continue; // an ancestor of the host contains the band by design
      }
      if (boxesOverlap(band.box, bh.box)) {
        bandOverlaps += 1;
      }
      if (bh.hull.role === "root") {
        continue; // root carries no title strip
      }
      // The TITLE_RESERVE analog — do NOT omit it. The strip lies INSIDE the
      // hull's box (top `PAD + strataTitleReserve()` px), so this is a strict
      // refinement of the overlap count above rather than a disjoint class; it is
      // kept as its own named counter because it is exactly the class the
      // measured dead end tripped, and a merged count would hide it.
      const strip: StrataBox = {
        x: bh.box.x,
        y: bh.box.y,
        width: bh.box.width,
        height: titleStripHeight,
      };
      if (boxesOverlap(band.box, strip)) {
        bandTitleCollisions += 1;
      }
    }
  }

  return { bandEscapesHost, bandOverlaps, bandTitleCollisions };
}
