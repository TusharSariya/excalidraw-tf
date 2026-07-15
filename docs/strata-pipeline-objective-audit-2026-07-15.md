# Strata pipeline — ORDER / RANKING / MEASUREMENT audit — 2026-07-15

**Purpose.** Handoff record of a 10-agent (7 Fable + 3 codex-5.6-sol) deep audit answering the
owner's question: *is the strata layout algorithm's stage ORDER, its per-stage RANKING/objective,
and its EVALUATION criteria correct — or were they assembled incrementally ("stochastically") into a
pipeline that optimizes technical scores while producing visually worse layouts?* Every agent had
graph-layout-rag + web + the repo, measured through the real app path where possible, and
shit-tested its own conclusion. Config under study: `staging-extended-localstack-v2`, strata,
everything on, **edge-routing OFF**, `strataBandDepth=root`, `strataPackedEps=2` (treated as under
examination). Agent reports: `scratchpad/strata-pipeline-audit-*.md`.

> **TL;DR verdict.** **Your instinct is right that the layouts are suboptimal and there is a
> blindness — but the objective *ordering* (`crossings ≻ pen ≻ length`) is NOT the proximate villain,
> and two premises in the framing are factually wrong.** Within the space it actually searches, the
> objective is well-aligned with visual quality (it picks the min-edge-length geometry in 21/28
> hulls; the measured crossing-for-length trades run the *right* way). The visible ugliness comes
> from **four different, more fixable defects** — a **straight-chord proxy that sometimes inverts the
> real crossing count**, a **search-space gap on the X axis** (the complained-about moves are never
> generated), **descent non-convergence**, and an **unscored crossing-angle** — sitting on top of a
> **genuinely mis-specified objective and a directionally-circular evaluation** that are latent risks
> and the reason the X gap can't be closed cheaply. The pipeline's macro ORDER is canonical; the
> "stochastic assembly" is real but concentrated in the **objective/comparator layer and the
> refinement tail**, not the skeleton.

---

## Two premise corrections (establish these first)

1. **Your config is NOT running lexicographic `crossings ≻ pen ≻ length`.** With `strataSift=1`, the
   packed descent routes *every* adoption through the **weighted** comparator (`strataRelocateAdoptable`
   → `C = penalties + crossings`, 1:1 fungibility), not the lexicographic rule
   (`terraformPipelineStrataPackedScoring.ts:818-838`). Measured on your real config: lex and weighted
   **disagree on 43.8% of adoption decisions** (2,332/5,324), and **39% of the weighted rule's
   adoptions raise raw crossings**. The feature named "crossings≻length" implements crossings↔pen
   fungibility, not crossings primacy. [PROVEN — ranking-consistency probe, 5,324 trials]
2. **Edge length is not "third priority" — it has *zero* weight on the axis that matters.** Every
   unit's X is pinned to its rank, so the L1 tiebreak is mathematically blind to *horizontal* length
   (`terraformPipelineStrataPlacement.ts:155-171`), and the complained edges (DLQ 2212/3204px) are
   ~100% horizontal. Length isn't demoted; it's **unrepresented** on X. [PROVEN — edge-length agent]

---

## The empirical keystone (silly-layout hunt — dual-scoring probe, 5,325 trials, real app path)

This is the direct test of "worse technical score but looks better." **Split verdict:**

- **INSIDE the searched Y-ordering space → owner's claim REFUTED.** Every rejected ordering (28
  hulls, 220+ geometries, big hulls re-scanned exhaustively) scored on the engine objective + 7
  independent visual proxies (total/max/sd/p90 edge length, detours, backtracks, sharp-crossing
  share, area): **zero strict mismatches**; the engine pick **is the min-total-edge-length geometry
  in 21/28 hulls**; the feared "trade 1 crossing to make 5 edges 3× longer" pattern **does not
  occur** — the min-length alternative in the worst hull costs **+73 crossings for −1.2% length**,
  correctly rejected. Within its search space the objective is *not* producing silly layouts.
- **OUTSIDE the search space (X axis) → owner's examples are real but misdiagnosed:**
  - **Account-04 pull-in:** max collision-free left-shift **1470px** → total length −5.5%, max edge
    −11%, area −10%. Engine rejects it (+7 chord-crossings/+6 pen). Technically-worse-score,
    visually-better — **but this geometry is never enumerated** (no stage moves X). A **search-space
    gap**, not an objective preference.
  - **DLQ sink pull-in:** **strictly better on the engine's own objective** (ΔL1 −10,120,
    crossings/pen unchanged). The objective *agrees with the human*; there's just **no operator** to
    reach it.
