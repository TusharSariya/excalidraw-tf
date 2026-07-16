# Strata Research — Agent 3: Compound / Clustered / Nested Layered Layout + Cross-Container Edges (P3)

**Charter:** us-west-2 region box inflation + VPC frame pierce. Region-level (vpc=none) degree-1 sinks (api8–11 SSM params, S3, DynamoDB) stranded at rank 26 while their ECS/lambda **sources sit inside vpc-5b587**. Edges cross the VPC frame (inside→outside) = the "pierce"; the region box has a dead upper-right quadrant → inflated width + height.

**Verdict up front:** The frame-pierce is **EXPECTED and unavoidable** given the containment — it is the defining case of a _compound_ (as opposed to recursively-nested) graph. The literature does **not forbid** cross-boundary edges; it **minimizes** them and routes them through **border/port nodes**. The single most robust fix is **Sander (1996) border-node insertion** for the cross-container edge (cleans the pierce to the topological minimum of one crossing); the region-box size is a _separate_ problem needing a cluster-local relocation pass (Lever A+D), which is higher-payoff but more constrained.

---

## Q1 — Is a node-outside-container edge crossing that container's frame EXPECTED/handled? FORBID / MINIMIZE / ROUTE-AROUND?

**EXPECTED and MINIMIZED — never forbidden. This is the literal definition of a compound graph.**

Sander (1996), _Layout of Compound Directed Graphs_ (`sander-compound-directed-graphs`, TR A03/96, Universität des Saarlandes; the VCG/aiSee algorithm) is explicit (p.2, verbatim):

> "a compound graph is **not** recursively defined as a graph whose nodes might be graphs… There we would only allow connectivity edges between nodes at the **same** nesting level. The notion compound graph is **more general because it may contain connectivity edges that cross the borders of nested subgraphs**."

So P3's edge (source inside VPC, sink at region level) is not a pathology — it is the exact construct the compound-layout literature exists to handle. Sander's **Layout Convention (g)** (p.3):

> "Connectivity edges **may cross border lines** but we **try to avoid** such crossings **when possible**."

That is MINIMIZE, not FORBID. The mechanism:

- **Border nodes** `u(-)` (upper) and `u(+)` (lower) are dummy nodes given their own ranks; `Rmin(u)=R(u-)`, `Rmax(u)=R(u+)` bound each subgraph rectangle (Sander §"Partitioning into Layers", p.4). Strata's `rankSeparate`/OD-14 separation-augmented DAG is the direct analog of Sander's nesting graph + global longest-path rank assignment (Theorem, p.5).
- **Dummy-node assignment (p.7, Fig.6, two strategies).** A dummy node for a cross-border edge `w→w'` "must be assigned **at least to the subgraph that contains both** w and w'" (first common ancestor in the nesting tree) — precisely "so that we avoid that an edge leaves a border rectangle unnecessarily and later reenters the rectangle **producing two crossings** with borders." _Strategy 1_ routes dummies **outside** the box → edge crosses at the **side**; _Strategy 2_ routes **inside** → edge crosses **top/bottom**. The algorithm **chooses where** the pierce happens; it does not eliminate it.

**Other systems, same posture (minimize + port/border, never forbid):**

