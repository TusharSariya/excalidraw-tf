# strataRankCompact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in horizontal (rank-axis) edge-length compaction to the strata layout that pulls units left into the slack `rankSeparate` leaves, shortening long horizontal edges (Account-04 cross-account edges, DLQ sinks) without regressing height, width, crossings, or path-readability.

**Architecture:** A new flag `strataRankCompact` (default-off, byte-identical off) that, when on, replaces the separated floor's hard push-right with an exact **fixed-order difference-constraint solve** (minimize total weighted L1 horizontal edge length) over the SAME forward-rank (C1) + **frozen-orientation** band-sharing separation (C2) + containment (C3) constraints, capped at today's width (C4). M0 proved this is a polynomial LP solved by the existing Gansner network-simplex (`computeNetworkSimplexDepths`); the degree-1 DLQ sink falls out as the 1-median corner. Two phases: Phase 1 ships the solver + threading + the cheapest increment (DLQ/sink relief); Phase 2 hardens C3 containment for the Account-04 win (its rigid form added +6 frame pierces in M0).

**Tech Stack:** TypeScript 5.9, Vitest (jsdom), the existing `terraformPipelineStrata*` engine, Gansner network-simplex in `terraformPipelineLayoutShared.ts`.

## Global Constraints

- **Opt-in flag `strataRankCompact`, boolean, default `false`.** Off path must be **byte-identical** to today, and byte-identical for non-strata views. New machinery allocates only in the on branch.
- **High regression bar.** The freeze/SHA baselines (`docs/strata-baselines/*`, seed 20260704) MUST stay green with **no regen** — automatic iff off is byte-identical. Do NOT edit `terraformPipelineStrataFreezeBaselines.test.ts` / `...GateRegister.test.ts`.
- **NaN import-cycle rule:** no module-level consts imported from `terraformPipelineLayoutShared`; read options at call time / use in-file literals (planParsing→layoutCore cycle).
- **Option threading boundary:** the flag MUST be forwarded in the `sceneContext` literal in `terraformLayoutCore.ts` or it is silently dropped on the real app path (engine tests bypass it). Also thread session/share/persistence (`terraformImportSession.ts`, `terraformCanvasShareUrl.ts`, `terraformSceneApply.ts`) — the pattern is exactly `strataPackedConverge` (committed `e22e5c657`, use it as the template).
- **Determinism:** stable iteration order is the tie-break substrate. The solve uses a **2-stage deterministic tiebreak** (min total L1 → fix that value → min max-edge → canonical coord/ID tie), Bland's rule in the NS.
- **Metric caveat:** the pixel==column-span equivalence is preset-specific (uniform 346px cards on `staging-extended-localstack-v2`). The general path MUST use a **fixed-slot-width colX model** (Task 9) so heterogeneous-card presets stay pixel-faithful.
- **Branch `strata-v3.2-w5-w10b`, commit there — NOT master (branch-protected).**

**Reference implementations (proven in the M0 spike, preserved):**

- Solver prototype: `scratchpad/m0-prototypes/terraformStrataRankCompactM0.probe.test.ts` — freezes band-sharing C2 pairs+orientation from the separated floor, builds the C1+C2+C3+C4 difference-constraint graph, solves via `computeNetworkSimplexDepths`, applies the 2-stage tiebreak. **Productionize this; do not re-derive.**
- Evidence-gate harness: `scratchpad/m0-prototypes/terraformStrataM0EvidenceGate.probe.test.ts` — measures paired rt̂/cr-on-path + pixel width/height/L1 vs off through the full app path with `pairedPathMetricsCi`. **The M1 assertion test (Task 8) is this, hardened.**

---

## File structure

