# Strata W10b — `strataBandCompact` build + three-way adjudication battery (OD-15 re-scope, Stage 2)

**Date:** 2026-07-13 · **Status:** Battery report (measurement only; REPORT cells — no gate asserted, no PASS minted). Ships the `strataBandCompact` engine option (default OFF, flag-off byte-identical) and runs the owner-authorized W10b adjudication battery that folds in the two standing open adjudications (ε default, W7 packedScoring waiver) onto the post-compaction substrate, per SDEC-63.

## Document graph

| Relation | Link |
| --- | --- |
| Role | Battery |
| Status | Current (owner adjudication pending on all three items below) |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`strata-view-w10-band-compact-probe.md`](./strata-view-w10-band-compact-probe.md) (Stage 1) · [`strata-view-decision-log.md`](./strata-view-decision-log.md) SDEC-62/SDEC-63 |
| Sisters | [`strata-view-w7-packed-scoring-battery.md`](./strata-view-w7-packed-scoring-battery.md), [`strata-view-w8-rank-scorer-factorial.md`](./strata-view-w8-rank-scorer-factorial.md), [`strata-view-w8b-epsilon-frontier.md`](./strata-view-w8b-epsilon-frontier.md) |
| Next (agent) | Owner adjudication: (a) promote/hold `strataBandCompact`, (b) W7 packedScoring default waiver, (c) ε default 0 vs 1 — all P1/P2-scoped, not universal-default evidence |

## Role

Stage 2 of the two-stage OD-15 re-scope (Stage 1: [`strata-view-w10-band-compact-probe.md`](./strata-view-w10-band-compact-probe.md), SDEC-62). Stage 1 proved the owner's Y-waste observations material under `rankSeparate` (46.6–52.7% reclaim) and zero without it. Owner directive (SDEC-63) superseded Stage 1's "defer behind adjudications" posture: build the lever now, and fold the two standing open adjudications — ε default (SDEC-60) and the W7 packedScoring waiver (SDEC-58) — into **one** battery pass measured on the post-compaction substrate, rather than deciding them first on a substrate this build would then change. Routing (SDEC-61) stays closed-adverse and is orthogonal.

## What shipped (commits)

| Commit | Scope |
| --- | --- |
| `9b75b9677` | WP0 — `bandCompact?: boolean` field on `StrataEngineOptions` + SDEC-63 recorded |
| `f031b52c0` | WP1 — A0 skyline branch + A7 `constraintPolicy` gap-parity + honest meta |
| `b59949e99` | WP2 — full-stack threading (42 seam sites) + Compact bands UI checkbox |
| `ef78dc90c` | Panel fix — diagnostics follow the guard's chosen A7 arm (sol+terra P2 finding) |
| `995e4845e` | WP3 — W10b battery (`terraformPipelineStrataBandCompactBattery.test.ts`) |

### Mechanism (2–3 sentences)

When `options.bandCompact` is on, A0's placement policy branch routes banded **non-root** hulls (provider, account — never root, per v3.1 §1.4) through the existing `dropY` skyline over actual padded x-extents in canonical A2 order, so X-disjoint siblings share rows instead of stacking full-width — this is option-gated placement _behavior_, not a new third A0 policy value (the role→policy map and `assertStrataBandRowInvariant` stay untouched). A7 refinement follows suit via a resolved per-hull `constraintPolicy: "banded" | "packed"` consumed at **both** `blocksConstrain` and `minGap` sites (gap-parity — fixing only the constrain site would let A7 re-inflate what A0 just reclaimed). Gap semantics are `dropY` verbatim (owner decision D1): hull-adjacent pairs get LANE*GAP_Y, leaf-leaf pairs get CLUSTER_GAP_Y unchanged, so `I_BC ≡ I` is a \_report expectation* on P1/P2 (no account-direct leaves on either preset) rather than a universal invariant — a leaf-bearing banded hull would change under BC even with zero row-share, because gap-tightening is a second, independent mechanism (see the D1 caveat below).

### Honest-meta contract

Per the eng-review deltas (items 2–3 of the plan), meta echoes never lie about which A7 candidate was actually chosen:

- `strataBandCompactRequested` — bare option echo, present whenever the flag is on (including degraded/fallback builds).
- `strataBandCompactAppliedHullCount` — actual count of banded hulls that took the skyline branch, **success path only**.
- `strataBandCompactReclaimedPx` — pre-A7 diagnostic (`stackBottom − skylineBottom`), snapshotted from the A0 result **before** A7 rebuilds the placement object, emitted **only when nonzero**.

