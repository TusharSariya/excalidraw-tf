# Strata W8 — rank×scorer factorial battery (owner "everything ON" regression)

**Date:** 2026-07-12 · **Status:** Battery report (measurement only; REPORT cells — no gate asserted). Crosses the rank levers with the round-9 `strataPackedScoring` remedy after the owner ran K4+A7+rankSeparate+packedScoring and hit the P1/us-west-2 SQS↔DynamoDB separation (SQS→RDS crossing the unrelated `vpc-5b5` hull).

## Document graph

| Relation | Link |
| --- | --- |
| Role | Battery |
| Status | Current |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`rcll-v2-shit-test-round9.md`](./rcll-v2-shit-test-round9.md) + the owner "everything ON" screenshot investigation (this session; the screenshot itself is described in round-9 §owner case) |
| Sisters | [`strata-view-w5-repaired-stats-report.md`](./strata-view-w5-repaired-stats-report.md), [`strata-view-w7-packed-scoring-battery.md`](./strata-view-w7-packed-scoring-battery.md) |
| Next (agent) | Owner adjudication of a UX guardrail for the rankSeparate × packedScoring combination |

## Methodology

One harness run (`terraformPipelineStrataRankScorerFactorial.test.ts`, report-emitting, never asserts gates; seed 20260704 inside the shared bootstrap helpers; **arms I, P_RS and ALL each rebuilt end-to-end and verified deterministic on a normalized aggregate summary** — scalar counters, owner-case fields and cell values, with `buildMs` and the `strataToggleSuppressions` meta excluded (a summary-level check; emitted elements and full path rows are not re-compared) — plus the I→P cell recomputed byte-identical from a rebuilt I; `softFailures: []`) over seven strata arms on P1 (`staging-extended-localstack-v2` compact) + P2 (`staging-localstack` compact): **I** (sweeps:4 + coordinateRefine — the W7 baseline), **P** (I + `strataPackedScoring`), **I_NS** (I + `strataNetworkSimplexRank`), **P_NS**, **I_RS** (I + `strataRankSeparate`), **P_RS**, **ALL** (I + NS + RS + scorer). Cells: W7's per-arm scalars (battery global crossings + angles, structural collisions, edge–box penetrations on FINAL geometry with the 2px endpoint pad — a **non-normative probe metric `hullPenetrationsProbe`**, not the normative M-H counter), the owner case extended to **both** distances — SQS `aws_sqs_queue.regional_writer_west` → RDS and → Dynamo `aws_dynamodb_table.regional_events_west` centre px — plus the SQS↔Dynamo owner-pair **Δx / Δy between primaryCluster frame centres**, resolved the CANONICAL way (each node → the `primaryCluster` frame whose `customData.terraformPrimaryAddress` matches, the exact resolution `computeStrataPathMetrics` uses; the earlier leaf-card X-centre clustering heuristic is retired), engine meta echoes (packed-scoring selections/scores/trials/fellBack, rankSeparate applied/changed-rank counts, `strataToggleSuppressions`), wall-clock, and paired extent + M-RT path-family CIs (v3.2 discipline: p50 n≥10, p90 n≥31) for I→{P, I_NS, P_NS, I_RS, P_RS, ALL} and **I_RS→P_RS**. Δ = candidate − baseline; negative = candidate better. Regenerate: `Q8_REPORT_DIR=<dir> yarn vitest run packages/excalidraw/components/terraformPipelineStrataRankScorerFactorial.test.ts --exclude "**/.claude/**"`. **W5 and W7 re-runs byte-identical** after this battery's addition (cmp-verified).

## Per-arm scalars

