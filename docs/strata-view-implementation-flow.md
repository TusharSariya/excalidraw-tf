# Strata view — implementation flow specification

| Field | Value |
| --- | --- |
| Status | **Implementation companion (definitive build plan).** The specs stay normative — [`rcll-v2-spec-v2.md`](./rcll-v2-spec-v2.md) → [`rcll-v2-spec-v3.md`](./rcll-v2-spec-v3.md) → [`rcll-v2-spec-v3.1.md`](./rcll-v2-spec-v3.1.md) (later wins). This document says **how each piece is implemented**: per piece — input, algorithm (spec ref), output, target file, tests, work package, agent. On conflict with the specs, the specs win and this document is corrected. |
| View | **Strata** — button label "Strata"; URL `view=strata`; `layoutMode: "strata"`; `pipelineLayoutVariant: "strata"`. Internal spec name: rcll-v2. |
| Companion | [`strata-view-decision-log.md`](./strata-view-decision-log.md) (SDEC register; appended every work package + checkpoint) |
| Process | Milestones W0→W3; every milestone ends with a **test battery + owner visual validation (hard stop)**; codex review before each checkpoint commit; commit only on owner OK. Implementation agents: **sonnet** (plumbing/mechanical/tests), **opus** (algorithm cores). The orchestrator writes/updates docs, reviews every diff against the specs, runs batteries, and owns gate interpretation. |

## 1. The flow, end to end

```
URL /demo?view=strata&…   TerraformImportDialog (radio "Strata")
        │                          │
        ▼                          ▼
parseTerraformDemoUrlParams   useTerraformImportDialog.setView("strata")
        └──────────┬───────────────┘
                   ▼
     runTerraformImportWithView / runTerraformPresetImport
     deriveLayoutModeFromView("strata") → layoutMode "strata"     [trap #5]
                   ▼
     terraformSceneApply.layoutTerraformSceneFromSources
       skipLayoutCache allowlist + pipeline-option forwarding      [trap #10, C6′-4]
                   ▼
     layoutTerraformViaWorkers → layoutTerraformFromSources (terraformLayoutCore.ts)
       pipelineLayout family gains "strata"; sceneContext literal  [C6′-1, trap #9]
       applyStrataToggleGuards (fork of the guard pattern)         [C6′-2]
                   ▼
     buildPipelineLayoutSceneBody → variant switch → buildTerraformStrataExcalidrawScene
                   ▼
   ┌─ STRATA ENGINE (all inside the §5 failure contract) ─────────────────────┐
   │ P0 prep      preparePipelineLayout [reuse] → clusters/collapsed edges    │
   │ P1 model     strata model: units, hull tree (M1 hardcoded copy), E       │
   │ P2 A3        GreedyFAS cycle repair → F, E′ (per-SCC, OD-4)              │
   │ P3 A1(+S4)   longest-path floor over E′; NS refinement flag (OD-1)       │
   │ P4+P5 A0+A2  post-order per-hull: order units (A2) then place (A0)       │
   │              banded = full-width stacks · packed = skyline dropY         │
   │ P6 A7        slice-A Y refinement (flag-gated; M1b)                      │
   │ P7 A6        deterministic finalize: ids/versions/seeds/groupIds         │
   │ P8 scene     Strata scene build — BYPASSES applyCompoundHierarchical-    │
   │              Layout (seam #6); engine owns provider Y absolutely         │
   └──────────────────────────────────────────────────────────────────────────┘
                   ▼
     terraformSceneApply.applyTerraformExcalidrawScene → replaceAllElements
       apply-layer tombstones (A6/v3 §6: getUpdatedTimestamp exception)
                   ▼
     diagnosePipelineScene (T9: slice-A/B split, bands-skipped, extent tails)
     Q2 battery · churn probe · proof API GET /api/terraform-layout
```

**The five wiring traps** (all verified in code this session; every one silently no-ops or mis-routes if missed): (1) `VALID_VIEWS` hard-rejects unknown `view=` → demo no-ops; (2) preset-normalize ternary downgrades unknown views to `"semantic"`; (3) `deriveLayoutModeFromView` else-falls to `"module"`; (4) the `sceneContext` literal drops options not listed in it; (5) the proof API hardcodes `layoutMode:"rcll"`. Each gets a regression test in WP-1b.

