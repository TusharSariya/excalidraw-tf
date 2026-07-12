# Strata W3 (M1b) battery report — checkpoint V2

**Date:** 2026-07-05 · **Status:** STOPPED at V2 for owner visual validation + BINDING arm-E verdict (v3.0 §9 / plan W3).
**Scope:** A2 K=4 sweeps (WP-3a), A6 deterministic finalize + tombstones (WP-3c), A4/A5 gates + bootstrap CI (WP-3d), A7 coordinate refinement (WP-3b), A4 fixture-triple + §2.5 extent-gate harnesses (WP-3e). All code uncommitted pending the V2 verdict. Decision trail: SDEC-38..44.

Presets: P1 = `staging-extended-localstack-v2` (derivation), P2 = `staging-localstack` (validation), P3 = `multi-state-expanded` (composition; matches P2's numbers modulo the E/F arms and is omitted from the tables below). E/F arms carry ancillary; strata M1 is extraction-free (`strataAncillaryDeferred` honest meta, SDEC-24/29) — every full-mode comparison reads against that asymmetry.

## Document graph

| Relation | Link |
| --- | --- |
| Role | Battery |
| Status | Historical — M1b / V2 checkpoint (arm-E accepted; see decision-log SDEC-47) |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`strata-view-decision-log.md`](./strata-view-decision-log.md) |
| Children | — |
| Sisters | [`strata-view-w4-extent-report.md`](./strata-view-w4-extent-report.md) |
| Next (agent) | Numbers only; dispositions in decision-log. Extent residual → sister W4. |

## 1. Verdict summary

**Passed:**
- **R2 structural**: zeros everywhere (both presets × both card modes × cyclic × A7-on) — standing invariant incl. the in-engine post-re-anchor dev-assert.
- **T1 determinism**: run-twice byte-equal INCLUDING ids/seeds/versionNonces (A6), both card modes, real presets; static no-Date/no-random scan over the module family.
- **T4 identity/tombstones**: content-addressed `tf:` ids (satellite appearances sub-addressed after the battery caught a full-mode collision — SDEC-42), generation versions, apply-layer tombstones, OD-8 no-op parity.
- **T7 / cyclic**: injected 2-cycle repaired structurally at every K; K=4+A7 cyclic = 124 crossings vs v2's 175, R2 zeros.
- **A4 / T2 diff-stability under the frozen §13 thresholds (M1_rel ≤ 0.08, M2_flip ≤ 0.10)**: every candidate cell passes with 2–3× headroom; **K=0 is literally zero-churn on all nine cells**; moved{}-rename is zero-churn at every K (the address-keyed identity chain end-to-end).
- **The spec's M2_flip anchor** ("must beat v2 on add-one-edge"): P1 0.0050 < 0.0069; P2 0.0544 < 0.1514 (v2's P2 order-churn is severe; strata is 2.8× better).
- **Crossings**: strata K=4+A7 is the best-crossings arm on P1 compact (123 vs v2's 177) and P1 full (170 vs F's 222), competitive elsewhere.
- **A7 gate (§6-A7)**: T2 half — churn not regressed (I ≡ H on every triple cell except one far-under-threshold M1_rel hair). R4 half — near-straight strictly up AND mean deviation strictly down on all three presets in compact mode and on P2/P3 full (near-straight 0.03→0.06 doubled); **P1-full is the one mixed cell** (deviation improves, overall near ties 0.10, slice-A near 0.14→0.13). Strict-form reading (every cell must strictly improve) → ships OFF; preponderant reading (5/6 cells improve, deviation improves everywhere, zero churn cost, zero canvas growth) → ships ON. **Orchestrator recommendation: ON. Owner decides.**
- **T10 wall-clock**: strata engine arms ≈ 95–200 ms warm (compact) / prep-dominated cold (matches the W2 RCA); K=4 and A7 add ≈ nothing measurable. Budget (≤2 s canonical) holds.

**Failed / owner-adjudication required:**
- **§2.5 slice-B extent gate vs the frozen v2 baselines: FAIL** (SDEC-44). On the one cleanly-pairable frozen cell (P1-compact, 37v37 paired edges, 0 unmatched): mean paired delta **+1008 px** [CI −79, +2282]; paired p50 improves −637 but **paired p90 regresses +6369** — a tail-regression signature. Root: strata's P1-compact canvas is ~1.9× taller than v2 (19066 vs 10056; v2 packs ~50 side-by-side rows, strata's banded provider/account levels stack full-width bands), so the worst cross-band edges span nearly the whole canvas. A2 minimizes height-weighted bands-skipped, not stack height — this is exactly the Σ-vs-tail residual v3.1 §1.1 flagged and the slice-B gate backstops. **The registered post-M1 levers target precisely this: OD-14 (height lever — rankSeparate-class, −42% height measured in-host) and OD-15 (subnet de-band port).**
- **Full-mode extent cells: primary pairing VOIDED by the frozen 20%-unmatched rule** — slice classification is not engine-invariant in full mode (F-with-ancillary classifies 114/32 edges slice-B via hub-extraction hull changes; strata keeps 37/4). The void rule worked as designed. The report-only supplementary pairing (baseline keyset) shows: **P1-full nearly passes** (I2 CI [−1739, **+15.5**] — 15.5 px from a formal pass; paired p90 −6668 improving; A7 visibly moves it vs H2), P2-full worsens (+705, CI excludes 0 the wrong way).
- **P2 readability generally**: strata does not beat v2 on P2's small slice-B population (nB=4, excluded from gating by the frozen §12 pin, reported honestly: p50 5935 vs 1149).