- **Sugiyama & Misue (1991)**, _Visualization of structural information: automatic drawing of compound digraphs_, IEEE SMC (`forward-10-1109-21-108304`, metadata-only in rag) — the original compound Sugiyama; distinguishes _inclusion_ edges (containment) from _adjacency_ edges (which cross levels).
- **ELK** (`s2-10-48550-arxiv-2311-00533`, Domrös et al. 2023): compound graphs are laid out **bottom-up by default**; "the inner graph of a compound node determines the position of **hierarchical ports**, which cannot be changed by the parent." Cross-hierarchy edges are handled either by hierarchical ports (bottom-up) or by `hierarchyHandling = INCLUDE_CHILDREN`, which **flattens across levels** so global crossing-minimization can see cross-cluster edges (`elk-layered-algorithm-reference`, `elk-layout-options-reference`). Neither forbids the crossing.
- **Forster (2002)**, _Applying Crossing Reduction Strategies to Layered Compound Graphs_ (`forster-compound-crossing-gd2002`) — improves Sander's 2-layer crossing reduction to be "optimal in the sense that it does not introduce unnecessary crossings by itself." Still minimizes, not forbids.
- **c-planarity literature** (Di Battista/Didimo _Planarization of Clustered Graphs_ `openalex-10-1007-3-540-45848-4-5`; Da Lozzo/Eppstein/Goodrich/Gupta 2021 `openalex-10-1007-s00453-021-00839-2`; Goodrich/Lueker/Sun _Extrovert Clustered Graphs_ `crossref-10-1007-11618058-20`) is the theoretical floor: a drawing is **c-planar** iff each cluster is a region whose boundary is crossed by **each edge at most once**. "At most once," not "zero." The _ideal_ a cross-container edge should hit is **exactly one clean crossing**.

**Topological reason the pierce cannot be zero (my derivation, backed by c-planarity):** the VPC rectangle is a closed Jordan curve separating its interior from the exterior. An edge from an interior source to an exterior sink crosses that boundary an **odd number of times → minimum 1**. Given the containment (sink genuinely region-level), the pierce count is bounded below by 1 and **cannot be removed by layout**. Everything the literature does is drive it to that floor of one clean crossing.

---

## Q2 — Pull the sink INTO the VPC (change containment), or handle via border/port nodes?

**Border/port nodes. Do NOT change containment.** Two reasons, one literature, one domain:

1. **Sander's framework treats the nesting tree `T` as INPUT.** Crossing reduction reorders _within_ the fixed containment (barycenter + the two compound rules, p.8: same-subgraph same-rank nodes form an "unbroken sequence"; non-nested subgraphs "must not be intertwined"). Nodes are **never moved between clusters** to reduce crossings — that would violate convention (e) and change the semantics the drawing is meant to convey. The prescribed remedy for a cross-level edge is the **border node** on the pierced frame + the dummy-assignment strategy that guarantees a single side/top crossing.
2. **Domain correctness.** In AWS the api8–11 SSM params / S3 / DynamoDB genuinely are **region-level (vpc=none)** — they are _not_ in vpc-5b587. Pulling them inside the VPC box would draw a factually false containment (a region-scoped resource depicted as VPC-scoped). The containment is ground truth, not a free variable.

**What Sander's border-node insertion prescribes for P3, concretely:** for each inside→outside edge, insert a border node on the vpc-5b587 frame at the rank where the edge exits, using **Strategy 1** (dummies outside the VPC after the exit) so the edge crosses the VPC boundary **once, at the side/top**, then runs in region-level space to the sink — instead of a long diagonal slashing through the VPC interior and other elements. This collapses a messy multi-element pierce into one labeled boundary crossing (a "port").

---

## Q3 — Region-box compaction; the "cluster must be a contiguous rectangle" constraint and its cost; recursive per-cluster layout + packing

**The contiguous-rectangle constraint is exactly what inflates the region box, and it is a hard convention in every compound-layout method** — including strata.

- Sander conventions **(e)** "A border rectangle of subgraph `u` contains exactly the base nodes and rectangles that belong to `u`" and **(f)** "border rectangles of two non-nested subgraphs do not overlap" (p.3). Enforced at ordering time (p.8): same-subgraph nodes of a rank form an **unbroken sequence**, and subgraphs are **not intertwined** (the _subgraph ordering graph_, p.10–11). **Consequence:** the cluster's bounding rectangle = the max extent of its members in _both_ axes. If the region owns ranks 21–26 but its content is sparse at ranks 24–26 (n=2 each vs n=10 at r20) and clustered at one Y band, the rectangle still spans the **full** rank range × full Y range → the empty **upper-right dead quadrant** P3 observes. This wasted area is the _intrinsic cost_ of the rectangle convention, not a strata bug.