## 2. S0a — identifiers & wiring (milestone W1)

Engine = **passthrough to the v2 substrate** at this stage (`buildTerraformStrataExcalidrawScene` delegates to `buildTerraformPipelineV2ExcalidrawScene`), so V0 validates wiring, not geometry.

**The 15 touch points** (file:line anchors verified 2026-07-04):

| # | File | Change |
| --- | --- | --- |
| 1 | `terraformImportDialogUtils.ts:1,9,11` | `"strata"` in `TerraformView`, `TerraformLayoutMode`, `PipelineLayoutVariant` |
| 2 | `terraformImportDialogUtils.ts:39-67` | `VIEW_OPTIONS` entry {value:"strata", label:"Strata", description} → radio renders in `TerraformImportDialog.tsx:541-582`; add to disabled-gating list :548-552 |
| 3 | `terraformDemoUrlParams.ts:115-120` | `VALID_VIEWS` += "strata" |
| 4 | `terraformDemoUrlParams.ts:547-602` | `collectTerraformDemoParams` strata branch (share-URL round-trip; pipeline-family params) |
| 5 | `terraformPresetImport.ts:27-43` | `deriveLayoutModeFromView` strata branch (trap: else → "module") |
| 6 | `terraformImportPresetsTypes.ts:5-9` | duplicate `TerraformImportPresetView` union += "strata" |
| 7 | `terraformImportPresetsTypes.ts:150-157` | normalize ternary += strata (trap: unknown → "semantic") |
| 8 | `terraformLayoutCore.ts:894-900,1063-1073` | pipeline-family condition += "strata"; variant dispatch branch → Strata entry |
| 9 | `terraformLayoutCore.ts:1012-1061` | sceneContext literal carries every strata option (C6′ seam 1) |
| 10 | `terraformSceneApply.ts:254-261,281-308` | skipLayoutCache allowlist += "strata" (C6′ seam 4) + option-forwarding gate += "strata" (seam 3) |
| 11 | `useTerraformImportDialog.ts:218-225` | `handleSetView("strata")` resets pipeline-only dials (SDEC-22 variant-switch UX note) |
| 12 | `terraformImportPresetDevPlugin.mjs:596,41-115` | proof API accepts `layoutMode=strata` (trap: hardcoded "rcll"); param catalog rows |
| 13 | `import-presets.catalog.json` / preset DB | seed ≥1 strata-view preset for /demo |
| 14 | precompute cache script | optional, later (cache client is generic on view) |
| 15 | tests | see WP-1b below |

Also S0a: the **variant clobber guard** (`terraformLayoutCore.ts:1026-27` + duplicate in sceneApply — `layoutMode==="rcll"` force-rewrites the variant): strata rides its **own layoutMode**, so the clobber sites must not touch it — asserted by the threading test. **rcllV2Degraded demo-UI badge** (v3.1 §5.2) is an explicit small S0a task. Toggle surface for M1: `strataNetworkSimplexRank` (OD-1 flag, default OFF), `strataSweeps` (K, default 0 in M1a / 4 in M1b), `strataCoordinateRefine` (A7 flag, default OFF until SA7) — all opt-in, default off (owner standing rule), all threaded through every C6′ seam + URL params + proof-API catalog.

**Work packages (both sonnet, parallel):**
- **WP-1a — wiring**: touch points 1–14 + passthrough entry + degraded badge. Battery: `terraformDemoUrlParams.test.ts`, `terraformCanvasShareUrl.test.ts`, `terraformSceneApply.test.ts`, typecheck.
- **WP-1b — tests**: strata threading test (pattern: `terraformLayoutCoreRcllThreading.test.ts`) asserting URL/dialog-set variant reaches the engine + scene-meta echo matches; stale-cache regression (warm KV cache bypassed for strata); worker parity `terraformLayoutWorkerParity.test.ts` views matrix += strata (note: rcll is missing there today — add both); trap regressions #2/#3/#5; proof-API curl assertion.

**Checkpoint V0 (owner):** Strata button visible; `view=strata` renders identically to v2 passthrough on both presets; share-URL round-trips; proof API answers `layoutMode=strata`. STOP for visual validation → codex review → commit.

