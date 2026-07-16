# Agent 4 — Coordinate Assignment & Node Packing (strata `dropY` skyline)

Charter: is strata's bespoke `dropY` skyline packer literature-sound? What do standard within-layer coordinate-assignment methods do instead? Focus: P5 packed-height coupling; underlies P1/P3/P4. Robust, generic, literature-backed only.

Method: graphify-oriented on the code (`terraformPipelineStrataPlacement.ts:80-102,325-333`, `dropY`/`placeStrataHulls`), then queried the graph-layout RAG corpus. All doc_ids below are live in the local `graph` corpus unless flagged MISSING.

---

## Q1 — Standard within-layer coordinate assignment: does it treat the cross-axis extent as objective, constraint, or by-product?

The canonical methods all assign the **within-layer (perpendicular) coordinate to minimize edge length / bends / deviation from neighbor medians, subject to a hard minimum-separation constraint**, with the layer _count_ (the other axis) already fixed by the layering step. None of them treat the cross-axis physical _extent_ as the thing that "emerges" from packing; they optimize position and take separation as an inviolable constraint.

- **Priority method (Sugiyama–Tagawa–Toda 1981; STT).** Iterative up/down sweeps; each vertex is pulled toward the barycenter/median of its neighbors, with higher-priority vertices (dummy nodes on long edges, high-degree) allowed to push lower-priority ones only as far as min-separation permits. Objective = edge straightness; separation = hard constraint. Described as "Previous Work" in Brandes–Köpf and the GD handbook (`handbook-hierarchical`, §13.6 x-coordinate assignment). _(STT 1981 itself is MISSING from corpus — see below.)_

- **Brandes–Köpf (2002), "Fast and Simple Horizontal Coordinate Assignment"** (`elk-10-1007-3-540-45848-4-3`, seminal, in-corpus cited 65×). Linear-time. Aligns vertices into vertical **blocks** (biased toward straightening one edge/vertex, 4 combined up/down×left/right alignments averaged), then compacts blocks against **minimum-separation constraints**. The objective it optimizes is deviation-from-alignment (edge straightness / length); separation is a hard constraint; the drawing's width is a _result_ but bounded and balanced by averaging the four extreme alignments — it is NOT left as an unmanaged by-product. Erratum: Brandes–Walter–Zink 2020 (`forward-10-48550-arxiv-2008-01252`) fixes two correctness flaws — relevant if strata ever adopts BK.

- **Network-simplex X-coords (Gansner–Koutsofios–North–Vo 1993; `gansner-tse93`, seminal, 675 cites).** Pass 4 assigns X by solving a **min-cost flow / integer program** that _directly minimizes total weighted horizontal edge deviation_ `Σ Ω·ω·|xu−xv|` subject to `x[left]+sep ≤ x[right]` ordering/separation constraints. Cross-axis extent (width) is again a _constrained by-product_, not an objective — the objective is edge length. This is exactly the method strata's peers (ELK, dot) use, and it is the direct optimization analog of what `dropY` does greedily. (`handbook-hierarchical` §13 confirms.)

- **Sander / minimum-deviation quadratic** methods (the "[5]" related approach BK cites): place each vertex at the _mean_ of its neighbors (least-squares), solved as a linear system; again min-separation is the constraint, edge length the objective.

- **Flow formulation with prescribed width — Jünger–Mutzel–Spisla 2018** (`forward-10-1007-978-3-030-04414-5-13`). Min-cost-flow coordinate assignment that takes the **width as an explicit input bound** and trades edge length against it. This is the clean literature statement of "extent is a constraint you can dial," not an emergent number.

**Verdict Q1:** In every standard method, cross-axis extent is a **constrained by-product of an edge-length objective**, or (Jünger 2018) an **explicit constraint** — never an unmanaged emergent quantity. Strata inverts this: it fixes X (from rank/order) and lets `dropY` derive Y with height as pure emergent output and _no_ edge-length objective on the Y placement.

---

## Q2 — Is a skyline / strip-packing placer a recognized _coordinate-assignment_ method, or a category error?