| File | Responsibility | Phase |
| --- | --- | --- |
| `terraformPipelineStrataRankCompact.ts` (**new**) | The solver: freeze C2 pairs+orientation, build difference-constraint graph, solve, 2-stage tiebreak. Pure function `computeStrataRankCompactFloor(...)`. | 1 |
| `terraformPipelineStrataRank.ts` (modify) | Call the compact solver instead of the separated floor when `rankCompact` on; make the NS-drop guard (`:117-129`) conditional; `columnX` build (`:175-194`) reads the compact assignment. | 1 |
| `terraformPipelineStrataRankSeparate.ts` (modify) | Export the band-sharing pair set + oriented sep-edges so the compact solver reuses them (don't duplicate). | 1 |
| `terraformPipelineLayoutShared.ts` (modify) | Extend `buildSeparationConstraintGraph` / the NS with the width-throttle + fixed-slot-width colX (Task 9). | 1/2 |
| `terraformPipelineStrataTypes.ts` (modify) | `rankCompact?: boolean` on `StrataEngineOptions`. | 1 |
| `terraformPipelineStrata.ts`, `terraformLayoutCore.ts`, `terraformDemoUrlParams.ts`, `terraformStrataDefaults.ts`, `terraformImportSession.ts`, `terraformCanvasShareUrl.ts`, `terraformSceneApply.ts` (modify) | 7-layer flag threading, mirroring `strataPackedConverge`. | 1 |
| `terraformPipelineStrataRankCompact.test.ts` (**new**) | Solver unit tests + the real-app-path M1 assertion arm. | 1 |
| `terraformStrataRankCompactOverConstraint.probe.test.ts` (**new, uncommitted scratch**) | Phase-0 probe answering the over-constraint question. | 0 |

---

## Phase 0 — Settle the over-constraint question (probe-only, gates Phase 1 scope)

The M0 tension: agent-2 measured the DLQ pulled all the way to source+1 (150px) as **height-safe + clean**, yet agent-1's height-safe LP holds it at 0.6× (col 13) because band-sharing sibling `aws_api_gateway_rest_api.private` (col 12) Y-overlaps it. Decide: is the frozen band-sharing C2 pair set **over-constrained** (some pairs can be dropped without a height/pierce cost), and if so by what rule?

### Task 0: Over-constraint probe

**Files:**

- Create (scratch, uncommitted): `packages/excalidraw/components/terraformStrataRankCompactOverConstraint.probe.test.ts`

**Interfaces:**

- Consumes: the M0 formulation prototype's freeze + solve helpers (copy from `scratchpad/m0-prototypes/terraformStrataRankCompactM0.probe.test.ts`).
- Produces: a **decision** — the C2 pair-membership rule Phase 1's solver uses (either "all baseline band-sharing pairs" or "band-sharing pairs whose relaxation raises pixel height / adds a pierce", i.e. a tightened set).

- [ ] **Step 1:** Copy the M0 formulation prototype into the probe; confirm it reproduces the M0 numbers (band-sharing C2: −29.6% L1, DLQ→0.6×, width 29→24, height +0) on the config `preset=staging-extended-localstack-v2, view=strata, compact=1, ancillary=0, privateApiRegional=0, strataSweeps=4, strataCoordRefine=1, strataRankSep=1, strataPackedScoring=1, strataPackedEps=2, strataBandDepth=root, strataSift=1, strataPackedConverge=1, layers=declared`.
- [ ] **Step 2:** For each band-sharing C2 pair involving a degree-1 sink (the DLQs) or a low-degree leaf, **drop that pair** from the constraint set, re-solve, and measure **pixel height** and **frame-pierce count** through the full app path (`placeStrataHulls` + `buildStrataScene`). Record which drops stay height-safe (Δheight ≤ 0, Δpierce ≤ 0) and how much extra L1 they buy.
- [ ] **Step 3:** Decide the rule. Expected outcomes: (a) if dropping the DLQ's band-sharing pair is height-safe (agent-2's measurement generalizes) → Phase 1 relaxes sink pairs → bigger DLQ win; (b) if it re-stacks taller (agent-1's pin is real) → Phase 1 keeps the full band-sharing set → moderate win. **Write the decision + numbers into the plan's Phase-1 solver task before building.**
- [ ] **Step 4 (no commit — scratch probe):** Record findings in `scratchpad/strata-phase0-overconstraint.md`.

**Run:** `node_modules/.bin/vitest run --cache=false packages/excalidraw/components/terraformStrataRankCompactOverConstraint.probe.test.ts` (needs a private `vitest.probe.config.mts` — see M0 harness notes). **Gate:** Phase 1's solver C2-set definition is FIXED by this result. Do not start Task 2 until Step 3 is written down.

---

## Phase 1 — Solver + threading + M1 gate (the shippable increment)

### Task 1: Thread `strataRankCompact` (inert)

**Files (all modify — mirror `strataPackedConverge`, commit `e22e5c657`):**

- `terraformPipelineStrataTypes.ts` — add `rankCompact?: boolean` to `StrataEngineOptions`.
- `terraformDemoUrlParams.ts` — add `strataRankCompact?: boolean` to `TerraformDemoUrlParams`, parse via `parseBooleanParam`, spread in return, `setBool` emit for share URL.
- `terraformStrataDefaults.ts` — `strataRankCompact: false` in `TERRAFORM_STRATA_LAYOUT_DEFAULTS`; resolve `?? false` in `resolveStrataDemoOptions`.
- `terraformLayoutCore.ts` — add to `LayoutSceneContext`; **forward in the `sceneContext` literal**; add to `builderOptions`.
- `terraformPipelineStrata.ts` — read local, `flagMeta` echo only when on, `engineOptions` `...(strataRankCompact ? { rankCompact: true } : {})`.
- `terraformImportSession.ts`, `terraformCanvasShareUrl.ts`, `terraformSceneApply.ts` — session/share/persistence threading.

**Interfaces:**

- Produces: `options.rankCompact: boolean` readable in `terraformPipelineStrataRank.ts`; URL param `strataRankCompact=1`.

- [ ] **Step 1:** Write the failing test in `terraformPipelineStrataRankCompact.test.ts`: an OFF arm and an OFF-explicit arm (`strataRankCompact:false`) on the preset; assert `sceneFingerprint(offExplicit) === sceneFingerprint(off)` (byte-identity) — this passes trivially now and guards the whole feature. Add a URL round-trip assertion (`strataRankCompact=1` parses to `true`).
- [ ] **Step 2:** Run: `node_modules/.bin/vitest run packages/excalidraw/components/terraformPipelineStrataRankCompact.test.ts` — expect the byte-identity + round-trip to PASS (flag is inert).
- [ ] **Step 3:** Thread all 7 layers per the file list above (engine reads `rankCompact` but still returns the separated floor — no behavior yet).
- [ ] **Step 4:** Re-run the test + the full strata suite touching these files (`terraformStrataDefaults.test.ts`, `terraformDemoUrlParams.test.ts`, `terraformCanvasShareUrl.test.ts`): all green, byte-identity holds.
- [ ] **Step 5:** Commit `feat(terraform): strataRankCompact flag threading (inert, default-off byte-identical)`.

### Task 2: The compaction solver

**Files:**

- Create: `terraformPipelineStrataRankCompact.ts` — export `computeStrataRankCompactFloor(units, edgesPrime, separatedFloor, options)`.
- Modify: `terraformPipelineStrataRankSeparate.ts` — export the band-sharing pair set + oriented sep-edges (per Phase-0's C2-set rule) so this file reuses them.

**Interfaces:**

- Consumes: the separated-floor placement (baseline), the oriented C2 sep-edges (`terraformPipelineStrataRankSeparate.ts`), `buildSeparationConstraintGraph` + `computeNetworkSimplexDepths` (`terraformPipelineLayoutShared.ts`), the Phase-0 C2-set rule.
- Produces: `computeStrataRankCompactFloor(...): { columnOf: Map<unitId, number>, fellBack: boolean }` — a per-unit column assignment minimizing Σ w_e|col_u − col_v| under C1+C2+C3+C4, or the separated floor with `fellBack:true` if infeasible/degenerate.

- [ ] **Step 1:** Write the failing unit test: a small synthetic scene (a source→sink pair stranded by a fake separated floor) where the compact solve must pull the sink to the closest jointly-feasible column ≥ predecessor+1. Assert the returned `columnOf` and `fellBack:false`.
- [ ] **Step 2:** Run it — expect FAIL (function not defined).
- [ ] **Step 3:** Implement `computeStrataRankCompactFloor` by **productionizing** `scratchpad/m0-prototypes/terraformStrataRankCompactM0.probe.test.ts`: (1) freeze the band-sharing C2 pair set + orientation from `separatedFloor` per the Phase-0 rule; (2) assert C1∪C2 acyclic (reuse `constraintGraphHasCycle`) — if cyclic, `fellBack:true`; (3) build the difference-constraint graph (C1 forward-rank, C2 oriented separation, C3 containment as 2-var difference constraints, C4 width ≤ W₀); (4) solve via `computeNetworkSimplexDepths` with the L1-length objective; (5) 2-stage tiebreak (fix optimal L1 → min max-edge → canonical hullId tie). No module-level `LayoutShared` consts (NaN rule).
- [ ] **Step 4:** Run the unit test — expect PASS.
- [ ] **Step 5:** Add a determinism unit test: solve twice, assert identical `columnOf`. Add a baseline-witness test: the separated floor itself is a feasible point (objective ≤ baseline).
- [ ] **Step 6:** Commit `feat(terraform): strataRankCompact difference-constraint solver`.

### Task 3: Wire the solver into rank assignment

**Files:**

- Modify: `terraformPipelineStrataRank.ts` — NS-drop guard `:117-129` becomes conditional on `!rankCompact`; when `rankCompact`, call `computeStrataRankCompactFloor` and feed its `columnOf` into the `columnX` build `:175-194`.

**Interfaces:**

- Consumes: `computeStrataRankCompactFloor` (Task 2), `options.rankCompact` (Task 1).
- Produces: `columnX[rank]` derived from the compact assignment when on; unchanged when off.

- [ ] **Step 1:** Write the failing test (real app path, `layoutTerraformFromSources`, ON arm on the preset): assert the DLQ sinks' columns are strictly less than off (they moved left) and `fellBack:false`.
- [ ] **Step 2:** Run — expect FAIL (no wiring yet).
- [ ] **Step 3:** Wire it: guard the NS-drop, call the solver, map `columnOf`→`columnX`. Keep the off branch the literal current code (byte-identity).
- [ ] **Step 4:** Run — expect PASS; re-run the Task-1 byte-identity arm — still PASS.
- [ ] **Step 5:** Commit `feat(terraform): wire strataRankCompact solver into columnX assignment`.

### Task 8: M1 assertion gate (the real bar)

**Files:**

- Modify: `terraformPipelineStrataRankCompact.test.ts` — add the M1 arm, productionized from `scratchpad/m0-prototypes/terraformStrataM0EvidenceGate.probe.test.ts`.

**Interfaces:**

- Consumes: `pairedPathMetricsCi`, `computeStrataPathMetrics` (`terraformPipelineStrataPathMetrics.ts`), the full app path.

- [ ] **Step 1:** Write the M1 assertions (ON vs OFF, `coordinateRefine` on, n≥31 for p90): **paired rt̂ p50/p90 CI not adverse** AND **cr-on-path p90 CI not adverse** (the W5b bar — this is the gate W5b failed); **pixel width ≤ W₀**, **pixel height ≤ H₀**; total L1 improves; DLQ edges shorten; `fellBack:false`.
- [ ] **Step 2:** Run — expect PASS (M0 measured all of these clean: rt̂/cr [0,0], width/height +0, L1 −6–8%). If any is adverse on the productionized path, STOP and surface it (the M0 win didn't survive productionization).
- [ ] **Step 3:** Commit `test(terraform): strataRankCompact M1 real-app-path gate (rt̂/cr-on-path + pixel W₀/H₀)`.

### Task 9: Fixed-slot-width colX (heterogeneous-preset generality)

**Files:**

- Modify: `terraformPipelineLayoutShared.ts` and/or `terraformPipelineStrataRank.ts` — the `columnX` construction must use **fixed per-column slot widths established before the solve** so the pixel==column-span equivalence holds when cards are NOT uniform width.

**Interfaces:**

- Consumes: per-unit card widths.
- Produces: a `columnX` whose pixel width the solver's C4 cap and L1 objective faithfully track.

- [ ] **Step 1:** Write a failing test with a synthetic **heterogeneous-width** scene (one wide card in a narrow column) asserting that a move lowering Σ|Δcol| does NOT raise pixel width (the codex-#4/Fable-#3 counterexample must not fire).
- [ ] **Step 2:** Run — expect FAIL (naive column metric raises pixel width).
- [ ] **Step 3:** Implement fixed-slot-width colX: freeze each column's slot width from the max card at that rank in the baseline, and run the solve in that fixed-pixel metric.
- [ ] **Step 4:** Run — expect PASS; re-run the preset M1 arm (uniform-width) — unchanged.
- [ ] **Step 5:** Commit `feat(terraform): fixed-slot-width colX for strataRankCompact pixel fidelity`.

### Task 10: Regression gates + battery + freeze

- [ ] **Step 1:** Add a `strataRankCompact` arm to `terraformPipelineStrataPackedScoringBattery.test.ts`; assert `softFailures==[]` (no default-path meta leak).
- [ ] **Step 2:** Add opt-in-arm regression gates: rt̂ p50/p90 via `pairedPathMetricsCi`, slice-B extent p50/p90, raw crossings under ε, C=pen+crossings non-regression, churn M1_rel≤0.08 / M2_flip≤0.10, **build-time ≤ ~baseline** (record the NS solve cost — M0 measured 214ms cold).
- [ ] **Step 3:** Run the freeze/SHA gate tests — must be green with **no regen** (proves off byte-identical). If they demand regen, the off path is NOT byte-identical — STOP and fix.
- [ ] **Step 4:** Commit `test(terraform): strataRankCompact regression battery + gates`.

---

## Phase 2 — C3 containment hardening + Account-04 win (gated on Phase 1 shipping clean)

MOVE-A (Account-04) is the bigger cross-account-edge win but its **rigid** translate added +6 frame pierces in M0. The LP form must make C3 containment load-bearing so the account subtree stays inside its parent while moving.

### Task 11: Containment-guarded Account-04 compaction

**Files:**

- Modify: `terraformPipelineStrataRankCompact.ts` — ensure C3 containment constraints bind for account/region hulls (child columns within parent bbox, parent border tightened).
- Modify: `terraformPipelineStrataRankCompact.test.ts`.

- [ ] **Step 1:** Write the failing M1-style test: ON arm asserting Account-04 cross-account L1 drops AND **frame-pierce count ≤ off** (the +6 pierces must be eliminated by the containment constraints).
- [ ] **Step 2:** Run — expect FAIL if containment isn't binding (pierces appear).
- [ ] **Step 3:** Implement/tighten C3: parent-bbox difference constraints so moving a child drags/reshapes the parent border legally instead of overhanging.
- [ ] **Step 4:** Run — expect PASS (Account-04 shorter, 0 added pierces, rt̂/cr still [0,0], height ≤ H₀).
- [ ] **Step 5:** Commit `feat(terraform): C3 containment for strataRankCompact Account-04 (no added pierces)`.

---

## NOT in scope (separate specs)

- Freeing the sibling ordering (NP-hard MinLA) — order stays fixed.
- A full 2D coupled solve (the Y-axis NO-GO) — X-only, Y frozen.
- The #3 cosmetic natural-sort tiebreak for the loose column — trivial, ship separately.
- Replacing the ε default / owner objective ruling on crossings-for-length — the flag exposes it; the default is conservative (crossings-not-worse).

## Self-review notes

- Spec coverage: all 8 M0 formulation items map to Task 2 (solver) + Task 9 (pixel metric); Fable's W5b bar → Task 8; C2 over-constraint → Task 0; C3 pierces → Task 11; byte-identity/threading → Task 1; determinism → Task 2 Step 5.
- The solver internals reference the **preserved M0 prototype** rather than fabricated code — the prototype is a proven, measured implementation; productionizing it (typed exports, off-branch byte-identity, NaN rule) is the work.
- Phase 0 is a hard gate: its result changes Task 2's C2-set definition. Do not skip it.