## 3. The engine, piece by piece (milestones W2–W3)

New modules, one per phase, in `packages/excalidraw/components/` (family-consistent naming). Shared files touched only where stated, under D2′ (existing-engine snapshots must hold).

### P0 — Prep [reuse; no new code]
- **In:** sources → `terraformPlanParsing` → `preparePipelineLayout` (`terraformPipelineLayoutShared.ts:1400`). **Out:** `PipelineLayoutPrep` (clusters, collapsed edges, skeleton sizes).
- The engine consumes prep read-only. **S4 (shared-file touch):** extract `isDepthFloorValid` from `Shared.ts:598-601` as a pure gate (C7; the one v1.0 step sound as written). WP-2a.

### P1 — Strata model · `terraformPipelineStrataModel.ts` [new]
- **In:** prep. **Out:** `StrataModel = { units, leafClusters, hullTree, E, addressOf }` — hull tree = **M1 hardcoded in-engine copy** of provider→account→region→vpc→subnetZone (copy-then-parametrize, D6′; the shared `buildHullTree` is never mutated; pattern reference: `terraformPipelineRcllModel.ts:75`), **with per-role policy: packed = {region, vpc, subnetZone}, banded = {account, provider}, root.policy = "banded" (v3.1 §1.4)**. Hull `placement` metadata from the schema path, never first-writer-wins.
- **Tests:** model unit tests (hull tree shape on both presets; policy map; the band-row invariant precondition — every child of a banded hull is one band-row, bare leaf = singleton band, v3.1 §2.2). **WP-2b (opus).**

### P2 — A3 cycle repair · `terraformPipelineStrataCycleRepair.ts` [new] — spec v2.0 §6-A3 verbatim
- **In:** collapsed cluster graph E (self-loops dropped for ranking, kept for render; parallel edges deduped with multiplicity). **Out:** `F` (reversed set), `E′ = (E − F) ∪ reverse(F)`; every downstream phase consumes E′ (C10′); true direction restored at draw with back-edge styling.
- Per-SCC condensation ON (OD-4), pinned-comparator adjacency, `s = leftSeq ++ rightSeq` **no reverse**, comparator-least ties (tie handling changes |F| — T7 pins the arc; v3.1 §9).
- **Tests (T7, mandatory fixtures):** acyclic chain ⇒ F=∅; 2-cycle+3-chain ⇒ |F|=1 arc pinned; self-loop dropped; two disjoint SCCs ⇒ F = union of SCC-local sets; E′-consumption assert (reversed arc participates forward). **WP-2a (sonnet).**

### P3 — A1 rank · `terraformPipelineStrataRank.ts` [new + reuse]
- **In:** E′. **Out:** `rank(v)` per cluster; `columnX[rank]` from per-column max leaf width + COLUMN_GAP.
- Longest-path floor via a **forked, sequence-free `computeDepths` signature** (C4′ — the shared edge type embeds `sequence`); NS refinement (`computeNetworkSimplexDepths`, exact Gansner [reuse `Shared.ts:638`]) behind the OD-1 flag, committed only through `isDepthFloorValid` → `applyDepthFloorIfValid` (C7). No `?? PIPELINE_MARGIN` fallback — off-grid rank is a hard dev-assert (C1′). No cyclic clamp exists in this engine (A3 ran first).
- **Tests:** rank unit tests incl. the OD-1 arm; C1′ assert test. **WP-2a (sonnet; NS wiring reviewed by orchestrator).**

