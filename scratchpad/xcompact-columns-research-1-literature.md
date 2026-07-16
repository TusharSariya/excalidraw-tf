# X-Compaction → Columns: Literature Angle

**Question.** Strata (Terraform layered/Sugiyama layout) added a greedy leftward X-compaction pass. It removed horizontal dead space but destroyed the _column_ look. Owner's three defects:

- **(A) inconsistent column widths** — siblings in the same container at the same level no longer share a uniform column slot.
- **(B) no gutter/margin** — columns touch; no explicit inter-column padding.
- **(C) near-vertical / coincident edges** — greedy pack pulled endpoints to nearly the same coordinate on the compacted axis, so arrows collapsed toward vertical.

**Framing note (axis convention).** In the Sugiyama pipeline the _layering axis_ is frozen (here: Y / rank-preserving) and the _cross axis_ (here: X) is the one being assigned/compacted. "Column" = an alignment group of nodes sharing an X slot. All literature below is axis-agnostic; read "X-coordinate assignment" as "the coordinate on the free (compacted) axis."

**The one-line thesis of the whole literature.** _Nobody in the layered-drawing literature produces the free-axis coordinate by greedy leftmost packing._ Every serious engine (dot, ELK, dagre, yFiles) computes it as an **alignment-then-balanced-compaction** step, or as a **constrained optimization** (minimize weighted edge length / width **subject to** minimum-separation and alignment constraints). Greedy packing is precisely the failure mode these methods were designed to avoid — it optimizes width with no lower bound on displacement and no notion of a shared column, which is what yields defects A/B/C.

---

## 1. Horizontal (free-axis) coordinate assignment — how alignment produces columns, not a pack

### Brandes–Köpf, "Fast and Simple Horizontal Coordinate Assignment" (GD 2001) — `elk-10-1007-3-540-45848-4-3` (seminal, 65 in-corpus cites)

The canonical answer to "align to a column instead of greedy pack." Three ideas that map directly to the defects:

1. **Block alignment.** Each vertex is aligned with its **median upper/lower neighbor** ("We want to align each vertex with a median upper neighbor"). Aligned vertices form **blocks** (maximal vertical runs). A block is a _proto-column_: all its members get the **same** free-axis coordinate. This is the literature's notion of "alignment to a column" — it is a _combinatorial_ commitment (who shares an X), made _before_ any metric packing. Greedy packing has no such commitment, which is why nodes "that should align ended up colinear with the wrong thing." → **defect A, defect C.**
2. **Balanced compaction, not leftmost.** BK runs the align+compact **four times** (up-left, up-right, down-left, down-right extreme alignments) and takes the **median/average** of the four candidate coordinates. The final layout is therefore _centered_, not jammed against one side. A single leftmost pass is exactly the "greedy leftmost" your engine did; BK's whole point is that one pass is biased and you must balance the four. → directly diagnoses the current regression.
3. **At most 2 bends per edge; inner segments of long edges drawn vertical.** Long-edge chains (dummy nodes) are forced straight, giving the clean columnar spine. → **defect C.**

_Read the 2020 erratum before implementing:_ **Brandes, Walter, Zink, "Erratum"** (`forward-10-48550-arxiv-2008-01252`) — two real flaws in the original block/class-placement logic (one widely re-discovered, one previously undocumented, "requires a non-trivial adaptation"). dagre historically shipped the buggy version.

### Rüegg, Schulze, Carstens, von Hanxleden, "Size- and Port-Aware Horizontal Node Coordinate Assignment" (GD 2015) — `doi-10-1007-978-3-319-27261-0-12` (seminal)

