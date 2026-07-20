# hopsweep — W13 hop-depth × direction sweep artifacts

**NON-FROZEN. REPORT-only. Unregistered.** Nothing in this directory is covered by [`../V32_BASELINE_MANIFEST.json`](../V32_BASELINE_MANIFEST.json) or [`../gateRegister.json`](../gateRegister.json): **no SHA pins, no frozen rows, no gate cells.** Every artifact here is **re-derivable** by rerunning the W13 battery (deterministic, seed 20260704; run-twice deep-equal after stripping wall-clock keys) — rerunning may legitimately replace committed copies.

## Document graph

| Relation | Link |
| --- | --- |
| Role | Battery artifacts (W13) |
| Status | Current — non-frozen, REPORT-only |
| Hub | [`../../rcll-strata-doc-index.md`](../../rcll-strata-doc-index.md) |
| Parent | [`../../strata-view-w13-hop-sweep.md`](../../strata-view-w13-hop-sweep.md) (pre-registered analysis record) |
| Sisters | [`../q12/README.md`](../q12/README.md) (same non-frozen artifact convention) |
| Next (agent) | Refresh via the WP5 battery with `HOPSWEEP_REPORT_DIR=docs/strata-baselines/hopsweep`; default output goes to the system tmpdir so CI never rewrites committed copies |

## Placement note (why this directory is safe)

Before creating this subdirectory it was verified that the W12 battery (`packages/excalidraw/components/terraformPipelineStrataW12HeldoutScaleBattery.test.ts`) performs **no runtime scan of `docs/strata-baselines/`**: its "no committed W10B/W11 report JSON artifacts" statement is a manually verified header comment (file lines 38–40 and 1340), and its only filesystem read under this tree is `q12/P3_DISTINCTNESS_PROFILE.json` (smoke wall-clock budgets). The gate-register test (`terraformPipelineStrataGateRegister.test.ts`) reads only the manifest-listed files. A `hopsweep/` subdirectory therefore cannot trip any existing battery or freeze check, and the artifacts live here (not at a `strata-baselines-reports/` fallback).

## Files (appear when the WP5 battery runs)

- `W13_HOP_SWEEP_BATTERY.json` — the sweep report (presets × direction × K cells + sanity anchors + §7 recommendation output), per the pre-registered record.
- `W13_HOP_SWEEP_BATTERY.normalized.json` — the same report with wall-clock keys stripped (the run-twice determinism comparand).

## Standing status

Interpretation of every number here is **BLOCKED-ON-Q7** (owner labeling, [`../q7axis/`](../q7axis/)). The §7 recommendation is population-match evidence only (NOT task evidence — W11 caveat); any default flip is an owner decision.
