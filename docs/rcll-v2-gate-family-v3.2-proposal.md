# Strata readability gate family — v3.2 proposal (cross-model consolidated)

**Date:** 2026-07-12 · **Status:** ADOPTED as normative revision [`rcll-v2-spec-v3.2.md`](./rcll-v2-spec-v3.2.md) (owner direction 2026-07-12, SDEC-55) — the spec supersedes this proposal on any wording difference. Fixes round-8 R8-F1/R8-F3/R8-F6 by construction.

## Document graph

| Relation | Link |
| --- | --- |
| Role | Decision (proposal) |
| Status | Adopted as v3.2 (SDEC-55) |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`rcll-v2-shit-test-round8.md`](./rcll-v2-shit-test-round8.md) (the defects this repairs) |
| Children | [`rcll-v2-spec-v3.2.md`](./rcll-v2-spec-v3.2.md) (the normative amendment this became) |
| Sisters | [`rcll-v2-spec-v3.1.md`](./rcll-v2-spec-v3.1.md) (the stack it amends) |
| Next (agent) | Read [`rcll-v2-spec-v3.2.md`](./rcll-v2-spec-v3.2.md) — it is the normative text; this doc remains the design rationale + research trail |

## Provenance & method

Two independent designs to an identical deliverable contract, firewalled from each other:

- **Design A:** OpenAI codex `gpt-5.6-sol` @ xhigh (repo + `bin/rag graph` corpus + web) — raw output: [`rcll-round8-raw/gate-design-codex.txt`](./rcll-round8-raw/gate-design-codex.txt).
- **Design B:** Claude Fable fork (full round-8 context, own corpus/web research) — raw output: [`rcll-round8-raw/gate-design-fable.md`](./rcll-round8-raw/gate-design-fable.md).

Owner constraints both designs honored: **no human trials ever** (human preference enters only via published experiments, cited per metric); metro-map-style left-to-right with nodes **hard-bound to hierarchy bands** (metrics judge quality within the constraint); **impact tracing** outranks global aesthetics.

**Independent convergences (adopt with high confidence — two model families derived these separately):**

