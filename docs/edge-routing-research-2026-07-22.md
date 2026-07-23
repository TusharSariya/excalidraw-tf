# Edge routing research — 2026-07-22

Owner ask: React-Flow-quality edge routing options for the strata view; fewer hull/resource crossings; aesthetic angles; dummy routing columns idea; each option exposed in the UI. 3 Fable-med research agents + 1 synthesis. Raw agent outputs below.

---

# reactflow-ecosystem

## Summary

Deep-dive on edge routing in modern JS diagram libraries. Key takeaways: (1) React Flow's "feel" is pure endpoint-local path math — cubic bezier with axis-aligned control points scaled by a curvature param, or orthogonal "smoothstep" with a 20px escape offset and quadratic-arc rounded corners (borderRadius) — with NO obstacle avoidance; both formulas are trivially transplantable to a canvas renderer and are the cheapest possible win for the owner's "angle aesthetics" goal. (2) ELK layered offers ORTHOGONAL/POLYLINE/SPLINES routing integrated with layout (incl. compound graphs), but requires adopting its whole layered pipeline. (3) libavoid (via libavoid-js WASM) is the gold standard for post-hoc obstacle-avoiding orthogonal routing: orthogonal visibility graph + A\* + segment nudging + hyperedge routing, incremental, but at 7k obstacles the visibility graph is the scaling risk and the JS port is beta. (4) Best transplant targets for strata: React Flow's smoothstep corner-rounding math (immediate), libavoid-style nudging/centering of parallel orthogonal segments in the existing inter-rank channels (the "dummy routing column" idea maps exactly to reserved channel space, which is how yFiles/ELK effectively do it), and dagre-style dummy-node spline points which strata's rank structure already almost provides.

## Findings

# Edge Routing in Modern JS Diagram Libraries — Research Findings

Context: strata view, ~7k elements, ~1–2k edges, layered LR layout with nested hulls. Owner priorities: fewer crossings/piercings, good edge angles, possible dummy/routing columns. We own arrow geometry (canvas), need no React layer.

---

## 1. React Flow (xyflow) — the anchor

### 1.1 Edge types

Five built-ins: `default` (bezier), `smoothstep`, `step` (smoothstep with `borderRadius: 0`), `straight`, `simplebezier`. All are **pure functions of the two endpoints + their `Position` (Left/Right/Top/Bottom)** — no knowledge of any other node or edge exists in the path math.

### 1.2 getBezierPath — exact math (source: `packages/system/src/utils/edges/bezier-edge.ts`)

Cubic bezier `M sx,sy C c1 c2 tx,ty` with one control point per endpoint, placed **axis-aligned with the handle's Position**:

- Left/Right handle → control point at `[x ± calculateControlOffset(dx, curvature), y]`
- Top/Bottom handle → `[x, y ± calculateControlOffset(dy, curvature)]`

```
calculateControlOffset(distance, curvature):
  if distance >= 0: return 0.5 * distance        // "forward" case: offset = half the gap, curvature ignored
  else:             return curvature * 25 * sqrt(|distance|)   // "backward" case (target behind source)
```

`curvature` default **0.25**. So for a normal LR edge the control points sit at the horizontal midpoint — this is why default React Flow edges look calm and symmetric. The curvature parameter only matters when the edge has to double back; the `25*sqrt(|d|)` term makes backward loops bulge proportionally to sqrt of the overshoot instead of linearly, which is a large part of the "feels good" behavior on reversed edges. `simplebezier` is the same but control offset is always the midpoint (no curvature/backward special-case).

### 1.3 getSmoothStepPath — exact math (source: `packages/system/src/utils/edges/smoothstep-edge.ts`; API docs)

Orthogonal polyline with rounded corners:

1. **Direction vectors** from Position: Left=(-1,0), Right=(1,0), Top=(0,-1), Bottom=(0,1).
2. **Escape offset** (default **20px**): source/target are first moved `offset` px along their direction vector (`sourceGapped = source + dir*offset`). This guarantees the edge always exits the node perpendicular before turning — a major aesthetics contributor (never a flat-angle exit).
3. **Point generation** between the gapped points:
   - Opposite handles (Right→Left, the LR case): one Z-bend through `centerX = sourceGapped.x + (targetGapped.x - sourceGapped.x) * stepPosition` (`stepPosition` 0=bend at source, 0.5=middle default, 1=at target; `centerX/centerY` can also be passed explicitly).
   - Same/mixed handles: corner points mixing coordinates (`{x: sourceGapped.x, y: targetGapped.y}` or the transpose), chosen by direction logic; small-distance same-side cases get `gapOffset = min(offset-1, offset-diff)` to avoid degenerate overlaps.
4. **Corner rounding**: path assembled as `M start` + a `getBend` per interior point + `L end`; each bend is a **quadratic bezier arc** with `bendSize = min(dist(a,b)/2, dist(b,c)/2, borderRadius)` — i.e., radius is clamped so adjacent bends never overlap. `borderRadius` default **5**.

**Verdict on the "feel":** three ingredients — (a) perpendicular exit stub via offset, (b) monotone axis-aligned segments with a single parameterized bend position, (c) clamped-radius rounded corners. All ~150 lines of endpoint-local math, MIT-licensed, dependency-free.

### 1.4 Connection-side selection

React Flow does **not** choose sides: handles are declared per node (`sourcePosition`/`targetPosition` props, default Bottom→Top), and the layout examples set them (LR layouts set Right→Left). Dynamic side-picking exists only in the **Floating Edges example** pattern: compute the closest sides/intersection of the two node rects per render — userland, not core.

### 1.5 What React Flow does NOT do, and what plugins add

