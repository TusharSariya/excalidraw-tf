# RCLL v2 / Strata — shit-test round 8 (independent cross-model audit)

**Date:** 2026-07-12 · **Status:** Review / Evidence-only — dispositions belong to a future spec amendment (would-be v3.2), not this report.

## Document graph

| Relation | Link |
| --- | --- |
| Role | Review |
| Status | Evidence-only |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`rcll-v2-spec-v3.1.md`](./rcll-v2-spec-v3.1.md) (the stack under attack) |
| Sisters | [`rcll-v2-shit-test-round5.md`](./rcll-v2-shit-test-round5.md), [`rcll-v2-shit-test-round6.md`](./rcll-v2-shit-test-round6.md) |
| Next (agent) | Owner adjudication → v3.2 amendment or roadmap change |

## Methodology

Three independent OpenAI Codex agents (`gpt-5.6-sol`, reasoning effort `xhigh`, full repo read access, web search, and live `bin/rag graph` access to the graph-drawing literature corpus) ran in parallel with disjoint adversarial goals, ~5.3M–6.8M tokens each:

- **Agent 1 — spec internal consistency & contract audit** → verdict **NO-GO**
- **Agent 2 — literature & algorithm grounding audit** → verdict **GO-WITH-CHANGES**
- **Agent 3 — direction / roadmap shit-test** → verdict **NO-GO** (on the roadmap as planned)

