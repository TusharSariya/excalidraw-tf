# RCLL v2 — Layout Engine Specification, revision 3.2 (normative amendments)

| Field | Value |
| --- | --- |
| Status | **Normative — source of truth together with [`rcll-v2-spec-v2.md`](./rcll-v2-spec-v2.md) (base), [`rcll-v2-spec-v3.md`](./rcll-v2-spec-v3.md) (first amendment layer), and [`rcll-v2-spec-v3.1.md`](./rcll-v2-spec-v3.1.md) (second amendment layer).** Precedence on conflict: **v3.2 > v3.1 > v3.0 > v2.0.** Every section not amended here is incorporated by reference unchanged (C11 mechanism, fourth exercise). |
| Version | 3.2 (2026-07-12) |
| Produced by | **Round 8** — the first cross-model audit (3 OpenAI codex `gpt-5.6-sol` @ xhigh agents with disjoint adversarial goals, Claude-verified per finding: [`rcll-v2-shit-test-round8.md`](./rcll-v2-shit-test-round8.md)) — plus the two-design firewalled gate-family proposal ([`rcll-v2-gate-family-v3.2-proposal.md`](./rcll-v2-gate-family-v3.2-proposal.md), codex + Claude Fable independently converging on the Ware path-cost headline and the n≥31 floor), adjudicated against the W5 repaired-stats battery ([`strata-view-w5-repaired-stats-report.md`](./strata-view-w5-repaired-stats-report.md)) and the W5b joint-NS probe ([`strata-view-w5b-joint-ns-probe.md`](./strata-view-w5b-joint-ns-probe.md)). Adopted by owner direction 2026-07-12 (SDEC-55). |
| Owner decisions folded | Default flip to the validated arm (SDEC-54); adoption of the gate family + waiver register; OD-15 re-scope; task-evidence precondition on further geometry milestones. |
| What did NOT change | Seed **20260704** and the entire v3.1 §12/§13 freeze registers (all values except the single N_B,min floor pin corrected in §1.3 below); all algorithm text (A0–A7), the build order, D1′–D8″, C1′–C11, R1–R10, T1–T10, OD-1–OD-14 except as amended in §5–§7. No geometry constant changes. |

## Document graph

| Relation | Link |
| --- | --- |
| Role | Normative-amendment |
| Status | Current top amendment — precedence v3.2 > v3.1 > v3.0 > v2.0 |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`rcll-v2-spec-v3.1.md`](./rcll-v2-spec-v3.1.md) |
| Children | [`strata-view-decision-log.md`](./strata-view-decision-log.md); [`strata-baselines/README.md`](./strata-baselines/README.md) |
| Sisters | [`rcll-v2-gate-family-v3.2-proposal.md`](./rcll-v2-gate-family-v3.2-proposal.md) (adopted design); [`rcll-v2-shit-test-round8.md`](./rcll-v2-shit-test-round8.md) (evidence) |
| Next (agent) | Gate any new milestone through §1–§3 + the §8 task-evidence precondition; status/as-built → decision-log Part II. |

## 0. What changed since v3.1 and why (read this first)

Round 8 found that Strata's _algorithms_ survived audit better than its _evaluation contract_. All three independent agents converged on the same core defect (R8-F1): the implemented §2.5 gate bootstrapped the **mean** paired delta while the normative gate names p50/p90 — so W4's "statistical parity" coexisted with a p90 tail confirmed +1,252…+3,659px worse than v2 once the statistic was repaired (W5 finding (a)). Layered on that: the freeze registers had no CI enforcement (R8-F3), the primary task (impact tracing) had never been evaluated by any task-grounded measure (R8-F6), the shipping default was the one arm all evidence calls inferior (R8-F5, W5 finding (f)), and OD-15 aimed at subnet frames while the measured residual lives at the provider/account bands (R8-F7). This amendment adopts the repaired statistics contract, the literature-grounded M-RT gate family, the machine-readable gate register with an honest waiver mechanism, the validated view default, the OD-14/OD-15 corrections, and a task-evidence precondition on further geometry work. The minimal slice is **already implemented and frozen** (W5 harness, `terraformPipelineStrataGateRegister.ts` + always-on test, `docs/strata-baselines/` SHA-pinned artifacts) — this amendment gives that machinery its normative standing.

## 1. §2.5 statistics contract — repaired (amends v3.0 §2 and v3.1 §2.5/§12 pins 2, 3, 6; closes R8-F1)