`dropY` is textbook **skyline / bottom-left 2D strip packing** (Wei–Oon–Zhu–Lim 2011 `doi-10-1016-j-ejor-2011-06-022`; Wei–Hu–Leung–Zhang 2016 `doi-10-1016-j-cor-2016-11-024`): a piece lands at the lowest y where its X-interval clears the current skyline, else drops below the tallest overlapping occupant. Height = max skyline = emergent. This IS a recognized _packing_ method — but packing minimizes **used area/height for a set of free rectangles whose relative position is meaningless**.

More precisely, because strata places units in a **fixed order** and only drops on **X-interval overlap**, `dropY` is the **left-edge / interval track-assignment algorithm** from VLSI channel routing (**Hashimoto–Stevens 1971**, `doi-10-1145-800158-805069`, seminal; and the corpus's own `research-thread-packing` note spells out the analogy: "siblings with disjoint X-intervals sharing Y tracks"). Left-edge greedily assigns each interval the lowest track free over its span; it is optimal for _minimizing tracks_ but knows nothing about edges pulling occupants toward particular y's.

The category question: coordinate assignment optimizes **position quality (edge length/bends) under a separation constraint**; packing/track-assignment optimizes **compactness of an unordered set**. Strata uses a packing method where a coordinate-assignment method belongs. That is a **conflation** — packing is the right tool for strata's _disconnected-component / hull tiling_ problem (cf. Freivalds–Doğrusöz–Ķikusts 2002 polyomino packing, `doi-10-1007-3-540-45848-4-30`; ELK Rectangle Packing, `elk-dagre-engine-docs`) but the wrong tool for placing _edge-connected_ leaf resources within a rank.

**Is "height as emergent by-product" a known anti-pattern?** Not named as such, but the literature is unambiguous by contrast: every coordinate-assignment paper makes extent a bounded result of an optimization or an explicit constraint. The failure mode strata exhibits — **cross-axis extent driven by placement order with no objective term and no gate** — is what Coffman–Graham layering, min-width layering (Rüegg–von Hanxleden 2017, `kiel-minimum-width-layering`), and Jünger 2018 all exist specifically to _prevent_. So: **not a named anti-pattern, but a documented failure mode that the standard pipeline is built to avoid.**

---

## Q3 — Height ↔ edge-length coupling: is this a solved constrained optimization rather than a greedy skyline? Would BK / NS-coords dissolve P5 or relocate it?

The coupling strata hits at P5 (pull a sink left in X → its X-interval overlaps occupants → `dropY` forces it down → height grows) is **the exact tension that constrained coordinate assignment solves jointly** rather than greedily:

- **NS-coords (Gansner 1993)** and **Jünger–Mutzel–Spisla 2018** both formulate placement as **minimize Σ edge-length subject to separation (and optionally a width/height bound)** — an LP / min-cost-flow. The optimizer will only push a node down (grow extent) if that genuinely reduces total weighted edge length more than the height penalty, and with a bound it will refuse to exceed the extent. Greedy `dropY` has no such trade: it drops on _any_ overlap, blind to whether an occupant could shift to make room or whether slack exists elsewhere.

- The **honest limit** (already in `strata-problem-crystallization.md` P5): when there is _no_ vertical slack, shrinking one axis provably requires growing the other — this is a real Pareto frontier, not a bug. Jünger 2018's whole point is that width and edge-length are _exchangeable_; you pick the operating point. So replacing `dropY` **does not make P5 disappear** — it converts P5 from a _silent greedy artifact_ (drop because order+overlap said so) into an _explicit, scored trade_ (accept +Δheight only if −Δedge-length justifies it, and never past the bound). That is the correct relocation: from "uncontrolled" to "on the objective."

- **Brandes–Köpf specifically**: BK optimizes straightness under separation but produces **balanced width by averaging 4 alignments** — it would give strata _better_ Y positions (edges straightened) and a bounded, balanced extent, but BK does **not** take an extent bound as input, so it dissolves the _silent_ part of P5 (arbitrary drops) but not the _bounded_ part — for a hard height gate you want NS-coords/Jünger-flow, not vanilla BK.

**Verdict Q3:** Yes, standard coordinate assignment is a solved constrained optimization (LP/flow, Gansner 1993 / Jünger 2018) that subsumes the greedy skyline. Replacing `dropY` **relocates** P5 from an uncontrolled by-product to a scored/gated trade; it does not delete the underlying width↔length Pareto tension (which is real and provable).

---

## Q4 — Height as GATE vs OBJECTIVE; is per-node-TYPE differential treatment (hulls may grow, resources may not) literature-supported?

- **Bounding extent explicitly is standard and recognized.**

  - **Coffman–Graham layering** (via `handbook-hierarchical` §13; Healy–Nikolov 2002 `doi-10-1007-3-540-45848-4-2`) assigns layers under a **hard width bound W** — the archetypal "extent as a gate." Its dual (min-width layering: Rüegg–von Hanxleden 2017 `kiel-minimum-width-layering`; `openalex-10-21941-bii-1701`) targets a prescribed drawing area.
  - **Jabrayilov–Mallach–Mutzel–Rüegg–von Hanxleden 2016, "Compact Layered Drawings of General Directed Graphs"** (`doi-10-1007-978-3-319-50106-2-17`) explicitly **imposes a bound on the height of the drawing** (allowing some upward arcs) to fix aspect ratio — direct precedent for a height gate in a layered drawing.
  - **Jünger–Mutzel–Spisla 2018** — width as a hard constraint in coordinate assignment.

  So the owner's **"height maintained-or-decreased" gate is a recognized construct** (an area/extent bound on the coordinate/layering stage). Framing it as a _gate on an accept step_ (strata already has ε-band acceptance) is sound and is the pragmatic version of these bounds.

- **Per-node-TYPE differential treatment (hulls may grow, leaf resources may not):** this is **weakly supported and is a policy, not a named theorem.** The mechanism that _expresses_ it is **constraint-based / semantic layout**: Dwyer–Koren–Marriott **IPSep-CoLa 2006** (`doi-10-1109-tvcg-2006-156`, seminal, in-corpus 45×) and **cluster-containment constraints** (Dwyer–Marriott–Stuckey 2005, `research-thread-constraints`) let you attach _different separation/containment constraints to different node classes_ — e.g. cluster (hull) boundaries are soft/growable while intra-cluster leaves carry tight separation. Constrained stress majorization (Dwyer–Marriott 2008/09, `openalex-10-1007-978-3-540-77537-9-23`) is the solver. What the literature does **not** give is a specific result saying "let containers grow but not leaves is optimal" — that is a **domain semantic choice** (data-flow hulls vs resources), and it is legitimate but conjectural. The literature supports _the machinery_ for heterogeneous per-class constraints; it does not bless _this particular_ split.

**Verdict Q4:** Height-as-gate = recognized (Coffman–Graham width bound; Jabrayilov 2016 height bound; Jünger 2018 prescribed width). Per-type differential treatment = expressible via constraint-based layout (IPSep-CoLa / cluster containment) but the specific hull-grows / leaf-fixed rule is a domain policy, not a literature result — must be validated empirically.

---

## Q5 — Ranked ROBUST fixes for the packing/coord stage (esp. P5)

**Fix A (most robust; requires replacing `dropY` for connected leaves) — Network-simplex / min-cost-flow coordinate assignment for Y within packed hulls.** Replace greedy `dropY` with a Gansner-1993-style X-coordinate solve (here rotated to Y): minimize `Σ ω·|y_u − y_v|` over edges subject to `y_a + sep ≤ y_b` for the fixed within-rank order. Optionally add Jünger-2018 height-bound constraints to realize the owner's gate exactly.

- Cite: Gansner–Koutsofios–North–Vo 1993 (`gansner-tse93`); Jünger–Mutzel–Spisla 2018 (`forward-10-1007-978-3-030-04414-5-13`).
- Robust: it is the field-standard, handles heterogeneous card heights natively (separation = half-heights + pad), and makes P5 a scored trade. Edge case: needs a stable separation-order input (strata already has ordering) and an LP/flow solver in-bundle (heavier than a skyline).
- Fits-strata: the _hardest_ change; but it is the principled endpoint.

**Fix B (recommended first move; does NOT replace `dropY`) — add a height/extent term + gate to the existing acceptance machinery, and a targeted "slack-aware" local Y-repair.** Keep `dropY` as the _constructor_, but (1) add packed-hull height to the scored objective (or a maintained-or-decreased **gate**, mirroring Coffman–Graham/Jabrayilov bounds), and (2) when a P1/P3/P4 X-pull would force a `dropY` drop, run a **bounded local repair**: only accept the pull if there is vertical slack at the landing Y (a constrained shift of the overlapping occupant upward that respects separation) — i.e. a one-node gradient-projection step.

- Cite: Jabrayilov et al. 2016 height bound (`doi-10-1007-978-3-319-50106-2-17`); Coffman–Graham width bound (`handbook-hierarchical`, Healy–Nikolov `doi-10-1007-3-540-45848-4-2`); the local repair is a single-constraint case of Dwyer–Marriott–Stuckey VPSC/gradient-projection (`research-thread-constraints`, `openalex-10-1007-978-3-540-77537-9-23`).
- Robust: minimal blast radius, reuses strata's ε-band accept, and the gate provably prevents the "pull-forward silently grows height" regression. Edge case: gate can _reject_ a genuinely good crossing win if it costs height — must be a soft/ε gate, not hard, for hulls.
- Fits-strata: **best effort/robustness ratio**; no solver dependency.

**Fix C (adjunct) — for the differential hull-vs-leaf policy, express it as class-specific separation/containment constraints, not code special-cases.** If the owner wants "hulls may grow, resources may not," encode it as cluster-containment (hull box soft-growable) + tight intra-hull leaf separation, per IPSep-CoLa.

- Cite: Dwyer–Koren–Marriott IPSep-CoLa 2006 (`doi-10-1109-tvcg-2006-156`); Dwyer–Marriott– Stuckey cluster containment 2005 (`research-thread-constraints`).
- Robust _as machinery_; the split itself is unvalidated (see Q4). Ship behind a toggle + a before/after readability battery.

**Ranking: B (gate + slack-aware repair) → A (NS/flow coords) → C (constraint policy).** B is the robust, low-risk, literature-backed first move; A is the principled endgame; C is optional semantics.

---

## COORDINATOR DISAMBIGUATION (code-grounded) — two label-swaps corrected

- **Gansner TSE93 has TWO distinct network-simplex uses.** §2/§2.3 = **NS RANK assignment** (min weighted edge _span_ across ranks; replaces longest-path). §4 = **NS X-COORDINATE assignment** (free/perpendicular position on a much larger auxiliary graph). The paper itself foreshadows this on p.11: _"we use the network simplex **again** in section 4, applied to much larger graphs."_ Confirmed (`gansner-tse93`, pp.10-13 read).
- **`pipelineColumnPacking:"shorten"` = the RANK-NS, NOT the coordinate-NS.** Code names the option `networkSimplexRank` and describes it as _"replace the longest-path depth floor with the Gansner minimum-weighted-span **ranking**"_ (`terraformPipelineLayoutRcll.ts:110-113`; `terraformPipelineLayoutShared.ts:1538-1544`). The −8.4% width is a _consequence of tighter ranking along the flow axis_, not coordinate positioning. It is **rcll-only** → `pipelineColumnPackingInert` on strata (`terraformLayoutCore.ts:711-717`) and suppressed under a live rankSeparate → `pipelineNetworkSimplexRankSuppressed` (`:731-733`).
- **My Fix A ≠ rank-NS.** Fix A recommends **coordinate-NS (Gansner §4, x-coord) rotated to the within-hull cross-axis Y**, to replace `dropY`. Different axis (cross vs flow), different scope (within-hull placement vs global ranking), **never built, never measured.** So the "inert/ harmful built NS" caveat (which is about the _rank-NS_ `pipelineColumnPacking`) does not impugn Fix A — but because Fix A is _unbuilt coordinate-NS on Y_, not because "mine is rank."

---

## SELF-ADVERSARIAL SHIT-TEST

1. **"Is Brandes–Köpf even compatible with strata's heterogeneous card sizes + nested hulls?"** **Partially — vanilla BK assumes uniform node size.** Its extension **Rüegg–Schulze–Carstens– von Hanxleden 2015, "Size- and Port-Aware Horizontal Node Coordinate Assignment"** (`doi-10-1007-978-3-319-27261-0-12`) exists _precisely_ because "Brandes and Koepf assume all nodes have the same size." So recommending _plain_ BK for strata (varied card heights, ports, nested hulls) would be wrong; you'd need the size/port-aware variant, and BK still doesn't take an extent bound. This is why my **Fix A names NS-coords/Jünger-flow, not BK** — flow/LP handles heterogeneous sizes as separation values natively and admits a height bound. BK is demoted to "would improve straightness but insufficient alone." Nested hulls add a _recursive_ constraint layer (place within hull, then hull within parent) that none of the flat coordinate methods address directly — that is a genuine gap (cluster containment, Fix C, is the only cited answer).

2. **"Does replacing `dropY` threaten the −42% height win from rankSeparate/OD-14?"** The −42% height lever is in the **RANK/layering** step (longest-path over separation-augmented DAG), a _different stage_ from packing. Fix A/B touch only the within-hull Y placement, so they do **not** directly undo the rank-stage win. BUT there is a coupling risk: rankSeparate _maximizes_ columns/separation and does **not** minimize edge length; a length-minimizing coordinate solve (Fix A) fights that upstream choice and could pull the layout back toward the compact-but-tall regime rankSeparate deliberately avoided. So Fix A must inherit rankSeparate's separation constraints as _hard_, optimizing length only within the slack rankSeparate leaves — otherwise it relocates height growth into the packing stage. This is a real interaction the owner should A/B; it is why **Fix B (gate) is safer than Fix A first**: a gate can _only_ maintain-or-decrease height, so it cannot regress the −42% win by construction.

3. **Am I sure `dropY` = left-edge/track-assignment and not just "obvious"?** The corpus's own `research-thread-packing` note independently frames the sibling-disjoint-X-share-Y-track pattern as left-edge channel routing (Hashimoto–Stevens 1971), so the mapping is corroborated, not just my inference. Caveat: `dropY` differs from pure left-edge in that it drops to `rect.y1 + gap` (below the _tallest_ overlapper) rather than the lowest free track — it is a _bottom-left / skyline_ variant, monotone-downward with **no gap back-fill (OD-6)**, which is _strictly worse than optimal track assignment_ (it never reuses freed upper space). That's an extra, independent reason it is not extent-optimal.

4. **Could the honest answer be "dropY is fine, just add a gate"?** Yes — and that is exactly Fix B. dropY-as-_constructor_ + gate/score is defensible and low-risk. The stronger claim ("dropY is a category error") is about using it as the _only_ placement mechanism with _no_ objective — which is the current state, and which the literature does contradict.

---

## MISSING PAPERS (full citations; absence-from-`graph`-corpus checked via search)

- **Sugiyama, K., Tagawa, S., Toda, M. (1981).** "Methods for Visual Understanding of Hierarchical System Structures." _IEEE Trans. SMC_ 11(2):109–125. DOI 10.1109/TSMC.1981.4308636. — The origin of the priority method; only referenced second-hand (BK "Previous Work", handbook). **Not present as a primary doc.** Foundational for Q1.
- **Eades, P., Wormald, N. (1994).** "Edge crossings in drawings of bipartite graphs." _Algorithmica_ 11:379–403. — underpins the ordering step; peripheral to packing. Absent.
- **Buchheim, C., Jünger, M., Leipert, S. (2001).** "A Fast Layout Algorithm for k-Level Graphs" / and Brandes–Köpf lineage — the BK erratum IS present (`forward-10-48550-arxiv-2008-01252`) but the original Buchheim fast-layout is absent. Minor.
- **Coffman, E.G., Graham, R.L. (1972).** "Optimal scheduling for two-processor systems." _Acta Informatica_ 1:200–213. — the primary source of the Coffman–Graham width bound (Q4); only the handbook/Healy–Nikolov derivations are in corpus. Absent as primary.
- **Baker, B.S., Coffman, E.G., Rivest, R.L. (1980).** "Orthogonal packings in two dimensions." _SIAM J. Comput._ 9(4):846–855. — foundational bottom-left strip-packing bound; the applied Wei skyline papers are present but this theoretical anchor is absent.
- **Nikolov, N.S., Tarassov, A., Branke, J. (2005).** "In search for efficient heuristics for minimum-width graph layering with consideration of dummy nodes." _ACM JEA_ 10. — the min-width layering primary; Rüegg's ELK reimplementation is in corpus, this original is absent. Relevant to Q4 height/width gate.

(Staged here only; not writing the missing-lit doc per instructions.)
