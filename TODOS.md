# TODOS

## Deferred from X-axis network-simplex ranker (`pipelineColumnPacking:"shorten"`, 2026-06-24)

### TODO-NS-1: Cross-preset NS validation before any named-profile default

**What:** Before promoting `shorten` (or its `networkSimplexRank` half) to a named layout-profile default, run the rendered A/B (width, structural gates, crossings) on **≥3 presets beyond `staging-extended-localstack-v2`**.

**Why:** Network simplex optimizes edge **span**, not column **count** — on a different slack profile it could rebalance column widths unfavorably, and the `shorten` toggle is **global** (one depth floor for the whole cluster DAG). The proven win (width −8.4 %) is v2-specific; the isolated A/B already showed NS trades a small **crossings increase** for the width win (≈230 vs ≈198 on v2 with crossingMin on), so a different preset could shift that trade.

**How:** Parameterize the `shorten`-vs-`compact` A/B harness in `terraformLayoutCoreRcllThreading.test.ts` over a preset list; assert width-strictly-narrower + all structural gates 0 on each; record the crossings delta per preset (observation, not a gate).

**Depends on:** PR3 shipped (exact `computeNetworkSimplexDepths`). Ships OFF; promote on its own measurement only.

---

## Deferred from RCLL satellite scan optimization (2026-06-23)

### TODO-1: Semantic view satellite scan — same O(P×K×N) pattern at `terraformTopologyLayout.ts:288`

**What:** `terraformTopologyLayout.ts:288` calls `collectTopologySatelliteAddressesFromRegistry` directly on zone-anchored primaries — the same O(P×K×N) scan pattern fixed in RCLL by the batch function. Apply the batch pattern to this callsite after RCLL batch is proven.

**Why:** Once `buildAllSatellitePrimaryMappings` is stable and the equivalence test is green on the RCLL path, applying the same batch to the semantic view's satellite scan is low-risk and follows the same pattern.

**Pros:** Closes the last known O(P×K×N) scan in the non-RCLL topology pipeline. Reduces the semantic view's prep cost (currently the dominant cost is skeleton build ~20s, but satellite scan is still a measurable fraction).

**Cons:** Semantic view's dominant bottleneck is skeleton build (not this scan), so this won't move the headline number much. Don't prioritize over skeleton-build investigation.

**Context:** The semantic view has a separate `~22s` bottleneck profile from `staging-multi-state-expanded`. This scan is in `buildTerraformTopologyExcalidrawScene` (the non-RCLL path). The RCLL optimization (this branch) does NOT touch it. The caller is `filterTopologyAddressesExcludingPrimarySatellites` at `terraformTopologyLayout.ts:150`.

**Depends on:** RCLL batch function (T1-T2) shipped and equivalence test green.

---

### TODO-2: ~~Zone resolution O(N×Z) tail in `prep.resourceRects`~~ — RESOLVED, no longer applicable (2026-06-23)

**Resolution:** T1-T4 shipped and measured. `prep.resourceRects` dropped from ~1,402ms to ~10ms (median of 3 runs) — the satellite scan removed by T3 was effectively its _entire_ cost. The projected zone-resolution O(N×Z) residual this TODO anticipated did not materialize as a meaningful cost on `staging-extended-localstack-v2`. No further action needed here.

---

### TODO-3: ~~True O(K×N) batch for `prep.satelliteBundles` — requires plugin-level type indexing~~ — RESOLVED (2026-06-23)

**Resolution:** nodesByType index shipped and measured (T-1 consolidation + T0 infra + T1 IAM/ECS + T2 ALB/SG/S3/SQS + T3 EKS/APIGW/TGW/CloudWatch/Route). `prep.satelliteBundles` dropped from ~1,364ms to **~174ms** (−87%, median of 3 runs). Commits: T-1 `c7f3c4da7`, T0 `c301cc8f5`, T1 `a89ad68b8`, T2 `a30013f0f`, T3 `70ebb3cc9`. `pipeline.rcll.stage.placement` (~312ms) is now the dominant pipeline prep/RCLL span. See 2026-06-23 perf-log row for full details. Untouched (by design): `terraformTopologyDatastoreLinks.ts` (module-scope filter), `terraformTopologyKmsLinks.ts` (companions mode — see TODO-4), `terraformTopologyLambdaPermissionLinks.ts` (reverseRef mode), `terraformTopologyRouteLinks.ts` (plan-changes-based, no nodes scans).

---

### TODO-4: Consolidate `terraformTopologyKmsLinks.ts`'s `getResourceTypeFromPath` duplicate

**What:** Delete `terraformTopologyKmsLinks.ts:31`'s private copy of `getResourceTypeFromPath`, import the canonical exported `getTopologyResourceType` (`terraformTopologySatelliteEngine.ts`) instead.

**Why:** This is the 4th of 4 byte-identical duplicate copies of this function. TODO-3's implementation plan consolidates the other 3 (IAM, SG, CloudWatch — all otherwise touched by the `nodesByType` threading work) but explicitly leaves this one alone since KMS is companions-mode and not touched by that pass.

**Pros:** Zero-risk mechanical cleanup once TODO-3's T-1 consolidation commit proves the pattern is safe (same delete-and-reimport move, just on a 4th file).

**Cons:** `terraformTopologyKmsLinks.ts` isn't otherwise touched by anything else right now, so this is a standalone 1-file PR for a small DRY gain — low urgency.

