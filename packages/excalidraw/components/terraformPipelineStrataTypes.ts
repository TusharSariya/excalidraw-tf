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

/** Engine options, threaded from S0a plumbing (all opt-in, default off). */
export type StrataEngineOptions = {
  compact: boolean;
  /**
   * NOT consumed in M1 (ancillary strips port at M3) — when requested, the
   * scene meta echoes `strataAncillaryDeferred: true` (honest-meta pattern,
   * SDEC-26/SDEC-29); never silently ignored.
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
