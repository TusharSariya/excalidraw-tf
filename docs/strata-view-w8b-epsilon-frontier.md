# Strata W8b — candidate frontier + ε-constraint selection probe (Package B)

**Date:** 2026-07-12 · **Status:** Battery report (measurement only; REPORT cells — no gate asserted, **no δ silently chosen** — the codex adjudication of W8 requires δ to be swept as report arms and adjudicated by the owner).

W8 left an open causality question: under the rankSeparate substrate the packed scorer separates the owner's SQS↔Dynamo pair (496→1629 px) while the scorer's own tuple improves on **every** term ({273, 85, 954774} → {174, 73, 945236} on P1), so W8 did **not** observe a crossings-vs-penetrations veto in the final selection. The strict lexicographic comparator nevertheless has the structural property of an infinite exchange rate — one crossing outranks _any_ (penetrations, length) improvement — and the literature prices a crossing finitely: Ware et al. 2002 (corpus doc `doi-10-1057-palgrave-ivs-9500013`) measure a bounded per-crossing response-time cost, comparable to a bounded amount of path bendiness (the corpus paper is the authority for the exact quantities). W8b builds the instrument that settles whether that structural property has empirical bite here: a full dump of the descent's candidate frontier, plus an ε-constraint selection band (`strataPackedScoringEpsilon`) swept as report arms. ε-constraint selection bounds one objective and optimizes the rest — the standard alternative to committing to weighted-sum trade weights (multi-objective graph-drawing framings: corpus docs `s2-10-4230-lipics-gd-2025-53`, `arxiv-2112-01571v1`; readability-metric vocabulary: Dunne et al., `s2-10-1147-jrd-2015-2411412`).

## Document graph

| Relation | Link |
| --- | --- |
| Role | Battery + selector-semantics record |
| Status | Current |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`strata-view-w8-rank-scorer-factorial.md`](./strata-view-w8-rank-scorer-factorial.md) |
| Sisters | [`strata-view-w7-packed-scoring-battery.md`](./strata-view-w7-packed-scoring-battery.md) |
| Next (agent) | Owner adjudication of δ (0 stays default until ruled) |

## Selector semantics as shipped (`strataPackedScoringEpsilon`, default 0)

- **Strict rule unchanged.** A trial is adopted when it wins the existing strict lexicographic rule (crossings, penetrations, L1) vs the incumbent (`strataPackedScoreLess`). Exact ties keep the earliest candidate, as everywhere in Strata.
- **ε-band (only when ε > 0).** A trial may _also_ be adopted when `trial.crossings ≤ baselineScore.crossings + δ` **and** it strictly improves (penetrations, lengthL1) lexicographically over the incumbent.
- **Anti-ratchet (mandatory design constraint).** The crossings budget is **global vs the legacy baseline**, resolved once — never vs the rolling incumbent. An incumbent-relative budget would re-extend on every adoption and let crossings drift upward across hull visits; P1's ε=1 run demonstrates the budget binding mid-descent (an incumbent-relative rule would have admitted trials the shipped rule rejected).
- **δ resolution.** δ = ε when ε ≥ 1 (absolute integer crossings); δ = ⌈ε · baseline crossings⌉ when 0 < ε < 1 (relative mode — e.g. ε=0.01 resolves to δ=2 on P1 base [baseline 190], δ=3 on P1 RS [273], δ=1/2 on P2). ε ≤ 0 resolves to δ = 0.
- **Post-A7 guard shares the δ-band.** `chooseStrataRefinedPlacement` keeps the scored arm if it is lexicographically no worse (unchanged), **or** its final crossings are within `legacy final crossings + δ` and its (pen, L1) suffix is not worse than legacy's; else it falls back (`fellBack` meta kept). At δ=0 the band clause is a subset of the no-worse rule — bit-identical to the pre-W8b guard.
- **Termination.** The descent is structurally bounded (≤2 passes × fixed hull list × fixed per-hull candidate count). Additionally, every adoption strictly decreases a well-founded quantity: strict-lex wins decrease the (crossings, pen, L1) triple; ε-band wins strictly decrease the (pen, L1) pair over nonnegative integers while crossings stay inside the bounded set [0, baseline+δ] — no adoption cycle is possible and the pass-2 legacy-retry cannot oscillate.
- **Determinism.** Pure integer arithmetic except the single relative-mode `Math.ceil(ε × baselineCrossings)` (exact at the shipped 0.01 granularity); ε ≥ 1 is used as-is and expected to be an integer.
- **ε=0 is bit-identical to round 9** — proven by unit test (identical selections/score/placement fingerprint on the blind-spot fixture), by the end-to-end threading test, and by the W7/W8 regeneration byte-compare below.

