/* eslint-disable max-lines -- Mirrors `terraformPipelineRcllAncillaryAllocator.ts`,
 * which carries the same disable for the same reason. The band injector and the
 * §3o allocator are one unit: the allocator reasons about exactly the hosts,
 * tries and geometry the injector builds, and splitting them would mean exporting
 * six module-private helpers (`buildBandTrie`, `planStrataAncillaryHosts`,
 * `layoutBandContainer`, `buildParentIndex`, `MutablePlacement`,
 * `strataRightSlackCeiling`) purely to satisfy a line count — weakening the
 * module boundary far more than the length costs. Most of the length here is
 * comments recording measured failures; see the header. */
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
  measureAncillaryStrip,
  pipelineFrameCustomData,
  translateSkeleton,
} from "./terraformPipelineLayoutShared";
import { compareStrataContentKeys } from "./terraformPipelineStrataTypes";
import {
  checkStrataStructure,
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
  /**
   * Hosts whose band could NOT be drawn without writing a hull width — i.e. the
   * band's own content is wider than the width it was granted, which only happens
   * when a SINGLE CARD is wider than that width (`ancillaryStripRows` floors
   * `effectiveWrap` at `maxCardWidth + 2*pad`, so such a card can never be split).
   *
   * 🔴 THE PLAN CALLED THIS AN "EXCEPTION"; IT IS NOT ONE — see the note on
   * `injectStrataAncillaryBands`. Widening the host propagates through
   * `reboundHull` to the ROOT, and "root width unchanged" is a required
   * invariant (it is also the floor the allocator's slack ceiling is built on).
   * An invariant with an exception is not an invariant. So the band is dropped
   * and COUNTED here instead, and the only path that may widen a hull at all is
   * the allocator's — which validates every widening end-to-end and rolls back.
   *
   * Deterministic (content-key) order.
   */
  suppressedHostIds: string[];
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
  /**
   * Skip every skeleton build and emit `skeleton: []` — the width/height math is
   * the SAME CODE PATH, so a measurement can never drift from what is drawn.
   * The allocator measures thousands of candidate widths; building ~300 cards'
   * skeletons per candidate would dominate its cost for output it throws away.
   * Never use a measure-only result to draw with.
   */
  measureOnly = false,
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
    // `measureAncillaryStrip` is `layoutAncillaryStrip`'s own documented
    // height/width-only mirror — both are `ancillaryStripRows` verbatim.
    const laid = measureOnly
      ? { ...measureAncillaryStrip(group.strip, availWidth), skeleton: [] }
      : layoutAncillaryStrip(group.strip, availWidth);
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
    if (!measureOnly) {
      for (const { card, x, y: cardY } of rows.positions) {
        skeleton.push(...translateSkeleton(card.build.skeleton, x, y + cardY));
        childFrameIds.push(card.build.clusterFrameId);
      }
    }
    width = Math.max(width, rows.width);
    y += rows.height;
    stripCount += 1;
    cardCount += group.strip.cards.length;
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
      measureOnly,
    );
    if (!measureOnly) {
      skeleton.push(...translateSkeleton(sub.skeleton, pad, y));
      childFrameIds.push(sub.frameId);
    }
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
  if (measureOnly) {
    return {
      width,
      height,
      skeleton,
      frameId,
      maxDepth,
      stripCount,
      cardCount,
    };
  }

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
 * OWN step-4 placement rule over the CURRENT (grown) child boxes, in CURRENT Y
 * ORDER (see the F1 note below):
 *  - packed ⇒ the `dropY` skyline (imported, not re-implemented);
 *  - banded ⇒ the LANE_GAP_Y cursor stack.
 *
 * 🔴 F1 — DRIVE THE RE-SETTLE FROM CURRENT Y ORDER, NEVER FROM `placed` ARRAY
 * ORDER. This is the bug underneath the phantom-Y symptom, and it made the
 * feature render NOTHING in the owner's own config.
 *
 * An earlier version of this function iterated `bh.placed` in array order and
 * claimed to be "an identity when nothing grew". That is true only of the RAW A0
 * placement. Injection is wired FIVE stages downstream (packedScoring, A7
 * `refineStrataCoordinates`, `refineStrataVerticalSlots`, `transposeStrataColumns`,
 * `refineStrataBlockClamp`), and every one of them rewrites box Y while
 * PRESERVING `placed` array order — transpose is explicitly "an
 * ENVELOPE-PRESERVING adjacent Y-exchange": it swaps two units' Y and leaves the
 * array alone. Re-deriving Y from `dropY` in array order therefore re-imposes the
 * PRE-transpose Y order and actively undoes those passes. Measured on a
 * transpose-style Y-exchange fixture: `{bandOverlaps: 2, bandTitleCollisions: 1}`
 * + `{nonAncestorOverlaps: 3, titleCollisions: 2}`, with one hull nested inside
 * another. Since `strataTranspose` is the owner's config (and a default-on
 * candidate), "All resources" + transpose meant containment threw and EVERY band
 * was silently dropped.
 *
 * Sorting by current `box.y` (stable, tie-broken by the original array index so
 * the A2 sequence still decides ties) makes this an IDENTITY ON ANY COLLISION-FREE
 * PLACEMENT, not merely on A0 — a strictly stronger property than the original
 * ever had, and one that does not depend on which upstream passes ran:
 *
 *   Processing top-to-bottom, a box's `dropY` is computed only against boxes ABOVE
 *   it. `dropY` returns the HIGHEST resting position ≥ `topInset`, and in a
 *   collision-free placement the box's current y already clears every one of those
 *   boxes' bottoms ⇒ target ≤ current y ⇒ `dy <= 0` ⇒ the clamp holds it still.
 *   Only a box that a grown neighbour now genuinely intrudes on gets `dy > 0`.
 *
 * Transitivity is preserved: each box settles against the FINAL boxes of everything
 * above it, so a displacement that creates a NEW conflict further down is seen —
 * which is exactly what RCLL's pairwise `propagateInsertedBandGrowth` cannot do.
 *
 * `bh.placed` is ITERATED in Y order, never REORDERED — the array's A2 sequence is
 * load-bearing elsewhere.
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

  // F1 — current Y order, stable on the original A2 index for ties.
  const inYOrder = bh.placed
    .map((pu, index) => ({ pu, index }))
    .sort((a, b) => a.pu.box.y - b.pu.box.y || a.index - b.index)
    .map((e) => e.pu);

  for (const pu of inYOrder) {
    const isHull = pu.unit.kind === "hull";
    const x0 = pu.box.x;
    const x1 = pu.box.x + pu.box.width;
    const targetLocalY =
      bh.hull.policy === "packed"
        ? dropY(rects, x0, x1, topInset, isHull)
        : cursor;
    // Y MAY ONLY GROW DOWNWARD — never let a re-settle reclaim slack, or the
    // "frame dimensions unchanged, Y only grows" contract stops holding by
    // construction and starts depending on this clamp being right.
    const dy = bh.box.y + targetLocalY - pu.box.y;
    if (dy > 0) {
      shiftPlacedSubtree(pu, dy, m);
    }

    // 🔴 P1-A — RECORD THE UNIT'S *ACTUAL* Y, NEVER THE UNCLAMPED TARGET.
    //
    // The clamp above REFUSES upward movement, so when a unit already sits BELOW
    // its recomputed target (`dy <= 0`) its real box stays where it is while
    // `targetLocalY` names a higher, fictional position. Feeding that fiction
    // forward — pushing `targetLocalY + height` onto the skyline, or advancing
    // the banded cursor from it — makes every LATER sibling settle against a box
    // that does not exist, so it can be placed overlapping the unit's real box.
    //
    // This is reachable, not theoretical: A7 / vertical-relocate / transpose /
    // block-clamp all run BEFORE this stage and legitimately leave a unit below
    // its original engine position. Deriving the recorded Y from `pu.box` after
    // the shift keeps the skyline and the cursor in agreement with reality, and
    // is still an exact identity when nothing grew (`dy === 0` ⇒
    // `finalLocalY === targetLocalY`), which is what preserves off-path
    // byte-identity.
    const finalLocalY = pu.box.y - bh.box.y;
    if (bh.hull.policy === "packed") {
      rects.push({ x0, x1, y1: finalLocalY + pu.box.height, isHull });
    } else {
      cursor = finalLocalY + pu.box.height + PIPELINE_LANE_GAP_Y;
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

/**
 * Resolve every strip to its host hull and order the hosts for injection.
 *
 * Shared by the injector and the allocator ON PURPOSE: the allocator reasons
 * about exactly the hosts the injector will build, so a divergence here would
 * make it allocate slack to a band that never materialises. Pure — reads the
 * placement, writes nothing.
 */
const planStrataAncillaryHosts = (
  model: StrataModel,
  placement: StrataPlacementResult,
  strips: readonly AncillaryStrip[],
): {
  hostIds: string[];
  byHost: Map<string, AncillaryStrip[]>;
  relocatedStripCount: number;
} => {
  const { depthOf } = buildParentIndex(model.hullRoot);

  // §3b — re-sort with strata's PINNED comparator. `buildAncillaryStrips` sorts
  // by `scopeKey.localeCompare`, which is ICU-dependent NONDETERMINISM; strata
  // pins code-unit ordering and warns "NEVER bare localeCompare". Never trust the
  // inherited order. (Card order WITHIN a strip is already fine —
  // `collectAncillaryAddresses` returns `out.sort()`.)
  const sortedStrips = [...strips].sort((a, b) =>
    compareStrataContentKeys(a.scopeKey, b.scopeKey),
  );

  const byHost = new Map<string, AncillaryStrip[]>();
  let relocatedStripCount = 0;
  for (const strip of sortedStrips) {
    const hostId = resolveHostHullId(
      strip,
      placement.boxedHulls,
      model.hullRoot.id,
    );
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
  return { hostIds, byHost, relocatedStripCount };
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
  /**
   * Allocator (§3o) grants: hostId → the width the band may occupy, ALWAYS
   * `>= hostInterior` (a grant never shrinks a band). Absent ⇒ every band wraps
   * at its host's interior — the §3f baseline, and the allocator's own fallback.
   *
   * A grant `> hostInterior` is the ONLY thing in this module that may write a
   * hull width, and every grant is validated end-to-end with rollback by
   * `buildValidatedStrataAncillaryInsertion`.
   */
  wrapWidthByHostId?: ReadonlyMap<string, number>;
}): StrataAncillaryInjection {
  const { model, placement, strips, wrapWidthByHostId } = args;
  const pad = PIPELINE_FRAME_PAD;
  const laneGap = PIPELINE_LANE_GAP_Y;

  const m = cloneStrataPlacement(placement);
  const { parentOf, nodeOf } = buildParentIndex(model.hullRoot);
  const bands = new Map<string, StrataAncillaryBand>();
  // The hard floor for every width clamp below — read BEFORE any growth, so it
  // is the pre-ancillary root right edge no matter what order hosts settle in.
  const rootBox = placement.boxedHulls.get(model.hullRoot.id)?.box;
  const baselineRootRight = rootBox ? rootBox.x + rootBox.width : Infinity;

  if (strips.length === 0) {
    return {
      placement: freezePlacement(m),
      bands,
      relocatedStripCount: 0,
      suppressedHostIds: [],
      maxNestDepth: 0,
    };
  }

  const { hostIds, byHost, relocatedStripCount } = planStrataAncillaryHosts(
    model,
    placement,
    strips,
  );

  const suppressedHostIds: string[] = [];
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
    // An allocator grant may only ever WIDEN (§3o); `Math.max` makes that hold
    // here rather than depending on the allocator never emitting a smaller one.
    const availWidth = Math.max(
      hostInterior,
      wrapWidthByHostId?.get(hostId) ?? hostInterior,
    );
    const trie = buildBandTrie(hostNode.path, hostStrips);
    const basePlacement = placementForPath(
      hostNode.path,
      hostStrips[0]!.placement,
    );
    const laid = layoutBandContainer(
      trie,
      availWidth,
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

    // Grow FIRST: the slack ceiling below must see the host at the height the
    // band actually gives it, or it measures right-neighbour overlap against
    // geometry that does not exist.
    const heightBeforeBand = host.box.height;
    host.box.height += grow;

    // 🔴 P1-B — A WIDTH WRITE IS CLAMPED TO THE SLACK CEILING, AND THE BAND IS
    // DROPPED IF IT WILL NOT FIT UNDER IT. THE ROOT NEVER MOVES.
    //
    // The plan called host-widening "the one documented exception" to its own
    // "root width unchanged" invariant. That is a plan DEFECT, not a judgement
    // call: `reboundHull` propagates a width write up EVERY ancestor including
    // the ROOT; an invariant with an exception is not an invariant; and
    // `strataRightSlackCeiling` is FLOORED on a fixed root right edge, so a root
    // that can itself move makes the allocator's ceiling unsound.
    //
    // But dropping the band outright is ALSO wrong, and measurably so. The
    // plan's premise — that `laid.width > hostInterior` means "a single card
    // wider than the host's interior", a rare irreducible case — is FALSE for
    // NESTED bands: each nesting level costs `2*pad`, so a card that fits the
    // host interior perfectly well still overflows once it is a level or two
    // down. Suppressing on that condition drops every nested band on a
    // tight host — i.e. exactly the de-band nesting that is the whole feature.
    //
    // So clamp instead of choosing between two bad options: widen only into
    // PRE-EXISTING right slack, bounded by the same recursive ceiling §3o uses.
    // The ceiling is floored at `baselineRootRight` and reserves one pad per
    // ancestor level, so `host.right <= ceiling` inductively implies every
    // ancestor — including the root — re-bounds within its existing width. The
    // root is therefore untouched BY CONSTRUCTION, not by test. If the needed
    // width does not fit under the ceiling, the band is genuinely undrawable
    // without moving the dataflow: drop it and COUNT it (the cards are never
    // lost silently — the count rides in meta).
    const neededWidth = Math.max(host.box.width, laid.width + 2 * pad);
    if (neededWidth > host.box.width + 0.5) {
      const ceilingRight = strataRightSlackCeiling(
        hostId,
        m,
        parentOf,
        baselineRootRight,
      );
      if (host.box.x + neededWidth > ceilingRight + 0.5) {
        host.box.height = heightBeforeBand; // revert; nothing was propagated yet
        suppressedHostIds.push(hostId);
        continue;
      }
      host.box.width = neededWidth;
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
    suppressedHostIds: [...suppressedHostIds].sort(compareStrataContentKeys),
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
      const desc = descendantsOf.get(hullId);
      const isHostOrAncestor =
        hullId === hostId || (desc ? desc.has(hostId) : false);

      // 🔴 P1-C — THE TITLE STRIP IS CHECKED FOR *EVERY* NON-ROOT HULL, AND IT IS
      // CHECKED **BEFORE** THE HOST/ANCESTOR EXCLUSIONS BELOW.
      //
      // The exclusions exist for the OVERLAP counter only: a band is inside its
      // host, and its host is inside its ancestors, so those overlaps are by
      // design. They are NOT a reason to skip the title strip — a band that sits
      // wholly inside its host, touches no leaf, and covers that host's own frame
      // TITLE is exactly the malformed geometry this gate exists to catch, and
      // excluding the host made the gate blind precisely where it mattered
      // (it would return a clean {0,0,0}).
      //
      // Nothing here is a legitimate overlap: a band is placed below its host's
      // content, and a host is placed below its ancestors' own title reserve
      // (`placeStrataHulls`'s `topInset`), so a hit is a real bug either way.
      if (bh.hull.role !== "root") {
        // The strip lies INSIDE the hull's box (top `PAD + strataTitleReserve()`
        // px), so for foreign hulls this is a strict refinement of the overlap
        // count rather than a disjoint class; it is kept as its own named counter
        // because it is exactly the class the measured dead end tripped, and a
        // merged count would hide it.
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

      if (isHostOrAncestor) {
        continue; // the host / an ancestor of the host contains the band by design
      }
      if (boxesOverlap(band.box, bh.box)) {
        bandOverlaps += 1;
      }
    }
  }

  return { bandEscapesHost, bandOverlaps, bandTitleCollisions };
}

// ── the greedy right-slack allocator (§3o) ────────────────────────────────────

/**
 * One granted widening. `scopeKey` is the HOST HULL ID, not a strip scope key.
 *
 * ⚠️ DELIBERATE DIVERGENCE FROM THE PLAN, which says to key allocations by the
 * strip's `scopeKey` (RCLL does, because RCLL injects ONE BAND PER STRIP). Strata
 * injects one band PER HOST, and under de-band a host carries several strips
 * nested in a trie (that nesting is the whole feature). Widening is therefore a
 * property of the band — i.e. of the host — and a per-strip grant would be
 * unrepresentable: two strips in one band cannot wrap at two different widths.
 * The field keeps RCLL's NAME so `strataAncillaryAllocator` stays diffable
 * against `rcllAncillaryAllocator`. With `deBand=none` every host hosts exactly
 * its own strip and the two keyings coincide exactly.
 */
export type StrataAncillaryAllocation = {
  /** Host hull id (see above). */
  scopeKey: string;
  baselineWrapWidth: number;
  wrapWidth: number;
  allocatedWidthPx: number;
  /**
   * PIXELS of band height removed — RCLL's name and RCLL's semantics
   * (`baselineHeight - candidateHeight`, `terraformPipelineRcllAncillaryAllocator
   * .ts:549-552`), NOT a count of rows. Kept verbatim for cross-engine
   * comparability; do not "fix" the name in one engine only.
   */
  rowSavings: number;
  cardCount: number;
};

export type StrataAncillaryAllocatorMeta = {
  widenedHullCount: number;
  allocatedWidthPx: number;
  rowSavings: number;
  fallbackDropCount: number;
  allocationCount: number;
  allocations?: {
    scopeKey: string;
    wrapWidth: number;
    allocatedWidthPx: number;
    rowSavings: number;
    cardCount: number;
  }[];
};

export const EMPTY_STRATA_ANCILLARY_ALLOCATOR_META: StrataAncillaryAllocatorMeta =
  {
    widenedHullCount: 0,
    allocatedWidthPx: 0,
    rowSavings: 0,
    fallbackDropCount: 0,
    allocationCount: 0,
  };

const allocatorMetaFromAllocations = (
  allocations: readonly StrataAncillaryAllocation[],
  fallbackDropCount: number,
): StrataAncillaryAllocatorMeta => {
  const allocated = allocations.filter((a) => a.allocatedWidthPx > 0);
  return {
    widenedHullCount: new Set(allocated.map((a) => a.scopeKey)).size,
    allocatedWidthPx: Math.round(
      allocated.reduce((t, a) => t + a.allocatedWidthPx, 0),
    ),
    rowSavings: Math.round(allocated.reduce((t, a) => t + a.rowSavings, 0)),
    fallbackDropCount,
    allocationCount: allocated.length,
    ...(allocated.length > 0
      ? {
          allocations: allocated
            .map((a) => ({
              scopeKey: a.scopeKey,
              wrapWidth: Math.round(a.wrapWidth),
              allocatedWidthPx: Math.round(a.allocatedWidthPx),
              rowSavings: Math.round(a.rowSavings),
              cardCount: a.cardCount,
            }))
            // §3b — strata pins code-unit ordering; RCLL's `localeCompare` here
            // is ICU-dependent nondeterminism and is NOT ported.
            .sort((a, b) => compareStrataContentKeys(a.scopeKey, b.scopeKey)),
        }
      : {}),
  };
};

const yOverlapsBox = (a: StrataBox, b: StrataBox): boolean =>
  a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * The permitted right edge for `hostId` — a port of `recursiveRightSlackCeiling`
 * (`terraformPipelineRcllAncillaryAllocator.ts:486-519`) onto strata's flat
 * `boxedHulls` + the §3e parent index (RCLL walks a linked tree; strata has none).
 *
 * Walks root → host, shrinking the permitted right edge at each level to the
 * nearest VERTICALLY OVERLAPPING right sibling, floored at `baselineRootRight`.
 *
 * 🔴 ROOT IS A HARD CAP, and in strata it is harder than in RCLL: strata's root
 * width is a function of `rank.columnX`, so growing it would silently redefine
 * the coordinate system every other pass was scored in. The `maxRight - PAD` at
 * each level reserves exactly the one pad `reboundHull` adds per ancestor, so
 * `host.right <= ceiling` inductively implies `root.width` is untouched.
 *
 * Siblings are read from `parent.placed`, which is a superset of RCLL's
 * `parent.children`: it carries direct-leaf clusters as well as child hulls, and
 * a leaf constrains widening exactly as a hull does.
 *
 * `hostHeightOverride` — 🔴 THIS IS THE FIX FOR RCLL'S KNOWN LIVE BUG
 * (`gap-exists-current-algo-missed`, documented at `:36-39`). RCLL measures
 * right-neighbour overlap against the band at its TALL PRE-WIDEN height, so a
 * neighbour that only sits beside the *un-widened* band falsely constrains the
 * ceiling — widening SHORTENS the band, the host's bottom rises, and that
 * neighbour stops overlapping at all. The gap is real, movement-free, and RCLL's
 * greedy never tries it. Callers here pass the host's height AT THE CANDIDATE
 * WIDTH, so the ceiling is measured post-widen and the bug is not inherited.
 *
 * Residual, stated: ANCESTORS are still measured at their current heights. A
 * shorter band shortens them too, so this stays CONSERVATIVE (it can only
 * under-report slack, never over-report it) and can never admit a bad widening.
 * Every grant is validated end-to-end regardless.
 */
const strataRightSlackCeiling = (
  hostId: string,
  m: MutablePlacement,
  parentOf: ReadonlyMap<string, string>,
  baselineRootRight: number,
  hostHeightOverride?: number,
): number => {
  const chain: string[] = [];
  for (
    let id: string | undefined = hostId;
    id !== undefined;
    id = parentOf.get(id)
  ) {
    chain.push(id);
  }
  chain.reverse(); // [root, …, host]

  let maxRight = baselineRootRight;
  for (let i = 1; i < chain.length; i += 1) {
    const parent = m.boxedHulls.get(chain[i - 1]!);
    const node = m.boxedHulls.get(chain[i]!);
    if (!parent || !node) {
      return maxRight;
    }
    const nb =
      chain[i] === hostId && hostHeightOverride !== undefined
        ? { ...node.box, height: hostHeightOverride }
        : node.box;
    let childMaxRight = maxRight - PIPELINE_FRAME_PAD;
    for (const pu of parent.placed) {
      if (pu.unit.kind === "hull" && pu.unit.hullId === chain[i]) {
        continue; // the node itself
      }
      if (pu.box.x >= nb.x + nb.width - 0.5 && yOverlapsBox(pu.box, nb)) {
        childMaxRight = Math.min(childMaxRight, pu.box.x - PIPELINE_FRAME_PAD);
      }
    }
    maxRight = Math.max(nb.x + nb.width, childMaxRight);
  }
  return maxRight;
};

/** Band height at a candidate width — measure-only, same code path as layout. */
const measureBandHeight = (trie: BandGroup, availWidth: number): number =>
  layoutBandContainer(trie, availWidth, 0, "", EMPTY_MEASURE_PLACEMENT, true)
    .height;

/** Unused in measure mode (no frame is emitted); named so that is obvious. */
const EMPTY_MEASURE_PLACEMENT: PipelinePlacement = {
  providerFamily: "",
  accountId: "",
  region: "",
  vpcId: null,
};

/**
 * The DISCRETE set of band widths that could remove height — a port of
 * `stripRowReductionBreakpoints` (`:521-553`) generalised from RCLL's single
 * strip to strata's nested trie.
 *
 * For each contiguous run of cards in EVERY strip in the band, the exact pixel
 * width that run needs (`2*pad + Σwidths + (n-1)*gap`, mirroring
 * `ancillaryStripRows`' wrap test verbatim) — offset by `2*depth*pad`, because a
 * group nested at depth d is laid out at `availWidth - 2*d*pad`
 * (`layoutBandContainer`). Only widths that (a) exceed the current wrap, (b) fit
 * under the slack ceiling, and (c) ACTUALLY remove height survive.
 *
 * Not a continuous search: this is why the allocator is cheap. On P1 the cards are
 * near-uniform (~346px), which collapses the run set to a handful of distinct
 * widths per band.
 */
const bandWidthBreakpoints = (
  trie: BandGroup,
  currentWrapWidth: number,
  ceilingWrapWidth: number,
): { wrapWidth: number; rowSavings: number }[] => {
  const pad = PIPELINE_FRAME_PAD;
  const gap = PIPELINE_CLUSTER_GAP_Y;
  const widths = new Set<number>();

  const walk = (group: BandGroup, depth: number): void => {
    if (group.strip) {
      const cards = group.strip.cards;
      for (let start = 0; start < cards.length; start += 1) {
        let rowWidth = 2 * pad;
        for (let end = start; end < cards.length; end += 1) {
          rowWidth += cards[end]!.build.width;
          if (end > start) {
            rowWidth += gap;
          }
          const w = Math.ceil(rowWidth + 2 * depth * pad);
          if (w > currentWrapWidth + 0.5 && w <= ceilingWrapWidth + 0.5) {
            widths.add(w);
          }
        }
      }
    }
    for (const child of group.children) {
      walk(child, depth + 1);
    }
  };
  walk(trie, 0);

  const baselineHeight = measureBandHeight(trie, currentWrapWidth);
  return [...widths]
    .sort((a, b) => a - b)
    .map((wrapWidth) => ({
      wrapWidth,
      rowSavings: baselineHeight - measureBandHeight(trie, wrapWidth),
    }))
    .filter((c) => c.rowSavings > 0.5);
};

/**
 * Why a candidate injection is inadmissible — strata's `classifyAncillaryCandidate`
 * (`:392-426`). RCLL's real contribution here is the ASSUMPTION that some
 * injections must be REJECTED, and that is what survives the port; the rules
 * themselves are strata's.
 *
 * ⚠️ THE PLAN SAYS to reuse "the baseline's existing `checkStrataAncillaryNoMovement`
 * + `checkStrataAncillaryContainment`". `checkStrataAncillaryNoMovement` DOES NOT
 * EXIST — the baseline never shipped it; the no-movement contract lives only as
 * assertions inside the unit test. So the containment half is reused verbatim as
 * instructed, and the no-movement half is written here (once), against the same
 * contract the test asserts.
 *
 * The rules, in the order RCLL checks them so a cause can be named:
 *  - `"root"`    — root width changed. The hard cap; see `strataRightSlackCeiling`.
 *  - `"primary"` — a LEAF (a primary dataflow cluster) moved in x, changed size,
 *                  or moved UP. Leaves are the dataflow; they are frozen.
 *  - `"overlap"` — containment (§3g) or strata's own R2 structural check failed.
 *
 * 🔴 NOTE WHAT IS *NOT* HERE: "hull x/width identical". The plan's unit-test
 * contract lists it, and it is INCOMPATIBLE WITH §3o BY CONSTRUCTION — a band may
 * only widen into slack by widening its host, so under that rule the allocator
 * could never allocate anything and the port would be a guaranteed no-op. RCLL's
 * own contract (`:400-421`) caps the ROOT and freezes PRIMARY CLUSTERS; it
 * deliberately permits interior hulls to widen. Hull `x` is still never written
 * anywhere in this module.
 */
type StrataAncillaryCandidateFailure = "ok" | "root" | "primary" | "overlap";

const classifyStrataAncillaryCandidate = (
  candidate: StrataAncillaryInjection,
  basePlacement: StrataPlacementResult,
  model: StrataModel,
): StrataAncillaryCandidateFailure => {
  const rootId = model.hullRoot.id;
  const baseRoot = basePlacement.boxedHulls.get(rootId);
  const nextRoot = candidate.placement.boxedHulls.get(rootId);
  if (!baseRoot || !nextRoot) {
    return "overlap";
  }
  // Strata's root width is a function of `rank.columnX` and cannot legitimately
  // change — so this is `==`, STRONGER than RCLL's `<=`.
  if (Math.abs(nextRoot.box.width - baseRoot.box.width) > 0.5) {
    return "root";
  }

  if (candidate.placement.leafBoxes.size !== basePlacement.leafBoxes.size) {
    return "primary";
  }
  for (const [id, before] of basePlacement.leafBoxes) {
    const after = candidate.placement.leafBoxes.get(id);
    if (
      !after ||
      Math.abs(after.x - before.x) > 0.5 ||
      Math.abs(after.width - before.width) > 0.5 ||
      Math.abs(after.height - before.height) > 0.5 ||
      after.y + 0.5 < before.y // Y may only grow DOWNWARD
    ) {
      return "primary";
    }
  }

  const containment = checkStrataAncillaryContainment(
    candidate.bands,
    candidate.placement,
    model,
  );
  if (
    containment.bandEscapesHost > 0 ||
    containment.bandOverlaps > 0 ||
    containment.bandTitleCollisions > 0
  ) {
    return "overlap";
  }
  // Widening a hull widens its x-span, which the `dropY` re-settle reads — so a
  // grant can legitimately push a LATER sibling down, and could in principle push
  // one into a neighbour. Strata's own R2 check is the authority on that, and it
  // is free here. (`checkStrataStructure` is MODEL-space; the bands themselves are
  // covered by the containment check above. Both are needed; neither subsumes the
  // other.)
  const structure = checkStrataStructure(candidate.placement, model);
  return structure.nonAncestorOverlaps === 0 &&
    structure.titleCollisions === 0 &&
    structure.contiguityViolations === 0
    ? "ok"
    : "overlap";
};

const wrapMapOf = (
  allocations: readonly StrataAncillaryAllocation[],
): Map<string, number> =>
  new Map(allocations.map((a) => [a.scopeKey, a.wrapWidth]));

/**
 * The greedy loop (`:585-692`). Repeatedly take the GLOBALLY best candidate across
 * all hosts, re-inject at the new wrap map, validate, and on the first failure
 * roll back that host and stop.
 *
 * Tie-break: `rowSavings` → larger `cardCount` → `compareStrataContentKeys`.
 * RCLL's third key is `localeCompare` (`:637-647`); strata pins code-unit
 * ordering (§3b) and that swap is the whole determinism story here — the rest of
 * RCLL's chain is deterministic by construction and is preserved.
 */
export function allocateStrataAncillarySlack(args: {
  model: StrataModel;
  placement: StrataPlacementResult;
  strips: readonly AncillaryStrip[];
}): {
  allocations: StrataAncillaryAllocation[];
  meta: StrataAncillaryAllocatorMeta;
} {
  const { model, placement, strips } = args;
  const pad = PIPELINE_FRAME_PAD;
  const rootId = model.hullRoot.id;
  const baseRoot = placement.boxedHulls.get(rootId);
  if (!baseRoot || strips.length === 0) {
    return {
      allocations: [],
      meta: { ...EMPTY_STRATA_ANCILLARY_ALLOCATOR_META },
    };
  }
  const baselineRootRight = baseRoot.box.x + baseRoot.box.width;
  const { parentOf, nodeOf } = buildParentIndex(model.hullRoot);
  const { hostIds, byHost } = planStrataAncillaryHosts(
    model,
    placement,
    strips,
  );

  // Per-host invariants, computed ONCE off the pre-ancillary placement: the
  // baseline wrap and the trie never depend on what the allocator grants.
  type HostPlan = {
    hostId: string;
    trie: BandGroup;
    baselineWrapWidth: number;
    hostX: number;
    cardCount: number;
  };
  const plans: HostPlan[] = [];
  for (const hostId of hostIds) {
    const host = placement.boxedHulls.get(hostId);
    const hostNode = nodeOf.get(hostId);
    if (!host || !hostNode) {
      continue;
    }
    const hostStrips = byHost.get(hostId)!;
    plans.push({
      hostId,
      trie: buildBandTrie(hostNode.path, hostStrips),
      baselineWrapWidth: Math.max(host.box.width - 2 * pad, 0),
      hostX: host.box.x,
      cardCount: hostStrips.reduce((t, s) => t + s.cards.length, 0),
    });
  }

  let accepted: StrataAncillaryAllocation[] = [];
  // Always re-inject from the PRE-ANCILLARY placement, never incrementally from
  // the last simulation — growth is a pure function of the wrap map, and
  // re-deriving it keeps a rejected candidate from leaving residue behind.
  let simulated = injectStrataAncillaryBands({ model, placement, strips });

  for (;;) {
    const currentWraps = wrapMapOf(accepted);
    let best: (StrataAncillaryAllocation & { benefit: number }) | null = null;

    for (const plan of plans) {
      const host = simulated.placement.boxedHulls.get(plan.hostId);
      if (!host) {
        continue;
      }
      const currentWrapWidth =
        currentWraps.get(plan.hostId) ?? plan.baselineWrapWidth;
      const currentBandHeight = measureBandHeight(plan.trie, currentWrapWidth);

      // The ceiling is measured with the host at the height it would have AT THE
      // CANDIDATE WIDTH — see `strataRightSlackCeiling`'s note on RCLL's bug. The
      // widest candidate is the most permissive, so probe the ceiling with the
      // SHORTEST band the breakpoints could produce, then re-check each candidate
      // against its OWN post-widen ceiling below.
      // Reads the loop-scoped frozen `simulated` snapshot by design; consumed
      // synchronously in this iteration.
      // eslint-disable-next-line no-loop-func
      const probeCeiling = (bandHeight: number): number => {
        const ceilingRight = strataRightSlackCeiling(
          plan.hostId,
          // `simulated.placement` is frozen; the ceiling only reads boxes.
          simulated.placement as unknown as MutablePlacement,
          parentOf,
          baselineRootRight,
          host.box.height - currentBandHeight + bandHeight,
        );
        // The band sits at `host.x + pad` and the host must still contain it with
        // a pad on the right ⇒ `availWidth <= ceilingRight - host.x - 2*pad`.
        return ceilingRight - plan.hostX - 2 * pad;
      };

      const optimisticCeiling = probeCeiling(0);
      for (const candidate of bandWidthBreakpoints(
        plan.trie,
        currentWrapWidth,
        optimisticCeiling,
      )) {
        // Re-check against the ceiling this candidate's OWN height permits.
        const candidateHeight = currentBandHeight - candidate.rowSavings;
        if (candidate.wrapWidth > probeCeiling(candidateHeight) + 0.5) {
          continue;
        }
        const next: StrataAncillaryAllocation & { benefit: number } = {
          scopeKey: plan.hostId,
          baselineWrapWidth: plan.baselineWrapWidth,
          wrapWidth: candidate.wrapWidth,
          allocatedWidthPx: candidate.wrapWidth - plan.baselineWrapWidth,
          rowSavings: candidate.rowSavings,
          cardCount: plan.cardCount,
          benefit: candidate.rowSavings,
        };
        if (
          !best ||
          next.benefit > best.benefit + 0.5 ||
          (Math.abs(next.benefit - best.benefit) <= 0.5 &&
            (next.cardCount > best.cardCount ||
              (next.cardCount === best.cardCount &&
                compareStrataContentKeys(next.scopeKey, best.scopeKey) < 0)))
        ) {
          best = next;
        }
      }
    }

    if (!best) {
      break;
    }
    const winner = best;
    const nextAccepted = [
      ...accepted.filter((a) => a.scopeKey !== winner.scopeKey),
      {
        scopeKey: winner.scopeKey,
        baselineWrapWidth: winner.baselineWrapWidth,
        wrapWidth: winner.wrapWidth,
        allocatedWidthPx: winner.allocatedWidthPx,
        rowSavings: winner.rowSavings,
        cardCount: winner.cardCount,
      },
    ].sort((a, b) => compareStrataContentKeys(a.scopeKey, b.scopeKey));

    const candidate = injectStrataAncillaryBands({
      model,
      placement,
      strips,
      wrapWidthByHostId: wrapMapOf(nextAccepted),
    });
    if (
      classifyStrataAncillaryCandidate(candidate, placement, model) !== "ok"
    ) {
      // Roll back THIS host and stop (RCLL's rule verbatim).
      break;
    }
    accepted = nextAccepted;
    simulated = candidate;
  }
  return {
    allocations: accepted,
    meta: allocatorMetaFromAllocations(accepted, 0),
  };
}

/**
 * `buildValidatedAncillaryInsertion` (`:903-1014`) — plan the allocation, then
 * RE-VALIDATE the live insertion. On failure drop the LOWEST-BENEFIT allocation
 * one at a time (`:1006-1012`), incrementing `fallbackDropCount`, until it
 * validates or reaches zero — then inject at the §3f BASELINE wrap, which ALWAYS
 * applies.
 *
 * This is why the host-interior baseline was built first and is never throwaway
 * work: it is the terminal fallback, exactly as RCLL's own is.
 *
 * `diagnoseRcllAncillaryBands` (`:727+`) is deliberately NOT ported (plan §3o.6):
 * read-only, does not affect allocation, off the critical path.
 */
export function buildValidatedStrataAncillaryInsertion(args: {
  model: StrataModel;
  placement: StrataPlacementResult;
  strips: readonly AncillaryStrip[];
}): StrataAncillaryInjection & { allocatorMeta: StrataAncillaryAllocatorMeta } {
  const { model, placement, strips } = args;
  const planned = allocateStrataAncillarySlack({ model, placement, strips });
  let allocations = [...planned.allocations];
  let fallbackDropCount = 0;

  for (;;) {
    const injected = injectStrataAncillaryBands({
      model,
      placement,
      strips,
      wrapWidthByHostId: wrapMapOf(allocations),
    });
    if (
      allocations.length === 0 ||
      classifyStrataAncillaryCandidate(injected, placement, model) === "ok"
    ) {
      // At zero allocations this IS the baseline injection (§3f) — the wrap map is
      // empty, so every band wraps at its host's interior. It always applies, and
      // the caller's own containment gate remains the final word on it.
      return {
        ...injected,
        allocatorMeta: allocatorMetaFromAllocations(
          allocations,
          fallbackDropCount,
        ),
      };
    }
    allocations = allocations
      .sort(
        (a, b) =>
          a.rowSavings - b.rowSavings ||
          compareStrataContentKeys(a.scopeKey, b.scopeKey),
      )
      .slice(1);
    fallbackDropCount += 1;
  }
}
