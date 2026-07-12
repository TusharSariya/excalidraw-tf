# Strata W6 — tracing-highlight spike battery (crossover sweep)

**Date:** 2026-07-12 · **Status:** Battery report (model-based sensitivity analysis; REPORT-only per v3.2 §8 — conditions (i)/(ii) computed, condition (iii) OWNER-EVAL PENDING).

## Document graph

| Relation | Link |
| --- | --- |
| Role | Battery |
| Status | Current |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`rcll-v2-spec-v3.2.md`](./rcll-v2-spec-v3.2.md) (§8 task-evidence precondition) |
| Sisters | [`strata-view-w5-repaired-stats-report.md`](./strata-view-w5-repaired-stats-report.md), [`strata-view-w5b-joint-ns-probe.md`](./strata-view-w5b-joint-ns-probe.md) |
| Next (agent) | Owner canvas eval (condition iii) on the highlight arms → decision-log record → Package-C scoping |

## Question

Round 8's recommended arm: does a rendered dependency-path **highlight** at interaction time substitute for **layout-level** path readability — i.e. is *cheap layout + interaction* (`v2+HL`) at least at parity with the *expensive layout unaided* (`strata-I` = K=4+A7)? If yes, heavy band-geometry work (Package C) is deprioritized.

## Methodology

One harness run (`terraformPipelineStrataHighlightSpike.test.ts`, report-emitting, never asserts; deterministic — seed 20260704, recompute verified byte-identical) over the W5 arms `A_v2_baseline` and `I_strata_k4_a7`, P1+P2 compact, same path population as W5 (P1: 500 sampled paths; P2: 265).

**Model** (`rtHatAttenuated`): Ware 2002's `cr` (crossings-on-path) and `con` (continuity) terms price the *visual search* of unaided tracing; a rendered highlight substitutes for that search, scaled by attenuation α — `rt̂(α) = 1.390·hops + α·(0.01699·con + 0.654·cr) + 0.295·br`. **The α=0 bound is vacuous for layout comparison**: hops and br are layout-invariant structure, so at full substitution every layout scores identically (self-check below confirms paired Δ ≡ 0). The decision input is therefore the **crossover sweep** — the largest α at which `v2+HL(α)` is still parity-or-better vs unaided `strata-I` — plus **residual geometry a highlight does not erase**: path arc length (tll — pan/viewport cost), slice-B extent, and **downstream-cone-internal crossings** (impact tracing is one-to-many; highlighting an anchor's full downstream cone lights up every reachable arrow, and crossings *between* highlighted arrows survive — P1: 50 of 67 eligible anchors seeded-sampled; P2: all 36).

**Unmodeled terms (stated, not priced):** anchor-acquisition cost (finding/selecting the anchor node in a denser non-hierarchical field plausibly favors strata's hierarchy — unmodeled, favors strata); hover-exploration cost (out of scope; the interaction design is selection-driven). Regenerate: `Q6_REPORT_DIR=<dir> yarn vitest run packages/excalidraw/components/terraformPipelineStrataHighlightSpike.test.ts --exclude "**/.claude/**"` → `W6_HIGHLIGHT_SPIKE_REPORT.json`.

Sign convention: Δ = `v2+HL(α)` − `strata-I unaided`, paired by path key; **negative ⇒ v2+HL better**.

## Crossover sweep — v2+HL(α) vs unaided strata-I

### P1 compact (staging-extended-localstack-v2; n=500 paths)

| α | Δrt̂ p50 CI | Δrt̂ p90 CI |
| --- | --- | --- |
| 0 (full substitution — VACUOUS bound) | −6.71 [−7.22, −6.12] | −1.73 [−2.16, −1.42] |
| 0.25 | −4.67 [−5.14, −4.40] | −0.64 [−1.00, −0.40] |
| **0.5** | **−2.79 [−3.21, −2.46]** | +0.78 [+0.57, +0.94] |
| 0.75 | −1.22 [−1.50, −0.95] | +2.87 [+2.28, +3.46] |
| 1 (unaided v2 — W5 consistency check ✓) | +0.27 [+0.06, +0.52] | +5.92 [+5.04, +6.36] |

Crossover (p50): **v2+HL stays strictly better through α=0.75**; only fully-unaided v2 (α=1) loses to strata-I — exactly W5's finding with the sign flipped (+0.27 ↔ W5's −0.27). At **p90 the tail resists**: v2+HL is already worse at α=0.5 — hard traces need the highlight to substitute >50–75% of the visual-search cost before v2 catches strata-I.

### P2 compact (staging-localstack; n=265 paths)

| α | Δrt̂ p50 CI | Δrt̂ p90 CI |
| --- | --- | --- |
| 0 | −6.37 [−7.92, −5.89] | −1.77 [−2.68, −1.33] |
| 0.5 | −3.86 [−4.56, −3.42] | −0.77 [−1.29, −0.43] |
| 0.75 | −2.49 [−2.93, −2.38] | −0.07 [−0.50, +0.13] |
| 1 | −0.98 [−1.16, −0.56] | +0.71 [+0.42, +0.93] |

On P2 **unaided v2 already beats strata-I** (W5 finding (b) restated), so every highlighted α wins at p50; p90 parity holds through α=0.75.

