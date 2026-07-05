# Strata W4 — extent-gate closure (OD-14 `rankSeparate`) · checkpoint V3

**Status:** code-complete, STOPPED at checkpoint V3 awaiting owner adjudication.
**Milestone:** W4 (the "close the §2.5 extent gate" loop the owner picked at V2).
**Precedes:** the W4 commit (OD-14 + the UI toggle + WP-4b) lands only on owner OK.

---

## 1. TL;DR

The extent gate failed at V2 because Strata's banded canvas ran ~1.9× taller than
v2, stretching the longest cross-container edges (P1-compact p90 tail **+6369px**).
W4 ports the spec's designated height lever — v1's `rankSeparate` — into Strata
as an opt-in, default-off mode (`strataRankSeparate`) that separates dependent
sibling stacks so the packed skyline sets them side-by-side instead of stacking
them down the page.

**Result:** with the full stack (K=4 + A7 + rankSeparate), P1-compact goes from
**significantly worse than v2 → statistical parity** (mean paired Δ +1005 → −112px,
p90 tail +6369 → +2068px), and full mode swings to a **strong win** (−5029px).
Raw canvas height drops **−27.8%** (19066 → 13761px). It does **not** strictly
pass the frozen gate (P1-compact CI upper bound is still +784 > 0), so this is a
near-tie, not a clean pass.

**One load-bearing finding:** rankSeparate only helps **combined with K=4 ordering**
— alone it makes edges *longer* (see the Jc row). It must ship with K=4, never alone.

---

## 2. The extent-gate numbers (paired per-edge bootstrap CI, §2.5 / §12 pins)

Improvement = extent decrease ⇒ a cell passes iff the CI upper bound < 0.
"Δp50 / Δp90" = paired (matched-key) percentile deltas (candidate − baseline);
canvas figures are the raw Y extent.

### P1 compact — the cell that failed at V2 (n=37, 0 unmatched, gated)

| arm | mean Δ (CI) | Δp50 | Δp90 (base→cand) | read |
|---|---|---|---|---|
| **I** — K4+A7 (V2's best) | +1005 `[−76, +2276]` | −637 | **+6369** (7098→13467) | fails: tail regresses |
| **Jc** — rankSeparate **alone** (K=0) | +2295 `[+880, +3973]` | +3845 | +5089 (7098→12187) | **worse** — lever alone hurts |
| **J** — K4+A7+**rankSeparate** | **−112** `[−956, +784]` | −620 | **+2068** (7098→9166) | **parity** — mean neutral, tail cut ⅔ |

Raw canvas Y extent, P1 compact: v2 ≈ 10056 · strata K4+A7 = 19066 · **strata + rankSeparate = 13761 (−27.8%)**.

### P1 full (n=37, VOIDED by slice-classification asymmetry — supplementary read only)

| arm | mean Δ (CI) | Δp50 | Δp90 (base→cand) | read |
|---|---|---|---|---|
| I2 — K4+A7 full | −2519 `[−4787, +173]` | −3865 | +2013 (21004→23017) | tail still regresses |
| **J2** — K4+A7+rankSeparate full | **−5029** `[−7147, −2727]` | −5387 | **−4633** (21004→16371) | **strong win** (both p50 & p90 improve; voided by unmatched, not by regression) |

The void is the same V2 artifact (SDEC-44): v2 full+ancillary reclassifies edges to
banded LCAs that Strata keeps packed, so > 20% of pairing keys don't match. The
point estimate is a clean, large improvement; it just isn't a *primary* pass.

### P2 (report-only — nB is below the §12 floor)

rankSeparate narrows P2 too (compact J CI `[+1178, +3142]` vs I `[+2268, +5346]`)
but P2 stays v2-favored on its tiny population. Unchanged gating status from V2.

---

## 3. What shipped in W4

- **`strataRankSeparate` engine mode** (`terraformPipelineStrataRankSeparate.ts`) —
  whole-model Sander sibling-separation ranking; replaces the network-simplex rank
  (cannot compose — rankSeparate wins, NS suppressed with an honest meta signal);
  no-op short-circuit keeps OFF byte-identical; opt-in, default off. (WP-4-OD14)
- **Dialog toggles** for the Strata view (`TerraformStrataSettings.tsx`): "Layer
  ordering" (K=4), "Straighten" (A7), and "Compact height" (rankSeparate) — opt-in
  buttons mirroring the rcll option pattern, each with URL params + share round-trip.
  (WP-4-UI + WP-4b — your Q1 request.)
- **Hermeticity fix**: the shared graph primitive `buildSeparationConstraintGraph`
  moved to the neutral shared module so Strata no longer imports from the RCLL
  engine (boundary kept clean). (WP-4b)

Battery: **316/316** (isolated + sequential, 19 files) · typecheck clean · control-byte
scan clean on all 22 files. One caveat: a *rare parallel-only* flake surfaced once (1 of
2 parallel runs) in the **unchanged W3 finalize** icon→card ownership assert (coordRefine
A7 "no degradation" test) — honest v2 degradation, never reproduced sequentially, `git
diff HEAD -- '*StrataFinalize*'` empty, so **pre-existing, not a W4 regression** (SDEC-52).
Filed as a finalize-hardening follow-up.

---

## 4. The decision for you at V3

OD-14 substantially closed the gap but not the frozen gate. Two paths:

**A — Accept OD-14 (recommended).** Ship K=4 + A7 + rankSeparate as the Strata
optimization set. P1-compact is at statistical parity with v2 (mean neutral, tail
two-thirds smaller); full mode is strongly better; raw height is down 28%. This is
the same call you made at V2 (arm-E override of the automatic gate), now on far
better numbers. Commit W4; OD-15 stays a registered future lever.

**B — Chase a strict pass with OD-15 (de-band).** Build the second registered lever
(dissolve subnet/level band frames into membership rails) to try to push
P1-compact's CI upper bound below zero. Bigger change, **uncertain payoff on this
specific residual** (the tail is driven by the full-width banded provider/account
levels, which subnet de-band doesn't touch), and a real visual shift (frames →
colored rails). New milestone W5.

---

## 5. Visual A/B (`yarn start` → localhost:3001)

Toggle "Compact height" in the Strata settings, or use the URL keys:

- **Best (K4+A7+rankSeparate):** `/demo?preset=staging-extended-localstack-v2&view=strata&strataSweeps=4&strataCoordRefine=1&strataRankSep=1`
- **Without rankSeparate (V2's best):** drop `&strataRankSep=1`
- **rankSeparate alone (see why it needs K=4):** `…&view=strata&strataRankSep=1` (no sweeps) — the "worse alone" arm
- **v2 baseline:** `…&view=pipeline`
- **Full mode:** append `&compact=0` to any of the above
- **P2:** swap `preset=staging-localstack`