### P4+P5 — A0 compound placement + A2 ordering · `terraformPipelineStrataPlacement.ts`, `terraformPipelineStrataOrdering.ts` [new] — spec v2.0 §6-A0/§6-A2 + **v3.1 §1**
- **In:** StrataModel + ranks. **Out:** boxed hull tree with absolute coords after root pass (children offset top-down; leaf skeletons pre-compensated).
- `layoutHull(h)` post-order: children laid out first (fixed boxes) → `units(h)` (child hulls + direct leaves; colSpan = [min,max] leaf rank) → **A2 orders ONE sequence over units(h)** → place by policy: **packed** = per-hull skyline `dropY` over the unit's actual padded x-extent [reuse `Pack.ts:137-160` semantics, monotone, OD-6]; **banded** = full-width stacks in sequence order with LANE_GAP; box = bbox + FRAME_PAD + TITLE_RESERVE (frozen constants).
- **A2 (M1a ships K=0 = pure model order — the checkpoint is labeled "model-order bands"; K=4 turns on in M1b):** initial sequence = content-key sort (pinned comparator); K directional sweeps, layer = colSpan.min, barycenter over swept-direction + same-layer neighbors on normalized positions; candidates = **{initial, sweep 1..K, height-aware greedy seed}** (v3.1 §1.3); **banded acceptance = weighted bands-skipped cost** (v3.1 §1.1: Σ per lifted edge of Σ(h_band + LANE_GAP_Y) over skipped bands — integer, sequence-only, no geometry); crossings-trial tiebreak (box-center chords, v3.1 §1.2); remaining ties → earliest; packed acceptance = crossings decrease (v2.0). Scoping words: trial and counts over units(h) and edges lifted to h ONLY (v3.0 §3.2).
- **Tests:** placement structural checks (R2: non-ancestor overlap 0, title collisions 0, contiguity 0 — both presets); **band-adjacency fixture** (≥4 bands, connectivity ≠ alphabetical ⇒ connected bands adjacent + no crossings regression + integer tie→initial, v3.0 §3.5 + v3.1); multi-column unit fixture; same-layer fixture (≥70% units share colSpan.min); **≥2-provider root fixture** (banded acceptance fires at root, v3.1 §1.4); generation-purity fixture. **WP-2b (opus) for K=0 M1a; WP-3a (opus) for K=4 acceptance.**

### P6 — A7 coordinate refinement · `terraformPipelineStrataCoordinates.ts` [new; M1b, flag-gated] — spec v2.0 §6-A7 + v3.0 §4
- **In:** boxed tree. **Out:** refined Y (slice-A scope only — within-packed-hull; A7 is NOT the cross-band lever).
- Option 1 (OD-5): per-column batch (Jacobi) median targets from E′ neighbors → **PAV/isotonic projection** in A2 order with min-gaps → accept column iff global Σ|Δy| strictly decreases; fixed 2-down+2-up sweeps; bottom-up nesting (children rigid at parent); **re-anchor pass** (hull extents recomputed bottom-up, absolute coords re-applied) — output final only after re-anchoring; **R2 standing invariant re-checked on final geometry** (dev-assert in-engine + every T9 run).
- **Gate (v3.0 §4.2):** slice-A near-straight AND slice-A mean/p95 deviation strictly better than the same engine pre-A7; T2 not regressed; slice-B reported, never cited as A7 wins. **Tests:** A7 unit tests (projection determinism, no-op columns tolerated) + gate measurement in T9. **WP-3b (opus).**

### P7 — A6 deterministic finalize · `terraformPipelineStrataFinalize.ts` [new; M1b] — spec v2.0 §6-A6 + v3.0 §6 + v3.1 §6
- **In:** final boxed tree + generation G (finalize input: state serial else app-side counter). **Out:** `ExcalidrawElement[]` with total identity control.
- `stableId` `tf:role:address(:#ordinal)`; **`groupId = "tfg:"+key` (restored, member-set-independent)**; injective SVG-safe frame-id encoding; direction-preserving length-prefixed edge ids; `seed = FNV-1a(stableId)&0x7fffffff||1`; `version = G`, `versionNonce = FNV-1a(stableId+":"+G)&0x7fffffff||1`; id-reference rewrite (boundElements/containerId/frameId/bindings **+ groupIds**, v3.1 §6.1) with dangling-ref dev-assert; ids proven unique BEFORE convert/restore; OD-8 disposition deferred to S3 (parity test either way).
- **Coverage: both skeleton-conversion call sites** (`terraformPipelineLayoutFinalize.ts:127` and the fallback path) — T1's outcome must not depend on which internal path fired.
- **Tests (T1/T3 + fixtures):** run-twice byte-equal in pinned env; static no-`Math.random`/`Date` scan; SVG frame-id round-trip; generation purity (G vs G+1 ⇒ only version/versionNonce differ). **WP-3c (sonnet, orchestrator reviews identity code).**

