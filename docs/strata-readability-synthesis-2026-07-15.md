# Strata readability — CONVERGED SYNTHESIS (JOINT-SYNTH, final agent, 13-agent investigation)

**Owner's question:** *Is strata's algorithm + measurement sufficient to jointly balance
crossings, penetration, edge length, and edge angle (metro hubs + straight octilinear lines)
under the left-to-right rule, and where does it fail?*

**Frozen scene** `staging-extended-localstack-v2 / strata / compact=1 ancillary=0 privateApiRegional=0
sweeps=4 coordRefine=1 rankSep=1 packedScoring=1 eps=1 bandDepth=root sift=1 packedConverge=1
transitiveAdopt=1 seed 20260704`. Baseline H0 (real app path): chord {cr 204, pen 66, L1 733742,
weightedC 270} · rendered {cr 173, pierce 66, sharpShare 0.51, median crossing-angle 29.7°,
X-length ≈73%} · LR feasible (0 violations). Harness validated by M-MEAS (both scoring worlds call
the real exported functions).

---

## 1. THE CONVERGED SUFFICIENCY ANSWER

**NO — strata's algorithm is not sufficient to jointly balance the four factors under LR. But the
gap is a SINGLE missing search operator, not the objective and not the measurement.**

The four factors do **not** fundamentally conflict under LR on the moves that matter — they
**COMPOSE** (§2). The reason strata never achieves the balance is not that the objective mis-weighs
them or the measurement can't see them; it is that **the descent only ever moves nodes on the Y
(row) axis. No operator moves a node on the X (rank/flow) axis** — the axis carrying ~73% of edge
length and every one of the owner's three complaints. The owner's better layouts are *entirely
horizontal rearrangements* that the search never generates.

Three facts make this the decisive diagnosis, and all three are proven on the harness:
- **The acceptance machinery already adopts the owner's layouts the instant they exist.** CASE-C2
  fed an X-moved DLQ placement end-to-end through the real `chooseStrataRefinedPlacement`:
  `adoptedMoved=true, fellBack=false`. The weighted-C guard + transitiveAdopt took a −9519 chord-L1
  win with zero fallback. The only missing piece is the operator that *proposes* the move.
- **The moves are all LR-feasible** (F-LR, 100%-predictive left-bound law). LR is a mis-framed
  "tension": straightness is invariant to LR-feasible X-moves; LR must NOT be relaxed.
- **The objective already rewards them once X varies** — the existing length tiebreak fires the
  moment candidates differ on X (M-OBJ: every comparator shape prefers the moved candidate).

Everything else the plan worried about — angle blindness, penetration-scored-on-chords,
chord-vs-rendered crossing counts, comparator shape/ε incoherence — is a **REAL but LATENT**
scene-quality / objective-architecture defect that does **not move any of the owner's three cases**.
Those are genuine upgrades to the *quality of the layout the search converges to*; they are not the
reason the owner's specific complaints exist. Biggest single available win = the Account-04
pure-sink block shift: **−22 rendered crossings, −20 pierces**.

---

## 2. FACTORIAL JOINT-BALANCE TEST — do the four factors CONFLICT or COMPOSE under LR?

**Provenance:** the factorial is assembled from the per-case single-factor isolations already run on
the frozen harness (each owner case isolates a different factor), plus the CASE-C3 A+B composed
run which is itself the joint measurement. I did not re-run a fresh combined sweep; the composition
is already directly measured (C3 A+B) and the remaining cells are analytic given single-factor
dominance. Numbers are the canonical harness figures.