**The guard-arm fix (panel finding, `ef78dc90c`):** sol and terra independently found the same P2-severity defect — with packed scoring on, A7 refines _both_ the scored and the legacy-baseline placements and can select either (`chooseStrataRefinedPlacement`'s never-worse guard); the original code snapshotted `ReclaimedPx` off the scored candidate regardless of which one the guard actually picked, so on a build where the guard fell back to the baseline the emitted number could describe a discarded candidate. Fixed: diagnostics now follow the guard's chosen arm. luna's independent pass (no shared context with sol/terra) found no defect and returned VALIDATED outright — the panel record below has the full three verdicts.

## W10b arm matrix (K=4+A7 base; P1+P2; seed 20260704)

| # | Arm | RS | BC | PS | ε | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | I | – | – | – | – | absolute baseline / byte anchor |
| 2 | I_BC | – | on | – | – | inertness proof (scene byte-equality vs I) |
| 3 | I_RS | on | – | – | – | substrate anchor (paired deltas reference this) |
| 4 | I_RS_BC | on | on | – | – | main lever, isolated |
| 5 | P_RS | on | – | on | 0 | W7-waiver adjudication, pre-BC substrate |
| 6 | P_RS_BC | on | on | on | 0 | PS × BC interaction |
| 7 | P_RS_BC_eps1 | on | on | on | 1 | ε-default adjudication, final substrate |

No `P` (RS-off) arm — W7/W8 own that cell. No `P_RS_eps1` — W8b owns ε-on-pre-BC. Presets: **P1** = `staging-extended-localstack-v2` (elementCount 1333, nSliceB 37), **P2** = `staging-localstack` (elementCount 735, nSliceB 4, extent-floor-ineligible per v3.1 §2.5).

## Results

### Canvas height + reclaim (real, not the ceiling estimate)

| Preset | Contrast | Before → after (px) | Δ | Meta `ReclaimedPx` | Meta `AppliedHullCount` |
| --- | --- | --- | --- | --- | --- |
| P1 | I_RS → I_RS_BC | 14126.33 → 6680.50 | **−7445.83** | 7196 (pre-A7 diagnostic) | 5 |
| P1 | P_RS → P_RS_BC | 14227.50 → 6916.00 | **−7311.50** | 7196 | 5 |
| P2 | I_RS → I_RS_BC | 7846.00 → 4046.50 | **−3799.50** | 3684 | 2 |
| P2 | P_RS → P_RS_BC | 7906.00 → 4222.00 | **−3684.00** | 3684 | 2 |

The `ReclaimedPx` meta number is the pre-A7 counterfactual (stack-bottom minus skyline-bottom, computed inside A0 before A7 rebuilds the placement); it differs slightly from the final composed canvas-height delta (7196 vs 7445.83 on P1, both reclaim components 3684≈3799.5 on P2) because A7 refinement moves things again after A0 — the honest-meta contract documents this as "pre-A7 diagnostic," and the battery's own paired final-height delta (this table) is the adjudication-grade number, not the meta echo.

### `I_BC ≡ I` inertness (D1-scoped, report-only)

| Preset | Equal    | countA | countB | differingElementCount |
| ------ | -------- | ------ | ------ | --------------------- |
| P1     | **true** | 1499   | 1499   | 0                     |
| P2     | **true** | 820    | 820    | 0                     |

BC is byte-inert on both presets **without** RS on (P1 I vs I_BC and P2 I vs I_BC), consistent with Stage 1's finding that reclaim is exactly 0 without RS. See the D1 caveat below for why this equality is a P1/P2-scoped report expectation, not a proven universal invariant.

### Paired contrasts (extent p50/p90 px, rt̂ p50/p90 s, seed 20260704 bootstrap CIs)

**P1** (n=37 slice-B edges, n=500 sampled paths):

| Contrast | Extent p50 [CI] | Extent p90 [CI] | rt̂ p50 [CI] | rt̂ p90 [CI] |
| --- | --- | --- | --- | --- |
| BC effect: I_RS → I_RS_BC | **−1946.9** [−2592.7, −1393.0] impr | +2360.5 [−955.7, 2360.5] degenerate, not gate-eligible | **+0.94** [0.66, 1.19] worse | **+3.85** [3.66, 4.36] worse |
| BC effect: P_RS → P_RS_BC | **−2023.5** [−2642.8, −1116.6] impr | +2021.0 [−842.7, 2021.0] degenerate, not gate-eligible | **+0.58** [0.27, 1.19] worse | **+4.81** [4.51, 5.47] worse |
| PS-on-final-substrate: I_RS_BC → P_RS_BC | −55.5 [−65.1, 0] not gate-eligible-improving (worse ci not excl. zero) | **+451.1** [226.2, 718.8] worse | **−2.27** [−2.66, −1.96] impr | **+1.94** [1.50, 2.61] worse |
| ε: P_RS_BC → P_RS_BC_eps1 | 0 [0, 0] | +403.0 [329.9, 403.0] degenerate, worse | +0.24 [0, 0.4] not CI-excluding | **+3.21** [2.62, 3.94] worse |

**P2** (n=4 slice-B edges — **all extent cells floor-ineligible, n<10**; n=265 sampled paths):

| Contrast | Extent p50/p90 | rt̂ p50 [CI] | rt̂ p90 [CI] |
| --- | --- | --- | --- |
| BC effect: I_RS → I_RS_BC | −1439 (degenerate, floor-ineligible) | 0 [0, 0] | 0 [0, 0] |
| BC effect: P_RS → P_RS_BC | −1558 (degenerate, floor-ineligible) | 0 [0, 0] | +0.27 (n<31, floor context) |
| PS-on-final-substrate: I_RS_BC → P_RS_BC | +1268 (degenerate, floor-ineligible) | **−2.64** [−2.80, −2.24] impr | +0.38 [−0.03, 1.24] parity |
| ε: P_RS_BC → P_RS_BC_eps1 | +469.8/+677.9 (floor-ineligible) | +0.51 [0.39, 0.71] worse | **+2.86** [2.66, 3.10] worse |

**Reading the table (v3.1 §2.5 discipline):** height/extent p90 CIs are correctly degenerate/voided/not-gate-eligible on both presets — this is the expected outcome of a small paired-edge sample (n=37 on P1, n=4 on P2, both well under the p90 floor of 31), not a battery defect. The gateable, load-bearing cells are the **rt̂ paired CIs** (n≈500/265 sampled paths, well above floor) — and those are the numbers that make BC's height win non-free: every BC-effect contrast (I_RS→I_RS_BC, P_RS→P_RS_BC) shows rt̂ p50 and p90 both moving **worse**, CI excluding zero, on P1. P2's BC-effect rt̂ is a flat 0 (both arms identical or near-identical path geometry at this preset's scale), so the tax is P1-scoped.

### Crossings, structure zeros, chords

| Metric       | I   | I_RS | I_RS_BC | P_RS | P_RS_BC | P_RS_BC_eps1 |
| ------------ | --- | ---- | ------- | ---- | ------- | ------------ |
| P1 crossings | 123 | 220  | **260** | 151  | **197** | 234          |
| P2 crossings | 39  | 104  | **91**  | 75   | **60**  | 80           |

BC's crossings direction is **preset-dependent**: worse on P1 (I_RS 220→260, P_RS 151→197 — BC adds crossings on top of RS), better on P2 (I_RS 104→91, P_RS 75→60 — BC reduces crossings). PS-on-final-substrate (I_RS_BC→P_RS_BC) improves crossings on both presets (P1 260→197, P2 91→60) — the scorer's global-counter win generalizes to the post-compaction substrate.

**`checkStrataStructure` zeros — all 7 arms, both presets:** `nonAncestorOverlaps: 0`, `titleCollisions: 0`, `contiguityViolations: 0` (the named risk cell for the skyline branch — contiguity holds under compaction in every arm measured).

**Chords (P1; P2's WAF/SQS fixtures are `absentFromPreset` in every arm, consistent with the W7/W8/W9/W10 "owner case exists only on P1" pattern):**

| Chord | I | I_RS | I_RS_BC | P_RS | P_RS_BC | P_RS_BC_eps1 |
| --- | --- | --- | --- | --- | --- | --- |
| WAF → ELB | 2731.02 | 1006.72 | 1006.72 (Δ0 vs I_RS) | 993.78 | 993.78 (Δ0 vs P_RS) | **1797.10** (+803.32 vs P_RS_BC) |
| SQS → RDS | 1303.09 | 1303.09 | 1303.09 (Δ0) | 1200.28 | **675.79** (−524.49) | 675.79 (Δ0 vs P_RS_BC) |
| SQS → Dynamo | 535.37 | 535.37 | 535.37 (Δ0) | 1629.33 | **496.00** (−1133.33) | 496.00 (Δ0 vs P_RS_BC) |

BC alone (I_RS→I_RS_BC, P_RS→P_RS_BC) never moves any of the three tracked chords — consistent with Stage 1's intra-region invariance finding (WAF/ELB share us-east-1, both SQS pairs share us-west-2; a banded-hull compactor cannot move chords whose endpoints live inside the same packed region it never re-lays). The scorer (PS-on-final-substrate) moves SQS→RDS and SQS→Dynamo substantially shorter on the compacted substrate. ε=1 leaves both SQS chords untouched but **lengthens WAF→ELB by 803px** — the single clearest adverse ε signature in this battery.

### Churn (report-only; v3.1 §3 reference thresholds M1_rel≤0.08, M2_flip≤0.10 — the battery never gates on them)

| Preset | Arm | Add M1_rel | Add M2_flip | Rename M1_rel | Rename M2_flip |
| --- | --- | --- | --- | --- | --- |
| P1 | I_RS | 0.0982 | 0.0086 | 0 | 0 |
| P1 | I_RS_BC | **0.1821** | 0.0086 | 0 | 0 |
| P1 | P_RS_BC | 0.1334 | 0 | 0 | 0 |
| P1 | P_RS_BC_eps1 | **0.2021** | **0.1379** | 0 | 0 |
| P2 | I_RS | 0 | 0 | 0 | 0 |
| P2 | I_RS_BC | 0 | 0 | 0 | 0 |
| P2 | P_RS_BC | **0.0885** | 0 | 0 | 0 |
| P2 | P_RS_BC_eps1 | **0.2927** | 0.0331 | 0 | 0 |

**Rename churn is 0 everywhere** (both presets, all four measured arms) — clean. **Add-churn worsens monotonically with the stack** on P1: I_RS 0.098 → I_RS_BC 0.182 → P_RS_BC 0.133 → eps1 0.202 (M2_flip also jumps at eps1: 0→0.138, above the 0.10 reference). On P2 the pattern is starker: I_RS/I_RS_BC both 0 → P_RS_BC 0.089 (just above the 0.08 reference) → eps1 0.293 (well above). BC materially worsens add-churn on both presets once it stacks with RS+PS — this is a promotion consideration independent of the height/rt̂ trade-off above.

### Other report cells

- **`packedScoringFellBack`**: `false` on all 3 scorer arms (P_RS, P_RS_BC, P_RS_BC_eps1), both presets — the never-worse guard never degraded to the legacy baseline in this battery, so the W7-waiver question is answerable on live scored geometry, not a fallback.
- **ε-selection-divergence**: `selectionsEqual: false`, `scoreEqual: false`, `effectiveDelta: 1` on P1 (eps0 score `{crossings 318, penetrations 135, lengthL1 898996}` vs eps1 `{337, 116, 892396}` — eps1 trades +19 crossings for −19 penetrations and a marginally shorter L1). This confirms ε=1 is **not inert** on the final substrate — it genuinely picks a different placement, not "no worse, did nothing."
- **Determinism / buildMs**: not tabulated here (battery's own determinism cell is the harness's internal recompute check, not surfaced in the summary JSON read for this doc); `buildMs` ranges 1163–2850ms for non-PS arms and 1163–15361ms for PS arms (PS's own known cost, unrelated to BC).

## The D1 leaf-bearing caveat

Owner decision D1 (eng-review): BandCompact hulls use `gapBetween` **verbatim** — hull-adjacent pairs get LANE_GAP_Y, leaf-leaf pairs get CLUSTER_GAP_Y, exactly as the non-BC skyline already computes for packed hulls. This means `I_BC ≡ I` (measured true above, both presets) is a **report expectation valid on P1/P2 only**, not a proven universal invariant: neither preset has a banded hull with account-direct leaf children, so gap-tightening (the second, independent mechanism BC enables even at zero row-share) never fires in this battery. A held-out preset with leaf-bearing banded hulls could show `I_BC ≠ I` while still reporting `ReclaimedPx: 0` — that would be **expected**, not a regression, per the D1 semantics. WP1 added a dedicated leaf-bearing banded fixture unit test to pin this behavior at unit speed (not battery speed). UI copy was softened accordingly to "primarily effective with Rank separation" rather than claiming universal inertness off-RS.

## Panel record (3-model codex review, owner-authorized, medium effort, combined WP1+WP2 diff)

| Model | Verdict | Finding |
| --- | --- | --- |
| sol (gpt-5.6, high) | VALIDATED-WITH-FIXES | P2 (conf. 9/10): `ReclaimedPx` snapshotted from the scored A0 placement before A7, but A7's never-worse guard can select the _baseline_ candidate — the emitted number could describe a discarded arm on a build where the guard fell back. |
| luna | **VALIDATED** | No P1/P2 findings — independently checked flag-on correctness (skyline over actual x-extents, canonical order), flag-off safety (spread/meta gating), A7+packed-scoring interaction, and threading/URL symmetry; all clean. |
| terra | VALIDATED-WITH-FIXES | Same P2 finding as sol, independently derived, same fix proposal (retain both pre-A7 diagnostics, emit the one matching `chosen.placement`). |

sol and terra converged independently on the identical defect (diagnostics-follow-the-scored-candidate-not-the-chosen-one); luna's independent pass found nothing, consistent with the defect being narrow (only manifests when packed scoring is on **and** A7's guard actually falls back to baseline — not exercised by every code path a reviewer might walk). Fixed in `ef78dc90c`: diagnostics now follow the guard's chosen arm. No P1 (correctness-blocking) findings from any of the three models. TypeScript passed for all three; targeted Vitest could not execute in the read-only review sandboxes (Yarn/Vite cache creation blocked) — this is a sandbox limitation of the review environment, not a build defect, and does not affect the L1–L5 verification ladder run outside the panel.

## Owner adjudication package

Three decisions, framed with the evidence for each. All results are **P1/P2-scoped adjudication evidence, not universal-default evidence** (two presets; the held-out third-preset gap, R8-F11, is standing and unchanged by this battery).

### (a) Promote or hold `strataBandCompact`

**For promotion:** the height win is large and real — P1 I_RS→I_RS_BC −7445.83px (52.7% of the pre-BC canvas height), P2 −3799.50px (48.4%) — roughly cancelling rankSeparate's own known p90 height tax (SDEC-51/53), which was the original motivation. Crossings direction is preset-mixed but the scorer recovers/improves crossings on the compacted substrate on both presets (see (b)). Structure stays clean in every arm (contiguity/overlap/title-collision all zero).

**Against promotion:** the height win is **not rt̂-free**. The owner's stated primary task is impact tracing, and rt̂ is the direct proxy for that task — every BC-effect contrast shows rt̂ p50 **and** p90 moving worse with a CI excluding zero on P1 (I_RS→I_RS_BC: p50 +0.94, p90 +3.85; P_RS→P_RS_BC: p50 +0.58, p90 +4.81). Add-churn also worsens monotonically as the stack grows (P1 I_RS 0.098 → I_RS_BC 0.182; P2 I_RS 0 → P_RS_BC 0.089, crossing the 0.08 reference). P1 crossings also worsen under BC alone (220→260, 151→197) — BC is not a clean win even setting rt̂ aside.

**Bottom line for the owner:** this is a straightforward height-vs-tracing-cost trade, not a Pareto win. If canvas height is the dominant complaint (as the original screenshot suggested), BC delivers on that axis at a measured, non-trivial cost to the metric that best proxies the owner's own stated primary task.

### (b) W7 packedScoring default waiver

**For lifting the waiver (default-on) on the compacted substrate:** PS-on-final-substrate (I_RS_BC→P_RS_BC) **improves** rt̂ p50 on both presets (P1 −2.27 [−2.66,−1.96], P2 −2.64 [−2.80,−2.24], both CI-excluding-zero improving) and improves crossings on both presets (P1 260→197, P2 91→60). `packedScoringFellBack` is `false` on every scorer arm in this battery — the scorer is running live scored geometry, not silently degrading.

**Residual against:** rt̂ **p90** still regresses on both presets (P1 +1.94 [1.50,2.61], P2 +0.38 [−0.03,1.24] — P1's is CI-excluding-zero-worsening, P2's straddles zero/parity). Extent p90 also worsens materially on P1 (+451.06 [226.2,718.8]). This is the same paired-tail-churn signature W7/W8 already documented for packedScoring in general (median wins, p90 tax) — the compacted substrate does not remove it, it just relocates the trade slightly (p50 now decisively better where W7/W8 showed it merely improving).

**Bottom line for the owner:** the case for lifting the waiver is stronger on the compacted substrate than it was pre-BC (median win is now larger and crosses both presets cleanly), but the p90 residual that motivated the original waiver has not been eliminated — it is a smaller, still-real tail cost.

### (c) ε default (0 vs 1)

**Evidence for keeping ε=0 (current default):** ε=1 is measurably adverse on every axis this battery tracks and helps nothing new. rt̂ worsens (P1 p50 +0.24, p90 +3.21 CI-excluding-zero-worsening; P2 p50 +0.51, p90 +2.86 both CI-excluding-zero-worsening). P1 crossings worsen (197→234). The WAF→ELB chord — the one chord ε is meant to help via pair-locality tradeoffs — actually **lengthens** by 803px (993.78→1797.10) on the final substrate, the opposite of the SDEC-60 W8b rationale for δ=1 (which was measured on the pre-BC substrate and rescued a _different_ pair, SQS↔Dynamo, not WAF→ELB). Add-churn worsens sharply at eps1 (P1 0.133→0.202, M2_flip 0→0.138 crossing the 0.10 reference; P2 0.089→0.293).

**What ε=1 does do:** it is confirmed **not inert** (`selectionsEqual: false`, `effectiveDelta: 1`) — it genuinely picks a different, non-dominated placement (P1 eps0 `{318 crossings, 135 pen, 898996 L1}` vs eps1 `{337, 116, 892396}` — trades crossings for penetrations/length), consistent with W8b's "present-but-rejected, not absent-from-generator" finding. It is doing real work; that work is simply adverse on this substrate.

**Bottom line for the owner:** ε=0 is supported on the final (post-BC) substrate — the same posture SDEC-60 already recorded for the pre-BC substrate, now re-confirmed rather than contradicted by adding BC to the stack.

## Honesty box

- Two presets, no held-out state, owner-N=1 (R8-F11 stands). P2's WAF/SQS chord fixtures are absent from that preset in every arm, consistent with the W7/W8/W9/W10 pattern that the owner's trigger case exists only on P1.
- All extent p90 (and several p50) CIs on both presets are correctly degenerate, voided, or below the gating floor (n=37 on P1 < 31-floor for p90; n=4 on P2 < 10-floor for p50) — per v3.1 §2.5 this is expected behavior for small paired-edge samples, not a battery defect, and these cells are correctly non-gateable rather than silently passed.
- `strataBandCompactReclaimedPx` is a pre-A7 diagnostic snapshotted before A7 refinement runs again; it will not exactly match the battery's own paired final-canvas-height delta (7196 vs 7445.83 on P1) because A7 moves geometry a second time after A0. Treat the paired battery delta, not the meta echo, as the adjudication-grade height number.
- `I_BC ≡ I` is a P1/P2-scoped report expectation (D1), not a proven universal invariant — see the D1 leaf-bearing caveat above.
- Churn cells are report-only against v3.1 §3 reference thresholds (M1_rel 0.08, M2_flip 0.10); the battery never asserts a gate on them, and the gate register (see below) only records what has a matching pre-existing scalar-metric schema slot.
- All numbers in this document are from `W10B_BAND_COMPACT_BATTERY.json` (single run, seed 20260704).

## Bottom line

`strataBandCompact` is a real, working height lever — roughly half the canvas height RS reclaims back — but not a free one: it costs rt̂ (the direct proxy for the owner's stated primary task) on P1 at both p50 and p90, and it worsens re-import add-churn monotonically as it stacks with the other levers. The panel found the mechanism itself sound after one shared defect (diagnostics-follow-the-scored-not-chosen-A7-candidate) was fixed by both independent finders' proposal. On the resulting compacted substrate, packedScoring's case strengthens at the median but keeps its known p90 tail cost, and ε=1 remains adverse for the same reasons SDEC-60 already found pre-BC — now with an additional adverse chord effect (WAF→ELB +803px) that did not exist as evidence before this battery. All three adjudications are **now ready for the owner**, with this battery as the evidence base; none is pre-decided here.
