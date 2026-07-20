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

Battery: `terraformPipelineStrataW12HeldoutScaleBattery.test.ts`, seed 20260704, REPORT-only. Artifact: [`strata-baselines/q12/W12_HELDOUT_SCALE_BATTERY.json`](./strata-baselines/q12/W12_HELDOUT_SCALE_BATTERY.json) (+ `.normalized.json`). Every classification below is the **mechanical** application of §§4–5; nothing here is owner-adjudicated (see Interpretation). P3 numbers are from the **v2 fixture** (AMENDMENT-1); the v1 run's all-VOID extent outcome stands as recorded there.

**Sanity anchor (§7): GREEN** — every P1/P2 anchor field reproduced the numbers recorded in `strata-view-w11-task-tracing.md` exactly (mismatch means 0.464/0.682 and 0.483/0.739; anchors 50/50 and 36/36; all six rt̂ p50/p90 pairs; paired rt̂ p50 CI [−0.48, −0.05]) before any P3 cell was read.

**Determinism (§8):** suite run twice (distinct `Q12_REPORT_DIR`); the two normalized reports (wall-clock keys stripped) are **byte-identical**. `softFailures: []`.

### Transfer block (compact) — headline cells

Δ = candidate − baseline (lower is better); paired CI [2.5%, 97.5%], B=1000, frozen statuses verbatim.

`A_v2 vs I`:

| Cell | P1 (in-sample) | P2 (in-sample) | P3 (out-of-tuning) | §5 verdict |
| --- | --- | --- | --- | --- |
| extent p50 | +324 [−301, +770] NULL | +4786 [+2268, +5532] WORSENING | **+1260 [+901, +1621] WORSENING** | SUPPORT |
| extent p90 | +6726 [+3966, +7006] WORSENING | +5532 [+2268, +5532] WORSENING | **+2408 [+1874, +2461] WORSENING** | SUPPORT |
| rt̂ p50 | −0.27 [−0.48, −0.05] IMPROVING | +0.98 [+0.56, +1.25] WORSENING | **+1.45 [+1.08, +1.82] WORSENING** | SUPPORT |
| rt̂ p90 | +2.07 [+1.78, +2.22] WORSENING | +3.15 [+2.79, +3.56] WORSENING | **+8.20 [+7.37, +9.87] WORSENING** | SUPPORT |

`A_v2 vs I_RS`:

| Cell | P1 | P2 | P3 | §5 verdict |
| --- | --- | --- | --- | --- |
| extent p50 | +337 [−389, +796] NULL | +1845 [+1178, +3796] WORSENING | +1260 [+901, +1621] WORSENING | SUPPORT |
| extent p90 | +3161 [+1252, +3659] WORSENING | +3796 [+1178, +3796] WORSENING | +2408 [+1874, +2461] WORSENING | SUPPORT |
| rt̂ p50 | +0.25 [+0.06, +0.64] WORSENING | +2.64 [+2.06, +3.10] WORSENING | +1.45 [+1.08, +1.82] WORSENING | SUPPORT |
| rt̂ p90 | +4.61 [+4.26, +4.97] WORSENING | +7.58 [+7.05, +8.02] WORSENING | +8.20 [+7.37, +9.87] WORSENING | SUPPORT |

**On P3, `I ≡ I_RS`** — rankSeparate is a no-op on this scene shape, so the two arm pairs share cells (crossings 474 both, identical CIs). Slice-B n: P1 37, P2 4 (report-only p50 floor territory; echoed per §3), P3 39; nUnmatched 0 everywhere (no transfer-block voids). Supporting cells: crossings P1 177/123/220, P2 33/39/104, P3 375/474/474 (A_v2/I/I_RS); R2 structural counts all-zero on every strata arm; `rcllV2Degraded` absent; no P3 layout throw.

### Transfer block — A4 churn triple (frozen M1_rel ≤ 0.08, M2_flip ≤ 0.10, N_min 20)

