import type { ExcalidrawElement } from "@excalidraw/element/types";

import { buildTerraformPipelineV2ExcalidrawScene } from "./terraformPipelineLayoutV2";
import { preparePipelineLayout } from "./terraformPipelineLayoutShared";
import { clusterFrameLocalRect } from "./terraformPipelineV2Pack";
import { buildStrataModel } from "./terraformPipelineStrataModel";
import { repairStrataCycles } from "./terraformPipelineStrataCycleRepair";
import { rankStrataClusters } from "./terraformPipelineStrataRank";
import {
  checkStrataStructure,
  placeStrataHulls,
} from "./terraformPipelineStrataPlacement";
import {
  chooseStrataRefinedPlacement,
  placeStrataHullsPackedScored,
} from "./terraformPipelineStrataPackedScoring";
import { refineStrataCoordinates } from "./terraformPipelineStrataCoordRefine";
import { refineStrataVerticalSlots } from "./terraformPipelineStrataVerticalRelocate";
import { transposeStrataColumns } from "./terraformPipelineStrataTranspose";
import { refineStrataBlockClamp } from "./terraformPipelineStrataBlockClamp";
import { buildStrataScene } from "./terraformPipelineStrataSceneBuild";
import {
  buildAncillaryStrips,
  countAncillaryCards,
} from "./terraformPipelineLayoutAncillary";
import {
  buildValidatedStrataAncillaryInsertion,
  checkStrataAncillaryContainment,
  injectStrataAncillaryBands,
  type StrataAncillaryBand,
} from "./terraformPipelineStrataAncillary";
import { strataDeBandFeasible } from "./terraformPipelineStrataTypes";
import {
  isTerraformImportProfilerEnabled,
  terraformImportProfilerRecord,
} from "./terraformImportProfiler";

import type { DeBandLevel } from "./terraformPipelineLayoutProfiles";
import type { StrataPackedTrialRecord } from "./terraformPipelineStrataPackedScoring";
import type {
  StrataDegradedMeta,
  StrataHullRole,
} from "./terraformPipelineStrataTypes";
import type { TerraformPlanNodesMap } from "./terraformPlanParsing";
import type { TerraformImportWarning } from "./terraformImportMerge";

