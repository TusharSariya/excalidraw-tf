// Strata (rcll-v2) layout defaults — the SDEC-54 validated arm (K=4 sweeps + A7
// coordinate refinement), shared by the import dialog seeds and the demo-URL
// resolution path so the two cannot drift. Engine sinks (terraformPipelineStrata,
// terraformLayoutCore, terraformSceneApply, terraformCanvasShareUrl) intentionally
// KEEP their own `?? 0` / `=== true` fallbacks: they run under an explicit-options
// contract where absent means "caller opted out", not "apply the view default".
// Plain literals only — this module must not import from any layout module
// (planParsing→layoutCore import-cycle rule).
export const TERRAFORM_STRATA_LAYOUT_DEFAULTS = {
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
  /** W10 (SDEC-63): banded row-share compaction lever — probe lever, default
   * off pending owner adjudication (primarily effective with rankSeparate). */
  strataBandCompact: false,
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
}) => ({
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
  strataBandCompact:
    params.strataBandCompact ??
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataBandCompact,
  // Band-depth cut: explicit `strataBandDepth` always wins; the legacy
  // `strataBandCompact` boolean aliases to `"root"` ONLY when the enum is
  // absent (same precedence as the `terraformPipelineStrata.ts` app-layer
  // fold-in — encoded once here, once there).
  strataBandDepth:
    params.strataBandDepth ??
    (params.strataBandCompact
      ? "root"
      : TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataBandDepth),
});