All three mutations × all three presets × both strata arms are **within the frozen thresholds** with |U| ≥ N_min everywhere (P1 121–123, P2 68–70, P3 153–155):

| Preset | Arm | add-one-resource (M1/M2) | add-one-edge (M1/M2) | moved-rename (M1/M2) |
| --- | --- | --- | --- | --- |
| P1 | I | 0.0194 / 0.0065 | 0.0121 / 0.0050 | 0 / 0 |
| P1 | I_RS | 0.0982 / 0.0086 † | 0 / 0 | 0 / 0 |
| P2 | I / I_RS | 0 / 0 | 0.0246 / 0.0544 · 0 / 0 | 0 / 0 |
| P3 | I ≡ I_RS | 0 / 0 | **0.0398 / 0.0039** (worst P3 cell) | 0 / 0 |

† P1 I_RS add-one-resource M1_rel 0.0982 exceeds 0.08 — an **in-sample** cell; the §5 block verdict conditions its churn clause on the **P3** strata arms only, all of which pass. Reported, not adjudicated away. The `A_v2` anchor (thresholds not applicable) reproduces the spec-§13 derivation values, incl. P2 add-one-edge M1 0.2072 / M2 0.1514 — the v2 anchor behavior the thresholds were frozen against. M4/M5 status strings OK on all threshold-bearing cells.

### Transfer block — verdict

**blockVerdict: SUPPORT (mechanical).** All eight headline P3 cells SUPPORT; all P3 strata-arm churn cells within frozen thresholds with |U| ≥ N_min; P3 structural zeros, no degradation, no throw, no headline void. Direction of the SUPPORT: P3 reproduces the in-sample pattern **against** the strata arms on extent and rt̂ (WORSENING transfers) — transfer of the measured direction, not a strata win; reading blocked on Q7 (below).

### Tracing cells — `evidenceClass: "api-seam-validation"`

Population matching only, NOT task/impact-tracing evidence (§6, W11 caveat). Arm I scenes:

| Preset | Production directed/uncapped call | Shipped undirected 3-hop (mean precision / recall) |
| --- | --- | --- |
| P1 | 1.0 / 1.0 (50/50 anchors) | 0.464 / 0.682 |
| P2 | 1.0 / 1.0 (36/36) | 0.483 / 0.739 |
| P3 | 1.0 / 1.0 (50/50) | **0.294 / 0.673** |

The directed production call transfers exactly (1.0/1.0 out-of-tuning-distribution). The shipped undirected 3-hop default is **more** task-mismatched on P3 than in-sample (precision 0.294 vs 0.464/0.483; min precision 0.045) — the W11 mismatch finding worsens out of distribution.

### Full-detail scale block (WP3)

Arms `F_v2_full_ancillary` vs `H2/I2/J2` (option objects verbatim from ExtentGate; **single `layoutTerraformViaWorkers` seam for every arm incl. baseline**). P3 stretch cells ran. No cell exceeded the 60,000 ms soft budget — **zero TIMEOUT/INCOMPLETE stamps** (worst wall-clock: P1 F_v2 17,325 ms).

**Extent: frozen-VOID on all 9 pairs** (`pairedBootstrapCi` verbatim — nUnmatched 77 of P1 n=37, 28 of P2 n=4, 171 of P3 n=39, each > 0.20·min(n)). Asymmetry diagnostic (never determines status): **100% reclassification, 0 absent** — every unmatched baseline slice-B edge still exists in the strata arm but is no longer classified slice-B (nSliceB baseline→candidate: P1 114→37, P2 32→4, P3 210→39). **Content-parity caveat (by construction):** `F_v2_full_ancillary` includes ancillary; strata full arms defer it (`strataAncillaryDeferred`, unbuilt M3 port) — element counts P1 7,994 vs 4,845; P2 5,539 vs 3,728; P3 4,122 vs 2,291. Full-detail extent pairing is not honestly comparable until the M3 port exists.

