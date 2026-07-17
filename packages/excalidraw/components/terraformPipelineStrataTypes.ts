/**
 * Strata engine — internal contract (rcll-v2 spec).
 *
 * Normative sources: docs/rcll-v2-spec-v2.md §6 (algorithms), amended by
 * docs/rcll-v2-spec-v3.md and docs/rcll-v2-spec-v3.1.md (later wins).
 * Implementation companion: docs/strata-view-implementation-flow.md §3.
 *
 * Every engine phase (A3 → A1 → A0+A2 → A7 → A6) codes against these shapes.
 * Two deliberate departures from the shared prep types:
 *  - Strata edges carry NO `sequence` field (C4′: no file-position ordering
 *    anywhere in the engine; the pinned content comparator is the only order).
 *  - The engine computes its own ranks over E′ (prep depths are pre-A3).
 */
import type { PipelineCluster } from "./terraformPipelineLayoutShared";
import type { DeBandLevel } from "./terraformPipelineLayoutProfiles";

/** Engine options, threaded from S0a plumbing (all opt-in, default off). */
export type StrataEngineOptions = {
  compact: boolean;
  /**
   * "All resources": hydrate non-TFD resources as per-scope "Unconnected" bands.
   *
   * Consumed POST-LAYOUT (terraformPipelineStrataAncillary.ts), never in-model:
   * the engine runs on a model with no ancillary in it and bands are injected
   * into the finished placement. That routes around all three SDEC-29 blockers
   * (rank pile-up, the global `columnWidths`, the closed `StrataUnit` union),
   * each of which blocks an IN-MODEL port only.
   */
  includeAncillary: boolean;
  /** OD-1: network-simplex rank refinement behind the pure gate (A/B arm). */
  networkSimplexRank: boolean;
  /**
   * OD-14 (post-M1 height lever, DEC-12 class): whole-model sibling-separation
   * ranking (the Strata port of v1 `rankSeparate`). REPLACES the A1 rank when
   * live — mutually exclusive with `networkSimplexRank` (rankSeparate wins;
   * enforced at the S0a option surface, mirrored as a backstop in
   * `rankStrataClusters`). Default off; optional so existing option literals
   * (flag-OFF byte-identity) are unaffected.
   */
  rankSeparate?: boolean;
  /** OD-2: A2 sweep count K. M1a ships 0 (pure model order); M1b default 4. */
  sweeps: number;
  /** SA7: A7 coordinate refinement (M1b, flag-gated). */
  coordinateRefine: boolean;
  /**
   * Round 9 (SDEC-57, default off): whole-layout candidate-set scoring for
   * PACKED-hull ordering. Replaces the per-sweep strict-local-crossings
   * acceptance (structurally blind — R9-F1) with trial placement of every
   * sweep snapshot on the real skyline, scored lexicographically on real
   * leaf-level geometry (global crossings, unrelated edge–box penetrations,
   * integer L1 edge length). Banded hulls unaffected. Optional so existing
   * option literals (flag-OFF byte-identity) are unaffected.
   */
  packedScoring?: boolean;
  /**
   * W8b (SDEC-59 follow-up, default 0 = strict rule, bit-identical to round
   * 9): epsilon-constraint crossings budget for the packed-scoring descent. A
   * trial within `baseline crossings + delta` may also be adopted when it
   * strictly improves (penetrations, lengthL1); delta = epsilon when >= 1,
   * else ceil(epsilon * baseline crossings) (relative mode). Anti-ratchet:
   * the budget is global vs the LEGACY baseline, never the rolling incumbent.
   * Consumed only when `packedScoring` is on. Optional so existing option
   * literals (flag-OFF byte-identity) are unaffected.
   */
  packedScoringEpsilon?: number;
  /**
   * Band-depth slider (generalizes `STRATA_HULL_POLICY` + the legacy
   * `bandCompact` boolean into one monotone cut): the deepest role still
   * resolved as "banded" via `resolveStrataHullPolicy`. Every consumer
   * (model, placement, ordering, coord-refine) reads the resolved
   * `hull.policy` — a packed level is packed for EVERYTHING, exactly like
   * region/vpc/subnet. Default `"account"` when absent — byte-identical to
   * today's fixed map. Root is pinned banded (v3.1 §1.4), so `"root"` is the
   * leftmost legal stop (provider/account become packed there — the old
   * `bandCompact=true` behavior, now generalized). Optional so existing
   * option literals (flag-OFF byte-identity) are unaffected.
   */
  strataBandDepth?: StrataHullRole;
  /**
   * OD-15 crossings-≻-length relocate (default off, opt-in). Master flag for
   * the cross-hull-aware sift + post-A7 vertical-slot relocation that reaches
   * placements barycenter/candidate generation can't: a resource whose only
   * edge LEAVES its hull (never proposed for a move today), and an X-disjoint
   * hull that wants vertical slack (no sequence permutation moves it). When
   * off, the engine is byte-identical. Consumed by the packed descent
   * (external-incidence sift candidates) and the new post-A7 relocation pass;
   * both score real leaf geometry with the weighted objective below. Optional
   * so existing option literals (flag-OFF byte-identity) are unaffected.
   */
  strataSiftRelocate?: boolean;
  /**
   * Weight on hull-penetrations in the relocate objective's combined crossing
   * score `C = penW·penetrations + crossW·edgeEdgeCrossings` (owner priority:
   * hull crossings ≻ edge length). Integer/fixed-point — the comparator must
   * never do float equality. Default 1. Consumed only when `strataSiftRelocate`
   * is on. Optional so existing option literals are unaffected.
   */
  strataCrossWeightPenetration?: number;
  /** Weight on edge-edge crossings in `C` (see `strataCrossWeightPenetration`).
   * Integer/fixed-point. Default 1. Consumed only when `strataSiftRelocate` is
   * on. Optional so existing option literals are unaffected. */
  strataCrossWeightEdge?: number;
  /**
   * Hard cap on edge-edge crossing REGRESSION for the relocate objective (the
   * second of two owner guardrails; the weighted `C` selects, this cap bounds
   * edge-edge blow-up): a candidate whose raw edge-edge crossings exceed
   * `baseline + strataEdgeCrossCap` is rejected regardless of its weighted
   * `C`/length win. Absent ⇒ inherit `packedScoringEpsilon`. Consumed only when
   * `strataSiftRelocate` is on. Optional so existing option literals are
   * unaffected.
   */
  strataEdgeCrossCap?: number;
  /**
   * G-DESCENT remedy (default off, opt-in): the packed-scoring descent returns
   * the BEST-SEEN ADOPTED snapshot under the active comparator (with that
   * snapshot's own selection map + placement + score) instead of the rolling
   * incumbent. Inert at ε=0 (strict adoption is monotone — incumbent IS the
   * best-seen); only ε-band adoption (`packedScoringEpsilon` > 0) can displace
   * a comparator-better incumbent (the diagnosed hold-then-drop). Consumed only
   * when `packedScoring` is on. Optional so existing option literals (flag-OFF
   * byte-identity) are unaffected.
   */
  packedConverge?: boolean;
  /**
   * P0.2 adoption-relation repair (default off, opt-in): replace the packed
   * descent's ε adoption GATE (strict-lex OR ε-band — a non-transitive,
   * non-antisymmetric relation that can authorize both A→B and B→A from
   * different baselines; see the scoring module header's oscillation note)
   * with a TRANSITIVE strict total order. A trial is ELIGIBLE iff its raw
   * edge-edge crossings are within the legacy-baseline crossing budget
   * (`baseline + delta`, delta from `packedScoringEpsilon` — the ε survives
   * as a FEASIBILITY constraint, unchanged cap semantics), and adoption is
   * arg-min under the integer lexicographic key
   * `(weightedC, lengthL1, crossings, penetrations)` (weights from
   * `strataCrossWeightPenetration`/`strataCrossWeightEdge`, default 1/1;
   * exact ties keep the EARLIEST — the canonical Strata tiebreak). Adoption
   * becomes strictly monotone, so the hold-then-drop non-convergence that
   * `packedConverge` papers over cannot occur (best-seen ≡ final). Consumed
   * only when `packedScoring` is on. Optional so existing option literals
   * (flag-OFF byte-identity) are unaffected.
   */
  transitiveAdopt?: boolean;
  /**
   * P4 pure-sink account block clamp (`strataBlockClamp`, default off, opt-in):
   * a post-A7 pass that rigid-translates a whole DEAD-END account subtree LEFT
   * to `max(external source rank) + 1`. Consumes the same weighted-C/ε machinery (penW/crossW/ε/cap through
   * `strataRelocateAdoptable`) plus X-containment, R2, and an explicit height
   * gate. Never re-ranks (the -42% height lever is preserved) and never runs
   * grid X-compaction — a single rigid per-block pixel translate onto one
   * existing on-grid left column. Optional so existing option literals (flag-OFF
   * byte-identity) are unaffected.
   */
  strataBlockClamp?: boolean;
  /**
   * P2 within-column transpose (`strataTranspose`, default off, opt-in): a
   * post-A7 pass that swaps Y-adjacent X-column-OVERLAPPING sibling pairs inside
   * one hull (the complementary operator to the X-DISJOINT vertical-relocate) to
   * remove diagonal crossings the barycenter sweeps leave in fan-in columns. The
   * adjacent exchange is ENVELOPE-PRESERVING — the pair's union span is unchanged
   * so hull height is invariant; never re-ranks (the -42% height lever is
   * preserved) and never changes X (no grid X-compaction). Consumes the same
   * weighted-C/ε machinery (penW/crossW/ε/cap through `strataRelocateAdoptable`)
   * as the relocate passes, scored on real leaf geometry. Optional so existing
   * option literals (flag-OFF byte-identity) are unaffected.
   */
  strataTranspose?: boolean;
  /**
   * P5 / Lever C height gate (`strataHeightGate`, default off, opt-in): applies
   * the per-hull implied-height maintain-or-decrease referee
   * (`strataHeightGateAdmits`) as a conjunct on every adoption in
   * `refineStrataBlockClamp`. A pure boolean
   * PRECONDITION — height never enters the packed objective ({crossings,
   * penetrations, lengthL1}), never trades, and is never a tiebreak. Compared
   * against the rolling incumbent, so per-hull height is non-increasing by
   * induction ⇒ it provably cannot regress rankSeparate's -42% height win.
   *
   * HONEST STATUS: provably inert for the block clamp (a rigid X-only translate
   * moves no Y, so no implied height can change).
   *
   * It unlocks nothing on its own: nothing currently proposes height-growing
   * candidates, and the phase-2 occupant-displacement + VPSC relaxation it exists
   * to referee is NOT BUILT. It ships as groundwork, and it repairs the vacuous
   * scene-global height check the block clamp shipped with. Optional so existing
   * option literals (flag-OFF byte-identity) are unaffected.
   */
  strataHeightGate?: boolean;
  /**
   * A01 leaf X-shift (`strataLeafShift`, default off, opt-in): a post-A7 pass
   * (after `strataBlockClamp`, before ancillary) that pulls degree-1 pure-sink
   * LEAVES left onto an existing grid column between their single source and their
   * current rank, re-drops their Y within the owning hull via `dropY`, and grows
   * (never shrinks) the leaf's ancestor hull chain to contain the new bottom. It
   * NEVER re-ranks (colSpan/rank untouched — the -42% height lever is preserved).
   *
   * Gate stack (cheap→expensive): X-containment → GLOBALLY-BOUNDED slack per-hull
   * height gate (`strataHeightGateAdmitsWithinBaseline`, budget max(absPx,
   * relFrac·h) vs the FIXED pass-baseline ceiling so total per-hull growth over the
   * pass cannot exceed one slack allowance) → R2 `checkStrataStructure` all-zero →
   * `strataRelocateAdoptable` / `transitiveAdopt` (same weighted-C/ε/cap machinery
   * as the relocate passes — ε/weights/cap now forwarded when leaf-shift is the
   * sole relocate operator).
   *
   * MANDATORY right-edge guard (a05 F10 / e7ae739f0): region-level loose sinks
   * whose box right edge is within `strataLeafShiftRightEdgeGuardPx` of their
   * parent region hull's content right edge are EXCLUDED as candidates — pulling
   * them off the right edge dissolves the emergent right-edge column the owner
   * wants, and the unguarded sink-pull was owner-removed. Optional so existing
   * option literals (flag-OFF byte-identity) are unaffected.
   */
  strataLeafShift?: boolean;
  /** A01 slack height gate absolute budget in px (default 150 — admits the
   * measured +115px C2 DLQ pull). Consumed only when `strataLeafShift` is on. */
  strataLeafShiftHeightBudgetPx?: number;
  /** A01 slack height gate relative budget as a fraction of the incumbent hull's
   * implied height (default 0.01). The effective slack is `max(absPx, relFrac·h)`.
   * Consumed only when `strataLeafShift` is on. */
  strataLeafShiftHeightBudgetFrac?: number;
  /** A01 max number of target ranks tried per leaf, nearest-to-source first
   * (default 8 — bounds the R2/scorer cost per candidate leaf). Consumed only when
   * `strataLeafShift` is on. */
  strataLeafShiftRankBudget?: number;
  /** A01 right-edge column guard (a05 F10): a region-level loose sink whose box
   * right edge is within this many px of its parent region hull's content right
   * edge is NOT a candidate (default 300 — the owner's protected us-west-2 column
   * measured distFromRight=250). Consumed only when `strataLeafShift` is on. */
  strataLeafShiftRightEdgeGuardPx?: number;
  /**
   * OD-15 de-band port (`strataDeBandLevel`, default `"none"`, opt-in): the v1
   * hierarchy ladder, ported into Strata's STRUCTURE phase. Dissolving level L
   * (and every deeper level) is expressed ENTIRELY as topology-path truncation
   * at model build — `topologyPathForCluster(cluster, level)` — so the dissolved
   * hulls are never created, their frames are never emitted (Strata emits frames
   * off the model tree, unlike v1 which needed a separate suppression pass), and
   * every leaf lands directly in the absorbing parent's `leafClusterIds`. That
   * reproduces v1's `collapseTreeForDeBand` exactly, at the one site that runs
   * BEFORE rank/ordering/placement — so every downstream pass re-runs over the
   * collapsed model for free.
   *
   * COUPLED TO `strataBandDepth`, and the coupling is load-bearing: lifting N
   * leaves into a still-BANDED absorbing parent makes each its own band-row
   * (see the band-row invariant below) ⇒ one vertical stack ⇒ a catastrophic
   * height REGRESSION, the exact opposite of the lever's purpose. The S0a option
   * surface therefore SUPPRESSES a de-band whose absorbing parent resolves
   * "banded" under the active cut (`provider` de-band absorbs into the root,
   * which is pinned banded, so it is never legal). Optional so existing option
   * literals (flag-OFF byte-identity) are unaffected; `"none"` also truncates
   * nothing, so the off path is byte-identical by construction, not by guard.
   */
  strataDeBandLevel?: DeBandLevel;
};

