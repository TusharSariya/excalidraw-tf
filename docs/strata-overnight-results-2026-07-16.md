# Strata overnight results — 2026-07-16

Frozen measurement preset: **staging-extended-localstack-v2**, `view=strata`, seed `20260704`, real app path (`layoutTerraformFromSources`). All deltas are off-vs-on for the single named toggle unless noted. All toggles are **opt-in, default-off, and default-off byte-identical** (proven by the threading suite).

## TL;DR

- **4 shipped, committed** (all on `strata-v3.2-w5-w10b`, none pushed).
- **1 null-result** shipped as an opt-in no-mover (`strataBlockClamp`).
- **1 deferred / not built** (`strataYCompact` — no-op risk + wrong-problem for P3).
- **Biggest readability win of the night: `strataTranspose`** — rendered crossings **173→132 (−41, ~24%)**, envelope-preserving (width/height Δ0). Keep it.

> **⚠️ CORRECTION (2026-07-16, post-hoc measurement).** This report **under-sold `strataSinkPullIn`**. It was
> scored only on width/height — which ARE byte-identical — so it was written up as "no size/crossing win /
> marginal / structural". A dedicated fidelity-green A/B on the real app path then measured what was never
> checked: **edge-length L1 −17,656 (−2.41%)** and **penetrations/pierce 66→64**. Both P1 DLQs move to
> `srcRank+1` on-grid (ingress col 15→9, own-edge L1 7175→992; egress col 15→11, 5191→992), plus three SSM
> sinks (api8 −3,062, api9 −3,596, api11 −616). Per-sink attribution is exact (Σ per-sink ΔL1 = whole-scene
> ΔL1, verified). **P1 is substantially fixed — the win was real and simply unmeasured.** Rows below are
> corrected; the lesson is that *width/height alone is not a measurement* — length/pierce must be scored too.

## Summary table

| Experiment | Toggle | Status | Crossings on→off | Edge-len / pierce | Height | Width | Review verdict | Improves layout? |
|---|---|---|---|---|---|---|---|---|
| Sink pull-in | `strataSinkPullIn` | committed | rendered **173→174 (+1)**; chord 204→204 (flat) | **L1 −17,656 (−2.41%)**; **pierce 66→64** | Δ0 (byte-identical) | Δ0 (byte-identical) | fix-then-ship; all findings addressed + codex static pass clean | **Yes — real L1/pierce win (corrected; originally mis-reported as null)** |
| Block clamp | `strataBlockClamp` | null-result | 0 (byte-identical A/B) | — | inert (phase-1) | frames held fixed | SHIP as opt-in null-result; codex CHANGES addressed | **No (null)** |
| Transpose | `strataTranspose` | committed | **173→132 (−41, ~24%)** | pierce 66→61 (−5) | Δ0 | Δ0 | SHIP (codex re-derived independently) | **Yes — biggest win** |
| Y-compaction | `strataYCompact` | deferred | n/a | n/a | n/a | n/a | Not built (see risks) | Deferred |
| Border route | `strataBorderRoute` | committed | 123→118 (−5) | pierce 115→115 (invariant); maxWaypointPerpDev 19.6px | — | — | fix-then-ship; committed green | Yes — modest, routing-only |

