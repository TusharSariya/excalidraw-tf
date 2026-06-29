# RCLL v2 — Layout Engine Specification (normative)

| Field | Value |
| --- | --- |
| Status | Normative specification — source of truth |
| Version | 1.0 (2026-06-29) |
| Engine | New layout variant `pipelineLayoutVariant: "rcll-v2"`, selectable via a new top-level UI button; existing `v2` and `rcll` engines unchanged |
| Supersedes | the in-doc decisions of [`rcll-v2-architecture-decision.md`](./rcll-v2-architecture-decision.md) (Round 4) and all of [`rcll-v2-foundation-spec.md`](./rcll-v2-foundation-spec.md) |
| Referenced inputs | `rcll-v2-architecture-decision.md` (rationale + literature), `rcll-v2-foundation-spec.md` (decision provenance) |
| Audience | an implementing agent/engineer (execute §6 step by step) + a reviewer (check §7 conformance) |
| First milestone | **M1 (S0+S1+S2)** — stand up the new engine and prove diff-stability |

## Context (why this document exists)

The RCLL (Recursive Compound Layered Layout) Terraform "pipeline view" draws AWS
infrastructure parsed from a Terraform dependency graph (TFD) as a hierarchical,
left-to-right, layered diagram: containment nests provider → account → region → vpc
→ subnet → resource; dependency edges flow left-to-right by depth.

Two prior documents settled the architecture and the Foundation decisions. This
document is the single **normative specification** — one contract, in MUST/SHALL
language, executable clause by clause and checkable for conformance, with every claim
tied to a verified code anchor or a citation, and every change shipped as an
independent, testable, reversible step.

It was finalized after a **source-verification pass** (three code-reading agents) and
a **two-voice review** (an engineering plan review + a `codex` outside voice that
independently read the code). The review produced four architecture decisions (D1–D4)
and folded four code-level corrections; it also **dissolved three** of codex's
findings outright, because the chosen architecture removes the code they pointed at.

### The architecture decision (D1–D4, from the review)

| # | Decision | Choice | Consequence |
| --- | --- | --- | --- |
| **D1** | First milestone boundary | **Proof-only: M1 = S0+S1+S2** | Prove diff-stability before building identity/overlay machinery. S3–S10 deferred to later milestones, each still gated. |
| **D2** | What "RCLL v2" targets | **A NEW engine behind its own top-level UI button** (`pipelineLayoutVariant: "rcll-v2"`) | NOT an in-place edit of the existing `v2` or `rcll` engines. Existing outputs are **untouched → zero regression risk**. "Refactor RCLL" is re-read as "port RCLL's hardened pieces onto the new engine in later milestones." |
| **D3** | Reuse boundary | **Hybrid: reuse pure kernels, fork the loop** | Reuse `computeDepths`, `longestPath`, `dropY`, `segmentsCross`; write the ordering/placement orchestration fresh so the content-stable key is structural and `firstSequence` **never enters the new path**. |
| **D4** | Determinism strategy | **New engine owns its finalize** | The new engine uses a deterministic finalize/icon path (content-derived id/groupId/seed, fixed versionNonce, no wall-clock). Existing engines untouched; unify later. |

### Code-level corrections folded (from verification + codex)

| # | Correction | Anchor (verified) | Disposition |
| --- | --- | --- | --- |
| C-a | **R2 overstated.** Containers MUST overlap their descendants; overlap is illegal only between **non-ancestor** rects + title/content collisions. | `terraformPipelineCollisionDiagnostics.ts:239` (ancestor exemption) | **Folded** into R2/T5. |
| C-b | **R3 vs cyclic.** A cycle cannot be all-forward; the FAS-reversed minimal set is the explicit, styled exception. "Greedy FAS" is a heuristic, **not** provably minimum. | D5/S9 | **Folded** into R3 + S9 wording. |
| C-c | **C1 "by-construction X" is false in the *existing* v2 packer** (sink bundles spill to elastic X at `:380`, commit at `:392`). | `terraformPipelineV2Pack.ts:380,392` | **Dissolved** by D3 — the new engine forks the loop and does **not** reuse `resolveSinkBundles`; C1 holds by construction *in the new engine*. |
| C-d | **Determinism is broader than `seed`** — icon injection randomizes element id, group id, seed, versionNonce, **and a wall-clock timestamp**. | `terraformAwsIcons.ts:132,142,147,158` | **Dissolved** by D4 — the new engine's own finalize neutralizes all of them. |
| C-e | **`firstSequence` has more ordering sites** than first listed (`V2Structure.ts:128,132,179`; cycle tiebreak `LayoutShared.ts:489`). | those anchors | **Dissolved** by D3 — `firstSequence` does not exist in the forked loop. |
| C-f | **S5 mis-seamed + circular order.** `layoutPipelineV2Strict` is the *v2* builder; dep-graph had S6→S5 while S6 needs S5. | `terraformPipelineLayoutV2.ts:115`; `terraformLayoutCore.ts:537` | **Folded** — S5 targets the **new engine's** entry; order corrected to **S1→S5→S6**. |
| C-g | **S8 over-claimed.** The packer emits one placement (no candidates to "rank"); `countPlacedCrossings` (`…RcllCrossingMin.ts:122`) is segment–segment, not segment–rect. | `terraformPipelineRcllCrossingMin.ts:122` | **Folded** — R4 softened to *measure + not-regress*; S8 builds a net-new segment-vs-rect pierce metric. |