Frontier instrumentation (Package B Task 1, report-only): `placeStrataHullsPackedScored` accepts an optional `onPackedTrial` collector (same injection pattern as `onPackedCandidateCount`); no collector ⇒ zero extra work, byte-identical flag-off path. The `strataPackedFrontierMeta` dev seam (harness-only, no UI/session/URL surface) echoes every trial's {hullId, candidateIndex, pass, score, adopted, adoptedVia} as `strataPackedScoringFrontierTrials`.

## Methodology

One harness run (`terraformPipelineStrataEpsilonFrontier.test.ts`, report-emitting, never asserts gates; seed 20260704 inside the shared bootstrap helpers; `softFailures: []`) over eight strata arms on P1 (`staging-extended-localstack-v2` compact) + P2 (`staging-localstack` compact), packed scoring ON everywhere: **P** (K4+A7+scorer, ε=0 — same options as W8's P), **P_e1/P_e2/P_er** (ε = 1 / 2 / 0.01 relative), and the rankSeparate row **P_RS / P_RS_e1 / P_RS_e2 / P_RS_er**. Cells: the W8 per-arm scalars (global crossings + angles, structural collisions, edge–box penetrations on FINAL geometry with the 2 px endpoint pad, owner-case SQS `aws_sqs_queue.regional_writer_west` → RDS and → Dynamo `aws_dynamodb_table.regional_events_west` centre px plus the pair |Δx|/|Δy|, wall-clock, packed meta incl. ε and effective δ), the **frontier dump** per preset+substrate (nondominated set over the ε=0 descent's recorded trials; collection proven non-perturbing by a frontier-off rebuild whose normalized summary — wall-clock and frontier fields excluded — is identical), and paired extent + M-RT path-family CIs vs the matching ε=0 arm (v3.2 floors; `gateEligible` forced false on voided or degenerate cells). Δ = candidate − baseline; negative = better. Regenerate:

```
Q8B_REPORT_DIR=<dir> yarn vitest run \
  packages/excalidraw/components/terraformPipelineStrataEpsilonFrontier.test.ts \
  --exclude "**/.claude/**"
```

## Per-arm scalars

| Arm | crossings | sharpShare | hull pen. | card pen. | rt̂ p50 / p90 (arm) | engine score (cr, pen, L1) | eff. δ | build ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **P1** P | 97 | 0.29 | 87 | 149 | 12.52 / 19.87 | 128, 91, 824320 | 0 | 12941 |
| **P1** P_e1 | 102 | **0.24** | 89 | 149 | 12.65 / 20.43 | 154, 89, 830536 | 1 | 13723 |
| **P1** P_e2 | 102 | 0.24 | 89 | 149 | 12.65 / 20.43 | 154, 89, 830536 | 2 | 13759 |
| **P1** P_er | 102 | 0.24 | 89 | 149 | 12.65 / 20.43 | 154, 89, 830536 | 2 | 13721 |
| **P1** P_RS | 151 | 0.35 | 65 | 138 | **12.22** / **19.96** | 174, 73, 945236 | 0 | 14306 |
| **P1** P_RS_e1 | 164 | 0.29 | **64** | 148 | 12.56 / 21.06 | 195, **64**, **920616** | 1 | 13928 |
| **P1** P_RS_e2 | 164 | 0.29 | 64 | 148 | 12.56 / 21.06 | 195, 64, 920616 | 2 | 14119 |
| **P1** P_RS_er | 164 | 0.29 | 64 | 148 | 12.56 / 21.06 | 195, 64, 920616 | 3 | 13617 |
| **P2** P | 24 | 0.71 | 33 | 97 | 11.53 / 18.70 | 24, 33, 307530 | 0 | 1970 |
| **P2** P_e1 / P_e2 / P_er | 24 | 0.71 | 33 | 97 | 11.53 / 18.70 | 24, 33, 307530 | 1 / 2 / 1 | ≈1970–2001 |
| **P2** P_RS | **75** | 0.21 | 32 | **91** | **12.45** / **20.26** | 91, 36, 299754 | 0 | 2036 |
| **P2** P_RS_e1 / e2 / er | 82 | **0.15** | 32 | 90 | 14.02 / 22.63 | 101, **32**, 305682 | 1 / 2 / 2 | ≈2014–2046 |