Notes on the table:
- `strataSinkPullIn` deltas are measured in the **rankSeparate-ON (stranding) regime** — that is the regime it targets. In the default (rankSeparate-OFF) regime the pass is inert (0 elements move). Width/height are byte-identical off-vs-on even when 40 elements move (X-containment guard holds; zero frame escapes) — **but width/height byte-identity is NOT "no effect": L1 −17,656 and pierce 66→64. See the correction above.**
- `strataSinkPullIn` caveat: rendered crossings tick **+1 (173→174)** while chord crossings stay flat (204→204). This is the known **chord-vs-rendered proxy inversion** (see `docs/strata-pipeline-objective-audit-2026-07-15.md`) — the scorer structurally cannot see the crossing it adds. Pierce −2 nets it favorably, but the pass is **not strictly free** on the top-ranked metric.
- **5 of 27 stranded sinks move** (6 with `strataSinkLadder`). The other 22 are blocked by the X-containment cliff / scorer veto — a known limitation, not a regression. Measured 2026-07-16: **height rejects NOTHING** across all 27 sinks × all rungs × all candidate tops; the binding wall is `nonAncestorOverlaps` (100% of R2 rejections).
- `strataBorderRoute` pierce is invariant **by design** (it routes around borders, it doesn't change penetration counts); the both-flags-on compose proof shows no penetration regression (both-on pierce 59 == edgeRouting-alone 59).

## How to try each committed experiment

Base URL: the staging-extended-localstack-v2 strata demo URL
(`?preset=staging-extended-localstack-v2&view=strata`), then append the param.

| Toggle | Demo URL param | UI toggle label / where | Best combined with |
|---|---|---|---|
| `strataSinkPullIn` | `&strataSinkPullIn=1` | Strata "sink pull-in" (weights/cap controls now enable when sift OR sink-pull-in is on); hint: "primarily useful with Compact height enabled" | `&strataRankSep=1` (Compact height ON) — most visible |
| `strataTranspose` | `&strataTranspose=1` (`=0`/omit = byte-identical baseline) | Strata transpose refine; hint: "refines the ordering pass and is most effective with it on" | Layer ordering (`strataSweeps=4`) ON |
| `strataBorderRoute` | `&strataBorderRoute=1` | Strata border-exit routing | `&strataEdgeRouting=1` (exercises disjoint-compose path) |
| `strataBlockClamp` | `&strataBlockClamp=1` | Strata block clamp (default off) | — (null-result; no visible mover at frozen preset) |

## Per-experiment detail

### 1. `strataSinkPullIn` — committed (`3adfb38`)

Pulls ~8 degree-1 sinks toward their source column in the rankSeparate stranding regime (40 elements move). **Envelope-preserving: width 14898 and height 13761 byte-identical off-vs-on**; `strataStructural` all-zero on both; zero frame escapes.

Load-bearing fixes made during the build:
- **BLOCKER** X-containment guard: reject any target column where `columnX[srcRank+1]` would push the leaf outside its parent hull box horizontally (`checkStrataStructure` exempts ancestor↔descendant overlaps, so this was the real hierarchy-escape hole). Re-measure: 0 escapes.
- **MAJOR** forward objective ε + weights + edge-cross cap to the engine for a sink-only run (were gated only on packedScoring/sift).
- **MAJOR** thread the same strata option shape through `useTerraformImportDialog.handleLoadPresetAndImport` so both import buttons adopt identically.
- **MAJOR** fixed stale exact-equality tests (`terraformStrataDefaults.test.ts`, `TerraformImportDialog.test.tsx`).
- **MINOR** `colSpan` retains the leaf's original rank span (moves the pixel box, never re-ranks); UI weights/cap enable when sift OR sink-pull-in on.

Verification: typecheck PASS; operator+defaults+threading 33/33; dialog 50/50. Fresh codex static pass on the two load-bearing fixes (X-containment guard, colSpan) found no correctness hole.

**Keep vs drop: KEEP (opt-in) — CORRECTED, this is a real win.** Originally written up as "no crossing/size win" because only width/height were scored. Post-hoc fidelity-green A/B: **L1 −17,656 (−2.41%), pierce 66→64**, 5 of 27 stranded sinks move (both P1 DLQs pulled to `srcRank+1` on-grid). Rolling-greedy adoption cost nothing — the sinks are geometrically independent, so per-sink ΔL1 sums exactly to the scene ΔL1. **Caveat before default-on:** rendered crossings +1 (173→174) while the chord proxy reads flat — the scorer cannot see the crossing it adds (chord-vs-rendered inversion). Pierce −2 nets favorably, but resolve the proxy before defaulting on.

### 2. `strataBlockClamp` — null-result, shipped opt-in (`7c7e2dc`)

Frozen-preset A/B is **byte-identical** — the pass finds no admissible block move at this preset under phase-1 constraints (provider frame extents held fixed, so it can only shorten chords, not reclaim width). Shipped anyway as a correct, guarded, default-off opt-in.

Fixes: on-grid landing gate (every block leaf must land exactly on `columnX[rank-k]` or the block is skipped — closes the compose-with-sink-pull-in off-grid evasion of the contiguity check); `placed` self-consistency (dead data today, fixed anyway); honesty edits to help text (no longer claims the diagram narrows).

Green gate: typecheck clean; operator 12/12; threading + default-off byte-identical + defaults 108/108.

**Keep vs drop: KEEP as dormant opt-in, do NOT invest further under phase-1.** It ships no measured improvement at the frozen preset. Its payoff is gated on a phase-2 that lets provider frame extents move — which is exactly the walled-width territory the removed X-compaction warns against. Revisit only alongside the P5 height gate, not standalone.

### 3. `strataTranspose` — committed (`e74f9c1`) — **the win**

Rendered dataflow crossings **173→132 (−41, ~24%)**, hull pierce **66→61 (−5)**, **width Δ0 and height Δ0** (envelope-preserving confirmed). Default/explicit-false byte-identical (sceneSignature match). Adjacent-swap transpose on placed geometry, bounded by `STRATA_TRANSPOSE_MAX_PASSES=4` + stop-on-no-adopt.

Codex CLAUDE-REVIEW: ship (re-derived the improvement independently rather than trusting the reported number). Three low findings, all non-blocking; the one actionable UI-copy over-claim was fixed ("refines the ordering pass and is most effective with it on"). Guardrails honored: opt-in default-off byte-identical, full threading in both `sceneContext` + `builderOptions`, LR/containment/no-overlap preserved (R2 `checkStrataStructure==0` backstop), envelope-preserving so the P5 height gate is untouched. Green gate: typecheck clean; 32/32 targeted tests.

Caveat: codex CLI had not emitted its final structured verdict at pickup; proceeded on the completed CLAUDE-REVIEW ship verdict + guardrail tests. Non-blocking findings noted: adoption gate reuses the non-transitive `strataRelocateAdoptable`; O(E²) per-candidate rescore (bounded by 4 passes, ~13s build at frozen preset).

**Keep vs drop: KEEP — strongest candidate for eventual default-on.** Largest measured readability gain of the night, envelope-preserving, well-guarded. Before default-on: resolve the non-transitive adoption-gate finding and confirm the ~13s build cost is acceptable on larger presets.

### 4. `strataBorderRoute` — committed (`ab3eac7`)

Single-flag: crossings **123→118 (−5)**, pierce **115→115 (invariant by design)**, sharpShare 0.41→0.42 (marginal), 40 edges routed, `maxWaypointPerpDev` 19.6px. Both-flags-on (edgeRouting+borderRoute) compose proof: border-routed drops 40→19 (yields ~21 edges to edgeRouting), both-on pierce 59 == edgeRouting-alone 59 (no penetration regression).

BLOCKING fixes: disjoint-compose — `routeStrataBorderExits` now skips any arrow already stamped `terraformRoutedPolyline` by edgeRouting, so the two passes own disjoint edge sets; added `strataBorderRoute:false` to the exact-equality test blocks. Improvements: `maxWaypointPerpDev` meta scalar as the faithful headline (interiorLenSavedL1 under-reads ~20x); disjoint-from-edgeRouting unit test; polyline-level default-off byte-identity in the threading test.

Note: the `terraformRoutedPolyline` marker + relationship customData do not survive binding-repair to the final scene elements, so the clobber/fix live at the skeleton stage (covered by the new unit test); the −5 rendered-crossing win still persists in the final scene.

**Keep vs drop: KEEP (opt-in).** Modest but real (−5 crossings), routing-only, composes cleanly with edgeRouting with no penetration regression. Good candidate to pair with edgeRouting; keep flagged.

## Failed / deferred / null-result

### `strataBlockClamp` — null-result (shipped anyway)
Byte-identical A/B at the frozen preset — no admissible block move under phase-1 (frame extents fixed). It is correct and guarded but moves nothing today. See detail above. This is an honest null: the help text was corrected to stop claiming the diagram narrows.

### `strataYCompact` — deferred, NOT built
Analysis concluded it should not be a same-night drop-in. Reasons:
1. **No-op risk (highest):** order-preserving Y pull-up is provably identical to `dropY` (longest-path optimality). Built as literally specified ("free monotone reducer") it ships a byte-identical no-op. Only the gap-backfill variant moves numbers — and that is not free.
2. **Wrong-problem for P3 (decisive):** the us-west-2 dead quadrant is in columns the sinks do not occupy; reclaiming it needs a JOINT left+up (X+Y) move. A columns-frozen Y pass cannot deliver P3's region-box shrink — that payoff belongs to the sink X-pull/relocate + P5 gate.
3. **Dependency risk:** the effective (gap-backfill) variant changes vertical order → crossings/contiguity/routing, so it MUST ride the P5 height gate + a crossing cap. **The P5 height gate is not built yet** → this is a multi-part build, not a same-night drop-in.
4. **Crossing regression:** hole-fill flips X-overlapping units' above/below relation, raising crossings/edge-length even while height drops; without the gate on FINAL geometry it regresses the #1 objective (readability).
5. **Perf:** hole-aware minimal-y search is O(units²) per packed hull; if invoked inside every packedScoring trial it multiplies candidate cost. Must bound to the final selected order.
6. **Threading silent-drop:** per the RCLL boundary memory, forgetting the `layoutTerraformFromSources` sceneContext forward makes the flag inert on the real `/api/terraform-layout` path while pipeline-direct tests pass (false green). The threading test is mandatory.
7. **Scope-creep guard:** must stay strictly Y-only; do NOT let a "fit" search nudge X — global/grid X-compaction was removed and must not return (`docs/strata-xcompact-removed-findings.md`).

**Recommendation: keep deferred — and the reason is now STRONGER, not weaker.** The P5 height gate landed
(`4abdc08e2`) as an honest null, and a follow-up measurement then showed **height rejects nothing** across all
27 stranded sinks × all rungs × all candidate tops (the binding wall is `nonAncestorOverlaps`, 100% of R2
rejections). So a Y-slack reclaimer solves a problem this preset does not have. P5 Stage 2 (occupant
displacement + VPSC) was **refused at research** for the same reason, plus: displacing the blocking occupant
means translating a whole VPC subtree (which the gate then correctly vetoes), and the box-recompute it would
need to clear the X-containment cliff leads straight back to the removed X-compaction failure with no X gate
to stop it. See `docs/strata-view-improvement-synthesis-2026-07-16.md`.

## Keep-vs-drop scorecard

| Toggle | Verdict | Rationale |
|---|---|---|
| `strataTranspose` | **KEEP — best; candidate for default-on** | −41 crossings (~24%), envelope-preserving; resolve non-transitive adoption gate + build-cost before default-on |
| `strataBorderRoute` | **KEEP (opt-in)** | −5 crossings, composes cleanly with edgeRouting, no penetration regression |
| `strataSinkPullIn` | **KEEP — 2nd-best; CORRECTED from "null"** | **L1 −17,656 (−2.41%), pierce 66→64**; both P1 DLQs pulled to `srcRank+1`. Was mis-reported as no-win because only width/height were scored. Resolve the chord-vs-rendered proxy (+1 rendered crossing the scorer can't see) before default-on |
| `strataBlockClamp` | **KEEP dormant; no further phase-1 invest** | Null at frozen preset; **scorer-driven** (+4 crossings/+2 pen), explicitly NOT height-vetoed — so the height gate does nothing for it |
| `strataYCompact` | **DEFER — reason now stronger** | Height rejects nothing (measured, all 27 sinks); the wall is structural overlap. A Y-slack reclaimer solves a problem this preset lacks |
| `strataHeightGate` | **KEEP dormant (honest null)** | Correct per-hull referee but nothing proposes height-growing candidates (consumers pin `box: bh.box`) → inert. Its real value: it **repaired a vacuity bug** — blockClamp's old scene-global `maxBottomOf` guard was blind to non-tallest hulls growing, silently passing the moves it existed to reject |

## Ship state
All four committed toggles are on `strata-v3.2-w5-w10b`, committed `--no-verify` (per push-gotchas memory — husky pre-push reflows unrelated files), **not pushed**. Each commit was scoped to only its intended feature files; the ~50 pre-existing unrelated dirty docs/.mcp/scratchpad/baseline changes on the branch were left untouched. Throwaway A/B probes created, run, and deleted; the frozen readability harness is untouched.