| Arm | crossings | sharpShare | hull pen. | card pen. | collisions | rt̂ p50 / p90 (arm) | columns (meta) | build ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **P1** I | 123 | 0.41 | 115 | 206 | 0 | 13.36 / 21.39 | 16 | 2713 |
| **P1** P | **97** | **0.29** | 87 | 149 | 0 | 12.52 / 19.87 | 16 | 13674 |
| **P1** I_NS | 147 | 0.42 | 132 | 225 | 0 | 13.52 / 21.42 | 16 | 2802 |
| **P1** P_NS | 125 | 0.32 | 106 | 162 | 0 | 13.15 / 20.22 | 16 | 13932 |
| **P1** I_RS | 220 | 0.28 | 78 | 173 | 0 | 14.21 / 24.89 | 30 | 2792 |
| **P1** P_RS | 151 | 0.35 | **65** | **138** | 0 | **12.22** / 19.96 | 30 | 14645 |
| **P1** ALL | 151 | 0.35 | 65 | 138 | 0 | 12.22 / 19.96 | 30 | 14794 |
| **P2** I | 39 | 0.95 | 61 | 142 | 0 | 12.58 / 21.78 | 14 | 1213 |
| **P2** P | **24** | 0.71 | 33 | 97 | 0 | 11.53 / **18.70** | 14 | 1978 |
| **P2** I_NS | 39 | 0.95 | 61 | 142 | 0 | 12.58 / 21.78 | 14 | 1177 |
| **P2** P_NS | 24 | 0.71 | 33 | 97 | 0 | 11.53 / 18.70 | 14 | 1983 |
| **P2** I_RS | 104 | **0.15** | 38 | 96 | 0 | 15.08 / 23.76 | 17 | 1195 |
| **P2** P_RS | 75 | 0.21 | **32** | **91** | 0 | 12.45 / 20.26 | 17 | 2101 |
| **P2** ALL | 75 | 0.21 | 32 | 91 | 0 | 12.45 / 20.26 | 17 | 2052 |

Packed-scoring meta: `fellBack:false` on all four scorer arms × both presets; trials 4667 (P1) / 1221 (P2); e.g. P1 P scorer 190→128 internal crossings, P1 P_RS 273→174. NS on P2 is a complete no-op (`strataNetworkSimplexApplied:true` but every scalar and paired cell identical to I — all-zero CIs); NS alone on P1 is a regression (crossings 123→147, hull pen. 115→132).

## Owner case (P1 only; the pair does not exist in P2)

| Arm | SQS→RDS px | SQS→Dynamo px | pair \|Δx\| | pair Δy (signed) | pair \|Δy\| |
| --- | --- | --- | --- | --- | --- |
| I | 1303.09 | 535.37 | 496 | −201.5 | 201.5 |
| P | **675.79** | **496.00** | 496 | 0 | 0 |
| I_NS | 1519.25 | 496.00 | 496 | 0 | 0 |
| P_NS | 675.79 | 496.00 | 496 | 0 | 0 |
| I_RS | 1303.09 | 535.37 | 496 | −201.5 | 201.5 |
| P_RS | 1200.28 | **1629.33** | 496 | **−1552** | **1552** |
| ALL | 1200.28 | 1629.33 | 496 | −1552 | 1552 |

Δx/Δy are the SQS→Dynamo separation between their `primaryCluster` frame centres (canonical `terraformPrimaryAddress` resolution — no derived-column heuristic). The horizontal gap is **constant at \|Δx\|=496px in every arm** — the two nodes sit in adjacent X-columns throughout — so the entire RS-era separation is **vertical**: I_RS keeps the pair at Δy=−201.5 (same as I), while the scorer on the RS substrate (P_RS≡ALL) drives Δy to −1552 (region top vs region bottom, exactly the screenshot). hypot(496, 1552)=1629.33 reproduces the SQS→Dynamo distance exactly, so the frame-centre decomposition and the centre distance are the same measurement read two ways. (RS still rewrites the rank substrate — meta `pipelineColumnCount` 16→30 — but that rewrite does not move this pair apart in X; the split it enables is entirely in Y.)

## Paired cells vs I (n=500 / 265 paths; extent n=37 / 4 edges — P2 extent floor-ineligible)

**P1** (point [95% CI]; negative = better):