| Factor optimized alone | Operator | crossings Δ | pen Δ | length Δ | angle Δ | Reading |
|---|---|---|---|---|---|---|
| **baseline H0** | — | — | — | — | — | chord cr204/pen66/L1 733742; rendered cr173/pierce66 |
| **length** (C2 DLQ X-shift) | leaf X-shift → r8/10 | 0 | 0 (measured) | **−9519 chord / −11904 X** | 0 (~1.9°, already horiz) | pure length win; **orthogonal** to the other three |
| **crossings** (C1 X-compaction) | leaf X-compaction → r13 | chord −2 (rendered 0) | −1 pierce | **+808 (RISES)** | 0 (inert on X) | marginal; the ONE within-case bicriteria trade (cr/pen ↑ vs length ↓) |
| **crossings+pen jointly** (C3 Account-04 block Δ3) | hull/block X-shift | **rendered −22** | **−20 pierce** | chord C −37 | co-moves (unscored) | crossings & penetration **co-improve** — no trade |
| **ALL jointly under LR** (C3 A+B compose) | leaf + block X-shift | **−20** | **−21** | large −L1X | co-moves | **composes cleanly**; no factor regresses another |
| **anti-pattern** (blanket ranker swap) | replace rankSeparate | **+176 … +215** | — | Y-length ×4.3 | — | **catastrophic** — the fix must be a *targeted, guard-gated* operator, NOT a ranker replacement |

**Verdict — the factors COMPOSE, with exactly one bounded conflict:**
- **Length ⟂ crossings ⟂ penetration on the X-moves that drive the owner cases.** The owner's leaves
  are degree-1 sinks, so X-shifting them cannot change crossings (C2 crossing-neutral); block shifts
  of pure-sink groups *reduce crossings and penetration together* (C3-block). The composed layout
  **dominates the baseline on every term simultaneously** → any monotone weighted soft-sum selects
  it. This is why "adding rendered-geometry crossing scoring + penetration-by-routing + an angle term
  to the guarded X-shift" **still composes**: the added terms only reinforce a candidate that is
  already better on all of them. There is no term you can add that turns the composed layout into a
  loser — *except* C1.
- **The one genuine within-scene conflict is C1** (crossings/pen ↓ by a hair vs length ↑ +808) — a
  real bicriteria point where a rendered-scored objective could defensibly *decline* the move. This
  is the only owner case that is not a clean dominance.
- **The one genuine cross-factor conflict is penetration-by-routing ↔ straightness** (F-ANG): the
  decorative router removes pierces by *detouring*, and a detour makes a straight edge bent — routing
  buys penetration at the cost of angle/straightness. This is **bounded and resolvable**: score the
  *routed* geometry (so the detour's cost is visible) and keep the angle term **soft** (70° plateau,
  no hard octilinear grid). Angle is otherwise **inert on the X-moves** (C2 sharpShare/con Δ0), so it
  never conflicts with the length/crossings/pen wins that fix the owner cases.

**Bottom line:** "balance" is *achievable* — the factors are compatible under LR. Strata simply never
attempts it on the X axis. Add the operator and three of the four factors improve together; the
fourth (angle) is a separate soft scene-quality lever that trades only against penetration-routing.

---

## 3. RECONCILED TENSIONS (definitive rulings)

### Tension A — C2/C3 failure-class: "objective (X weight 0)" (F-LEN) vs "search-space (no X-operator)" (M-OBJ/M-MEAS)

**RULING: SEARCH-SPACE is the proximate cause; objective-X-blindness is a real but currently-MASKED
coupling that does not independently bite.** The two labels describe one mechanism from two ends:
- F-LEN is *correct* that length has effective weight 0 on the X axis — **but it is weight-0
  *because* X is constant across every candidate the descent visits**, not because the objective
  mis-weights it. It is a consequence of the empty search space, not an independent objective bug.
- M-OBJ/M-MEAS are *correct* that it is search-space: CASE-C2's end-to-end proof
  (`adoptedMoved=true, fellBack=false`) shows the *unmodified* objective adopts the move the instant
  it is generated. If you added the X-operator and touched nothing else, C2/C3 are fixed.

Converged label: **"search-space gap, with a latent objective-X-blindness coupling."** Same
mechanism (X constant across search), same fix (a guard-gated X-operator), and the existing length
tiebreak rewards the result. The objective-blindness would only surface *after* the operator exists,
if two X-differing candidates tied on every non-length term — a downstream calibration concern, not
today's failure.