export type TerraformStrataSceneOptions = {
  compact?: boolean;
  includeAncillary?: boolean;
  /** Opt-in (default off): private VPC-endpoint-bound REST APIs placed at region level. */
  pipelinePrivateApiRegional?: boolean;
  /** OD-1 (M1b): X-axis network-simplex rank refinement (A1). Threaded at S0a;
   * consumed by `rankStrataClusters`. Default off. */
  strataNetworkSimplexRank?: boolean;
  /**
   * OD-14 (post-M1 height lever, DEC-12 class): whole-model sibling-separation
   * ranking — the Strata port of v1 `rankSeparate`. Threaded at S0a; consumed by
   * `rankStrataClusters`, where the separated floor REPLACES the A1 rank. It
   * CANNOT compose with the network-simplex ranker (both rewrite the column
   * axis); when both are requested `strataRankSeparate` WINS and NS is dropped,
   * surfaced in meta as `strataToggleSuppressions` (the same conflict signal the
   * v1 `terraformPipelineToggleGuards` emits). Default off.
   */
  strataRankSeparate?: boolean;
  /**
   * EXPERIMENTAL W5b probe (round-8 R8-F9, default off; harness-only, no UI):
   * joint constrained-NS refinement of the separated floor — one simplex solve
   * over (real E′ ∪ zero-weight separation edges). Requires a live
   * `strataRankSeparate`; inert otherwise (observable via meta).
   */
  strataJointNsRank?: boolean;
  /** OD-2 (M1b): directional sweep count for the A2 ordering pass. Threaded at
   * S0a; consumed by `placeStrataHulls`. Default 0 (M1a "model-order bands"). */
  strataSweeps?: number;
  /**
   * Round 9 (SDEC-57, default off): whole-layout candidate-set scoring for
   * PACKED-hull ordering — replaces the blind per-sweep local-crossings
   * acceptance (R9-F1) with trial placement of every sweep snapshot on the
   * real skyline, scored on real leaf-level geometry (global crossings →
   * edge–box penetrations → integer L1 length, lexicographic, earliest tie
   * wins). Banded hulls unchanged. Consumed at the A0 stage via
   * `placeStrataHullsPackedScored`.
   */
  strataPackedScoring?: boolean;
  /**
   * W8b (SDEC-59 follow-up, default 0 = the round-9 strict rule, bit-for-bit):
   * ε-constraint crossings budget for the packed-scoring descent AND its
   * post-A7 never-worse guard. delta = epsilon when >= 1 (absolute integer
   * crossings), else ceil(epsilon × baseline crossings) when 0 < epsilon < 1
   * (relative mode); the budget is GLOBAL vs the legacy baseline
   * (anti-ratchet). Inert unless `strataPackedScoring` is on.
   */
  strataPackedScoringEpsilon?: number;
  /**
   * W8b frontier instrumentation (report-only dev seam, harness-only — no UI/
   * session/URL surface): when on WITH `strataPackedScoring`, every descent
   * trial's {hullId, candidateIndex, pass, score, adopted} is echoed in scene
   * meta as `strataPackedScoringFrontierTrials`. Zero behavior change; off ⇒
   * no collector ⇒ byte-identical work.
   */
  strataPackedFrontierMeta?: boolean;
  /**
   * W10 Stage 2 (SDEC-62/OD-15 re-scoped, default off): order-constrained
   * row-share at the banded provider/account levels. A0 places banded
   * NON-ROOT hulls' children with the packed dropY skyline over ACTUAL
   * x-extents in canonical A2 order (gap semantics verbatim, owner D1:
   * hull-adjacent = LANE, leaf-leaf = CLUSTER — leaf-bearing banded hulls
   * therefore change under this flag even without row-share); root stays a
   * full-width stack (v3.1 §1.4). A7's overlap constraint + min-gap follow
   * the same resolution. LEGACY ALIAS: this is now a shorthand for
   * `strataBandDepth: "root"` — folded in below (explicit `strataBandDepth`
   * always wins). Kept for old session/URL links. Meta:
   * `strataBandCompactRequested` (option echo, rides the fallback too).
   * Primarily effective with `strataRankSeparate`.
   */
  strataBandCompact?: boolean;
  /**
   * Band-depth slider (SDEC — generalizes `STRATA_HULL_POLICY` + the legacy
   * `strataBandCompact` boolean into one monotone cut): the deepest role still
   * banded. Default `"account"` when absent — byte-identical to today's fixed
   * map. `"root"` is the leftmost legal stop (provider/account become packed —
   * the old `strataBandCompact=true` behavior, now generalized so ordering +
   * packed-scoring eligibility follow the resolved policy too). Threaded into
   * `engineOptions.strataBandDepth` only when non-default (byte-identity).
   */
  strataBandDepth?: StrataHullRole;
  /**
   * OD-15 crossings-≻-length relocate (default off, opt-in). Master flag for
   * the cross-hull-aware sift + post-A7 vertical-slot relocation. When on WITH
   * `strataPackedScoring`, the packed descent scores the widened
   * (external-incidence) candidate set with the weighted objective + hard cap,
   * and (independently of packed scoring) a post-A7
   * `refineStrataVerticalSlots` pass runs before scene build. When off, the
   * engine is byte-identical. Threaded into `engineOptions.strataSiftRelocate`.
   */
  strataSiftRelocate?: boolean;
  /**
   * OD-15 weight on hull-penetrations in the relocate objective's combined
   * crossing score `C = penW·penetrations + crossW·edgeEdgeCrossings` (owner
   * priority hull-crossings ≻ edge-length). Integer/fixed-point. Default 1.
   * Inert unless `strataSiftRelocate` is on. Threaded only when non-default.
   */
  strataCrossWeightPenetration?: number;
  /**
   * OD-15 weight on edge-edge crossings in `C`. Integer/fixed-point. Default 1.
   * Inert unless `strataSiftRelocate` is on. Threaded only when non-default.
   */
  strataCrossWeightEdge?: number;
  /**
   * OD-15 hard cap on edge-edge crossing REGRESSION (second owner guardrail): a
   * relocate candidate whose RAW edge-edge crossings exceed
   * `baseline + strataEdgeCrossCap` is rejected regardless of its weighted
   * `C`/length win. Absent ⇒ inherit `strataPackedScoringEpsilon`. Inert unless
   * `strataSiftRelocate` is on. Threaded only when provided.
   */
  strataEdgeCrossCap?: number;
  /**
   * G-DESCENT remedy (default off, opt-in): the packed-scoring descent returns
   * the best-seen ADOPTED snapshot under the active comparator instead of the
   * rolling incumbent. Inert at ε=0 (strict adoption is monotone). Threaded
   * into `engineOptions.packedConverge` only when on (byte-identity).
   */
  strataPackedConverge?: boolean;
  /**
   * P0.2 adoption-relation repair (default off, opt-in): replace the packed
   * descent's non-transitive ε adoption GATE with a transitive strict total
   * order — ε survives as a feasibility crossing cap, adoption is arg-min
   * under the integer key (weightedC, lengthL1, crossings, penetrations).
   * Threaded into `engineOptions.transitiveAdopt` only when on
   * (byte-identity). Makes `strataPackedConverge` inert (best-seen ≡ final).
   */
  strataTransitiveAdopt?: boolean;
  /**
   * P4 pure-sink account block clamp (default off, opt-in): a post-A7 pass that
   * rigid-translates a whole dead-end account subtree left toward the resources
   * it depends on (the multi-source generalization of the leaf-sink pull-in).
   * Never re-ranks; Y/height untouched. Consumes the same weighted-C/ε machinery
   * as the relocate passes. Threaded into `engineOptions.strataBlockClamp` only
   * when on (byte-identity).
   */
  strataBlockClamp?: boolean;
  /**
   * §3o greedy right-slack allocator for ancillary bands. Default ON; inert
   * unless `includeAncillary` is also on, so flag-off byte-identity is
   * unaffected. Exists as a switch so the probe can measure the allocator
   * against the §3f host-interior baseline it falls back to.
   */
  strataAncillaryAllocator?: boolean;
  /**
   * P2 within-column transpose (default off, opt-in): a post-A7 pass that swaps
   * Y-adjacent X-column-OVERLAPPING sibling pairs (the complementary operator to
   * the X-DISJOINT `strataSiftRelocate` vertical-relocate) to remove the diagonal
   * crossings the barycenter sweeps leave in fan-in columns. Envelope-preserving
   * (adjacent exchange keeps the pair's union span, so hull height is invariant);
   * never re-ranks and never changes X. Reuses the relocate weighted-C/ε
   * machinery (penW/crossW/ε/cap through `strataRelocateAdoptable`) — so those
   * weights ride whenever this OR `strataSiftRelocate` is on. Threaded into
   * `engineOptions.strataTranspose` only when on (byte-identity).
   */
  strataTranspose?: boolean;
  /**
   * P5 / Lever C height gate (default off, opt-in): applies the per-hull
   * implied-height maintain-or-decrease referee as a conjunct on every adoption
   * in the sink-pull-in and block-clamp passes. Height is a GATE only — never a
   * term in the packed objective. INERT under phase 1 (both passes hold hull
   * boxes fixed); it ships as the referee a phase-2 occupant-displacement
   * relaxation needs, and it repairs the block clamp's vacuous scene-global
   * height check. Threaded into `engineOptions.strataHeightGate` only when on
   * (byte-identity).
   */
  strataHeightGate?: boolean;
  /**
   * OD-15 de-band port (default `"none"`, opt-in): dissolve this hierarchy level
   * and every deeper one so the subtree's resources share one packed hull. Runs
   * in the STRUCTURE phase (model build, before rank/ordering/placement) as pure
   * topology-path truncation, so every downstream pass re-runs over the
   * collapsed model.
   *
   * SUPPRESSED (not applied, echoed in `strataToggleSuppressions`) when the
   * absorbing parent would still be BANDED under the active `strataBandDepth`
   * cut — see `strataDeBandFeasible`. Threaded into
   * `engineOptions.strataDeBandLevel` only when non-`"none"` (byte-identity).
   */
  strataDeBandLevel?: DeBandLevel;
  /**
   * Package C spike (W9, default off): post-A7 obstacle-avoiding edge routing
   * in "penetrating-only" mode — at scene build, TFD arrows whose straight
   * chord penetrates a foreign box (non-ancestor hull or unrelated card) are
   * re-emitted as bounded detour polylines
   * (terraformPipelineStrataEdgeRouting.ts). Placement is untouched; unrouted
   * arrows are byte-identical; flag-off the routing module never runs.
   */
  strataEdgeRouting?: boolean;
  /**
   * P3-pierce border-exit routing (default off): a post-geometry pass
   * (terraformPipelineStrataBorderRoute.ts) that re-emits a TFD arrow leaving
   * its OWN ancestor container as a long interior diagonal with a clean
   * single-side exit waypoint. Orthogonal to `strataEdgeRouting` (disjoint edge
   * sets) and to every SCORED objective — the win is un-scored readability
   * (`strataBorderRouteInteriorLenSavedL1`). Placement is untouched; flag-off
   * the module never runs (byte-identical).
   */
  strataBorderRoute?: boolean;
  /** A7 (M1b): slice-A coordinate refinement flag. Threaded at S0a and consumed
   * by `refineStrataCoordinates` (per-hull Y median/PAV nudge) between placement
   * and scene build. Default off (the T2+R4 gate decides the default). */
  strataCoordinateRefine?: boolean;
  /** A6 (OD-7): generation G for the deterministic finalize — element
   * `version` = G, versionNonce = FNV-1a(stableId + ":" + G). Default 1: no
   * caller-side source exists yet (the `sceneContext` literal in
   * terraformLayoutCore does not thread a per-import counter, and plan JSON
   * carries no state serial) — the app-side per-scene regeneration counter is
   * the S7/M3 follow-up. The finalize/tombstone machinery is fully
   * G-parameterized and tested with G>1 regardless. Echoed in scene meta as
   * `strataGeneration` (the apply layer's tombstone pass reads the echo). */
  strataGeneration?: number;
  /** Dev-only failure-contract seam: force the named engine stage to throw so
   * the P11 fallback path is exercisable end-to-end from a test. Never set on
   * any production path. */
  __testForceStageError?: StrataDegradedMeta["stage"];
};