- **Recursive per-cluster layout** is the standard escape: lay each cluster out in its **own coordinate system**, then treat it as a single node in the parent and pack. This is yFiles _Recursive Group Layout_ and **ELK bottom-up** (`s2-10-48550-arxiv-2311-00533`). It removes the dead quadrant because there is **no shared global grid** forcing sparse ranks to occupy full-width bands. **But Sander explicitly warns against it** (p.2): methods that "recursively deal with subgraphs as large nodes but **ignore the global connectivity**… may result in **too much edge crossings** if there are edges going beyond the borders of subgraphs." That is precisely P3's regime (many cross-container edges). So recursion trades cluster compactness for cross-container crossing quality.

- **Packing after per-cluster layout:** Freivalds, Dogrusoz & Kikusts (2002), _Disconnected Graph Layout and the Polyomino Packing Approach_ (`doi-10-1007-3-540-45848-4-30`) — represent each component by its **actual occupied cells (a polyomino)**, not its bounding rectangle, and pack them interlocking; "much more compact and uniform drawings than previous methods." This is the general principle that **packing by real occupancy beats packing by bounding box** — directly relevant to letting sibling content nest into a neighbor's L-shaped dead quadrant. (Caveat: AWS region/VPC boxes must render as rectangles, so polyomino packing applies to how _siblings pack around_ a box, not to reshaping the region box itself.)

---

## Q4 — Dead-quadrant / cluster aspect-ratio problem: how do compound layouts avoid a big empty quadrant?

Four literature levers, in decreasing fit-to-strata:

1. **Cluster-local coordinate assignment** (Eades & Feng 1997, _Multilevel Visualization of Clustered Graphs_, `openalex-10-1007-3-540-62495-3-41`; Eades/Feng/Lin _Straight-line drawing of hierarchical & clustered graphs_ `forward-10-1007-3-540-62495-3-42`): position each node "in the corresponding region of the view" per level, compacting each cluster in its own frame. Removes the shared-band dead space.
2. **Fill the sparse cells** (the strata-native version): the dead quadrant exists because rank-26 sinks sit at one Y band leaving upper rows empty. Relocating those sinks **up-and-left into the empty rows within the region's rank span** shrinks the bounding rectangle in both axes — this is P3's Lever A + Lever D and is the same move Sander's ordering _would_ make if the sinks were ordered early (its complete-average- position placement, p.9–10, pulls a subgraph's nodes together).
3. **Aspect-ratio-aware placement:** ARCOL (Alsuwaykit et al. 2026, `arxiv-2603-29618v1`) folds a target aspect ratio into stress minimization + a "projected bounding box" predictor; Duncan/Goodrich/Kobourov _Balanced Aspect Ratio (BAR) Trees_ (`jgaa-2890-…`) recursively BSP-partition to bound each region's aspect ratio. Both are force/stress-family, not layered — useful as design references, not drop-ins.
4. **Layering that targets a drawing area:** Rüegg et al., _Generalized Layerings for Arbitrary and Fixed Drawing Areas_ (`jgaa-2475-…`) — weight selection trading reversed edges vs dummy nodes to hit an aspect target; relevant to strata's rank-assignment stage if height/width balance is scored.

**Why strata inherits the dead quadrant:** it is a **global-grid** (Sander-family) method — `rankSeparate` is one global longest-path ranking, and PACK uses a **bespoke per-hull dropY skyline with emergent, unscored height**. Global ranks + shared Y bands = Sander's exact rectangle cost. The clean structural cure (recursion, lever 1) collides with strata's global grid; the _incremental_ cure is lever 2.

---

## Q5 — 2–3 ranked ROBUST fixes for P3

### Fix 1 (MOST ROBUST; fits strata) — Sander border-node insertion for cross-container edges