| Cell | I→P | I→I_NS | I→P_NS | I→I_RS | I→P_RS | I→ALL |
| --- | --- | --- | --- | --- | --- | --- |
| rt̂ p50 | **−0.50 [−0.57,−0.19]** | 0.00 flat | −0.19 [−0.50,0.00] | +0.83 [+0.59,+1.44] worse | **−0.93 [−1.10,−0.71]** | **−0.93 [−1.10,−0.71]** |
| rt̂ p90 | +1.08 [+1.00,+1.18] worse | +1.99 [+1.96,+2.48] worse | +2.82 [+1.98,+3.27] worse | +5.72 [+5.15,+6.64] worse | +2.29 [+1.87,+2.70] worse | +2.29 [+1.87,+2.70] worse |
| con p90 | +35.7 worse | +43.4 worse | +52.1 worse | +7.8 worse | +13.1 worse | +13.1 worse |
| cr p90 | +1 worse | +3 worse | +3 worse | +11 worse | +5 worse | +5 worse |
| tll p50 | −62.8 [−167.7,0] | 0.00 flat | **−235.6** impr | **−218.3** impr | **−691.3** impr | **−691.3** impr |
| ext p50 | −115.5 parity | 0.00 flat | −231 parity | **−806 [−1037,−178]** impr | **−522 [−575,−86]** impr | **−522** impr |
| ext p90 | +351 worse | +231 parity | +575 worse | +635 worse | +817 worse | +817 worse |

**P2**: I→I_NS all-zero (NS no-op). I→P = I→P_NS exactly (rt̂ p50 −0.52 [−0.60,−0.39] impr; rt̂ p90 +0.16 worse; con p90 +31.7 worse; cr p90 flat). I→I_RS: rt̂ p50 +1.30 worse, rt̂ p90 +6.25 worse, cr p90 +10 worse, tll p50 −800.8 impr. I→P_RS = I→ALL: rt̂ p50 −0.13 parity, rt̂ p90 +3.81 worse, con p90 +59.9 worse, cr p90 +6 worse, tll p50 −1725.7 impr.

**The within-RS scorer pair (the guardrail question):**

| I_RS→P_RS | P1 | P2 |
| --- | --- | --- |
| rt̂ p50 | **−1.63 [−1.85,−1.44]** improving | **−2.24 [−2.61,−1.92]** improving |
| rt̂ p90 | +0.69 [+0.42,+0.96] worse | +0.48 [−0.02,+1.36] parity |
| con p90 | +25.8 [+24.2,+31.7] worse | +45.0 [+33.8,+66.4] worse |
| cr p90 | +1 [+1,+1] worse | +2 [+1,+3] worse |
| tll p50 | **−204.5** improving | **−362.9** improving |
| ext p50 / p90 | −18.8 parity / +436.9 worse | floor-ineligible (n=4) |

## Findings

