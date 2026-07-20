# Strata W10 — banded-level Y-waste ceiling probe (Package OD-15 re-scope, Stage 1)

**Date:** 2026-07-13 · **Status:** Battery report (measurement only; REPORT cells — no gate asserted, **no PASS minted**; no product-geometry change, no new flag — this is a report-only ceiling probe, not the Stage-2 lever). Triggered by an owner screenshot (P1 strata, all toggles on) raising three observations: two banded-level Y-waste patterns and the long-standing WAF→ELB diagonal.

## Document graph

| Relation | Link |
| --- | --- |
| Role | Battery (ceiling probe, Package OD-15 re-scope) |
| Status | Current (Stage 2 open, deferred) |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | Owner screenshot triage (2026-07-13); round-8 OD-15 residual; [`strata-view-decision-log.md`](./strata-view-decision-log.md) SDEC-62 |
| Sisters | [`strata-view-w7-packed-scoring-battery.md`](./strata-view-w7-packed-scoring-battery.md), [`strata-view-w8-rank-scorer-factorial.md`](./strata-view-w8-rank-scorer-factorial.md), [`strata-view-w9-routing-spike.md`](./strata-view-w9-routing-spike.md) |
| Next (agent) | Owner adjudication: close obs 2/3 as screenshot-local (rejected by this report — reclaim is material under RS) vs. authorize Stage 2 (`strataBandCompact`), gated behind the ε (SDEC-60) / routing (SDEC-61) / W7 waiver (SDEC-58) adjudications closing first |

## Role

This is Stage 1 of a two-stage plan (W10 plan doc, session-local; see SDEC-62). It answers one question cheaply: **is the banded-hull Y-waste the owner saw material, or screenshot-local?** It recomputes an offline, order-constrained skyline re-pack of each banded hull's direct children and reports the reclaimable height — nothing in the shipped engine changes. No flag exists because nothing is threaded; the harness (`terraformPipelineStrataBandCompactProbe.test.ts`) only reads final geometry and writes a report.

## Owner observations + final classification

Three observations from the owner's screenshot, classified by two independent tracks — a Fable agent (repo + docs + git + rag + internet) and codex gpt-5.6-sol xhigh (same brief, plus a shit-test of the obvious remedy):

| # | Observation | Verdict | Mechanism |
| --- | --- | --- | --- |
| 2 | Account 02: us-east-2 pushed to a deeper column but rows not reclaimed; us-west-1 X-disjoint yet keeps its own row | **EXPECTED documented trade-off; the fix is a registered-but-unbuilt future lever (OD-15 as re-scoped by v3.2 item 7)** | Accounts are `banded` hulls: placement is a blind full-width cursor stack (`terraformPipelineStrataPlacement.ts:321-328`, no X-overlap test). Only `packed` hulls (region/vpc/subnetZone) share rows via `dropY` (L80-102). rankSeparate's own docstring documents it: under banded hulls, separation widens rows but does not compress them (`terraformPipelineStrataRankSeparate.ts:48-51`). A7 treats every banded sibling pair as X-overlapping (`terraformPipelineStrataCoordRefine.ts:248`), so no later pass can merge rows. `assertStrataBandRowInvariant` enforces this as an invariant, not a bug. |
| 3 | Accounts 01/04 X-disjoint from 03; provider band taller than necessary | **Same verdict — identical code path one level up** | Provider hull is banded; same L321-328 stack. Height cost measured + owner-waived: SDEC-44 (extent FAIL, ~1.9×), SDEC-47 (arm-E override), SDEC-51/53 (rankSeparate = median parity, p90 tail FAIL-WAIVED, v3.2 item 4). SDEC-51: "do NOT build OD-15 speculatively." |
| 1 | WAF→ELB very long diagonal | **GAP in the known cross-hierarchy long-edge class; remedies already adjudicated; NOT caused by banding** | WAF and ELB are in the SAME region (us-east-1). WAF is region-direct (`security-observability.tf:221`); ELB is nested region→vpc→publicSubnetZone. The region is PACKED, not banded — banding is not the cause. Direct levers already adjudicated: routing adverse (SDEC-61/W9), ε δ=1 = owner call (SDEC-60), hull-Y NO-GO. |

## Convergence / divergence (Fable vs codex xhigh)

**Converged (load-bearing):** obs 2/3 = expected-per-design + an unbuilt compaction opportunity, same file:line evidence; no vertical compaction pass exists anywhere in Strata; coordRepack is RCLL-only and a permutation, not a row-merger; **the Y-axis hull-coord NO-GO does NOT block this** — that probe measured edge-length-motivated Y movement of _fixed_ structure, whereas disjoint-X row-sharing is a packing estimand that _changes the feasible structure_ (both tracks reached this distinction independently — see the NO-GO estimand distinction below); routing stays adverse for obs 1; the `REGION_SUBNET_VERTICAL_BANDS_PLAN.md` design intent ("increased scene height is acceptable", forced stacks at root/provider/account) is now in tension with the owner's complaint — a preference-drift flag, not a reversal.