**rt̂ (n = 500/265/500, no voids):**

| Pair | rt̂ p50 P1 / P2 / P3 | rt̂ p90 P1 / P2 / P3 |
| --- | --- | --- |
| F vs H2 | +0.01 NULL / +0.04 WORSENING / **−1.31 IMPROVING** | +1.98 W / +2.10 W / +8.27 W |
| F vs I2 | +0.02 NULL / +0.04 WORSENING / **−5.16 IMPROVING** | +2.20 W / +2.01 W / +3.12 W |
| F vs J2 | −0.16 NULL / +2.11 WORSENING / **−5.16 IMPROVING** | +3.41 W / +5.26 W / +3.12 W |

rt̂ p90 worsens on every pair/preset; p50 is preset-dependent — NULL in-sample P1, WORSENING in-sample P2, **IMPROVING on P3** (the strata arms beat the full v2+ancillary baseline at the median on the synthetic mesh). Crossings mostly improve (P1 222 → 172/170; P2 55 → 48/48; P3 784 → 715/480) **except J2** (P1 236 vs 222, P2 117 vs 55 — rankSeparate's known crossings tax). Structural zeros on all strata arms; `rcllV2Degraded` absent.

**Timing split** (partition formula per meta; `pipeline.prep` fired 0 on all v2/strata arms as predicted):

| Cell | wallClock | outer prep+merge+parse | layout.pipeline | remainder |
| --- | --- | --- | --- | --- |
| P1 F_v2_full | 17,324.79 | 2,521.53 | 14,797.62 | 5.64 |
| P1 I2_full | 15,596.45 | 2,491.04 | 13,101.08 | 4.33 |
| P2 F_v2_full | 7,768.74 | 1,113.23 | 6,651.76 | 3.75 |
| P2 I2_full | 7,360.50 | 1,128.30 | 6,229.37 | 2.83 |
| P3 F_v2_full | 183.90 | 39.78 | 142.93 | 1.19 |
| P3 I2_full | 159.46 | 39.06 | 119.25 | 1.15 |

`skeleton.resourceRects` dominates `layout.pipeline` (P1 F_v2: 14,486 of 14,798 ms) — element building, not geometry solving, is the scale cost, consistent with the browser trace (Appendix A).

### Codex diff-review disposition (WP2+WP3 diff, standing cadence)

2 P1 + 3 P2, **all five folded** before the final battery run: **F1** void semantics (frozen `voided/status` taken verbatim; local recomputation removed), **F2** P3 throw capture (a P3 layout throw is recorded as a FAILED-TRANSFER finding, not a test crash), **F3** anchor-before-P3 ordering enforced in the orchestrator, **F4** anchor tightening (exact-equality on the recorded W11 fields), **F5** P3 fixture v2 + AMENDMENT-1 (zero-slice-B generator artifact — the amendment above).

### M3-port gate summary (what this battery says)

The plan gated the M3 ancillary port on this battery. Mechanical reading: (a) transfer block **SUPPORT** — the frozen statistic machinery, churn thresholds and API seams behave out-of-tuning-distribution exactly as in-sample, so the measurement substrate is trustworthy at P3 scale; (b) full-detail runs are **viable** (no timeouts, structural zeros, P1 strata full-detail ≈ 15.6 s vs v2 17.3 s wall); (c) the extent frozen-VOID × content-parity caveat means **the M3 port is itself the unlock for honest full-detail extent pairing** — until strata carries ancillary, every full-detail extent cell voids by construction and the headline extent question cannot be asked at full detail. Nothing here pre-decides the port; the go/no-go is the owner's, and the task-direction reading is Q7-blocked.

## Interpretation

**BLOCKED-ON-Q7.** The task-direction reading of any W12 number waits on the owner's Q7-AXIS labeling (open W11 exit criterion, `docs/strata-baselines/q7axis/`). Until Q7 labels land, everything below is a **mechanical reading, owner adjudication pending** — listed so the adjudication has its inputs in one place, decided by no one here:

1. _(pending)_ Transfer blockVerdict SUPPORT — the in-sample direction (strata worsens extent p50/p90 and rt̂ p50/p90 vs `A_v2` compact) **reproduces** on P3. Whether that direction is task-adverse or task-neutral is exactly the Q7 question.
2. _(pending)_ The directed production focus call is exact (1.0/1.0) on all three presets, while the shipped undirected 3-hop default degrades further out-of-distribution (P3 precision 0.294). Whether "directed" is the task-faithful mode is Q7's axis question.
3. _(pending)_ Full-detail rt̂ p50 flips sign across presets (P1 NULL, P2 WORSENING, P3 IMPROVING) — scale behavior of the strata arms is not preset-stable at the median; p90 worsens everywhere.
4. _(pending)_ M3-port gate: measurement substrate SUPPORT + full-detail viability + extent-VOID-by-construction ⇒ the port is also the unlock for the honest full-detail extent question (Results, M3 summary). Go/no-go is the owner's.
5. Claim scope (not pending — structural): P3 is self-authored; R8-F4 stays formally open. None of the above is held-out closure.

## Appendix A — browser felt-cost trace (WP4, best-effort; REPORT-only)

One chrome-devtools-mcp performance trace of the real dev app (2026-07-13): `yarn start` (vite, `localhost:3002`), URL `/demo?preset=staging-extended-localstack-v2&view=strata&compact=0&strataSweeps=4&strataCoordRefine=1` — P1, strata view, **full detail**, K=4 + A7 (the I2 full arm's option shape). First navigation warmed vite + ran the import once; the traced run was a reload with the trace recording. Numeric detail: [`strata-baselines/q12/BROWSER_TRACE_NOTES.md`](./strata-baselines/q12/BROWSER_TRACE_NOTES.md).

**Felt wall-clock:** initial shell LCP 887 ms (CLS 0.00), then the import runs as **one blocking main-thread long task of 13,412 ms** starting t+1.23 s, followed by two apply/render tasks (227 ms @ t+14.66 s, 154 ms @ t+14.96 s) — the imported scene settles ≈ **t+15.1 s**. During the long task the page is frozen (the previous scene renders from localStorage, so the user stares at a stale, unresponsive canvas).

**Main-thread attribution (event buckets, whole trace):** scripting 14,273 ms · paint 246 ms · compositing/render 36 ms · DOM layout 36 ms — the felt cost is JS compute, not render/paint.

**Sampled CPU attribution (leaf frames):** address/key resolution dominates — `resolveTerraformPlanNodeKey` 2,487 ms, index-stripping RegExp 2,374 ms, `terraformModulePrefixForAddress` 2,064 ms, `parseStackAddress` 1,874 ms, `collectKnownStackIdsFromNodes` 1,057 ms, `stripTerraformAddressIndexes` 983 ms (≈ 8.8 s, ~65% of busy); topology link resolvers (IAM/SG/API-GW/S3) ≈ 1.5 s; DOT peg parse ≈ 0.4 s; strata geometry solvers ≈ 26 ms (negligible). These leaves fire from both plan parsing and skeleton element building (`skeleton.resourceRects`), so this is attribution by function, not by stage.

**Seam observation:** no DedicatedWorker thread activity — layout ran on the renderer main thread (`runSequential` inside `layoutTerraformViaWorkers`), same in-process path the battery's timing split measured. Shape cross-check vs WP3's split for I2_full on P1 (wall 15,596 ms = outer 2,491 + `layout.pipeline` 13,101 + remainder ≈ 4): the browser's 13.4 s task + ≈ 1.7 s surrounding work matches.

**Caveats:** dev build (unminified, React dev) + tracing overhead; single trace, one preset, one arm; no strata-vs-v2 browser A/B. Attribution shape — not absolute milliseconds — is the evidence. Proof-API timing emit stays deferred (plan D7).
