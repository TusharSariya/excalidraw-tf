# Strata W7 — packed-scoring acceptance battery (round-9 remedy)

**Date:** 2026-07-12 · **Status:** Battery report (measurement only; REPORT cells — owner adjudication of the default posture pending). Measures the `strataPackedScoring` lever (commits `6030151f8` + `81f7f86e4`) against the round-9 gate plan.

## Document graph

| Relation | Link |
| --- | --- |
| Role | Battery |
| Status | Current |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`rcll-v2-shit-test-round9.md`](./rcll-v2-shit-test-round9.md) |
| Sisters | [`strata-view-w5-repaired-stats-report.md`](./strata-view-w5-repaired-stats-report.md), [`strata-view-w6-highlight-spike-report.md`](./strata-view-w6-highlight-spike-report.md) |
| Next (agent) | Owner adjudication: waive the paired-tail churn cells (default-on) or keep opt-in |

## Methodology

One harness run (`terraformPipelineStrataPackedScoringBattery.test.ts`, report-emitting, never asserts gates; seed 20260704; cell recompute verified byte-identical; `softFailures: []`) over three arms on P1+P2 compact: `A_v2_baseline`, `I_strata_k4_a7` (current strata default), `P_strata_k4_a7_packed` (I + `strataPackedScoring`). Cells: paired extent CIs ON p50/p90 (v3.2 floors) and the M-RT path family, for A→I, A→P and **I→P** (the lever's own baseline). Per-arm scalars: battery global crossings + crossing angles, structural collision count, **edge–box penetrations recomputed on final geometry** (hull frames `account/region/vpc/subnetZone` and unrelated `primaryCluster` cards; an (arrow, box) pair counts once when a polyline segment enters a box containing neither arrow endpoint, 2px endpoint pad) — the scorer's own term measured where users see it — plus the round-9 owner-case SQS→RDS centre distance and per-arm wall-clock. Δ = candidate − baseline; negative = candidate better. Regenerate: `Q7_REPORT_DIR=<dir> yarn vitest run packages/excalidraw/components/terraformPipelineStrataPackedScoringBattery.test.ts --exclude "**/.claude/**"`. **W5 re-run byte-identical** after this battery's addition (cmp-verified).

## Per-arm scalars

| Arm | crossings | sharpShare | hull pen. | card pen. | collisions | SQS→RDS px | build ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **P1** v2 | 177 | 0.28 | 123 | 230 | 0 | 990 | 2685 |
| **P1** I (K4+A7) | 123 | 0.41 | 115 | 206 | 0 | 1303 | 2645 |
| **P1** P (+packed) | **97** | **0.29** | **87** | **149** | 0 | **676** | 13748 |
| **P2** v2 | 33 | 0.48 | 23 | 107 | 0 | — | 1219 |
| **P2** I | 39 | 0.95 | 61 | 142 | 0 | — | 1179 |
| **P2** P | **24** | 0.71 | **33** | **97** | 0 | — | 2113 |

P is the first strata arm to beat v2 on raw crossings on any preset (P2: 24 vs 33) and cuts hull tunneling below v2 on P1 (87 vs 123). `fellBack: false` on both presets (the never-worse guard armed but unused).

## Paired cells vs I (the lever's baseline; n=500 / 265 paths, 37 / 4 edges)

| I→P | P1 | P2 |
| --- | --- | --- |
| rt̂ p50 | **−0.50 [−0.57, −0.19]** improving | **−0.52 [−0.60, −0.39]** improving |
| rt̂ p90 | +1.08 [+1.00, +1.18] worse | +0.16 [+0.06, +0.55] worse |
| con p90 | +35.7 [+29.0, +50.7] worse | +31.7 [+27.6, +81.8] worse |
| cr p90 | +1 [+1, +2] worse | 0 [0, 0] flat |
| tll p50 | −62.8 [−167.7, 0] not worse | +105.8 [0, +615.2] borderline (lo=0) |
| extent p50 | −115.5 [−462, +60] parity | floor-ineligible (n=4) |
| extent p90 | +351 [+231, +921.5] worse | floor-ineligible (n=4) |

**The paired-tail vs arm-tail split is the headline nuance.** Under the v3.2 normative estimand (quantile of paired per-path deltas), the p90 component cells regress vs I — the reorder churns individual paths and the worst per-path changes are positive. But every **arm-level** tail statistic improves: absolute rt̂ p90 21.39→19.87 (P1) and 21.78→18.70 (P2); arm cr p90 10→8 (P1); arm con p90 589→497 (P2, P1 flat). Both readings are true: the lever redistributes which paths are hard while lowering the overall tail. The companion Δ-of-arm-quantiles was adjudicated into the gate family for exactly this case and is reported alongside.

## Paired cells vs v2 (external reference)

| A→P | P1 | P2 |
| --- | --- | --- |
| rt̂ p50 | **−1.45 [−1.94, −0.83]** improving | **−0.22 [−0.49, −0.10]** improving |
| rt̂ p90 | +1.04 [+0.82, +1.61] (I was +2.07) | +2.17 [+1.97, +2.58] (I was +3.15) |
| extent p90 | +5680 [+2811, +5862] (I was +6726) | floor-ineligible |

**P beats v2 at the median predicted trace on BOTH presets** — the first arm in the campaign's history to do so (W5's I lost on P2 at +0.98; P wins at −0.22). The p90 gap to v2 is roughly halved on P1 and narrowed on P2, and the extent tail vs v2 also narrows (5680 vs I's 6726) — though I→P extent p90 (+351) shows the narrowing is not free at every edge.

## Round-9 gate-plan cells

| Cell | Verdict | Evidence |
| --- | --- | --- |
| M-TCR exact no-regress everywhere + strict P1 improvement | **MET** | 123→97 (P1), 39→24 (P2); strict on both |
| M-RT p50 no-regress vs I | **MET (improves)** | CI-improving both presets |
| M-RT p90 improvement (≥2 presets) | **NOT MET on the normative paired estimand; MET on the arm-quantile companion** | paired +1.08/+0.16 worse; arm p90 −1.52/−3.08 better |
| M-CRP p90 no-regress vs I | **SPLIT** | P2 flat; P1 paired +1 worse, arm 10→8 better |
| M-CON p90 no-regress vs I | **NOT MET (paired)** | +35.7 / +31.7; arm-level flat (P1) / better (P2) |
| M-TLL p50 no-regress vs I | **MET (P1) / borderline (P2)** | P1 −62.8; P2 CI lo=0 |
| M-ANG improve | **MET vs I** | sharpShare 0.41→0.29, 0.95→0.71 (P2 still worse than v2's 0.48) |
| M-EXT within waiver discipline | **WITHIN, with a new I-relative cost** | vs v2 tail narrows (5680 < 6726); I→P p90 +351 worse (small vs the SDEC-47/53 waiver scale); P2 floor-ineligible |
| Structural zeros (collisions) | **MET** | 0 all arms; penetrations are report-only (no normative exact-zero counter yet — M-H completion outstanding) |
| Determinism | **MET** | cell recompute byte-identical; fellBack=false |

## Costs

Build time is the real cost: P1 13.7s vs 2.6s (5.2×), P2 2.1s vs 1.2s — the K+1-snapshots × per-hull coordinate-descent trial placements. Acceptable behind an opt-in toggle; a default-on decision should either accept it, cache trial placements, or bound descent passes.

## Owner case (round-9 trigger)

SQS `regional_writer_west` → RDS centre distance: v2 990px, I 1303px, **P 676px**, with the SQS+DynamoDB pair placed between the two VPCs — the owner's exact suggested arrangement, selected by the scorer on merit (a group-sift candidate).

## Honesty box

Two presets, no held-out state, owner-N=1 (R8-F11 stands). The penetration counter is a battery probe (2px endpoint pad; endpoint-inside = legitimate) — it is not yet the normative M-H exact-zero counter, and TFD arrows are measured on their emitted straight geometry (soft-deleted until visibility reconcile; runtime routing may differ). The paired-vs-arm quantile split is reported in full rather than picking the favorable reading; under the normative paired estimand three component p90 cells regress vs I, and a default-on decision requires FAIL-WAIVED entries citing an SDEC — an owner call, not an agent call. The gate register schema still lacks M-TCR/M-ANG/M-H claim cells (round-9 prerequisite, outstanding).

## Bottom line

**The round-9 remedy works and the lever is a default-on candidate, but not an automatic one.** It fixes the trigger case exactly as the owner proposed, delivers the campaign's first across-the-board arm-level wins (crossings strictly better than I on both presets and better than v2 on P2; median predicted trace better than v2 on both presets — a first; tunneling and sharp-angle share down), and the never-worse guard held. What blocks an unconditional PASS is the normative paired-tail estimand: per-path churn puts rt̂/con (and P1 cr) p90 paired cells on the wrong side, plus a small P1 extent-tail cost vs I and a 5× build-time hit. **Recommendation: keep opt-in now; adjudicate default-on by either waiving the paired-churn cells (FAIL-WAIVED with this report as evidence, on the argument that arm-level tails — what a user actually experiences on the final drawing — improve everywhere) or amending the estimand policy for reorder levers; extend the gate register schema first either way.**

Raw JSON: regenerate deterministically via the run command in Methodology (session copy: scratchpad `w7/W7_PACKED_SCORING_REPORT.json`).
