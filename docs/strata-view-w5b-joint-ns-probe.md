# Strata W5b — joint constrained network-simplex probe (round-8 R8-F9)

**Date:** 2026-07-12 · **Role:** Battery (probe) · **Status:** Current · **Verdict: NO-GO on replacing sequential rankSeparate — but R8-F9's feasibility claim is CONFIRMED.**

## Document graph

| Relation | Link |
| --- | --- |
| Role | Battery |
| Status | Current |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`strata-view-w5-repaired-stats-report.md`](./strata-view-w5-repaired-stats-report.md) (verdict (d) motivated this probe) |
| Sisters | [`rcll-v2-shit-test-round8.md`](./rcll-v2-shit-test-round8.md) (R8-F9) |

## Question under test

Round-8 R8-F9: the v1 evidence (RFC DI-NS-4) only falsified the **sequential** composition (NS over the original graph AFTER rankSeparate destroys sibling X-disjointness, +149% height). Gansner's formulation permits solving ONCE over the **augmented** graph — real dependency edges with multiplicity weights PLUS the all-to-all sibling-separation edges as **zero-objective-weight constraint edges** (λ(b) ≥ λ(a)+1 enforced, contributing nothing to Σ w·span). Does that joint solve keep rankSeparate's height/angle win while avoiding its crossings/M-RT bill (W5 verdict (d))?

## Method

- `computeNetworkSimplexDepths` gained an optional `zeroWeightEdges` param (absent ⇒ byte-identical; zero-weight edges join feasibility, tight-tree growth, pivots, and the balance window, never the objective).
- `collectStrataSeparationConstraints` exported from the RS module (pure refactor; existing 35 rank/RS tests green).
- New experimental module `terraformPipelineStrataJointNsProbe.ts` (`computeStrataJointNsFloor`): start floor = the accepted sequential separated floor; verify-or-abort against BOTH edge sets; observable fallbacks.
- Engine flag `strataJointNsRank` (default off, harness-only, threaded through the sceneContext literal per the C6′ seam rule) — arm X = K4+A7+RS+jointNS.
- Harness: `terraformPipelineStrataJointNsProbe.test.ts` (report-emitting, never asserts gates). Raw JSON: `W5B_JOINT_NS_PROBE_REPORT.json` (regenerate via the run command in the header). All harness health checks clean; **no constraint-violated fallback on either preset** — the joint floor satisfied every separation constraint.

## Results (Δ CIs are paired per-key deltas, negative = candidate better)

### P1 compact (staging-extended-localstack-v2)

| Arm | crossings | sharpShare | height | width | jointNS meta |
| --- | --- | --- | --- | --- | --- |
| A (v2) | 177 | 0.28 | 10,056 | 9,998 | — |
| I (K4+A7) | 123 | 0.41 | 19,066 | 8,038 | — |
| J (+RS sequential) | 220 | 0.28 | 14,126 | 14,898 | — |
| X (+jointNS) | 217 | 0.36 | 14,105 | 14,898 | applied; realSpan 544→509 |

| Cell       | extent p90 CI     | rt̂ p50 CI      | rt̂ p90 CI      | cr p90 CI |
| ---------- | ----------------- | -------------- | -------------- | --------- |
| A vs J     | [+1252, +3659]    | [+0.06, +0.64] | [+4.26, +4.97] | [+6, +8]  |
| A vs X     | [+1704, +5695]    | [+0.62, +1.56] | [+5.02, +6.61] | [+8, +10] |
| **J vs X** | **[+693, +2534]** | [0, +0.33]     | [+4.47, +5.36] | [+6, +7]  |

**P1: the joint solve is strictly worse than sequential RS** on the extent tail, the M-RT median and tail, and crossings-on-path — despite achieving its own objective (real span −6.4%) and near-identical height. Compressing real rank spans packs more arrows into fewer columns, and the path metrics pay for it.

### P2 compact (staging-localstack)

| Arm | crossings | sharpShare | height | width | jointNS meta |
| --- | --- | --- | --- | --- | --- |
| A (v2) | 33 | 0.48 | 5,734 | 8,672 | — |
| I (K4+A7) | 39 | 0.95 | 12,106 | 7,046 | — |
| J (+RS sequential) | 104 | 0.15 | 7,846 | 8,478 | — |
| X (+jointNS) | 84 | 0.17 | 7,153 | 8,478 | applied; realSpan 141→135 |

| Cell | extent p90 CI | rt̂ p50 CI | rt̂ p90 CI | cr p90 CI |
| --- | --- | --- | --- | --- |
| A vs J | [+1178, +3796] | [+2.06, +3.10] | [+7.05, +8.02] | [+10, +11] |
| A vs X | [+1871, +2410] | [+2.38, +3.54] | [+5.83, +6.98] | [+9, +11] |
| **J vs X** | **[−1386, +693]** (straddles 0) | [0, 0] | [+3.19, +5.40] | [+5, +8] |

**P2: mixed.** X beats J on aggregates — global crossings 84 vs 104, height −693px, better rt̂ tail vs the v2 baseline — but the paired per-path delta tail (J vs X rt̂ p90, cr p90) shows a subset of paths getting materially worse, and the extent cell straddles zero.

## Verdict

**NO-GO on replacing sequential rankSeparate with the joint solve** — no dominance: P1 strictly worse on every path metric; P2 mixed (aggregate wins, per-path-tail losses). The sequential RS arm J stands as measured in W5.

**But R8-F9's technical claim is CONFIRMED:** the joint constrained-NS formulation is viable — it solved on both presets, preserved every sibling-separation constraint (zero `constraint-violated` fallbacks), and minimized its objective. The current mutual-exclusion rule's _stated_ justification ("cannot compose", DI-NS-4) should be corrected in a future amendment: the truth is "composes fine, doesn't help" — an evidence-based rejection, not an infeasibility. The deeper W5 lesson is reinforced: **rank-span compression (any NS objective) is the wrong lever for path readability** — shorter spans densify columns and put more crossings on traced paths. Closes the R8-F9 open item.

Caveats: same two AWS presets as W5 (R8-F11 stands); the joint solve was seeded from the sequential floor (a cold-start joint solve could land elsewhere, but the simplex optimum for this objective is unique up to balance ties, so the seeding is not load-bearing).

## Files (working tree, uncommitted)

`terraformPipelineLayoutShared.ts` (additive `zeroWeightEdges` param) · `terraformPipelineStrataRankSeparate.ts` (exported constraint collection, pure refactor) · `terraformPipelineStrataJointNsProbe.ts` + `.test.ts` (new, experimental) · `terraformPipelineStrataRank.ts` / `terraformPipelineStrataTypes.ts` / `terraformPipelineStrata.ts` / `terraformLayoutCore.ts` / `terraformPlanParsing.tsx` (default-off flag threading + meta echo).
