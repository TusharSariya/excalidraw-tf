# Strata `strataRankCompact` — generic horizontal edge-length compaction (design)

_Date: 2026-07-15 · branch `strata-v3.2-w5-w10b` · brainstorm output (owner-decided:
relax rankSeparate → soft width bound, preserve height)._

> **STATUS after eng-review + Fable/codex-5.6-sol adversarial review: NOT buildable as written.**
> Verdict = **GO-WITH-CHANGES gated on the M0 formulation spike below** (owner-decided
> 2026-07-15). The core idea (relax push-right, minimize horizontal edge length, opt-in) is sound
> and X-separability is real, but several central claims below were refuted — the **Solver** reuse,
> the **width/L1 metric** (column vs pixel), the **C2 height-by-construction**, the crossings-only
> gate, and the **degree-1-automatic** claim. Read `## M0 — Formulation spike` and
> `## GSTACK REVIEW REPORT` first; treat the Design/Constraints/Solver sections as the *pre-review*
> proposal that M0 must correct and prove before any implementation plan is written.

## Problem

On preset `staging-extended-localstack-v2` the strata view leaves nodes stranded far to the
**right** of their neighbours, producing long horizontal edges: Account 000000000004's whole subtree
(cross-account edges), and the DLQ pure-sinks (2212px / 3204px, ~100% horizontal). A 6-agent audit
(`docs/strata-nitpick-layout-optimization-2026-07-15.md`) proved the root cause is **not** a bug or a
missing *ordering* pass — it is that **strata has no rank-axis (horizontal) edge-length compaction**.
Every unit's X is its dataflow rank in a global column grid, and `strataRankSeparate` (the height
lever) applies an **all-to-all sibling push-right** that strands units. The edge-length-minimizing
network-simplex ranker (`computeNetworkSimplexDepths`) is **explicitly dropped whenever `rankSep` is
on** (`terraformPipelineStrataRank.ts:117-129`); the two never compose.

## Literature basis (4-agent review, `scratchpad/strata-hcoord-lit-*.md`)

- **Fixed rank + fixed order + fixed nesting ⇒ minimizing weighted total L1 horizontal edge length is
  a convex LP → global optimum, polynomial, sub-ms at ~120 nodes** (Gansner network-simplex
  `gansner-tse93`; Jünger-Mutzel-Spisla min-cost-flow `crossref-10-7155-jgaa-00500`). NP-hard **only**
  if the ordering is freed (Minimum Linear Arrangement) — so **order stays fixed**.
- **The Y-axis 2D-inseparability NO-GO does NOT transfer to X.** Y failed because lane-rise reads the
  perpendicular axis while it is *also* moving. For X, **rank order is fixed and Y is frozen**, so
  overlaps reduce to 1D separation constraints (Dwyer overlap-removal `dwyer-ipsep-cola`) →
  separable → exact. Corroborated: the audit's measured pure-X translation was **−4.79% / −9.19% L1
  at zero structural/order violations**.
- **Degree-1 DLQ sink = the trivial corner case**: the L1-optimal position of one free node is the
  **weighted 1-median** of its neighbours; one neighbour ⇒ that neighbour's coord ⇒ `predecessor+gap`.
  No sink-specific pass — it falls out of the general solve.
