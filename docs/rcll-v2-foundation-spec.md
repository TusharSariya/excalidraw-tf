# RCLL v2 — Foundation Phase Spec

> **Status:** Build spec. Companion to `docs/rcll-v2-architecture-decision.md` (its **Round 4** section, 2026-06-29, green-lights this build). This is the net-new Foundation-phase design that the architecture decision points at.
>
> **Decisions locked (2026-06-29):** D1 ordering key = predecessor barycenter (F1); D2 identity = derive `element.id` from address (F3); D3 R5 width = keep widen-then-compact, just stabilize (grid-packing deferred); D4 R4 = container- pierce **soft gate** (F8); D5 cyclic-leaf = **FAS reversal + restyle** (F9); D6 containment schema = **configurable, inside Foundation** (F10); D7 = skip the elkjs spike, commit to this refactor. Open forks A/B from the first draft are now resolved by D1/D2; fork C (`moved{}` availability) remains a spike (§7).
>
> **How this was produced:** a 9-agent drill (ground-truth reads of the existing engine + `graph-layout-rag` literature over the desktop GPU + an adversarial critic), then a manual reconstruction of the one decision the workflow dropped (the packer) and resolution of the six contradictions the critic surfaced. The two load-bearing facts (`firstSequence` instability, `applyDepthFloorIfValid` dual-write) were re-verified directly against source — see **§8 Provenance**.

---

## 0. TL;DR

The Foundation phase makes the layout a **diff-stable, identity-keyed function of the Terraform graph** — the substrate every later feature (groupings, annotations, diff highlighting, width packing) needs. It is **not** about aesthetics.

The single highest-leverage change is **F1**: replace the within-column Y-ordering key. Today it is `firstSequence` — a TFD _file-position_ counter — so editing one edge mid-file reshuffles the vertical order of unrelated nodes. Everything else in this spec is either downstream of F1 or a correctness fix the critic found.

| ID | Deliverable | Why it's Foundation |
| --- | --- | --- |
| **F1** | Content-stable within-column ordering key (replace `firstSequence`) | The diff-stability primitive; prerequisite for F3/F5/F6 |
| **F2** | Geometry **diff-stability** owner + metric + the right test | Assigns the requirement that fell in a crack between SP2/SP3 |
| **F3** | Identity contract: `element.id = tf:<role>:<address>[:<ordinal>]` | Anchors overlays, diff status, z-order across re-layouts |
| **F4** | Pure (non-mutating) depth-floor feasibility gate | Unblocks deterministic constraint relaxation |
| **F5** | Single constraint-input path into the packer (pre-layout only) | Removes the impossible "emit constraints back" path |
| **F6** | Keep-together as a true single-column Y-adjacency primitive | Off the sink-bundle (which spills rightward → breaks R3) |
| **F7** | Overlay persistence + semantic diff + orphan handling | Identity-keyed persistence with no double-representation |
| **F8** | R4 container-pierce **soft gate** (ranked penalty) — D4 | A real R4 lever (measured nowhere today); ranks packer candidates |
| **F9** | Cyclic-leaf **repair**: FAS reversal + back-edge restyle — D5 | Fixes the silent un-styled backward arrow; keeps R3 for all other edges |
| **F10** | **Configurable containment schema** (replace the AWS role enum) — D6 | De-hacks the one non-general piece; folded into the core refactor |


## Document graph

| Relation | Link |
| --- | --- |
| Role | Superseded |
| Status | Superseded by `rcll-v2-spec.md` (v1.0), then by v2.0+ |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`rcll-v2-architecture-decision.md`](./rcll-v2-architecture-decision.md) |
| Children | [`rcll-v2-spec.md`](./rcll-v2-spec.md) |
| Sisters | — |
| Next (agent) | Do not implement from here; open v2.0 + v3.1 for current contract. |