### P8 — Scene build · `terraformPipelineStrataSceneBuild.ts` [new] — seam #6 bypass
- **In:** finalized elements/boxed tree. **Out:** the scene body.
- Reuses `buildCompoundFramesFromLayoutBoxes` + edge-skeleton appenders + `convertPipelineSkeletonToElements` where semantics are engine-neutral, **but MUST NOT call `applyCompoundHierarchicalLayout`** (`…CompoundHierarchy.ts:213-249` re-stacks provider Y in all three legacy paths — C6′ seam #6). The engine owns absolute coordinates end-to-end.
- **Tests: provider-Y byte-assert** — engine-emitted provider Y survives byte-identically into the built scene, on a **≥2-provider fixture** (single-provider masks the clobber as a pure translate; exact Y values, not shapes). **WP-2c (opus).**

### P9 — Apply layer (tombstones) · `terraformSceneApply.ts` [shared-file touch; M1b with S0c]
- At `replaceAllElements` time: `removed = prevSceneAddresses − newAddresses`; per removed address append its canonical-id element with `isDeleted: true`, `version = G`, explicit `versionNonce` (never `newElementWith`'s random fallback), **`updated = getUpdatedTimestamp()`** (`@excalidraw/common` — verified importable, no layer violation; the sole wall-clock exception, v3.0 §6).
- **Tests (T4):** removed resource appears exactly once; **clock-injected** `isSyncableElement` assert (stub `getUpdatedTimestamp`/inject now; companion negative assert that `updated=1` is rejected — proves the real 24h window is exercised). Collab-lane scenario lands at S3/M2. **WP-3c.**

### P10 — Diagnostics & metrics (T9) · `terraformPipelineCollisionDiagnostics.ts` [shared-file touch, additive] + Q2 harness
- **Population rule (normative):** all engine-emitted non-aggregated TFD arrows regardless of `isDeleted`. **Slice split:** LCA-hull policy via the **role→policy map mirroring the engine's schema copy** (v3.1 §2.6; hull tree reconstructed from frame `customData.terraformTopologyPath`; dissolved-band case for deBand comparison arms). New fields: per-slice extent p50/p90/mean, **bands-skipped** (projection to LCA child-bands, v3.1 §2.1), stacked band height, rank-span-normalized deviation (COLUMN_GAP floor), leaf-only area utilization, prep wall-clock (T10 addition).
- **Harness reality (v3.1 §2.6):** `terraformPipelineQ2Audit.test.ts` consumes named fields and hand-lists object meta keys — every new field and `rcllV2Degraded` needs explicit lines. Gate arithmetic: paired-per-edge bootstrap CI (address-keyed, pinned seed), N_B,min/N_min rules. **WP-2d (sonnet); baselines frozen by the orchestrator (see §5 W2).**

### P11 — Failure contract wrapper · in `terraformPipelineStrata.ts` [new] — v3.0 §8.4 + v3.1 §5
- Entry wraps A3→finalize in one guard. Caught: any phase throw; R2/R3 structural failure on final geometry in prod (dev still hard-asserts); non-finite coordinate. On catch: **fallback = `buildTerraformPipelineV2ExcalidrawScene(..., { prep })`** — the v2 builder gains the optional `prep` param (shared-file touch, D2′, default behavior unchanged) so the failure path never re-pays the ~20s skeleton build — with `rcllV2Degraded = {stage, reason}` merged into scene meta. Fallback throw ⇒ propagate (never a silent partial scene). T9 asserts `rcllV2Degraded` absent on both presets. **WP-2c.**

## 4. Milestone ladder

### W0 (done except D10) — v3.1 ✅ · decision log ✅ · this doc ✅ · **WP-0d D10 bug-fix PR (sonnet, running)**
Five measurement-contaminating fixes + regression tests (prep-cache fingerprint, sibling-edge comparator, randomInteger zero-seed, shorten→compact demotion surfacing, v2-full+ancillary collision — last one may be report-only if invasive). Battery: affected suites + typecheck. Owner validation: green tests + doc skim → commit.

### W1 — S0a → **V0** (§2 above)

### W2 — M1a → **V1**
- **WP-2a (sonnet):** P2 A3 + T7 fixtures; P3 A1 + S4 extraction (+D2′ snapshots).
- **WP-2b (opus):** P1 model + P4 A0 + P5 A2@K=0 + structural checks.
- **WP-2c (opus):** P8 scene build + provider-Y assert; P11 failure contract (+v2 `prep` param).
- **WP-2d (sonnet):** P10 slice split + new metrics + harness lines; run T9 on the **v2 substrate**, both presets → orchestrator freezes slice-A/B baselines + N_min/N_B,min/M4-coverage/bootstrap-seed/candidate-order **by spec amendment before any gated code lands** (C11; v3.1 §8).
- Battery: T7, R2/R3 on both presets, Q2 + strata@K0 arm, T10 wall-clock (engine + prep), typecheck. **Checkpoint V1 (owner):** first real Strata geometry on both presets ("model-order bands" label — readability battery not meaningful until K=4). STOP → codex → commit.

### W3 — M1b → **V2**
- **WP-3a (opus):** A2 K=4 + v3.1 §1 acceptance + fixtures (band-adjacency, ≥2-provider root).
- **WP-3b (opus):** A7 + SA7 gate.
- **WP-3c (sonnet):** A6 finalize both call sites + T1/T3 + P9 tombstones + T4 clock-injection.
- **WP-3d (sonnet):** A5 pierce/contiguity → S8 freeze. **WP-3e (opus):** A4 (M1_rel, M2_flip, M4_disp95, M5_hull per v3.1 §3) → S2 derive/validate on disjoint presets → freeze.
- Battery: full T1–T10 + Q2 7-arm + churn + cyclic + **ancillary-ON comparison arm** per preset (v3.0 §8.6 — Strata M1 arms are extraction-free; the asymmetry is stated in the report) + **arm-E side-by-side table** (slice-B extent, bands-skipped, crossings-per-eligible-pair, hub centering + counts, aspect, wall-clock). **Q7-AXIS** 20-edge hand-label (impact-tracing framing) runs here, before M2 gates freeze.
- **Checkpoint V2 (owner):** visual validation + **BINDING arm-E verdict** (v3.0 §9; negative ⇒ M1b redo with owner deltas as the work list). STOP → codex → commit. **M1 exit also queues the owner decisions due at M2 planning:** OD-9 routing owner, Q5-TCO engine endgame, hub/extraction A/B.

## 5. OD pre-resolutions (agents must not resolve ODs silently — escalate anything not listed)

| OD | Resolution for M1 |
| --- | --- |
| OD-1 NS rank | A/B behind `strataNetworkSimplexRank`; ship the arm passing the v3.0 §4.5 co-gates (width AND slice-B p90 AND slice-A tail) |
| OD-2 K | 4 (2 down + 2 up); M1a runs K=0 |
| OD-3 | Option A (no dummies); OD-3B is a slice-A escalation only |
| OD-4 | per-SCC condensation ON; model-order arc selection |
| OD-5 | Option 1 (averaging + PAV); BK-with-erratum only if slice-A targets missed |
| OD-6 | monotone skyline, no back-fill |
| OD-7 | generation versions (input to finalize) |
| OD-8 | decided at S3 with a parity test |
| OD-9/12/13/14/15 | post-M1 (OD-9 owner decision before M2 freeze) |

## 6. Verification protocol

- **Batteries:** `yarn vitest run <files>` per work package; `yarn test:typecheck` every milestone; full battery at checkpoints. Proof API: `curl 'http://localhost:3001/api/terraform-layout?presetId=…&layoutMode=strata&…'` — resolved flags echoed in meta must match the request (C6′ discipline).
- **Visual validation:** `yarn start` → `http://localhost:3001/demo?preset=staging-extended-localstack-v2&view=strata` and `…preset=staging-localstack&view=strata`; V0 additionally checks the share-URL round-trip (hamburger → Copy canvas URL → paste → identical view).
- **Determinism:** run-twice byte-equal (pinned env) at V2; static random/Date scan in T1.
- **M1 exit:** T2 (frozen A4 thresholds, derive/validate disjoint) + §2 battery vs frozen v2-substrate baselines on ≥2 presets + the owner's recorded arm-E verdict.
