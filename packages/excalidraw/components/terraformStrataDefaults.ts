// Strata (rcll-v2) layout defaults — the SDEC-54 validated arm (K=4 sweeps + A7
// coordinate refinement), shared by the import dialog seeds and the demo-URL
// resolution path so the two cannot drift. Engine sinks (terraformPipelineStrata,
// terraformLayoutCore, terraformSceneApply, terraformCanvasShareUrl) intentionally
// KEEP their own `?? 0` / `=== true` fallbacks: they run under an explicit-options
// contract where absent means "caller opted out", not "apply the view default".
// Plain literals only — this module must not import from any layout module
// (planParsing→layoutCore import-cycle rule).
export const TERRAFORM_STRATA_LAYOUT_DEFAULTS = {
  /** S3-1: the strata view places private VPC-endpoint-bound REST APIs at
   * region level by default (de-facto ON since the flag shipped). The single
   * source of truth for that ON default — the dialog seed and the demo-URL
   * resolve path both read it here instead of hardcoding `true`, so the app
   * default can never drift from what harnesses/batteries measure. (Non-strata
   * views still force the flag OFF at the import boundary — that view-scoping
   * is unchanged; see `runTerraformImportWithView`.) */
  pipelinePrivateApiRegional: true,
  /** Band-depth slider (v3.2): the deepest role still banded; deeper roles are
   * packed. `"account"` reproduces today's fixed role→policy map
   * byte-identically. Plain string literal (not `StrataHullRole`) per the
   * no-layout-import rule above. */
  strataBandDepth: "account",
  strataNetworkSimplexRank: false,
  strataSweeps: 4,
  strataCoordinateRefine: true,
  strataRankSeparate: false,
  /** Round 9 (SDEC-57): packed-hull whole-layout candidate scoring — probe
   * lever, default off pending its gate battery. */
  strataPackedScoring: false,
  /** W8b (SDEC-59 follow-up): ε-constraint crossings budget for the packed
   * scorer. 0 = the strict round-9 rule (bit-identical); REPORT lever only —
   * a nonzero default is an owner adjudication, never a silent pick. */
  strataPackedScoringEpsilon: 0,
  /** Package C spike (W9): post-A7 obstacle-avoiding edge routing — probe
   * lever, default off pending its gate battery. */
  strataEdgeRouting: false,
  /** P3-pierce clean container-exit routing — probe lever, default off /
   * byte-identical (NOT in the frozen measurement config). */
  strataBorderRoute: false,
  /** W10 (SDEC-63): banded row-share compaction lever — probe lever, default
   * off pending owner adjudication (primarily effective with rankSeparate). */
  strataBandCompact: false,
  /** OD-15 crossings-≻-length relocate (cross-hull sift + post-A7 vertical
   * slots) — probe lever, default off pending its gate battery. */
  strataSiftRelocate: false,
  /** Relocate objective weights: C = penW·penetrations + crossW·edgeEdge (owner
   * priority: hull crossings ≻ edge length). Integer/fixed-point. The
   * edge-edge regression cap (`strataEdgeCrossCap`) inherits
   * `strataPackedScoringEpsilon` when absent, so it is not seeded here. */
  strataCrossWeightPenetration: 1,
  strataCrossWeightEdge: 1,
  /** G-DESCENT remedy: packed-scoring descent returns the best-seen ADOPTED
   * snapshot instead of the rolling incumbent — probe lever, default off
   * (inert at ε=0). */
  strataPackedConverge: false,
  /** Transitive-adopt remedy: replace the ε adoption gate with a strict total
   * order (weightedC, lengthL1, crossings, penetrations); ε kept as a
   * feasibility crossing-cap — probe lever, default off (byte-identical
   * off). */
  strataTransitiveAdopt: false,
  /** P4 pure-sink account block clamp: rigid-translate a whole dead-end account
   * subtree left toward its sources to shorten cross-account arrows and narrow
   * the diagram — probe lever, default off. */
  strataBlockClamp: false,
  /** P2 within-column transpose: swap Y-adjacent X-overlapping sibling pairs to
   * remove diagonal crossings the barycenter sweeps leave in fan-in columns —
   * probe lever, default off (envelope-preserving, byte-identical off). */
  strataTranspose: false,
  /** P5 (Lever C) per-hull implied-height maintain-or-decrease acceptance gate
   * for the block-clamp pass — probe lever, default off. Measured inert at the
   * frozen preset. It is the referee a phase-2 occupant-displacement relaxation
   * needs, not a height win today. */
  strataHeightGate: false,
  /** A01 leaf X-shift: pull degree-1 pure-sink leaves left toward their source,
   * Y-redrop within the owning hull, grow ancestor chain — probe lever, default
   * off (byte-identical off). Carries the mandatory right-edge column guard. */
  strataLeafShift: false,
  /** OD-15 de-band ladder port: dissolve this hierarchy level and every deeper
   * one at the Strata model build — probe lever, default `"none"` (byte-
   * identical: `"none"` truncates no topology path). Plain string literal (not
   * `DeBandLevel`) per the no-layout-import rule above. */
  strataDeBandLevel: "none",
} as const;

/**
 * Resolve the strata engine options for a demo/share URL: any param the URL
 * omits falls back to the validated default above. Explicit values — including
 * `strataSweeps=0` / `strataCoordRefine=0` — always win over the default.
 * (Parser fields keep their URL names; note `strataCoordRefine` maps to the
 * option name `strataCoordinateRefine`.)
 */