---

## §0 Required reading & decision history (read before implementing)

An implementing agent SHALL read, in this order, before writing code:

1. **THIS spec, end-to-end** — the contract.
2. **[`rcll-v2-architecture-decision.md`](./rcll-v2-architecture-decision.md)** — the
   4-round shit-test that produced the approach (why depth-pinned X; why *not* elkjs;
   why model-order over stateful anchoring; why R4 = container-pierce, not edge count).
   Read for the **WHY** behind every constraint here.
3. **[`rcll-v2-foundation-spec.md`](./rcll-v2-foundation-spec.md)** — decision provenance
   (D1–D8, F1–F10 lineage) and the adversarial-critic resolutions.
4. **The reused-kernel source, before forking** — `computeDepths`
   (`terraformPipelineLayoutShared.ts:485`), `dropY` (`terraformPipelineV2Pack.ts:137`),
   `segmentsCross` (`terraformPipelineRcllCrossingMin.ts`), and the threading boundary
   (`terraformLayoutCore.ts:1012-1061` + `:481-503`).

### Decision history (compressed timeline)

| When | Event | Net result |
| --- | --- | --- |
| 2026-06-20 | Pivot memo: abandon RCLL for "hull-first" v2 | Later found to be the oldest, most-superseded doc |
| 2026-06-23 | Assessment report + engine spec | A-vs-B gated on measurement |
| 2026-06-26 | Rounds 1–3: shit-test + deep research + question-frame audit | Depth-pinned X frame is the correct backbone; crossing-**count** is a 4th-order lever for path-tracing (Ware/Huang/Kobourov) → **R4 = container-pierce, not edge count**; once usage = regenerate-per-PR, **diff-stability becomes the real objective** |
| 2026-06-29 | Round 4: two product facts answered (regenerate every PR; editable seed) | Diff-stability = #1; 8 decisions locked (D1–D8) |
| 2026-06-29 | **This spec** | Normative contract; two-voice review reshaped the build into a **NEW engine (D2)**, **hybrid reuse (D3)**, **own finalize (D4)**; codex folded 4 / dissolved 3 findings |

### Why these algorithms (grounding — see §11 for links)

- **Depth-pinned X** makes R1/R3 structural by construction — the Graphviz `newrank=true`
  / Sander global-frame result. Per-container coordinate *frames* are the anti-pattern
  that produced RCLL v1's cross-account backward edges.