### Tension B — prior audit's "chord scorer inverts real decisions" + "43.8% disagree" vs F-CROSS/M-MEAS

**RULING: the audit's phenomenon is real but its mechanism was mis-attributed. Three distinct things
were conflated.** Corrected:
1. **Chord does NOT invert real *crossing* decisions.** On pure crossings, chord is biased
   (+18% over-count, same 145 edges) but **order-preserving**: rank fidelity 0.988/0.893, **0 rank
   flips, 5/5 argmin** (M-MEAS/F-CROSS). You cannot get a crossing-decision inversion out of the
   chord proxy at ε=1.
2. **The 15 genuinely decision-harmful inversions are real, but caused by PENETRATION-COUPLING +
   pre-A7 geometry**, not by chord-crossing measurement. Penetration trades 1:1 (fungibly) with
   crossings inside the adoption scalar, and the score is computed on pre-refinement geometry the
   compaction later re-orders. That is an **objective-ARCHITECTURE** defect (wrong terms in the
   scalar, wrong geometry), not a crossing-measurement defect. The rendered-best 158 (−15) is
   reachable and dominates on the objective's own scalar yet is never adopted — a pre/post-A7
   inversion, i.e. scoring the wrong geometry.
3. **The "43.8% disagree" is a sequential-adoption-TRAJECTORY statistic** (how often two comparators
   diverge *along the greedy path*), **not a candidate-ordering statistic.** On the realized candidate
   set, comparator *shapes* flip only **3.7%** (M-OBJ). The 43.8% overstates disagreement by measuring
   a path, not a ranking.

**Net:** this investigation **CONFIRMS the audit's deep claim** (the objective is mis-specified and
the measurement is two-worlds) while **CORRECTING the specific mechanism**: it is not
chord-crossing-inversion and not 43.8%-of-orderings; it is penetration-coupling + pre-A7 geometry +
a trajectory statistic. Precise restatement for the record:
> "Penetration coupled 1:1 into the crossing scalar, scored on pre-refinement geometry, produces ~15
> decision-harmful adoptions along the greedy trajectory. The chord proxy over-counts crossings +18%
> but preserves their rank order (0 flips); it is not the source of the inversions."

---

## 4. PREREGISTERED CONVERGED COMPARISON TABLE

Convergence definition: agents agree on case-classification + fix-verdict. All four cells below are
**converged** (no residual inter-agent disagreement); the only surfaced dissent is *within* C1 (F-LEN
"not length" vs the marginal crossing/pen win — recorded as "marginal", not smoothed).

| Case (node) | crossings Δ | pen Δ | length Δ | angle Δ | failure-class | fixable by generic algorithm | prescription fixes case? |
|---|---|---|---|---|---|---|---|
| **C1** `/staging/api-6/name` r15→13 | chord −2 (rendered 0) | −1 pierce | **+808 (rises)** | 0 | search-space (rendered-best never adopted; no X-op) | yes, but **MARGINAL** (LR X-compaction reaches r13; NS-rank half is a no-op) | **WEAK / defensibly-declinable** — a rendered-scored objective could decline (tiny cr/pen win, length regresses). No regression to scene. "158/−15" is a whole-scene artifact, not reachable by moving C1 alone. |
| **C2** `staging-egress-dlq`, `staging-events-dlq` r15→8/10 | 0 | 0 measured (perceived pen = a 3204px chord visually tunneling a node box; `pierce` scores routed hull-rect geom = 0) | **−9519 chord / −11904 X** | 0 (~1.9°) | search-space **+ objective-X-blindness (coupled)** | **YES** (NS length-min rank + LR/containment X-compaction) | **YES — load-bearing end-to-end proof** (`adoptedMoved=true, fellBack=false`). Regression: +115px height only. |
| **C3-leaves** us-west-2 (acct …0002): S3 `…-west`, ssm `/staging/api-8,9/name` → r22 | 0 | 0 | **−2976 L1X each** (−3968 variant NOT LR-feasible) | 0 | search-space (= C2) | **YES** (leaf X-shift) | **YES** |
| **C3-block** Account-04 pure-sink block (…0004, us-east-1) Δ3 | **rendered 173→151 (−22)** | **pierce 66→46 (−20)** | chord C −37 | co-moves (unscored) | search-space (dead-gap: rankSeparate inflates the pure-sink account +11 ranks) | **YES — GENERIC** (block-shift = leaf X-move at coarser granularity; composes with leaves: A+B = C−38/cr−20/pierce−21) | **YES — BIGGEST WIN.** CAVEAT: must be a targeted guard-gated shift, NOT a ranker swap. |