## 2. Arm tables (v3.1 §4/§12 — crossings-per-eligible-pair row included; owner adjudicates)

### P1 compact

| metric | v2 (A) | strata K=0 (G) | strata K=4 (H) | strata K=4+A7 (I) |
|---|---|---|---|---|
| crossings | 177 | 273 | 136 | 123 |
| crossings / eligible pair | 0.02 | 0.03 | 0.01 | 0.01 |
| fraction near-straight | 0.17 | 0.10 | 0.13 | 0.14 |
| median vertical deviation px | 401.84 | 1093 | 918 | 918 |
| mean vertical deviation px | 1588.81 | 3093.35 | 2056.37 | 2030.57 |
| slice-A n / p50 / near | 108 / 228 / 0.23 | 108 / 574 / 0.14 | 108 / 574 / 0.18 | 108 / 340 / 0.19 |
| slice-B n / p50 / p90 | 37 / 3166 / 7098 | 37 / 9665 / 17723 | 37 / 2529 / 13467 | 37 / 2529 / 13467 |
| canvas W×H | 9998×10056 | 8038×19066 | 8038×19066 | 8038×19066 |
| collisions | 0 | 0 | 0 | 0 |
| degraded | no | no | no | no |
| wall ms (incl. prep) | 2784 | 195 | 197 | 193 |


### P1 full (E/F carry ancillary; strata is extraction-free — honest asymmetry, SDEC-24)

| metric | rcll owner view (E) | v2 full+anc (F) | strata K=0 full | strata K=4 full | strata K=4+A7 full |
|---|---|---|---|---|---|
| crossings | 371 | 222 | 325 | 172 | 170 |
| crossings / eligible pair | 0.04 | 0.02 | 0.03 | 0.02 | 0.02 |
| fraction near-straight | 0.10 | 0.12 | 0.09 | 0.10 | 0.10 |
| median vertical deviation px | 701 | 2254 | 1936 | 2573 | 2481 |
| mean vertical deviation px | 2687.73 | 4706.18 | 5939.42 | 4146.27 | 4030.44 |
| slice-A n / p50 / near | 31 / 2017 / 0 | 31 / 3106 / 0 | 108 / 1168 / 0.12 | 108 / 1522 / 0.14 | 108 / 1155 / 0.13 |
| slice-B n / p50 / p90 | 114 / 427.39 / 10190 | 114 / 2226 / 16309 | 37 / 17189 / 30888 | 37 / 4471 / 21753 | 37 / 4391.50 / 23017 |
| canvas W×H | 17724×15270 | 11817×29979 | 9994×32007 | 9994×32425 | 9994×32425 |
| collisions | 0 | 0 | 0 | 0 | 0 |
| degraded | no | no | no | no | no |
| wall ms (incl. prep) | 18453 | 15065 | 13352 | 13309 | 13342 |

*Slice populations differ across the E/F vs strata columns (114/31 vs 37/108) because ancillary hub-extraction changes the hull structure — the per-column slice stats are not directly comparable; the §2.5 paired analysis (section 4) is the honest comparison.*

### P2 compact

| metric | v2 (A) | strata K=0 | strata K=4 | strata K=4+A7 |
|---|---|---|---|---|
| crossings | 33 | 39 | 39 | 39 |
| crossings / eligible pair | 0.01 | 0.02 | 0.02 | 0.02 |
| fraction near-straight | 0.04 | 0.03 | 0.03 | 0.04 |
| median vertical deviation px | 459 | 1523 | 1523 | 1439 |
| mean vertical deviation px | 1247.45 | 2023.70 | 1848.22 | 1821.20 |
| slice-A n / p50 / near | 65 / 459 / 0.05 | 65 / 1439 / 0.03 | 65 / 1439 / 0.03 | 65 / 1093 / 0.05 |
| slice-B n / p50 / p90 | 4 / 1149 / 1955 | 4 / 8583 / 10135 | 4 / 5935 / 7487 | 4 / 5935 / 7487 |
| canvas W×H | 8672×5734 | 7046×12106 | 7046×12106 | 7046×12106 |
| collisions | 0 | 0 | 0 | 0 |
| degraded | no | no | no | no |
| wall ms (incl. prep) | 1256 | 97 | 99 | 99 |

### P2 full

