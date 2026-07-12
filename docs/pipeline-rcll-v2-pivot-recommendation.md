# RCLL V2 Pivot Recommendation

> **⚠️ Superseded by [`rcll-v2-architecture-decision.md`](./rcll-v2-architecture-decision.md) (2026-06-26).** This memo (the _oldest_ of the RCLL document cluster) is kept as a dated research artifact. Two of its load-bearing claims have since been corrected:
>
> - Its central premise — "RCLL ranks each hull in an independent frame → backward edges" — describes the **superseded round-3 state**; round-4's `computeGlobalSeparatedFloor` already ranks all leaves in one global frame (decision doc CORR-1).
> - Its "Proposed Next Step #1" (import `rankSeparate`'s all-to-all leaf separation into v2) is **redundant and harmful** — v2 already has global ranking and gets forwardness by construction for acyclic dataflow; all-to-all separation just re-adds +28 % width / +45 % crossings (decision doc CORR-3). Read the decision doc for the current verdict, the canonical-literature citations, Options A–D, and the gating measurements (Q1–Q4). The body below is unchanged.

| Field | Value |
| --- | --- |
| Status | **Superseded** (research artifact) — see [`rcll-v2-architecture-decision.md`](./rcll-v2-architecture-decision.md) |
| Date | 2026-06-20 |
| Scope | Pipeline view layout architecture |
| Related RFC | [`pipeline-rcll-layout-design.md`](./pipeline-rcll-layout-design.md) |


## Document graph

| Relation | Link |
| --- | --- |
| Role | Superseded |
| Status | Superseded by `rcll-v2-architecture-decision.md` — research artifact only |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`pipeline-rcll-layout-design.md`](./pipeline-rcll-layout-design.md) |
| Children | [`rcll-v2-architecture-decision.md`](./rcll-v2-architecture-decision.md) |
| Sisters | — |
| Next (agent) | Do not build from this body; open architecture-decision for corrected verdict. |

## Executive Recommendation

Pivot away from the current RCLL rule stack and use a hull-first architecture for the next layout generation.

The important correction is this:

> Hulls should be modeled first, but not independently fixed first.

The layout should build the topology hull tree first, lift TFD edges to hull units, identify co-axial hull groups, then assign X ranks from one global leaf/resource dependency graph. Hull rectangles should be derived bottom-up from the ranked and placed children.

Do not rank or place each hull interior in its own independent coordinate frame. That is the failure mode that produced cross-account backward edges in the current RCLL experiments.

## Hard Constraints

- X is horizontal.
- Y is vertical.
- TFD dependency order is the semantic spine of the diagram and must never be broken.
- A TFD edge `u -> v` must render with `v` to the right of `u`; same-column TFD edges are not acceptable.
- Every resource belongs to a hull hierarchy: `provider -> account -> region -> vpc -> subnet -> resource`.
- Hulls inherit both nesting hierarchy and dependency relationships from their descendant resources.
- Bidirectional sibling hulls are co-axial: they cannot be forced into a strict left-to-right order as rigid hulls.
- Co-axial hulls must share a global rank frame so their internal resources move consistently.
- More horizontal is preferred over more vertical, but only inside the legal freedom left by TFD precedence.

## Why The Current RCLL Shape Is Fragile

The current RCLL design has accumulated too many special-case rules:

- forced bands,
- swimlane lanes,
- lane rise,
- rank separation,
- subnet de-band,
- straightening,
- de-density,
- crossing reorder,
- toggle guards,
- documented dead ends and reversals.

The individual pieces are often defensible, but the architecture is difficult to reason about because it mixes three concerns:

1. semantic topology containment,
2. TFD left-to-right dependency ranking,
3. height/width compaction.

The clearest failure record is the round-3 `rankSeparate` attempt. It correctly recognized bidirectional account hulls as co-axial, but it still re-ranked each account interior in a separate local frame. Cross-account resource edges then linked differently shifted interiors and produced backward/same-column TFD edges.

Round 4 fixed that by switching to one whole-model global leaf ranking: every real leaf edge, including cross-account edges, participates in the same rank frame. That is the right direction.

See:

- [`terraformPipelineRcllRankSeparate.ts`](../packages/excalidraw/components/terraformPipelineRcllRankSeparate.ts)
- RFC decision `DI-DEB-6` in [`pipeline-rcll-layout-design.md`](./pipeline-rcll-layout-design.md)

## Literature Read

The relevant graph-layout literature supports the global-leaf / derived-container model.

Sander's compound directed graph layout is the key source. The important idea is not "recursively lay out each subgraph in isolation"; it is to treat the compound hierarchy and connectivity together, assign layers to base nodes, and derive cluster spans/borders from the base nodes. That matches the round-4 fix.

Forster's compound crossing-reduction work supports applying crossing reduction while respecting hierarchy. It does not rescue independent local ranking when edges cross hull boundaries; those edges still need to be represented in the shared layout problem.

ELK Layered and dagre practice point in the same direction: layered layout phases are ordered as rank/layer assignment, crossing reduction, coordinate assignment, routing, with compound hierarchy included in the graph model rather than bolted on afterward.

References:

- Georg Sander, [_Layout of Compound Directed Graphs_](https://publikationen.sulb.uni-saarland.de/bitstream/20.500.11880/25862/1/tr-A03-96.pdf), 1996.
- Michael Forster, [_Applying Crossing Reduction Strategies to Layered Compound Graphs_](https://link.springer.com/content/pdf/10.1007/3-540-36151-0_26.pdf), GD 2002.
- Eclipse Layout Kernel, [ELK reference](https://eclipse.dev/elk/reference.html).
- dagre, [wiki / layout notes](https://github.com/dagrejs/dagre/wiki).

## Existing Code Evidence

There is already a better seed architecture in the codebase: `pipelineVariant:"v2"`.

Relevant files:

- [`terraformPipelineV2Structure.ts`](../packages/excalidraw/components/terraformPipelineV2Structure.ts)
- [`terraformPipelineV2Pack.ts`](../packages/excalidraw/components/terraformPipelineV2Pack.ts)
- [`terraformPipelineLayoutV2.ts`](../packages/excalidraw/components/terraformPipelineLayoutV2.ts)

This implementation is much closer to the desired hull-first architecture:

- builds a semantic hull tree;
- treats each hull's direct children as layout units;
- lifts global TFD edges onto sibling hull/cluster units;
- classifies each hull as `flow` or `pack`;
- recursively places hull blocks and leaf cards;
- derives frame rectangles from placed resources;
- keeps TFD order pinned to global depth columns.

Measured on `staging-extended-localstack-v2`, compact mode:

| Variant | Bounds | Aspect | Crossings | TFD violations | Collisions |
| --- | --: | --: | --: | --: | --: |
| Classic | `8038 x 18522` | `0.43` | `249` | `0` | `0` |
| `pipelineVariant:"v2"` | `9998 x 10056` | `0.99` | `177` | `0` | `0` |

Targeted tests passed:

```bash
yarn vitest run packages/excalidraw/components/terraformPipelineLayoutV2.test.ts \
  packages/excalidraw/components/terraformPipelineRankSeparate.test.ts \
  packages/excalidraw/components/terraformPipelineRcllRankSeparate.test.ts
```

## Recommended RCLL V2 Architecture

Use this model:

```text
input clusters + TFD edges
  -> build hull tree
  -> lift TFD edges to sibling hull units at each LCA
  -> identify bidirectional sibling hull SCCs
  -> compute one global leaf/resource X rank
  -> add hull-derived separation constraints only where legal
  -> place resources within hulls
  -> derive hull rectangles from descendant boxes
  -> pack independent / one-way-safe hull blocks in Y
  -> emit frames, resource cards, TFD edges, hull connector edges
```

### Core Rules

1. Rank leaves globally.

   Every resource/cluster participates in one TFD rank assignment. If a resource edge crosses accounts, regions, VPCs, or subnets, it is still a normal edge in the same global rank frame.

2. Derive hull spans from leaves.

   A hull's X span is the min/max X of descendant leaves plus padding. A hull should not receive an independent X rank that can drift away from its resources.

3. Lift edges for hull decisions.

   For each hull, project descendant TFD edges onto its direct child units. These lifted edges decide whether sibling hull units are independent, one-way ordered, or bidirectional/co-axial.

4. Keep bidirectional hull SCCs co-axial.

   If sibling hulls have flow both ways, they cannot be rigidly ordered left-to-right as hulls. They must share a rank frame and move as one co-axial group.

5. Separate one-way hulls with leaf constraints.

   For a one-way sibling hull edge `A -> B`, add separation at leaf granularity when needed:

   ```text
   for every a in leaves(A), b in leaves(B):
     rank(a) < rank(b)
   ```

   This is expensive in width, so it should be gated and measured, but it is the correct legal form.

6. Pack in Y only after X legality is settled.

   Height reduction is a packing problem over already legal X spans. If two hull blocks are X-disjoint, they can share a Y band. If their X spans overlap, they stack.

7. Draw membership separately from containment when useful.

   Subnet de-band is a good example: collapse subnet boxes to reclaim height, then render subnet membership as lightweight chips/rails/legend rather than overlapping group boxes.

## What To Keep

Keep these ideas from RCLL:

- CON-12: no acyclic backward edge and no same-column TFD edge.
- The global `rankSeparate` round-4 insight.
- SCC quotienting for bidirectional hull groups.
- Subnet de-band as a structure-changing height lever.
- The diagnostic gates: collision count, backward edges, same-column edges, deterministic geometry.
- The stage/meta observability discipline.

Keep these ideas from `pipelineVariant:"v2"`:

- hull tree as the primary model;
- edge lifting at each hull;
- recursive hull block placement;
- skyline Y packing of X-disjoint blocks;
- fan-out target bundles as compact blocks;
- ancillary strips as real pseudo-clusters positioned by the packer.

## What To Drop Or De-Emphasize

Drop the idea that RCLL can be fixed mainly through more toggles.

These should not be the center of the next architecture:

- independent per-container rank shifting;
- local-only hull stagger;
- crossing reduction that sees only immediate-parent leaves;
- straightening without first creating Y room;
- de-density that cannot touch connected/convergent bottlenecks;
- "boxed hull everywhere" as a hard visual requirement.

The current RCLL controls are useful as experiments, not as the product model.

## Risks

### Width Growth

All-to-all leaf separation for one-way hull pairs can widen the diagram. Round 4 measured a useful height drop but width rose.

Mitigation:

- add minimum-length / border-node style constraints only where needed;
- cap or score separation by expected height reclaimed;
- make the objective explicit: legal X first, then height, then width.

### Cross-Container Crossings

The RCLL `rankSeparate + M4` result reduces height but increases crossings. That is expected because it moves whole hull spans without a global crossing-minimization pass.

Mitigation:

- crossing reduction must operate on lifted hull edges and base nodes, not only immediate local leaves;
- dummy/border nodes may be needed for long cross-hull edges.

### Visual Containment Versus Membership

Drawing every subnet/VPC/region as a heavy box can force height. Some containment levels should be rendered as annotations rather than frames when boxes harm dataflow readability.

Mitigation:

- keep provider/account/region/VPC as true frames where useful;
- allow subnet membership to be rail/chip/legend;
- measure frame suppression per level.

## Proposed Next Step

Do not continue polishing the current RCLL toggle stack as the main path.

Create a new `RCLL V2` milestone that starts from the `pipelineVariant:"v2"` hull-tree/packer architecture and imports the proven RCLL pieces:

1. global leaf ranking from `rankSeparate`;
2. bidirectional SCC co-axial grouping;
3. subnet de-band membership rendering;
4. RCLL diagnostic gates and metadata;
5. a real cross-container crossing/ordering pass later.

The success gate should be measured on compact and full `staging-extended-localstack-v2`:

- acyclic backward edges: `0`;
- acyclic same-column edges: `0`;
- collisions: `0`;
- deterministic geometry;
- compact height better than current `pipelineVariant:"v2"` or justified by better crossings/readability;
- crossings no worse than current `pipelineVariant:"v2"` unless explicitly traded for a large height win.

## Decision

The new approach is good and should become the main direction.

The existing RCLL approach is valuable as a research record and source of tested primitives, but not as the architecture to keep extending indefinitely. The next implementation should be hull-first in the model, globally ranked at the leaf/resource level, and hull-derived in geometry.