- **Do NOT use naive per-node median descent** — it stalls at non-stationary points under separation
  coupling (the repo's already-logged non-convergence). The **exact flow/NS is the correctness
  baseline**; descent is at most a warm-start.
- **JMS prescribed-width throttle** (min length among all width-≤W drawings) is the principled way to
  relax the hard push-right into a soft bound — this is the model the owner chose.

## Decisions (owner-adjudicated)

1. **Ambition:** relax `rankSeparate`'s hard push-right into a **soft width bound inside a min-cost
   flow** (not merely compose an X-solve on top of the untouched floor). Bigger reclaim (Account-04
   narrows *and* moves left).
2. **Height policy:** **preserve height, reclaim only width/length.** Keep the Y-band-sharing
   X-disjointness constraints (they are what buys height); drop only the total-order push-right; cap
   width at today's separated-floor width. ⇒ **no taller, no wider, edges shorter.**

## Design

### Feature flag
`strataRankCompact` — boolean, **default `false`**, **byte-identical when off** and for non-strata
views. When on it supersedes `computeStrataSeparatedFloor`'s hard push-right with the soft-width
flow. Threaded through the standard 7 demo→engine layers + session/share/persistence (per
`rcll-option-threading-boundary`: it MUST be forwarded in the `sceneContext` literal in
`terraformLayoutCore.ts` or it is silently dropped on the real app path).

### Pipeline placement
Runs at the **rank/column-assignment** stage (`terraformPipelineStrataRank.ts`), in the **unit-column
metric** (integer column indices), replacing the separated-floor column assignment when the flag is
on. Output is the same shape today's floor produces (`columnX[rank]` + per-unit column span), so
`placeStrataHulls` (`terraformPipelineStrataPlacement.ts:155-171`) is unchanged downstream.

### Objective
Minimize **weighted total L1 horizontal edge length** `Σ_e w_e · |col_u − col_v|` over the frozen
rank order, with **max-edge length as a deterministic tiebreak** (avoids the "one edge grows a lot to
halve the total" pathology the owner would notice, since the nitpicks were phrased per-edge). Edge
weights follow Gansner priority (up-weight long/virtual chains).

### Constraints
- **(C1) Forward-rank / layering** — `col_v ≥ col_u + 1` for each dataflow edge u→v (hard; the
  existing floor invariant, re-validated via `isDepthFloorValid`).
- **(C2) Y-band-sharing X-disjointness** — for siblings sharing a Y-band, keep the pairwise
  column-disjointness rankSeparate enforces (**this is the height-preserving constraint**; agent 3).
- **(C3) Container containment** — child columns stay within parent bbox; parent border is a bbox
  variable (linear; IPSep-CoLa containment). Moving a child may drag its container; the solver stops
  at the collision boundary — worst case is "no compaction," never a footprint blow-up (Y is fixed).
- **(C4) Width cap** — total width ≤ today's separated-floor width `W₀` (hard; guarantees no width
  regression). This is the JMS capacity-W throttle arc.
- **Dropped:** the all-to-all total-order push-right (constraint (2) of today's rankSeparate).

### Solver
Extend the repo's `computeNetworkSimplexDepths` + `buildSeparationConstraintGraph`
(`terraformPipelineLayoutShared.ts`) into an auxiliary-graph min-cost-flow with the width-throttle
arc (JMS) and the C2/C3 constraints. Deterministic (Bland's rule / stable tie-break over the fixed
`hullIds` array — determinism is a hard repo invariant). New machinery allocates only in the
`strataRankCompact` branch.

### Crossings gate + ε
Length-optimal can raise crossings (audit measured +4 for −4.79%). Default = **hard "crossings not
worse than off"** gate: if the compacted assignment renders more crossings than the off path, fall
back to the off assignment (`fellBack:true`, report-only). The existing `strataPackedScoringEpsilon`
budget is exposed to optionally spend up to ε crossings for length (reuses the ε-frontier; ε=0 ⇒
strict). Penetrations must not worsen either.

### Degree-1 sinks
No dedicated pass. A DLQ (outDeg 0, inDeg 1) is the 1-median corner: its length-optimal column =
`predecessor_col + 1`, which the flow assigns automatically once the push-right is dropped. The audit's
"~500px, pierce gone" outcome is a consequence, not a special case.

## Invariants & constraints (repo history)
- Opt-in, **default-off**, **byte-identical off** and for non-strata views.
- **High regression bar**; build-time is the likely first failure. The flow is polynomial/sub-ms, but
  runs per layout — record build-time; the off path must be free.
- **NaN import-cycle:** no module-level consts from `terraformPipelineLayoutShared`; read options at
  call time.
- **Freeze / SHA baselines** (`docs/strata-baselines/*`, seed 20260704) must stay green with **no
  regen** — automatic iff the off path is byte-identical. Do not edit the freeze/gate tests.
- Determinism / stable iteration order is the tie-break substrate.

## M0 — Formulation spike (GATING precondition; owner-decided 2026-07-15)

**Both adversarial reviewers returned NO-GO / GO-WITH-CHANGES-as-written.** A probe-only spike
must prove ALL of the following BEFORE any threading or solver build. If it fails (as the closely
related W5b probe did), we spent a spike, not a build.

**Formulation proofs (codex-5.6, NO-GO 0.94):**
1. **Freeze the baseline Y-overlap pair set** — which box pairs share/overlap a Y band, from the
   baseline separated-floor placement.
2. **Freeze each C2 pair's left/right orientation** from baseline geometry. Non-overlap is
   *disjunctive*; a free orientation makes this a mixed-integer ordering problem → **NP-hard**. With
   orientations frozen it is a fixed-order convex LP / min-cost-flow. This is the single biggest risk.
3. **Metric:** define W₀ / L1 in **pixels post-placement** (or explicitly accept a rank-span proxy
   and prove it tracks pixels). Pixel width = Σ per-column *max* unit width — a max-over-assignment
   term, NOT a flow capacity; a column-metric throttle does not bound rendered width (Fable #3,
   codex #4). Use **fixed pixel slot widths** established before optimization if it must stay flow.
4. **Containment:** express C3 as linear two-variable difference constraints / eliminate derived
   parent bboxes (or a proven border-tightening objective) — do not leave parent borders as free vars.
5. **Solver class:** pick JMS min-cost-flow **or** a general difference-constraint LP. Do NOT describe
   the existing `computeNetworkSimplexDepths` rank-simplex as JMS — it has no width throttle or
   containment (`terraformPipelineLayoutShared.ts:498/582`).
6. **Baseline-witness feasibility for C1–C4:** admit the old separated-floor assignment as a solver
   candidate so the feasible region is provably nonempty (codex gave a cyclic-infeasibility
   counterexample when C2 orientation contradicts a C1 forward edge).
7. **2-stage deterministic tiebreak:** min total weighted L1 → fix that value → min max-edge →
   canonical coord/ID residual tie. "Stable hullIds" alone is insufficient (multiple flow optima).
8. **Degree-1 measured, not asserted:** the DLQ lands at the *closest jointly-feasible coordinate
   ≥ predecessor+1*, which a frozen-C2 sibling can push right of +1 (codex counterexample). Assert
   the ~500px outcome empirically.

**Evidence gate (Fable HIGHEST — the W5b lesson):** `docs/strata-view-w5b-joint-ns-probe.md` already
measured "minimize rank spans by NS under RS constraints" on this preset as a **NO-GO** — it
**improved global crossings** (217 vs 220; 84 vs 104) yet **regressed paired path metrics** (rt̂ p90
+4.47..+5.36, cr-on-path p90 +6..+7). So a **crossings-only gate is provably insufficient.** M1 must
assert, on the owner's real config through the full app path:
- **paired rt̂ p50/p90 + cr-on-path p90 NOT adverse** (the metric W5b failed on) — the real bar;
- **pixel** height ≤ H₀, **pixel** width ≤ W₀, total L1 improves;
- Account-04 narrows+moves-left; DLQ edges ~500px; `fellBack:false`;
- ON-layout band-pair coverage (the frozen C2 set still covers the compacted layout);
- `fellBack` rate + double-layout cost across the preset battery (if the gate trips on most configs
  the feature is dead weight; if it needs a rendered-crossings compare it implies a full double
  layout per import — an unstated build-time cost);
- COLUMN_GAP vs nested `FRAME_PAD` arithmetic (column-disjointness ≠ pixel-disjointness).

The bet the spike must validate: dropping the push-right unlocks block-moves W5b's constraints
forbade (the measured +4-crossings / −4.79% translation is a feasible point W5b could not reach). If
the block-moves regress rt̂/cr-on-path like W5b, this is a NO-GO — surface it, do not build.

## Per-file change list (approximate — verify at implementation)
1. `terraformPipelineStrataRank.ts` — the behavior change: soft-width flow branch behind
   `strataRankCompact`; keep the current separated-floor path as the default branch (byte-identity).
   NS-drop guard at `:117-129` becomes conditional. `columnX` build at `:175-194` reads the flow's
   assignment when on.
2. `terraformPipelineStrataRankSeparate.ts` — factor out the band-disjointness (C2) so the flow can
   reuse it without the push-right.
3. `terraformPipelineLayoutShared.ts` — extend `buildSeparationConstraintGraph` /
   `computeNetworkSimplexDepths` with the width-throttle arc + containment.
4. `terraformPipelineStrataTypes.ts` — `rankCompact?: boolean` on `StrataEngineOptions`.
5. `terraformPipelineStrata.ts` — read local, `flagMeta` echo when on, `engineOptions` map.
6. `terraformLayoutCore.ts` — `LayoutSceneContext` field + **forward in the `sceneContext` literal**
   + `builderOptions`.
7. `terraformDemoUrlParams.ts`, `terraformStrataDefaults.ts` (`strataRankCompact: false`),
   session/share/persistence (`terraformImportSession.ts`, `terraformCanvasShareUrl.ts`,
   `terraformSceneApply.ts`).

## Test & verification plan
- **New assertion test** `terraformPipelineStrataRankCompact.test.ts` (cloned from the sift-relocate
  test; preset + us-west-2 + `sceneFingerprint`). Arms: OFF, OFF-explicit, ON, ON-rerun. HARD asserts:
  byte-identity (off≡off-explicit), determinism (on≡on-rerun), **no width/height regression**,
  crossings ≤ off (or ≤ off+ε). App-path arm with `coordinateRefine` on.
- **Regression gates** (opt-in arm only): rt̂ p50/p90, extent, raw crossings under ε, C=pen+crossings
  non-regression, churn, **build-time ≤ ~baseline**.
- **Freeze / SHA gates** stay green with no regen.
- **End-to-end manual:** load the two demo URLs with `&strataRankCompact=1`, confirm Account-04
  narrows+moves-left and DLQ edges shorten, height unchanged.

## Risks
- **R-height-regression (highest):** dropping push-right without keeping C2 reintroduces the tall
  layout. Mitigation: C2 is a hard constraint; test asserts `height ≤ H₀`.
- **R-crossings:** length-optimal raises crossings → hard gate + ε; fall back to off on regression.
- **R-container-coupling:** if moving a child forces a 2D-coupled container move, the 1D model is
  unsound for that case → M1 evidence gate must confirm the owner cases solve within the 1D model.
- **R-byte-identity:** flow path must be a separate branch behind the flag; `sceneContext` literal
  must forward it.
- **R-build-time:** poly but per-layout; record and gate.

## Out of scope (separate specs)
- Freeing the ordering (NP-hard MinLA) — order stays fixed.
- A full 2D coupled solve (the Y-axis NO-GO) — X-only, Y frozen.
- The cosmetic natural-sort tiebreak for the loose column (#3 eyesore) — trivial, ship separately.

## Provenance
- Brainstorm 2026-07-15. Audit: `docs/strata-nitpick-layout-optimization-2026-07-15.md`. Lit review:
  `scratchpad/strata-hcoord-lit-{heuristic,exact,compound,generic-codex}.md`. Doc_ids: `gansner-tse93`,
  `crossref-10-7155-jgaa-00500` / `forward-10-1007-978-3-030-04414-5-13` (JMS flow), `dwyer-ipsep-cola`,
  `elk-10-1007-3-540-45848-4-3` (BK), `doi-10-1007-978-3-319-27261-0-12` (Rüegg), `handbook-hierarchical`.
- Adversarial reviews (verbatim): `scratchpad/strata-rankcompact-review-fable.md`; codex-5.6 review
  output harvested into the review below (read-only sandbox blocked its file write).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_found | Step-0 scope clean (reuse map + NOT-in-scope); 1 load-bearing arch finding (A1 = flow feasibility) escalated to the adversarial pass |
| Adversarial (Fable) | design review | Independent 2nd opinion | 1 | GO-WITH-CHANGES | 5 findings: W5b crossings-gate insufficient (HIGHEST), C2≠pixel-height, JMS width in wrong metric, ε double-spend + double-layout cost, separability oversold |
| Adversarial (codex-5.6-sol) | math/formulation review | Independent 2nd opinion | 1 | NO-GO-as-written (0.94) | C2 orientation must be frozen or NP-hard (biggest risk); solver is new not reuse; W₀ refuted; degree-1 refuted under joint constraints; on-path tiebreak underspecified |

- **CROSS-MODEL:** Complementary, not contradictory. Both agree: pixel-vs-column metric is wrong,
  crossings-only gate insufficient, degree-1 contingent, opt-in/byte-identity-off fine, X-separability
  real. Codex adds the NP-hard-if-C2-orientation-free formulation risk; Fable adds the measured W5b
  prior NO-GO on the same lever class. Net verdict: **NO-GO as written → GO-WITH-CHANGES after the
  M0 formulation spike + a W5b-grade (rt̂/cr-on-path, pixel-metric) evidence gate.**
- **VERDICT:** ENG REVIEW = issues_found (not CLEARED). Design is **gated on M0**: run the
  probe-only formulation spike proving codex's 8 items + Fable's revised M1 gate BEFORE writing the
  implementation plan. Owner-decided 2026-07-15: **formulation spike first.**

**M0 SPIKE OUTCOME (2026-07-15): PASS — both halves measured (2 opus worktree agents; codex verifier
hung on blocked RAG-SSH, killed).**
- **Formulation = provably polynomial.** Fixed-order difference-constraint LP; the separated floor
  already emits C2 as *oriented* sep-edges (3680/3680 agree, C1∪C2 acyclic) ⇒ **no free disjunction,
  no NP-hardness** (codex's biggest fear refuted on this preset); solved by the existing Gansner
  network-simplex (`computeStrataJointNsFloor`→`computeNetworkSimplexDepths`) in 214ms; baseline-witness
  feasible; deterministic. Pixel metric moot here (uniform 346px columns ⇒ rank-span == pixel L1;
  preset-specific — heterogeneous cards need a fixed-slot-width colX model).
- **Evidence gate = no W5b regression.** Measured through the full app path with W5b's own instruments
  (`pairedPathMetricsCi` on rendered routed polylines, n=500): rt̂ p90 and **cr-on-path exactly [0,0]**
  on all arms (W5b was +4.5 / +6), edge length −6–8%, pixel width/height +0. Shorter edges at zero
  path-tracing cost. `fellBack` would NOT trip.
- **Regime finding (scopes the build):** the height-safe **band-sharing C2** relaxation gives −29.6% L1
  + width 29→24 cols at zero height cost, DLQ to 0.6×, Account-04 half-way. The audit's flashier
  "DLQ→500px / Account-04 far-left" was the **rankSeparate-OFF** regime (regresses height, not the
  design). MOVE-A rigid translate added +6 frame pierces ⇒ C3 containment is load-bearing; MOVE-B
  (degree-1 sink pull-in) was clean (0 pierces). Reports: `scratchpad/strata-m0-{formulation,evidence-gate}.md`.

**UNRESOLVED DECISIONS:**
- **Over-constraint question (Phase-1 first task):** agent-2 measured the *aggressive* DLQ pull-in
  (to source+1, height +0, clean) yet agent-1's height-safe LP holds it at 0.6× because a band-sharing
  sibling Y-overlaps it — is band-sharing C2 over-constrained (a safe bigger win left on the table)?
  Decides how far MOVE-B goes. To be settled by a probe inside the implementation plan.