1. Headline gate = **Ware et al. 2002's published shortest-path regression** computed per dependency path (identical coefficients in both designs: `1.390·hops + 0.01699·continuity + 0.654·crossings-on-path + 0.295·branches`).
2. **Path continuity** and **crossings-on-path** gated individually at the tail (p90); **total drawing crossings demoted** — Ware's data shows it was _not significant_ for path tasks (r=.216 vs .633/.449).
3. **Crossing angle** gated (Huang eye-tracking: path-task medians 6.81s → 14.74s → 29.41s as angles degrade).
4. **R8-F1 repair:** each gate bootstraps the statistic it names (separate p50/p90 resampling); **both independently derived the same floor fix: p90 gating requires n ≥ 31** (v3.1 §12.2's n=30 rationale is off by one under `sorted[floor(0.9n)]`).
5. **R8-F3 repair:** frozen per-edge/per-path baselines with SHA pins are **loaded, never rebuilt**, and CI must fail when a claimed verdict doesn't recompute.
6. Demote to report-only: raw canvas height, stacked band height, fractionNearStraight(24px), area utilization; never gate **bands-skipped** (it is A2's own optimizer objective — gating a system on its own objective is Goodhart by construction; cf. arXiv 2508.15557).
7. Vertical extent survives only as a **supporting, non-headline** signal, labeled an owner engineering prior (no study isolates vertical-vs-horizontal edge cost — v3.0 §10's honesty convention).

## 1. The metric family

Conventions: TFD arrows = engine-emitted non-aggregated dataflow arrows (`tfdArrowsOf`); geometry = rendered polylines; crossings via the existing `segmentsCross` kernel extended to record the acute intersection angle θ; `turn(a,b)` = angular deviation from straight continuation in degrees (0° = straight-through). Deterministic seeded layouts ⇒ scene scalars compare exactly; bootstrap CIs model generalization over edge/path populations.

| # | Metric | Definition (computable) | Empirical grounding | Role | Statistic |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **M-H** | Hierarchy/semantic integrity | Exact counts, must be 0: leaf outside its hull; overlapping sibling hulls; interleaved band Y-intervals; arrow crossing an unrelated card interior; declared edge whose target center is left of its source center (>1px) | Structural invariant (metro-map topology preservation; owner constraint) | **Hard gate** | exact = 0 |
| **M-RT** | **Predicted tracing cost (headline)** | Per path p: `rt̂(p) = 1.390k + 0.01699·con(p) + 0.654·cr(p) + 0.295·br(p)` (no intercept; relative use only). Paired Δ per path; k and br are layout-invariant and cancel in Δ — the delta isolates exactly what layout can change | Ware et al. 2002, 43 subjects, R²=.784; their equivalence: 1 crossing-on-path ≈ 38° of bendiness ≈ 0.65s | **Primary gate** | paired **p50 AND p90**, each bootstrapped on its own statistic |
| **M-CON** | Path continuity | `con(p) = Σ turn(t⁻ᵢ, t⁺ᵢ)` over intermediate nodes (arriving arrow's last segment vs departing arrow's first) | Ware 2002 — strongest layout-controlled factor (r=.633); good-continuation | **Component gate** | paired p90 no-regress |
| **M-CRP** | Crossings-on-path | Distinct arrows ∉ p properly crossing any segment of p (count each crossing arrow once; shared-endpoint pairs excluded) | Ware 2002 — significant where total crossings was not | **Component gate** | paired p90 no-regress |
| **M-ANG** | Crossing-angle severity | Scene-level: `sharpShare = | {θ<30°} | /max(1,ncross)`+ report p10(θ). Path-level: worst`cos α` among crossings touching p | Huang 2008 eye-tracking; large-angle literature (30° convention) | **Gate** | scene scalar: candidate ≤ baseline + 0.02 (exact); path p90 report |
| **M-TLL** | Path geometric length | Σ polyline arc length over p's edges; plus stretch ratio `arcLen/‖chord‖` as scale-resistant companion | Ware tll r=.623 (though n.s. in final regression — weights already carry it); metro-map length minimization | **Gate (weak)** | paired p50 no-regress |
| **M-TCR** | Global crossings | Existing crossings count | Purchase (general tasks); Ware: n.s. for path tasks | **Gate (weak backstop)** | exact: candidate ≤ baseline |
| **M-EXT** | Slice-B vertical extent | Existing per-edge extentPx — **statistic repaired** | Owner engineering prior (explicitly labeled) | **Supporting gate** | paired p50 + p90, each on its own statistic |
| **M-GEO** | Geodesic-tendency violation | Per intermediate node: does a _wrong_ branch point more directly at the path target than the correct one (angle to target-bearing; margin-normalized) | Huang/Eades/Hong 2009 (readers follow geometry toward the target) | **Report-only**, promotable after one milestone of data | p90 |
| **M-TRAP** | Branch-fan confusability | At each intermediate node: fraction of wrong same-direction branches at least as visually continuous as the correct one (±1° tolerance); per-path max | Ware branching + geodesic tendency; the exact form is an engineering operationalization (labeled) | **Report-only**, promotable | p90 |
| **M-BND** | Within-edge bend burden | Σ direction changes >15° at internal polyline vertices | Purchase (bends increase errors); metro-map bend minimization | **Report-only now; GATE when OD-9 routing lands** (today's arrows are near-monotone — gating a ~0 metric adds noise) | p90 |
| — | height, stackedBandHeight, bands-skipped, near-straight-24px, areaUtilization, aspect, hub-centering | unchanged computations | unvalidated priors / optimizer telemetry | Report-only | — |

## 2. Path population (deterministic, frozen)

**Primary population (Design B, adopted):** all ordered resource pairs with a **unique shortest directed dependency path of 2–5 hops** (mirrors Ware's stimulus lengths; uniqueness makes the trace well-defined with no human answer key). Canonically sorted by joined address chain; if >500, seeded uniform sample of 500 (`mulberry32(20260704)` over the sorted list). Same path set (by key) evaluated in both arms; pairing key = canonical path key; §2.5's 20% unmatched-void rule inherited. Report |P|, length histogram, sampling ratio — no silent truncation.

**Coverage companion (from Design A):** report the fraction of TFD edges appearing on ≥1 sampled path; edges never on a path are still covered by the per-edge gates (M-EXT) and scene gates (M-ANG, M-TCR). If coverage < 50% on a preset, add Design A's edge-anchored walk population as a supplementary report block before gating that preset. (Design A's full edge-anchored-walk scheme — every edge as anchor, alternating forward/backward extension to L=8, 4 replicas — is registered as the fallback population if unique-shortest proves too sparse on real states.)

## 3. Gate policy

**Statistic repair (R8-F1).** `pairedBootstrapCi(input, {statistic: "mean"|"p50"|"p90"})`: paired keyed delta vector as today; each of B=1000 seeded draws resamples n-of-n with replacement and computes the **named statistic** of the resampled delta vector (frozen nearest-rank convention); CI = [2.5%, 97.5%] of the B values. Mean stays as report-only companion. _Estimand note (the one substantive design disagreement):_ Design B gates the **quantile of paired deltas** Q(C−B) (matches v3.1 §2.5's frozen pairing convention; adopted); Design A gates the **difference of arm quantiles** Q(C)−Q(B) via anchor-block resampling (answers "did the worst case per arm improve"). Adopt B as the gate, emit A as a labeled companion column; if they ever disagree in sign on a gated cell, the cell is INCONCLUSIVE → owner adjudication.

**Floors and voids.** p90 gating requires **n ≥ 31** (both designs' off-by-one fix); 10 ≤ n < 31 → gate p50, report p90; n < 10 → report-only. Degenerate p90 (CI upper = resample max) → p90 cell VOID, fall to p50, never report p90 "passed". Unmatched > 20% → VOID. VOID in a gated cell ⇒ milestone undecided, not passed.

**Frozen baselines + verdict register (R8-F3).** One-time freeze from the pinned v2 revision: per-edge rows, per-path rows (k/con/cr/tll/rt̂ per pathKey), scene scalars — SHA-256-pinned in the spec register. CI **loads** the artifacts (asserts SHA + populations + that recomputed summaries equal the register) and computes only the candidate arm live. A machine-readable `gateRegister.json` maps every cell → claimed status ∈ {PASS, PARITY, **FAIL-WAIVED**, REPORT}; a CI test recomputes each claimed cell and fails the build if the claim doesn't match. **This legalizes the owner override honestly:** the owner can WAIVE a failed gate (recorded as FAIL-WAIVED, auditable), and retains an arm-E _veto_ over machine-green builds — but nothing can relabel a computed FAIL as PASS (closes round-8 R8-F2/R8-F3). Refreeze only via a dedicated workflow that updates artifact + register together.

**Milestone verdict (lexicographic, non-compensatory, no human in the loop):**

1. M-H, collisions=0, R2, determinism/A4 all pass (A4 thresholds become real `expect()`s).
2. **M-RT** p50 and p90 on ≥2 presets: IMPROVED (CI hi < 0) or PARITY (CI straddles 0 and |point| ≤ ε_rt = 0.25s ≈ 15° continuity per Ware's equivalences).
3. Component gates (M-CON, M-CRP, M-ANG, M-TLL, M-TCR, M-EXT) each pass their no-regress form.
4. Report-only metrics can never rescue a failed gate. (Design A demanded strict improvement and no owner override; Design B allowed PARITY + the waiver register. Adopted B's form — strict-improvement-only would have retroactively failed W4-class outcomes the owner explicitly accepted, and an override ban contradicts the owner's actual authority; the register makes it honest instead of forbidden.)

## 4. What this changes about current claims

Re-run the W3/W4 tables under the repaired statistics and restate verdicts in register vocabulary. Expected outcome: the P1-compact extent cell becomes **FAIL-WAIVED** (not "statistical parity"), and the first M-RT numbers become the new headline for whether Strata beats v2 _at the task_. OD-15 stays gated behind those numbers (round-8 R8-F7 stands: the extent residual is provider/account bands, not subnets).

## 5. Migration & minimal first slice

Implementation order (each with tests): (1) `pairedBootstrapCi` statistic param + floors + per-statistic degeneracy — pure extension, existing callers unchanged; (2) crossing-angle capture in the existing collision-diagnostics crossing loop (record θ via atan2 — same O(A²s²) loop); (3) new `terraformPipelineStrataPathMetrics.ts` (dep graph from existing rel source/target; BFS unique-shortest 2–5 hops; seeded sampling; con/cr/tll/rt̂/gdev/trap — reuses `Seg`/`segmentsCross` + polyline access; ≲1s at P1 scale vs the seconds-scale Q2 harness); (4) baseline freeze + `gateRegister.json` + CI assertions (ships with 1); (5) W3/W4 restatement.

**Minimal 3-metric slice if trimming:** statistic-repaired slice-B p50/p90 (stops the mislabeled claim today) + **M-RT** (the impact-tracing headline) + **M-ANG sharp-crossing share** (cheap, orthogonal, catches what extent never sees).

## 6. Load-bearing citations

Ware, Purchase, Colpoys & McGill 2002, _Cognitive Measurements of Graph Aesthetics_ (corpus `doi-10-1057-palgrave-ivs-9500013`; regression verified against the author PDF pp. 7–13 by both designs) · Huang 2008 eye-tracking (`forward-10-48550-arxiv-0810-4431`) · Huang, Hong & Eades 2008 crossing angles · Huang, Eades & Hong 2009 geodesic tendency (`doi-10-1109-pacificvis-2009-4906848`) · Purchase et al. validating aesthetics (`s2-10-1007-bfb0021827`) · Nöllenburg & Wolff metro-map MIP (`forward-10-1109-tvcg-2010-81`) · Stott & Rodgers 2004 (`forward-10-1109-iv-2004-1320168`) · Wolff subway-map survey (`doi-10-1007-s00450-007-0036-y`) · van Wageningen, Mchedlidze & Telea 2025 metric-fooling (arXiv 2508.15557). Full per-design research logs in the raw outputs.
