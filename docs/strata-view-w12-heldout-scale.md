# Strata W12 — out-of-tuning-distribution transfer + full-detail scale battery

**Date:** 2026-07-13 · **Status:** Pre-registered analysis record (WP2 commit 1). **REPORT-only** — no gate is asserted, no frozen row is added or changed, `gateRegister.json` untouched. Results and interpretation sections land in later WPs; everything in the "Pre-registered analysis record" section below is committed **before any W12 battery statistic exists**, and is not edited after the battery runs (post-hoc changes would be a new, labeled amendment, never a silent rewrite).

**Claim scoping (synthetic P3 — codex plan-review P1):** P3 = `staging-heldout-mesh` is **SELF-AUTHORED** (`scripts/generate-heldout-plan.mjs`, mulberry32 seed 20260704, frozen with an input-only distinctness profile in WP1 commit `8a5f73f9d` before any battery number existed for it). W12 therefore ships **out-of-tuning-distribution transfer evidence, NOT held-out closure** — a self-authored fixture cannot close R8-F4, which **stays formally open** until a genuinely independent plan re-runs this (preset-parameterized) battery.

## Document graph

| Relation | Link |
| --- | --- |
| Role | Battery (pre-registration first; results appended in WP4) |
| Status | Current |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`strata-view-decision-log.md`](./strata-view-decision-log.md) SDEC-65 (W11) → W12 plan |
| Sisters | [`strata-view-w11-task-tracing.md`](./strata-view-w11-task-tracing.md), [`strata-view-w10b-band-compact-battery.md`](./strata-view-w10b-band-compact-battery.md) |
| Fixture freeze | [`strata-baselines/q12/P3_DISTINCTNESS_PROFILE.md`](./strata-baselines/q12/P3_DISTINCTNESS_PROFILE.md) (WP1, input-only, frozen before battery) |
| Next (agent) | WP3 full-detail scale block (same battery file, additive `fullDetailBlock`); WP4 results + trace + SDEC entry |

## Pre-registered analysis record

Committed BEFORE the W12 battery produces any statistic. The battery file (`packages/excalidraw/components/terraformPipelineStrataW12HeldoutScaleBattery.test.ts`, WP2 commit 2) implements exactly this record; any divergence discovered later is a defect in the battery, not a license to edit this record.

### 1. What counts — presets, arms, cells (transfer block)

- **Presets:** P1 = `staging-extended-localstack-v2` (in-sample, all-resources RCA fixture), P2 = `staging-localstack` (in-sample validation twin), P3 = `staging-heldout-mesh` (out-of-tuning-distribution, synthetic). All load through the shared seam `getTerraformImportPresetSourcesFromDb` → `resolveSourcesWithTfdComposition` → `layoutTerraformViaWorkers` — the same seam for every arm (baseline included), per the single-seam rule.
- **Scene arms (compact, byte-equal option bundles to the W11 battery):**
  - `A_v2` — `{ layoutMode:"pipeline", pipelineLayoutVariant:"v2", pipelineCompact:true }`
  - `I` — `{ layoutMode:"strata", pipelineCompact:true, strataSweeps:4, strataCoordinateRefine:true }`
  - `I_RS` — `I` + `strataRankSeparate:true`
- **Arm pairs that count:** `A_v2 vs I` and `A_v2 vs I_RS` (baseline is always `A_v2`).
- **Headline cells per preset × arm pair:** extent slice-B paired CI on **p50 and p90**, and rt̂ paired CI on **p50 and p90** (`pairedBootstrapCi` on canonical-edge-keyed slice-B extents; `pairedPathMetricsCi` / `computeStrataPathMetrics` for rt̂ — the exact frozen helpers W10b/W5 use, statuses verbatim).
- **Supporting cells (reported, never headline):** global crossings (`diagnosePipelineScene(...).dataflow.crossings`), R2 structural zeros (`meta.strataStructural` — must be all-zero on strata arms as engine health), `rcllV2Degraded` absent on strata arms, `buildMs` (informational wall-clock only, stripped from all determinism comparisons).

### 2. Churn cells — the A4 three-mutation triple, frozen thresholds

