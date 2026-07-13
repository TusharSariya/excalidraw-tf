# Strata W9 — obstacle-avoiding edge-routing spike (Package C)

**Date:** 2026-07-12 · **Status:** Battery report (measurement only; REPORT cells — no gate asserted, **no PASS minted**; `strataEdgeRouting` defaults OFF on every surface).

Strata edges render as straight centre-to-centre chords; W7/W8 measured 65–123 hull penetrations (plus ~150–200 card penetrations) per preset — an edge tunneling through a box that is an ancestor of neither endpoint, e.g. the owner's SQS→RDS arrow crossing `vpc-5b5`. Placement provably cannot zero this class (round-9/W8 series), and the normative M-H exact-zero prerequisite is still outstanding. Routing around obstacles is the literature-standard remedy: Wybrow/Marriott/Stuckey's incremental connector routing (corpus doc `doi-10-1007-11618058-40`; the orthogonal variant `doi-10-1007-978-3-642-31223-6-10` penalizes bends over length), Bouts & Speckmann's clustered edge routing around hull obstacles (`forward-10-1109-pacificvis-2015-7156356`), and Han et al. 2024's boundary-port treatment of cluster edges (`s2-10-1109-vis55277-2024-00035`). The bend budget is grounded in Purchase's aesthetics validation — bends cost readability less than crossings (`s2-10-1007-bfb0021827`) — and the minimal-deviation rule in Xu et al. 2012 — gratuitous curvature hurts (`doi-10-1109-tvcg-2012-189`). W9 builds the spike (mode **penetrating-only**: route ONLY offending edges, keep everything else byte-identical) and measures what it buys and what it costs.

## Document graph

| Relation | Link |
| --- | --- |
| Role | Spike battery + routing-semantics record (Package C) |
| Status | Current |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | Round-9/SDEC-59 hull-crossing investigation ([`strata-view-decision-log.md`](./strata-view-decision-log.md)) |
| Sisters | [`strata-view-w8-rank-scorer-factorial.md`](./strata-view-w8-rank-scorer-factorial.md), [`strata-view-w8b-epsilon-frontier.md`](./strata-view-w8b-epsilon-frontier.md), [`strata-view-w7-packed-scoring-battery.md`](./strata-view-w7-packed-scoring-battery.md) |
| Next (agent) | Owner adjudication: keep the spike as a probe lever, extend toward channel/nudged routing (Wybrow-style), or fold into an all-edges mode |

## Router semantics as shipped (`strataEdgeRouting`, default off)