/**
 * Strata view — the rcll-v2 engine entry point (M1a) behind the §5 failure
 * contract.
 *
 * The engine runs its phases sequentially — model → A3 (cycle repair) → A1
 * (rank) → A0+A2 (placement) → scene build → structural check. On ANY stage
 * failure the entry point does NOT throw: it falls back to the v2 substrate
 * builder, reusing the prep it already computed (v3.1 §5 — otherwise every
 * failure silently re-pays the ~20s skeleton build), and surfaces the failure
 * as `rcllV2Degraded: { stage, reason }` in scene meta (the honest-meta
 * surfacing; T9 asserts this key is ABSENT on success).
 *
 * `preparePipelineLayout` is invoked with the SAME shape the v2 builder uses
 * internally (`(nodes, plan, compact)`, no NS option — A1's network-simplex is
 * a separate, engine-owned rank refinement), so the prep handed to the fallback
 * is a byte-valid substitute for what the v2 builder would have built itself. A
 * prep throw (e.g. the CON-10 .tfd gate) is intentionally NOT caught — it is the
 * same HTTP-400 every pipeline variant raises, and the v2 fallback would only
 * re-throw it; degenerate-input coverage is a loud-failure contract.
 *
 * Ancillary ("All resources") is honored POST-LAYOUT: the model is still built
 * WITHOUT ancillary — that is exactly what routes around SDEC-29's three
 * blockers (rank pile-up, the global `columnWidths`, the closed `StrataUnit`
 * union), all of which block an IN-MODEL port only — and bands are injected into
 * the finished placement as the last geometry stage
 * (terraformPipelineStrataAncillary.ts). A failed band drops the bands and keeps
 * the strata scene; it never degrades the layout to v2. `strataCoordinateRefine`
 * (A7) runs the per-hull Y refinement between placement and scene build when set;
 * its meta echo is kept regardless. Default off.
 */