/**
 * A collapsed cluster-graph edge, sequence-free. `key` is the canonical
 * engine-invariant identity (true-direction source→target + relKind), also the
 * bootstrap-CI pairing key (v3.1 §2.5).
 */
export type StrataEdge = {
  key: string;
  /** Leaf-cluster ids (true direction as declared, NEVER pre-swapped). */
  source: string;
  target: string;
  relKind: string;
  /** Parallel-edge multiplicity retained as a ranking weight (A3 step 0). */
  multiplicity: number;
};

/** An E′ entry: the edge plus its A3 disposition. */
export type StrataPrimeEdge = {
  edge: StrataEdge;
  /**
   * True iff the edge is in F (A3's feedback set): it participates in
   * ranking/ordering/refinement REVERSED (effective source/target swapped)
   * but is DRAWN in true direction with back-edge styling (C10′).
   */
  reversed: boolean;
};

export type StrataHullRole =
  | "root"
  | "provider"
  | "account"
  | "region"
  | "vpc"
  | "subnetZone";

export type StrataHullPolicy = "banded" | "packed";

/**
 * The M1 hardcoded role→policy map — THE single source of truth (D6′
 * copy-then-parametrize; S10 later replaces it with schema config stamped
 * into frame customData as `terraformHullPolicy`). The T9 diagnostics
 * role→policy map MUST mirror this object, not re-declare it (v3.1 §2.6).
 * root = "banded" is pinned by v3.1 §1.4 (the multi-provider seam).
 */