Every P1 below was then independently re-verified by the orchestrating agent (Claude) against the code, specs, and frozen baselines. Verification labels: **CONFIRMED** (reproduced against source), **CONFIRMED-WITH-REFRAME** (fact correct, codex's framing needed correction), **PLAUSIBLE** (technically sound, not directly reproduced). Raw agent outputs: [`rcll-round8-raw/`](./rcll-round8-raw/) (`audit-spec-codex.txt`, `audit-literature-codex.txt`, `audit-direction-codex.txt`).

Prior rounds' findings were provided as evidence; agents were instructed not to re-litigate settled dispositions. Agent 2 explicitly cleared round-6 F5/F6/F7/F9/F10–F12 as honestly addressed; the provider-Y/export seam is closed for M1 (do not re-open it).

## TL;DR

Strata's *algorithms* survived round 8 better than its *evaluation contract*. The layered compound substrate is literature-grounded (agent 2: GO-WITH-CHANGES), but all three agents independently converged on the same core defect: **the §2.5 readability gate that the whole W3→W4→OD-15 arc is chasing bootstraps the MEAN paired delta while the normative gate is p50/p90** — W4's "statistical parity" coexists with a p90 tail still +2,068px worse. Layered on top: the gate that failed was owner-overridden through an ambiguity in v3.0 §9; the freeze registers are not enforced by any CI assertion; the C11 derive/validate split was abandoned after it caught a real transfer failure; the shipping default arm is not the arm the owner validated; and the primary task (impact tracing) has never been evaluated by any task-grounded measure — Q7-AXIS remains unexecuted scheduling prose. The consolidated recommendation is to **stop OD-15 and S7 investment until the gate contract is repaired and a task-level trial exists**, and to seriously evaluate interaction-layer tracing (upstream/downstream highlighting) as a possibly higher-leverage lever than further layout work.

## Consolidated P1 findings

### R8-F1 — The implemented §2.5 gate tests the mean; the spec gates p50/p90 — **CONFIRMED** (found independently by all 3 agents)

`pairedBootstrapCi` computes a percentile CI **on the mean paired delta** (`terraformPipelineBootstrapCi.ts` — "Percentile CI on the mean paired delta"); `bootstrapGatePolicy(n, degenerate)` merely returns the *label* `"p90"` without changing the bootstrapped statistic. v3.0 §2 gates slice-B **p50 and p90**; v3.1 §2.5 pin 2's rationale is explicitly about "a percentile-bootstrap CI **on p90**" — yet pin 6's frozen procedure (resample the paired delta vector, take each draw's mean) is the mean CI the code implements. The two pins contradict each other and the implementation follows the weaker one.

Consequence, from W4's own numbers: mean Δ −112px CI [−956, +784] was reported as "statistical parity" while p90 remained **+2,068px worse** than v2. The strict §2.5 pass that OD-15 is chasing is therefore currently a pass on the wrong statistic. This reintroduces the exact mean-vs-tail defect class round 7 pinned §2.5 to eliminate.

### R8-F2 — M1/W4 "complete" rests on an owner override the normative text does not clearly grant — **CONFIRMED-WITH-REFRAME**

v3.0 §9 makes M1 exit conjunctive: T2 **AND** the §2 battery **AND** a positive arm-E owner verdict. The §2.5 P1-compact extent gate FAILED at W3 (SDEC-44) and was still unmet at W4 (CI hi +784). SDEC-47 and SDEC-53 declare completion by reading §9's arm-E as "the authority that overrides the automatic §2.5 gate."

Reframe vs agent 1: the override was **not covert** — SDEC-47/53 record it verbatim, and §9's own rationale ("a threshold table cannot adjudicate it, only the owner can") gives the reading textual cover. But §9 nowhere grants arm-E waiver authority over §2 gates; it adds a gate. The stack therefore contains a live ambiguity that was resolved, twice, in the direction of shipping. The honest fix is a spec-level waiver mechanism that records **waived failure** (never "gate passed") — or reopening M1 exit.

### R8-F3 — The freeze registers are ceremonial: no CI assertion can fail on regression — **CONFIRMED**

- The extent harness's own header: "NEVER asserts gate outcomes … Reported, never asserted" (`terraformPipelineStrataExtentGate.test.ts:4`).
- The A4 churn triple harness asserts fixture health only; the frozen thresholds **M1_rel ≤ 0.08 / M2_flip ≤ 0.10** (v3.1 §13) appear in no `expect()`.
- No production or test code references the §12 frozen JSON hashes or baseline paths; the harness rebuilds the v2 baseline from *current code* rather than loading the frozen artifacts (so a v2-side regression silently moves the goalposts).

Agent 1 verified the frozen JSONs themselves are accurate (SHA-256 + jq recomputation of headline values match v3.1 §12 exactly) — the problem is contractual, not transcriptional. A future readability or churn regression keeps every test green. This defeats the purpose C11/§12 exist for.

### R8-F4 — C11's disjoint derive/validate rule was abandoned after it worked — **CONFIRMED**

The P1-derived M2_flip threshold (0.02) failed P2 validation (0.0544) — C11 doing its job. v3.1 §13 then re-froze thresholds from the **joint** P1+P2 data ("Revised per C11") with headroom, leaving **no held-out preset**. The derivation trail is honest (the failed transfer is documented, and a v2-must-fail upper bound partially constrains gaming), but P2 ceased to be validation data and round-6 F3 (generalization) is re-opened in weakened form. A genuinely held-out third graph is required before the thresholds can be called validated.

### R8-F5 — Default `view=strata` is not the arm whose readability was accepted — **CONFIRMED-WITH-REFRAME**

As built, `strataSweeps` defaults to 0, A7 and rankSeparate to false; the owner validated K=4+A7 (V2) and K=4+A7+rankSeparate (V3). Default-arm numbers vs v2 (W3): P1 crossings 273 vs 177, slice-B p90 17,723 vs 7,098, height 19,066 vs 10,056; P2 p90 10,135 vs 1,955.

Reframe vs agents 1/3: this is **owner-directed, not drift** — SDEC-48 Q1 verbatim: "keep both opt-in but make it a ui button." But two real defects remain: (a) v2.0 OD-2's normative K=4 default was never amended, so spec and product contradict; (b) SDEC-47 itself recorded that K=0 is "the 'unoptimized' V1 reference the owner would NOT expect the button to show" — the shipped default shows exactly that. All "Strata parity" claims must be config-qualified: parity describes an opt-in bundle, and only on the mean statistic (R8-F1).

### R8-F6 — The primary task has never been evaluated; Q7-AXIS remains unexecuted — **CONFIRMED** (all 3 agents)

Q0-TASK closed impact tracing as the primary task (SDEC-9), and Q7-AXIS (20-edge hand-label: does X actually read as dataflow direction?) is scheduled "before M2 gates freeze" (SDEC-24) — no result artifact exists anywhere in docs or code. Owner checkpoints V2/V3 were N=1 visual approvals ("yeah i guess it looks good…"), not path-tracing trials. No dependency-highlighting/tracing interaction exists in the codebase (reproducible: `rg -i "impact.?trac|dependency.?highlight"` over packages/excalidraw + excalidraw-app returns nothing).

The literature says the §2.5 proxy family is misweighted for this task: Ware et al. 2002 found shortest-path tracing predicted by **path continuity, crossings on the path, and branching** — not aggregate extent; Huang 2008 measured path-task times of 6.81s → 14.74s → 29.41s as crossing angle degrades; Dawson et al. 2011 (32 participants) found interactive path/subgraph **highlighting** significantly faster and less error-prone than static layout alone. Vertical extent — the entire W4/OD-15 axis — is at best a supporting metric. (Agent 2's sharpest framing: "Layout is a substrate, not the highest-leverage unfinished feature for this task.")

### R8-F7 — OD-15 aims below the structural source of the residual — **CONFIRMED**

W4 §4 itself records that the remaining extent residual is driven by **full-width provider/account bands**, while OD-15 dissolves *subnet*-level frames, with explicitly uncertain payoff and a real frames→rails visual cost. Agent 2 adds the literature angle: Sander/Forster/ELK support global hierarchy-constrained layering, and none of them motivate full-width sequential bands at the provider/account level — the band policy is the project-specific structure producing the measured residual (v2 height 10,056 vs Strata 13,761 even fully optimized). If extent still matters after R8-F1 is fixed, the A/B worth running is provider/account partial de-band (or hierarchy-constrained ordering without full-width bands), not subnet de-band.

### R8-F8 — K=4 has no adequacy evidence, and the Forster quality citation overstates its paper — **CONFIRMED (adequacy) / PLAUSIBLE (citation, page-level read)**

The battery only ever compared K=0 vs K=4 — no K-curve, no convergence run, no constrained-sifting arm, no exact/ILP oracle on small hulls (which the literature says is feasible: exact one-sided crossing minimization practical to ~60 movable vertices; global sifting dominating layer-by-layer barycenter/median at ≥3 layers). Separately, agent 2's deep read of Forster 2004 (`forward-10-1007-978-3-540-31843-9-22`, pp. 3, 8–10) found its "mostly <1%, worst 3%" experiments compare against **another penalty-graph heuristic, not an optimum** — the repo's "<1%-from-optimal" gloss (papers chart / OD-12 rationale) is a misquote. Forster remains a valid A2 upgrade candidate; the quality certificate attached to it is not real.

### R8-F9 — The rankSeparate ⟂ network-simplex mutual exclusion is premature — **PLAUSIBLE**

The v1 evidence (RFC DI-NS-4: sequential NS after rankSeparate destroys X-disjointness, +149% height) proves the *sequential composition* fails — not that the joint formulation does. Gansner's network simplex minimizes weighted edge span subject to arbitrary per-edge min-length constraints λ(w)−λ(v) ≥ δ(e); sibling-separation precedence edges can be encoded directly as constraint edges (δ = required separation, zero objective weight) and solved **together** with the real dependency edges. Also noted: graphviz `ranksep` is pure inter-rank spacing, not a ranking algorithm — the naming analogy in the docs overstates the precedent. Worth a bounded probe before the exclusion rule (`strataRankSeparate` WINS, NS dropped) is treated as permanent. The W4 "helps only with K=4" coupling is consistent with a phase-interaction artifact of the sequential pipeline.

### R8-F10 — S7/M3 is materially under-specified relative to the layout work — **CONFIRMED**

- Generation `G` is stubbed at 1; the app-side monotone counter is deferred (engine comment + SDEC-38) — a **declared** deviation from v2.0 A6, but until threaded, same-cardinality regeneration re-enters the round-5 failure class for reconcile/broadcast/save.
- `TerraformOverlayStore` (v3.1 §6.2) has no scene/import namespace, persistence lifecycle, undo/redo, conflict policy, or migration contract.
- Full mode can produce multiple satellite appearances per address (SDEC-42) while styles/annotations key on the bare address — edit semantics undefined.
- `replaceAllElements` mechanics: no capture-before-replace, persistence-failure, collab merge-ordering, or degraded-v2-fallback behavior specced.
- Preset selection bypasses `handleSetView` (raw `setView`).

Agent 3's disposition: S7 is not implementation-ready; an integration RFC must precede code.

### R8-F11 — The evidence base is too thin for a direction decision — **CONFIRMED** (frame-level)

Four presets, AWS-taxonomy-only, P3 resolving to P2's effective graph for the relevant arms (not independent validation), cyclic = one injected reverse edge, W4 run on P1/P2 only, owner validation N=1. Seed 20260704 buys reproducibility, not representativeness. Missing coverage: non-AWS providers, deep module nesting, high fan-out, ancillary-heavy, dense/sparse extremes, natural cycles, all-resources scale. This is the class of error prior rounds missed: rounds 5–7 attacked claims *inside* the battery; none asked whether the battery can support the decision being made on it.

## P2 findings (advisory)

- **N_B,min=30 off-by-one** (agent 1): v3.1 §12.2's order-statistic rationale says index 27 = "3 above", but the frozen convention `sorted[floor(n·0.9)]` at n=30 selects the 28th observation (2 above). Current cells (n=37, 32) unaffected; fix the pin or the convention before any n=30 cell is gated.
- **Round-6 F2/F8 partially dispositioned** (agent 1): slice-A p95 was made normative (v3.0 §2) but diagnostics implement median/mean/near-straight only; M4/M5 were demoted to report-only in v3.1 §13 while §3 still says "gate" — an intra-v3.1 contradiction and a silent weakening of the F8 disposition.
- **coordRepack bookkeeping** (agent 2): NS-"shorten" is standard Gansner layer assignment (correctly grounded); coordRepack is an ad-hoc post-ordering permutation heuristic, not Brandes–Köpf — not porting it wholesale was correct; keep it classified as v1-specific. Papers chart is stale on Sander ("recursive container nesting" misattribution) and on Forster's role.
- **Icon-ownership finalize flake** (agent 3): non-blocking alone, but geometric-containment ownership is a prerequisite for overlay/tombstone identity — fix before S7/collab, not after.

## Cross-model disagreement table

| Claim | Codex | Claude verification |
| --- | --- | --- |
| Mean-vs-p90 gate defect | All 3 agents, P1 | CONFIRMED in code + both spec layers; strongest finding of the round |
| Owner override "not permitted" | Agent 1: contract violation | Softened: textual ambiguity in v3.0 §9, exploited transparently (SDEC-47/53 record it verbatim); fix is a waiver mechanism, not an integrity finding |
| Default-arm mismatch = drift | Agents 1/3 | Reframed: owner-directed opt-in (SDEC-48 verbatim); the defects are the unamended OD-2 default and unqualified "parity" language |
| Freeze registers unenforced | Agent 1 | CONFIRMED (harness headers + absent threshold/hash assertions) |
| Forster "<1%-from-optimal" misquote | Agent 2 (page-level PDF read) | PLAUSIBLE — not independently re-read; check pp. 8–10 before amending OD-12 |
| Constrained-NS + rankSeparate joint solve viable | Agent 2 | PLAUSIBLE — theory sound; DI-NS-4 only falsified the sequential composition; needs a probe |
| S7 export seam still open | Agent 3 initially | REFUTED by agent 3 itself mid-run: seam closed for M1 (implementation-flow P8, SDEC-34); do not re-litigate |

## Consolidated recommendation (evidence, not law)

1. **Repair the gate contract before chasing it** (R8-F1/F2/F3): bootstrap the named statistic (p50 and p90 separately), freeze address-keyed per-edge baselines and load them (don't rebuild), make freeze thresholds/hashes CI-asserted, and add an explicit waiver register. Re-run W3/W4 tables; withdraw/re-qualify "statistical parity" until the corrected p90 CI is known.
2. **Insert a task-evidence milestone before OD-15 and S7** (R8-F6/F11): execute Q7-AXIS, then a seeded impact-tracing trial (fixed resources, upstream/downstream answer key, time/error/wrong-branch measures) across four arms: v2, v2 + tracing highlight spike, default Strata, optimized Strata — on at least one held-out real state.
3. **Build the cheap interaction spike regardless** (R8-F6): select/hover → highlight transitive upstream/downstream with direction distinction, dim the rest. It benefits the shipped v2 view even if Strata wins, and the literature suggests it may dominate further layout deltas for this task.
4. **Re-aim extent work at the structural source if it survives step 2** (R8-F7): provider/account-level de-band A/B, not subnet-level OD-15.
5. **Close the spec-product contradictions** (R8-F5, P2s): amend OD-2's default or flip the view default to the validated bundle; reconcile v3.1 §3 vs §13 on M4/M5; fix the N_B,min pin; correct the Forster gloss and papers chart.
6. **Write the S7/M3 integration RFC before code** (R8-F10): generation lifecycle, overlay namespace/persistence/undo/collab, appearance semantics, migration, fallback. Fix the icon-ownership flake first.
7. **Re-validate A4 thresholds on a held-out graph** (R8-F4) whenever a third preset lands.
8. **Bounded probes, low priority:** joint constrained-NS + separation-edges formulation (R8-F9); K-adequacy curve with a sifting arm and small-hull exact oracle (R8-F8).

## Per-agent verdicts (verbatim axis verdicts)

| Agent | Axis | Verdict |
| --- | --- | --- |
| 1 — spec consistency | "Is the spec stack internally sound and honestly reflected by the as-built register and battery reports?" | **NO-GO** — gate/contract repair required before the remaining roadmap is meaningful |
| 2 — literature grounding | "Is the algorithmic direction grounded in the literature, and is layout even the right lever for impact tracing?" | **GO-WITH-CHANGES** — substrate grounded; evaluation direction and next milestones are not |
| 3 — direction/roadmap | "Should the remaining Strata roadmap proceed as planned?" | **NO-GO** — stop OD-15/S7 investment until task-level evidence exists; keep Strata as an experimental engine |

## Research trail (auditability)

Agents' own research logs are embedded in the raw outputs. Corpus doc_ids load-bearing for findings: `doi-10-1057-palgrave-ivs-9500013` (Ware et al. 2002), `forward-10-48550-arxiv-0810-4431` (Huang 2008), `forward-10-1007-978-3-540-31843-9-22` (Forster 2004), `forster-compound-crossing-gd2002`, `forward-10-1007-3-540-46648-7-22` (global sifting), `doi-10-7155-jgaa-00001` (exact 2-layer), `gansner-tse93`, `s2-10-48550-arxiv-2311-00533` (ELK hierarchical ordering), `elk-10-1007-3-540-45848-4-3`. Web: Dawson et al. 2011 (UBC TR-2011-10, Ephemeral Paths), arXiv:2508.15557 (metric fooling), graphviz `ranksep` docs. Reproducible repo checks are quoted inline per finding (file:line).