- **Mutations (all three, on ALL THREE presets):** `add-one-resource`, `add-one-edge`, `moved{}-rename`, with the exact mutation mechanics of the normative A4 harness `terraformPipelineStrataChurnTriple.test.ts` (add-one-edge included deliberately — it is the mutation R8-F4/C11's original transfer failure came from; no W10b add+rename shortcut).
- **Arms:** `A_v2` (empirical anchor substrate — reported, thresholds not applicable to it), `I`, `I_RS` (candidate strata arms — thresholds apply).
- **Frozen thresholds (copied verbatim from the normative source, [`rcll-v2-spec-v3.1.md`](./rcll-v2-spec-v3.1.md) **§13 "A4 threshold freeze register" (frozen 2026-07-05, W3)\*\*):
  - **M1_rel ≤ 0.08**
  - **M2_flip ≤ 0.10**
  - M3 report-only; M4/M5 reported with their §3 status strings. These values are NOT re-derived, re-tuned, or loosened by W12 under any P3 outcome.
- **Metric machinery:** `computeStrataChurnMetrics(base, mutated, { renames?, nMin: 20 })` — frozen v3.1 §12 pins: **N_min = 20** (|U| ≥ N_min is the M4/M5 gate precondition; a short cell is flagged prominently, never loosened) and **M4 coverage floor = 0.5** (below ⇒ M4 INCONCLUSIVE).
- **P3 adaptation rule:** if a mutation _builder_ does not generalize to P3's shape, only the **mutation construction** (which node/bind/edge is picked) may be adapted — the thresholds and metrics may not. If a mutation is genuinely impossible to construct on a preset, that cell is stamped `INCOMPLETE` with the reason, never silently dropped.

### 3. Statistic machinery — frozen §12 pins, reused verbatim

All from `terraformPipelineBootstrapCi.ts` / `terraformPipelineStrataPathMetrics.ts` (v3.1 §2.5 + §12, v3.2 statistic repair), used unchanged:

- Seed **20260704**; PRNG mulberry32; **B = 1000** resamples, n-out-of-n with replacement; CI = percentile method **[2.5%, 97.5%]**.
- Pairing key = canonical terraform edge address (true declared direction + relKind, NUL-joined).
- **VOID rule:** `nUnmatched > 0.20 × min(n_baseline, n_candidate)` ⇒ cell voided (frozen helper's `voided`/`status`/`nUnmatched` taken verbatim, never recomputed locally).
- **N_B,min = 30** (v3.1 §12 p90 gate floor); **nB < 10** ⇒ cell report-only (p50 floor); v3.2 statistic-gating floors: p90 ⇒ n ≥ 31, p50 ⇒ n ≥ 10 (`statisticGateEligible`); degenerate p90 CI voids a p90 gate.
- W12 is REPORT-only, so no cell _gates_ anything — the floors and void statuses are echoed so every cell carries its frozen eligibility honestly.

### 4. Cell classification (mechanical, pre-registered)

Each paired CI cell (metric × statistic × arm pair × preset) is classified, Δ = candidate − baseline (lower is better for extent and rt̂):

- **VOID** — the frozen helper says `voided: true` (or n = 0).
- **IMPROVING** — not voided AND `hi < 0` (CI excludes zero on the improving side).
- **WORSENING** — not voided AND `lo > 0` (CI excludes zero on the worsening side).
- **NULL** — not voided AND the CI straddles zero.

### 5. Transfer verdict definitions (the only reading permitted)

**Per headline cell** (extent p50/p90, rt̂ p50/p90 × both arm pairs), with E = the in-sample class envelope {class(P1), class(P2)}:

- **SUPPORT** — class(P3) ∈ E, or class(P3) = NULL while P1 and P2 disagree with each other (no consistent in-sample direction existed to transfer).
- **FAILED-TRANSFER** — class(P3) = WORSENING while neither P1 nor P2 is WORSENING (a headline sign reversal with CI excluding zero against the in-sample pattern).
- **VOID** — class(P3) = VOID (frozen void status fired on the deciding cell; reported, not adjudicated away).
- **INCONCLUSIVE** — anything else (e.g. P3 IMPROVING where both in-sample cells were NULL — directionally favorable but outside the observed envelope; flagged, not counted as SUPPORT).

**Block-level verdict for the transfer block:**

- **SUPPORT** — ALL of: every headline P3 cell is SUPPORT; **all three A4 mutations** on every P3 strata arm (`I`, `I_RS`) are within the frozen thresholds (M1_rel ≤ 0.08 AND M2_flip ≤ 0.10) with |U| ≥ N_min; P3 strata arms have all-zero R2 structural counts and no `rcllV2Degraded`; no headline P3 cell VOID.
- **FAILED-TRANSFER** — ANY of: a frozen A4 threshold exceeded on any P3 strata-arm mutation cell; any headline P3 cell FAILED-TRANSFER; strata degradation or nonzero structural counts on P3.
- **VOID** — a deciding headline cell (or a deciding churn cell via |U| < N_min) carries a frozen void/short status such that neither SUPPORT nor FAILED-TRANSFER can be established; every void is named in the report.
- **INCONCLUSIVE** — otherwise (mixed cell verdicts that trip none of the above).

A layout **throw/degradation on P3 is itself a reported W12 finding** (FAILED-TRANSFER via the degradation clause), never something to patch or retune before reporting.

### 6. Tracing cells — evidence class

The W11 precision/recall cells (production directed/uncapped `getTerraformRelationshipFocus` vs true declared-dependency reachability, plus the shipped undirected 3-hop mismatch cell) are re-run on all three presets, arm `I`. They are labeled in the report JSON as **`"evidenceClass": "api-seam-validation"`** — **API-seam validation (population matching), NOT task/impact-tracing evidence**. Precision/recall = 1.0 on the directed call is a population-match result (W11's own caveat); nothing in W12 upgrades it into task evidence.

### 7. Sanity anchor (executable; P1/P2 must reproduce W11's recorded numbers)

Verified before this record was written: **no W10B/W11 report JSON artifacts are committed** (`docs/strata-baselines/` carries only Q2 audit, V32 rows, gate register, q7axis sheets, q12 profile; git history adds only the `.md` reports). The anchor is therefore generated ONCE from this battery's own deterministic P1/P2 fields and cross-checked against the numbers **recorded in [`strata-view-w11-task-tracing.md`](./strata-view-w11-task-tracing.md)**:

- Task-mismatch (shipped undirected 3-hop, arm-invariant): P1 mean precision **0.464** / mean recall **0.682**; P2 **0.483** / **0.739** (3-dp doc rounding).
- Production directed/uncapped call: precision **1.0** and recall **1.0** on every anchor; anchors mappable **P1: 50/50, P2: 36/36**.
- rt̂ p50/p90 (2-dp): P1 `A_v2` 14.77/22.92, `I` 13.36/21.39, `I_RS` 14.21/24.89; P2 `A_v2` 11.50/19.32, `I` 12.58/21.78, `I_RS` 15.08/23.76.
- Paired rt̂ p50 `A_v2 vs I` on P1: CI **[−0.48, −0.05]** (2-dp).

Any mismatch on these P1/P2 anchor fields **fails the battery loudly** (harness-health assertion) — P3 cells are not read until the anchor is green.

### 8. Determinism + report protocol

- One orchestrating test builds every arm ONCE per pass and writes ONE `W12_HELDOUT_SCALE_BATTERY.json` (env `Q12_REPORT_DIR`, default tmpdir). Seed 20260704 everywhere; no `Date.now`/`Math.random` in any report-affecting path.
- The suite is **run twice**; the two report JSONs must deep-equal after stripping wall-clock keys (`buildMs`, `applyMs` family) — W11's normalization approach. The result of the run-twice comparison is recorded with the results.
- The report carries a placeholder `fullDetailBlock: null` for WP3 (additive; same report file, no new report).

## Amendments

### AMENDMENT-1 — 2026-07-13 — P3 fixture versioned to v2 (band structure only)

Labeled amendment per the header rule (post-hoc changes are a new, labeled amendment, never a silent rewrite). Trigger: the first battery run (v1 fixture) + the codex diff review (finding 5) established that **v1 of `staging-heldout-mesh` had ZERO slice-B (cross-band) edges** — the generator fixed every resource to a single provider/account/region (one AWS provider block, one region constant, no per-resource account/region signal), so the scene had a single band. This was a **generator artifact, not a finding about strata**: with `n = 0`, all four P3 extent headline cells carried the frozen `VOID` status and **extent transfer was never exercised**.

What this amendment records:

1. **v1 outcome stands as run:** the v1 extent cells were frozen-VOID (`n = 0`), correctly classified by the pre-registered §4 rule; nothing about the v1 run is reinterpreted.
2. **Fixture versioned to v2 for band structure ONLY** — an **input-structural change made after observing the VOID but before reading any v2 extent numbers**. v2 (generator `scripts/generate-heldout-plan.mjs`, same mulberry32 seed 20260704, rerun byte-identical) introduces 3 account/region bands (000000000000/us-east-1; 000000000000/us-west-2 hosting cells 13-14; 210987654321/us-east-1 hosting cells 15-16 + observability sinks) with cross-band TFD fan-ins (hub fan-out into cells 13-16, cascade lanes, mesh-wide `sfn -> audit_stream` and `dlq_alarm -> ops_alerts`), the same way P1/P2 get bands (per-resource `after.arn`/`after.region`). Module depth 4-5, the out-degree-16 hub, all three reference cycles and determinism are unchanged.
3. **All thresholds, metrics, statistics and verdict definitions above are UNCHANGED** — no threshold, floor, seed, pairing key, void rule or classification was touched.
4. **Provenance:** the v1 frozen profile is preserved at [`strata-baselines/q12/P3_DISTINCTNESS_PROFILE.v1.{json,md}`](./strata-baselines/q12/); the v2 profile is re-emitted (same input-only axes plus an informational `bands` block) at the original path, and the committed preset DB is regenerated with the other presets' rows byte-identical (DB-DIFF-VERIFY in the commit body).

## Results

_BLOCKED — this section intentionally empty at pre-registration. Battery numbers land in WP4 (with the WP3 full-detail block), quoted against the definitions above without post-hoc discretion._

## Interpretation

_BLOCKED-ON-Q7 — the task-direction reading of any W12 number waits on the owner's Q7-AXIS labeling (open W11 exit criterion, `docs/strata-baselines/q7axis/`). Until Q7 labels land, the pre-registered reading above is a prediction protocol, not a result._