export const STRATA_HULL_POLICY: Readonly<
  Record<StrataHullRole, StrataHullPolicy>
> = {
  root: "banded",
  provider: "banded",
  account: "banded",
  region: "packed",
  vpc: "packed",
  subnetZone: "packed",
};

/** Depth order of `StrataHullRole`, shallowest (root) to deepest (subnetZone). */
const STRATA_ROLE_DEPTH: Readonly<Record<StrataHullRole, number>> = {
  root: 0,
  provider: 1,
  account: 2,
  region: 3,
  vpc: 4,
  subnetZone: 5,
};

/**
 * Resolve a hull's policy from the monotone band-depth cut `bandDepth`: roles
 * at or above (shallower than or equal to) the cut are "banded", deeper roles
 * are "packed". `resolveStrataHullPolicy(role, "account")` reproduces
 * `STRATA_HULL_POLICY` element-for-element (default cut, byte-identical to
 * today's fixed map — guarded by a dev test).
 */
export const resolveStrataHullPolicy = (
  role: StrataHullRole,
  bandDepth: StrataHullRole,
): StrataHullPolicy =>
  STRATA_ROLE_DEPTH[role] <= STRATA_ROLE_DEPTH[bandDepth] ? "banded" : "packed";

/**
 * De-band absorbing parent (the Strata mirror of v1's `ABSORBING_PARENT_ROLE`,
 * terraformPipelineRcllPlacement.ts): dissolving level L lifts its leaves into
 * the surviving hull one level shallower. Verified against the path-truncation
 * collapse: `subnet` ⇒ `DEBAND_PATH_KEEP` 4 ⇒ path `[provider,account,region,
 * vpc]` ⇒ leaves attach to the vpc hull, exactly v1's absorbing parent for
 * `subnet`.
 */