export const resolveStrataDemoOptions = (params: {
  strataNsRank?: boolean;
  strataSweeps?: number;
  strataCoordRefine?: boolean;
  strataRankSeparate?: boolean;
  strataPackedScoring?: boolean;
  strataPackedEps?: number;
  strataEdgeRouting?: boolean;
  strataBorderRoute?: boolean;
  strataBandCompact?: boolean;
  /** Plain string union (not `StrataHullRole`) per the no-layout-import rule
   * above — mirrors the engine's `StrataHullRole` domain exactly. */
  strataBandDepth?:
    | "root"
    | "provider"
    | "account"
    | "region"
    | "vpc"
    | "subnetZone";
  /** OD-15 crossings-≻-length relocate lever. */
  strataSift?: boolean;
  /** Relocate objective weights (see `TERRAFORM_STRATA_LAYOUT_DEFAULTS`). */
  strataPenW?: number;
  strataCrossW?: number;
  /** Edge-edge regression cap — OPTIONAL, no default materialized; absent
   * ⇒ the engine inherits `strataPackedScoringEpsilon`. */
  strataEdgeCap?: number;
  /** G-DESCENT remedy: best-seen adopted snapshot return. */
  strataPackedConverge?: boolean;
  /** Transitive-adopt remedy: strict total-order adoption gate. */
  strataTransitiveAdopt?: boolean;
  /** P4 pure-sink account block clamp. */
  strataBlockClamp?: boolean;
  /** P2 within-column transpose. */
  strataTranspose?: boolean;
  /** P5 (Lever C) per-hull height maintain-or-decrease acceptance gate. */
  strataHeightGate?: boolean;
  /** A01 leaf X-shift. */
  strataLeafShift?: boolean;
  /** OD-15 de-band ladder. Plain string union (not `DeBandLevel`) per the
   * no-layout-import rule above — mirrors the engine's domain exactly. */
  strataDeBandLevel?:
    | "none"
    | "subnet"
    | "vpc"
    | "region"
    | "account"
    | "provider";
}) => {
  // Band-depth cut: explicit `strataBandDepth` always wins; the legacy
  // `strataBandCompact` boolean aliases to `"root"` ONLY when the enum is
  // absent (same precedence as the `terraformPipelineStrata.ts` app-layer
  // fold-in — encoded once here, once there). The resolved value is forwarded
  // RAW: the default (`"account"`) is OMITTED, never materialized as an own
  // key, so nothing downstream (sceneContext/session/snapshot) persists a
  // default cut and the engine alias still fires for bare-bandCompact inputs.
  // The `"root"` alias output and any explicit deeper role DO forward.
  const strataBandDepth =
    params.strataBandDepth ??
    (params.strataBandCompact
      ? "root"
      : TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataBandDepth);
  return {
    strataNetworkSimplexRank:
      params.strataNsRank ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataNetworkSimplexRank,
    strataSweeps:
      params.strataSweeps ?? TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataSweeps,
    strataCoordinateRefine:
      params.strataCoordRefine ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataCoordinateRefine,
    strataRankSeparate:
      params.strataRankSeparate ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataRankSeparate,
    strataPackedScoring:
      params.strataPackedScoring ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataPackedScoring,
    strataPackedScoringEpsilon:
      params.strataPackedEps ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataPackedScoringEpsilon,
    strataEdgeRouting:
      params.strataEdgeRouting ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataEdgeRouting,
    strataBorderRoute:
      params.strataBorderRoute ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataBorderRoute,
    strataBandCompact:
      params.strataBandCompact ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataBandCompact,
    // Forward the cut RAW: omit at the default `"account"` (never materialize a
    // default own key). Non-default cuts (the `"root"` alias / explicit roles)
    // forward.
    ...(strataBandDepth !== "account" ? { strataBandDepth } : {}),
    strataSiftRelocate:
      params.strataSift ?? TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataSiftRelocate,
    strataPackedConverge:
      params.strataPackedConverge ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataPackedConverge,
    strataTransitiveAdopt:
      params.strataTransitiveAdopt ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataTransitiveAdopt,
    strataBlockClamp:
      params.strataBlockClamp ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataBlockClamp,
    strataTranspose:
      params.strataTranspose ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataTranspose,
    strataHeightGate:
      params.strataHeightGate ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataHeightGate,
    strataLeafShift:
      params.strataLeafShift ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataLeafShift,
    // De-band ladder: forward RAW and omit at the default `"none"` (never
    // materialize a default own key). `"none"` is a TRUTHY string, so the
    // explicit `!== "none"` compare is load-bearing — an `&&`-truthy gate would
    // materialize the key on every default run, exactly as for the cut above.
    ...((params.strataDeBandLevel ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataDeBandLevel) !== "none"
      ? {
          strataDeBandLevel:
            params.strataDeBandLevel ??
            TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataDeBandLevel,
        }
      : {}),
    strataCrossWeightPenetration:
      params.strataPenW ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataCrossWeightPenetration,
    strataCrossWeightEdge:
      params.strataCrossW ??
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataCrossWeightEdge,
    // Optional-only forward: no default materialized here (absent ⇒ the
    // engine inherits `strataPackedScoringEpsilon`), per
    // `TERRAFORM_STRATA_LAYOUT_DEFAULTS`'s comment above.
    ...(params.strataEdgeCap !== undefined
      ? { strataEdgeCrossCap: params.strataEdgeCap }
      : {}),
  };
};