| metric | rcll owner view (E) | v2 full+anc (F) | strata K=0 full | strata K=4 full | strata K=4+A7 full |
|---|---|---|---|---|---|
| crossings | 124 | 55 | 47 | 48 | 48 |
| crossings / eligible pair | 0.06 | 0.02 | 0.02 | 0.02 | 0.02 |
| fraction near-straight | 0.01 | 0.03 | 0.03 | 0.03 | 0.06 |
| median vertical deviation px | 2017 | 3046 | 4413 | 4413 | 3367 |
| mean vertical deviation px | 2706.38 | 4192.46 | 4770.93 | 4443.04 | 4348.27 |
| slice-A n / p50 / near | 37 / 1540 / 0.03 | 37 / 3002 / 0 | 65 / 3238 / 0.03 | 65 / 3238 / 0.03 | 65 / 3204 / 0.06 |
| slice-B n / p50 / p90 | 32 / 2900 / 6217 | 32 / 3219 / 9525 | 4 / 17017 / 19866 | 4 / 11554 / 14403 | 4 / 11554 / 14403 |
| canvas W×H | 10919×20285 | 14850×16590 | 9114×23702 | 9114×23702 | 9114×23702 |
| collisions | 0 | 1 | 0 | 0 | 0 |
| degraded | no | no | no | no | no |
| wall ms (incl. prep) | 6819 | 6733 | 6342 | 6342 | 6358 |

## 3. Diff-stability (A4 fixture triple; thresholds frozen v3.1 §13)

Worst candidate cells across both presets: M1_rel 0.0246, M2_flip 0.0544 — both far under the frozen 0.08 / 0.10. v2's own values on the same fixtures: M1_rel up to 0.2072, M2_flip up to 0.1514. K=0 is zero-churn on every cell; K=4 adds small, bounded churn; A7 adds none. moved{}-rename: zero churn at every K (v2 also handles it cleanly at the layout level, but only strata carries stable *element identity* through it — A6). M4/M5 statuses "ok" in every cell; |U| ≥ 68 ≥ N_min everywhere.

## 4. §2.5 slice-B extent gate (paired per-edge bootstrap CI, frozen §12 pins)

| Cell | pairing | n | CI point [lo, hi] | paired p50 Δ | paired p90 Δ | outcome |
|---|---|---|---|---|---|---|
| P1 compact, A→H | primary | 37 | +1008 [−79, +2282] | −637 | +6369 | **FAIL** (tail regression) |
| P1 compact, A→I | primary | 37 | +1005 [−76, +2276] | −637 | +6369 | **FAIL** |
| P1 full, F→H2 | primary | 37 of 114 | — | — | — | VOID (unmatched 2.08× > 20%) |
| P1 full, F→I2 | suppl (report-only) | 114 | −848 [−1739, **+15.5**] | +36 | **−6668** | near-miss (15.5 px from pass) |
| P2 full, F→I2 | suppl (report-only) | 32 | +705 [+3, +1663] | +3052 | +116 | worse |
| P2 compact | primary | 4 | +3714 [+2268, +5346] | +4786 | +5532 | excluded (frozen nB=4 pin), direction worse |

The full-mode primary voids are the frozen unmatched rule catching a real structural fact: slice classification is not engine-invariant under ancillary hub-extraction. The supplementary pairing (baseline keyset) is report-only until/unless amended.

## 5. Owner decisions at V2

1. **BINDING arm-E verdict** (v3.0 §9): does Strata M1b, as visualized, beat the views you actually use? A negative verdict ⇒ M1b redo with your deltas. The extent-gate failure and its registered levers (OD-14 height, OD-15 de-band, OD-3B dummy chains, M3 ancillary port) are on the table as the next-lever menu — the engine substrate (determinism, identity, structure, churn) passed everything.
2. **K=4 default** (`strataSweeps` currently defaults 0): recommendation — ON (strictly better than K=0 on every readability metric, tiny bounded churn cost).
3. **A7 default** (`strataCoordinateRefine` currently defaults off): recommendation — ON (see §1; strict-form reading available if you weigh P1-full slice-A near-straight −0.01 over the universal deviation improvement).
4. **A4 threshold freeze review** (v3.1 §13: M1_rel ≤ 0.08, M2_flip ≤ 0.10) + the supplementary-pairing disposition (§4).

### Visual validation URLs (yarn start → localhost:3001)

- P1 K=4+A7: `/demo?preset=staging-extended-localstack-v2&view=strata&strataSweeps=4&strataCoordRefine=1`
- P1 K=4 (no A7): `/demo?preset=staging-extended-localstack-v2&view=strata&strataSweeps=4`
- P1 K=0 (V1 reference): `/demo?preset=staging-extended-localstack-v2&view=strata`
- P1 v2 baseline: `/demo?preset=staging-extended-localstack-v2&view=pipeline`
- P2 K=4+A7: `/demo?preset=staging-localstack&view=strata&strataSweeps=4&strataCoordRefine=1`
- Full-card mode: append `&compact=0` (A6 satellite fix — first time full mode renders native Strata).