- **No obstacle avoidance, no crossing minimization, no edge–edge spacing** in core (confirmed: [discussion #2806](https://github.com/xyflow/xyflow/discussions/2806)).
- [`react-flow-smart-edge` / Jalez fork](https://github.com/Jalez/react-flow-smart-edge): A\* pathfinding on a rasterized grid around node rects, then draws bezier/step through the found path. Known to be slow at scale (grid rebuild per drag; fine at tens of nodes, not thousands).
- **elkjs integration** ([elkjs example](https://reactflow.dev/examples/layout/elkjs), [multiple-handles example](https://reactflow.dev/examples/layout/elkjs-multiple-handles)): ELK computes node positions + port assignments; React Flow still draws its own endpoint-local edges (or you consume ELK's bendPoints yourself). ELK ports = handles mapped to reduce crossings.
- A libavoid-WASM-in-WebWorker pattern also circulates for React Flow (clean orthogonal + nudging), which is the strongest of the plugin approaches.

**Transplantability: TRIVIAL.** `getBezierPath`/`getSmoothStepPath` are canvas-agnostic pure functions; port them (or re-derive) directly into the strata arrow builder as new opt-in edge styles. This is the highest value-per-effort item in this report for priority (2), edge angles.

---

## 2. elkjs / ELK layered edge routing

Sources: [edgeRouting option](https://eclipse.dev/elk/reference/options/org-eclipse-elk-edgeRouting.html), [ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html).

- **Mechanics:** `org.eclipse.elk.edgeRouting` ∈ {UNDEFINED, POLYLINE, ORTHOGONAL (layered default), SPLINES}. Routing is a phase of the layered pipeline: edges travel through dummy nodes per crossed layer; ORTHOGONAL assigns edges to horizontal tracks in the inter-layer channel (hyperedge-aware segment assignment); SPLINES emits bendPoints to be interpreted as **piecewise cubic spline control points**, with `SplineRoutingMode` SLOPPY (default, plus a layer-spacing factor 0.2) vs CONSERVATIVE. Dedicated self-loop distribution/ordering strategies.
- **Obstacle handling:** implicit — routing happens in channels the layout itself reserves, so edges avoid nodes _of the same layered layout_, including **compound graphs with cross-hierarchy edges** (`hierarchyHandling: INCLUDE_CHILDREN`). It does not route around arbitrary foreign rectangles.
- **Angle aesthetics:** ORTHOGONAL is 90°-only (no built-in corner rounding — renderer's job, e.g. Mermaid rounds them); SPLINES gives smooth monotone curves; edge–edge spacing options (default 10px) prevent the near-flat overlapping-segment look.
- **Cost:** whole-pipeline cost; elkjs is GWT-transpiled JS, typically run in a worker. At ~thousands of nodes ELK layered runs seconds-scale; `thoroughness` (default 7) trades quality/runtime. The routing phase itself is cheap relative to crossing minimization.
- **Verdict:** NOT transplantable as a routing module — the routing is inseparable from ELK's layering/dummy-node structure. But strata **is** a layered layout, so the ideas transplant: reserve inter-rank channel width, assign each edge's vertical segment to a track in the channel (that IS the owner's "dummy routing column" idea, formalized), round corners at render time.

---

## 3. libavoid (Adaptagrams) — the gold standard

Sources: [libavoid overview](https://www.adaptagrams.org/documentation/libavoid.html), Wybrow/Marriott/Stuckey ["Orthogonal Connector Routing"](https://link.springer.com/chapter/10.1007/978-3-642-11805-0_22) (GD 2009), ["Orthogonal Hyperedge Routing"](https://users.monash.edu/~mwybrow/papers/wybrow-diagrams-2012.pdf) (2012), [libavoid-js](https://github.com/Aksem/libavoid-js).

- **Mechanics (3 phases):** (1) build an **orthogonal visibility graph** from the interesting X/Y coordinates of obstacle rectangles and connector endpoints; (2) **A\*/shortest-path** per connector minimizing a monotone function of length + bend count (configurable segment/bend/crossing penalties); (3) **centering + nudging**: shared/overlapping collinear segments are separated and centered within their free channel — this final ordering pass is what makes dense orthogonal bundles legible (minimizes unnecessary crossings among parallel segments). Incremental: moving a shape invalidates only affected routes (this is the "interactive editor" design point). Hyperedge routing merges connectors with shared endpoints into tree-shaped orthogonal hyperedges.
- **Obstacle handling:** full — arbitrary rectangles/polygons, checkpoint constraints, per-shape connection pins. No native hierarchy notion (hulls are just more obstacles; cross-hull edges need pins/checkpoints on hull borders to emulate hierarchical routing).
- **Angle aesthetics:** orthogonal (or polyline) only; no rounded corners (renderer's job); nudging gives even spacing — the cleanest orthogonal look available anywhere.
- **Cost at 7k obstacles / 1–2k edges:** the orthogonal visibility graph is worst-case O(n²) segments; papers demo hundreds of shapes interactively. 7k obstacle rects + 2k connectors is beyond its comfort zone for full rebuilds (expect multi-second), though incremental reroute after small moves would be fine. Practical mitigation: only feed it top-level hulls + cards near edges (coarsen obstacles).
- **JS status:** [`libavoid-js`](https://www.npmjs.com/package/libavoid-js) — Emscripten/WebIDL WASM port from a TU Wien thesis; v0.4.5 (Apr 2025, adaptagrams 1.0.4), 0.5.0-beta on npm; ~43 stars, beta, WebIDL bindings brittle (no callbacks), used in production-ish by [sprotty-routing-libavoid](https://github.com/Aksem/sprotty-routing-libavoid). Run in a Web Worker.
- **Verdict:** the algorithm (visibility graph + A\* + nudging) is transplantable **as an idea** and worth reimplementing scoped-down (route within inter-rank channels only); the WASM port is usable for an experiment toggle but is beta and scaling-risky at strata's obstacle count.

---

## 4. Others worth stealing from

### yFiles EdgeRouter (commercial)

Source: [yFiles polyline/EdgeRouter guide](https://docs.yworks.com/yfiles-html/dguide/layout/polyline_router.html).

- Post-layout router, nodes fixed. **Cost-based search** (configurable penalties for crossings, node overlaps) over routing channels; styles: orthogonal, **octilinear (45° segments)**, and **curved (cubic bezier)**; **monotonic path restriction** (edges only progress toward target — directly relevant to the owner's "no extreme angles / no backtracking" wish); **edge grouping & bus routing** (shared trunk segments); incremental scopes (PATH / PATH_AS_NEEDED / SEGMENTS_AS_NEEDED / IGNORE). Handles group nodes/hierarchy. Scales to thousands of edges (it's their flagship router) but closed-source.
- **Verdict:** can't transplant code; steal the _feature list_ — octilinear as a middle ground between orthogonal and bezier, monotone restriction, penalty-tunable crossings-vs-bends, incremental scoping.

### mxGraph / draw.io OrthConnector

Sources: [mxEdgeStyle API](https://jgraph.github.io/mxgraph/docs/js-api/files/view/mxEdgeStyle-js.html), [orthogonal example](https://github.com/jgraph/mxgraph/blob/master/javascript/examples/orthogonal.html).

- `mxEdgeStyle.OrthConnector` is a **local** router: only considers the two terminal rects (+ port/perimeter constraints, exitX/exitY). Enumerates a small pattern table of orthogonal routes by relative quadrant of the terminals, picks minimal bends; no global obstacle avoidance (draw.io edges happily cross unrelated nodes). Extremely fast (O(1) per edge).
- **Verdict:** a good reference for a robust _pattern-table_ elbow router (all the same-side/opposite-side/quadrant cases enumerated), i.e., a hardened version of what Excalidraw's elbow arrows and React Flow smoothstep do. Cheap to port; Apache-2.0.

### dagre

Source: [dagre wiki/npm](https://www.npmjs.com/package/dagre) (based on Gansner et al., "A Technique for Drawing Directed Graphs").

- Long edges are split by **dummy nodes, one per crossed rank**; crossing minimization orders dummies like real nodes; final edge = the chain of dummy-node coordinates emitted as `points[]`, typically rendered as an interpolated spline (d3-shape curveBasis in dagre-d3). Obstacle avoidance is purely structural — edges avoid nodes because dummies occupy slots in each rank.
- **Verdict:** strata already has ranks; adding **dummy edge-slots per crossed rank** (the owner's routing-column idea) plus a spline through them is the dagre/ELK-native answer to obstacle avoidance and gets crossing-minimized routes "for free" if dummies participate in ordering. This is the structurally-correct long-term option.

### tldraw elbow arrows

Sources: [ElbowArrowInfo docs](https://tldraw.dev/reference/tldraw/ElbowArrowInfo), [issue #1738](https://github.com/tldraw/tldraw/issues/1738), [issue #6664](https://github.com/tldraw/tldraw/issues/6664).

- Two-terminal local router (shipped 2025): computes the combined bounding box, the gaps/mid-lines between the two shape edges, picks entry/exit sides ("magnets": N/S/E/W, auto or user-pinned), routes an elbow through the gap midlines; no third-party obstacle avoidance, no user waypoints (open feature request #6664). "Routes reasonably ~90% of the time" per maintainers. Freehand-style arrows use a perfect-arc/bezier with binding offsets.
- **Verdict:** same class as mxGraph OrthConnector; its interesting stealable bit is the **magnet/side-picking heuristic** (auto side selection from relative geometry with user override) — relevant if strata edges ever bind to hull borders.

### Mermaid flowchart-elk

Sources: [Mermaid layouts doc](https://mermaid.ai/open-source/config/layouts.html), [drawio ELK blog](https://www.drawio.com/blog/mermaid-elk-layout/).

- Just ELK layered (elkjs) swapped in for dagre; Mermaid then renders ELK's orthogonal bendPoints with rounded corners. Community consensus: markedly better on large/complex graphs, at higher layout cost; falls back to dagre if not registered. Confirms the "ELK orthogonal + render-time corner rounding" recipe is production-proven.

---

## 5. Synthesis for strata (recommended experiment ladder)

1. **Port React Flow path math now** (bezier w/ curvature + smoothstep w/ offset & borderRadius) as opt-in edge styles — pure functions, directly addresses priority (2) angles; A/B-able immediately against current elbow/orbit arrows.
2. **Channel/track assignment in inter-rank gaps** (ELK/yFiles-style): reserve width between ranks, assign each edge's vertical run to a track, nudge/center libavoid-style, round corners with the smoothstep bend formula. This is the owner's "dummy routing column" formalized, and composes with existing strataBorderRoute.
3. **Dummy edge-nodes per crossed rank in the ordering phase** (dagre-style) for structural crossing reduction on long edges — biggest win for priority (1) but touches layout, not just rendering.
4. **libavoid-js behind a toggle** only as a research probe on coarsened obstacles (hulls + local cards); beta WASM + 7k obstacles = scaling risk for default use.

## Sources

https://raw.githubusercontent.com/xyflow/xyflow/main/packages/system/src/utils/edges/bezier-edge.ts; https://raw.githubusercontent.com/xyflow/xyflow/main/packages/system/src/utils/edges/smoothstep-edge.ts; https://reactflow.dev/api-reference/utils/get-smooth-step-path; https://reactflow.dev/examples/layout/elkjs; https://reactflow.dev/examples/layout/elkjs-multiple-handles; https://github.com/xyflow/xyflow/discussions/2806; https://github.com/Jalez/react-flow-smart-edge; https://eclipse.dev/elk/reference/options/org-eclipse-elk-edgeRouting.html; https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html; https://www.adaptagrams.org/documentation/libavoid.html; https://link.springer.com/chapter/10.1007/978-3-642-11805-0_22; https://users.monash.edu/~mwybrow/papers/wybrow-diagrams-2012.pdf; https://github.com/Aksem/libavoid-js; https://www.npmjs.com/package/libavoid-js; https://github.com/Aksem/sprotty-routing-libavoid; https://docs.yworks.com/yfiles-html/dguide/layout/polyline_router.html; https://jgraph.github.io/mxgraph/docs/js-api/files/view/mxEdgeStyle-js.html; https://github.com/jgraph/mxgraph/blob/master/javascript/examples/orthogonal.html; https://www.npmjs.com/package/dagre; https://tldraw.dev/reference/tldraw/ElbowArrowInfo; https://github.com/tldraw/tldraw/issues/1738; https://github.com/tldraw/tldraw/issues/6664; https://mermaid.ai/open-source/config/layouts.html; https://www.drawio.com/blog/mermaid-elk-layout/

---

# routing-literature

## Summary

Strata edges are straight 2-point center-clipped chords built by appendPipelineEdgeSkeletons → buildTerraformDeclaredDataFlowLineSkeletons (orbit bindings, no elbow); two opt-in post-geometry polyline passes exist (strataEdgeRouting = foreign-box detours, strataBorderRoute = clean ancestor-hull exits), both hooked in terraformPipelineStrataSceneBuild.ts:366-378 — the exact seam a new router should use. Binding repair (terraformVisibility.ts:1007) flattens everything back to a chord unless the arrow carries a validated terraformRoutedPolyline marker. Metrics: chord-proxy scoring in terraformPipelineStrataPackedScoring.ts, rendered polyline-aware crossings + a crossing-ANGLE summary (SHARP_CROSSING_MAX_DEG=30) in terraformPipelineCollisionDiagnostics.ts:309, hull pierce in terraformPipelineStrataPierceMetrics.ts:217. A new toggle must touch ~9 threading sites (two known silent-drop literals: terraformLayoutCore.ts sceneContext ~1283 and terraformSceneApply.ts literals at ~387/~544). Pinned preset ≈ 322 TFD arrows over ~7k elements; baseline rendered crossings ~116-173, pierce edge population 115.

## Findings

# Edge-routing state audit — excalidraw-tf strata view

## 1. Where edges are BUILT and what geometry they get

**All strata/pipeline edges are straight 2-point chords today. No elbow, no via points, unless one of the two opt-in routing passes rewrites them.**

- **Arrow constructor (dataflow/TFD):** `packages/excalidraw/components/terraformElkLayout.ts:1729` `buildTerraformDeclaredDataFlowLineSkeletons`. Per edge: `getCenterClippedLine(sourceBox, targetBox)` (center-to-center segment clipped to card boundaries), optional parallel-offset when an undirected dependency pair shares the corridor (`offsetTerraformLineSegment`, `TERRAFORM_DECLARED_DATAFLOW_OFFSET_PX`, :1752-1760). Skeleton at :1771-1817: `type:"arrow"`, `points:[(0,0),(dx,dy)]` (exactly 2 points = straight), `roundness:{type:2}`, `startBinding/endBinding` with `mode:"orbit"` + `fixedPoint` from `fixedPointForLayoutPoint`, `customData.terraformEdgeLayer:"declaredDataFlow"` + `relationship{source,target,sequence,...}`.
- **Networking/dependency-layer arrows:** same file, `buildTerraformNetworkingRecordLineSkeletons` :1824 (and other arrow emitters at :1373, :1442, :1560) — same straight-chord + orbit-binding pattern.
- **Strata invocation:** `packages/excalidraw/components/terraformPipelineStrataSceneBuild.ts:354-359` calls the shared `appendPipelineEdgeSkeletons` (defined `terraformPipelineLayoutFinalize.ts:46-99`) with `prep.collapsedEdges` — the same emission used by v2/rcll/compound builders (`terraformPipelineLayoutV2.ts:136`, `terraformPipelineLayoutRcll.ts:338`, `terraformPipelineLayoutCompound.ts:115`).
- **Skeleton → elements:** `terraformPipelineLayoutFinalize.ts:101-150` `convertPipelineSkeletonToElements`: `convertToExcalidrawElements` → label mirror → icon inject → **`repairTerraformEdgeBindings` (:110)** → visibility reconcile → z-stack reorder.
- **Binding repair:** `packages/excalidraw/components/terraformVisibility.ts:1007` `repairTerraformEdgeBindings`. For every terraform edge with a `relationship`, it recomputes `getCenterClippedBindingPoints` from the CURRENT card rects (:1079), rebuilds `startBinding/endBinding` as `mode:"orbit"` with fresh `fixedPoint`s (:1175-1184), and **flattens the arrow back to a straight 2-point chord** (:1162-1171) — UNLESS `customData.terraformRoutedPolyline === true` AND both polyline endpoints still sit within `ROUTED_ANCHOR_TOLERANCE` (~38.5 px Chebyshev) of their bound cards (:1105-1151, validate-before-trust; stale markers stripped, :1148-1151, helper :106-113). Also called at :1438, :1546, :1587 (visibility/focus paths) — so **any new router's geometry must carry the `terraformRoutedPolyline` marker or it will be erased on the next repair pass**.

## 2. Existing routing options

### strataEdgeRouting (`packages/excalidraw/components/terraformPipelineStrataEdgeRouting.ts`, 495 lines)

- "Penetrating-only" obstacle-avoidance (Wybrow/Marriott incremental connector routing): AFTER final geometry, each TFD arrow whose straight chord passes through the interior of a FOREIGN box (hull that is an ancestor of neither endpoint, or unrelated card) is replaced by a polyline detour. Recursive corner-detour search (`routeSegment` :202), max 6 interior waypoints (`STRATA_EDGE_ROUTING_MAX_WAYPOINTS` :62), clearance `PIPELINE_FRAME_PAD/2 = 14px` (:65), greedy waypoint shortcutting (:249), min-L1 tie-break, fully deterministic. Endpoint x/y never move; only interior waypoints added; stamps `terraformRoutedPolyline` (:487). "Never emit worse" acceptance check :434-464. Scene entry: `routeStrataSkeletonEdges` :346. **Sub-options: none** (waypoint cap and clearance are exported consts, not toggles). Measured closed-adverse: **+192 crossings / −140 pierce** (registry note) — why it was demoted to advanced-only.
- Ancestor hulls are deliberately PERMEABLE (a legit exit is not an obstacle).

### strataBorderRoute (`packages/excalidraw/components/terraformPipelineStrataBorderRoute.ts`, 464 lines)

- Sander-1996 border-node routing as a post-geometry pass: an edge leaving its own ancestor container as a long interior diagonal gets rewritten to `[start, W…, end]` with one border waypoint per exited hull on the facing side (`routeStrataBorderExits` :228, `facingSide` :114, `borderWaypoint` :135). By design it CANNOT move crossings/pierce/length (all accounting systems treat own-ancestor exits as legitimate, header :14-26); payoff is the un-scored `interiorLenSavedL1`/`maxWaypointPerpDev` meta. Measured −5 crossings on preset. **Disjointness contract:** skips any arrow already stamped `terraformRoutedPolyline` by edgeRouting (:290) — each edge is owned by whichever pass fires first. **Sub-options: none.**
- Both hooks: `terraformPipelineStrataSceneBuild.ts:366-378` (edgeRouting first, borderRoute second, each flag-gated with flag-off byte-identity).

### Full routing-adjacent toggle inventory

Declarative catalog: **`packages/excalidraw/components/terraformStrataOptionRegistry.ts:96-352`** (one row per option: urlParam, optionKey, default, surface, emit class). Routing-adjacent rows:

| Option | Default | UI surface | What it changes |
| --- | --- | --- | --- |
| `strataEdgeRouting` (registry :159-167) | OFF | collapsed "Advanced: edge routing" `<details>` in `TerraformStrataSettings.tsx:647-690` | foreign-box polyline detours |
| `strataBorderRoute` (:169-177) | OFF | same disclosure | ancestor-hull clean side exits |
| `strataPackedScoring` (:139-147) | ON | advanced | ε-gated (crossings, penetrations, lengthL1) placement scoring |
| `strataPackedEps` → `strataPackedScoringEpsilon` (:149-157) | 1 | advanced | crossings budget above baseline |
| `strataEdgeCap` → `strataEdgeCrossCap` (:247-261) | **inherits ε** (no fixed default) | advanced | hard cap on edge-edge crossing regression for relocate passes |
| `strataPenW` → `strataCrossWeightPenetration` (:227-235) | 1 | advanced | relocate objective weight — "inert without a consumer" |
| `strataCrossW` → `strataCrossWeightEdge` (:237-245) | 1 | advanced | ditto |
| `strataSift` (:217-225) | ON | basic | OD-15 sift+relocate (crossings-driven placement) |
| `strataTranspose` (:293-301) | ON | basic | adjacent-swap transpose (−24% crossings) |
| `strataChainRelocate` (:303-311) | OFF | "Advanced: extra crossing-reduction passes" | chain vertical translate |
| `strataCoordCascade` (:313-321) | OFF | same | A7 tie-cascade |
| `strataLeafShift` (:333-341) | OFF | **hidden** (URL-only) | A01 leaf X-shift + 4 hidden budget knobs (`strataLeafShiftHeightBudgetPx/Frac/...`, threaded at `terraformLayoutCore.ts:675+`) |
| legacy inert: `strataPackedConverge` (:263-271), `strataTransitiveAdopt` (:273-281) | OFF | hidden no-ops | parsed forever, do nothing |

URL parse/emit: `terraformDemoUrlParams.ts` — parse :476-481, emit :842-843 (`setBool`), snapshot type :956-957, collect :1097-1098. Conflict rules: `terraformStrataOptionRules.ts` (e.g. packedScoring ⊻ rankSeparate). Defaults: `terraformStrataDefaults.ts` (`TERRAFORM_STRATA_LAYOUT_DEFAULTS`).

### Why it's "a mess" (concrete)

1. **Overlapping/entangled semantics:** two separate routing passes with a hidden precedence protocol (first-stamper-wins via `terraformRoutedPolyline`), documented only in comments (`terraformPipelineStrataSceneBuild.ts:370-375`, borderRoute :283-291). Neither has intensity/sub-options — binary all-or-nothing.
2. **Weights with no consumer:** `strataPenW`/`strataCrossW` are exposed but "inert without a consumer" (registry's own words) — dead knobs in the advanced UI surface.
3. **Inherited/aliased defaults:** `strataEdgeCap` has NO default — absence inherits ε, and explicit `0` ≠ omission (registry :250-256 documents an emitter-erasure hazard). `strataBandCompact` is an alias for `strataBandDepth='root'` yet still emitted separately (:184-190).
4. **Registry is descriptive, not wired** (:8-21): the parser, panel, share-URL emitter, and proof API each keep hand-maintained lists that merely AGREE with the table; the basic/advanced split is hand-coded in `TerraformStrataSettings.tsx`/`TerraformStrataSettingsHeight.tsx`.
5. **Scoring proxy ≠ rendered reality:** the placement scorer counts chord crossings while routing changes rendered polylines; the known chord-vs-rendered inversion means routing quality is invisible to the acceptance machinery. edgeRouting itself is crossing-ADVERSE (+192) while pierce-favorable (−140) — the toggle trades the owner's #1 metric for #2 with no dial.
6. **Naming drift:** urlParam ≠ optionKey for half the rows (`strataPackedEps`→`strataPackedScoringEpsilon`, `strataSift`→`strataSiftRelocate`, `strataCoordRefine`→`strataCoordinateRefine`), plus legacy aliases.

## 3. Edge-quality metrics (probe surface)

- **Placement-time chord proxy:** `terraformPipelineStrataPackedScoring.ts:607` `scoreStrataPlacementGeometry(placement, model, edgesPrime)` → `StrataPackedScore {crossings, penetrations, lengthL1}` (:92-97) on doubled-centre leaf-box chords. Comparators/ε machinery :158-360 (`strataPackedScoreLess`, `strataPackedScoreAdoptable`, `strataWeightedCross`, `resolveInheritedEdgeCrossCap`). `segmentIntersectsStrataBoxInterior` exported here (used by both routers). **Caveat: chord-based — cannot see crossings a router adds/removes.**
- **Rendered-scene truth (what a router probe MUST use):** `terraformPipelineCollisionDiagnostics.ts:309` `diagnosePipelineScene` → `dataflow.crossings` (:57-59), **polyline-aware** (RFC DEC-6, :164-166 keeps all consecutive segments; crossing loop ~:413-421; `segmentsCross` :256). **Crossing-angle summary already exists** (:76-91): `CrossingAngleSummary` counts sharp crossings under `SHARP_CROSSING_MAX_DEG = 30`° (:88) — directly serves the owner's "aesthetic angles" priority (sharpShare appears in the overnight A/B numbers).
- **Hull piercing:** `terraformPipelineStrataPierceMetrics.ts:217` `computePierceMetrics` → `pierce.total` / `pierce.edgeCount`; own-ancestor exits excluded (isPrefix path check); `segmentIntersectsRectInterior` :120.
- **Per-edge/slice legibility:** `terraformPipelineSliceMetrics.ts:457` `computeSliceMetrics` (+ `terraformPipelineSliceMetricsPerEdge.test.ts`).
- **Harness pattern to copy:** `terraformStrataArmEval.probe.test.ts` :296-333 — builds the pinned-preset scene per arm and records `renderedCrossings` (diagnosePipelineScene), `pierce`/`pierceEdgeCount`/`piercePerTopoFrame` (computePierceMetrics), spanning-fraction honesty checks. Also `terraformStrataGeometryRegression.cells.ts` (per-cell elementCount/topoFrames), `terraformPipelineStrataRoutingSpike.test.ts` (W9 battery for edgeRouting), `terraformPipelineStrataBorderRoute.test.ts`, `terraformVisibility.routedPolyline.test.ts` (repair round-trip).

## 4. Seam for a NEW routing option

**Routing hook:** `terraformPipelineStrataSceneBuild.ts` immediately after `appendPipelineEdgeSkeletons` (:354) and alongside the existing two passes (:366-378) — i.e. AFTER coordinate assignment/A7/packed-scoring guard, at scene-skeleton assembly, BEFORE `convertPipelineSkeletonToElements`. Data available at that point:

- `skeleton` (mutable array; TFD arrows identifiable via `customData.terraformEdgeLayer === "declaredDataFlow"` + `relationship{source,target}`),
- `input.model: StrataModel` (hull tree `hullRoot` w/ `leafClusterIds`/`children`/`path`, `clusters` map — rank/column structure),
- `input.placement: StrataPlacementResult` (`boxedHulls: Map<hullId,{box}>` hull rects, `leafBoxes: Map<clusterId, StrataBox>` card rects),
- `layoutBoxes` (id → rect for every emitted frame/card). Contract for the new pass: mutate arrows in place, keep endpoints/bindings, set `customData.terraformRoutedPolyline: true` (else `repairTerraformEdgeBindings` flattens it), respect the first-stamper-wins protocol with the two existing passes, and provide flag-off byte-identity. Dummy/routing-column ideas that MOVE geometry (owner priority 3) would instead have to hook pre-placement (rank/coordinate stages) — that is a different, heavier seam; a pure routing pass fits here.

**Option threading — every file a new `strataMyRouter` toggle must touch** (silent-drop seams bolded):

1. `terraformPlanParsing.tsx` — `TerraformPlanParsingOptions` field.
2. `terraformLayoutCore.ts` — option type :488-491 area; **the `sceneContext` literal :1197 (add at ~:1283-1284)** — comments :1292/:1323 state outright that an option absent from this literal is silently dropped; and the `builderOptions` forward :659-660.
3. `terraformPipelineStrata.ts` — options type :281-291, resolve :443-445, forward into scene build :506-507 → :1098-1100, meta echo :1198-1216.
4. `terraformPipelineStrataSceneBuild.ts` — input flag :100-108, invocation :366-378, meta out :183-186/:394-395/:414-446.
5. **`terraformSceneApply.ts` — BOTH re-materializing literals:** session→options pick list :335-336 + literal :387-388, AND the shared engine-forwarding pick list :481-482 + literal :544-545 (this is the seam that silently bit chainRelocate/coordCascade on 2026-07-18).
6. `terraformImportSession.ts` :87-89 — session persistence field.
7. `useTerraformImportDialog.ts` — state :184-190, threading :555-556, :717-718, :842-843, :1088-1089, :1138.
8. `terraformDemoUrlParams.ts` — parse :476-481 area, emit :842-843, snapshot :956-957, collect :1097-1098; plus `terraformCanvasShareUrl.ts` round-trip.
9. `TerraformStrataSettings.tsx` — control inside the "Advanced: edge routing" disclosure :647-690 (props :56-57/:97-98).
10. Registry row in `terraformStrataOptionRegistry.ts` (anti-drift test enforces default/emitClass agreement) + conflict rule in `terraformStrataOptionRules.ts` if it excludes edgeRouting/borderRoute.
11. Tripwire: `terraformLayoutCoreStrataThreading.test.ts` derives threaded keys from `TERRAFORM_STRATA_LAYOUT_DEFAULTS` — add the default there (`terraformStrataDefaults.ts`) and the threading test covers the drop seams automatically. Proof API for headless verification: `GET /api/terraform-layout`.

## 5. Element counts on the pinned preset (router cost budget)

No single canonical constant in-repo; converging measurements:

- **TFD arrows: ~322** — the W9 battery measured the routed-anchor tolerance "over 322 edges" (`terraformVisibility.ts:1117` comment).
- **Pierce edge population: 115** (borderRoute A/B, `docs/strata-overnight-results-2026-07-16.md:82`); rendered dataflow crossings baseline **~116-173** depending on default stack (173→132 with transpose; 116→94 with chain-relocate+cascade per memory).
- edgeRouting/borderRoute pass volumes: borderRoute routes **40 edges** solo, 19 when composed (same doc :82); edgeRouting −5 crossings composition numbers there too.
- **Total scene: ~7k elements** (project context; cards + labels + icons + frames dominate — arrows are a small fraction). Leaf cluster cards are on the order of a few hundred.
- Budget implication: an O(E × obstacles) pass over ~322 edges × (~hundreds of hull+card boxes) is what the existing routers already do per import, deterministically, without measurable wall-clock complaints — a candidate router of similar complexity is safe; anything super-quadratic in cards should be indexed.

## Sources

/Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformElkLayout.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformPipelineLayoutFinalize.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformVisibility.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformPipelineStrataEdgeRouting.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformPipelineStrataBorderRoute.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformPipelineStrataSceneBuild.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformStrataOptionRegistry.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformDemoUrlParams.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformLayoutCore.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformSceneApply.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformImportSession.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/useTerraformImportDialog.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/TerraformStrataSettings.tsx; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformPipelineStrataPackedScoring.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformPipelineStrataPierceMetrics.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformPipelineCollisionDiagnostics.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformPipelineSliceMetrics.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformStrataArmEval.probe.test.ts; /Users/tusharsariya/Projects/excalidraw-tf/docs/strata-overnight-results-2026-07-16.md; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformStrataDefaults.ts; /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformStrataOptionRules.ts

---

# repo-audit

## Summary

Literature survey of post-layout edge routing for layered drawings, from the local graph-drawing RAG corpus: (1) dummy-vertex chains → spline control points (GKNV/dot) and Sander's Manhattan channel routing are the two canonical layered routing families; (2) the owner's "dummy routing column" idea is a direct analog of VLSI-style channel routing between ranks (Sander 1995, Raykov 2021, ELK/KIELER vertical-segment routing) — well-precedented, cheap, and the standard way to bound edge angles; (3) perceptual literature says crossing ANGLE matters nearly as much as crossing count, with ~70° as the empirical threshold below which reading performance degrades (Huang et al.), and min-crossing-angle/bend-count/angular-resolution are all cheap O(crossings) metrics; (4) for routing over fixed rectangles, libavoid-style visibility-graph orthogonal routing (Wybrow/Marriott/Stuckey) and dot's funnel-based spline router (Dobkin et al. DGKN97) are the proven post-pass options, both feasible at 1-2k edges. Recommended A/B menu: (a) channel/track orthogonal routing with reserved inter-rank corridors (owner's idea, strongest literature support), (b) spline-through-corridor à la dot for softer aesthetics, (c) libavoid-style visibility routing only if arbitrary obstacle avoidance is needed — it is the most expensive and ignores layer structure.

## Findings

# Edge routing for layered drawings with fixed node positions — literature survey

Scope: routing only (layout is done); target = ~7k-element strata canvas, ~1–2k edges, rectangles in columns, nested hulls. Sources: local `graph-layout-rag` corpus (doc_ids cited), supplemented by well-established results.

## 1. Routing in the Sugiyama pipeline: dummy-vertex chains → splines

**GKNV / dot (`gansner-tse93`, "A method for drawing directed graphs"; `graphviz-dotguide`)**

- Mechanics: long edges are split into chains of dummy vertices, one per crossed rank. After coordinate assignment, each chain defines a polygonal _region_ (a corridor between the boxes adjacent to the dummy nodes); a piecewise-Bezier spline is fitted inside that region. Flat (same-rank) edges are routed through the spaces between nodes of that rank. Adjacent-node edges become single splines; multi-edges get displaced control polygons.
- Key insight for us: **the dummy-vertex chain IS the routing corridor**. dot never routes "freely" — the spline is constrained to the polygon that crossing-minimization already made crossing-optimal. So crossings are decided at the ordering phase; routing only affects angles/bends/smoothness.
- Tradeoff: splines look organic and give good angular behavior at endpoints, but near-vertical entry into ranks (near-horizontal in LR orientation) still happens when the dummy chain has large X-drift between ranks. dot mitigates by adding `ranksep`/edge slack — which is exactly the knob the dummy-column idea generalizes.
- Cost: spline fitting is linear in chain length; the whole routing pass in dot is a small fraction of layout time. Fine at 1–2k edges.
- **Applicability: HIGH.** Strata already has rank structure; a "corridor spline" pass needs only per-edge rank-interval corridors, no global search.

**Spline fitting machinery (`graphviz-edge-router`, Dobkin/Gansner/Koutsofios/North DGKN97 "Implementing a General-Purpose Edge Router"; `graphviz-overview-short` EGKNW03)**

- Mechanics: general obstacle-avoiding router used when node positions are fixed (neato, dynadag, editors): (1) triangulate free space / compute a polygonal channel, (2) find shortest polyline path (funnel algorithm), (3) fit a piecewise Bezier to the path, subdividing where the spline exits the feasible polygon. Explicitly framed as VLSI/robotics path planning applied to graph drawing.
- Cost: path planning dominates; per-edge cost is near-linear in obstacles along the corridor once a visibility/triangulation structure exists. Shipped as a C library; practical for interactive editors. At 1–2k edges over ~hundreds of rectangle obstacles per region this is tens of ms–low seconds in JS if the obstacle set is pruned per hull.
- **Applicability: HIGH as the geometry engine** for any smooth-curve option; the funnel-then-fit recipe is the standard way to turn a corridor into a good-looking curve. See also `arxiv-2605-17498v1` (sleeve routing in the browser, 2026): splits routing into triangle-sequence choice + funnel-shortest-path — a modern, browser-native confirmation the same recipe scales in JS.

**Sander border nodes / Manhattan (`doi-10-1007-bfb0021828`, "A fast heuristic for hierarchical Manhattan layout", Sander 1995)**

- Mechanics: orthogonal (Manhattan) layered routing. Edges between adjacent layers become vertical–horizontal–vertical Z-shapes; the horizontal middle segments live in a **channel between the layers** and are assigned to _tracks_ (rows in the channel) to avoid overlaps and reduce crossings; segments are then snapped to a grid raster (paper describes traversing segments left-to-right by `spos` and snapping to raster `d`). Border nodes handle edges entering/leaving clusters at cluster boundaries (the mechanism behind our existing `strataBorderRoute`).
- Tradeoff: crossings between two layers become _segment-order_ crossings in the channel — countable and locally optimizable (track permutation). All angles are 0°/90° by construction, so "extreme angle" disappears as a category; the cost is bends (2 per inter-layer hop) and channel height (number of tracks ≈ max cut of overlapping horizontal spans, computable by interval-graph coloring / left-edge algorithm).
- Cost: near-linear; Sander's whole point is "fast heuristic". Trivial at our scale.
- **Applicability: VERY HIGH — this is the closest published system to the strata view** (layered + compound + Manhattan + border nodes).

**Port assignment (`elk-10-1007-978-3-642-11805-0-14` "Port Constraints in Hierarchical Layout of Data Flow Diagrams"; `elk-10-1016-j-comgeo-2022-101886` generalized port constraints; `arxiv-2309-01671v2` simple orthogonal pipeline)**

- Mechanics: edges attach at ports on the node boundary; ELK/KIELER routes **between layers using vertical line segments** (Fig. 4 of the port-constraints paper — LR-rotated, these are vertical segments in an inter-layer channel) and routes _around_ vertices when prescribed ports force it. Port order on a side is chosen to minimize crossings (a per-node permutation / barycenter subproblem). The 2022 port-constraints paper inserts dummy vertices per port group.
- Why it matters for angles: **endpoint angle is a port problem, not a path problem.** Spreading edge endpoints along the card side (instead of a single anchor) is the cheapest single intervention against near-flat incident angles, and it's a pure post-pass.
- **Applicability: HIGH, and orthogonal to path shape** — works under current elbow/orbit binding.

## 2. The owner's dummy-COLUMN idea: literature analog

The idea (reserved routing columns between ranks so long edges travel in corridors instead of cutting across at extreme angles) is **channel routing**, imported from VLSI:

- **VLSI origin**: `doi-10-1145-800158-805069` (Hashimoto & Stevens 1971, "Wire routing by optimizing channel assignment within large apertures", cited×680) — the original channel/track assignment formulation: horizontal runs assigned to tracks inside a reserved channel, vias at the ends. Track count = clique number of the span-overlap interval graph; left-edge algorithm is optimal for the no-vertical-conflict case.
- **Layered-drawing form**: Sander 1995 (above) — the channel between consecutive layers _is_ the dummy column; every inter-rank edge takes its cross-axis displacement inside the channel. `s2-10-2991-icacsei-2013-27` ("hierarchical orderly layout based on channel points") does the same with explicit channel-point geometry (BOX_W/BIT_W bookkeeping) — the exact "reserve width for routing bits next to boxes" arithmetic.
- **Modern restatement**: `forward-10-5121-csit-2021-111821` (Raykov 2021, "Method for Orthogonal Edge Routing of Directed Layered Graphs with Edge Crossings Reduction") — automated orthogonal routing over a directed layered graph with a dedicated "routing the edges" phase in inter-layer channels plus crossing reduction on the channel segments. Directly a spec for a `strataChannelRoute` toggle.
- **Sugiyama connection**: dummy _ranks_ in Sugiyama serve the same function implicitly — every extra rank an edge crosses gives it a place to bend gently. The dummy-column idea makes this explicit and _reserved_ (nodes never occupy the corridor), which is what guarantees the corridor stays empty.

**Known tradeoffs (crossings vs angles):**

- Channels don't change the crossing _count_ between two ranks (fixed by the vertex/port order — Forster `openalex-w1530155803` shows cluster-level crossings reduce to level-graph orderings), but they **relocate crossings into the corridor** where crossing angles are 90° (orthogonal) or controllable (spline), and away from card faces. Empirically this is the win the perceptual literature predicts (see §3): same crossings, much better angles and cleaner card silhouettes.
- Cost of the corridor is **width** (LR: horizontal growth = tracks × trackGap per inter-rank channel) and **bends** (+2 per channel traversed). `doi-10-1007-978-3-319-50106-2-17` (Compact Layered Drawings) documents the aspect-ratio price of naive layered conventions — worth watching since strata already fights width.
- Bundling variant: `crossref-10-1007-978-3-642-18469-7-30` ("Improving Layered Graph Layouts with Edge Bundling") bundles the proper-edge chains through shared virtual nodes — i.e., shared corridors — trading edge _ambiguity_ for clutter reduction; `doi-10-1109-tvcg-2021-3114795` (Edge-Path Bundling) and `doi-10-1109-tvcg-2016-2598958` (confluent-drawing user study) warn that aggressive bundling creates false adjacency ambiguity. For infra diagrams where individual dependency traceability matters, keep corridors _shared but not merged_ (parallel tracks, no bundling), or bundle only same-(source-hull,target-hull) edge groups.

## 3. Angle aesthetics, formally

- **Crossing angle matters, nearly as much as crossing count**: `doi-10-1145-1865841-1865854` (Huang & Huang 2010, "Exploring the relative importance of crossing number and crossing angle") — both independently affect task performance; angle effects persist after controlling for count. `doi-10-1109-apvis-2007-329282` + `forward-10-48550-arxiv-0810-4431` / `s2-e1691683eafdcaffeca40b903250f18cb39be830` (Huang eye-tracking 2007/2008): small-angle crossings cause back-and-forth saccades and path-tracing errors; large-angle crossings barely slow reading. The established empirical threshold (Huang, Eades, Hong): performance degrades sharply once crossing angles drop below **~70°**; above that, near-flat cost. RAC literature (`jgaa-2700`, RAC perspectives; `jgaa-2273`, RAC-drawability ∃ℝ-complete) confirms: "large angles improve readability, but they do not have to be right angles" — so target ≥70°, don't pay for exact 90° (exact RAC is intractable anyway).
- **Angular resolution at vertices**: `doi-10-1093-comjnl-bxs088` (Maximizing Total Resolution) — total resolution = min over vertex angles AND crossing angles; adjacent edges leaving a card too close together are their own readability defect (motivates port spreading, §1). `crossref-10-7155-jgaa-00575` (stub resolution) for the crossing-vicinity variant. `crossref-10-1007-978-3-030-04414-5-19` / `arxiv-1808-10519v1`: heuristics that maximize crossing resolution tend to _increase_ crossing count slightly — the tradeoff is real but mild.
- **Cheap metrics to add to the strata scorer** (all O(#crossings + #bends), computable from segment geometry we already have):
  1. **min / p5 crossing angle** (report share of crossings <70°) — directly the perceptual quantity;
  2. **bend count + min bend angle** (orthogonal routing fixes bend angle at 90° by construction);
  3. **endpoint angular resolution** per card side (min gap between consecutive incident edge directions);
  4. **near-flat edge share**: fraction of segments with |slope| below a threshold relative to the rank axis (the owner's "extreme angle" complaint operationalized).
- Context from `s2-10-1109-access-2020-3047616` (empirical-evaluation survey) and Purchase (`s2-10-1007-bfb0021827` validating aesthetics, `openalex-10-1006-jvlc-2002-0232` metrics, `s2-527ca0518fca9efdbea27c8a3289a4c8d67e22f6` UML study): crossings are the dominant validated aesthetic; bends matter less than crossings; user _preference_ studies (UML) sometimes diverge from performance — supports A/B-by-eyeball as the owner plans, with metrics as guardrails.

## 4. Obstacle-avoiding routing with FIXED positions (our exact regime)

- **libavoid family** — `doi-10-1007-11618058-40` + `wybrow-marriott-stuckey-incremental-routing-2008` (Incremental Connector Routing): build a (reduced) visibility graph over rectangle obstacles, A*/Dijkstra shortest poly-line per connector, incremental repair when shapes move. `wybrow-marriott-stuckey-orthogonal-connectors-2010` (Orthogonal Connector Routing, GD'09): orthogonal variant — generate an *orthogonal visibility graph\* from interesting x/y coordinates (obstacle edges ± padding), search with a cost = length + bend penalty + crossing penalty, then a **nudging** post-step separates overlapping collinear segments into parallel tracks. `doi-10-1007-978-3-642-31223-6-10` (Orthogonal Hyperedge Routing, 2012) extends to hyperedges/junctions. `openalex-10-1007-978-3-030-86062-2-2` shows the same machinery in interactive schematic editors.
  - Cost: visibility-graph construction O(n²)-ish in obstacle corners (orthogonal VG is sparser); per-connector search fast; libavoid is used interactively in Dunnart/Inkscape at hundreds of shapes. At ~7k elements / 1–2k edges a **full** orthogonal VG is heavy for a hot path but fine for a one-shot import post-pass, especially pruned per-hull.
  - Caveat: libavoid is layout-agnostic — it doesn't know ranks, so it won't preserve the layered reading direction, and its crossing penalty is greedy/sequential (route order matters). In a layered drawing it is _strictly more machinery than needed_: Sander/Raykov channel routing gets the same orthogonal cleanliness using structure we already have.
- **Spline over fixed obstacles**: DGKN97 (§1) is the canonical answer; sleeve routing (`arxiv-2605-17498v1`) is the 2026 browser-scale version (triangulate once, funnel per edge).
- **Clustered edge routing** (`forward-10-1109-pacificvis-2015-7156356`, Bouts & Speckmann 2015): routes edges through a sparsified well-separated corridor network with dilation bound t≈1.8 — literature proof that constraining edges to corridors costs bounded extra length while drastically cleaning the picture; the closest "corridor network" formalization to the dummy-column idea outside VLSI.

## 5. Verdicts for a post-layout routing pass over fixed rectangles in columns

| Option | Mechanics source | Crossings | Angles | Cost @1–2k edges | Verdict |
| --- | --- | --- | --- | --- | --- |
| **A. Inter-rank channel/track orthogonal routing** (owner's dummy columns) | Sander `doi-10-1007-bfb0021828`, Raykov `forward-10-5121-csit-2021-111821`, Hashimoto-Stevens `doi-10-1145-800158-805069` | unchanged count, relocated to 90° corridor crossings; track permutation can locally reduce | all 90°; near-flat segments eliminated by construction | interval-graph track assignment, ~linear; trivial | **BUILD FIRST** — best literature support, cheapest, matches existing strata structure and `strataBorderRoute` |
| **B. Corridor splines** (dot-style: dummy-chain region → funnel → Bezier) | `gansner-tse93`, DGKN97 `graphviz-edge-router`, `arxiv-2605-17498v1` | unchanged | smooth, endpoint tangents controllable; softer look than A | funnel+fit per edge, fast | **BUILD SECOND** as the aesthetic alternative for A/B — same corridors as A, different rendering |
| **C. Port spreading / side-anchor ordering** | `elk-10-1007-978-3-642-11805-0-14`, `arxiv-2309-01671v2`, `doi-10-1093-comjnl-bxs088` | small local reductions (port-order barycenter) | fixes endpoint angular resolution — biggest per-cost angle win | per-node sort; negligible | **DO REGARDLESS**, composes with A/B and with current elbow binding |
| **D. libavoid-style orthogonal visibility routing** | `wybrow-marriott-stuckey-orthogonal-connectors-2010`, `doi-10-1007-11618058-40` | greedy penalty, order-dependent | 90° + nudging | heaviest (VG build); OK one-shot, poor hot-path | **SKIP for now** — superseded by A given rank structure; revisit only for free-form/manual-move repair |
| **E. Bundling in corridors** | `crossref-10-1007-978-3-642-18469-7-30`, `doi-10-1109-tvcg-2021-3114795` | visual clutter down, ambiguity up | good | cheap on top of A | **OPTIONAL toggle**, restrict to same-hull-pair groups; user studies warn on traceability |

**Metrics to wire into the scorer** (all cheap): share of crossings <70°, near-flat segment share, bend count, per-side endpoint angular resolution. The 70° threshold (Huang et al.) is the one number the perceptual literature actually gives us.

**One structural note**: crossings are fixed by ordering, not routing (Forster `openalex-w1530155803`; GKNV). A routing pass should therefore be sold to the scorer on _angle/piercing_ metrics, not crossing count — expecting crossing wins from routing alone will read as a null result.

## Sources

Local graph-layout-rag doc_ids: gansner-tse93; graphviz-dotguide; graphviz-edge-router (DGKN97); graphviz-overview-short (EGKNW03); doi-10-1007-bfb0021828 (Sander, Fast Heuristic for Hierarchical Manhattan Layout); forward-10-5121-csit-2021-111821 (Raykov 2021 orthogonal edge routing); doi-10-1145-800158-805069 (Hashimoto & Stevens 1971 channel routing); s2-10-2991-icacsei-2013-27 (channel points); elk-10-1007-978-3-642-11805-0-14 (Port Constraints in Hierarchical Layout of Data Flow Diagrams); elk-10-1016-j-comgeo-2022-101886 (generalized port constraints); arxiv-2309-01671v2 (Simple Pipeline for Orthogonal Graph Drawing); elk-layered-algorithm-reference; doi-10-1007-11618058-40 + wybrow-marriott-stuckey-incremental-routing-2008 (Incremental Connector Routing / libavoid); wybrow-marriott-stuckey-orthogonal-connectors-2010 (Orthogonal Connector Routing); doi-10-1007-978-3-642-31223-6-10 (Orthogonal Hyperedge Routing); openalex-10-1007-978-3-030-86062-2-2 (interactive orthogonal hyperedge routing); arxiv-2605-17498v1 (sleeve routing in the browser); forward-10-1109-pacificvis-2015-7156356 / openalex-w3212372015 (Clustered Edge Routing, Bouts & Speckmann); crossref-10-1007-978-3-642-18469-7-30 (layered edge bundling); doi-10-1109-tvcg-2021-3114795 (Edge-Path Bundling); doi-10-1109-tvcg-2016-2598958 (confluent drawings user study); openalex-10-1007-978-3-540-31843-9-20 (Confluent Layered Drawings); openalex-w1530155803 (Forster dissertation, cluster-level crossings); forster-compound-crossing-gd2002; doi-10-1145-1865841-1865854 (Huang & Huang, crossing number vs angle); doi-10-1109-apvis-2007-329282 + forward-10-48550-arxiv-0810-4431 + s2-e1691683eafdcaffeca40b903250f18cb39be830 (Huang eye-tracking); jgaa-2700 (RAC perspectives); jgaa-2273 (RAC-drawability); doi-10-1093-comjnl-bxs088 (Total Resolution); crossref-10-1007-978-3-030-04414-5-19 + arxiv-1808-10519v1 (crossing resolution heuristics); crossref-10-7155-jgaa-00575 (stub resolution); s2-10-1109-access-2020-3047616 (empirical evaluation survey); s2-10-1007-bfb0021827, openalex-10-1006-jvlc-2002-0232, s2-527ca0518fca9efdbea27c8a3289a4c8d67e22f6 (Purchase aesthetics); doi-10-1007-978-3-319-50106-2-17 (Compact Layered Drawings). URLs as listed in query outputs (graphviz.org/documentation/TSE93.pdf, DGKN97.pdf; link.springer.com and arxiv.org PDFs per doc). The ~70° crossing-angle threshold: Huang, Eades & Hong empirical line (corpus docs above).

---

# synthesis-probe-plan

## Summary

Probe plan: 4 probes + 1 stretch, ordered by EV. P1 strataChannelRoute (owner's dummy-column idea as inter-rank channel/track orthogonal routing, Sander/Hashimoto-Stevens — strongest literature support, cheapest, best fit to strata structure); P2 strataEdgeStyle render enum (React Flow smoothstep/bezier math — pure angle-aesthetics win, near-zero risk); P3 strataPortSpread (port spreading on card sides — biggest per-cost endpoint-angle win, composes with everything); P4 corridor splines (dot-style funnel+Bezier through P1's corridors — the soft-look A/B arm); P5 stretch = true reserved-width corridors at coordinate-assignment (heavier pre-placement seam, only if P1's zero-width channels prove too cramped). All post-geometry probes hook at terraformPipelineStrataSceneBuild.ts:366-378 and must stamp terraformRoutedPolyline or binding repair erases them. New metrics needed: bend count, near-flat segment share, <70° crossing share (sharp-crossing summary exists but at 30°), endpoint angular resolution. Cleanup: collapse routing into one strataEdgeMode enum + separate strataEdgeStyle render enum; deprecate inert strataPenW/strataCrossW and hidden no-ops.

## Findings

# Strata Edge-Routing Probe Plan

All three reports converge: crossings are fixed by ordering, not routing (Forster, GKNV) — so these probes are sold on **angles, bends, piercings, and card-silhouette cleanliness**, not crossing count. Expecting crossing wins from routing alone will read as a null result; the measurement plan below is built around that.

**Shared contract for every post-geometry probe** (from repo audit):

- Hook: `terraformPipelineStrataSceneBuild.ts:366-378`, after `appendPipelineEdgeSkeletons` (:354), alongside `strataEdgeRouting`/`strataBorderRoute`. Inputs available: mutable `skeleton` (TFD arrows via `customData.terraformEdgeLayer === "declaredDataFlow"`), `input.model` (hull tree + rank structure), `input.placement` (`boxedHulls`, `leafBoxes`), `layoutBoxes`.
- MUST stamp `customData.terraformRoutedPolyline: true` or `repairTerraformEdgeBindings` (`terraformVisibility.ts:1007`, flatten at :1162-1171) erases the geometry on the next repair pass. Respect first-stamper-wins with the existing two passes; flag-off byte-identity.
- Threading: all ~11 sites in the audit's §4 list, especially the two silent-drop literals — `terraformLayoutCore.ts` sceneContext (~:1283) and BOTH `terraformSceneApply.ts` literals (~:387, ~:544). Add default to `terraformStrataDefaults.ts` so `terraformLayoutCoreStrataThreading.test.ts` covers the drop seams automatically. Registry row in `terraformStrataOptionRegistry.ts` + rule in `terraformStrataOptionRules.ts`.
- Harness: copy `terraformStrataArmEval.probe.test.ts:296-333` (renderedCrossings via `diagnosePipelineScene`, pierce via `computePierceMetrics`); headless proof via `GET /api/terraform-layout`.

---

## Probe 1 — `strataChannelRoute`: inter-rank channel/track orthogonal routing (the owner's dummy-column idea) — BUILD FIRST

**Pitch:** Every inter-rank edge becomes exit-stub → vertical run in a reserved corridor between ranks → entry-stub; all cross-axis displacement happens in the corridor at 90°, so near-flat diagonals cutting across cards disappear by construction.

**This IS the owner's dummy-column idea**, grounded exactly where the literature agent found it: VLSI channel routing (Hashimoto & Stevens 1971, `doi-10-1145-800158-805069`), Sander's hierarchical Manhattan layout (`doi-10-1007-bfb0021828` — the closest published system to strata: layered + compound + Manhattan + border nodes), Raykov 2021 (`forward-10-5121-csit-2021-111821` — practically a spec for this toggle), and ELK/KIELER vertical-segment routing. Key literature framing: channels don't change crossing COUNT (fixed by ordering) but **relocate crossings into the corridor at 90°** and away from card faces — exactly what the perceptual literature (Huang: <70° crossings degrade reading) says to buy.

**Algorithm sketch** (v1 uses existing inter-rank gaps as zero-width channels; no geometry moves):

1. From `input.model` + `input.placement.leafBoxes`, compute per-rank X extents; the gap between rank i and i+1 is channel Cᵢ.
2. For each TFD edge spanning ranks [r, s]: replace the chord with an orthogonal polyline — horizontal exit stub from source card (perpendicular exit, ~20px, React Flow's escape-offset trick), one vertical run per traversed channel, horizontal entry stub into target. Long edges (s > r+1) get a vertical run in EACH traversed channel at a track X, hugging the corridor (this is where dummy columns manifest without moving nodes).
3. Track assignment per channel: collect all vertical runs' Y-spans, sort by span, assign tracks left-edge-algorithm style (interval-graph coloring — optimal, linear-ish after sort); track X = channel left + trackIndex × trackGap (clamp trackGap to fit channel width; overflow → stack at minimum 2px separation). Order tracks to minimize channel-internal crossings (sort by target-Y — the classic Sander heuristic).
4. Skip edges already stamped by edgeRouting/borderRoute; stamp `terraformRoutedPolyline`; keep endpoints/bindings untouched. Optional acceptance guard: reuse edgeRouting's "never emit worse" pattern (:434-464) per-edge on pierce.

**Expected effect:** near-flat segment share → ~0 by construction; all crossings become 90° in-corridor (sharpShare under both 30° and 70° thresholds → ~0); pierce should drop materially (interior diagonals through foreign cards gone — this pass subsumes most of what `strataEdgeRouting` buys, without its +192 crossing pathology since routes are channel-constrained, not free detours); rendered crossing count roughly unchanged (sell it that way). Cost: bends +2 per traversed channel.

**Cost at preset:** 322 edges × interval-coloring per channel ≈ trivially linear; well under the existing passes' budget. Deterministic.

**UI:** value in the new consolidated routing enum (see cleanup section) — this is the headline option, candidate to replace `strataEdgeRouting` as the recommended advanced mode.

**Measurement:** existing `diagnosePipelineScene` crossings + `CrossingAngleSummary` (polyline-aware) + `computePierceMetrics`; NEW metrics (see §Metrics): bend count, near-flat share, <70° crossing share. Success = pierce down, sharp/near-flat share ≈ 0, crossings within ε, owner eyeball.

**Risks:** (1) narrow inter-rank gaps → tracks overlap → visual bundling; mitigate with clamped trackGap + report channel occupancy. (2) bend count balloons on long edges — cap or fall back to chord for edges spanning >N ranks (expose as sub-knob only if needed). (3) same-rank (flat) edges need a separate rule (route through the rank's vertical gaps, dot-style) — v1 may leave them as chords. (4) Chord-proxy scorer can't see any of this (audit §2.5) — measurement must be rendered-scene only.

---

## Probe 2 — `strataEdgeStyle`: endpoint-local path styles (React Flow transplant) — CHEAPEST, DO IN PARALLEL

**Pitch:** Port React Flow's `getSmoothStepPath` / `getBezierPath` math (~150 lines each, pure endpoint functions, MIT) as opt-in render styles for TFD arrows: perpendicular 20px exit stubs, single parameterized Z-bend, clamped-radius rounded corners (smoothstep) or midpoint-control-point cubic bezier. Directly attacks priority (2) — the "calm" React Flow look — with zero layout knowledge.

**Algorithm sketch:** In the same sceneBuild seam, rewrite each 2-point chord to the smoothstep point sequence (source side = Right, target side = Left in LR; escape offset 20px; `centerX` at 0.5): 4-6 points. Excalidraw `roundness:{type:2}` already rounds multi-point arrows, so corner rounding may come free from the renderer; if the radii look wrong, densify bends with the quadratic-arc formula (`bendSize = min(d1/2, d2/2, borderRadius)`). Bezier variant: emit a denser polyline sampled from the cubic (Excalidraw arrows are polylines). Stamp `terraformRoutedPolyline`. Composes UNDER P1: when channelRoute is on, P2 only styles the corners; standalone, it's the pure-aesthetic arm.

**Expected effect:** endpoint angles fixed (always perpendicular exit — no flat-angle departures from cards); mid-path near-flat segments and crossing angles UNCHANGED or slightly worse (no obstacle knowledge — smoothstep Z-bends can pierce foreign cards exactly like chords). Pierce/crossings ≈ neutral. This is the A/B "does the owner just want the React Flow feel?" arm.

**Cost:** O(1) per edge; negligible. **UI:** `strataEdgeStyle` enum `straight | step | curve` (render-style axis, separate from routing-mode axis). **Measurement:** endpoint angular resolution (new), near-flat share, sharpShare; expect pierce/crossings flat — that's fine, this probe is scored on angles + eyeball. **Risks:** binding repair round-trip of 4+ point arrows near the 38.5px `ROUTED_ANCHOR_TOLERANCE` (`terraformVisibility.ts:1105-1151`) — extend `terraformVisibility.routedPolyline.test.ts`; the escape stub protrudes into hull padding — clamp to `PIPELINE_FRAME_PAD`.

---

## Probe 3 — `strataPortSpread`: endpoint spreading on card sides — DO REGARDLESS

**Pitch:** Today every edge anchors via center-clipped chord math (`getCenterClippedLine`, `terraformElkLayout.ts:1729ff`), so a card with k edges has them all converging near one point at wild angles. Spread anchors along the card side, ordered by target direction — the literature's "endpoint angle is a port problem, not a path problem" (ELK port constraints `elk-10-1007-978-3-642-11805-0-14`; total resolution `doi-10-1093-comjnl-bxs088`). Biggest per-cost angle win; composes with P1/P2 and with current orbit binding.

**Algorithm sketch:** Per card and side: gather incident TFD edges, sort by the far-endpoint's Y (barycenter order — also yields small local crossing reductions), distribute `fixedPoint`s evenly along the side (respect a margin), rebuild orbit bindings with the new fixedPoints. Runs BEFORE P1/P2 in the seam so they consume the spread anchors. Needs the repair pass to respect spread anchors — either stamp routed-polyline or (better) teach `repairTerraformEdgeBindings` a `terraformPortSpread` marker that re-derives the same spread deterministically instead of reverting to center-clip; the latter survives card moves.

**Expected effect:** endpoint angular resolution up sharply (the metric this probe owns); small local crossing reductions from barycenter port order; pierce neutral. **Cost:** per-card sort, negligible. **UI:** boolean toggle, basic section candidate if it eyeballs well (it's the least invasive change here). **Risks:** repair-pass interaction is the whole risk — the marker/re-derivation design must land first; multi-edge pairs already offset via `TERRAFORM_DECLARED_DATAFLOW_OFFSET_PX` need de-duplication with spreading.

---

## Probe 4 — `strataEdgeStyle: spline` through P1's corridors (dot-style) — A/B ARM AFTER P1

**Pitch:** Same corridors as P1, softer rendering: treat the per-edge channel polyline as a corridor region, funnel-shortest-path, fit a piecewise Bezier (GKNV `gansner-tse93`; DGKN97 `graphviz-edge-router`; browser-scale confirmation `arxiv-2605-17498v1`). The "dot look" versus P1's "circuit-board look" — pure eyeball A/B, same crossing/pierce numbers.

**Algorithm sketch:** Take P1's routed polyline, inflate each segment to a corridor (half trackGap), run funnel on the corridor polygon, sample the fitted Bezier to an Excalidraw polyline (12-16 points), stamp marker. Implement as a value of the `strataEdgeStyle` enum that requires channel mode — enforce via `terraformStrataOptionRules.ts`.

**Expected effect:** identical topology to P1; crossing angles between splines vary (measure — may reintroduce some <70° crossings); no 90° bends, so bend-count metric is replaced by curvature smoothness; owner preference is the real output. **Cost:** funnel+fit linear per edge; fine at 322. **Risks:** spline sampling fidelity vs binding repair; curve-curve crossing-angle computation needs segment-level approximation (the polyline-aware diagnostics handle it since we emit polylines anyway). Build only if P1 survives eyeball.

---

## Probe 5 (STRETCH, not in the first wave) — true reserved corridors at coordinate assignment

If P1's channels prove too cramped (track overflow on the preset), the literature-correct escalation is reserving real width between ranks (dummy columns that nodes never occupy — Sander's channel height, `s2-10-2991-icacsei-2013-27` BOX_W/BIT_W arithmetic) or dagre-style dummy edge-slots participating in ordering (structural crossing wins on long edges). This hooks pre-placement (rank/coordinate stages) — a different, heavier seam per the audit — and costs width, which strata already fights (`doi-10-1007-978-3-319-50106-2-17`). Decision gate: P1's channel-occupancy report. Do not build speculatively.

**Explicitly deprioritized:** libavoid/visibility-graph routing (both literature and JS reports: strictly more machinery than a layered drawing needs, order-dependent greedy crossings, VG cost at 7k obstacles, beta WASM). The existing `strataEdgeRouting` already occupies this niche and is crossing-adverse (+192). Bundling: optional later, restricted to same-hull-pair groups only (traceability warnings in `doi-10-1109-tvcg-2016-2598958`).

---

## Metrics to add (one small PR, before or with P1)

`diagnosePipelineScene` already has polyline-aware crossings and a `CrossingAngleSummary`, but its sharp threshold is 30° (`SHARP_CROSSING_MAX_DEG`, `terraformPipelineCollisionDiagnostics.ts:88`) — the perceptual literature's number is **70°** (Huang/Eades/Hong). Add to the diagnostics struct (all O(crossings + segments), from geometry already in hand):

1. **crossing-angle share <70°** (keep 30° too, report both);
2. **bend count** per edge (total + p95) and min bend angle;
3. **near-flat segment share** — fraction of segments with |angle to rank axis| below ~15° AND length above a floor (the owner's "extreme angle" complaint, operationalized);
4. **endpoint angular resolution** — per card side, min gap between consecutive incident edge directions (P3's metric). Wire all four into the arm-eval harness rows. Reminder from the audit: the placement scorer is chord-based and blind to routing — all probe acceptance runs on rendered-scene diagnostics only.

---

## Cleaning up the existing mess — recommendation

**Consolidate to two orthogonal enums** (routing MODE × render STYLE), replacing the pile of booleans:

- `strataEdgeMode: off | border | avoid | channel` — `border` = current borderRoute; `avoid` = current edgeRouting; `channel` = P1 (with borderRoute's ancestor-exit behavior folded in, since Sander's border nodes and channels are one system in the source paper). This kills the undocumented first-stamper-wins precedence protocol: one mode, one owner per edge.
- `strataEdgeStyle: straight | step | curve | spline` — P2/P4; `spline` gated on `mode=channel` via `terraformStrataOptionRules.ts`.
- Keep old URL params as parse-only aliases mapping into the enums (the registry already supports urlParam≠optionKey aliasing) so share URLs keep working; emit only the new enums.
- **Deprecate now:** `strataPenW`/`strataCrossW` (registry-admitted "inert without a consumer" — remove from UI, keep parse as no-op); hidden no-ops `strataPackedConverge`/`strataTransitiveAdopt` stay parse-only, delete their registry UI presence. Give `strataEdgeCap` an explicit default to end the absence-inherits-ε / explicit-0 emitter-erasure hazard (registry :250-256).
- **Long-term flag** (not this wave): the registry (:8-21) is descriptive while parser/panel/emitter keep hand lists — driving those surfaces FROM the registry would prevent the next chainRelocate-style silent drop, but that's a refactor, not a probe.

`strataEdgeRouting`'s crossing-adverse (+192/−140) trade likely becomes moot if P1's channel mode delivers pierce wins without free-detour crossings — plan to demote `avoid` to legacy once P1 is validated.

**Owner's dummy-column idea:** yes — it is Probe 1, the top-ranked probe, in its cheap post-hoc form (zero-width channels in existing gaps), with the true reserved-width version staged as Probe 5 behind a data-driven gate.

## Build order

1. Metrics PR (§Metrics) — everything else is unmeasurable without it.
2. P2 + P3 in parallel (small, independent) → immediate eyeball A/B for the owner.
3. P1 channelRoute → the headline.
4. P4 spline arm iff P1 eyeballs well.
5. Enum consolidation lands WITH P1 (it introduces the mode enum anyway).

## Sources

Report 1 (JS ecosystem): xyflow bezier-edge.ts / smoothstep-edge.ts, ELK edgeRouting reference, libavoid/adaptagrams + libavoid-js, yFiles EdgeRouter docs, mxGraph OrthConnector, dagre, tldraw elbow arrows, Mermaid flowchart-elk. Report 2 (literature, graph-layout-rag doc_ids): doi-10-1007-bfb0021828 (Sander Manhattan), doi-10-1145-800158-805069 (Hashimoto & Stevens channel routing), forward-10-5121-csit-2021-111821 (Raykov 2021), gansner-tse93 + graphviz-edge-router (DGKN97), arxiv-2605-17498v1 (sleeve routing), elk-10-1007-978-3-642-11805-0-14 (port constraints), doi-10-1093-comjnl-bxs088 (total resolution), doi-10-1145-1865841-1865854 + Huang eye-tracking line (~70° threshold), wybrow-marriott-stuckey-orthogonal-connectors-2010, doi-10-1109-tvcg-2016-2598958 (bundling ambiguity), doi-10-1007-978-3-319-50106-2-17, openalex-w1530155803 (Forster), s2-10-2991-icacsei-2013-27. Report 3 (repo audit): /Users/tusharsariya/Projects/excalidraw-tf/packages/excalidraw/components/terraformPipelineStrataSceneBuild.ts; terraformVisibility.ts; terraformPipelineStrataEdgeRouting.ts; terraformPipelineStrataBorderRoute.ts; terraformStrataOptionRegistry.ts; terraformPipelineCollisionDiagnostics.ts; terraformPipelineStrataPierceMetrics.ts; terraformPipelineStrataPackedScoring.ts; terraformLayoutCore.ts; terraformSceneApply.ts; terraformStrataDefaults.ts; terraformStrataOptionRules.ts; terraformStrataArmEval.probe.test.ts; terraformElkLayout.ts; docs/strata-overnight-results-2026-07-16.md