For every edge with source and sink at different containment levels, insert a **border node on the pierced frame** at the exit rank and assign the edge's dummy nodes by Sander's **Strategy 1** (outside the box after exit) so the edge crosses the VPC boundary **exactly once, at the side/top**, then travels in region-level space to the sink.

- **Cite:** Sander (1996) `sander-compound-directed-graphs` §Production of Dummy Nodes, Fig.6; refined by Forster (2002) `forster-compound-crossing-gd2002`; ELK hierarchical ports `s2-10-48550-arxiv-2311-00533`.
- **Robust vs edge-case:** Very robust — 30-year-deployed (VCG/aiSee), generic to any nesting depth, no dependence on the specific graph. Edge case: many sinks exiting the same frame cluster their border nodes at one rank → needs border-node spacing/ordering, which Forster's crossing-reduction already handles.
- **Fit:** Additive. Introduces a boundary-dummy node type at hull edges; **does not touch `rankSeparate` or the global grid.** Aligns with the RCLL border/port machinery already present (`terraformPipelineRcll*`). **Limitation: reduces the pierce to 1 clean crossing; does NOT shrink the region box.**

### Fix 2 (HIGHEST PAYOFF; fits strata but more constrained) — cluster-local relocation of stranded degree-1 sinks (Lever A+D)

A guard-gated cross-container operator that pulls each rank-26 region-level sink **left toward its source and up into the region's empty upper rows** (staying region-level, outside the VPC box). Shrinks the region rectangle in **both** axes, shortens the 6 sink edges, and — by moving the sink around the VPC rather than along a diagonal through it — removes the _visual_ pierce.

- **Cite:** Sander conventions (e)/(f) `sander-compound-directed-graphs` (box = max member extent → filling sparse cells shrinks it); cluster-local coordinate assignment Eades & Feng 1997 `openalex-10-1007-3-540-62495-3-41`; occupancy-not-bounding-box packing Freivalds et al. 2002 `doi-10-1007-3-540-45848-4-30`. It is the cross-container extension of the single missing X-shift operator the readability synthesis already isolated.
- **Robust vs edge-case:** Robust _in principle_ but **the most constrained of the five** — must jointly satisfy (a) LR feasibility (sink stays right of source), (b) the P5 height gate (only a joint left+**up** move is height-neutral; pure-left grows height via dropY collision with r24/r25 aurora/rds), and (c) **frame-membership**: the sink must land in region-level space _above/beside_ the VPC, never inside it (else it manufactures a false-containment problem). Fires only when X-pull + ordering + height-gate cooperate → needs a guard, matching P3's own risk note.
- **Fit:** A scored placement operator, gated; heavier than Fix 1 but no rearchitecture.

### Fix 3 (rearchitecture; robust but heavy — recommend NOT now) — recursive/bottom-up per-cluster layout with hierarchical ports

Lay out each region/VPC in its own coordinate system (tight-packed, no dead quadrant), expose hierarchical ports on cluster boundaries, route cross-cluster edges port-to-port (ELK `INCLUDE_CHILDREN` / yFiles recursive group layout).

- **Cite:** ELK `s2-10-48550-arxiv-2311-00533`, `elk-layered-algorithm-reference`.
- **Robust vs edge-case:** Structurally eliminates the dead quadrant _and_ makes every cross-container edge a clean port crossing. **But** (a) it conflicts head-on with strata's global `rankSeparate` grid (breaks global rank alignment + the −42% height lever), and (b) Sander's own warning: recursion inflates cross-cluster crossings — P3 is a cross-cluster-heavy case. A full rewrite; do not adopt for P3 alone.

**Ranking:** Fix 1 (pierce) + Fix 2 (box size) are **complementary and both fit strata** — ship Fix 1 first (cheap, generic, low-risk), then Fix 2 for the structural payoff. Fix 3 is the textbook-correct long-term architecture but is a rearchitecture and is out of scope for an opt-in P3 toggle.