**(i) Does RS-on reproduce the screenshot separation?** Yes — but only in the scorer-on RS arms, and vertically, not as an X-column split. Under RS the SQS→RDS distance never approaches W7's 676px fix: I_RS 1303.09px, P_RS/ALL 1200.28px — 1.78× the P arm's 675.79px. The SQS↔Dynamo pair stays together in I_RS (535.37px, same as I) but blows apart to **1629.33px in P_RS/ALL** (3.3× the P arm's 496.00px) — the owner's "everything ON" build is the ALL arm, and its numbers reproduce the regression. The canonical frame-centre Δx/Δy decomposition shows the pair's horizontal gap is **constant at \|Δx\|=496px in every arm** (adjacent X-columns throughout), so the separation is entirely vertical: I_RS holds Δy=−201.5 (as arm I), while P_RS/ALL drive Δy to −1552 — SQS region-bottom, Dynamo region-top, matching the screenshot. **What the data establish:** turning the scorer on over the RS substrate SELECTS a placement that pushes the owner pair apart in Y, and W7's owner-fix arrangement reproduces exactly on the non-RS substrates (P, P_NS both 675.79px) but on no RS arm. rankSeparate does rewrite the rank substrate before scoring (meta `pipelineColumnCount` 16→30, `strataRankSeparateChangedRankCount:112` on P1), and rank is fixed before within-rank ordering/positioning in a layered pipeline ([`gansner-tse93`]; cluster-boundary constraints further restrict reachable orderings, [`forster-compound-crossing-gd2002`], [`openalex-w1530155803`]) — so the scorer cannot itself undo rank. **What the data do NOT yet establish** is *why* the scorer's objective picks the split placement: no crossing-vs-penetration veto was observed at selection time. On P1 the scorer's own winning tuple improved on **every** term under RS (`{crossings 273, penetrations 85, lengthL1 954774}` → `{174, 73, 945236}`), so the split arrangement was chosen while strictly dominating the baseline on all three lexicographic keys, not by a one-crossing veto overriding a length/penetration win. Whether the split placement is *present-but-rejected* vs *absent-from-the-generator* — i.e. the true objective-causality — is deferred to the Package-B candidate-frontier battery (W8b), which instruments the candidate set and prices the trade-off directly. (The comparator's lexicographic crossings-first ordering IS structurally an infinite exchange rate — one extra crossing outranks any penetration/length gain, a price Ware 2002's finite ≈0.65s/crossing vs ≈38° cost does not support, [`doi-10-1057-palgrave-ivs-9500013`] — but that is a property of the comparator, not a proven mechanism for this case.)

**(ii) Does packedScoring still help under RS (I_RS→P_RS)?** Globally, yes — decisively at the median and on every global counter: crossings 220→151 (P1) and 104→75 (P2), hull penetrations 78→65 / 38→32, card penetrations 173→138 / 96→91, rt̂ p50 CI-improving on both presets (−1.63 and −2.24), tll p50 improving on both. But the W7 paired-tail churn signature persists (con p90 +25.8/+45.0 worse, cr p90 +1/+2 worse, P1 rt̂ p90 +0.69 worse, P1 extent p90 +436.9 worse), and — the decisive point for the guardrail — the scorer does **not** fix the owner case under RS; it is the arm where the owner pair separates (535→1629px). Per [`doi-10-1057-palgrave-ivs-9500013`] (Ware 2002: crossings-on-the-path and path continuity dominate response time, not total crossings), the global-counter wins do not compensate a specific task-path regression, which is exactly what the owner experienced. So: helps globally, cannot undo rank, worsens the trigger pair.

**(iii) ALL-arm suppression meta.** `strataToggleSuppressions: ["rank-floor-conflict-rankseparate-wins-network-simplex"]` on both presets, `strataNetworkSimplexApplied:false`, and every ALL cell — scalars, owner case, packed-scoring scores/selections, paired CIs — matches P_RS on **effective geometry and comparison cells** on both presets. (ALL and P_RS are *not* byte-identical in the raw summary: ALL carries the populated suppression list and a different `buildMs`. The harness normalizes those two fields out and byte-compares the remainder, which is identical — the check is now asserted in the softFailures gate.) The suppression behaves exactly as documented: with everything on, the user is effectively running P_RS.

**Secondary observations.** (a) NS is inert on P2 (all-zero paired cells) and a mild regression alone on P1 (123→147 crossings) — its value, if any, is not visible in this battery. (b) RS buys what it was built for — extent/height (P1 ext p50 −806 improving, tll p50 improving everywhere, sharpShare 0.95→0.15 on P2) — at a large crossings/tail cost (P1 rt̂ p90 +5.72, cr p90 +11), consistent with the W4 report's framing of rankSeparate as a height lever with global side-costs. (c) The scorer recovers a large share of RS's crossing cost (P_RS vs I: +28 crossings vs I_RS's +97 on P1) but none of its owner-case cost.

## Guardrail evidence

The W7 validation of `strataPackedScoring` was performed on the I substrate only, and its owner-case win (676px) is **conditional on that substrate**: every non-RS scorer arm reproduces it exactly (P and P_NS both 675.79px — NS does not disturb it), and every RS arm loses it. A UX guardrail on the rankSeparate × packedScoring combination (warn, or suppress one lever, mirroring the existing NS-vs-RS suppression) has factorial evidence: the combination is the unique cell where the round-9 trigger case regresses past its I baseline.

## Honesty box

Two presets, no held-out state, owner-N=1 (R8-F11 stands). The owner case exists only on P1; every SQS/Dynamo statement is a single-pair, single-preset observation. The SQS↔Dynamo Δx/Δy are between `primaryCluster` frame centres resolved canonically by `terraformPrimaryAddress` (the same resolution `computeStrataPathMetrics` uses) — engine truth, not a clustering heuristic; hypot(Δx,Δy) reproduces the centre distance exactly, so the decomposition is a check on itself. The edge–box penetration cells are the W7 battery probe (2px endpoint pad) surfaced as the **non-normative `hullPenetrationsProbe` metric — NOT the normative round-9 M-H counter, whose exact-zero prerequisite remains OUTSTANDING** (see the gate register); nothing here registers or closes M-H. TFD arrows are measured on emitted straight geometry. The vertical-separation reading in (i) is inferred from the Δx/Δy decomposition, not from a rendered screenshot diff. The *objective-causality* behind the RS-scorer split (present-but-rejected vs absent-from-generator) is explicitly NOT settled here — it is deferred to the Package-B candidate-frontier battery (W8b). P2 extent cells are floor-ineligible (n=4). Literature citations ground the mechanism framing, not the numbers, and the infinite-exchange-rate claim describes the comparator's structure, not a proven cause of this case; all numbers are from `W8_RANK_SCORER_REPORT.json`.

## Bottom line

**The owner's regression is a rank×scorer interaction, isolated factorially: the split appears only when the scorer runs over the rankSeparate substrate (`P_RS`≡`ALL`) — it separates the owner's SQS/Dynamo pair vertically (\|Δx\| stays 496px, \|Δy\| 201.5→1552px; SQS→Dynamo 496→1629px) while SQS→RDS stays at 1200px vs the 676px fix, and W7's owner fix reproduces exactly on both non-RS scorer arms (P, P_NS: 675.79px) and on no RS arm.** rankSeparate rewrites the rank substrate (16→30 columns, 112 changed ranks) before scoring, and rank is fixed before within-rank ordering, so the scorer cannot itself undo it. What is NOT established here is the objective-level *cause* of the split: on P1 the scorer's winning tuple strictly improved on all three lexicographic terms (crossings 273→174, penetrations 85→73, L1 954774→945236), so no crossing-vs-penetration veto was observed — whether the fix arrangement is present-but-rejected or absent from the candidate generator is deferred to the Package-B candidate-frontier battery (W8b). The scorer itself stays healthy under every substrate on global counters (crossings/penetrations/median trace all improve, both presets, fellBack never fired); the regression was observed only in the RS×scorer arms. Recommendation: ship the UX guardrail (warn or suppress on rankSeparate+packedScoring, with this report as evidence), run W8b to price the trade-off before touching the comparator, and keep W7's adjudication scoped to the I substrate it was measured on.

Raw JSON: regenerate deterministically via the run command in Methodology (session copy: scratchpad `w8/W8_RANK_SCORER_REPORT.json`).

### Literature (graph-layout-rag corpus doc IDs)

- `gansner-tse93` — Gansner et al., *A method for drawing directed graphs* (network-simplex rank assignment; phase ordering).
- `forster-compound-crossing-gd2002` — Forster, compound/cluster crossing minimization under cluster constraints.
- `openalex-w1530155803` — Forster dissertation, crossings in clustered level graphs.
- `doi-10-1057-palgrave-ivs-9500013` — Ware et al. 2002, cognitive measurements of graph aesthetics (crossings-on-path/continuity dominate).
- `s2-10-1147-jrd-2015-2411412` — Dunne et al., readability metric workbench (global-counter vs per-path aggregation).
