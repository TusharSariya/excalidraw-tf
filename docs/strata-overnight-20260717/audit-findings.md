# Strata Audit — Consolidated Report (overnight 2026-07-17)

15-agent audit of the strata layout engine, its measurement surfaces, and its test/docs hygiene. Inputs: `scratchpad/overnight-20260717/audit/deduped-findings.json` (110 raw findings → 98 after dedup: 1 P0, 21 P1, 50 P2, 26 P3) plus a dual-verifier pass (Fable direct-read + Codex gpt-5.6-sol, read-only) over the full P0/P1 set (22 findings).

Verification outcome: **14 VERIFIED (1 P0 + 13 P1), 7 DISPUTED, 1 REFUTED.**

---

## 1. Executive summary

The audit's headline is not a layout-quality bug — it is that **the instruments used to measure layout quality are the least trustworthy part of the system.** Four independent verified P0/P1 findings converge on the same conclusion: any strata number produced through the dev proof API, or compared against the frozen harness baselines, is currently suspect.

**Theme 1 — the proof/measurement surface is broken (Track A, highest priority).** The P0 (S5-1): `/api/terraform-layout` silently ignores ~16 strata engine params that the demo URL, dialog, and core all accept — a "proof" curl with any of them returns baseline geometry with HTTP 200 and no error, so a dropped toggle masquerades as a null result. Compounding it: a bare API strata call runs a configuration **no user surface produces** (K=0 sweeps, A7 off, privateApiRegional off, vs the app's K=4 + A7 + privateApi ON — S5-3); `strataBandDepth` is unexposed so three of six `strataDeBand` rungs are permanently engine-suppressed with no visible signal (S5-4); the strata `pipelinePrivateApiRegional` default-ON is hardcoded at two sites outside the anti-drift defaults module while the frozen measurement config pins it OFF — every harness/battery number is measured on a scene no default app import produces (S3-1); and nothing in CI pins the DEFAULT strata geometry against a stored baseline — an engine change reshaping every default layout passes green (S2-1).

**Theme 2 — objective incoherence at the adoption seams (Track A).** Verified: relative-mode fractional epsilon is inherited RAW as the absolute edge-cross hard cap (effectively 0, vetoing exactly the trades the eps-band allows; 3× corroborated — S1-1); the post-A7 never-worse guard re-ranks with a crossings-first comparator the transitiveAdopt descent explicitly abandoned (O4-3); the descent selects winners on pre-A7 straight-chord geometry the rendered scene never shows, with only a binary scored-vs-legacy fallback (O4-5); and the default packed-hull ordering gate scores sweeps with banded-stack chord geometry the code itself documents as blind to packed-skyline crossings (C2-1). A further four objective-architecture findings (converge comparator, gate non-transitivity default, LP-vs-heuristic A7, bootstrap multiplicity) survived Fable verification but were disputed by Codex — mechanisms real, consequences contested.

**Theme 3 — redundant recompute dominates packed scoring and the ancillary allocator (Track B).** Three verified memoization wins: the greedy slack-allocator re-measures every host's band height + cubic breakpoint enumeration on every iteration though only one host changed (S4-1, 2× corroborated); candidate sequences are regenerated from scratch on every descent trial for every packed hull despite invariant inputs (O3-1); the leaf→ancestor-hull Map is rebuilt on every single score call though it is a pure function of the hull root (O3-2).

**Theme 4 — docs and test-lane hygiene (Track C).** The self-describing `?describe=1` catalog still calls the shipped v3.2 strata engine an "S0a scaffold — passthrough" and promises a `strataPassthrough:true` echo no code emits (S5-2). At least 8-13 report-only multi-arm research batteries — each doing full engine rebuilds on real presets — run in the DEFAULT suite and `yarn test:fast` (S2-3).

**Verification calibration:** the disputed set is mostly "mechanism confirmed, consequence contested" (see §3); the one refutation (S2-4) was a threading-coverage census that overcounted untested options.

---

## 2. VERIFIED P0/P1 findings

### Track A — measurement integrity / objective coherence

| ID | File:lines | Claim | Suggested fix |
| --- | --- | --- | --- |
| **S5-1 (P0)** | `excalidraw-app/dev/terraformImportPresetDevPlugin.mjs:41-94,690-728` | `/api/terraform-layout` silently ignores ~16 strata engine params the demo URL, UI, and core all accept — a proof curl with any of them returns baseline geometry with no error, corrupting toggle-proof measurements. | Extend the three param tables to the full strata option set (mirror `terraformDemoUrlParams.ts`), or 400 on unknown query params so a dropped toggle can never masquerade as a null result. |
| **C2-1** | `packages/excalidraw/components/terraformPipelineStrataOrdering.ts:264-318,427-435,746-760` | Default packed-hull ordering accepts/rejects barycenter sweeps via banded-stack chord geometry the code itself documents as blind to packed-skyline crossings — it can reject genuine improvements or accept regressions. | Use actual packed-skyline trial placement + leaf-level crossing scoring for packed candidates, or make the whole-layout packed scorer the sole packed ordering path. |
| **S2-1** | `packages/excalidraw/components/terraformPipelineStrataGateRegister.test.ts:1-19` (+FreezeBaselines:47, LayoutSnapshot: no strata) | Nothing in CI pins DEFAULT strata geometry against a stored baseline; every "byte-identity" assertion is intra-run only (OFF==absent, not OFF==yesterday). An unintended engine reshape passes CI green. | Always-on smoke: build the default strata arm on the smallest preset, fingerprint via `terraformStrataGeometryHash.ts` (already written, currently dead — S2-2), compare to a committed hash with a regen instruction in the failure message. |
| **S5-4** | `excalidraw-app/dev/terraformImportPresetDevPlugin.mjs:81-85,124-129` | API exposes the full `strataDeBand` ladder but NOT `strataBandDepth`, so at the fixed default cut ("account") the region/account/provider rungs are ALWAYS engine-suppressed — 3 of 6 documented enum values can never take effect via the API, and the response never surfaces the suppression. | Add `strataBandDepth` to `LAYOUT_ENUM_PARAMS`; forward `meta.strataToggleSuppressions` (+ a `strataDeBandLevel` echo) into the proof payload. |
| **S3-1** | `packages/excalidraw/components/terraformPresetImport.ts:206-216` (+useTerraformImportDialog:231-232, strataDefaults, readability harness:115) | `pipelinePrivateApiRegional` strata default-ON is hardcoded at TWO sites outside the anti-drift defaults module, and the frozen measurement config pins it OFF — every harness/battery number measures a layout no default app import produces. | Add the default to `TERRAFORM_STRATA_LAYOUT_DEFAULTS`, resolve in `resolveStrataDemoOptions`, drop both literals; explicitly decide + document whether to re-freeze the measurement config at the app default. |
| **S5-3** | `excalidraw-app/dev/terraformImportPresetDevPlugin.mjs:685-728` | Bare `/api/terraform-layout?layoutMode=strata` runs a configuration NO user surface produces (K=0, A7 off, privateApiRegional off) vs dialog and `/demo?view=strata` (K=4 + A7 + privateApi ON); the catalog never mentions this, so API-based quality measurements silently benchmark the wrong arm. | Apply `resolveStrataDemoOptions`-equivalent defaults on the API path, or add an explicit catalog note that the API runs the raw engine-default arm. |
| **S1-1** | `packages/excalidraw/components/terraformPipelineStrataPackedScoring.ts:867-868,915-917,307,727` + `terraformPipelineStrata.ts:640-641` | Relative-mode fractional epsilon is inherited RAW as the absolute edge-cross hard cap (never `resolveStrataPackedEpsilonDelta`) — with sift + eps in (0,1) and cap blank, the hard cap is effectively 0, vetoing exactly the trades the eps-band allows; `transitiveCap` also forks semantics on sift on/off. Corroborated by S3-2 and O4-4 (epsilon overloaded across 3 roles / 4 denominators). | Route the inherited cap through `resolveStrataPackedEpsilonDelta` against baseline crossings at all three sites (or resolve once and thread the integer delta); keep explicit `strataEdgeCrossCap` absolute. |
| **O4-3** | `packages/excalidraw/components/terraformPipelineStrataPackedScoring.ts:700-766` | The post-A7 never-worse guard uses a DIFFERENT comparator than the descent: with transitiveAdopt on but siftRelocate off, `chooseStrataRefinedPlacement` re-ranks scored-vs-legacy crossings-first (`strataPackedScoreLess`), undoing the transitive weightedC-first order the descent just established. | Thread the active comparator into the guard (pass the transitive key/weights when transitiveAdopt is on) so descent selection and post-A7 fallback use ONE order. |
| **O4-5** | `packages/excalidraw/components/terraformPipelineStrataPackedScoring.ts:579-673,700-766` | The descent selects the winning snapshot purely on PRE-A7 straight-chord geometry while the rendered scene runs A7 + edge routing; the only correction is a binary scored-vs-legacy fallback that cannot re-rank intermediate snapshots — a snapshot that wins pre-A7 but loses post-A7 is picked and unrecoverable. The header itself records the proxy diverging on the owner's SQS case. | Score the top-M snapshots on post-A7 geometry before final selection, or prove chord-order == rendered-order under A7 and gate on it; at minimum extend the guard to the full finalist set. |

### Track B — redundant recompute / complexity

| ID | File:lines | Claim | Suggested fix |
| --- | --- | --- | --- |
| **S4-1** | `packages/excalidraw/components/terraformPipelineStrataAncillary.ts:1645-1708,1656,1474,1451-1481` | Greedy slack-allocator recomputes `measureBandHeight` + `bandWidthBreakpoints` for EVERY host on EVERY iteration though each iteration changes exactly one host's wrap width; breakpoint enumeration is cubic in cards; baseline height measured twice per host per iteration. (Corroborated by C3-8.) | Memoize per (hostId, wrapWidth): cache breakpoint lists and measured heights; recompute only the winner's entries after acceptance; pass the already-measured `currentBandHeight` into `bandWidthBreakpoints`. |
| **O3-1** | `packages/excalidraw/components/terraformPipelineStrataPlacement.ts:324-329,190-202` (+PackedScoring:1023-1029) | Candidate sequences (sweep + sift enumeration) are regenerated from scratch on EVERY descent trial for EVERY packed hull with a non-legacy selection, though `orderParams` are invariant across the whole descent — the dominant redundant recompute in packed scoring. | Memoize the candidate-sequence list per `hull.id` for the lifetime of one `placeStrataHullsPackedScored` call; compute when `candidateCounts` is gathered (which already generates it). Memo must NOT outlive a descent. |
| **O3-2** | `packages/excalidraw/components/terraformPipelineStrataPackedScoring.ts:640` | `scoreStrataPlacementGeometry` rebuilds the leaf→ancestor-hull-ids Map on every single score call, but it is a pure function of `model.hullRoot` and invariant across all ~2·H·K trials of a descent. | Compute `leafAncestorHullIds(model.hullRoot)` ONCE in `placeStrataHullsPackedScored`, thread as an optional precomputed arg (fallback recompute preserves standalone/test callers). |

### Track C — docs / test-lane hygiene

| ID | File:lines | Claim | Suggested fix |
| --- | --- | --- | --- |
| **S5-2** | `excalidraw-app/dev/terraformImportPresetDevPlugin.mjs:108-113,143-155,534-539` | `?describe=1` still describes `layoutMode=strata` as "S0a scaffold — passthrough to the rcll v2 substrate" and every strata param as "scaffold-only until the strata engine lands" — the engine landed (v3.2 adopted) and dispatches the real builder; the promised `strataPassthrough:true` echo is emitted by NO source file. The self-describing API actively misinforms agents. | Rewrite the layoutMode note and the strata boolean/int descriptions to current reality (engine live, K=4+A7 view default); delete the dead `strataPassthrough` field or set it from actual meta. |
| **S2-3** | `packages/excalidraw/test-fixtures/slowTestPatterns.ts:1-22` (+vitest.config.mts:69-78) | At least 8 (Fable count: 13) self-described "report-emitting; NEVER asserts gate/metric values" research batteries — each doing multi-arm FULL engine rebuilds on real presets — run in the DEFAULT suite AND `yarn test:fast`; none is in `SLOW_TEST_PATTERNS`, none uses `*.probe.test.*`. Minutes of wall-clock for near-zero regression protection. | Bulk move the Battery/Factorial/RepairedStats/EpsilonFrontier/JointNsProbe/ChurnTriple/Spike files to `SLOW_TEST_PATTERNS` (or rename `.probe.test.ts`, or env-gate like `terraformStrataPrefPairs.test.ts` — the honest template already exists in-tree). |

---

## 3. DISPUTED P0/P1 findings (both sides)

These split the two verifiers. Pattern across the set: **Fable confirms the cited code mechanics line-by-line; Codex contests the claimed consequence, default reachability, or severity.** None should be silently dropped or silently acted on — each needs a small adjudication step (noted per row) before a track consumes it.

| ID | Claim (short) | Fable (confirms) | Codex (contests) | Adjudication needed |
| --- | --- | --- | --- | --- |
| **C3-1** (B) | Cyclic graphs use raw edge sequence numbers as column depths; global-column construction allocates/rescans every integer depth to the max — work/whitespace proportional to sequence magnitude, not graph size. | Code mechanics verified: `computeDepths:612-614` clamps cycle-unresolved clusters to raw `firstSeq`, written straight into `cluster.depth`; `maxDepth:1727` feeds the per-depth `columnWidths` scan. | Codex traced the sequence producer (`terraformDeclaredDataFlow.ts`) — the practical magnitude of sequence values (and hence real-world exploitability of the quadratic-in-magnitude behavior) is what's contested, not the code path. | Measure `firstSeq` value distribution on the real presets; if bounded small, downgrade to P2 hygiene (dense remap is still a cheap safe fix). |
| **O5-4** (A) | Scene-reader set copy-pasted across THREE metric modules and already drifting (`policyOf` only in SliceMetrics) — under non-default `strataBandDepth` the metric families key hulls differently, making numbers silently non-comparable. | Reader set verified byte-identical (modulo JSDoc) across PierceMetrics/SliceMetrics/ChurnMetrics; `policyOf` divergence real. | Duplication real and header-acknowledged, but ranges are not literally byte-for-byte, and — key point — `policyOf` does not alter cluster keying, so the claimed non-comparability under bandDepth does not follow. | Extraction into a shared `terraformPipelineStrataSceneReaders.ts` is a safe mechanical refactor either way; only the "measurement-corruption" severity is contested. Do the extraction; drop the corruption claim unless demonstrated. |
| **O4-2** (C) | transitiveAdopt is the principled adoption rule and packedConverge a band-aid; they should merge, with epsilon demoted to a feasibility cap — yet the SHIPPED default is the documented-non-transitive gate. | Header quotes verified (gates "neither antisymmetric nor transitive", documented 2-cycle); three-way `decideAdoption` branching real, all default-off. | REFUTED the sting: `TERRAFORM_STRATA_LAYOUT_DEFAULTS` disables packedScoring entirely, so by default NO adoption relation runs — "the known-broken relation is what users get" is false. The consolidation argument survives as design opinion, not a shipped defect. | Treat as a Track C design proposal (option-surface consolidation), not a default-path bug. |
| **O3-3** (B) | Each descent trial re-lays out the ENTIRE hull tree though a trial mutates one hull's index; `subtreeCache` allocated fresh per call; incremental memo would take per-trial O(N·sweeps) → O(depth). | All cited lines verified: single-entry `trial.set`, full post-order `layoutHull`, fresh `new Map` per call. | Confirmed the full relayout and fresh cache are real, but disputed the claim beyond that (the safe-memo formulation / payoff sizing — ancestor repack depends transitively on child box dims, so the memo key discipline is the risk). | Profile first: if O3-1 + O3-2 (both verified, much simpler) close most of the gap, this large refactor may not pay. Keep as a Track B stretch item behind a measured baseline. |
| **O2-1** (A) | The A7 Y-objective (min Σ\|yCenter Δ\| under order/containment/gap constraints) is an exactly-solvable convex LP (Gansner '93 network-simplex, Brandes-Köpf) but is solved by a fixed 4-sweep median+PAV strict-descent heuristic with no convergence/optimality guarantee. | Header L12-15 states exactly that objective; fixed `SWEEP_DIRECTIONS` of 4 and strict-decrease revert verified; NS already in-repo. | Codex contests exact-equivalence of the literature slot to A7's actual constraint set / that the heuristic "provably stalls" in ways that matter on shipped presets. | Cheap empirical test: iterate sweeps to convergence on the presets and diff the objective; if 4 sweeps is already at fixpoint, the finding is theoretical only. Aligns with the prior audit's P1 "targeted X-pass / rendered-rescore" priorities — don't blanket-replace. |
| **O4-1** (A) | packedConverge's best-seen comparator (`strataPackedScoreLess`, crossings-first) is incoherent with epsilon adoption: with eps>0 + converge on, every epsilon-band tradeoff can be silently discarded, collapsing toward the legacy baseline; header only reasons about eps=0. | All cited lines verified: `considerBestSeen` records only under crossings-first lex; bestSeen seeded with baseline; return takes bestSeen when `seenLess`. | REFUTED: Codex concluded the collapse mechanism does not fire as claimed on the actual return path (the adopted eps-band result is not actually displaced in the scenario asserted). | One targeted unit test (eps>0 + converge on, adopted higher-crossings/lower-pen snapshot) settles it definitively. Note memory: `strataPackedConverge` shipped default-off as best-seen adoption — this test is cheap insurance either way. |
| **O4-6** (A) | Gate register runs an independent two-sided 95% percentile-bootstrap CI per cell with NO multiple-comparison control — family-wise false-PASS inflates well above 5% across many cells. | Core mechanics hold: `recomputeCell` mints PASS solely from `ci.hi<0` per-cell; no Bonferroni/BH/alpha accounting anywhere. | REFUTED the direction: the family-wise false-PASS mechanism as asserted does not hold (register semantics/conjunctive use of cells means multiplicity does not inflate PASS the way the claim models). | Decide what a "green register" is contractually claimed to mean; if any single-cell PASS is ever consumed alone, the correction matters; if only all-cells-green is consumed, multiplicity is conservative. Document the answer in the register header. |

---

## 4. REFUTED

| ID | Claim | What the auditor got wrong |
| --- | --- | --- |
| **S2-4** (was P1, Track A) | Of the 23 strata\* options threaded through `terraformLayoutCore.ts`, 5 have NO CI test asserting they survive the sceneContext-literal silent-drop seam: strataTransitiveAdopt, strataAncillaryAllocator, strataJointNsRank, strataCrossWeightEdge, strataCrossWeightPenetration (+non-default strataEdgeCrossCap). | The census overcounted. Codex read the full threading test file (all `it()` blocks), cross-checked option-name coverage against the vitest config, and found the 5-option "no CI test" claim does not survive as stated — coverage exists that the census missed. Fable's own pass already softened it to "4 of 5 check out" only under narrow readings (probe-file exclusions, mocked-worker seams) — i.e. the residue is thinner and different from the claim as written. The underlying trap is real and already documented (memory: "RCLL option threading boundary"), but this specific gap list is wrong; any Track A test work here should re-derive the gap list from scratch rather than consume this finding. |

---

## 5. P2/P3 appendix (grouped by dimension)

Not verified — auditor-reported, dedup-ranked. Use as a backlog seed; re-verify before acting.

### Performance & complexity (Track B)

| ID | Sev | Location | Claim |
| --- | --- | --- | --- |
| C2-9 (+O1-6) | P2 | StrataCycleRepair.ts:87-106 | Full edge-array rescan per nontrivial SCC — quadratic with many disjoint cycles. (O1-6 otherwise certifies the ELS93+Tarjan implementation as correct/deterministic.) |
| C2-10 | P2 | StrataRankSeparate.ts:169-237 | Constraint collection scans every effective edge at every hull — O(H·E). |
| S4-4 | P2 | LayoutShared.ts:392-407 | longestPath Kahn drain: `ready.shift()` + full re-sort per insertion — O(V²logV), paid per hull in the rankSeparate path. |
| C2-7 | P2 | StrataOrdering.ts:264-318,743-795 | Quadratic crossing scorer invoked repeatedly across sweeps/tie candidates — dense-hull import hotspot. |
| C2-8 | P2 | StrataOrdering.ts:498-654 | Uncapped solo/group sift loops materialize O(n²) full-length sequences — cubic copy/storage. |
| C3-3 | P2 | LayoutShared.ts:1076-1109 | NS balancing recomputes full rank-population map per eligible node + scans every integer in the rank window — O(V²) + rank-span dependence. |
| S4-2 | P2 | StrataAncillary.ts:1643+ | Every greedy acceptance re-runs FULL injectStrataAncillaryBands with real skeleton materialization for ALL hosts, K+2 times per build — contradicts the module's own measure-only rationale. |
| S4-3 | P2 | StrataAncillary.ts:1760-1800 | Final accepted wrap map injected + validated THREE times back-to-back with identical inputs. |
| S4-5 | P2 | CollisionDiagnostics.ts:420-428 | Crossing/angle kernel is brute-force O(E²·segs²) with no bbox prefilter — ~500k segmentsCross calls per diagnose; multiplies across every measurement harness. |
| O3-4 | P2 | StrataPackedScoring.ts:610-638 | Crossing count is unindexed O(E²) all-pairs, recomputed in full per trial with no incremental delta. |
| O3-5 | P2 | StrataPackedScoring.ts:870-909 | siftRelocate scoreCache dedups the CHEAP rescore but its fingerprint is computed AFTER the expensive relayout and can cost as much as it saves. |
| S4-7 | P3 | LayoutShared.ts:1213-1229 | computeGlobalColumnX filters the entire cluster array once per depth column — O(maxDepth·N). |
| S4-8 | P3 | LayoutShared.ts:1434-1438,647-650 | Two accumulate-by-spread patterns rebuild whole per-key arrays per append — O(n²) allocation churn. |
| S4-6 | P3 | CollisionDiagnostics.ts:273-304 | classifyFramePair recomputes hulls/paths fresh for every O(F²) pair. |
| S4-9 | P3 | StrataEdgeRouting.ts:354-464 | Per-edge full-obstacle rescan for `foreign` arrays; borderRoute repeats the same scan independently. |
| S4-10 | P3 | StrataPlacement.ts:96-118 | dropY fixed-point rescans entire skyline until quiescent — O(children³) worst per hull re-settle, times hosts×depth×(K+2) under the allocator. |
| S4-11 | P3 | StrataAncillary.ts:862,932,1606 | buildParentIndex + full strip re-sort run ~2K+5 times per build on inputs that never change. |
| O3-6 | P3 | StrataPackedScoring.ts:1007-1088 | (Budgeting artifact) Exact trial-count model: O(H·(K+1)) full relayouts, → O(H·u²) under siftRelocate. |

### Algorithm / paper fidelity

| ID | Sev | Location | Claim |
| --- | --- | --- | --- |
| C2-2 | P2 | StrataOrdering.ts:427-436,750-760 | Packed barycenter search can't traverse crossing-neutral intermediates — misses later-sweep wins (the code comments say so). |
| C2-5 | P2 | StrataOrdering.ts:392-423,764-799 | Banded greedy seed can reverse relative order of disconnected units as a side effect. |
| O1-1 | P2 | LayoutShared.ts:960-1050 | NS cut values recomputed from scratch every pivot vs Gansner's O(V+E) init + incremental update — "exact Gansner TSE93" claim is a fidelity+perf deviation. |
| O1-2 | P2 | LayoutShared.ts:1002-1050 | "Bland's rule → anti-cycling" comment misattributes: only leaving edge is smallest-index; real guard is the maxPivots ceiling which silently abandons NS to the floor. |
| O1-4 | P2 | StrataRankSeparate.ts:163-231 | Not the Sander base-node construction it claims — forces sibling units into disjoint rank ranges via manufactured all-to-all precedence (separation on the layering axis). |
| O1-5 | P2 | StrataRankSeparate.ts:287-302 | Augmented-cycle fallback is wholesale/global: one cycle discards ALL sibling separation everywhere. |
| O2-2 | P2 | StrataOrdering.ts:321-390 | Barycenter (mean) in the crossing-critical slot where dot deliberately chose median (wmedian); sibling CoordRefine uses l1Median — internal inconsistency. |
| O2-3 | P2 | StrataPlacement.ts:96-118,341-349 | dropY greedy no-backfill skyline used AS coordinate assignment — no height bound; Y decoupled from edge length/crossings, which is why A7 must exist. |
| O2-4 | P2 | StrataTranspose.ts:83-89,398-421 | Transpose departs from dot: full O(E²) whole-layout score per candidate swap (pass-capped at 4, less converged) and won't accept crossing-neutral swaps the paper relies on. |
| O2-5 | P3 | StrataCoordRefine.ts:122-203 | PAV pools by weighted MEAN (L2) for an L1 objective (correct pool = weighted median); box clamp applied after, not jointly — suppresses improving moves. |
| O2-6 | P3 | StrataOrdering.ts:344-371 | Same-layer neighbours folded into the barycenter mean — hybrid objective with no literature crossing-minimization guarantee. |
| O2-7 | P3 | StrataOrdering.ts:459-465,688-696 | Ordering seeded from content-key sort, not a crossing-aware init (dot's init_order); no crossing-aware seed in the candidate set. |
| C2-6 | P3 | StrataCycleRepair.ts:12-18,91-110 | Cycle-repair not byte-deterministic under edge-input permutation despite advertising it. |

### Option threading & surface consistency

| ID | Sev | Location | Claim |
| --- | --- | --- | --- |
| S3-3 | P2 | StrataStrata.ts:401-423 vs 474-505 | Scene-meta flag echo gates drifted from engineOptions gates: blockClamp-only runs consume eps/penW/crossW/edgeCap but meta doesn't echo them. |
| S3-4 | P2 | SceneApply.ts:407-447 | strataAncillaryAllocator exists only on the direct-engine surface — app path can never disable it, share URL can never carry it. |
| S3-5 | P2 | Strata.ts:425-431 vs 311-389 | Inert-combination handling inconsistent: some pairs get suppression+echo, five other inert combos import silently with the flag echoed as active. |
| S3-6 | P2 | LayoutCore.ts:1234-1261 (+5 files) | The "omit-at-default, truthy-string trap" conditional-spread dance for bandDepth/deBandLevel hand-replicated at SIX threading sites — the definitive Track-C hotspot. |
| S5-5 | P2 | DevPlugin.mjs:70,156-164 | API columnPacking enum omits 'shorten' (400s a value every other surface accepts); catalog responseShape omits ~5 real payload fields. |
| S5-14 | P2 | DevPlugin.mjs:441-584 | Proof payload echoes ONLY rcll-era flags — even accepted strata params have no echo, so callers can't verify application from the response. |
| S5-6 | P2 | DemoUrlParams.ts:448,802 | Share-URL param is abbreviated `strataRankSep` with no full-name alias — `strataRankSeparate=1` silently ignored. |
| C3-10 | P2 | LayoutShared.ts:112,1301-1319 | PIPELINE_CLUSTER_GAP_Y doubles as the ancillary horizontal gap and an allocator width input — a vertical constant silently changes horizontal wrapping and slack decisions. |
| C3-4 | P2 | LayoutShared.ts:392-406,807-812 | Load-bearing tie-breaks use bare localeCompare (ICU-dependent) in shared layering/NS despite the strata file naming that exact hazard — cross-locale nondeterminism vs byte-identical claims. |
| C3-5 | P2 | StrataAncillary.ts:1474-1798 | Multi-widened hosts: rowSavings recomputed vs current wrap but stored as total baseline savings — metadata under-reports and fallback removal can discard the wrong host. |
| C3-6 | P2 | StrataAncillary.ts:1577-1580,1726-1739 | One invalid best slack candidate terminates the entire greedy allocator — lower-ranked valid candidates never attempted. |
| C3-7 | P2 | StrataAncillary.ts:1770-1790 | buildValidatedStrataAncillaryInsertion bypasses ALL classification at zero allocations — "validated" baseline can carry containment/structural failures. |
| C3-11 | P2 | StrataAncillary.ts:143-161+ | relocatedStripCount computed before host suppression — strips in a dropped band reported as relocated. |
| C3-9 | P2 | StrataAncillary.ts:727-728,1151-1155 | Title-reserve invariant has two sources in one file (strataTitleReserve() vs three frame pads) — can disagree. |
| C2-3 | P2 | StrataRank.ts:124-153 | Rank-separation telemetry reports `no-pairs` when pairs exist but are floor-satisfied. |
| O1-3 | P2 | StrataRank.ts:162-169 | networkSimplexApplied=true even when NS internally bailed to the identity floor — corrupts "did NS help" attribution. |
| S1-3 | P2 | Strata.ts:284-285,718-836 | Ancillary isolation contract unsound: two concrete escape paths where band-induced failures degrade the whole scene to v2 despite the "never degrades" header. |
| S1-4 | P2 | Strata.ts:605,661-699 | Stage attribution stale: three post-A7 movers execute under stage 'a7' — failures blamed on CoordRefine even when it never ran. |
| S3-7/S3-8/S3-9 | P3 | DemoUrlParams.ts | bandDepth the only case-sensitive enum (hard-fails whole URL); stale "no dialog control" doc for packedConverge; strataSweeps unbounded on the URL surface vs {0,4} UI. |
| S3-10 | P3 | strataDefaults.ts | (Positive artifact) 24-option disposition table: threading is correct end-to-end except the itemized S3-x exceptions. |
| S1-5/S1-6/S1-7 | P3 | PackedScoring/Finalize/Strata | NaN/negative edgeCrossCap flips two consumers in opposite directions; fnv1a32 ASCII claim false for '→' edge ids (cross-language parity hazard); A2 attribution enforced only by string-prefix convention. |
| S5-9 | P3 | CanvasShareUrl.ts:72,90-91 | Session absent-field fallbacks are the OPPOSITE of strata view defaults — latent geometry-flipping share URLs. |

### Test quality & coverage honesty

| ID | Sev | Location | Claim |
| --- | --- | --- | --- |
| S2-2 | P2 | strataGeometryHash.ts:1-10 | The canonical geometry-fingerprint module has ZERO importers — the regression suite it names was never built; dead code advertising coverage. (Direct enabler for verified S2-1's fix.) |
| S2-5 | P2 | StrataBlockClamp.test.ts | The load-bearing R2 structural gate never REJECTS in any test — the historically-buggy branch (separation-invariant incident) has zero coverage. |
| S2-6 | P2 | StrataTransitiveAdopt.test.ts | All placement-integration tests run on the X-disjoint COL_GAP=600 fixture — ε-adoption under packed-skyline STACKING (the regime the toggle was built for) never unit-tested. |
| S2-7 | P2 | vitest.config.mts:72-76 | The entire 7-file probe layer is excluded from every CI lane — the only tests of ancillary byte-identity, deband provenance, row-order reconstruction will silently rot. |
| S2-8 | P3 | StrataAncillary.test.ts | (Positive/calibration) Several feared-vacuous areas have real coverage — do not re-flag. |

### Modularity & code quality

| ID | Sev | Location | Claim |
| --- | --- | --- | --- |
| O5-1 | P2 | Strata.ts:43-520 | Entry file: 29 optional keys each restated 3-4× (type JSDoc, destructure, flagMeta echo, engineOptions spread) — 4 disjoint lockstep edit sites per option. |
| O5-2 | P2 | Strata.ts:304-389 | Cross-toggle mutual-exclusions hand-coded inline, duplicating the existing declarative terraformPipelineToggleGuards.ts down to a copy-pasted reason string. |
| O5-7 | P2 | LayoutShared.ts | 1750-LOC, 46-export god-module spanning 5 unrelated concerns — the breadth is why the SDEC-34 NaN cycle is pervasive. |
| O5-8 | P2 | StrataAncillary.ts | 1801-LOC file carries pure geometry helpers extractable without weakening the injector↔allocator boundary its eslint-disable protects. |
| O5-9 | P2 | StrataRankSeparate.ts:14-40 | computeStrataSeparatedFloor is a hand-port of v1's driver — nothing enforces the asserted "identical to v1" contract; drivers can silently diverge. |
| O4-7 | P2 | PackedScoring.ts:255-264 | Transitive/relocate objective makes penetrations 1:1 fungible with crossings as the LEAD key term — an unargued exchange rate (mirror-image of the "infinite exchange rate" the header criticizes). |
| O4-8 | P3 | BootstrapCi.ts:38-53 | Two live p90 gating floors disagree by one (30 vs 31); only the 31 is on the register path. |
| O5-6/O5-10/O5-11 | P3 | Separation/Model/PathMetrics | Self-contradicting header about the gap pin-test; third parallel hull-tree builder; SDEC-34 NaN discipline enforced across ~15 files by comment only — no lint rule. |

### Docs / help-text drift (Track C)

| ID | Sev | Location | Claim |
| --- | --- | --- | --- |
| S5-8 | P2 | docs/terraform-pipeline-import-agent-guide.md | Contradicts current surfaces on four counts (view count, toggle count, compact exposure, pipelineVariant values). |
| S5-7 | P2 | TerraformImportPipelineSettings.tsx:632-648 | Crossing-weight help names a "Pull leaf sinks toward source" control that doesn't exist and omits Transpose, a live weights consumer. |
| S5-10 | P3 | TerraformStrataSettingsHeight.tsx:463-469 | "Measured to conflict (W8)" note is one battery stale — SDEC-64/W10b superseded it. |
| S5-11 | P3 | TerraformStrataSettings.tsx:622-623 | Stale "Future: OD-15 de-band toggle lands here" comment — it shipped. |

---

## 6. Per-track injection lists (VERIFIED findings each track must consume)

### Track A — measurement integrity & objective coherence

1. **S5-1 (P0)** — extend `/api/terraform-layout` param tables to the full strata option set (or 400 unknown params); no toggle may silently no-op.
2. **S5-3** — align (or explicitly catalog) the API's bare-strata arm vs the app's K=4+A7+privateApi-ON arm.
3. **S5-4** — expose `strataBandDepth`; forward `strataToggleSuppressions` into the proof payload.
4. **S3-1** — move the strata privateApiRegional default into `TERRAFORM_STRATA_LAYOUT_DEFAULTS`; reconcile the frozen measurement config with the app default.
5. **S2-1** — add an always-on default-geometry fingerprint smoke (use the dead `terraformStrataGeometryHash.ts`, per S2-2).
6. **S1-1** — resolve inherited epsilon via `resolveStrataPackedEpsilonDelta` at all three edge-cross-cap sites; unify transitiveCap semantics across sift arms.
7. **O4-3** — thread the active (transitive) comparator into the post-A7 never-worse guard.
8. **O4-5** — rescore top-M finalists on post-A7 geometry (or prove chord-order preservation and gate on it).
9. **C2-1** — replace the banded-stack chord acceptance gate for packed hulls with skyline-aware scoring (or route packed ordering solely through the whole-layout scorer).

### Track B — performance

1. **S4-1** — memoize the ancillary slack-allocator per (hostId, wrapWidth); recompute only the winner after acceptance; stop double-measuring the baseline height.
2. **O3-1** — memoize packed candidate-sequence lists per hull.id within a descent (compute once at candidateCounts time).
3. **O3-2** — hoist `leafAncestorHullIds(model.hullRoot)` out of the per-trial score path to descent scope. (Stretch, disputed — measure first: O3-3 incremental subtree relayout; C3-1 dense depth remap.)

### Track C — docs, hygiene, option-surface

1. **S5-2** — rewrite the `?describe=1` catalog to post-v3.2 reality (engine live, K=4+A7 default); delete or wire the dead `strataPassthrough` echo.
2. **S2-3** — move the report-only research batteries out of the default and fast test lanes (SLOW_TEST_PATTERNS / `.probe.test.ts` / env-gate). (Design proposal, disputed: O4-2 adoption-rule consolidation — treat as an option-surface RFC, not a defect fix.)

---

_Report generated 2026-07-17 from `audit/deduped-findings.json` (98 findings post-dedup) + the dual-verifier (Fable + Codex gpt-5.6-sol) P0/P1 pass. P2/P3 entries are unverified auditor claims._
