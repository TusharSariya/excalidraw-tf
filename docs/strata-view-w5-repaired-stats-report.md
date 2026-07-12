# Strata W5 — repaired-statistics battery + first M-RT (impact-tracing) numbers

**Date:** 2026-07-12 · **Status:** Battery report (measurement only; adjudicated into [`rcll-v2-spec-v3.2.md`](./rcll-v2-spec-v3.2.md) per SDEC-55). Follows round 8 (R8-F1) and the v3.2 gate-family proposal's minimal slice.

## Document graph

| Relation | Link |
| --- | --- |
| Role | Battery |
| Status | Current |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`rcll-v2-gate-family-v3.2-proposal.md`](./rcll-v2-gate-family-v3.2-proposal.md) |
| Sisters | [`strata-view-w3-battery-report.md`](./strata-view-w3-battery-report.md), [`strata-view-w4-extent-report.md`](./strata-view-w4-extent-report.md) |
| Next (agent) | Adjudicated — findings codified in [`rcll-v2-spec-v3.2.md`](./rcll-v2-spec-v3.2.md) (SDEC-55): default flip §6, RS relabel §5, OD-15 re-scope §7, task-evidence precondition §8 |

## Methodology

One harness run (`terraformPipelineStrataRepairedStats.test.ts`, report-emitting, never asserts gates; deterministic — seed 20260704, double-compute verified byte-identical) re-measures the W3/W4 comparison cells with the **statistic-repaired bootstrap** (CI computed ON p50 / ON p90 per v3.2, not the legacy mean) and produces the **first M-RT numbers**: Ware et al. 2002's path-cost regression (`rt̂ = 1.390·hops + 0.01699·con + 0.654·cr + 0.295·br`) over the deterministic unique-shortest 2–5-hop dependency-path population (P1: 746 paths → 500 sampled, 98% edge coverage; P2: 265 paths, 100% coverage; 0 unresolved paths anywhere). Arms: `A_v2_baseline` vs `G_strata_k0` (the shipping default), `H_strata_k4`, `I_strata_k4_a7` (V2-validated), `J_strata_k4_a7_rs` (W4-accepted). Compact mode, P1+P2. Full mode skipped: W3's slice-classification asymmetry voids the extent pairing and ancillary extraction changes the path digraph — a full-mode path battery needs its own design. Δ = candidate − baseline; negative = Strata better. Regenerate: `Q2_REPORT_DIR=<dir> yarn vitest run packages/excalidraw/components/terraformPipelineStrataRepairedStats.test.ts --exclude "**/.claude/**"` → `W5_REPAIRED_STATS_REPORT.json`.

## P1 compact (staging-extended-localstack-v2; nB=37, 500 paths)

### Slice-B extent, repaired statistics (px)

| vs v2 | p50 CI (repaired) | p90 CI (repaired) | mean CI (legacy, W4's statistic) |
| --- | --- | --- | --- |
| G (K0, **default**) | +4558 [+115, +5098] | +17335 [+13464, +17800] | +5050 [+3125, +7303] |
| H (K4) | +324 [−70, +770] | +6726 [+3966, +7006] | +1008 [−79, +2282] |
| I (K4+A7) | +324 [−301, +770] | +6726 [+3966, +7006] | +1005 [−76, +2276] |
| **J (K4+A7+RS, W4 arm)** | +337 [−389, +796] | **+3161 [+1252, +3659]** | −112 [−956, +784] |

**The W4 "statistical parity" claim does not survive the repaired statistic.** The mean CI straddles zero (the W4 result), but the p90 CI on the same arm is **entirely on the worse side** — the tail is confirmed +1,252…+3,659px worse than v2, not at parity. p50 is genuine parity for all K4 arms.

### M-RT (Ware predicted tracing cost, paired Δ per path; n=500)

| vs v2 | Δrt̂ p50 CI | Δrt̂ p90 CI | Δcon p90 | Δcr p90 | Δtll p50 (px) |
| --- | --- | --- | --- | --- | --- |
| G (K0, **default**) | +2.68 [+2.22, +3.08] | +6.68 [+6.32, +7.45] | +103 [+93, +116] | +9 [+8, +10] | +2476 |
| H (K4) | −0.03 [−0.30, +0.10] | +2.17 [+1.78, +2.46] | +87 [+69, +109] | +2 [+1, +2] | +653 |
| **I (K4+A7)** | **−0.27 [−0.48, −0.05]** | +2.07 [+1.78, +2.22] | +87 [+73, +101] | +2 [+1, +2] | +653 |
| J (+RS) | +0.25 [+0.06, +0.64] | +4.61 [+4.26, +4.97] | +58 [+48, +84] | +7 [+6, +8] | +1387 |

First task-grounded result: **I (K4+A7) is statistically BETTER than v2 at the median predicted trace** (CI excludes zero, improving) — the first cell in the project's history where Strata beats v2 on a readability statistic. But every arm is **worse at the p90 tail** (hard traces get harder), and adding rankSeparate flips even the median win into a loss.

### Scene scalars

| Arm | crossings | sharpShare (<30°) | p10 θ | min θ |
| --- | --- | --- | --- | --- |
| v2 | 177 | 0.28 | 13.8° | 1.7° |
| G (K0) | 273 | 0.66 | 8.7° | 1.3° |
| H (K4) | 136 | 0.39 | 8.7° | 1.3° |
| I (K4+A7) | 123 | 0.41 | 8.7° | 1.3° |
| J (+RS) | 220 | 0.28 | 15.9° | 3.5° |

Strata's ordering wins global crossings (123 vs 177) but its banded geometry makes the surviving crossings **sharper** (41% vs 28% below 30°). rankSeparate is the mirror image: more crossings (220) but much healthier angles.

## P2 compact (staging-localstack; nB=4 — extent report-only per §2.5 floors; 265 paths)

Extent: all arms far worse (G p90 point +8180; J +3796), every quantile CI degenerate at n=4 and **correctly gate-ineligible** under the repaired floors — reported, not gated.

| M-RT vs v2 | Δrt̂ p50 CI | Δrt̂ p90 CI | crossings | sharpShare |
| --- | --- | --- | --- | --- |
| G (K0) | +1.07 [+0.59, +1.39] | +3.85 [+3.61, +4.01] | 39 (v2: 33) | 0.95 (v2: 0.48) |
| H (K4) | +0.99 [+0.56, +1.31] | +3.56 [+3.10, +3.87] | 39 | 0.95 |
| I (K4+A7) | +0.98 [+0.56, +1.25] | +3.15 [+2.79, +3.56] | 39 | 0.95 |
| J (+RS) | +2.64 [+2.06, +3.10] | +7.58 [+7.05, +8.02] | 104 | 0.15 |

**P1's median win does not generalize:** on P2 every Strata arm is worse than v2 on M-RT at both statistics, K=4 barely moves the needle (its sweeps find little to improve in P2's structure), and 95% of Strata's crossings are sharp.