- **NEW, decisive finding — the chord scorer inverts real decisions (rendered confirmation):**
  Region-04 trio on real polylines — engine pick renders at 169 crossings; **alt#142, rejected for
  "+3 chord crossings," renders at 162 crossings** (the straight-chord proxy got the *primary term's
  sign wrong*); **alt#146, missed by the descent even with converge ON, renders at 143 crossings
  (−15%) and lex-beats the engine on final chord geometry too.** Residual in-space ugliness is
  **proxy-fidelity + non-convergence, not objective blindness.** Also: crossing **angle** is unscored
  and *anti-correlates* with count (sharp-share 0.337→0.480 while crossings fell 31%). [PROVEN]

**So the reorganized diagnosis:** the objective ordering is largely fine *within its search space*;
the visible ugliness is (a) the chord proxy mis-counting, (b) the X search-space gap, (c)
non-convergence, (d) unscored angle — with the objective/measurement mis-specification as the deeper
latent layer.

---

## Per-axis verdicts

### 1. STAGE ORDER — canonical, two structural gaps [order agent]
- Stages 1–4 (rank → order → packed) map 1:1 onto Sugiyama/dot/ELK/OGDF canon. "X fully before Y" is
  defensible (joint X↔Y probed twice in-repo, resolved against coupling). **CORRECT.**
- **Gap A — no routing phase:** the optimizer scores straight center-chords, not rendered polylines
  (this is what enables the chord sign-inversion above). Canon has routing as a final phase.
- **Gap B — the A7 → guard → relocate tail is accreted thrash [PROVEN]:** A7 (length-only, crossings-
  blind) pushes hulls (measured +826px, adding crossings); relocate exists *to undo A7* under a third
  comparator; the guard's "never worse" is computed on pre-relocate geometry then relocate mutates it
  (stale guarantee). Six accreted patches, three comparators, **no fixpoint.** This is the
  stochastic-assembly signature — localized to the tail.

### 2. PER-STAGE RANKING — individually defensible, mutually incoherent [ranking-consistency, edge-length]
- **Priority inverts across levels:** root-band ordering is length-proxy-first (`weightedBandsSkippedCost`);
  interior packed is crossings-first; A7 is length-*only*; guard is crossings-first. Each stage
  corrects the previous one's objective. [PROVEN]
- Weights are hand-set (`penW=crossW=1` identity default, `1f79f8bf0`); the comparator *shape* differs
  by stage (lexicographic vs weighted-sum vs capped) with no declared preference semantics.
- The weighted descent ends at (196 cr, 108 pen) but a lexicographic counterfactual ends at (196,
  103) — **dominating it under both comparators.** `strataPackedConverge` is papering over the
  weighted rule's non-monotone wandering. [PROVEN]

### 3. OBJECTIVE vs READABILITY — mis-specified, and the code admits it [readability, edge-length, epsilon]
- Lexicographic crossings-first is an **infinite exchange rate**; `PackedScoring.ts:30-32` *itself*
  cites Ware 2002 that a crossing is priced *finitely* (~0.65s, ~38° continuity-per-crossing). The
  learned-human-weights paper (Klammler et al. `arxiv-1809-01017v1`) puts **edge length ≈ crossings,
  w_CR ≈ 0** — directly against infinite priority. [PROVEN]
- Wrong **count**: it scores *global* scene crossings; Ware's significant term is crossings *on the
  traced path*. And crossing **angle** (Huang) matters comparably to count but is unscored.
- **rt̂ is in the wrong seat:** the honest Ware path-tracing metric never drives candidate selection —
  it can veto whole *features* via owner adjudication but can never *rescue a candidate*. Candidate
  selection is 100% crossings/pen. [PROVEN — this is the precise mechanism of the blindness]

### 4. MEASUREMENT — directionally circular, proxy-blind, under-validated [measurement-validity]
- **The blindness is one-directional:** the gates *can* block a technical win that hurts readability
  (they have — W7, W10b), but **nothing can approve a human-preferred layout that costs crossings**
  (your `cand13` can never be chosen). No metric measures semantic placement/salience — the construct
  behind your complaints. [PROVEN]
- Proxy-blind: optimizer scores straight chords, evaluation scores rendered polylines (the 169-vs-162
  inversion above is this gap biting). Under-validated: n=1 unlabeled Q7; Ware coefficients
  transferred from 42-node spring layouts, unvalidated on Terraform.

### 5. `rankSeparate` — a specific accepted-on-the-wrong-metric suspect [rank-x agent]
- Accepted at W4 on the *mean* extent CI; W5 showed on the repaired p90 that it **flips strata's only
  task-metric win into a loss** (rt̂ −0.27→+0.25, crossings 123→220); W8 recommended a guardrail that
  **was never shipped.** Your config still runs it. Its X "objective" is actually pure constraint
  satisfaction (3680 separation pairs when only 619 share a Y-band). [PROVEN]