1. **Each gate bootstraps the statistic it names.** `pairedBootstrapCi(input, { statistic: "mean" | "p50" | "p90" })`: the paired keyed delta vector is resampled n-of-n with replacement, B = 1000, PRNG `mulberry32(20260704)`, and each draw computes the **named statistic** (nearest-rank convention `sorted[min(n−1, floor(n·f))]`); CI = percentile [2.5%, 97.5%] of the B values. v3.1 §12.6's frozen procedure is amended accordingly (its resample unit, B, seed, and CI method are unchanged; only the per-draw statistic generalizes from mean to the named one).
2. **The mean is no longer gate-eligible.** It remains a report-only companion column. **Prior mean-based acceptances are superseded and must be restated at p50/p90** — W4's acceptance is restated in §4 below. This clause makes no claim about cells not re-examined; any other mean-based claim encountered later must be restated before it is cited as a pass.
3. **Floors (amends v3.1 §12.2/§12.3).** p90 gating requires **n ≥ 31** — the off-by-one fix both gate-family designs derived independently: under `sorted[floor(0.9·n)]`, n=30 selects the 28th order statistic (2 above), not the 27th (3 above) that §12.2's rationale requires. **N_B,min = 31** replaces the frozen 30 (no frozen cell is affected: gate-eligible cells have n = 37, 114, 32). 10 ≤ n < 31 → gate p50, report p90. n < 10 → report-only (restates §12.3 unchanged). **Degenerate p90** (CI upper = resample max) → the p90 cell is VOID, fall to p50, never report p90 as passed. Unmatched pairing keys > 20% → VOID (unchanged). A VOID in a gated cell ⇒ the milestone is **undecided**, never passed.
4. **Estimand.** Gates test the **quantile of paired deltas** Q(C−B) (matches the frozen pairing convention). The difference-of-arm-quantiles Q(C)−Q(B) is emitted as a labeled companion; if the two ever disagree in sign on a gated cell, the cell is INCONCLUSIVE → owner adjudication.

## 2. Gate register + frozen-baseline enforcement (new; closes R8-F2/R8-F3)