export async function buildTerraformStrataExcalidrawScene(
  nodes: TerraformPlanNodesMap,
  plan: unknown,
  options?: TerraformStrataSceneOptions,
): Promise<{
  elements: ExcalidrawElement[];
  meta: Record<string, unknown>;
  warnings: TerraformImportWarning[];
}> {
  const compact = options?.compact !== false;
  const includeAncillary = options?.includeAncillary === true;
  const strataRankSeparate = options?.strataRankSeparate === true;
  const strataGeneration = options?.strataGeneration ?? 1;
  const forceStage = options?.__testForceStageError;

  // OD-14 mutual-exclusion (mirror of terraformPipelineToggleGuards.ts:103-106):
  // `strataRankSeparate` and the network-simplex ranker both rewrite the column
  // axis and CANNOT compose — rankSeparate is the dominant height lever, so when
  // both are requested it WINS and NS is dropped, surfaced observably. The
  // ECHOED (effective) NS value below is the post-suppression one (honest meta).
  const strataNetworkSimplexRankRequested =
    options?.strataNetworkSimplexRank === true;
  const strataToggleSuppressions: string[] = [];
  const strataNetworkSimplexRank =
    strataRankSeparate && strataNetworkSimplexRankRequested
      ? false
      : strataNetworkSimplexRankRequested;
  if (strataRankSeparate && strataNetworkSimplexRankRequested) {
    strataToggleSuppressions.push(
      "rank-floor-conflict-rankseparate-wins-network-simplex",
    );
  }

  const strataSweeps = options?.strataSweeps ?? 0;
  const strataCoordinateRefine = options?.strataCoordinateRefine === true;
  // W5b probe: only meaningful WITH rankSeparate (it refines the separated
  // floor); requesting it without RS is inert and echoed as such.
  const strataJointNsRank = options?.strataJointNsRank === true;
  // Round 9 (SDEC-57): packed candidate-set scoring, default off.
  const strataPackedScoring = options?.strataPackedScoring === true;
  // W8b: ε-constraint budget (0 = strict rule) + frontier instrumentation.
  const strataPackedScoringEpsilon = options?.strataPackedScoringEpsilon ?? 0;
  const strataPackedFrontierMeta = options?.strataPackedFrontierMeta === true;
  // OD-15 relocate (default off ⇒ byte-identical). Weights/cap are inert unless
  // the master flag is on; edge-cross cap inherits the packed-scoring epsilon.
  const strataSiftRelocate = options?.strataSiftRelocate === true;
  const strataCrossWeightPenetration =
    options?.strataCrossWeightPenetration ?? 1;
  const strataCrossWeightEdge = options?.strataCrossWeightEdge ?? 1;
  const strataEdgeCrossCap = options?.strataEdgeCrossCap;
  // G-DESCENT remedy: best-seen adopted-snapshot return, default off.
  const strataPackedConverge = options?.strataPackedConverge === true;
  // P0.2: transitive adoption relation, default off.
  const strataTransitiveAdopt = options?.strataTransitiveAdopt === true;
  // P4 pure-sink account block clamp (post-A7), default off.
  const strataBlockClamp = options?.strataBlockClamp === true;
  // Default ON (contrast with every other strata toggle): this one is already
  // gated behind `includeAncillary`, and it strictly improves on the baseline it
  // degrades to.
  const strataAncillaryAllocator = options?.strataAncillaryAllocator !== false;
  // P2 within-column transpose (post-A7), default off.
  const strataTranspose = options?.strataTranspose === true;
  // P5 (Lever C) per-hull height maintain-or-decrease gate, default off.
  const strataHeightGate = options?.strataHeightGate === true;
  // Package C spike (W9): scene-build edge routing, default off.
  const strataEdgeRouting = options?.strataEdgeRouting === true;
  // P3-pierce border-exit routing (scene-build), default off.
  const strataBorderRoute = options?.strataBorderRoute === true;
  // Band-depth cut. `strataBandCompact` is the LEGACY ALIAS for
  // `strataBandDepth: "root"`; explicit `strataBandDepth` always wins, so the
  // alias only applies when the enum is absent. Default "account" = the frozen
  // role→policy map (byte-identical to today).
  const strataBandCompact = options?.strataBandCompact === true;
  const strataBandDepth: StrataHullRole =
    options?.strataBandDepth ?? (strataBandCompact ? "root" : "account");

  // OD-15 de-band ⟂ band-depth mutual exclusion (same shape as the OD-14 block
  // above). Both levers rewrite the hull-tree band axis: `strataBandDepth`
  // chooses each SURVIVING hull's arrangement policy, de-band chooses which
  // hulls EXIST. They compose only in one direction — a de-band whose absorbing
  // parent is still BANDED gives every lifted leaf its own band-row (one
  // vertical stack of every resource, a height regression that throws nothing
  // and renders like a bug). `strataBandDepth` WINS: it is the shipped, measured
  // height lever and the frozen measurement config pins it, whereas de-band is
  // an unmeasured port — so an infeasible de-band is DROPPED, not silently
  // repaired by moving the user's cut under them. Surfaced observably; the
  // ECHOED level below is the post-suppression (effective) one (honest meta).
  const strataDeBandLevelRequested: DeBandLevel =
    options?.strataDeBandLevel ?? "none";
  const strataDeBandFeasibleHere = strataDeBandFeasible(
    strataDeBandLevelRequested,
    strataBandDepth,
  );
  const strataDeBandLevel: DeBandLevel = strataDeBandFeasibleHere
    ? strataDeBandLevelRequested
    : "none";
  if (!strataDeBandFeasibleHere) {
    strataToggleSuppressions.push(
      "band-axis-conflict-banddepth-wins-deband-absorbing-parent-banded",
    );
  }

  // The engine flag/input echoes + the honest ancillary-deferred marker,
  // merged into BOTH the success and the degraded meta. `strataGeneration` is
  // an input echo like the flags; on the DEGRADED path the fallback v2 scene
  // carries no canonical strata ids, so the apply layer's tombstone pass
  // (which gates on canonical ids, not on this echo) stays inert.
  const flagMeta: Record<string, unknown> = {
    strataNetworkSimplexRank,
    strataRankSeparate,
    ...(strataJointNsRank ? { strataJointNsRank } : {}),
    ...(strataPackedScoring ? { strataPackedScoring } : {}),
    ...((strataPackedScoring || strataSiftRelocate || strataTranspose) &&
    strataPackedScoringEpsilon !== 0
      ? { strataPackedScoringEpsilon }
      : {}),
    ...(strataEdgeRouting ? { strataEdgeRouting } : {}),
    ...(strataBorderRoute ? { strataBorderRoute } : {}),
    // OD-15 relocate master flag echo — present only when live (flag-off meta
    // byte-identical).
    ...(strataSiftRelocate ? { strataSiftRelocate: true } : {}),
    // P2 transpose echo — present only when on (byte-identity).
    ...(strataTranspose ? { strataTranspose: true } : {}),
    // Relocate objective weights/cap echoes — the OD-15 vertical-relocate AND the
    // P2 transpose both consume penW/crossW/cap, so the echo rides when EITHER is
    // on (weights/cap only when non-default, so both-off meta is byte-identical).
    ...(strataSiftRelocate || strataTranspose
      ? {
          ...(strataCrossWeightPenetration !== 1
            ? { strataCrossWeightPenetration }
            : {}),
          ...(strataCrossWeightEdge !== 1 ? { strataCrossWeightEdge } : {}),
          ...(strataEdgeCrossCap !== undefined ? { strataEdgeCrossCap } : {}),
        }
      : {}),
    // G-DESCENT converge echo — present only when on (flag-off byte-identity).
    ...(strataPackedConverge ? { strataPackedConverge: true } : {}),
    // P0.2 transitive-adoption echo — present only when on (byte-identity).
    ...(strataTransitiveAdopt ? { strataTransitiveAdopt: true } : {}),
    // P4 block-clamp echo — present only when on (byte-identity).
    ...(strataBlockClamp ? { strataBlockClamp: true } : {}),
    // P5 height-gate echo — present only when on (byte-identity).
    ...(strataHeightGate ? { strataHeightGate: true } : {}),
    // OD-15 de-band echo — the EFFECTIVE (post-suppression) level, present only
    // when non-default. `"none"` is a TRUTHY string, so an `&&`-truthy gate here
    // would materialize the key on every default run and break flag-off meta
    // byte-identity — the `!== "none"` guard is load-bearing (same trap the
    // `!== "account"` band-depth guard below documents).
    ...(strataDeBandLevel !== "none" ? { strataDeBandLevel } : {}),
    // Legacy-alias echo: `strataBandCompact` now maps to `strataBandDepth:
    // "root"`, but old links still request it — echo the intent (rides the
    // v2-fallback path too). The resolved cut's own meta echo is owned by the
    // demo-URL / defaults threading layer, not here.
    ...(strataBandCompact ? { strataBandCompactRequested: true } : {}),
    strataSweeps,
    strataCoordinateRefine,
    strataGeneration,
    ...(strataToggleSuppressions.length > 0
      ? { strataToggleSuppressions }
      : {}),
  };

  // Build prep ONCE — same invocation shape as the v2 builder's internal call so
  // the fallback prep is a valid substitute. A prep throw propagates (see header).
  const prep = preparePipelineLayout(nodes, plan, compact, {
    privateApiRegional: options?.pipelinePrivateApiRegional,
  });

  const engineOptions = {
    compact,
    // Ancillary is honored POST-LAYOUT (see the injection stage below): the
    // engine still builds its model WITHOUT ancillary — that is what routes
    // around all three SDEC-29 blockers — but the flag is no longer hardcoded
    // false and deferred.
    includeAncillary,
    networkSimplexRank: strataNetworkSimplexRank,
    rankSeparate: strataRankSeparate,
    sweeps: strataSweeps,
    coordinateRefine: strataCoordinateRefine,
    ...(strataPackedScoring ? { packedScoring: true } : {}),
    // W8b: epsilon rides when the packed scorer OR the OD-15 relocate OR the
    // block clamp / transpose is on AND it is nonzero. All of them read ε/cap
    // from engineOptions INDEPENDENTLY of packed scoring, so gating ε on packed
    // scoring alone would silently run those passes with ε=0/cap=0. Still
    // byte-identical for existing option literals and epsilon-0 callers.
    ...((strataPackedScoring ||
      strataSiftRelocate ||
      strataBlockClamp ||
      strataTranspose) &&
    strataPackedScoringEpsilon !== 0
      ? { packedScoringEpsilon: strataPackedScoringEpsilon }
      : {}),
    // Band-depth cut: spread ONLY when non-default. "account" is a TRUTHY
    // string, so an `&&`-truthy gate would change the engineOptions object
    // shape on every default run and break the flag-off byte-identity — the
    // `!== "account"` guard is load-bearing.
    ...(strataBandDepth !== "account" ? { strataBandDepth } : {}),
    // OD-15 de-band: the EFFECTIVE level, spread ONLY when non-default. Same
    // truthy-string trap as the cut above — `"none"` is truthy, so the
    // `!== "none"` guard is load-bearing for flag-off byte-identity.
    ...(strataDeBandLevel !== "none" ? { strataDeBandLevel } : {}),
    // Relocate objective weights/cap: these ride when ANY relocate-family
    // operator is on — the OD-15 sift/vertical-relocate, the block clamp, or
    // the transpose — because ALL consume penW/crossW/cap through
    // `strataRelocateAdoptable`. Gating them on strataSiftRelocate alone would
    // neuter the ε/cap owner guardrails and the weight sliders for the other
    // runs. Weights ride only when non-default, cap only when set, so the
    // all-off shape is byte-identical to today.
    ...(strataSiftRelocate || strataBlockClamp || strataTranspose
      ? {
          ...(strataCrossWeightPenetration !== 1
            ? { strataCrossWeightPenetration }
            : {}),
          ...(strataCrossWeightEdge !== 1 ? { strataCrossWeightEdge } : {}),
          ...(strataEdgeCrossCap !== undefined ? { strataEdgeCrossCap } : {}),
        }
      : {}),
    // OD-15 relocate master flag: rides ONLY when on (byte-identity off).
    ...(strataSiftRelocate ? { strataSiftRelocate: true } : {}),
    // G-DESCENT converge: rides ONLY when on, so the flag-off engineOptions
    // object shape is byte-identical to today.
    ...(strataPackedConverge ? { packedConverge: true } : {}),
    // P0.2 transitive adoption: rides ONLY when on (byte-identity).
    ...(strataTransitiveAdopt ? { transitiveAdopt: true } : {}),
    // P4 block-clamp: rides ONLY when on (byte-identity).
    ...(strataBlockClamp ? { strataBlockClamp: true } : {}),
    // P2 transpose: rides ONLY when on (byte-identity).
    ...(strataTranspose ? { strataTranspose: true } : {}),
    // P5 height gate: rides ONLY when on (byte-identity). Consumed INSIDE the
    // block-clamp operator, so the pipeline stage order below is unchanged.
    ...(strataHeightGate ? { strataHeightGate: true } : {}),
  };

  // Small dev seam so a test can force any stage to throw.
  const gate = (stage: StrataDegradedMeta["stage"]): void => {
    if (forceStage === stage) {
      throw new Error(`__testForceStageError: forced failure at "${stage}"`);
    }
  };

  // Engine-stage profiling (I2). The stages below are SIBLINGS (model → rank →
  // A0 → A7 → post-passes → ancillary → sceneBuild → structural-check), not a
  // nesting, so each is timed as a flat span via `spanNow`/`spanRecord` rather
  // than the stack-based `terraformImportProfilerMeasure` wrapper. Two
  // consequences the review asked for: (1) ZERO overhead when disabled — the
  // enabled flag is resolved once here into a cached boolean, and both helpers
  // early-return on it; no closure is allocated per stage, no wrapper is
  // invoked, and no env/localStorage probe runs per call. (2) The async
  // sceneBuild span is timed around its `await` WITHOUT pushing onto the shared
  // module stack, so overlapping builds cannot interleave and corrupt each
  // other's self-time.
  const profileOn = isTerraformImportProfilerEnabled();
  const spanNow = (): number => (profileOn ? performance.now() : 0);
  const spanRecord = (name: string, since: number): void => {
    if (profileOn) {
      terraformImportProfilerRecord(name, performance.now() - since);
    }
  };

  let stage: StrataDegradedMeta["stage"] = "model";
  try {
    gate("model");
    const tModel = spanNow();
    const model = buildStrataModel(prep, engineOptions);
    spanRecord("strata.model", tModel);

    stage = "a3";
    gate("a3");
    const tRepair = spanNow();
    const repair = repairStrataCycles(model.edges, model.addressOf);
    spanRecord("strata.a3", tRepair);

    stage = "a1";
    gate("a1");
    const tRank = spanNow();
    const rank = rankStrataClusters([...model.clusters.keys()], repair, {
      networkSimplexRank: engineOptions.networkSimplexRank,
      // OD-14: when live, the separated floor (derived from the hull tree's
      // sibling units) REPLACES the A1 rank instead of the NS refinement.
      rankSeparate: engineOptions.rankSeparate,
      // W5b probe (R8-F9): joint constrained-NS refinement of that floor.
      jointNsProbe: strataJointNsRank,
      hullRoot: model.hullRoot,
      // OD-6 / D10 #5: unit width is the frame's TRUE local rect width (what
      // placement uses), NOT build.width.
      unitWidthOf: (id) => {
        const cluster = model.clusters.get(id);
        return cluster ? clusterFrameLocalRect(cluster).width : 0;
      },
    });
    spanRecord("strata.rank", tRank);

    // A0 compound placement + A2 ordering (both inside placeStrataHulls).
    // Attribution contract (codex W2 P2): the forced-error hook gets an honest
    // per-stage tag, and a real throw from the ordering pass self-identifies
    // by its "Strata A2" message prefix — every throw WP-3a adds to the
    // ordering module MUST use that prefix or it will be misattributed to a0.
    stage = "a2";
    gate("a2");
    stage = "a0";
    gate("a0");
    let placement: ReturnType<typeof placeStrataHulls>;
    // Round-9 packed scoring observability (success meta, flag-on only).
    let packedScored:
      | ReturnType<typeof placeStrataHullsPackedScored>
      | undefined;
    // W8b frontier trials (report-only; collected only when the seam is on).
    const packedFrontierTrials: StrataPackedTrialRecord[] | undefined =
      strataPackedScoring && strataPackedFrontierMeta ? [] : undefined;
    try {
      if (strataPackedScoring) {
        // Descent = the whole-layout packed-scoring search (the expensive A0).
        const tDescent = spanNow();
        packedScored = placeStrataHullsPackedScored(
          model,
          repair.edgesPrime,
          rank,
          engineOptions,
          packedFrontierTrials
            ? (record) => packedFrontierTrials.push(record)
            : undefined,
        );
        spanRecord("strata.descent", tDescent);
        placement = packedScored.placement;
      } else {
        const tPlace = spanNow();
        placement = placeStrataHulls(
          model,
          repair.edgesPrime,
          rank,
          engineOptions,
        );
        spanRecord("strata.place", tPlace);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Strata A2")) {
        stage = "a2";
      }
      throw err;
    }

    // A7 coordinate refinement (M1b, flag-gated). Transforms the placement in
    // place of nothing when OFF (byte-identical to A0). Every throw it raises
    // self-identifies with the "Strata A7" message prefix — re-tagged in the
    // outer catch (mirror of the "Strata A2"/"Strata A6" contracts), and the
    // R2 dev-assert inside the pass makes a re-anchor violation degrade honestly.
    stage = "a7";
    gate("a7");
    // Round-9 iteration 2: post-A7 never-worse guard. The descent's guarantee
    // is on PRE-A7 geometry; A7 (order-preserving Y refinement) can invert the
    // ranking. When the scored selection actually moved a hull, refine BOTH
    // arms and keep the scored one only if it is lexicographically no worse on
    // FINAL geometry — otherwise fall back to legacy entirely (structural
    // no-regress on the scorer's metric, any preset).
    let packedScoringFellBack = false;
    if (engineOptions.coordinateRefine) {
      if (packedScored && packedScored.selections.size > 0) {
        // Trial re-layout = refining BOTH arms (scored + legacy) so the guard
        // can compare them on final geometry.
        const tTrial = spanNow();
        const scoredFinal = refineStrataCoordinates(
          placement,
          model,
          repair.edgesPrime,
        );
        const legacyFinal = refineStrataCoordinates(
          packedScored.baselinePlacement,
          model,
          repair.edgesPrime,
        );
        spanRecord("strata.trialRelayout", tTrial);
        // Score = the never-worse selection between the two trial arms.
        const tScore = spanNow();
        const chosen = chooseStrataRefinedPlacement(
          scoredFinal,
          legacyFinal,
          model,
          repair.edgesPrime,
          // W8b: the guard shares the descent's resolved δ-band (0 = today).
          packedScored.effectiveDelta,
          // OD-15: when the master flag is on the guard uses the SAME weighted
          // objective + hard cap as the descent (absent ⇒ flag-off rule).
          strataSiftRelocate
            ? {
                penW: strataCrossWeightPenetration,
                crossW: strataCrossWeightEdge,
                epsilon: strataPackedScoringEpsilon,
                edgeCrossCap:
                  strataEdgeCrossCap ?? strataPackedScoringEpsilon ?? 0,
              }
            : undefined,
        );
        spanRecord("strata.score", tScore);
        placement = chosen.placement;
        packedScoringFellBack = chosen.fellBack;
      } else {
        const tA7 = spanNow();
        placement = refineStrataCoordinates(
          placement,
          model,
          repair.edgesPrime,
        );
        spanRecord("strata.a7", tA7);
      }
    }

    // Post-A7 geometry post-passes (vertical-relocate → transpose → block-clamp).
    // Timed as one span: each is independently flag-gated and off ⇒ ~0ms.
    const tPostpasses = spanNow();
    // OD-15 post-A7 vertical-slot relocation (WP-RELOCATE). Runs whenever the
    // master flag is on — independent of packed scoring — after A7 and before
    // scene build; the existing structural check then validates the result.
    // Flag-off ⇒ the module is never called (byte-identical). Uses the SAME
    // engineOptions the descent read (carries the relocate weights/cap).
    if (strataSiftRelocate) {
      placement = refineStrataVerticalSlots(
        placement,
        model,
        repair.edgesPrime,
        rank,
        engineOptions,
      );
    }

    // P2 within-column transpose (post-A7, after vertical-relocate settles the
    // X-disjoint blocks so transpose fixes the within-column Y-order on the
    // settled layout). Runs whenever
    // its own master flag is on — independent of the relocate/packed/sink flags.
    // Envelope-preserving (hull height invariant). Flag-off ⇒ the module is never
    // called (byte-identical). The final structural check validates the result.
    if (strataTranspose) {
      placement = transposeStrataColumns(
        placement,
        model,
        repair.edgesPrime,
        rank,
        engineOptions,
      );
    }

    // P4 pure-sink account block clamp (post-A7). Runs whenever its own master
    // flag is on — independent of the relocate/packed flags. Flag-off ⇒ the
    // module is never called (byte-identical). The final structural check
    // validates it.
    if (strataBlockClamp) {
      placement = refineStrataBlockClamp(
        placement,
        model,
        repair.edgesPrime,
        rank,
        engineOptions,
      );
    }
    spanRecord("strata.postpasses", tPostpasses);

    // Ancillary ("All resources") band injection — the LAST geometry stage,
    // deliberately placed here (plan §3d):
    //  - NOT earlier: A7/relocate/transpose/blockClamp move geometry and score
    //    over model UNITS. Bands aren't units (that is the point). They would
    //    either ignore bands and move hulls out from under them, or need to know
    //    about bands — resurrecting SDEC-29's closed-union blocker across ~25
    //    sites.
    //  - BEFORE the structural check, deliberately: `checkStrataStructure`
    //    re-validates all model-entry geometry post-growth for free.
    //  - STATED COST: bands get no crossing-min, no height gate, no compaction.
    //    They are invisible to every optimizer and can create a tall dead zone no
    //    pass reclaims. Accepted scope; the §3o allocator is the lever that
    //    reclaims it and is a separate, gated commit.
    // Flag-off ⇒ the module is never called and no strips are built
    // (byte-identical, and none of the ~14-30s strip build is paid).
    let ancillaryBands: ReadonlyMap<string, StrataAncillaryBand> | undefined;
    let ancillaryMeta: Record<string, unknown> = {};
    if (includeAncillary) {
      const tAncillary = spanNow();
      stage = "ancillary";
      // A failed band is NOT a failed layout: never degrade the whole scene to
      // v2 over one: drop the bands, keep the strata scene, echo the reason
      // (honest-meta). This catch is INSIDE the engine's outer try on purpose.
      try {
        // INSIDE the try, deliberately: the fault-injection gate must fail the
        // way a real band failure fails. Outside it, `__testForceStageError:
        // "ancillary"` escapes to the engine's outer catch and degrades the
        // WHOLE scene to v2 — the exact contract this block exists to deny, and
        // it would make the test that asserts the §3m contract prove its
        // opposite.
        gate("ancillary");
        const strips = buildAncillaryStrips(nodes, plan, prep, { compact });
        // §3o — the greedy right-slack allocator. It widens each band into
        // PRE-EXISTING right slack to cut band height, validates every grant
        // end-to-end, and degrades to the §3f host-interior baseline (which
        // always applies) one lowest-benefit grant at a time. Default ON: the
        // whole feature is already opt-in behind `includeAncillary`, so flag-off
        // byte-identity is unaffected, and the allocator can only improve on the
        // baseline it falls back to. The OFF arm exists so the probe can measure
        // the baseline and the allocator against each other.
        const injected = strataAncillaryAllocator
          ? buildValidatedStrataAncillaryInsertion({ model, placement, strips })
          : injectStrataAncillaryBands({ model, placement, strips });
        // §3g — bands are INVISIBLE to `checkStrataStructure` (it walks the
        // model). Without this check a band/leaf overlap is silent, green and
        // invisible — the exact `skeleton: []` failure class, and precisely the
        // "unreserved-space failure" that made the measured dead end emit 90
        // collisions. Any nonzero count is a failure.
        const containment = checkStrataAncillaryContainment(
          injected.bands,
          injected.placement,
          model,
        );
        if (
          containment.bandEscapesHost > 0 ||
          containment.bandOverlaps > 0 ||
          containment.bandTitleCollisions > 0
        ) {
          throw new Error(
            `ancillary containment failed: ${JSON.stringify(containment)}`,
          );
        }
        placement = injected.placement;
        ancillaryBands = injected.bands.size > 0 ? injected.bands : undefined;
        ancillaryMeta = {
          pipelineIncludeAncillary: true,
          pipelineAncillaryCount: countAncillaryCards(strips),
          pipelineAncillaryStripCount: strips.length,
          strataAncillaryBandCount: injected.bands.size,
          strataAncillaryNestDepthMax: injected.maxNestDepth,
          strataAncillaryRelocatedStripCount: injected.relocatedStripCount,
          strataAncillaryContainment: containment,
          // P1-B: bands dropped rather than widen a hull (an over-wide single
          // card). Rides only when non-empty.
          ...(injected.suppressedHostIds.length > 0
            ? {
                strataAncillarySuppressedBandCount:
                  injected.suppressedHostIds.length,
                strataAncillarySuppressedHostIds: injected.suppressedHostIds,
              }
            : {}),
          ...("allocatorMeta" in injected
            ? { strataAncillaryAllocator: injected.allocatorMeta }
            : {}),
        };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(`[strata] ancillary bands dropped: ${reason}`);
        ancillaryBands = undefined;
        ancillaryMeta = {
          pipelineIncludeAncillary: true,
          strataAncillaryDegraded: { reason },
        };
      }
      spanRecord("strata.ancillary", tAncillary);
    }

    stage = "scene-build";
    gate("scene-build");
    // Timed around the await WITHOUT touching the shared sync stack (see the
    // spanNow/spanRecord note above) so overlapping builds cannot corrupt each
    // other's self-time across this await boundary.
    const tSceneBuild = spanNow();
    const scene = await buildStrataScene({
      prep,
      model,
      placement,
      nodes,
      generation: strataGeneration,
      // Ancillary bands: the key rides only when at least one band exists, so
      // the flag-off input literal (and the scene build) stay byte-identical —
      // and a host with zero ancillary cards emits no band at all rather than an
      // empty "Unconnected" box.
      ...(ancillaryBands ? { ancillaryBands } : {}),
      // Package C spike (W9): the key rides only when the flag is on so the
      // flag-off input literal (and the scene build) stay byte-identical.
      ...(strataEdgeRouting ? { edgeRouting: true } : {}),
      // P3-pierce border-exit routing: key rides only when on (byte-identity).
      ...(strataBorderRoute ? { borderRoute: true } : {}),
      // OD-15 de-band: the scene build's `topologyPathForCluster` call stamps
      // `customData.terraformTopologyPath`, which T9 slice classification
      // reconstructs the hull tree from. It MUST see the same EFFECTIVE level
      // `buildStrataModel` built the tree with, or the stamp and the tree
      // disagree and every slice-keyed metric is silently wrong. Key rides only
      // when non-default (byte-identity).
      ...(strataDeBandLevel !== "none"
        ? { deBandLevel: strataDeBandLevel }
        : {}),
    });
    spanRecord("strata.sceneBuild", tSceneBuild);

    // Standing R2 invariant (S0b acceptance): any nonzero count is a failure.
    stage = "structural-check";
    gate("structural-check");
    const tStructuralCheck = spanNow();
    const structure = checkStrataStructure(placement, model);
    spanRecord("strata.structuralCheck", tStructuralCheck);
    if (
      structure.nonAncestorOverlaps > 0 ||
      structure.titleCollisions > 0 ||
      structure.contiguityViolations > 0
    ) {
      throw new Error(`structural check failed: ${JSON.stringify(structure)}`);
    }

    return {
      elements: scene.elements,
      meta: {
        layoutEngine: "pipeline",
        pipelineVariant: "strata",
        pipelineLayoutVariant: "strata",
        pipelineCompact: compact,
        pipelineClusterCount: prep.clusters.length,
        pipelineEdgeCount: model.edges.length,
        pipelineSelfLoopCount: model.selfLoops.length,
        pipelineColumnCount: rank.columnX.length,
        pipelineTopologyFrameEdgeCount: scene.frameEdgeCount,
        strataNetworkSimplexApplied: rank.networkSimplexApplied,
        ...(rank.nsSkipReason
          ? { strataNetworkSimplexSkipReason: rank.nsSkipReason }
          : {}),
        // OD-14 height-lever observability — present only when the flag was live.
        ...(rank.rankSeparateApplied !== undefined
          ? {
              strataRankSeparateApplied: rank.rankSeparateApplied,
              strataRankSeparatePairCount: rank.rankSeparatePairCount,
              strataRankSeparateChangedRankCount:
                rank.rankSeparateChangedRankCount,
              ...(rank.rankSeparateFallback
                ? { strataRankSeparateFallback: rank.rankSeparateFallback }
                : {}),
            }
          : {}),
        // W5b joint-NS probe observability — present only when the probe ran.
        ...(rank.jointNsApplied !== undefined
          ? {
              strataJointNsApplied: rank.jointNsApplied,
              ...(rank.jointNsFallback
                ? { strataJointNsFallback: rank.jointNsFallback }
                : {}),
              ...(rank.jointNsRealSpanBefore !== undefined
                ? {
                    strataJointNsRealSpanBefore: rank.jointNsRealSpanBefore,
                    strataJointNsRealSpanAfter: rank.jointNsRealSpanAfter,
                  }
                : {}),
            }
          : {}),
        // Round-9 packed-scoring observability — present only when flag-on.
        ...(packedScored
          ? {
              strataPackedScoringSelections: Object.fromEntries(
                packedScored.selections,
              ),
              strataPackedScoringBaselineScore: packedScored.baselineScore,
              strataPackedScoringScore: packedScored.score,
              strataPackedScoringTrials: packedScored.trialCount,
              strataPackedScoringFellBack: packedScoringFellBack,
              // W8b ε-constraint echoes — emitted only when the effective
              // epsilon is nonzero, so the ε=0/unset (strict) path stays
              // bit-identical at the meta level to pre-W8b behavior.
              ...(packedScored.epsilon !== 0
                ? {
                    strataPackedScoringEpsilon: packedScored.epsilon,
                    strataPackedScoringEffectiveDelta:
                      packedScored.effectiveDelta,
                  }
                : {}),
              ...(packedFrontierTrials
                ? { strataPackedScoringFrontierTrials: packedFrontierTrials }
                : {}),
            }
          : {}),
        // Package C spike (W9) observability — present only when flag-on.
        ...(scene.edgeRouting
          ? {
              strataEdgeRoutingRouted: scene.edgeRouting.routed,
              strataEdgeRoutingUnroutable: scene.edgeRouting.unroutable,
              strataEdgeRoutingWaypoints: scene.edgeRouting.waypointsTotal,
            }
          : {}),
        // P3-pierce border-exit observability — present only when flag-on. The
        // scored terms (crossings/penetrations/lengthL1/pierce) are INVARIANT
        // by design. `MaxWaypointPerpDev` is the FAITHFUL headline (how far the
        // clean side-exit staircase pulls off the interior diagonal);
        // `InteriorLenSavedL1` is a conservative lower-bound that under-reads it.
        ...(scene.borderRoute
          ? {
              strataBorderRouteRouted: scene.borderRoute.routed,
              strataBorderRouteUnclean: scene.borderRoute.unclean,
              strataBorderRouteNoGain: scene.borderRoute.noGain,
              strataBorderRouteWaypoints: scene.borderRoute.waypointsTotal,
              strataBorderRouteMaxWaypointPerpDev:
                scene.borderRoute.maxWaypointPerpDev,
              strataBorderRouteInteriorLenSavedL1:
                scene.borderRoute.interiorLenSavedL1,
            }
          : {}),
        // R2 evidence (all-zero on the success path).
        strataStructural: structure,
        ...flagMeta,
        // Ancillary echoes — mirror v1's contract
        // (terraformPipelineLayout.test.ts) so cross-engine meta stays
        // comparable. Rides ONLY when `includeAncillary` (byte-identity).
        ...ancillaryMeta,
      },
      // NOT the legacy pipelineCycleWarnings (codex W2 P2): its message claims
      // ordering "fell back to first .tfd occurrence", which is false here —
      // A3 repairs cycles structurally (GreedyFAS) and no file-order fallback
      // exists in this engine. Warn accurately, and only when a cycle existed.
      warnings:
        repair.feedbackKeys.size > 0
          ? [
              {
                code: "pipeline_cycle" as const,
                message: `Strata view repaired ${repair.feedbackKeys.size} dependency cycle edge(s) structurally (GreedyFAS); the affected arrow(s) are drawn against the flow direction.`,
              },
            ]
          : [],
    };
  } catch (err) {
    // A7 attribution contract (mirror of "Strata A2"): the coordinate refinement
    // + its R2 dev-assert run under stage "a7" and self-identify with the
    // "Strata A7" message prefix, so a re-anchor violation is tagged honestly.
    if (err instanceof Error && err.message.startsWith("Strata A7")) {
      stage = "a7";
    }
    // A6 attribution contract (mirror of the "Strata A2" prefix above): the
    // finalize runs inside buildStrataScene (stage "scene-build"), and every
    // throw it raises self-identifies with the "Strata A6" message prefix.
    if (err instanceof Error && err.message.startsWith("Strata A6")) {
      stage = "finalize";
    }
    const reason = err instanceof Error ? err.message : String(err);
    // Dev surfacing — the meta IS the contract, but a warn helps local debug.
    // eslint-disable-next-line no-console
    console.warn(`[strata] engine degraded at stage "${stage}": ${reason}`);

    // §5 fallback: reuse the prep already built (never re-pay the skeleton build).
    const fallback = await buildTerraformPipelineV2ExcalidrawScene(
      nodes,
      plan,
      { compact, includeAncillary, prep },
    );
    return {
      elements: fallback.elements,
      meta: {
        ...fallback.meta,
        pipelineLayoutVariant: "strata",
        ...flagMeta,
        rcllV2Degraded: { stage, reason },
      },
      warnings: fallback.warnings,
    };
  }
}