All arms: collisions 0, `fellBack:false`, `rcllV2Degraded` absent, trials 4667 (P1) / 1221–1222 (P2). ε=0 arms **P and P_RS reproduce W8's P and P_RS scalars exactly** (crossings 97/151, engine scores, owner distances — the ε plumbing at 0 is inert on the real batteries).

**δ sweep saturates at 1**: on every preset × substrate, ε=1, ε=2 and ε=0.01-relative produce byte-identical layouts (identical engine scores and scene scalars) — the band's useful admissions all sit within crossings ≤ baseline+1; a bigger budget changes nothing here. On P2 base the ε arms are identical to ε=0 outright (the band admits nothing).

## Owner case (P1 only; the pair does not exist in P2)

| Arm                | SQS→RDS px | SQS→Dynamo px | pair \|Δx\| | pair \|Δy\| |
| ------------------ | ---------- | ------------- | ----------- | ----------- |
| P                  | 675.79     | 496.00        | 496         | 0           |
| P_e1 / P_e2 / P_er | 675.79     | 496.00        | 496         | 0           |
| P_RS               | 1200.28    | **1629.33**   | 496         | **1552**    |
| P_RS_e1 / e2 / er  | 1200.28    | **496.00**    | 496         | **0**       |

**ε=1 fully restores the owner pair under the RS substrate**: SQS→Dynamo 1629.33 → 496.00 px, and the split is confirmed purely vertical — |Δx| stays 496 in every arm while |Δy| goes 1552 → 0 (matching W8's finding that the RS-era separation is vertical, not an X-rank split).

## Frontier dump — is the pair-adjacent layout present-but-rejected or absent-from-generator?

Nondominated sets over the ε=0 descent's recorded trials (score triples; earliest trial kept on exact-duplicate scores; `vsBaseline` = term-wise delta vs the legacy baseline). Full lists in the JSON; the load-bearing rows:

**P1 / P_RS (strict run; adopted winner {174, 73, 945236}).** 12 nondominated points; 8 are REJECTED trials that are strictly better than the adopted winner on the (pen, L1) suffix and lose **only** on the crossings term — e.g. `vpc-cb9aa19e8` c1 {180, **64**, 936778} (pen 73→64 at +6 crossings) and `us-east-1` c139 {177, **70**, 931806} (+3 crossings). The strict comparator rejected every one of them regardless of the size of the (pen, L1) gain.

**P1 / P (base substrate; adopted winner {128, 91, 824320}).** 7 nondominated points, 6 rejected — including `vpc-cb9aa19e8` c1 {134, **76**, **780844**}: 15 fewer penetrations and 43 k less L1 for +6 crossings, rejected on crossings alone.

**P2 / P_RS.** 8 nondominated, 5 rejected; e.g. `vpc-e4bd3cc8a` c1 {92, **24**, **287266**} — 12 fewer penetrations and 12 k less L1 than the adopted {91, 36, 299754} for +1 crossing.

**Verdict: present-but-rejected, not absent-from-generator.** Two independent lines: (i) in the strict run's own trial record, nondominated candidates with strictly better (pen, L1) exist at every substrate and are rejected exclusively by the crossings term — the comparator, not the candidate generator, is the binding constraint; (ii) the ε=1 arms use the **identical candidate generator** (same static candidate generator and counts — same sweep-snapshot + sift candidate sets; evaluated trial counts differ 1221→1222 on P2/RS via pass-2 legacy retries, consistent with the 1221–1222 range reported above) and reach a layout with the owner pair restored to 496 px — so pair-adjacent geometry is within the generator's reach and is excluded by _selection_. One honest caveat: the frontier records score triples, not per-trial pair distances, so we cannot point at the single ε=0 trial that "was" the owner-preferred layout; the present-vs-absent question is answered at the level of the selection rule (which is what the ε lever changes), not by exhibiting one rejected trial's geometry.

**Causality framing (codex adjudication of W8 honored).** W8's final P_RS tuple improved on all three terms, so W8 itself showed no veto; the infinite-exchange-rate property is a _structural_ comparator property whose empirical bite W8b was built to measure. Measured: the veto binds **mid-descent** — the strict rule forbids every (pen, L1)-improving step that costs even one crossing, which channels the descent to a different basin than the ε=1 rule; the ε=1 basin is the one that keeps the owner pair adjacent. The Ware-grounded position (a crossing has a finite price) is therefore operative here as a selection-dynamics effect, not as a final-tuple trade.

## Paired cells vs the matching ε=0 arm (n=500 / 265 paths; extent n=37 / 4 — P2 extent degenerate, gate-ineligible)

ε=1 ≡ ε=2 ≡ ε-relative (identical layouts), so one column per substrate:

| Cell (point [95% CI]) | P1 P→P_e\* | P1 P_RS→P_RS_e\* | P2 P→P_e\* | P2 P_RS→P_RS_e\* |
| --- | --- | --- | --- | --- |
| rt̂ p50 | 0.00 flat | 0.00 flat | 0.00 flat | **+0.67 [+0.65,+0.72] worse** |
| rt̂ p90 | **+1.84 [+1.73,+2.26] worse** | **+3.25 [+2.59,+3.32] worse** | 0.00 flat | **+3.38 [+3.19,+3.90] worse** |
| con p90 | +33.5 [+25.2,+50.0] worse | +13.5 [+5.8,+25.1] worse | 0.00 flat | +153.8 [+145.4,+160.9] worse |
| cr p90 | +2 [+2,+2] worse | +3 [+2,+4] worse | 0.00 flat | +2 [+1,+2] worse |
| tll p50 | 0.00 flat | 0.00 [−56.4, 0.00] | 0.00 flat | +35.3 [0,+463.3] worse |
| ext p50 | 0.00 flat | **−175.5 [−291.0, 0.00] impr** | degenerate | degenerate |
| ext p90 | +328.4 [+55.5,+548.6] worse | +227.5 [+226.2,+231.0] worse | degenerate | degenerate |

The owner-pair recovery is **not free**: on P1/RS the ε arms buy it with rt̂ p90 +3.25, cr p90 +3 and scene crossings 151→164, against slice-B extent p50 −175.5 improving, hull penetrations 65→64 and engine (pen, L1) strictly better; on P2/RS (no owner pair to rescue) the ε band is a pure M-RT regression (+0.67 p50 / +3.38 p90). On the base substrate the pair is already adjacent and ε only trades rt̂ p90 +1.84 for sharpShare 0.29→0.24 — nothing worth buying.

## Honesty box

- **REPORT-only.** No gate asserted; `strataPackedScoringEpsilon` defaults to 0 in every surface (engine, dialog, URL, session, share URL) and **no δ is silently chosen** — the sweep exists so the owner can adjudicate with the trade in view. The battery's own numbers argue _against_ a blanket nonzero default (P2/RS regresses with no benefit); if adopted at all, δ is a per-case lever.
- The frontier answers present-vs-rejected at the selection-rule level (score triples); per-trial owner-pair distances are not recorded (see caveat above).
- Frontier collection is proven non-perturbing: the frontier-off rebuild's normalized summary (buildMs and frontier fields excluded — "effective geometry and comparison cells identical") matches byte-for-byte; `softFailures: []` on both presets.
- `gateEligible` is forced false on voided or degenerate cells (P2 extent cells are degenerate at n=4 and marked accordingly).
- ε=0 inertness is verified three ways: unit bit-identity on the blind-spot fixture, W8b's P/P_RS arms reproducing W8's committed P/P_RS numbers, and full W7 + W8 regeneration (HEAD harness, current engine vs HEAD engine in a clean worktree) byte-identical apart from `buildMs` fields.
- All numbers in this document are from `W8B_EPSILON_FRONTIER_REPORT.json` (single run, seed 20260704).

## Bottom line

The packed scorer's candidate generator already produces pair-friendly, lower-penetration layouts; the strict crossings-first comparator rejects them — **present-but-rejected**. A crossings budget of just δ=1 vs the legacy baseline (anti-ratchet) restores the owner's SQS↔Dynamo adjacency under rankSeparate exactly (Δy 1552→0) and strictly improves the engine's (pen, L1), at a measured cost of rt̂ p90 +3.25 and +13 scene crossings on P1 — and a pure regression on P2/RS where there is no pair to rescue. δ saturates at 1 on both presets (ε=2 and relative ε=0.01 change nothing further). Default stays 0; the owner adjudicates whether the pair-locality win is worth the tail cost, and on which arms.