**Diverged, adjudicated:**

1. _Obs 1 mechanism._ Fable attributed part of the WAF→ELB length to banded stacking and called compaction "mechanically shortening" it; codex traced the fixture (`pipeline.tfd:278`, `trunk.tf:153`) and showed both endpoints share one packed region — banding isn't in the path, and any compaction benefit is unproven. **Codex's read was adopted** (better code-grounding); the W10 battery therefore _measures_ the WAF→ELB chord explicitly rather than assuming improvement. Result below: measured, not assumed — the chord delta is exactly 0 in every arm.
2. _Sequencing._ Fable proposed building the opt-in compactor next; codex proposed a report-only ceiling probe first, with production policy deferred until after the pending adjudications close, and explicitly not shipped as a post-A7 patch. **Merged into the two-stage plan**: probe now (cheap, freeze-safe, answers "material or screenshot-local"), lever second.
3. _Remedy shape._ Codex's shit-test rejected two naive options: flipping provider/account to `packed` (drags them into packedScoring's reorderable-hull set → cost blowup + invalidates W7 substrate evidence, `terraformPipelineStrataPackedScoring.ts:516`) and a post-A7 pass (bypasses the scorer's final-geometry never-worse guard, L473; A7 would fight it). Codex's **third-policy** proposal — a new `bandedCompact` A0 policy that keeps canonical sibling order as a constraint, lets only genuinely X-disjoint siblings share vertical space, and extends A7's `blocksConstrain` for the new policy — is adopted as the Stage-2 design.

## The NO-GO estimand distinction

[`rcll-y-axis-hull-coord-nogo.md`](./rcll-y-axis-hull-coord-nogo.md) found that moving whole hulls' Y position to shorten cross-container edges is infeasible under a coupled all-level solve (0a ceiling 99.91% headroom, 0b constrained NO-GO — the feasible region is intrinsically 2D-inseparable because frames are subtree bboxes and lane-rise interleaves X-disjoint subtrees in Y). That result does **not** apply here. The Y-axis NO-GO held _structure fixed_ and asked how far a hull could move within it; this probe asks a different question — whether disjoint-X siblings can _share vertical space at all_, which changes what "structure" means (the feasible region itself, not a point within it). Both investigation tracks converged on this distinction independently before this battery ran.

**REGION_SUBNET_VERTICAL_BANDS_PLAN.md preference drift.** That plan's stated design intent — "increased scene height is acceptable," forced full-width stacks at root/provider/account — is the historical rationale for the banded policy this probe measures around. The owner's 2026-07-13 complaint is in direct tension with that stated tolerance. This report does not resolve the tension; it flags it as an open preference-drift item pending owner ratification (does "acceptable" still hold, given a ~50% ceiling reclaim now measured under rankSeparate?).

## Probe method

`terraformPipelineStrataBandCompactProbe.test.ts` (report-emitting, never asserts; W7/W8/W9 harness pattern, `Q10_REPORT_DIR`, seed 20260704 — the probe itself is sampling-free and deterministic) runs against the owner's config (K=4 sweeps + coordRefine) crossed with {rankSeparate off/on} × {packedScoring off/on} = 4 arms (**I**, **I_RS**, **P**, **P_RS**) on both **P1** (`staging-extended-localstack-v2`) and **P2** (`staging-localstack`).

For each banded hull (provider, account — **root is reported but never compacted**) in the FINAL per-arm geometry, an offline **order-constrained skyline** re-places the hull's direct children in their current top-to-bottom order:

- **dropY semantics reimplemented locally** in the test — not exported from production code — using the same gap constants as `terraformPipelineStrataPlacement.ts:80-102, 321-328`.
- **Gap constants are computed call-time, inside functions, never as module-level consts** (the NaN import-cycle rule: planParsing→layoutCore is a cycle that forbids module-level consts sourced from `LayoutShared`).
- **Direct children are resolved by smallest-area geometric containment** (not by walking the compound tree), so the probe is independent of any internal hierarchy representation.
- **Current visual order is preserved as a partial order**: a child never rises above an X-overlapping earlier sibling; X-disjoint siblings may share rows (skyline, not tallest-member-per-row).
- **Composition is bottom-up**: accounts are compacted first; providers are then re-packed using the _shrunken_ account heights (account interiors are kept as-is — nothing inside an account moves).
- Chord deltas propagate each endpoint's ancestor-hull cumulative child-top offset shifts (`sourceDy`/`targetDy`) plus any root-stack shift; every reported cell carries `ceilingEstimate: true`.

**Ceiling-estimate caveats (must be explicit).** This is an _upper bound_, not a build proposal:

1. It never re-lays out anything _inside_ a packed hull (region/vpc/subnetZone interiors are frozen). Because of this, **intra-region chords are invariant by construction of the estimate** — if both endpoints of a measured chord sit inside the same packed region, the estimate cannot show any delta for that chord regardless of whether a real Stage-2 compactor would move it. WAF→ELB and both SQS pairs are exactly this case (all endpoints intra-region: us-east-1 for WAF/ELB, us-west-2 for the SQS pairs). So the zero measured for those three chords below is a property of the _estimate's blind spot_, not proof that a real lever helps or hurts them — it simply means this ceiling probe cannot speak to cross-region/cross-account chords, and none of the tracked pairs are cross-region. Codex's "unproven" for obs 1 is therefore now "measured zero under this estimate" — a narrower, more precise claim, not a stronger one.
2. It is bottom-up and non-iterative — it does not re-run A7 refinement, re-run the packedScoring comparator, or search a candidate frontier. A real `bandedCompact` policy would interact with both (per the Stage-2 divergence-3 write-up above).
3. It composes account reclaim into provider geometry using each account's shrunken height, but does not re-derive account X-positions or re-run cross-account edge routing.

## Results

### Composed canvas-height reclaim per arm

| Preset | Arm | Canvas height before | after | Reclaimed px | Reclaimed % |
| --- | --- | --: | --: | --: | --: |
| P1 (`staging-extended-localstack-v2`) | I | 19,066.00 | 19,066.00 | 0 | 0% |
| P1 | **I_RS** | 14,126.33 | **6,680.50** | **7,445.83** | **52.71%** |
| P1 | P | 19,763.50 | 19,763.50 | 0 | 0% |
| P1 | **P_RS** | 14,227.50 | **6,916.00** | **7,311.50** | **51.39%** |
| P2 (`staging-localstack`) | I | 12,106.00 | 12,106.00 | 0 | 0% |
| P2 | **I_RS** | 7,846.00 | **4,046.50** | **3,799.50** | **48.43%** |
| P2 | P | 12,979.00 | 12,979.00 | 0 | 0% |
| P2 | **P_RS** | 7,906.00 | **4,222.00** | **3,684.00** | **46.60%** |

All four non-RS arms (P1 I, P1 P, P2 I, P2 P): **exactly 0 reclaimed px**, confirmed in every child row of the account and provider levels — under banded siblings without rankSeparate, an interlocking full-width chain leaves nothing X-disjoint to compact (this is the same L321-328 cursor-stack mechanism the classification table cites). The reclaim is entirely an **RS interaction**: `bandedCompact` is only material when combined with rankSeparate, which is consistent with RS being the lever that widens rank gaps enough for siblings to become X-disjoint in the first place — and would roughly cancel RS's own known p90 height tax (SDEC-51/53 waiver context; RS trades height for tail-cost elsewhere, this lever would give some of that height back).

### Per-level reclaim, RS arms only (px)

**P1 I_RS** (owner config): account-level total reclaimed 5,029.83 px (Account 02: 7,734→3,934.5, −3,799.5; Account 03: 3,768.33→2,538, −1,230.33; Accounts 01/04: 0, single-region hulls, nothing to compact). Provider-level (composed from shrunken accounts): 14,126.33→6,680.50, −7,445.83 (account 03 slides up under account 02 by −3,799.5; account 01 slides up by −11,694.33; account 04 slides up by −12,671.33 — the four accounts collapse from a rigid vertical stack into a packed skyline).

**P1 P_RS**: account-level total 4,780 px (Account 02: 7,794→4,110, −3,684; Account 03: 3,694→2,598, −1,096). Provider-level: 14,227.50→6,916.00, −7,311.50.

**P2 I_RS / P_RS** (single account, single provider hull): account-level reclaim = provider-level reclaim by construction (only one account exists). I_RS: 7,734→3,934.5 (−3,799.5, four regions collapse from a 4-row stack to 2 effective rows). P_RS: 7,794→4,110 (−3,684).

### Chord deltas

| Chord | P1 I | P1 I_RS | P1 P | P1 P_RS | P2 (all arms) |
| --- | --: | --: | --: | --: | --: |
| WAF → ELB (px) | 2,731.02 → 2,731.02 (Δ0) | 1,006.72 → 1,006.72 (Δ0) | 2,221.23 → 2,221.23 (Δ0) | 993.78 → 993.78 (Δ0) | not found on P2 (no `aws_wafv2_web_acl` resource in `staging-localstack`) |
| SQS → RDS (px) | 1,303.09 → 1,303.09 (Δ0) | 1,303.09 → 1,303.09 (Δ0) | 675.79 → 675.79 (Δ0) | 1,200.28 → 1,200.28 (Δ0) | not found on P2 |
| SQS → Dynamo (px) | 535.37 → 535.37 (Δ0) | 535.37 → 535.37 (Δ0) | 496.00 → 496.00 (Δ0) | 1,629.33 → 1,629.33 (Δ0) | not found on P2 |

**Zero improvement in every arm, every chord found.** Both WAF and ELB sit in us-east-1 (intra-region); both SQS-pair endpoints sit in us-west-2 (intra-region). Per the ceiling-estimate caveats above, this is a structural blind spot of the estimate, not a proof that a real compactor cannot help — but it is the honest, measured answer to the question codex raised: **obs-1 (the WAF→ELB diagonal) is explicitly NOT helped by this lever.** The `sourceDy`/`targetDy` fields do move nonzero in the RS arms (e.g. P1 I*RS WAF: −1145.5 on both endpoints; P1 P_RS SQS→Dynamo: −3684 on both) — confirming the endpoints ride their ancestor hulls up together — but because both endpoints of each tracked chord move by the \_same* delta (same packed region), the chord length itself never changes. The region moves rigidly; only cross-region/cross-account chords could move under this estimate, and none of the three tracked pairs are cross-region.

### Determinism

`probeRecomputeByteIdentical: true` in all 8 arms (P1×4, P2×4); `softFailures: []` at the top level. The probe is sampling-free by construction (no RNG/clock), so byte-identical recompute is the expected — and confirmed — result.

## Decision-gate outcome

Per the W10 plan's Stage-1 gate ("if reclaimable height is immaterial — < ~10% of P1 canvas height — CLOSE obs 2/3 as screenshot-local and skip Stage 2"):

- **Under rankSeparate (I_RS, P_RS), reclaim is MATERIAL** — 46.6%–52.7% of canvas height, on both presets, ≫ the 10% threshold. Obs 2/3 do **not** close as screenshot-local; the owner's complaint reflects a real, measurable ceiling.
- **Without rankSeparate (I, P), reclaim is exactly 0%** on both presets — under the shipped default configuration (rankSeparate off), there is nothing for `bandedCompact` to reclaim; the trade-off the owner saw is contingent on rankSeparate being on.
- **Obs 1 (WAF→ELB) is explicitly NOT addressed by this lever** — measured zero on every tracked intra-region chord, in every arm, for the structural reason above.

**Decision:** Stage 2 (`strataBandCompact`, a third A0 policy applied to provider/account with root staying banded, per the adopted third-policy design in the divergence record) **stays OPEN but is deferred** — it is not built in this session. It is registered as material-and-pending, gated behind the three already-open owner adjudications this plan explicitly does not want to build in front of: the ε default (SDEC-60), the routing direction (SDEC-61), and the W7 packedScoring default waiver (SDEC-58). Building `bandedCompact` now would change the substrate those three decisions are being made on. This report is REPORT-only evidence for that future decision, not a default change — no flag ships, no product geometry changes, and this doc's numbers are ceiling estimates, not a promise of what Stage 2 will deliver once it accounts for A7/scorer interaction.

## Honesty box

- Two presets, no held-out state, owner-N=1 (consistent with prior batteries' R8-F11 caveat).
- The estimate is bottom-up and non-iterative; it does not model A7 refinement or the packedScoring comparator re-running against a compacted substrate — a real Stage-2 lever's actual reclaim, crossings, and rt̂ cost are unmeasured and could differ materially from this ceiling.
- Chord-delta zero for WAF→ELB and both SQS pairs is a structural consequence of all three pairs being intra-region (the estimate never re-lays packed interiors) — it is not evidence that a real compactor helps or fails to help those chords, only that this specific ceiling model cannot see cross-region effects and none of the tracked pairs are cross-region.
- P2's WAF/SQS chords are not found at all — `staging-localstack` does not contain the `aws_wafv2_web_acl` / SQS-pair fixtures the owner's screenshot came from; those rows are P1-only, consistent with the W7/W8/W9 "owner case exists only on P1" pattern.
- All numbers in this document are from `W10_BAND_COMPACT_PROBE.json` (single run, seed 20260704).

## Bottom line

The owner's two banded-hull Y-waste observations (2 and 3) are real and material under rankSeparate — roughly half the P1/P2 canvas height is reclaimable by this ceiling estimate once rankSeparate is on — but exactly zero without it, confirming the reclaim is an RS×bandedCompact interaction, not an independent lever. The WAF→ELB diagonal (observation 1) is measured, not assumed, to gain nothing from this lever in every arm, for a structural reason now made explicit (intra-region invariance of the estimate) rather than left as codex's "unproven." Stage 2 — the opt-in `strataBandCompact` A0 policy — is therefore registered as a live, material, adopted-design candidate, but deliberately not built until the ε/routing/W7-waiver adjudications this probe was designed not to get ahead of are closed by the owner.