**Context:** Surfaced during `/plan-eng-review` of TODO-3's implementation plan (2026-06-23).

**Depends on:** TODO-3's T-1 consolidation commit landing cleanly (establishes the pattern/precedent).

---

## Deferred from graph-layout-rag reranker/GraphRAG cancellation (2026-06-23)

### TODO-5: Consolidate rejected-technique memory entries for graph-layout-rag into one index

**What:** `graph-rag-contextual-rejected`, `graph-rag-rerank-retest-rejected` (now also covering reranker fine-tuning), and `graph-rag-graphrag-rejected` are three separate memory files that all restate a shared root cause — this corpus is BM25-dominant and resists dense/semantic/graph-shaped techniques. Consolidate into a single index page with one shared "why" section and per-technique specifics, rather than three-plus flat entries.

**Why:** Five-plus rejected-technique memory entries with overlapping rationale risk getting harder to navigate than one index page would be. Surfaced by an outside-voice review during `/plan-eng-review` of the cancellation writeup (2026-06-23).

**Pros:** One canonical place to read "why doesn't X work on this corpus," instead of needing to read three+ files to notice they all say the same thing about retrieval shape.

**Cons:** Consolidation work itself, and flattening loses some of each entry's independent searchability (a memory search for "contextual retrieval" currently surfaces exactly the right file; a consolidated index would surface the whole cluster).

**Context:** Three entries exist today: `graph-rag-contextual-rejected.md`, `graph-rag-rerank-retest-rejected.md`, `graph-rag-graphrag-rejected.md`. Not urgent at this count — worth doing if a 4th-5th technique gets rejected on this corpus in the future.

**Depends on:** Nothing blocking — can be done anytime.

---

## Deferred from curve-fix + edge-routing UI redesign (2026-07-22)

### TODO-6: Author a DESIGN.md for the import-dialog design system

**What:** Run `/design-consultation` over the Terraform import dialog UI and capture the result as a committed `DESIGN.md` — the tokens, component idioms, and layout conventions that the import-dialog SCSS already encodes but nowhere documents (segmented-control factory, `dependencyHint`/`couplingHint`, the help `<aside>`, the depth slider, spacing/color scales).

**Why:** Two design-sensitive reviews on 2026-07-22 each had to reverse-engineer these tokens and idioms straight out of `TerraformImportDialog.scss` before they could review or extend the UI. A written design system pays that reverse-engineering cost once; every future UI milestone (edge-routing controls, new strata toggles, layout-profile pickers) then reads the doc instead of re-deriving it from the stylesheet.

**Pros:** Compounds across every future import-dialog UI change — reviewers and implementers share one vocabulary. Makes design regressions visible (a new control that ignores the segmented-control factory or the hint idiom is now an obvious deviation, not an unknowable one). Cheap: `/design-consultation` generates most of it.

**Cons:** A design doc drifts from the code if not maintained; needs a light "update DESIGN.md" discipline when the SCSS changes. One-time authoring effort competing with feature work.

**Context:** The reverse-engineered surfaces were the segmented-control factory, `dependencyHint`/`couplingHint`, the help aside, and the depth slider — all defined only in `TerraformImportDialog.scss`. Surfaced by two 2026-07-22 reviews on the curve-fix / edge-routing UI work.

**Depends on:** Nothing.

---

### TODO-7: Router shared-anchor fix (wave-4) — reuse `computeTerraformChordAnchors` in the routers

**What:** Make `channelRoute` (and probably `edgeRouting`/`borderRoute`) derive and clip their polyline endpoints from `computeTerraformChordAnchors` (`terraformEdgeAnchors.ts`) — the same shared-anchor module M2 introduced for the style pass — instead of clipping against frame boxes while `repairTerraformEdgeBindings` validates against keyed body rects.

**Why:** The routers clip their polylines against leaf FRAME boxes, but repair validates endpoints against the keyed CARD body rects (the 48px gate). This is the exact rect-identity mismatch M2 fixed for the style pass, still live in the routers: repair flattens the routed polylines whose frame-clipped endpoints sit outside the body rect. M3 telemetry quantifies the signature — FULL mode curve+channelRoute: kept 38 / flattened 107 of 145 routed (`flattenedBy={channel:107}`); compact mode self-flattens 18. Reusing the shared anchors makes repair find the endpoints already on its recomputed anchors, so it keeps the routed polyline instead of straightening it.

**Pros:** Reuses an already-landed, byte-identity-frozen module — no new geometry math, same mechanism proven correct for the style pass. Turns the largest remaining flatten source (107 edges on the full-mode preset) into survivors. Named, quantified target from M3 telemetry, so the fix is measurable against a known baseline.

**Cons:** Touches three routers, each with its own waypoint topology (the channel router inserts intermediate rank transfers, not just endpoints) — the shared-anchor reuse is only guaranteed correct at the two terminal endpoints; interior waypoints still need their own audit. Risk of shifting crossing/pierce counts under the frozen per-metric ceilings.

**Context:** M2 landed `terraformEdgeAnchors.ts` (`computeTerraformChordAnchors`) and wired the style pass to it (145/145 curves survive repair). M3 added the kept/flattened telemetry that exposed the routers' residual flatten signature. Both on `perf-loop-exp` (curve-fix M1–M3, commits `53ff2df1b`/`465fa419b`/`1a724ceab`).

**Depends on:** M2's `terraformEdgeAnchors` module (landed).