const STRATA_DEBAND_ABSORBING_ROLE: Readonly<
  Record<Exclude<DeBandLevel, "none">, StrataHullRole>
> = {
  subnet: "vpc",
  vpc: "region",
  region: "account",
  account: "provider",
  provider: "root",
};

/**
 * Is de-banding `level` feasible under the band-depth cut `bandDepth`?
 *
 * De-band lifts leaves into the absorbing parent. If that parent is BANDED the
 * band-row invariant below gives every lifted leaf its own singleton band-row —
 * a single vertical stack of every resource, i.e. a catastrophic height
 * REGRESSION, silently, with no assert firing. So the lever is only legal when
 * the absorbing parent resolves PACKED. `provider` de-band absorbs into the
 * root, which is pinned banded at every cut (v3.1 §1.4), so it is never legal —
 * the top rung is structurally dead and is rejected here rather than shipped as
 * a trap. At the DEFAULT cut ("account") only `subnet` and `vpc` are legal;
 * `region`/`account` need a shallower cut.
 */
export const strataDeBandFeasible = (
  level: DeBandLevel,
  bandDepth: StrataHullRole,
): boolean =>
  level === "none" ||
  resolveStrataHullPolicy(STRATA_DEBAND_ABSORBING_ROLE[level], bandDepth) ===
    "packed";