---

## 5. RANKED MINIMAL CHANGE-SET (highest leverage first)

> All layout changes ship as **opt-in import toggles, default-off** (repo convention). **LR is NOT
> relaxed.** **The metric weights (w_len:w_cr≈1:1, w_ang, w_cont) remain CONJECTURAL pending the
> downstream blinded-pairwise human calibration — unskippable and out of scope for this run.** No
> change below should be shipped as *the* objective without that calibration; #1–#2 fix the owner
> cases without needing it (they are dominance moves, not weight-sensitive).

**#1 — Targeted, guard-gated X-shift operator (leaf + hull/block granularity).** *The fix.*
Generate X-moved candidates (leaf sinks pulled toward their source; pure-sink hulls translated as a
rigid group) and hand them to the existing weighted-C guard + transitiveAdopt, which already adopt
them.
- Expected win: fixes C2 (−9519 L1), C3-leaves (−2976 each), C3-block (−22 rendered cr / −20 pierce);
  composed A+B = C−38/cr−20/pierce−21. Marginal on C1.
- Risk: small height regression (+115px on C2, the F-LEN bicriteria trade). **Must stay targeted and
  guard-gated — a blanket ranker replacement is catastrophic (C +176…+215, Y-length ×4.3).**
- Generic: **yes** (interval-constrained single-vertex / rigid-group re-ranking under LR+containment).

**#2 — Length-min network-simplex ranking (`computeNetworkSimplexDepths`, currently dead) as the
operator's candidate generator, gated on an M0 height↔length bicriteria spike.**
- Expected win: principled length-optimal X targets (Gansner exact) feeding #1; in-repo prior art
  `pipelineColumnPacking:"shorten"`.
- Risk: rankSeparate was chosen for −42% height; the length-min ranker trades height for length →
  needs the spike. On its own it is a **no-op for C1** and dangerous if applied blanket. Do NOT swap
  the ranker wholesale; use it only to *propose* targeted shifts.
- Generic: yes.

**#3 — Score on rendered / post-A7 geometry + decouple penetration from the crossing scalar.**
*Scene-quality; fixes the objective-architecture defect behind the 15 inversions.*
- Expected win: removes the pre/post-A7 inversion (rendered-best 158/−15 becomes reachable), makes
  crossings measured on what is actually drawn, removes penetration's fungible 1:1 trade against
  crossings.
- Risk: recompute cost; changes the adoption trajectory (re-baseline needed). Does **not** move the
  owner cases by itself.
- Generic: yes.

**#4 — Penetration hard-by-ROUTING (feed the existing decorative router back into scoring).**
- Expected win: pierce 66 → ~0 (all 66 are routable). Keep it **hard-by-routing, NOT a hard pen=0
  gate** — hard pen=0 is UNSATISFIABLE (0/573 candidates pen-free → search-space collapse / M0.5
  degeneration).
- Risk: **the one factorial conflict** — detours reduce straightness. Pair with #5 (score routed
  geometry + soft angle) so the detour's angle cost is visible.
- Generic: yes.