- Caveat: the literature-canonical length-min X objective was built + measured **four** times (W5b,
  M0, M0.5, and this audit) and lost/degenerated each time on this compound substrate — so the fix is
  *not* "swap in a global length solve," it's re-adjudicating whether to run rankSeparate at all.

### 6. `ε=2` — an inherited magic number above measured saturation [epsilon agent]
- Introduced (`cb027ddd0`) as one report-only arm; the introducing experiment found the value
  **saturates at 1** (default stayed 0); sift+relocate (`1f79f8bf0`) then **inherited ε=2 with no
  ablation.** Evidence-supported global allowance is **0, not 2.** The mechanism is only
  *ε-inspired* (ORs a lexicographic move with a band move in a trajectory-dependent descent), not a
  proper ε-constraint global optimum; a **relative-ε mode already exists** in the resolver. [PROVEN]

---

## Consolidated recommendations (priority order — reconciled across agents)

**P0 — Fix what is literally wrong (measured + code-confirmed):**
1. **Re-score the top-k frontier on rendered/final geometry, not straight chords.** The chord proxy
   inverted real crossing decisions (169-vs-162, 143-vs-169) and the code-trace confirmed at source
   that the scorer/guard call leaf-box-centre chords "final geometry" over a *different edge universe*
   than the drawn arrows (5.1). We are sometimes optimizing a number whose *sign* is wrong. Highest
   value, contained.
2. **Fix the ε adoption gate's non-transitivity (correctness bug, code-trace 5.3).** The ε arm is a
   *gate*, not a comparator — it can authorize cycles (A→B and B→A from different baselines);
   `packedConverge` only patches the returned selection. Make adoption a true ordering (or make ε a
   proper constrained selection over a frontier, per the epsilon agent).
3. **Re-adjudicate `rankSeparate`** (surface the W8 guardrail): it flips a task-win into a loss and
   was accepted on a superseded metric.

**P1 — Break the circularity + close the visible gap:**
3. **Blinded pairwise held-out human preference set** (`cand33` vs `cand13`, etc.; you + ≥2 raters;
   frozen, never optimized against). The single cheapest circuit-breaker, and it *calibrates* the
   crossings↔length/placement exchange rate the objective currently guesses. Unblocks Q7.
4. **Ship the targeted X-length pass** (the paused rank-compact / DLQ pull-in): DLQ is
   objective-aligned (no ruling needed); Account-04 needs an exchange-rate ruling (+7 cr for −5.5%
   length) — feed it from (3).

**P2 — Fix the incoherence / accretion:**
5. Pick ONE comparator shape (measurement favors lex+ε); **split ε's three overloaded roles**; anchor
   all budgets to one baseline; set ε from evidence (0, adaptive-relative, or the Ware-weighted Pareto
   frontier).