1. **`docs/strata-baselines/gateRegister.json` is normative.** Every gated cell maps to a claimed status ∈ {**PASS**, **PARITY**, **FAIL-WAIVED**, **REPORT**}. PARITY = CI straddles 0 and |point| ≤ ε (for M-RT, ε_rt = 0.25s ≈ 15° continuity per Ware's equivalences). **FAIL-WAIVED is the honest home of the owner override**: the owner may waive a failed gate (waiver must cite the SDEC recording the decision — currently SDEC-47/53 for the W4 extent tail), and retains the arm-E veto over machine-green builds — but **nothing may relabel a computed FAIL as PASS**; the enforcement test fails the build on any claim mismatch.
2. **Enforcement mechanism.** The always-on suite `terraformPipelineStrataGateRegister.test.ts` recomputes every claimed cell from the SHA-256-pinned frozen artifacts (`docs/strata-baselines/V32_ROWS_*.json` + `V32_BASELINE_MANIFEST.json`) and asserts the claim. Baselines are **loaded, never rebuilt** — a v2-side code regression can no longer silently move the goalposts. Refreeze only via the dedicated workflow (`STRATA_FREEZE_REGEN=1` regeneration test) that updates artifact + manifest + register together.
3. This resolves the v3.0 §9 ambiguity round 8 exploited twice (R8-F2): arm-E remains a conjunctive gate and a veto; it is **not** a waiver of the §2 battery — waivers exist only as recorded FAIL-WAIVED cells.

## 3. Metric family — the M-RT gate family adopted (amends v3.0 §2's family; adopts proposal §§1–3)

1. **Adopted as normative:** the metric table, path population, and gate policy of [`rcll-v2-gate-family-v3.2-proposal.md`](./rcll-v2-gate-family-v3.2-proposal.md) §1–§3 — headline **M-RT** (Ware et al. 2002 path-cost regression `rt̂ = 1.390·hops + 0.01699·con + 0.654·cr + 0.295·br`, paired per-path, p50 AND p90 each bootstrapped on its own statistic per §1), component gates M-CON / M-CRP / M-ANG / M-TLL / M-TCR (weak backstop) / M-EXT (supporting, labeled owner engineering prior), hard gate M-H, report-only M-GEO / M-TRAP / M-BND. Path population = unique shortest directed 2–5-hop dependency paths, canonical keying, seeded ≤500 sample, coverage companion, edge-anchored-walk fallback registered.
2. **Demotions:** raw canvas height, stacked band height, fractionNearStraight(24px), area utilization → report-only. **bands-skipped is never gated** — it is A2's own §1 (v3.1) optimizer objective; gating a system on its own objective is Goodhart by construction (metric-fooling literature, arXiv 2508.15557).
3. **Coefficient honesty (normative):** the rt̂ weights are literature-derived engineering weights, not a locally validated model. **No gate verdict may rest on the coefficients alone** — every M-RT claim is reported with its component metrics (con, cr, tll, angles) alongside, and a verdict contradicted by its components is INCONCLUSIVE.
4. **Milestone verdict is lexicographic and non-compensatory** (proposal §3): structural gates → M-RT on ≥2 presets → component no-regress gates → report-only metrics can never rescue a failed gate.
5. The v3.0/v3.1 slice-A/slice-B extent machinery survives inside M-EXT with the §1 statistics repair; the §12 baseline cells keep their standing under the new vocabulary (see §4).

## 4. W4 acceptance restated under the repaired statistics (supersedes the "statistical parity" language of SDEC-51/53 as spec-citable claims)

- **P1-compact slice-B extent, arm J (K4+A7+RS):** p50 CI [−389, +796] → **PARITY at the median**. p90 CI **[+1252, +3659], entirely worse** → computed **FAIL**, standing as **FAIL-WAIVED** under the V3 owner acceptance (SDEC-53; register cells `P1/extent/p90` I and J). The phrase "statistical parity," unqualified, is withdrawn — the honest statement is _parity at the median, waived regression at the tail_.
- **P2 cells:** n_B = 4 → floor-ineligible, **REPORT** only (unchanged consequence of §1.3).
- **Config qualification is mandatory (R8-F5):** every Strata-vs-v2 claim names the arm (K/A7/RS state) and the statistic. "Strata" unqualified now means the §6 default arm.

## 5. OD-14 / rankSeparate — relabeled a trade; DI-NS-4 corrected (amends v3.1 §7 OD-14)

1. **rankSeparate is a height/angle-vs-tracing trade, not a win** (W5 finding (d)): it improves the extent tail (P1 p90 +6726 → +3161) and crossing angles (sharpShare 0.41 → 0.28) while flipping the K4+A7 median M-RT win into a loss (Δrt̂ p50 −0.27 → +0.25 on P1; +0.98 → +2.64 on P2) and ~doubling crossings (123 → 220; 39 → 104). It ships **default-OFF**. SDEC-51's "must ship WITH K=4" line is retained as an extent-rationale (RS alone is worse on extent too) but relabeled: the pairing states when RS is _least harmful_, not a condition under which it wins the task metric.
2. **DI-NS-4's "cannot compose" is corrected** (W5b): the joint constrained network-simplex formulation — separation constraints as zero-objective-weight edges — **composes fine and solved on both presets with zero constraint violations**. The rankSeparate/NS mutual exclusion is retained **on evidence, not infeasibility**: the joint solve is strictly worse than sequential RS on P1 path metrics and mixed on P2, and the underlying lesson is that **rank-span compression (any NS objective) is the wrong lever for path readability** — shorter spans densify columns and put more crossings on traced paths. `strataJointNsRank` remains an experimental, harness-only flag.

## 6. View default — the validated arm (amends v2.0 OD-2's posture; codifies SDEC-54, superseding SDEC-48's opt-in ruling)

1. **The default Strata configuration is K=4 sweeps + A7 coordinate refinement; rankSeparate OFF.** Basis: W5 finding (c) — K=4 is the single biggest task-metric lever measured (default-arm Δrt̂ p50 +2.68 → −0.03; crossings 273 → 136) and A7 adds a further consistent median gain (→ −0.27, the project's first CI-excluding-zero task win over v2) at zero component cost — and W5 finding (f): K=0 is the worst arm on every metric measured. This closes the R8-F5 spec-product contradiction in the direction of the evidence.
2. All options remain owner-visible toggles (`TerraformStrataSettings.tsx`); K=0 remains reachable via explicit params. Share-URL emission of the strata engine flags is **both-states-explicit** (SDEC-54 — truthy-only emission would silently re-import a turned-OFF URL as ON now that defaults are ON).
3. Engine-internal option fallbacks (`?? 0` / `=== true` in `terraformPipelineStrata.ts` and the sceneContext S0a path) are **unchanged** — the engine contract stays explicit-options; the default lives at the app entry layer. The known residual gap (a hand-typed bare `view=strata` URL with no params resolves the engine fallback K=0, flagged in SDEC-54) is a registered app-layer defect with a work package in flight; its fix must introduce a single shared defaults constant consumed by both the dialog seeds and the demo-URL path, and must not alter the engine fallbacks.

## 7. OD-15 — deprioritized and re-scoped (amends v3.1 §7 OD-15)

1. **OD-15 no longer targets subnet frames.** The measured residual after W5 is **provider/account band geometry**: continuity tails (Δcon p90 +58…+103°), path geometric stretch (Δtll p50 +653…+2476px), and sharp crossing angles (sharpShare 0.39–0.95 vs v2's 0.28–0.48) — W5 findings (b)/(e), R8-F7. The re-scoped lever family (plan-of-record, not normative algorithms): angle-aware selective rank separation at provider/account band seams; intra-band port/stub assignment reducing angular deviation at intermediate path nodes; global band breathing room only if those stall.
2. **Subnet de-band may be revisited only with a gate-family cell showing subnet bands bind** — it was never directly measured, so it is deprioritized, not refuted.
3. Any OD-15-class milestone is gated by §3 (M-RT p50 no-regress; M-RT p90 + M-ANG must improve; M-EXT within the §2 waiver discipline) and preconditioned by §8.

## 8. Task-evidence precondition (new; closes R8-F6 procedurally)

1. **No further geometry milestone may be ACCEPTED until a task-evidence battery including a tracing-highlight arm is on record** (v2+highlight and default-Strata+highlight arms beside the layout arms). The owner runs no human trials (standing constraint); the battery is model-based and must therefore obey the following honesty shape, which is normative:
   - **Crossover-sweep framing**: highlight effects enter as an attenuation factor α on the visual-search terms (cr, con) swept over {0, 0.25, 0.5, 0.75, 1}; the reported decision quantity is the crossover α, never a single attenuated point estimate. The α=0 bound is reported only as a labeled bound — under full attenuation rt̂ reduces to layout-invariant structure (hops, br) and **carries zero layout information**.
   - **Register discipline**: all highlight-adjusted cells are **REPORT** only — model-based sensitivity analysis never creates a PASS/FAIL cell.
   - **Residual geometry** the highlight does not erase is reported per arm: path geometric length, extent, and crossings _within the highlighted subgraph_ (impact tracing is one-to-many; a highlighted downstream cone can re-create clutter).
   - **Unmodeled terms stated**: anchor-acquisition cost and hover-exploration cost are named as unpriced.
2. **Q7-AXIS remains owed** (SDEC-24 obligation unchanged by this amendment): the 20-edge hand-label direction-reading check is still the cheapest owner-executable task probe and must run before M2 gates freeze.

## 9. Superseded-anchor index

| Anchor | Status in v3.2 |
| --- | --- |
| v3.1 §12.6 frozen bootstrap procedure (per-draw mean) | generalized by §1.1 (per-draw named statistic; all other pins unchanged) |
| v3.1 §12.2 N_B,min = 30 | replaced by §1.3 (N_B,min = 31, off-by-one fix; no frozen cell affected) |
| Mean-CI gate eligibility (v3.0 §2 / v3.1 §2.5 as implemented) | revoked by §1.2 (report-only companion) |
| v3.0 §9 arm-E-as-override reading (exploited at V2/V3) | closed by §2 (waiver register; arm-E = conjunctive gate + veto, never a relabel) |
| v3.0 §2 metric family gate/report roles | amended by §3 (M-RT family adopted; demotions; bands-skipped never gated) |
| SDEC-51/53 "statistical parity" as a citable claim | restated by §4 (parity at median, FAIL-WAIVED at tail) |
| v3.1 §7 OD-14 ("cannot compose with NS", DI-NS-4) | corrected by §5.2 (composes; rejected on evidence) |
| v2.0 OD-2 default posture / SDEC-48 opt-in ruling | superseded by §6 (default = K=4+A7) |
| v3.1 §7 OD-15 (subnet de-band port) | re-scoped by §7 (provider/account residual) |

## 10. Provenance

Round-8 method: 3 codex `gpt-5.6-sol` xhigh agents (spec-consistency NO-GO; literature GO-WITH-CHANGES; direction NO-GO), each finding Claude-verified against code/specs/baselines ([`rcll-v2-shit-test-round8.md`](./rcll-v2-shit-test-round8.md)). Gate family: two firewalled designs (codex + Claude Fable) with independent convergence on the Ware headline, the per-statistic bootstrap, and the n≥31 floor ([`rcll-v2-gate-family-v3.2-proposal.md`](./rcll-v2-gate-family-v3.2-proposal.md)). Adjudicating evidence: W5 repaired-stats battery (findings (a)–(f)) and W5b joint-NS probe. Enforcement machinery shipped before this amendment: `terraformPipelineBootstrapCi.ts` statistic param, `terraformPipelineStrataPathMetrics.ts`, `terraformPipelineStrataGateRegister.ts` + always-on test, `docs/strata-baselines/` (SHA-256-pinned rows, manifest, `gateRegister.json`). Owner adoption recorded as SDEC-55.

NO UNRESOLVED DECISIONS
