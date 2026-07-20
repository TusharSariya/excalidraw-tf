# Strata P5 / Lever C — height gate + sink ladder: measured results (2026-07-16)

**Verdict: NULL.** This changeset does not improve the frozen preset on any metric. It ships as groundwork plus one real latent-bug repair. It does **not** unlock Lever A, and it should not be described as an enabler.

Frozen measurement preset: `staging-extended-localstack-v2`, `view=strata`, seed `20260704`, `compact=1 ancillary=0 privateApiRegional=0 strataSweeps=4 strataCoordRefine=1 strataRankSep=1 strataPackedScoring=1 strataPackedEps=1 strataBandDepth=root strataSift=1 strataPackedConverge=1 strataTransitiveAdopt=1`.

Measured through the real app path (`layoutTerraformFromSources`) with a throwaway composed probe (deleted after the run). Metrics are **rendered** (`diagnosePipelineScene` crossings, `computePierceMetrics` pierce, summed polyline L1 over dataflow arrows, scene envelope), i.e. the same recipe as the H0 harness — not the chord proxy.

## Composed arms

| arm                | crossings | pierce | tll L1  | W      | H     |
| ------------------ | --------- | ------ | ------- | ------ | ----- |
| baseline           | 173       | 66     | 348,764 | 14,898 | 8,692 |
| gate-only          | 173       | 66     | 348,764 | 14,898 | 8,692 |
| pullIn             | 174       | 64     | 340,112 | 14,898 | 8,692 |
| pullIn+gate        | 174       | 64     | 340,112 | 14,898 | 8,692 |
| pullIn+ladder      | 174       | 64     | 338,855 | 14,898 | 8,692 |
| pullIn+ladder+gate | 174       | 64     | 338,855 | 14,898 | 8,692 |
| clamp              | 173       | 66     | 348,764 | 14,898 | 8,692 |
| clamp+gate         | 173       | 66     | 348,764 | 14,898 | 8,692 |

Scene-signature equality (exact geometry, not just aggregates):

| comparison                              | equal?                    |
| --------------------------------------- | ------------------------- |
| `gate-only` == `baseline`               | **true** (byte-identical) |
| `pullIn` == `baseline`                  | false                     |
| `pullIn+gate` == `pullIn`               | **true** (gate inert)     |
| `pullIn+ladder` == `pullIn`             | false                     |
| `pullIn+ladder+gate` == `pullIn+ladder` | **true** (gate inert)     |
| `clamp` == `baseline`                   | **true** (byte-identical) |
| `clamp+gate` == `baseline`              | **true** (byte-identical) |

## What the numbers say

1. **`strataHeightGate` is empirically inert on today's engine.** Gate-only is byte-identical to baseline; adding the gate to `pullIn`, to `pullIn+ladder`, and to `clamp` changes nothing. This is measured, not argued from construction — and see the correction below: it is _not_ inert by construction.

2. **`strataSinkLadder`'s marginal effect is a NULL.** Over the already-committed `strataSinkPullIn`: **−1,257 px L1 (−0.37 % of scene length), 0 crossings, 0 pierce, 0 height, 0 width.** On the metric hierarchy this codebase ranks by (crossings > continuity/angle > pierces >> height), that is noise.

3. **The family it widens is itself a crossings regression.** `pullIn` is **173 → 174 crossings (+1)** against baseline, buying −8,652 px L1 (−2.48 %) and −2 pierce. So the whole `pullIn` + `ladder` stack is neutral-to-slightly-negative on the top-ranked readability metric.

4. **No height movement anywhere.** Every arm renders at H = 8,692 and W = 14,898. Nothing in this changeset moves the envelope in either dimension.

5. **The ladder's feasible-rung fix does not move this preset.** The fix (below) is a real correctness fix for the P3 shape, but the frozen preset's sinks already had feasible rungs inside the raw budget, so `pullIn+ladder` measures identically before and after it. Its value is that the ladder now works in the case it was written for — not a number on this scene.

## Lever C's premise is NOT demonstrated

Lever C was justified as _"a gate unlocks Lever A"_. That unlock **has not happened and cannot happen yet**: nothing in the engine proposes a height-growing candidate, so the gate has almost nothing to referee on the real path. The unlock requires **Stage 2 — occupant displacement + VPSC slack-aware Y-repair + hull box recompute — which is NOT BUILT.** `strataYCompact` remains deferred for the same reason it was deferred before this changeset.

Do not describe this changeset as unlocking anything.