- **Placement untouched.** Routing runs at scene-skeleton assembly, AFTER final geometry (post packedScoring guard, post-A7) — it rewrites only TFD arrow `points[]`; every frame/card box is byte-identical to the unrouted arm.
- **Eligibility (penetrating-only).** An arrow is eligible iff its straight chord intersects the OPEN interior of ≥1 foreign box: a hull frame that is an ancestor of neither endpoint, or a primary-cluster card other than the two endpoints. Endpoint-ancestor hulls are permeable (Bouts & Speckmann's cluster rule). Non-eligible arrows are untouched (same object reference in the skeleton).
- **Clearance 14 px** = `PIPELINE_FRAME_PAD / 2` — half the hull frame padding and under half the tightest sibling gap (`PIPELINE_CLUSTER_GAP_Y` = 36), so detours hug obstacles inside existing gutters. Computed inside functions, never module-level (SDEC-34 NaN rule).
- **Corner-route search.** Find the first blocking inflated box along the segment (min Liang–Barsky entry t, tie → lowest obstacle index); try its two corner detours (mostly-horizontal chord → above then below; mostly-vertical → left then right; corners ordered along travel); repair sub-segments recursively (budget strictly decreases 2 per nesting ⇒ terminates); keep the candidate with minimal L1 length, tie → earliest candidate. A greedy shortcut pass then drops any waypoint whose bypass is clean (Xu: never keep a bend that buys nothing).
- **Bend cap 6 interior waypoints/edge** (Purchase: a few bends are cheap, many are not). No clean route within the cap ⇒ keep the straight chord, count `unroutable` — never emit a worse mess.
- **Acceptance check.** A found detour is accepted only if it is penetration-free against EVERY raw foreign box — including obstacles dropped from the search because their clearance zone contained a chord endpoint. Rejected detours fall back to the chord and count `unroutable`. Consequence (measured below): **routed ⇒ zero foreign-box penetrations**, by construction and by the scene probe.
- **Determinism.** No RNG/clock; obstacle order = hulls then cards, code-unit sorted by id; edge order = C4′-stable skeleton emission order. Pinned by unit tests (route twice, byte-compare) and the battery's normalized-rebuild probe.
- **Emission.** Routed arrows become multi-point arrows: `x`/`y` (the chord start) never move, endpoints never move, bindings and relationship customData preserved; the arrow additionally carries `terraformRoutedPolyline: true`. **Discovered seam:** `repairTerraformEdgeBindings` (terraformVisibility.ts) unconditionally flattened every terraform edge back to a straight 2-point chord during scene finalize — the repair now preserves the polyline for marked arrows (re-anchoring bindings only); unmarked arrows (every scene with the flag off) take the identical pre-W9 code path. Soft-delete semantics unchanged (TFD arrows still emit soft-deleted; probes do not filter `isDeleted`).
- **Meta.** `strataEdgeRoutingRouted` / `strataEdgeRoutingUnroutable` / `strataEdgeRoutingWaypoints`, echoed flag-on only (packedScoring pattern).

## Methodology

One harness run (`terraformPipelineStrataRoutingSpike.test.ts`, report-emitting, never asserts gates; seed 20260704 inside the shared bootstrap helpers; `softFailures: []`) over four strata arms on P1 (`staging-extended-localstack-v2` compact) + P2 (`staging-localstack` compact): **I** (K4+A7), **P** (I + packedScoring), **P_R** (P + routing), **I_R** (I + routing). Cells: hull+card penetrations **recomputed on FINAL polylines** (the W7 probe, which walks `points[]` segment by segment — verified to handle multi-point arrows), scene crossings + crossing angles on polylines, bend count and route-stretch (routed arc / chord) distributions, owner-case SQS→RDS / SQS→Dynamo arrow path-vs-chord, routed/unroutable counts, wall-clock, and paired extent + M-RT path-family CIs vs the matching unrouted arm (`gateEligible` forced false on voided/degenerate cells). A P_R rebuild's normalized (wall-clock-free) summary must match byte-for-byte (determinism probe). Δ = routed − unrouted; negative = better. Regenerate:

```
Q9_REPORT_DIR=<dir> yarn vitest run \
  packages/excalidraw/components/terraformPipelineStrataRoutingSpike.test.ts \
  --exclude "**/.claude/**"
```

**What the path metrics consume post-routing (the codex trap, answered):** every metric in this battery reads the rendered polylines, not centre chords. `computeStrataPathMetrics` builds per-arrow segment lists from `points[]` — the rt̂ **cr** term crosses segment-by-segment against the routed paths, **con** uses the first/last non-degenerate segment directions (so a detour's entry/exit stubs are what meet at intermediate nodes), and **tll** is polyline arc length. `diagnosePipelineScene` crossings/angles are per-segment over `points[]`. The W7 penetration probe walks `points[]` per segment. No shared helper in this battery reads a straight chord.

## Per-arm scalars

| Arm | hull pen. | card pen. | crossings | sharpShare | routed / unroutable | bends (tot, p50, max) | stretch (p50 / p90 / max) | rt̂ p50 / p90 (arm) | build ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **P1** I | 115 | 206 | 123 | 0.41 | — | — | — | 13.36 / 21.39 | 2797 |
| **P1** P | 87 | 149 | 97 | 0.29 | — | — | — | 12.52 / 19.87 | 14059 |
| **P1** P_R | **32** | **38** | 236 | 0.22 | 72 / 10 | 177, 2, 5 | 1.12 / 2.20 / 3.43 | 14.86 / 24.23 | 15049 |
| **P1** I_R | **62** | **80** | 309 | 0.17 | 65 / 19 | 179, 3, 6 | 1.16 / 1.94 / 3.80 | 16.07 / 28.86 | 2792 |
| **P2** I | 61 | 142 | 39 | 0.95 | — | — | — | 12.58 / 21.78 | 1237 |
| **P2** P | 33 | 97 | 24 | 0.71 | — | — | — | 11.53 / 18.70 | 2184 |
| **P2** P_R | **10** | **26** | 91 | 0.35 | 41 / 8 | 91, 2, 5 | 1.10 / 2.14 / 2.80 | 13.95 / 23.02 | 2124 |
| **P2** I_R | **28** | **57** | 134 | 0.22 | 40 / 12 | 103, 3, 6 | 1.15 / 1.94 / 3.80 | 14.90 / 26.28 | 1231 |

All arms: collisions 0, `rcllV2Degraded` absent, TFD arrow population 145 (P1) / 69 (P2). Unrouted arms carry zero bends and no routing meta (flag-off inertness at the arm level).

## KEY GATE CELL (report-only — no PASS minted)

Target: exact 0 penetrations for routed-eligible edges. Residual attribution splits scene penetrations by whether they sit on a bent (routed) or straight arrow:

| Arm | hull+card residual | on BENT arrows | on STRAIGHT arrows | unroutable edges |
| --- | --- | --- | --- | --- |
| P1 P_R | 70 (was 236 under P) | **0** | 70 | 10 |
| P1 I_R | 142 (was 321 under I) | **0** | 142 | 19 |
| P2 P_R | 36 (was 130 under P) | **0** | 36 | 8 |
| P2 I_R | 85 (was 203 under I) | **0** | 85 | 12 |

**Routed edges achieve exact zero** — every penetration-free acceptance held on the scene probe's independent polyline walk (0 penetrations on bent arrows across all four routed arms). The scene totals are NOT zero: 100% of the residual sits on straight chords — the unroutable-cap fallbacks (10–19 edges per arm, each typically piercing several boxes; the router deliberately keeps them straight rather than emit a partly-blocked detour). Best case (P2 P_R): −72% total penetrations (130→36). The 6-waypoint cap + full-cleanliness acceptance is the binding constraint on the residual; raising the cap or adding channel routing (Wybrow) is the obvious next dial, at a bend-count price Purchase's ordering does not automatically endorse.

## Owner case (P1 only; the pair does not exist in P2)

| Arm | SQS→RDS px (centres) | SQS→RDS arrow path / chord (bends) | SQS→Dynamo px | SQS→Dynamo arrow path / chord (bends) |
| --- | --- | --- | --- | --- |
| I | 1303.09 | 1174.40 / 1174.40 (0) | 535.37 | 243.94 / 243.94 (0) |
| I_R | 1303.09 | **1759.10 / 1091.67 (2)** | 535.37 | 243.94 / 243.94 (0) |
| P | 675.79 | 500.59 / 500.59 (0) | 496.00 | 226.00 / 226.00 (0) |
| P_R | 675.79 | 500.59 / 500.59 (0) | 496.00 | 226.00 / 226.00 (0) |

Under the packed-scoring substrate the owner's arrows are already penetration-free — routing leaves them **byte-identical** (the unrouted-edge identity contract, observed on the actual owner case). Under the I substrate the SQS→RDS chord pierces foreign boxes; the router clears it with 2 bends at stretch 1.61 (path 1759 px over a 1092 px chord). Note the polyline endpoints differ slightly from the frame-centre distance (1091.67 vs 1303.09) because arrows are centre-clipped to card borders.

## Paired cells vs the matching unrouted arm (n = 500 / 265 paths; extent n = 37 / 4)

| Cell (point [95% CI]) | P1 I→I_R | P1 P→P_R | P2 I→I_R | P2 P→P_R |
| --- | --- | --- | --- | --- |
| rt̂ p50 | **+2.79 [+2.25,+3.72] worse** | **+1.77 [+1.49,+2.22] worse** | **+1.25 [+0.60,+2.30] worse** | **+2.31 [+1.88,+2.80] worse** |
| rt̂ p90 | **+9.17 [+8.71,+9.68] worse** | **+5.96 [+5.15,+6.49] worse** | **+7.25 [+6.80,+7.54] worse** | **+5.60 [+5.08,+5.96] worse** |
| con p90 | +36.6 [+25.0,+49.2] worse | +53.4 [+47.8,+62.2] worse | +36.7 [+24.5,+48.1] worse | +40.7 [+26.0,+45.7] worse |
| cr p90 | +17 [+16,+17] worse | +10 [+9,+11] worse | +13 [+13,+14] worse | +10 [+8,+11] worse |
| tll p50 | +845.6 [+597.9,+1417.9] worse | +761.9 [+554.0,+983.7] worse | +1062.9 [+531.2,+1475.7] worse | +1011.0 [+615.4,+1085.9] worse |
| ext p50 | −52.1 [−77.0, 0.00] | **−77.0 [−77.0,−21.5] impr** | degenerate (n=4) | degenerate (n=4) |
| ext p90 | 0.00 flat | 0.00 flat | degenerate | degenerate |

All path cells gate-eligible (n = 500/265, non-degenerate); P2 extent cells are degenerate at n = 4 and marked so. The rt̂ worsening is real and large — the detours are threaded through the same gutters other edges occupy, so scene crossings jump 2.4–3.4× (97→236, 123→309, 24→91, 39→134) and the per-path cr term follows (+10 to +17 at p90). Crossing **angles** improve everywhere (sharpShare 0.41→0.17 / 0.71→0.35; p10 angle up) — the new crossings are shallower — but under Ware's weights the count dominates the geometry. Purchase's bends-cheaper-than-crossings ordering does not rescue this: penetrating-only corner routing does not merely convert crossings into bends, it **creates** crossings that did not exist (each detour leg re-crosses bundles the chord passed under a box — the box was visually absorbing them; W7's "penetration" and the crossing counter were partially aliased).

## Honesty box

- **REPORT-only.** No gate asserted, no PASS minted; `strataEdgeRouting` defaults false on every surface (engine, dialog, URL `strataEdgeRouting`, session, share URL, replay). The normative M-H exact-zero prerequisite still needs the freeze-register wiring — this spike is evidence toward it, not a discharge of it.
- The KEY GATE CELL's "exact zero" holds for **routed-eligible** edges only; scene totals keep 36–142 residual penetrations, all on unroutable-cap fallback chords (attribution table above; the counts are per (edge, box), so 8–19 fallback edges account for all of it).
- rt̂'s cr term **does** see the routed polylines (per-segment kernels; see Methodology). The reported rt̂ worsening is therefore a genuine post-routing measurement, not a chord-model artifact.
- Flag-off inertness verified three ways: (i) unit tests (non-penetrating arrows keep the same object reference; skip-list for aggregated/non-TFD arrows), (ii) the unrouted arms of this battery carry zero bends and no routing meta, (iii) full W5/W7/W8/W8b regeneration on the post-W9 tree is byte-identical to the pre-W9 tree apart from `buildMs` wall-clock fields (the `repairTerraformEdgeBindings` seam change is conditioned on a customData marker only the router stamps).
- Determinism: P_R rebuild normalized summaries byte-identical on both presets; paired cells recompute-identical; `softFailures: []`.
- Wall-clock: routing adds ~0.9 s on P1-P (14.1→15.0 s, ~7%) and is in the noise elsewhere.
- All numbers in this document are from `W9_ROUTING_SPIKE_REPORT.json` (single run, seed 20260704).

## Bottom line

Penetrating-only corner routing **does what it promises locally and fails globally**: every edge it routes ends penetration-free (exact-zero on the KEY GATE CELL's routed class, best-case −72%/−78% scene totals with packedScoring), placement is untouched, and the flag-off path is byte-identical. But the cost side is decisive as measured: scene crossings jump 2.4–3.4×, rt̂ worsens at p50 **and** p90 on every arm (up to +9.2 s-equivalent at P1 p90), and path length grows ~+800–1100 px at the median — the detours trade an occlusion problem for a crossing problem. On style inconsistency: 41–72 of 69–145 TFD arrows (≈half) become bent while the rest stay straight — a visually split system that argues an all-edges (or channel-routed, Wybrow-style with nudging/separation) mode would be the honest next experiment rather than widening this one's eligibility; boundary ports (Han et al. 2024) or crossing-aware detour scoring (penalize created crossings in the candidate choice, not just added length) are the two cheapest levers this spike's data points at. Keep `strataEdgeRouting` default-off; owner adjudicates whether Package C proceeds toward channel routing or is closed on this evidence.