/**
 * Hull tree node. Band-row invariant (v3.1 §2.2, S0b assert): every child of
 * a banded hull occupies exactly one band-row; a bare leaf child is its own
 * singleton band.
 */
export type StrataHullNode = {
  /** Content-addressed id (topology path derived), stable across runs. */
  id: string;
  role: StrataHullRole;
  policy: StrataHullPolicy;
  /** Topology path segments from root (exclusive) to this hull (inclusive). */
  path: readonly string[];
  children: StrataHullNode[];
  /** Ids of leaf clusters whose DEEPEST hull is this one. */
  leafClusterIds: string[];
};

export type StrataModel = {
  /** Leaf clusters by id (prep-built; skeleton sizes already measured). */
  clusters: ReadonlyMap<string, PipelineCluster>;
  hullRoot: StrataHullNode;
  /** E — deduped collapsed edges (self-loops split out at model build). */
  edges: readonly StrataEdge[];
  /** Self-loops: excluded from ranking/ordering, kept for A6 render. */
  selfLoops: readonly StrataEdge[];
  /** Canonical address for the pinned content comparator (C4′). */
  addressOf: (clusterId: string) => string;
};

/** A3 output (spec v2 §6-A3, exact ELS93 with per-SCC condensation OD-4). */
export type StrataCycleRepairResult = {
  /** Keys of edges in F (the reversed set). T7 pins WHICH arc reverses. */
  feedbackKeys: ReadonlySet<string>;
  /** E′ = (E − F) ∪ reverse(F), as disposition-tagged edges. */
  edgesPrime: readonly StrataPrimeEdge[];
};