**Deferred out of Foundation:** the R4 _barycenter_ crossing-min sweep (distinct from F8's pierce gate), R5 _grid-packing_ of TFD-independent resources, and pattern/predicate group membership. The elkjs spike is **dropped** (D7). See **§4**.

---

## 1. The reframe (recap)

The diagram is regenerated **every PR / plan / drift** and is an **editable seed** the user rearranges. Therefore the ranked-#1 properties are now **determinism + diff-legibility + identity-keyed overlay persistence**, ahead of crossing/width aesthetics. The user does **not** preserve manual positions (auto-layout owns geometry); the user **does** persist, keyed by Terraform address: manual groupings (as layout constraints), annotations (anchored to an element), and style edits. Conflict policy: _re-place changed elements_. Diff display: _in-place highlighting_.

The coordinate model is already decided: **depth-pinned X** (`X = columnX[depth]`, depth = longest-path topological rank) makes **R1/R3 structural by construction**; **Y is the free dimension** for R2/R4/R5.

---

## 2. The one corrected truth: determinism ≠ diff-stability

This distinction is the heart of the Foundation phase and the source of the critic's central contradiction.

- **Pure determinism** — _same input → same output._ The engine **already has this**: no `Math.random`/`Date` in layout; every ordering sort terminates in an `id.localeCompare` tiebreak. A "run twice, assert deep-equal" test passes today and proves _nothing about the product requirement._
- **Diff-stability (mental-map preservation)** — _small input change → small, localized output change._ The engine **lacks this**, because the primary within-column ordering key is file-position:

  ```
  terraformDeclaredDataFlow.ts:218   let sequence = 0;
  terraformDeclaredDataFlow.ts:282   edges.push({ source, target, sequence, origin: "tfd" });
  terraformDeclaredDataFlow.ts:283   sequence += 1;          // ← increments per edge, in parse order
  ```

  `firstSequence = min(edge.sequence)` per cluster, used as the **primary** Y sort at `terraformPipelineV2Pack.ts:350-355` and `:453-457`. Insert one edge mid-file → every later edge's `sequence` shifts → `firstSequence` shifts for unrelated clusters → their Y reshuffles. **Pure determinism holds; diff-stability is violated.**

**Owner decision:** geometry diff-stability is owned by the **layout engine (F1)**, delivered by _statelessness + a content-stable ordering key_ — the GD'24 Model-Order result ("the layout is a pure function of the model-ordered input, so small input deltas yield small output deltas"). It is explicitly **not** delivered by stateful previous-layout anchoring (DynaDAG / Sondag / cola.js) — that is path-dependent (the same final graph reached via two edit histories yields different geometry), which breaks diff reproducibility and complicates rebasing identity-keyed overlays. **Rejected.**

**Corrected SP2 claim:** "byte-stable serialization for unchanged elements" is **not achievable and not the target** — `x/y` are serialized fields and an unchanged node legitimately moves when a _neighbor_ is added. The honest target is **diff-stable**: an unchanged node moves _little and predictably_. The identity contract (F3) gives stable ids/overlay anchors; it does **not** give geometry stability — F1/F2 do.

---

## 3. Foundation deliverables

### F1 — Content-stable within-column ordering key _(the packer decision, reconstructed)_

**Keep:** depth-pinned X (`columnX[depth]`, `terraformPipelineV2Pack.ts:99-112`, `:433-437`) and the deterministic skyline `dropY` for Y (`terraformPipelineV2Pack.ts:137-160`). Both are clean, deterministic, and make R1/R2/R3 structural. There is **no** barycenter/median crossing-min sweep today and Foundation does **not** add one (see §4).

**Replace:** the primary within-column ordering key. `firstSequence` (file position) → a **content-derived stable ordinal** that is invariant to source reordering.

**Recommended key (the principled analog of `firstSequence`):** order same-column nodes by

1. **predecessor-address barycenter** — the sorted tuple of the Terraform addresses of the node's in-column predecessors (keeps nodes fed by the same upstream adjacent → helps R4 container contiguity), then
2. **own Terraform address** (`localeCompare`) as the total-order tiebreak.

This preserves the _semantic_ intent `firstSequence` was approximating ("order by position in the dataflow") while being a pure function of graph content — editing an unrelated edge does not move a node whose own incident edges are unchanged. `firstSequence` is **removed** from the ordering path entirely (it may remain only as telemetry).

- **Files:** `terraformPipelineV2Pack.ts:350-355`, `:259-265`, `:453-457`; `firstSequence` construction `terraformPipelineLayoutShared.ts:1430-1451`, `:490-500`.
- **Reuse:** the existing depth/longest-path machinery (depth is already content- stable), `dropY`, the `localeCompare` tiebreak.
- **Net-new:** the predecessor-address barycenter ordinal.
- **Open fork → §7 (A).** Pure address-sort vs predecessor-barycenter is a genuine semantics/stability trade.

---

### F2 — Geometry diff-stability: owner, metric, and the right test

- **Owner:** F1 (above). No other deliverable owns geometry.
- **Metric (regression gate):** per-address **relative position change** — for two adjacent plans, `|Δposition|` keyed by Terraform address over the set of nodes whose _content_ is unchanged. (Sondag's relative-position-change, used here as a metric, not as a stateful algorithm.)
- **The right test:** run the pipeline on a plan, then on a **minimally-changed** plan (add one resource, add one edge, rename via `moved{}`), and assert the churn metric for unchanged nodes is below a threshold. The existing "run twice on identical input → deep-equal" test stays (it guards pure determinism) but is **explicitly insufficient** — it must not be cited as evidence of diff-stability.
- **R5 tension is owned here too:** `computeWidthBudgetedDepths` ALAP centering (the R5 width lever, `terraformPipelineLayoutShared.ts:531`) and any column re-pack are _maximally_ sensitive to membership change and fight diff-stability. Foundation keeps aggressive width packing **off** until it passes the churn gate (§4).

---

### F3 — Identity contract _(SP2, corrected)_

**Canonical business key:** the Terraform address, already present end-to-end as `customData.terraformVisibilityKey` and canonicalized by `getTerraformVisibilityKey()` (`terraformVisibility.ts:252-263`). **Do not invent a new key.**

**Derived element id:** `element.id = tf:<role>:<address>[:#<ordinal>]`, roles `{node, frame, label, icon, edge, dup}`. This makes Excalidraw's id-keyed reconcile/z-order machinery reusable and gives stable overlay/diff anchors.

**Do NOT** flip `regenerateIds:false` in `convertToExcalidrawElements` — addresses map to many elements and raw skeleton ids collide; `transform.ts:641-648` silently **drops** colliding elements. Instead add **one net-new post-convert pass** `assignStableTerraformIds()` as the first step of `convertPipelineSkeletonToElements` (`terraformPipelineLayoutFinalize.ts:95-112`), after `convert`, that:

- derives the id from `customData`, **frames keyed off `terraformPrimaryAddress`** (unifying the `tf-topo:primary-cluster:` vs `tf-pipeline:cluster:` prefixes so a cluster keeps one id even if it flips to the fallback path);
- **edges keyed by sorted endpoint addresses**, _not_ by `sequence` (`tf:edge:<addrA>__<addrB>`) — `sequence` is the file-position counter F1 removes;
- builds one `oldId → newId` map and rewrites **every** reference field (`boundElements[].id`, `containerId`, `frameId`, `startBinding.elementId`, `endBinding.elementId`), with a dev assertion that no reference points to an absent id;
- resolves residual collisions with a **content-derived** ordinal (e.g. the satellite's own sub-address), **never** a positional sort index (that would reintroduce the F1 instability class);
- sets `seed = hashToSeed(stableId)` and leaves `version=1, versionNonce=0` (no `randomInteger`), so an _unchanged_ element serializes identically _given the same geometry_.

**Scope correction:** F3 buys overlay anchoring, diff status, and z-order stability. It does **not** buy geometry stability (F1/F2) and the "byte-stable diff" framing is dropped (§2).

- **Open fork → §7 (B).** Whether the full id-derivation earns its cost, or the lighter "identity stays in `customData` only" (G1 fallback) suffices.

---

### F4 — Pure feasibility gate

`applyDepthFloorIfValid` is **gate-and-commit** — it mutates `cluster.depth` in place on success (`terraformPipelineLayoutShared.ts:606`, "DUAL-WRITE #1") and the docstring confirms both writes are load-bearing. It therefore **cannot** be used to _probe_ feasibility inside a relax-and-re-solve loop without corrupting shared state and making the loop order-dependent.

**Deliverable:** extract the pure predicate (already inline at `:598-601`) as `isDepthFloorValid(clusters, candidate, edges): boolean` — **no mutation**. The relax loop probes with `isDepthFloorValid`; only the final accepted candidate is committed via `applyDepthFloorIfValid`. This makes constraint relaxation deterministic and idempotent.

---

### F5 — Single constraint-input path

The grouping→packer integration was described two incompatible ways (SP2 post-convert "emit constraints back to the packer" — _architecturally impossible, geometry is already fixed at the finalize seam_ — vs SP3 pre-layout threading). **Resolution: one path.**

- **Pre-layout only.** `layoutPipelineV2Strict` gains a `groupConstraints: PipelineGroupConstraint[]` parameter, **threaded through the `sceneContext` literal in `layoutTerraformFromSources`** (per the _RCLL option-threading boundary_ — options not forwarded there are silently dropped on the real app path; engine tests bypass it).
- **The finalize pass (F3/F7) handles only** styles, annotations, and diff-status — none of which affect geometry. It does **not** influence layout.

```ts
interface PipelineGroupConstraint {
  groupId: string; // deterministic; see F7
  kind: "keep-together" | "align" | "same-band" | "order-after";
  members: string[]; // Terraform addresses
  priority: number;
  axis?: "x" | "y";
}
```

---

### F6 — Keep-together primitive _(corrected off the sink-bundle)_

The critic correctly killed SP3's plan to build keep-together on `resolveSinkBundles`: that primitive spills members to **elastic X to the right** of an anchor (`originX = anchorExt.x1 + V2_COLUMN_GAP`, `terraformPipelineV2Pack.ts:380`) and `packBundleColumns` lays them into new off-grid columns. Bypassing `unitIsExternalSink` for a non-sink member would place it right of its own successors → **backward edge → violates R3**, the very invariant the feature must protect.

**Deliverable:** a true **single-column Y-adjacency** primitive — grouped members that share a column are placed in **contiguous skyline slots** (adjacent in `dropY`), staying on `columnX[depth]`. X never moves; R3 is preserved by construction.

- **Same-column keep-together** → contiguity in `dropY` (Sander's "unbroken sequence" rule, enforced as an ordering post-pass, not a hard solver).
- **Cross-column cohesion / align / same-band** → **best-effort** shared `startY` bias in `dropY`; if a member's column is occupied at the band, it drops below and the alignment is **surfaced as `relaxed`** (maps to _re-place changed elements_). Never presented as guaranteed.
- **X constraints** (`order-after`, "same column") → injected as longest-path precedence edges via the `computeGlobalSeparatedFloor` sepEdge template (`terraformPipelineRcllRankSeparate.ts:218-285`), probed with **F4's** `isDepthFloorValid`, cycles caught by `constraintGraphHasCycle` (`:128`).
- **R1 guard:** a keep-together/same-band group whose members span different hulls is **not** drawn as a rigid block (that would pierce hull nesting = hard R1 violation) — cross-hull groups get Y-cohesion bias only; a group box is drawn only when all members share their smallest enclosing hull.

**Conflict rule (one line):** _structure (R1/R2/R3) never yields; a grouping is a soft, minimal-displacement preference, relaxed constraint-by-constraint (lowest-priority first, sorted-Terraform-address tiebreak) whenever it would reverse/flatten a TFD edge on X or close a cycle in the Y ordering graph; each relaxation is surfaced keyed by address for in-place highlighting._

---

### F7 — Overlay persistence + semantic diff + orphan handling _(SP2, corrected)_

**Store (app-level, `excalidraw-app/data` — not library state):**

```ts
interface TerraformOverlayStore {
  schemaVersion: number;
  derivationVersion: number; // id-scheme version (F3)
  groupings: { id: string; memberAddresses: string[]; label?: string }[];
  annotations: {
    id: string;
    anchorAddress: string;
    anchorRole?: string;
    offset: { dx: number; dy: number };
    skeleton: unknown;
  }[];
  styles: Record<string /*address*/, Partial<StyleProps>>;
  priorHashes: Record<string /*address*/, string>; // for the diff
}
```

Keyed by **address**, not `element.id`. **`groupId` derivation** must be content- stable and **independent of the member set** (a stable allocated id stored with the group), so editing membership does not churn every member's serialized `groupId`.

**Apply pass** `applyTerraformOverlays(elements, store)` beside `reconcileTerraformVisibility`: styles merged **last** (user wins); annotations recreated at `(anchor's new bbox + stored offset)` and bound via `boundElements`/`containerId`; groupings resolved to live members and fed to the packer **via F5** (not here).

**Semantic diff** `computeTerraformDiff(elements, store.priorHashes)`: a **plan-model content hash** per address over an **explicit allowlist** (attributes

- incident TFD edges + containment parent), **excluding `x/y/w/h/seed/version`** — because auto-layout moves nodes every run, a geometry-based diff would light up the whole canvas. Tag `customData.terraformDiffStatus ∈ {added, removed, changed, unchanged}` (+ subtype `attr|dependency|container`); the renderer/visibility seam tints by it for in-place highlighting.

**Removed-element handling (no double-representation).** The critic flagged that `reconcileElements` re-appends every local element not in the regenerated set (`reconcile.ts:103-107`), so a removed resource would **survive at stale geometry** _and_ be re-emitted as an orphan-tray ghost → shown twice. **Resolution:** on the regenerate path, **replace-by-canonical-id** (the ghost reuses the exact `tf:node:<addr>` id so it overwrites the stale element), or bypass the collab reconcile entirely for the regenerate path. `bumpElementVersions` (`restore.ts:878-901`) only bumps on id match and does nothing for removals, so it is **not** sufficient on its own.

**Rename:** map old→new address **only** via Terraform `moved{}` blocks; absent one, treat as remove(orphan)+add and offer a **non-destructive** "suggest re-anchor" in the diff UI — never silently re-anchor by name similarity. **Spike (§7 C):** confirm `moved{}` is actually present in the TFD/plan the pipeline consumes; if it usually isn't, the **orphan tray is the primary rename UX**, not the fallback.

---

### F8 — R4 container-pierce soft gate _(D4)_

A **container-pierce** is an edge segment that passes through a container (frame) rectangle it doesn't belong to — it reads as false membership. Today this is **measured nowhere**; v2 keeps each hull a contiguous rigid block so the baseline is low, but nothing _ranks_ candidate layouts by it.

**Deliverable:** a pierce counter and a soft ranking penalty.

- **Count:** for each edge, count foreign frame rects its routed segment crosses, reusing the existing `segmentsCross` / `countPlacedCrossings` kernel against the hull-tree frame rectangles (exclude the edge's own ancestor frames).
- **Use:** the packing-search **ranks** candidate layouts by total pierce count (lower is better) as a soft tiebreaker. **No hard reject** — it can never fail to produce a layout (D4 = soft gate).
- **Distinct from the deferred barycenter sweep (§4):** F8 _scores_ layouts the packer already produced; the sweep would _reorder_ to minimize crossings. F8 is the cheap, in-Foundation R4 lever; the sweep is post-Foundation, default-OFF.
- **Files:** `segmentsCross` / `countPlacedCrossings` (`diagnosePipelineScene`), hull-tree frame rects (`terraformPipelineV2Structure.ts`).

---

### F9 — Cyclic-leaf repair: FAS reversal + back-edge restyle _(D5)_

Today a genuine leaf-level cycle hits `computeDepths`' cyclic fallback — unresolved nodes get `firstSequence`, not a legal rank (`terraformPipelineLayoutShared.ts:501`, `:508-510`) — and v2 still renders, emitting only a `pipelineCycleWarnings` warning (`terraformPipelineLayoutFinalize.ts:26`) with a **silent, un-styled backward arrow**. That is a bug.

**Deliverable:** greedy minimum-feedback-arc-set repair.

- Compute a greedy FAS over the collapsed leaf TFD DAG, **reverse the fewest edges** to make it acyclic (tiebreak by sorted Terraform address → deterministic), run the normal longest-path depth assignment on the result.
- Draw the reversed edge(s) in their **true direction** (now visually right-to-left) with **distinct back-edge styling** (dashed/colored) — reuse RCLL's EXT-12 back-edge treatment rather than re-inventing it.
- All non-reversed edges stay strictly **L-to-R (R3)**; the few back-edges are honestly marked. A cycle cannot be drawn purely L-to-R — this minimizes and labels the unavoidable exceptions.
- **Files:** `computeDepths` cyclic fallback (`terraformPipelineLayoutShared.ts:501`, `:508-510`), `pipelineCycleWarnings` (`terraformPipelineLayoutFinalize.ts:26`), RCLL EXT-12 back-edge styling.

---

### F10 — Configurable containment schema _(D6)_

The report found the layout **math already generalizes**; the one genuinely hardcoded thing is the 6-level AWS role enum (`provider/account/region/vpc/subnet`) wired to 5 AWS placement fields in `topologyPathForCluster` — deeper trees flatten into `subnetZone`, non-AWS hierarchies would need force-mapping. D6 folds the fix into the core refactor (not a later pass).

**Deliverable:** replace the fixed enum with a **data-driven containment schema.**

- An **ordered list of level descriptors**, each with: a matcher (how to derive a resource's level from its address/type) + a per-level **policy** (banded vs packed, gap, title treatment).
- Deeper-than-5-level trees no longer flatten into `subnetZone`; a non-AWS hierarchy is supported by supplying a schema.
- The **hull-matrix / staircase core carries over unchanged** — only the level _taxonomy_ becomes configuration. The **default schema reproduces today's AWS taxonomy exactly** (zero behavior change for AWS inputs — assert via snapshot).
- **Files:** `topologyPathForCluster` + the role enum, `buildHullTree` (`terraformPipelineV2Structure.ts`).

---

## 4. Explicitly deferred (NOT in Foundation)

- **R4 _barycenter_ crossing-min sweep** — the GD'24 "Strategy 1" stable, model- order-seeded, container-pierce-aware _reordering_ sweep that accepts a swap only on strict improvement. Distinct from **F8** (which only _ranks_ candidates, in Foundation). Valuable, but **default-OFF, post-Foundation** (the repo's opt-in import-toggle convention). In Foundation, R4 = structural contiguity **+ F8's soft pierce gate**.
- **R5 _grid-packing_** of TFD-independent resources (rows × columns within a container) — D3 keeps the widen-then-compact philosophy and stabilizes it; the grid-pack lever stays off until it passes the F2 churn gate.
- **Pattern/predicate group membership** (`all sg-* in vpc-x`) — explicit address lists only in v1.
- **elkjs spike** — **dropped (D7).** We commit to the depth-pinned RCLL refactor and measure against our own RCLL baselines; elkjs can't be the engine (not bit-reproducible → fails the determinism contract).

---

## 5. Tests & gates

1. **Pure determinism** (exists): run twice on identical input → deep-equal. Keep, but do not cite for diff-stability.
2. **Diff-stability** (net-new, the real gate): minimally-changed plan → per-address `|Δposition|` for unchanged nodes below threshold.
3. **Identity round-trip:** every reference field resolves; no dangling ids after `assignStableTerraformIds`.
4. **No double-representation:** removed resource appears exactly once.
5. **Constraint feasibility:** relaxation is reproducible (total-order tiebreak); groups never produce overlap (R2) or backward edges (R3).
6. **R4/R2 A/B** on `staging-extended-localstack-v2`: groups ON vs OFF must not regress container-pierce crossings or introduce overlap before any class defaults on.

---

## 6. Build order (dependency graph)

```
F1 (ordering key) ──┬──> F6 (keep-together)  ──> F5 (constraint path)
                    └──> F2 (churn metric/test)
F3 (identity) ──────┬──> F7 (overlay/diff/orphan)
                    └──> F4 (pure gate) ──> F6 (X constraints)
```

**F1 first** — it is the load-bearing dependency for diff-stability and for any grouping feature; shipping groups on the `firstSequence` substrate makes them _look_ non-deterministic. **F3 + F4** can proceed in parallel. **F5/F6/F7** depend on F1/F3/F4.

---

## 7. Forks — resolved (2026-06-29)

- **(A) Within-column ordering key — RESOLVED → D1: predecessor-address barycenter + own-address tiebreak.** Chosen over pure address-sort: keeps it content-stable _and_ dataflow-legible (same-source siblings stay adjacent → helps R4).
- **(B) Identity depth — RESOLVED → D2: derive `element.id` from address (F3).** Chosen over random-id + customData-only, to reuse Excalidraw's reconcile/z-order machinery and give annotations a stable anchor.
- **(C) `moved{}` reality — STILL A SPIKE.** Is it in the pipeline's input? Determines whether rename-preservation (F7) is primary or the orphan tray is. Cheap to settle — run before finalizing F7's rename path.

---

## 8. Provenance

- **Workflow `wf8bm72yn`** (9 agents, ~22 min, 703k tokens): 2 ground-truth reads (identity, packing), 3 literature/web research (stable-layout, constraints, diff-identity), 3 syntheses, 1 adversarial critic.
- **Degraded agents, recovered manually:** the _stable-packer synthesis (SP1)_ hit the structured-output retry cap and returned null — **reconstructed here as F1** from the packing ground-truth + stable-layout research (both rich). The _diff-identity research (R3)_ returned a stub — its slice (IaC-diff prior art, `moved{}` availability) is the weakest-sourced part and is carried as **spike (C)**, not a settled decision.
- **Literature backends:** stable-layout ran on the **desktop GPU 4B over SSH** (worked); constraints **OOM'd the 4B on the 8 GB GPU** and fell back to Mac-local `mlx-qwen0.6b` + direct PDF reads.
- **Source-verified before writing:** `edge.sequence` is a file-position counter (`terraformDeclaredDataFlow.ts:218,282-283`); `applyDepthFloorIfValid` dual-writes `cluster.depth` (`terraformPipelineLayoutShared.ts:606`). Both confirm the critic. Other cited line numbers come from the agents and should be spot-checked at implementation time.
- **Critic verdict on the raw workflow output:** _"NOT READY for a Foundation spec"_ — because SP1 was null, SP2/SP3 contradicted on determinism vs diff- stability, and geometry-stability had no owner. **All three are resolved above** (F1 reconstructed; §2 corrects the determinism framing; F2 assigns the owner).