6. Make **A7 crossings-aware** (removes relocate's undo role); close the stage-4↔7 tail under one
   comparator / move the guard after relocate.
7. Put a **finitely-priced, on-path, angle-aware** readability term (or rt̂ itself) into candidate
   *selection*, not just feature-veto. Add a crossing-angle term.
8. Address descent **non-convergence** (converge missed the lex-better `alt#146`).

**P3 — Foundations:**
9. Add a routing phase OR quantify + bound the chord-vs-rendered gap.
10. Harvest the missing papers (below) into graph-layout-rag.

---

## Missing-papers list (owner-requested)

**Caveat:** two of three codex agents had their graph-layout-rag queries **sandbox-blocked** (RAG SSH
denied), so their "missing" entries are from-memory and UNVERIFIED — re-run corpus checks on the
desktop (where RAG works) before treating any as a confirmed gap. Fable agents (RAG worked) confirmed
several as genuinely absent.

**Confirmed absent (Fable, corpus-checked):** Kieffer et al. **HOLA** (TVCG 2016 — objective derived
*from* human layouts, the exact antidote pattern); Purchase GD'97 "Which Aesthetic Has the Greatest
Effect"; Huang et al. JVLC 2014 (crossing-angle ~70° threshold); van Garderen/Kobourov GD'14 "Are
Crossings Important for Drawing Large Graphs?"; Bennett et al. "Aesthetics of Graph Visualization"
(CAe 2007); Okoe & Jianu GraphUnit (EuroVis 2015); Purchase "Metrics for Graph Drawing Aesthetics"
(JVLC 2002); van Ham & Rogowitz (TVCG 2008).
**Metadata-only (needs full-text harvest):** **Ware et al. 2002** (`doi-10-1057-palgrave-ivs-9500013`
— the rt̂ source, cited by name in code); **Chimani 2014** "Less Stress and Fewer Crossings."
**Unverified (codex, corpus-blocked):** Haimes-Lasdon-Wismer 1971 (ε-constraint origin); Marler &
Arora 2004; Miettinen 1999; Sugiyama-Tagawa-Toda 1981; Brandes-Köpf 2002; Sander 1996; Forster/
Bachmaier global sifting; Nachmanson GLEE (GD 2007); North-Woodhull GD 2001; Petit MinLA (JEA 2003).
**Present + on-point (use these):** Klammler et al. `arxiv-1809-01017v1` (learned human weights,
w_CR≈0); Di Bartolomeo et al. layout-evaluation systematic review `forward-10-31219-osf-io-ms27r`;
Ahmed et al. `(SGD)²` `arxiv-2112-01571v1`; Huang `doi-10-1109-apvis-2007-329282`.

---

## Per-agent record
- **order** → macro correct; no routing; A7→guard→relocate tail = accreted thrash (3 comparators, no fixpoint).
- **ranking-consistency** → config runs WEIGHTED not lex; 43.8% decisions differ; 39% weighted adoptions raise crossings; priority inverts across levels; converge papers over non-monotone wandering.
- **readability-objective** → infinite exchange rate (code admits it); global-not-on-path; angle-blind; rt̂ in wrong seat.
- **measurement-validity** → one-directional circularity; can block wins, can't approve human-preferred; n=1 Q7; chord-vs-rendered. Cheapest fix = blinded pairwise held-out set.
- **silly-layouts** (keystone) → REFUTED in-search-space (objective well-aligned, 21/28 min-length); REAL out-of-space (X gap); chord scorer INVERTS crossing count; non-convergence; angle unscored.
- **edge-length-demotion** → length has zero weight on X (not demoted, unrepresented); complaints are horizontal; pen≻length defensible; ε=2 governs a move-space with no horizontal moves.
- **rank-x-objective** → rankSeparate accepted on wrong W4 metric, flips a task-win to a loss, W8 guardrail never shipped; length-min X built+lost 4×.
- **epsilon-budget** (codex) → ε=2 inherited, above measured saturation at 1; only ε-inspired not proper ε-constraint; recommend Ware-weighted Pareto.
- **literature-gap** (codex, corpus-blocked) → recognizable Sugiyama skeleton, incomplete final phase, insufficient cross-phase objective contract; lex+ε=2+comparator-switching not literature-supported; measurement circular.
- **code-trace** (codex) → every stage is a PROVEN stated-vs-actual DIVERGENCE. Three code-level bugs beyond the objective design: **(5.1)** the scorer/guard call straight leaf-box-*centre chords* "final geometry" while real arrows are built later with binding repair and a *different edge universe* (self-loops scored-excluded but drawn) — the chord-inversion bug, confirmed at source; **(5.3)** the **ε adoption gate is non-transitive / non-antisymmetric** — it is not a comparator and can authorize cycles (both A→B and B→A from different baselines); `packedConverge` repairs the returned selection, not the adoption relation; **(5.2/A7)** A7's acceptance is a literal L1 sum but it optimizes an **L2 isotonic fit over LCA block-centres**, not the stated leaf-chord L1 — it doesn't solve its own objective. Also: `strataRelocateScoreLess` rounds `penW·pen+crossW·cross` so distinct exact costs collapse into length-broken ties; all six active comparators lack finiteness (NaN) guards (reachability unproven); "sift/relocate" is really 3 stages and the post-A7 guard does **not** guard the final vertical-relocation output. Magic constants (ε=2, penW=crossW=1, raw-cap=2, A7 tol 1e-6) all UNEXPLAINED in git; only the skipped-band height coeff is spec-traceable. (Ran on codex default model medium — gpt-5.6 was 400-rejected for the ChatGPT account.)

## Provenance
- Audit 2026-07-15, branch `strata-v3.2-w5-w10b` @ `3f668ce3d`. 10 agents (7 Fable + 3 codex-5.6-sol med),
  read-only. Reports in `scratchpad/strata-pipeline-audit-*.md` (codex ε + lit-gap delivered inline —
  sandbox blocked their file writes). Related: `docs/strata-methodology-audit-2026-07-15.md` (prior
  isolation-level audit, "sound"; this one went cross-stage and found the incoherence), the
  rank-compact spec + M0/M0.5 spikes, `docs/strata-view-w5b/w8b*` (the rankSeparate + ε history).
- The rank-compact build decision stays **paused**: this audit reframes it as **P1 item (4)**, to be
  fed by the calibration set (3), not decided in isolation.