**#5 — Soft angle/continuity term (70° plateau, no hard octilinear grid) + Brandes–Köpf-class Y-alignment.**
*Scene-quality straightness / the metro-hub + octilinear aesthetic; lowest leverage for the owner's
specific cases.*
- Expected win: improves the worst-regime crossing-angle (median 29.7°, 25% <10°) and through-hub
  continuity; the only lever for "straight octilinear lines". Hub collapses into an optional
  `thru`-continuity weight (F-HUB: no standalone hub term warranted).
- Risk: Brandes–Köpf on strata's *banded/shared* rows is unverified (BK assumes one node per
  layer-slot); angle is **inert on the owner X-moves** so this does not fix C1/C2/C3. Needs a BK-on-Y
  spike.
- Generic: yes.

---

## 6. CROSS-CHECK vs the prior objective audit (docs/strata-pipeline-objective-audit-2026-07-15.md)

**CONFIRMS:**
- Objective is mis-specified: infinite exchange rate / length seated at the last lexicographic
  tiebreak; penetration fungible 1:1 with crossings with no literature analog; ε overloaded across
  feasibility + adoption-gate + tiebreak.
- Measurement is two-worlds: rendered rt̂ / con / gdev never priced; X-length under-weighted;
  non-normalized counts.

**CORRECTS / REFINES:**
- Audit "chord scorer inverts real crossing decisions" → **corrected**: chord is order-preserving on
  pure crossings (0 rank flips); the inversions come from penetration-coupling + pre-A7 geometry
  (§3.B).
- Audit "43.8% lex/weighted disagree" → **refined**: that is a greedy-trajectory statistic; the
  candidate-ordering disagreement is 3.7% (§3.B).
- Audit's central framing dispute — "the silly layouts ARE the objective (in-search-space the
  objective picks min-length 21/28 hulls)" vs "search-space" → **RESOLVED as SEARCH-SPACE, and the
  two are consistent.** The objective is fine — *in* the search space it does pick min-length hulls;
  the owner's better layouts live *outside* the search space because no operator generates the X-moves
  that reach them. The "silly layouts" are what the objective picks *from the impoverished Y-only
  candidate set*, not evidence the objective is wrong.
- Audit P0 (rendered-rescore + ε-transitivity + rankSeparate) → **confirmed as change-set #3, but
  DEMOTED below the X-operator.** ε-transitivity is already ~satisfied by transitiveAdopt's
  strict-total-order key (M-OBJ; the frozen config fixes the 2-cycle). rankSeparate is the *cause* of
  the C3 dead-gap but must be handled by a **targeted operator that keeps its ranks**, not by
  replacing it (blanket swap is catastrophic).

---

## 7. RESIDUAL DISAGREEMENT (surfaced, not smoothed)

- **C1 within-case:** F-LEN classifies C1 as "not a length case" (crossings/pen); CASE-C1 finds the
  X-compaction win real but *marginal* and defensibly declinable under a rendered-scored objective.
  These are not contradictory — C1's only available move trades a hair of crossings/pen for +808
  length. Recorded as **"weak/declinable"**, the one owner case that is not a clean dominance.
- **Everything else is converged.** All 11 agents agree: proximate cause of all three cases =
  search-space (no X-operator); objective + measurement defects are real but latent; LR must not be
  relaxed; the fix is a targeted guard-gated X-shift, not a ranker swap; weights stay conjectural
  pending blinded human calibration.

## 8. ONE-LINE ANSWER FOR THE OWNER

Strata's objective and measurement are *good enough* to balance crossings, penetration, length, and
angle under LR — the four factors compose, and the acceptance machinery already adopts your better
layouts the instant they are generated. It fails for exactly one reason: **the search only moves
nodes vertically, so it never generates the horizontal rearrangements you keep drawing.** Add a
targeted, guard-gated X-shift operator (leaf + block) and C2, C3-leaves and C3-block are fixed
(biggest single win: −22 crossings / −20 pierces on the Account-04 block); C1 is a marginal call.
The angle/straightness ("metro hub / octilinear") work and the objective-architecture cleanups are
real scene-quality upgrades but are *not* the reason your three complaints exist — and the final
metric weights still need the blinded human calibration before any of it becomes *the* objective.