## Findings — the foundational questions

**(a) Does K4+A7+RS reach honest-p90 extent parity? — REFUTED.** The W4 acceptance was made on the mean CI; the CI computed ON p90 for the same arm is [+1252, +3659], entirely worse. "Statistical parity" should be restated as: parity at the median, confirmed regression at the tail. (P2 is floor-ineligible, n=4.)

**(b) Does Strata beat/match v2 on M-RT? — WEAKENED (one real win, tails and P2 against).** I (K4+A7) beats v2 at the P1 median — driven by crossings-on-path (Δcr p50 −2; the K=4 ordering genuinely clears clutter off typical paths). But p90 is worse in every cell on both presets (+2.07 best case ≈ +2s predicted on hard traces per Ware's scale), continuity tails are worse everywhere (+58…+103° at p90), and path geometric length is uniformly longer (banded verticality stretches trace geometry: Δtll p50 +653…+2476px). On P2 no arm matches v2 at all.

**(c) Do K=4 and A7 earn their keep? — SUPPORTED.** K=4 is the single biggest task-metric lever in the system: it converts the default arm's decisive loss (Δrt̂ p50 +2.68) into parity (−0.03), halving crossings (273→136). A7 adds a further consistent median gain (−0.03→−0.27) at zero component cost. This is the strongest empirical justification either optimization has received — and it damns the K=0 default (finding f).

**(d) Does rankSeparate help or hurt the task? — HURTS (accepted on the wrong metric).** RS was accepted at V3 on extent alone. On path metrics it flips I's median win to a loss (−0.27→+0.25 P1; +0.98→+2.64 P2), nearly doubles crossings (123→220 P1; 39→104 P2), and puts +5…+8 on Δcr p90 — while genuinely improving the extent tail (+6726→+3161) and crossing angles (sharpShare 0.41→0.28; 0.95→0.15). RS is a *trade*, not a win: height and angles bought with tracing quality. Its "must ship WITH K=4" pairing and the V3 acceptance should be revisited once a joint constrained-NS formulation (round-8 R8-F9) is probed — the current sequential composition may be paying an avoidable crossings bill.

**(e) Crossing angles: banded geometry vs v2 — WEAKENED for Strata's shipped arms.** All non-RS Strata arms have sharper crossings than v2 (P1: 0.39–0.66 vs 0.28 sharpShare; P2: 0.95 vs 0.48). The band model compresses vertical room, forcing shallow-angle crossings — an effect the extent-centric family never saw. Only RS fixes it, at cost (d).

**(f) Bonus, re round-8 R8-F5:** the shipping default (K0) is the worst arm on every single metric measured — extent, M-RT, crossings, angles. The opt-in-default decision ships users the one configuration all evidence says is inferior.

## Bottom line

Are the foundational Strata decisions good, per this evidence? **Mixed, now with task-level resolution.** The **ordering machinery (K=4+A7) is validated** — it produces the project's first genuine task-metric win over v2 and should be the view default, not opt-in. The **band model is under real strain**: it costs tail extent (a), path length and continuity tails (b), and crossing angles (e) — its compensating benefit (hierarchy legibility) is real but unmeasured by any current metric. **rankSeparate's W4 acceptance looks like single-metric tunnel vision** — it should be re-labeled a height/angle-vs-tracing trade-off pending an R8-F9 joint-solve probe. **OD-15 (subnet de-band) remains mis-aimed**: the new evidence says the binding constraints are continuity tails, path stretch, and sharp angles from band geometry — provider/account-level structure, exactly where round 8 said the residual lives. Caveats: two AWS presets, no held-out state, owner-N=1 history (R8-F11 stands); rt̂ weights are literature-derived engineering weights — component metrics are reported alongside so no conclusion rests on the exact coefficients.

Raw JSON: regenerate deterministically via the run command in Methodology (session copy: scratchpad `W5_REPAIRED_STATS_REPORT.json`).