### Symmetric cell — highlight ON the layout we'd ship

`strata-I+HL(α)` vs unaided `strata-I`, p50 at α=0.5: **−3.35** (P1) / **−3.19** (P2). The highlight is a large modeled win on strata too — "build the highlight" is supported *regardless* of the layout verdict; nothing here implies abandoning strata.

### α=0 self-check

Paired Δ across arms at α=0: max |Δ| = **0** over 500 (P1) and 265 (P2) pairs — confirms the bound is vacuous-for-layout, as designed.

## Residual geometry (Δ = strata-I − v2; positive ⇒ strata worse ⇒ v2+HL better)

| Residual | P1 p50 | P1 p90 | P2 p50 | P2 p90 |
| --- | --- | --- | --- | --- |
| tll (px) | +653 [+322, +965] | +7906 [+7632, +8226] | +1792 [+1600, +1979] | +4928 [+4136, +5352] |
| extent slice-B (px) | +324 [−301, +770] | +6726 [+3966, +7006] | +4786 (n=4, floor-ineligible) | +5532 (n=4, floor-ineligible) |
| cone-internal crossings | −1 [−3, 0] | 0 [0, 0] | 0 [−1, 0] | +6 [0, +6] |

Per-arm cone tails (report-only): P1 — v2 p90 112 / max 152 vs strata 79 / 101 (**strata's worst cones carry ~30% fewer highlighted-vs-highlighted crossings**); P2 — v2 33 vs strata 39 (v2 better). Median cones are near-clean in both arms (p50 ≤ 1).

v2 is strictly better on tll (both presets, both statistics) and on extent (P1; P2 floor-ineligible at n=4). Cone-internal crossings are small and mixed: a 1-crossing median edge to strata on P1, a tail edge to v2 on P2, and a real per-arm tail advantage to strata on P1's largest cones.

## Decision gate (plan §B, three conditions — all required to deprioritize Package C)

- **(i) Crossover α ≤ 0.5 (p50): MET on both presets.** P1 holds through α=0.75, P2 through α=1. *Caveat:* at p90, P1 fails at α=0.5 — the hard-trace tail favors strata-I unless substitution exceeds ~75%.
- **(ii) v2+HL residual geometry not materially worse: MET.** No residual metric shows v2 CI-worse at p90; v2 is strictly better on tll and extent. Honesty note: P1's largest highlighted cones are ~30% cleaner under strata (per-arm tail, not paired-CI-confirmed).
- **(iii) Owner canvas eval: PENDING.** No new highlight feature is needed — the planned overlay was cancelled as duplicative (owner correction): the **existing selection-driven relationship focus** is the highlight. Verified working on strata scenes: the effect is mounted view-agnostically (`LayerUI.tsx`), the strata build stamps `terraformSemanticOverview` (its one scene gate), and strata finalize hard-fails any edge missing `relationship.source/target`, so the focus BFS sees the full dependency graph. Eval procedure on P1: open `/demo?preset=staging-extended-localstack-v2&view=pipeline&pipelineVariant=v2` (v2 arm) and `/demo?preset=staging-extended-localstack-v2&view=strata` (strata-I arm — the bare URL now defaults to K=4+A7), click the same resource node in each, judge trace readability of the focused neighborhood. Model↔feature mismatch to weigh while judging: the shipped focus is **undirected and 3-hop-capped** (color-wash dim, clone-on-click cost profile, hover prohibited), whereas the modeled highlight — and impact tracing — is a directed unbounded cone. A directed mode is an estimated ~50–80-line delta inside `terraformRelationshipFocus.ts` (undirectedness is localized to its `link()` helper; `maxHops` already a parameter), unbuilt pending this verdict.

## Honesty box

Model-based sensitivity analysis over literature-derived engineering weights — **not new empirical data**. No PASS/FAIL gate cell is created from this battery; any gateRegister entries derived from it must be `REPORT`. The true substitution level α of a real rendered highlight is unknown (and plausibly differs between median and hard traces); the sweep brackets it, nothing more. Cone anchors overlap (cones share arrows), so the paired cone CIs are indicative, not independent-sample inference. Two presets, no held-out state, owner-N=1 (R8-F11 stands).

## Bottom line

**Two of the three deprioritization conditions are met; the case is strong at the median, contested at the P1 tail.** A tracing highlight on the cheap v2 layout plausibly substitutes for strata-I's layout-level advantage on typical traces (and P2 never needed the highlight to begin with), while W5's residual costs of strata (path stretch, extent) remain real. What survives for layout work is precisely the **hard-trace tail on P1** (p90 crossover fails at α=0.5) and strata's cleaner worst-case highlighted cones — both point at the same provider/account band-geometry residual, but now as a *tail-only* target. Pending owner eval (iii): if confirmed, Package C should shrink to the cheap angle-aware separation probe aimed at the p90 tail, not a full geometry milestone.

Raw JSON: regenerate deterministically via the run command in Methodology (session copy: scratchpad `W6_HIGHLIGHT_SPIKE_REPORT.json`). W5 reproducibility re-verified post-extension: `W5_REPAIRED_STATS_REPORT.json` byte-identical.
