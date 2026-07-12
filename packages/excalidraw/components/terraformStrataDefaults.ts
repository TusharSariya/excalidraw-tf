// Strata (rcll-v2) layout defaults — the SDEC-54 validated arm (K=4 sweeps + A7
// coordinate refinement), shared by the import dialog seeds and the demo-URL
// resolution path so the two cannot drift. Engine sinks (terraformPipelineStrata,
// terraformLayoutCore, terraformSceneApply, terraformCanvasShareUrl) intentionally
// KEEP their own `?? 0` / `=== true` fallbacks: they run under an explicit-options
// contract where absent means "caller opted out", not "apply the view default".
// Plain literals only — this module must not import from any layout module
// (planParsing→layoutCore import-cycle rule).
export const TERRAFORM_STRATA_LAYOUT_DEFAULTS = {
  strataNetworkSimplexRank: false,
  strataSweeps: 4,
  strataCoordinateRefine: true,
  strataRankSeparate: false,
  /** Round 9 (SDEC-57): packed-hull whole-layout candidate scoring — probe
   * lever, default off pending its gate battery. */
  strataPackedScoring: false,
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
});