/** A1 output (longest-path floor over E′; optional NS refinement, OD-1/C7). */
export type StrataRankResult = {
  rank: ReadonlyMap<string, number>;
  /** Global column left edges from per-column max leaf width + COLUMN_GAP. */
  columnX: readonly number[];
  networkSimplexApplied: boolean;
  nsSkipReason?: "infeasible-fallback" | "cyclic-skip" | "flag-off";
  /**
   * OD-14 observability (the height lever, DEC-12 class). `rankSeparateApplied`
   * is true iff the separated floor REPLACED the A1 rank. On a no-op / fallback
   * the plain floor is kept and `rankSeparateFallback` says why (mirrors
   * `nsSkipReason`). Absent entirely when the flag is off (flag-OFF identity).
   */
  rankSeparateApplied?: boolean;
  rankSeparateFallback?: "no-pairs" | "augmented-cycle" | "infeasible-fallback";
  /** One-way sibling-unit pairs found; leaf clusters whose rank moved. */
  rankSeparatePairCount?: number;
  rankSeparateChangedRankCount?: number;
  /**
   * EXPERIMENTAL W5b probe (round-8 R8-F9): joint constrained-NS refinement of
   * the separated floor. Present only when the probe flag was live (requires a
   * live rankSeparate). `jointNsApplied` true iff the joint floor replaced the
   * sequential separated floor; spans are Σ multiplicity·span over real E′
   * edges before/after (the NS objective).
   */
  jointNsApplied?: boolean;
  jointNsFallback?:
    | "no-separation-pairs"
    | "constraint-violated"
    | "unchanged"
    | "rank-separate-not-applied";
  jointNsRealSpanBefore?: number;
  jointNsRealSpanAfter?: number;
};

/** Axis-aligned box; hull-local during layoutHull, ABSOLUTE after root pass. */
export type StrataBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** A unit of A0/A2 at one hull level: a child hull or a direct leaf. */
export type StrataUnit =
  | { kind: "hull"; hullId: string }
  | { kind: "leaf"; clusterId: string };

export type StrataPlacedUnit = {
  unit: StrataUnit;
  /** Padded box (FRAME_PAD + TITLE_RESERVE included for hulls). */
  box: StrataBox;
  /** [min,max] rank over the unit's leaves. */
  colSpan: readonly [number, number];
};

/** A laid-out hull: A2 sequence (index order) + A0 geometry. */
export type StrataBoxedHull = {
  hull: StrataHullNode;
  box: StrataBox;
  /** In FINAL A2 sequence order — at banded hulls this IS the Y order. */
  placed: readonly StrataPlacedUnit[];
};

/** A0+A2 output over the whole tree, absolute coords (post root pass). */
export type StrataPlacementResult = {
  boxedHulls: ReadonlyMap<string, StrataBoxedHull>;
  /** Leaf cluster id → absolute box (skeleton pre-compensation applied later). */
  leafBoxes: ReadonlyMap<string, StrataBox>;
};

/** Failure-contract meta (v3.0 §8.4 / v3.1 §5) merged into scene meta. */
export type StrataDegradedMeta = {
  stage:
    | "model"
    | "a3"
    | "a1"
    | "a0"
    | "a2"
    | "a7"
    /** Post-A7 ancillary band injection (opt-in; only reachable under
     * `includeAncillary`). A failed band is NOT a failed layout — the engine
     * drops the bands and keeps the strata scene rather than degrading to v2. */
    | "ancillary"
    | "finalize"
    | "scene-build"
    | "structural-check";
  reason: string;
};

/**
 * Pinned content comparator (C4′): code-unit `<`/`>` on canonical addresses.
 * NEVER bare localeCompare; NEVER file-position/sequence.
 */
export const compareStrataContentKeys = (a: string, b: string): number =>
  a === b ? 0 : a < b ? -1 : 1;