## Correction to a claim made in the first round

The first revision documented the gate as **inert by construction** ("the `maxTop` clamp already prevents any candidate from growing a box, so the gate can only ever agree with the clamp"). **That is false**, and the code, types, defaults, UI copy and threading test have all been corrected.

`maxTop` clamps against the **stored frame**; the gate compares **rolling implied height**; and the candidate-top loop does not `break` on adoption. So an early adoption can shrink a hull (a sink that uniquely pinned the floor rises), after which a later candidate still inside the stored frame re-grows the implied height and the gate vetoes what gate-off adopts.

This is now pinned by an executable counterexample — the **ratchet suite** in `terraformPipelineStrataSinkPullIn.test.ts`:

| arm      | `a1`                  | `b1`                                 |
| -------- | --------------------- | ------------------------------------ |
| baseline | 3050, **1070**        | 3650, 974                            |
| gate OFF | 2450, **974** (rises) | 2450, **1034** (drops in)            |
| gate ON  | 2450, **974** (rises) | **3650, 974** (vetoed — never moves) |

That test does double duty: it is the first proof that the gate is genuinely **wired into** `refineStrataSinkPullIn` (the previous gate-on == gate-off composition test would have passed even if the operator ignored the flag), and the first proof its **reject path fires on an engine-produced candidate** rather than only on synthetic ones.

The block clamp's gate _is_ provably inert (a rigid X-only translate moves no Y, so no implied height can change). The inertness claim was only wrong for the sink pull-in.

## Open decision for Stage 2: the ratchet cost

The gate compares against the **rolling incumbent**. That is **strictly stronger than the theorem needs**. The contract is only _final height ≤ **baseline** height_ — that is what cannot regress rankSeparate's −42 % win. The rolling comparison additionally forbids any per-step re-growth, so **one lucky early shrink permanently locks out later length wins that never exceed baseline**.

The ratchet test pins exactly this: the vetoed move's implied height is **232**, against a **baseline of 268**. It never grew the hull past where it started; it was rejected only because an earlier adoption had already shrunk that hull to 172. Real length cost, zero height benefit.

Comparing against the **baseline placement** instead would preserve the theorem verbatim while admitting that move.

**Deliberately not changed in this round.** The rolling form is the conservative one, it is what the unit-proven monotonicity theorem covers, and the gate is default-off and inert at the preset — so the choice belongs with the Stage-2 mover that will actually feel it. Flagged here so it is not rediscovered later.

## What is actually worth keeping

1. **The block-clamp vacuity repair — the real deliverable.** The shipped `maxBottomOf` height check was **vacuous by construction**: it compared a single scene-global `max(box.y + box.height)` over all hulls and leaves, which is pinned by the tallest/root extent and therefore **admits any non-tallest hull growing arbitrarily**. A future box-recompute phase would have inherited a gate that silently passes exactly the moves it exists to reject. Replaced by per-hull `∀` quantification over implied content heights, pinned by an executable vacuity regression test (old check admits, new check rejects, same candidate).

2. **The per-hull referee itself**, with its anti-vacuity anchor test (implied height reproduces `placeStrataHulls`'s own `box.height` exactly for every hull on a real placement) — the thing Stage 2 needs and cannot be trusted without.

3. **The ladder's feasible-rung budget fix.** The rung budget was spent enumerating **raw** columns `srcRank+1 .. srcRank+6` _before_ X-containment was checked. If a sink's parent box starts more than 6 columns right of `srcRank+1`, all 6 rungs fail containment and the feasible rungs are never tried — i.e. the ladder silently did nothing in **exactly its motivating case** (P3's region-level sinks whose sources sit inside a left-lying VPC). The budget now counts **X-feasible** rungs. Pinned by the far-parent test (parent box at col 8, sink at col 12: raw rungs 1–6 all escape; the ladder now reaches the leftmost admissible rung, col 9).

## Recommended framing

Ship as **groundwork with a recorded null**, not as an enabler:

- `strataHeightGate` — default off, empirically inert, groundwork for Stage 2.
- `strataSinkLadder` — default off, measured null (−0.37 % L1), retained as the correct relaxation of a cliff that provably strands P3-shaped sinks.
- The block-clamp vacuity repair — the actual bug fix in this changeset.

**The real next step is unchanged: build Stage 2** (occupant displacement + VPSC Y-repair + box recompute). Until it exists, the gate has nothing to referee and these two toggles sit inert on the option surface.