---

## SELF-ADVERSARIAL gaps

- **Does border-node routing actually reduce the pierce, or just hide it?** It does **not** reduce the pierce _count_ below 1 — the Jordan-curve/c-planarity floor forces ≥1 crossing while the sink stays region-level. What it does: (i) guarantees **exactly** 1 (kills leave-and-reenter double-crossings), and (ii) makes that one crossing a clean orthogonal boundary hit instead of a long interior diagonal. So it is _partly_ cosmetic — it reframes the pierce as an intentional port rather than removing it. The **only** way to zero pierces is to change containment (Fix-rejected: semantically false here). Honest framing: Fix 1 fixes the _appearance and crossing-count_ of the pierce; it does not make the edge stop leaving the VPC, because the edge genuinely must leave the VPC.
- **Does recursive per-cluster layout conflict with strata's global rank grid?** **Yes, fundamentally.** Strata's `rankSeparate` is one global longest-path ranking; recursion gives each cluster a _local_ ranking and breaks the cross-container rank monotonicity and the −42% height lever strata depends on. ELK's compromise (`INCLUDE_CHILDREN`) keeps a flattened global grid — but that is essentially _what strata already is_, so it re-inherits the dead quadrant. This is why the robust incremental path is Fix 1 + Fix 2 (operate within the global grid), not Fix 3.
- **Fix 2's height-neutrality is conjectural.** The claim that the upper dead rows absorb the sinks "for free" holds only if ordering places them early and their pulled-X lands X-disjoint from the y≈3200 occupants. Under the P5 unscored-height gate this is _latent_, not guaranteed — it needs the same guard+measurement the readability synthesis flagged. If the guard misfires, Fix 2 grows height (a regress) while Fix 1 never regresses. That asymmetry is why Fix 1 is "most robust" and Fix 2 is "highest payoff."
- **Weights/objective untouched.** None of these fixes touch strata's contested objective (crossings ≻ penetrations ≻ length). Fix 1 reduces _penetration_ count/quality; Fix 2 reduces _length_ + box area. If the objective mis-weights penetration (per the prior objective audit), Fix 1's benefit may not be _scored_ even though it is real — a measurement gap, not a layout gap.

---

## MISSING PAPERS (full citations; rag-absence checked)

Corpus coverage for compound/clustered layered layout is **strong** — Sander 1996, Sugiyama–Misue 1991, Forster 2002 + 2005 dissertation, Eades–Feng 1997 (×2), the c-planarity line, ELK docs, STRATISFIMAL are all present. Genuine gaps:

1. **Dogrusöz, Giral, Cetintas, Civril, Demir (2009), "A layout algorithm for undirected compound graphs," _Information Sciences_ 179(7):980–994 (CoSE / cose-bilkent).** DOI 10.1016/j.ins.2008.11.017. The canonical _force-directed_ compound layout with cross-boundary edges + node repulsion honoring nesting. **Absent** — searches returned only cose-bilkent as a Mermaid config mention, not the paper. Worth harvesting as the force-directed counterpoint to Sander's layered method.
2. **Sugiyama & Misue (1991), IEEE SMC 21(4):876–892 — full text.** Present **metadata-only** (`forward-10-1109-21-108304`, no PDF). The foundational compound-digraph paper; the inclusion-vs-adjacency edge distinction is exactly P3's semantics. Recommend fetching the PDF.
3. **Sander (1994/1996), "Graph layout through the VCG tool," GD'94, LNCS 894.** The system paper for the compound method above; describes the border-node engineering. **Absent.** Secondary to the 1996 TR (which we have in full), so low priority.
4. **Bourqui, Auber, Mary (2007) / "Detail-Preserving" compound layouts & GRIP-style multilevel** — not found; low relevance to P3 (large-graph multilevel, not containment pierce). Noting for completeness only.

(Not staging the missing-lit doc per instructions — the above is the scratchpad record.)