- **Model-Order ordering** (forward predecessor-barycenter with a content key, A2)
  delivers R7 **statelessly** (Domrös & von Hanxleden GD'24); stateful previous-layout
  anchoring (DynaDAG) is path-dependent → **rejected**.
- **Greedy FAS** (A3) is the universal production cycle default (graphviz / dagre / ELK);
  back-edge restyling has HCI backing (Holten & van Wijk CHI'09).
- **Relative-position metric** (A4) measures diff-stability *as a metric* without being a
  stateful layout algorithm (Sondag et al.); the algorithm itself is rejected (path-dep).

---

## §1 Purpose, scope, definitions

### §1.1 Purpose
Specify a **new** pipeline-view layout engine whose output is a **diff-stable,
identity-keyed, structurally-correct function of the Terraform graph**, suitable as an
*editable seed* regenerated on every PR / `terraform plan` / drift, whose user overlays
survive regeneration. The engine ships as a separate variant so the two existing
engines are unaffected.

### §1.2 Scope
**In scope:** the new `rcll-v2` engine — its variant plumbing + top-level UI button,
node ordering, coordinate assignment, identity assignment, deterministic finalize,
constraint input, overlay persistence, cyclic-edge handling, and a configurable
containment schema. **Out of scope:** the existing `v2`/`rcll` engines (untouched),
collaboration transport, Terraform extraction *fidelity*, and import wall-clock perf —
except at named seams.

### §1.3 Definitions
- **TFD** — collapsed Terraform dependency graph; directed edge `u → v` = `u` depends
  on `v`. The *leaf* (resource-level) graph is acyclic in the canonical presets.
- **Hull / cluster** — a containment node or a resource. **Hull tree** = the
  containment hierarchy.
- **Depth** — longest-path topological rank over collapsed TFD edges
  (`computeDepths`, `terraformPipelineLayoutShared.ts:485-512` — *reused kernel*).
- **Column** — clusters sharing a depth; pinned to `columnX[depth]`.
- **Diff-stability** — *small input change ⇒ small, localized output change.* Distinct
  from **pure determinism** (*same input ⇒ byte-identical output*).
- **Container-pierce** — an edge segment crossing a foreign container rectangle it does
  not belong to. The R4 quantity (not raw edge crossings).
- **Ancestor containment** — a container rectangle enclosing its own descendants; this
  is **required**, not an overlap defect (C-a).
- **Overlay** — user state layered on the generated scene (groupings, annotations,
  style edits), persisted keyed by Terraform address.
- **Address** — canonical Terraform address, present as
  `customData.terraformVisibilityKey`, canonicalized by `getTerraformVisibilityKey()`
  (`terraformVisibility.ts:252-263`).

## §2 Conformance language
Key words **MUST/MUST NOT/SHALL/SHALL NOT/SHOULD/SHOULD NOT/MAY** per RFC 2119. A
change is **conformant** iff it satisfies every MUST/SHALL clause it touches and the §7
test tracing to it passes. A clause asserting a code fact carries an anchor `file:line`;
a clause asserting a design choice carries a citation or a requirement back-reference.

## §3 Requirements

| ID | Requirement (the `rcll-v2` engine SHALL…) | Kind |
| --- | --- | --- |
| **R1** | render a hierarchical, left-to-right, **topological** view: a cluster's X column SHALL be its longest-path depth. | structural |
| **R2** | produce **no overlap between non-ancestor rectangles**, and no title-bar/content collisions. Ancestor containers enclosing their descendants is required and is **not** a violation (C-a). | structural |
| **R3** | for **acyclic** TFD, draw **no backward edges**: every edge `u → v` has `v` strictly right of `u`; no same-column TFD edge. For **cyclic** TFD, only the FAS-reversed minimal set (S9) MAY be backward, and each such edge MUST be styled (C10). | structural |
| **R4** | **measure and not regress** container-based crossings — container-pierces + cluster non-contiguity — relative to the engine's own baseline; it SHALL NOT chase raw edge-crossing count. (Softened from "minimize" per C-g: there is no candidate search to minimize over yet.) | aesthetic |
| **R5** | **MAY pack resources to grow width over height** within legal TFD-precedence freedom; SHALL NOT reorder against TFD semantics; SHALL NOT produce excessive width (widen-then-compact). | aesthetic |
| **R6** | be **purely deterministic**: identical input SHALL yield byte-identical output — via the engine's own deterministic finalize (content-derived id/groupId/seed, fixed versionNonce, no wall-clock; C-d/D4). | quality |
| **R7** | be **diff-stable**: a minimal semantic plan change SHALL move content-unchanged clusters by ≤ a bounded threshold (§7 T2). | quality |
| **R8** | assign **stable identity**: `element.id` = pure function of address (+ content-derived ordinal), stable across regenerations. | quality |
| **R9** | **persist user overlays** (groupings, annotations, styles) keyed by address across regeneration; auto-layout owns geometry (manual *positions* not preserved). | quality |
| **R10** | support a **configurable containment schema**; the default schema SHALL reproduce today's AWS taxonomy with zero behavior change. | quality |

## §4 Constraints (invariants)

| ID | Constraint | Rationale / anchor |
| --- | --- | --- |
| **C1** | In the new engine, X **MUST** equal `columnX[depth]` for every cluster. The new engine **MUST NOT** reuse the v2 sink-bundle off-grid spill (`resolveSinkBundles`/`originX`), so C1 holds **by construction** (C-c/D3). | `terraformPipelineV2Pack.ts:380,392` (the spill we do not inherit) |
| **C2** | Structure (R1/R2/R3) **MUST NOT** yield to any grouping/aesthetic preference. Groupings are soft, minimal-displacement, relaxed lowest-priority-first (address tiebreak) whenever they would reverse/flatten a TFD edge on X or close a Y-order cycle. | R4/R5 soft |
| **C3** | No `Math.random`/`Date`/wall-clock anywhere in the new engine's layout **or finalize**, including element id, group id, seed, versionNonce, and timestamps. | C-d; `terraformAwsIcons.ts:132,142,147,158` (the shared path the new engine must NOT use as-is) |
| **C4** | Every ordering sort in the new engine **MUST** terminate in a content-derived total-order tiebreak (address `localeCompare`) and **MUST NOT** use any file-position counter. `firstSequence`/`edge.sequence` do not exist in the new path (C-e/D3). | `terraformDeclaredDataFlow.ts:218,282-283` (the counter we avoid) |
| **C5** | `element.id` **MUST** be a pure function of address (+ content-derived ordinal); never `randomId()`. The new engine's finalize assigns ids; it **MUST NOT** route through `convertToExcalidrawElements(..., {regenerateIds:true})` followed by random icon injection. | `terraformPipelineLayoutFinalize.ts:98-99`; `transform.ts:641-650` (silent drop on collision) |
| **C6** | The engine is a **top-level opt-in**: selecting any other variant leaves behavior byte-identical to today. Within the engine, an output-changing step **SHOULD** still be flag-guarded until its gate passes; the variant + button **MUST** thread through both the `sceneContext` literal and the `applyRcllToggleGuards` call or it is dropped on the worker path. | `terraformLayoutCore.ts:1012-1061`, `:481-503`, hazard `:1044-1047` |
| **C7** | Feasibility probing **MUST** be non-mutating; only the accepted candidate is committed. | `applyDepthFloorIfValid` dual-writes `:606,:608` |
| **C8** | A keep-together/same-band group spanning different hulls **MUST NOT** be a rigid block (would pierce hull nesting = R1 violation); cross-hull groups get Y-cohesion bias only. | C2; R1 |
| **C9** | A removed resource **MUST** appear exactly once (no stale survivor + orphan ghost). | `reconcile.ts:103-107` re-append risk |
| **C10** | For cyclic input, the FAS-reversed minimal set **MUST** be reversed and drawn with distinct back-edge styling; all non-reversed edges stay strictly L→R. | D5/C-b |

## §5 Architecture (normative model)

### §5.0 Engine shape (D2/D3/D4)
`rcll-v2` is a **new variant + new top-level UI button**. It is a **hybrid**: it
**reuses pure kernels** — `computeDepths`/`longestPath` (ranking),
`dropY`/skyline (Y placement), `segmentsCross` (geometry) — and **forks the ordering
and placement orchestration** into a fresh module so no `firstSequence` enters the
path. It uses its **own deterministic finalize** (icons, ids, seeds) rather than the
shared random injection. Existing engines are not modified.

```
TFD ─▶ [reuse] computeDepths/longestPath ──▶ depth (X = columnX[depth])   (R1/R3, C1)
    ─▶ [FORK]  content-stable ordering loop ─▶ within-column Y order        (R7, C4)
    ─▶ [reuse] dropY skyline ───────────────▶ non-overlap placement        (R2)
    ─▶ [FORK]  deterministic finalize ──────▶ ids/seeds/icons (no random)   (R6/R8, C3/C5)
```

### §5.1 Coordinate model
X is structural and fixed by depth (`X = columnX[depth]`). Depth changes only when a
cluster's critical-path length changes — localized, bounding R7's X churn. Y is the free
dimension carrying R2/R4/R5.

### §5.2 Ordering model (heart of R7)
Within-column Y order **SHALL** be a pure function of content (Model-Order principle,
Domrös & von Hanxleden GD'24 — small input delta ⇒ small output delta, **statelessly**).
Stateful previous-layout anchoring (DynaDAG/Sondag/cola.js) is **rejected**
(path-dependent). The content-derived key **SHALL** be:
1. **predecessor-address barycenter** — sorted tuple of in-column predecessors' addresses
   (keeps same-source siblings adjacent → aids R4), then
2. **own Terraform address** (`localeCompare`) as the total-order tiebreak.

### §5.3 Identity model (R8)
Business key = address. Derived id `element.id = tf:<role>:<address>[:#<ordinal>]`,
`role ∈ {node,frame,label,icon,edge,dup}`, ordinal content-derived. Edges keyed by
**sorted endpoint addresses**, never `sequence`. Assigned in the new engine's finalize.

### §5.4 Cyclic handling (C10)
A genuine leaf cycle **SHALL** be repaired by **deterministic greedy FAS** (Eades–Lin–
Smyth 1993 — heuristic, **not** provably minimum, C-b): reverse the chosen arc set
(address tiebreak), rank the acyclic remainder, draw reversed arcs in true direction
with distinct styling.

## §6 Implementation steps

Steps are **independent, testable, reversible**, grouped into milestones. Within a
milestone, execute **in order**; do not start a step until its preconditions hold.
Each step: **Goal · Preconditions · Change · Files · Acceptance test · Rollback.**

```
Dependency graph (corrected per C-f — S5 BEFORE S6):
M1: S0 (engine scaffold) ─▶ S1 (ordering key) ─▶ S2 (churn metric/test)
M2+: S3 (identity) ─┬▶ S7 (overlay/diff/orphan)
                    └▶ S4 (pure gate) ─▶ S5 (constraint path) ─▶ S6 (keep-together)
     S8 (pierce metric), S9 (cyclic FAS), S10 (schema)  — independent, schedule freely
```

### Milestone 1 — prove diff-stability (S0 + S1 + S2)

#### S0 — Engine scaffold *(net-new; the D2/D3/D4 substrate)*
- **Goal:** a selectable `rcll-v2` engine that produces a correct depth-pinned layout by
  reusing pure kernels with a forked loop and its own deterministic finalize.
- **Preconditions:** none.
- **Change:** (1) add `"rcll-v2"` to `pipelineLayoutVariant` and a **new top-level UI
  button** at the pipeline-view variant control; (2) thread the variant through **both**
  the `sceneContext` literal and `applyRcllToggleGuards` (C6); (3) new module
  `terraformPipelineRcllV2*.ts` that calls reused kernels (`computeDepths`,
  `longestPath`, `dropY`, `segmentsCross`) and a **forked** ordering/placement loop; (4)
  a **deterministic finalize** (content-derived id/groupId/seed, fixed versionNonce, no
  `Date`/`Math.random`; **does not** call the shared random icon injection as-is).
- **Files:** new `terraformPipelineRcllV2*.ts`; variant plumbing
  `terraformLayoutCore.ts:1012-1061`, `:481-503`, dispatch near `:537`; UI button at the
  variant control (locate the `pipelineLayoutVariant` selector seam); reused kernels in
  `terraformPipelineLayoutShared.ts` (`computeDepths` `:485`), `…V2Pack.ts` (`dropY`
  `:137-160`), `…RcllCrossingMin.ts` (`segmentsCross`).
- **Acceptance test:** T1 (byte-determinism for the new engine), plus a smoke test that
  the button renders a valid, overlap-free (R2) scene on `staging-extended-localstack-v2`.
- **Rollback:** remove the variant/button; zero impact on existing engines.

#### S1 — Content-stable within-column ordering *(D1/the thesis)*
- **Goal:** R7; the forked loop orders by §5.2 (no `firstSequence` to remove — C-e/D3).
- **Preconditions:** S0.
- **Change:** implement `orderKey(cluster)` = predecessor-address-barycenter then
  own-address; the forked placement loop consumes it as the sole within-column key.
- **Files:** the new engine's ordering module; reuse depth + `localeCompare`.
- **Acceptance test:** T2 (diff-stability) passes; T1 still passes.
- **Rollback:** swap `orderKey` for a trivial address-only sort (still content-stable).

#### S2 — Diff-stability metric + test *(gates S1)*
- **Goal:** make R7 measurable.
- **Preconditions:** S1.
- **Change:** add a **per-address relative-position-change** metric (Sondag's measure,
  used as a metric, not an algorithm) and a regression test: lay out a plan, then a
  **minimally-changed** plan (add one resource / one edge / `moved{}` rename), assert
  churn for content-unchanged clusters < threshold. **Field-scope** the comparison to
  geometry + ordering. Keep the run-twice deep-equal test (T1) but annotate it as
  **insufficient** for R7.
- **Files:** new test beside `terraformPipelineSemanticAudit.test.ts`; metric helper in
  diagnostics.
- **Acceptance test:** T2.
- **Rollback:** remove the test.

### Milestone 2+ — identity, overlays, constraints, polish (S3–S10)

#### S3 — Full identity contract *(R8; partially seeded by S0)*
Promote S0's deterministic ids to the full `tf:<role>:<address>[:#<ordinal>]` scheme
with edges keyed by sorted endpoints; build the `oldId→newId` rewrite of every
reference field (`boundElements[].id`, `containerId`, `frameId`, `start/endBinding`),
dev-assert no dangling refs; content-derived ordinal for collisions (never positional).
**Files:** new engine finalize; `transform.ts:641-650` (avoid the silent-drop path);
`terraformVisibility.ts:252-263`. **Test:** T3.

#### S4 — Pure feasibility gate *(C7)*
Extract the inline predicate (`terraformPipelineLayoutShared.ts:598-601`) as
`isDepthFloorValid(...): boolean` — no mutation; the new engine's relax loop probes with
it, commits only the accepted candidate via `applyDepthFloorIfValid`. **Test:** unit
parity + no-mutation assertion.

#### S5 — Single constraint-input path *(C-f: new-engine seam, BEFORE S6)*
The **new engine's** layout entry gains `groupConstraints: PipelineGroupConstraint[]`,
threaded through both boundary sites (C6). **Not** `layoutPipelineV2Strict` (that's the
v2 builder). Finalize handles only styles/annotations/diff-status (no geometry).
`PipelineGroupConstraint = { groupId; kind: "keep-together"|"align"|"same-band"|
"order-after"; members: address[]; priority; axis? }`. **Test:** T5 + a curlable proof
the constraint reaches the engine. **Precondition:** S1, S4.

#### S6 — Keep-together as single-column Y-adjacency *(C8)*
Same-column grouped members → contiguous skyline slots (adjacent in `dropY`), X never
moves. Cross-column cohesion/align/same-band = best-effort shared `startY` bias,
surfaced `relaxed` when unmet. `order-after`/same-column = longest-path sepEdge via the
`computeGlobalSeparatedFloor` template (`…RcllRankSeparate.ts:218-285`), probed with
S4, cycles caught by `constraintGraphHasCycle` (`:128`). Cross-hull groups = Y-cohesion
only (C8). The new engine does **not** reuse `resolveSinkBundles` (C1). **Test:** T5,
T6. **Precondition:** S1, S4, S5.

#### S7 — Overlay persistence + semantic diff + orphan handling *(R9/C9)*
App-level `TerraformOverlayStore` (`excalidraw-app/data`), keyed by **address**:
`{schemaVersion; derivationVersion; groupings[{id,memberAddresses,label?}];
annotations[{id,anchorAddress,anchorRole?,offset,skeleton}]; styles: Record<address,
Partial<StyleProps>>; priorHashes: Record<address,string>}`. `groupId` content-stable
and **independent of member set**. `applyTerraformOverlays` (styles merged last;
annotations at anchor-bbox+offset; groupings → packer via S5). `computeTerraformDiff` =
per-address **plan-model content hash** over an allowlist (attrs + incident edges +
parent), **excluding `x/y/w/h/seed/version`**; tag `customData.terraformDiffStatus`.
**Orphan (C9):** replace-by-canonical-id (ghost reuses `tf:node:<addr>`) or bypass collab
reconcile on regenerate — `reconcile.ts:103-107` re-appends unmatched locals;
`bumpElementVersions` (`restore.ts:878-901`) acts only on id match. **Rename:** old→new
only via `moved{}`; else remove(orphan)+add + non-destructive "suggest re-anchor."
**Spike:** confirm `moved{}` is in the consumed input; if usually absent, the orphan
tray is the primary rename UX. **Test:** T3, T4. **Precondition:** S3.

#### S8 — R4 container-pierce metric *(C-g; measure-first)*
Build a **net-new segment-vs-rectangle pierce counter** (not `countPlacedCrossings`,
which is segment–segment in `…RcllCrossingMin.ts:122`): for each edge, count foreign
frame rects its routed segment crosses (exclude own-ancestor frames). Use it as a
**reported diagnostic + a not-regress gate** (R4). Candidate-generation + ranking
("minimize via search") is a **separate later step**, not assumed here (C-g). **Test:**
T6. **Precondition:** S0.

#### S9 — Cyclic-leaf repair: FAS + restyle *(C10/C-b)*
Deterministic greedy FAS over the collapsed leaf TFD (heuristic, not provably minimum);
reverse the chosen arcs (address tiebreak), longest-path the remainder, draw reversed
arcs in true direction with distinct styling (reuse RCLL EXT-12). All others strictly
L→R. **Files:** new engine's depth step; `computeDepths` cyclic fallback
(`terraformPipelineLayoutShared.ts:501,508-510`) for reference. **Test:** T7.

#### S10 — Configurable containment schema *(R10)*
Replace the hardcoded 6-level AWS role enum (`topologyPathForCluster`) with an ordered
list of level descriptors (matcher + per-level policy: banded vs packed, gap, title).
**Default schema reproduces today's AWS taxonomy exactly.** **Files:**
`topologyPathForCluster` + enum; `buildHullTree` (`terraformPipelineV2Structure.ts`).
**Test:** T8.

## §7 Verification (conformance matrix)

| Test | Asserts | Method |
| --- | --- | --- |
| **T1** | R6/C3 determinism | new engine: run-twice on identical input → byte-deep-equal; static check: no `Math.random`/`Date` in the new engine's layout+finalize |
| **T2** | R7 diff-stability | minimally-changed plan → per-address `|Δpos|` for unchanged clusters < threshold (geometry+ordering scoped); deep-equal alone **not** accepted |
| **T3** | R8/C5 identity | every reference field resolves; no dangling id; ids stable across regeneration |
| **T4** | C9 no double-representation | removed resource appears exactly once |
| **T5** | C2/C7 constraints | relaxation reproducible; groups never produce non-ancestor overlap (R2) or backward edge (R3); forwarded constraints reach the engine |
| **T6** | R4/R2 | pierce metric does not regress vs the engine's own baseline; no non-ancestor overlap introduced |
| **T7** | R3/C10 | acyclic → strict-forward; cyclic fixture → styled, deterministic back-edges |
| **T8** | R10 | default-schema snapshot == current AWS output |

**Conformance rule.** A step lands iff its acceptance test(s) pass and T1 still passes.
**M1 exit gate: T2 passes on the canonical preset** — that is the proof the milestone
exists to produce.

## §8 Non-goals / deferred (with reason)

- **In-place edits to `v2`/`rcll`** — out by D2 (new engine, zero blast radius). Porting
  RCLL's hardened ancillary/gates onto `rcll-v2` is later-milestone work.
- **R4 crossing-min *search*** (generate + rank candidates) — C-g: the engine emits one
  placement today; searching is post-Foundation, default-OFF.
- **R5 grid-packing** of TFD-independent resources — D3 keeps widen-then-compact; the
  grid-pack lever stays OFF until it passes T2 (membership-sensitive → fights R7).
- **Unifying the deterministic finalize across all three engines** — D4 isolates it in
  `rcll-v2` first; fix-at-source for `v2`/`rcll` is a later consolidation (re-baselines
  their snapshots).
- **Pattern/predicate group membership** — explicit address lists only in v1.
- **elkjs** — dropped (not bit-reproducible → fails R6).
- **Open spike (blocks S7 rename only):** is `moved{}` present in the consumed input?

## §9 Traceability & provenance

### §9.1 Requirement ↔ constraint ↔ step ↔ test
| Requirement | Constraints | Step(s) | Test(s) |
| --- | --- | --- | --- |
| R1 | C1 | S0 | T7 (forwardness), smoke |
| R2 | C2, C8 | S0, S6, S8 | T5, T6 |
| R3 | C1, C2, C10 | S6, S9 | T5, T7 |
| R4 | C2 | S8 | T6 |
| R5 | C2 | deferred (D3 keep current) | T2 |
| R6 | C3 | **S0** (own finalize) | T1 |
| R7 | C4 | **S1**, S2 | **T2** |
| R8 | C5 | S0→S3 | T3 |
| R9 | C9 | S5, S7 | T3, T4 |
| R10 | — | S10 | T8 |
| (enablers) | C6, C7 | S0, S4, S5 | T5 |

### §9.2 Provenance
- **Architecture/research:** `rcll-v2-architecture-decision.md` (4 rounds) + the absorbed
  `rcll-v2-foundation-spec.md`.
- **Source verification (2026-06-29):** three code-reading agents confirmed the
  diff-instability, identity/reconcile, and layout/constraint seams.
- **Two-voice review (2026-06-29):** engineering plan review (D1–D4) + a `codex` outside
  voice (7 findings; 3 dissolved by the architecture, 4 folded). Cited anchors SHOULD be
  spot-checked at edit time (line numbers drift).

### §9.3 Key sources
See **§11 References** — every algorithm in §10 and every rejected alternative is linked
and annotated there.

## §10 Algorithms (normative pseudocode)

This appendix specifies every algorithm the steps invoke, precisely enough to implement
without re-deriving from the papers. Reused kernels are marked **[reuse]**; net-new code
is marked **[new]**. Every tiebreak is a content-derived `localeCompare` on the Terraform
address — there are no positional/file-order tiebreaks anywhere (C4).

### A1 — Depth (X column) **[reuse: `computeDepths`, `terraformPipelineLayoutShared.ts:485-512`]**
```
input:  collapsed TFD edges E (u→v = "u depends on v"), cluster ids V
depth(v) = 0                       if v has no in-edge
         = 1 + max(depth(u) for u→v ∈ E)   otherwise      // longest-path rank
compute via Kahn topological order (the longestPath kernel).
X(v) = columnX[depth(v)]           // C1; the new engine MUST NOT spill off this grid
```
**Cyclic caveat:** the topo pass leaves cycle members unresolved (the existing kernel
clamps them to a file-position value — the determinism leak we avoid). Therefore the new
engine MUST run **A3 first** so the graph handed to A1 is already acyclic and no clamp
fires. (Grounds R1/R3; Sander 1996, Graphviz `newrank`.)

### A2 — Within-column Y order **[new: S1 — the diff-stability primitive]**
A single forward (predecessor) barycenter pass with a content key. Process columns
left→right so every predecessor already has an ordinal.
```
for depth d = 0, 1, 2, … (ascending):
  for each cluster c with depth(c) = d:
    preds = { p : edge p→c ∈ E and depth(p) < d }          // already-ordered upstreams
    if preds is empty:                                       // a source in this column
      key(c) = (SOURCE_BUCKET = -1, ownAddress(c))
    else:
      bary(c) = mean{ ordinal(p) : p ∈ preds }              // NUMERIC mean of upstream ranks
      key(c) = (bary(c), sortedAddressTuple(preds), ownAddress(c))
  stable-sort the column ascending by key:
      numeric bary  →  lexicographic predecessor-address tuple  →  ownAddress.localeCompare
  assign ordinal(c) = 0, 1, 2, … in that sorted order
```
**Why it is diff-stable (R7):** `key(c)` is a pure function of `(E, addresses)`. Editing
an edge that does not touch `c` or `c`'s predecessors cannot change `key(c)` ⇒ `c`'s
ordinal is unchanged. `SOURCE_BUCKET` orders sources by address only — the maximally
stable choice (we prioritize R7 over R4). **Disambiguation:** "barycenter" here is the
**numeric mean of predecessor ordinals**, *not* a string operation; the sorted-address
tuple is only the *tiebreak*. **Deferred refinement (§8):** a bidirectional sweep that
also folds in *successor* barycenter reduces crossings (R4) at some R7 cost — NOT in S1.
(Grounds R7; Domrös & von Hanxleden GD'24, classic Sugiyama barycenter.)

### A3 — Cycle repair: deterministic greedy FAS **[new: S9 — Eades–Lin–Smyth 1993]**
Heuristic, **not** provably minimum (an exact min-FAS is NP-hard).
```
build a linear vertex order s over the cyclic leaf graph:
  leftSeq = [], rightSeq = []
  repeat until no vertices remain:
    while ∃ sink (outdeg = 0):   v = address-least such; prepend v to rightSeq; remove v
    while ∃ source (indeg = 0):  v = address-least such; append  v to leftSeq;  remove v
    if vertices remain:          v = argmax(outdeg(v) - indeg(v)), ties → address-least
                                 append v to leftSeq; remove v
  s = leftSeq ++ reverse(rightSeq)            // a total order
feedback set F = { edge u→v ∈ E : index_s(u) > index_s(v) }
reverse every edge in F  →  graph is now acyclic; run A1 on it.
render: edges in F drawn in TRUE direction (right→left) with distinct back-edge styling (C10);
        all edges ∉ F stay strictly L→R (R3).
```
(Grounds R3/C10; Eades–Lin–Smyth 1993; back-edge encoding Holten & van Wijk CHI'09.)

### A4 — Diff-stability metric **[new: S2/T2 — Sondag relative-position-change, as a METRIC]**
```
input:  L_old = layout(P_old), L_new = layout(P_new)   // P_new = minimal semantic delta
U = { addresses present in both AND content-unchanged }          // the diff allowlist (S7 hash)
for a ∈ U:  Δ(a) = || pos_new(a) - pos_old(a) ||                 // geometry+ordering scoped
report: median Δ, p95 Δ, ordinalFlips = #{ a,b ∈ U : sign(ord_old) ≠ sign(ord_new) }
PASS iff (median Δ, p95 Δ, ordinalFlips) < thresholds
```
The run-twice deep-equal test (T1) proves **determinism only** and MUST NOT be cited for
R7. (Grounds R7/T2; Sondag, Speckmann, Verbeek 2018 — the *metric*, not the stateful
treemap algorithm.)

### A5 — Container-pierce metric **[new: S8 — NOT `countPlacedCrossings`]**
`countPlacedCrossings` (`terraformPipelineRcllCrossingMin.ts:122`) is segment–segment;
R4 needs segment–rectangle.
```
pierces = 0
for each routed edge segment e:
  for each frame rect f with f ∉ ancestorFrames(e.source) ∪ ancestorFrames(e.target):
    if segmentIntersectsRect(e, f):    pierces += 1      // reuse segmentsCross vs f's 4 edges
report pierces;  gate = "does not regress vs the engine's own baseline" (R4, soft)
```
(Grounds R4; container-pierce is the path-tracing-relevant quantity, Ware/Huang/Kobourov.)

### A6 — Deterministic finalize: id / seed / group **[new: S0/S3 — replaces random injection]**
Replaces the random id/groupId/seed/versionNonce/timestamp injection
(`terraformAwsIcons.ts:132,142,147,158`) that C3/C5 forbid in the new path.
```
stableId(role, address, ordinal?) = "tf:" + role + ":" + address + (ordinal != null ? ":#" + ordinal : "")
edgeId(a, b)                       = "tf:edge:" + [a, b].sort().join("__")          // endpoint-sorted
seed                               = hashToSeed(stableId)   // e.g. FNV-1a(stableId) & 0x7fffffff
groupId(stableGroupKey)            = "tfg:" + stableGroupKey                         // member-set-INDEPENDENT (S7)
versionNonce = 0 ;  version = 1 ;  NO Date.now() / `updated` timestamp ;  NO Math.random
```
roles ∈ {node, frame, label, icon, edge, dup}; ordinal is content-derived (e.g. the
satellite's own sub-address), never a positional index. (Grounds R6/R8; C3/C5.)

## §11 References (linked, annotated)

### Implemented in §10 (the algorithms we build)
- **Domrös & von Hanxleden 2024 (GD'24)**, *Diagram Control and Model Order for Sugiyama
  Layouts* — stateless model-order stability; grounds **A2 / R7**.
  <https://arxiv.org/abs/2406.11393>
- **Domrös & Riepe 2024 (GD'24)**, *Determining Sugiyama Topology with Model Order* —
  deterministic order-preserving Sugiyama; companion to A2.
  <https://drops.dagstuhl.de/storage/00lipics/lipics-vol320-gd2024/LIPIcs.GD.2024.48/LIPIcs.GD.2024.48.pdf>
- **Eades, Lin, Smyth 1993**, *A fast and effective heuristic for the feedback arc set
  problem* — grounds **A3 / S9** (greedy, heuristic, not minimum).
  <https://doi.org/10.1016/0020-0190(93)90079-O>
- **Sondag, Speckmann, Verbeek 2018**, *Stable Treemaps via Local Moves* (IEEE TVCG) —
  relative-position-change as the **A4 / T2** metric (algorithm itself rejected).
  <https://ieeexplore.ieee.org/document/8019841/>
- **Holten & van Wijk 2009 (CHI)**, *A user study on visualizing directed edges* —
  back-edge restyling reads direction best; grounds A3's rendering. <https://doi.org/10.1145/1518701.1519054>

### Foundational (grounds the model: §5, R1/R3/R4)
- **Sander 1996**, *Layout of Compound Directed Graphs* — global base-node ranking +
  border nodes; the canonical compound-layered source (reused `computeGlobalSeparatedFloor`).
  <https://publikationen.sulb.uni-saarland.de/bitstream/20.500.11880/25862/1/tr-A03-96.pdf>
- **Gansner et al. 1993 (TSE93)**, *A Technique for Drawing Directed Graphs* —
  network-simplex ranking; forwardness as a consequence of layering. <https://www.graphviz.org/documentation/TSE93.pdf>
- **Graphviz `newrank`** — one global rank fixes recursive-cluster backward edges
  (the depth-pinned-X result). <https://graphviz.org/docs/attrs/newrank/>
- **ELK `hierarchyHandling`** + arXiv:2311.00533 — `INCLUDE_CHILDREN` global frame is
  "invasive"; ELK defaults decoupled (validates our decoupled by-construction design).
  <https://eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html> · <https://arxiv.org/abs/2311.00533>
- **Ware, Purchase, Colpoys, McGill 2002**, *Cognitive Measurements of Graph Aesthetics*
  — for path-tracing, continuity/path-length outrank crossings (grounds **R4** demotion of
  edge count). <https://eprints.gla.ac.uk/14111/>
- **Huang, Hong, Eades 2008/2014**, *Effects of Crossing Angles* — crossing *angle* >
  count; near-orthogonal crossings ~free. <https://ieeexplore.ieee.org/document/4475457>
- **Kobourov, Pupyrev, Saket 2014 (GD'14)**, *Are Crossings Important for Drawing Large
  Graphs?* — crossings not significant at scale (grounds R4). <https://www2.cs.arizona.edu/~kobourov/crossings.pdf>

### Rejected (and why — do not implement)
- **North & Woodhull 2001 (GD'01)**, *Online Hierarchical Graph Drawing* (DynaDAG) —
  stable layout via a **previous-layout anchor** → path-dependent, breaks R6/R7
  reproducibility. <https://graphviz.org/documentation/NW01.pdf>
- **Dwyer, Marriott, Stuckey 2005 (GD'05)**, *Fast Node Overlap Removal* (VPSC) — its
  *feasibility theory* informs the constraint policy, but the force-directed solver is
  **not** adopted (non-deterministic). <https://link.springer.com/chapter/10.1007/11618058_15>
- **Adaptagrams libcola / IPSep-CoLa** — constraint solvers; declined as primary
  (non-deterministic; soft constraints silently violate → re-add backward edges).
  <https://www.adaptagrams.org/documentation/libcola.html>
- **elkjs** — ELK in JS; correct algorithm set but **not bit-reproducible across
  versions** → fails R6. <https://github.com/kieler/elkjs>

### Internal companion docs (the WHY)
- [`rcll-v2-architecture-decision.md`](./rcll-v2-architecture-decision.md) — 4-round
  rationale + the full literature trail.
- [`rcll-v2-foundation-spec.md`](./rcll-v2-foundation-spec.md) — D1–D8 / F1–F10 provenance.