**The most directly applicable single paper**, because Terraform cards have _heterogeneous widths_ and BK assumes uniform node size. Quote: _"Brandes and Köpf assume that all nodes have the same size … thus their algorithm straightens at most one outgoing edge per node. … We extend the approach to remove these restrictions."_ Introduces `place block with straightening` (Algorithm 3) with an explicit `thresh` and `innerShift`/`width` bookkeeping so blocks of _different-width_ nodes still align and straighten multiple edges. This is the version that makes "internal card widths may differ but the column slot is uniform" tractable. → **defect A, defect C.** (This is essentially what ELK's `BRANDES_KOEPF` node placement ships.)

### Sugiyama/STT **priority method** (classical)

Older, simpler alternative: assign each vertex a **priority** (dummy/long-edge nodes get highest priority so they stay straight; real nodes get priority = degree). Sweep layers repeatedly; a vertex moves toward the barycenter of its neighbors and **may displace lower-priority vertices but not higher-priority ones**, minimizing displacement. Guarantees long-edge straightness; simpler than BK but lower quality and can oscillate. ELK exposes it indirectly via `LINEAR_SEGMENTS` (Sander pendulum method). Useful as a cheap alignment post-pass. → **defect C.**

### Gansner–Koutsofios–North–Vo, "A Technique for Drawing Directed Graphs" (dot, TSE 1993) — `gansner-tse93` / `openalex-10-1109-32-221135` (seminal, 675 cites)

The **network-simplex X-coordinate** formulation and the model answer to "compaction _as a constrained objective_." Minimize **Σ Ω(e)·ω(e)·|xhead − xtail|** (weighted total horizontal deviation) **subject to separation constraints** `x(v) − x(u) ≥ ρ(u,v)` for consecutive same-rank nodes u,v. Two levers that solve exactly your problem:

- **Ω edge-priority weights** (inner–inner segment = 8, inner–real = 2, real–real = 1). Long-edge spines are _strongly_ pulled straight; leaf/real edges are weakly pulled, so they get real slope rather than collapsing. → **defect C** (it is _impossible_ for two separated nodes to become coincident: the ρ constraint is a hard lower bound).
- **ρ separation** is the built-in **gutter**. Set ρ per boundary (bigger ρ at container borders) and you get explicit inter-column margins for free. → **defect B.**

This is the crucial conceptual reframe: **you never "fill dead space." You _minimize_ deviation subject to a separation floor.** Dead space that remains is dead space the constraints require. (Strata already has a `pipelineColumnPacking:"shorten"` network-simplex arm per repo memory — this is the same machinery; the lesson is to keep the ρ floor and Ω weights, not to greedily left-collapse.)

### Jünger, Mutzel, Spisla, "A Flow Formulation for Horizontal Coordinate Assignment with Prescribed Width" (GD 2018) — `forward-10-1007-978-3-030-04414-5-13`

Min-cost-flow coordinate assignment that supports **prescribed width, lower/upper bounds on neighbor distance, and enforced vertical edge segments** simultaneously. This is the "I want both compaction and regularity, stated as bounds" paper — directly lets you say "column gutter ≥ g" and "these segments must be vertical" in one solve. → **defects B + C together.**

---

## 2. Grid / column / tabular layered layout — uniform slots and gutters

### Betz, Doll, Gemsa, Rutter, Wagner, "Column-Based Graph Layouts" (GD 2012) — `forward-10-1007-978-3-642-36763-2-21`

Explicitly about assigning nodes to **columns** as a first-class combinatorial object: compute topology first, then a **column-assignment of the nodes** (x-coords _fixed by the column assignment_), then metrics for y. The point most relevant to you: _"Since the x-coordinates are fixed by the column assignment, we only need to deal with y."_ i.e. once a node is assigned to a column, its free-axis coordinate is the column's coordinate — **uniform by construction**, never a per-node greedy value. This is the direct antidote to defect A. → **defect A, defect B.**

### Yoghourdjian, Dwyer, Gange, Kieffer, Marriott, Stuckey, "High-Quality Ultra-Compact Grid Layout of Grouped Networks" (TVCG 2015) — `yoghourdjian-ultra-compact-grid-grouped` (seminal)

Grouped (compound!) networks snapped to a **uniform grid** with a **grid-snap → constraint-derivation → Large-Neighborhood-Search** pipeline, container by container. Shows the standard recipe: run a free layout, **snap to a grid to derive alignment/column constraints**, then re-solve keeping those constraints. Their per-container relaxation loop ("iterate until each container has been selected once") is a template for "make columns consistent _within_ each cluster." → **defects A + B**, and the compound handling feeds §3.

### Klau & Mutzel, "Optimal Compaction of Orthogonal Grid Drawings" (GD 1999) — `doi-10-1007-3-540-48777-8-23`

The orthogonal-drawing view of your exact tension: **two-dimensional compaction that alters coordinates while _preserving the shape_ (the orthogonal ordering / relative position of every node and segment).** This is the formal statement of "compact, but don't let the ordering/alignment change" — the constraint your greedy pass dropped. Key takeaway: legal compaction is _shape-preserving_; greedy leftmost is not, which is why columns broke.

### Quality metrics to score any fix

- **Mooney et al., "Universal Quality Metrics for Graph Drawings" (GD 2025)** `s2-10-4230-lipics-gd-2025-30` — defines **Edge Orthogonality (EO)**: angular deviation of each edge from the nearest 0/90/180°. A near-vertical arrow that _should_ be diagonal scores badly; use EO (or a min-slope metric) as the guard for defect C.
- **van Wageningen, Mchedlidze, Telea, "Same Quality Metrics, Different Graph Drawings" (2025)** `arxiv-2508-15557v1` — cautionary: single metrics are gameable; score columns/gutters/slope jointly, not width alone.

---

## 3. Compound / clustered Sugiyama — per-cluster column consistency

### Sander, "Layout of Compound Directed Graphs" (TR 1996) — `sander-compound-directed-graphs` / `openalex-10-22028-d291-25806` (seminal, 15 in-corpus cites)

The foundational nested-container layered method and the source of the invariant you want: **global partitioning into layers**, then _"placements of nodes such that **border rectangles can be drawn around the nodes of each subgraph**"_ without overlap. The border-rectangle (container-hull) constraint is what keeps a container's children inside one consistent band — the thing greedy leftward packing violates when it pulls a child out into a sibling's dead space. Any X-assignment for strata must run **subject to container-boundary separation constraints**, exactly as Sander enforces border rects.

### Forster, "Applying Crossing Reduction Strategies to Layered Compound Graphs" (GD 2002) — `forster-compound-crossing-gd2002`

Companion to Sander; keeps cluster members contiguous within a layer during ordering (prerequisite for a clean column: members must be _adjacent in order_ before they can share a slot).

### Erande et al., "Clustered Graph Hierarchical Layout Algorithm for Systems Biology Models" (2014) — `forward-10-5120-16945-7012`

Practical modern implementation of Sander-style compound layout with "compartmental constraints and arbitrary nesting" — a concrete reference for wiring per-container constraints into the four phases.

### Han, Lieffers, Morrison, Isaacs, "An Overview+Detail Layout for Visualizing Compound Graphs" (VIS 2024) — `s2-10-1109-vis55277-2024-00035`

Modern treatment: routes cross-container edges **through ports** that _"isolate the inner group layout while preserving path tracing,"_ and adapts a **Flexible** layered layout so **sibling clusters are disjoint**. The port isolation idea prevents a cross-container edge from dragging a node's column position — relevant to defect C for edges that leave a container.

### How the production engines do per-cluster columns (open-internet)

- **ELK Layered** (`elk-layered-algorithm-reference`, `elk-layout-options-reference`): node placement is a distinct phase with strategies **`BRANDES_KOEPF` (default), `LINEAR_SEGMENTS` (Sander pendulum), `NETWORK_SIMPLEX` (Gansner), `SIMPLE`.** _None is a greedy pack._ Spacing/gutter is explicit: `spacing.nodeNode`, `layered.spacing.nodeNodeBetweenLayers`, plus `nodePlacement.bk.fixedAlignment` to pick/balance the BK alignment. Compound spacing has its own keys so container gutters are uniform. Recommendation: mirror ELK's split — _alignment strategy + explicit spacing constants_, never a pack.
- **Graphviz dot**: network-simplex X (§1) with Ω weights + `nodesep` (gutter) + `ranksep`. Clusters get bounding-box constraints — same as Sander.
- **dagre**: implements Brandes–Köpf (`nodesep`/`ranksep`/`edgesep` are its gutters). Note dagre shipped the pre-erratum BK.

---

## 4. Near-vertical / coincident edges — why greedy causes it, why alignment avoids it

- **Root cause.** Greedy leftmost compaction minimizes width/edge-length **with no lower bound on free-axis displacement and no per-node column identity.** When a downstream node finds dead space in an upstream band, it slides into it; its coordinate converges toward its neighbor's → coincident X → near-vertical (or zero-slope) arrow.
- **Why alignment/constrained placement avoids it.**
  1. **Hard separation constraints** `x(v) − x(u) ≥ ρ` (Gansner `gansner-tse93`; Dwyer separation constraints below) make coincidence _infeasible_ — a guaranteed minimum gutter/slope.
  2. **Median placement** (BK, priority method) puts a node at the _median of its neighbors_, so an edge is either intentionally straight (aligned in a block) or has genuine slope — never accidentally near-coincident from packing.
  3. **Ω priority weights** straighten the spines you _want_ vertical (long-edge chains) while leaving leaf edges free to slope, so straightness is _selective_, not global collapse.
- **Dwyer, Koren, Marriott, "IPSep-CoLa" (TVCG 2006)** `dwyer-ipsep-cola` — stress/force layout **with separation constraints** (minimum horizontal/vertical distance between node pairs), used for _directed flow, non-overlapping labels, and grouped clusters._ This is the general engine for "minimize a layout energy **subject to** min-gap and alignment (equality) constraints." Equality separation constraints (`x(v) − x(u) = 0`) are how you **force uniform columns**; inequality constraints are your gutters.
- **Dwyer, Marriott, Stuckey, "Fast Node Overlap Removal" (GD 2005)** `openalex-10-1007-11618058-15` — the O(n log n) constraint-solver primitive underneath IPSep-CoLa; the practical way to _impose_ a minimum separation after a compaction pass without reintroducing overlap. Good building block for a post-pass guard on defect C.

---

## 5. The general tension — compaction vs. alignment/regularity, and how people get both

The literature converges on **one pattern**: regularity (columns, straight edges, gutters) is expressed as **constraints**, and compaction (min width / min edge length) is the **objective minimized subject to those constraints** — never the other way around.

| Pattern | Objective | Constraints (regularity) | Papers |
| --- | --- | --- | --- |
| Network-simplex X | min Σ Ω·ω·\|Δx\| | separation ρ (gutter), fixed order | Gansner `gansner-tse93` |
| Flow / prescribed-width | min edge length, bounds | width bound, neighbor-distance bounds, forced-vertical segments | Jünger–Mutzel–Spisla `forward-10-1007-978-3-030-04414-5-13` |
| BK align + balance | min deviation per alignment, then median | block alignment (shared column), 2-bend cap | Brandes–Köpf `elk-10-1007-3-540-45848-4-3`; size-aware Rüegg `doi-10-1007-978-3-319-27261-0-12` |
| Constrained stress | min stress | equality (uniform column) + inequality (gutter) separation | Dwyer IPSep-CoLa `dwyer-ipsep-cola` |
| Grid-snap + LNS | min area | snap-to-grid alignment, container disjointness | Yoghourdjian `yoghourdjian-ultra-compact-grid-grouped` |
| Column assignment | metrics on y | x fixed by column (uniform by construction) | Betz `forward-10-1007-978-3-642-36763-2-21` |
| Shape-preserving compaction | min total edge length | preserve orthogonal ordering / relative position | Klau–Mutzel `doi-10-1007-3-540-48777-8-23` |

**Two implementation shapes people use:**

1. **Alignment-native placement** (ELK/dagre/dot default): compute alignment (blocks/columns) _first_, then compact each block/class as far as the alignment + separation allow (balanced over 4 directions). Compaction can never break a column because the column is fixed before compaction runs.
2. **Compact-then-repair** (Yoghourdjian, node-overlap-removal): do a free/greedy layout, **snap to a grid to derive column+gutter constraints**, then re-solve (LNS / constraint projection) to restore regularity. Viable as a _post-pass on your existing greedy output_ if replacing the pass wholesale is too invasive.

---

## Ranked shortlist — for a Y-frozen, rank-preserving, nested-container layered layout

### 1 (TOP). Size-aware Brandes–Köpf X-coordinate assignment, replacing the greedy pass

`doi-10-1007-978-3-319-27261-0-12` (Rüegg 2015) built on `elk-10-1007-3-540-45848-4-3` (BK 2001), erratum `forward-10-48550-arxiv-2008-01252`. Align each node to its median neighbor into **blocks = columns**, handle **heterogeneous card widths** (essential for Terraform), balance over the four extreme alignments (no leftmost bias), cap at 2 bends. It is _exactly_ what ELK/dagre/dot use to get the clean column look, keeps rank order, and is linear-time. Directly fixes **A** (blocks give shared, size-normalized slots) and **C** (median placement + straight spines). Add per-column equal-width slot + ρ gutter for **B**.

### 2. Network-simplex X with Ω weights + ρ separation (compaction _subject to_ separation)

`gansner-tse93`. Reframes your pass from "fill dead space" to "**minimize weighted deviation subject to a separation floor**." ρ _is_ the gutter (**B**); the floor makes coincident/near-vertical edges infeasible (**C**); Ω weights straighten long-edge spines selectively. Strata already has a network-simplex column-packing arm — keep the ρ floor and Ω weights instead of collapsing left. Pairs naturally with #1 (BK for alignment, NS for the metric compaction) — this is ELK's `NETWORK_SIMPLEX` node-placement option.

### 3. Separation-constraint layout with **equality** alignment + Sander container borders

`dwyer-ipsep-cola` + `openalex-10-1007-11618058-15` (Dwyer) for the solver; `sander-compound-directed-graphs` for the compound invariant; `forward-10-1007-978-3-642-36763-2-21` (Betz) / `yoghourdjian-ultra-compact-grid-grouped` (Yoghourdjian) for the uniform-column-by-construction view. Use **equality separation constraints to force siblings into one uniform column (A)**, **inequality constraints for gutters (B)**, and **Sander-style border-rectangle constraints per container** so compaction can't pull a child out of its cluster (root of A + C in the nested case). Best as either a constraint layer over #1/#2 or a **compact-then-snap-then-repair post-pass** over the current greedy output.

### Single most promising approach

**Replace the greedy leftward pack with size-aware Brandes–Köpf block alignment as the X-coordinate assignment (shortlist #1), run with a minimum node separation ρ and per-container uniform-column-slot constraints (borrowing the ρ / Ω-weight and border-rectangle machinery from #2 Gansner and Sander).** Rationale: it is the smallest change that attacks the actual root cause — the pass currently assigns a _per-node_ coordinate with no column identity and no separation floor. BK makes the _column_ (block) the unit of placement, so nodes that belong together share an X _by construction_ (defect A); the four-way balanced compaction removes the leftmost bias while still eliminating dead space; the ρ floor guarantees gutters (B) and makes near-vertical/coincident edges infeasible (C). It is the exact technique the mature layered engines (ELK `BRANDES_KOEPF`, dagre, dot) already rely on for "clean columns," so it is well-trodden and low-risk. Compaction survives — but as _balanced block compaction bounded by alignment + separation_, not as a greedy fill.
