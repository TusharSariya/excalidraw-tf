# Strata Research Agent 6 — Drawing Area / Aspect Ratio / Compaction & the Width↔Height Tradeoff

Charter: validate/refute the owner's "packed should never increase height" intuition against the literature; find robust, generic, cited compaction methods. All citations checked against the local graph-layout RAG (corpus = "graph"); doc_ids are RAG-resolvable, DOIs/arXiv given for external.

Bottom line up front:

- **The width↔height tension is a FORMAL, known tradeoff** in layered/hierarchical drawing — but the precise theorem is not "shrinking width requires more height." The precise facts are: (a) **single-axis compaction is polynomial** (longest-path / network-flow), **but two-axis / area minimization is NP-hard and even inapproximable** (Klau & Mutzel 1999; Bannister–Eppstein–Simons); (b) longest-path layering gives **minimum height but unbounded width**, Coffman–Graham **bounds width at the cost of extra height** — this is the canonical, textbook tradeoff (Tamassia GD Handbook; Healy & Nikolov 2002).
- **The owner's "height gate" is a recognized, formalized construct**: layering under a hard maximum-height bound with width as the optimization subject is exactly the Healy–Nikolov / Rüegg / Jabrayilov et al. line ("Compact Generalized Layering Problem", CGLP). The gate is literature-legitimate. The **per-node-type variant (hulls may grow, resources may not) is NOT a named literature construct** — it is a reasonable engineering specialization of constraint-based layout, no direct citation.
- **Single most robust compaction approach for strata (CORRECTED after coordinator challenge — see ORIENTATION CORRECTION below): a free-axis (Y / row) network-flow / longest-path compaction with the rank-column (X) partition FROZEN.** Strata is rotated 90° from the textbook: ranks = X (the layer axis, width = #cols × pitch), free axis = Y (height). The textbook "fixed-layer 1D compaction cannot change the layer count / height" therefore maps onto strata as **freeze X-columns, compact Y → it reduces HEIGHT, cannot touch width or LR.** It is a principled replacement for strata's greedy dropY-skyline PACK and directly serves P3-region-height / P5-re-stack-height. **It is NOT the owner's pull-left WIDTH fix** — that is a rank/X (layer) move, which on this preset is structurally walled (re-rank = catastrophic; network- simplex X = inert on globally-full uniform-width LR). My original summary wrongly implied the operator addressed pull-left; retracted below.

---

## Q1. Is the width↔height tension a KNOWN, FORMAL tradeoff?

**Yes — it is textbook, with several distinct formal results. But the owner's phrasing is stronger than the theorems, so pin the exact statements.**

### 1a. The canonical layered tradeoff (heuristic-level but universally reported)

- **Longest-path layering** → provably **minimum number of layers (minimum height)**, but **width can grow arbitrarily large**. Stated explicitly in the GD Handbook and Healy–Nikolov.
  - Tamassia (ed.), _Handbook of Graph Drawing and Visualization_, ch. "Hierarchical Drawing Algorithms", §Coffman–Graham: "the longest path algorithm … layerings … have the minimum height. However, it performs very poorly in terms of drawing area, number of dummy vertices and edge density." (RAG `handbook-hierarchical`)
  - Healy & Nikolov, _How to Layer a Directed Acyclic Graph_, GD 2002, LNCS 2528, DOI 10.1007/3-540-45848-4_2 (RAG `doi-10-1007-3-540-45848-4-2`).
- **Coffman–Graham layering** → **bounds the width to W** (max real vertices per layer ≤ W) **at the cost of potentially increasing height** (more layers). This is _the_ explicit width-for-height trade in the literature. (GD Handbook, same section; Coffman & Graham 1972 — see Missing Papers.)
- Jabrayilov, Mallach, Mutzel, Rüegg & von Hanxleden, _Compact Layered Drawings of General Directed Graphs_, GD 2016, LNCS 9801, DOI 10.1007/978-3-319-50106-2*17 (RAG `doi-10-1007-978-3-319-50106-2-17`) state the Sugiyama-pipeline root cause directly: *"the height of the produced layering inherently depends on its longest path … if an acyclic graph whose longest path is much larger than its width is given … it is impossible to construct a compact layering."\_ This is exactly strata's P5: rankSeparate/longest-path spread reduces height by widening; pulling sinks back re-stacks them and re-grows height.

### 1b. The rigorous complexity statement (this is the real "formal tradeoff")

- **One-dimensional compaction (fix one axis, minimize the extent of / edge length along the other) is polynomial** — solvable by longest-path in a constraint DAG or by min-cost network flow.
- **Two-dimensional compaction — minimizing area or total edge length while altering BOTH axes — is NP-hard**, and _even inapproximable_.
  - Klau & Mutzel, _Optimal Compaction of Orthogonal Grid Drawings_, IPCO 1999, LNCS 1610, pp. 304–319, DOI 10.1007/3-540-48777-8_23 (RAG `doi-10-1007-3-540-48777-8-23`): "Most versions of the compaction problem … are proven to be NP-hard." They solve 1D optimally and attack 2D with branch-and-cut.
  - Bannister, Eppstein & Simons, _Inapproximability of Orthogonal Compaction_, JGAA (RAG `jgaa-2643-inapproximability-of-orthogonal-compaction`): area/total-edge-length minimization under a fixed shape is not just NP-hard but hard to approximate.
  - Didimo, Gupta, Kindermann, Liotta, Wolff & Zehavi, _Parameterized Approaches to Orthogonal Compaction_, arXiv:2210.05019 (RAG `arxiv-2210-05019v2`): FPT in the number of "kitty corners"; confirms hardness is intrinsic to the joint problem.

**This is the defensible formal core:** _you can optimally compact one dimension cheaply, but compacting both at once (= minimizing area) is NP-hard._ That is the real reason width and height "fight" — not a per-instance impossibility, but the fact that the joint optimum is intractable while each single-axis optimum is trivial.

### 1c. Validate/refute the prior analysis's "shrinking width can PROVABLY require more height"

**Verdict: correct as an EXISTENCE / lower-bound claim; OVERSTATED if read as a universal law.** The rigorous version is a **coloring / interval-packing lower bound**, and it _is_ a theorem:

- Jabrayilov et al. (§3, Lower Bounds on Height) prove: the **minimum height of a feasible layering equals the chromatic number χ(G) of the conflict graph** — because "no two adjacent (conflicting) vertices may share a layer" is identical to graph coloring. (RAG `doi-10-1007-978-3-319-50106-2-17`, page 5.)
- Translate to strata's packing: two units whose X-extents overlap **conflict** — they cannot share a row. Shrinking the drawing's width increases X-overlaps, which increases the max **overlap depth** (clique number) of the horizontal interval graph. For interval graphs, minimum coloring = maximum clique = maximum overlap depth (a classical exact result). So the **minimum number of rows is lower-bounded by the maximum number of units that mutually overlap in X**, and reducing width can force that clique to grow → provably more rows.
- **But:** this only bites when there is no vertical slack (the clique is already saturated). Generic instances usually have slack, so reducing width frequently does _not_ force height up. Therefore:
  - CORRECT: "there EXIST configurations where any width reduction provably forces a height increase" — this is a genuine theorem (interval-graph clique / strip-packing lower bound; also the standard strip-packing area bound area ≥ max column load).
  - OVERSTATED: "shrinking width requires more height" as a blanket property. It's an existence result, not a universal one. The prior analysis's own hedge ("when no vertical slack exists") is the correct qualifier and should be kept verbatim.

---

## Q2. Robust COMPACTION methods and the "compact X without growing Y" operator

**Yes, a principled operator exists — it is literally one-dimensional compaction with the other axis frozen.**

- **Longest-path (constraint-DAG) 1D compaction** and **min-cost network-flow 1D compaction** are the two standard poly-time primitives. Given a fixed shape/ordering, build a DAG of separation constraints along the target axis; longest-path gives the minimum coordinates; network flow minimizes total edge length along that axis. The orthogonal (frozen) axis is untouched, so its extent cannot change.
  - Tamassia GD Handbook, "Planar Orthogonal and Polyline Drawing Algorithms", §7.3.2 Network Flow Algorithms (RAG `handbook-orthogonal`).
  - Klau & Mutzel 1999 (RAG `doi-10-1007-3-540-48777-8-23`) — 1D optimal, 2D NP-hard.
  - Jünger, Mutzel & Spisla, _More Compact Orthogonal Drawings by Allowing Additional Bends_, Information 2018, DOI 10.3390/info9070153 (RAG `forward-10-3390-info9070153`): **1D monotone flexible-edge compaction solved in polynomial time via a network-flow model** — a concrete, modern "compact one axis" operator.
- **In the Sugiyama pipeline the frozen-axis operator already has a name: Brandes–Köpf horizontal coordinate assignment.** It assigns X-coordinates (compacting horizontally) _subject to the fixed layer ordering_ — i.e. it compacts X while holding Y (layers = height) constant. This is exactly the operator strata needs.
  - Brandes & Köpf, _Fast and Simple Horizontal Coordinate Assignment_, GD 2001, LNCS 2265, DOI 10.1007/3-540-45848-4_3 (RAG `elk-10-1007-3-540-45848-4-3`) — note its §4.2 is literally titled "Horizontal Compaction."
  - Rüegg, Schulze, Carstens & von Hanxleden, _Size- and Port-Aware Horizontal Node Coordinate Assignment_, GD 2015, DOI 10.1007/978-3-319-27261-0_12 (RAG `doi-10-1007-978-3-319-27261-0-12`) — extends Brandes–Köpf to varying node sizes and ports (strata's hulls/leaves have varying sizes), still a pure horizontal-compaction pass that does not touch layers.
- **Constraint-based compaction (generic umbrella).** VPSC / gradient-projection separation constraints let you compact one axis while _pinning_ selected elements or preserving topology — the mechanism by which "some things may move, some may not" is expressed formally:
  - Dwyer, Koren & Marriott, _IPSep-CoLa_, IEEE TVCG 2006, DOI 10.1109/tvcg.2006.156 (RAG `dwyer-ipsep-cola`).
  - Dwyer, Marriott & Wybrow, _Topology Preserving Constrained Graph Layout_, GD 2008, DOI 10.1007/978-3-642-00219-9_22 (RAG `doi-10-1007-978-3-642-00219-9-22`) — compact/improve a layout while provably preserving the existing topology (no new crossings, no re-stacking). Directly relevant to "don't let compaction re-stack resources."

**Answer to "is there a principled compact-X-without-growing-Y operator?": Yes.** Any 1D compaction with the Y-partition (rows/layers) held fixed satisfies it _by construction_, and Brandes–Köpf is the drop-in Sugiyama instance. The reason strata's earlier greedy X-compaction was removed (docs/strata-xcompact-removed-findings.md) is not that the operator is unsound — it's that a _greedy, unconstrained_ pass is not the principled version; the principled version is constraint/flow-based with rows frozen.

---

## Q3. ASPECT-RATIO control — does global AR-driven layout dissolve the owner's problem?

Aspect-ratio-targeting methods exist and are the "let the algorithm pick the global width/height balance" alternative to fighting the tradeoff locally:

- **Height-bounded layering with width optimized (the AR knob for layered layouts):**
  - Rüegg, Ehlers, Spönemann & von Hanxleden, _Generalized Layerings for Arbitrary and Fixed Drawing Areas_, JGAA (RAG `jgaa-2475-generalized-layerings-for-arbitrary-and-fixed-drawing-areas`) — a "max scale" objective that fits a layering to a given drawing area.
  - Rüegg et al., _Layering Heuristics for Minimum-Width Layerings_ / _Minimum-width graph layering revisited_, (RAG `kiel-minimum-width-layering`, `openalex-10-21941-bii-1701`) — MinWidth heuristics explicitly for a target drawing area with varying node dimensions (ELK's implementation).
- **Wrapping / multi-row layered layout (fold a long layering into several rows to hit an AR):**
  - Rüegg & von Hanxleden, _Wrapping Layered Graphs_, GD 2018, DOI 10.1007/978-3-319-91376-6_10 (RAG `kiel-wrapping-layered-graphs`).
  - Nachmanson et al.'s iterative Coffman–Graham to a target aspect ratio (cited within Jabrayilov et al. §2).
- **Stress/orthogonal AR-constrained layout (non-layered):**
  - Alsuwaykit, Rajeh, Kouyoumdjian, Kieffer, Engel, Di Bartolomeo, Nöllenburg & Viola, _ARCOL: Aspect Ratio Constrained Orthogonal Layout_, arXiv:2603.29618 (RAG `arxiv-2603-29618v1`) — bakes a target AR into the stress phase plus a bounded final rescale.
- **ELK exposes `aspectRatio` as a first-class option** (RAG `elk-layout-options-reference`, `elk-layered-algorithm-reference`).

**Does it dissolve the problem? Partially — and with a real cost.** A _global_ AR objective is philosophically right: it makes the algorithm choose the width/height balance once, globally, instead of strata re-fighting it per hull. That matches the owner's intuition better than a local gate. **BUT** the two concrete layered AR mechanisms both damage the data-flow readability strata cares about:

1. **Wrapping** cuts the layering into rows, introducing "wrap edges" that jump backwards/across rows — the single left-to-right flow direction (which strata uses to convey data flow) is broken. This is the strongest self-adversarial point below.
2. **Height-bounded layering that reverses arcs** (Jabrayilov/Rüegg CGLP) achieves compactness by letting some arcs point _upward_ — again trading a clean monotone flow for area. Acceptable for undirected/cyclic infra, costly where the flow direction is the message.

So AR control dissolves the _area_ problem but can re-open the _readability_ problem strata just spent effort solving. It is a re-architecture, not a free lunch.

---

## Q4. Is the owner's "height gate" a recognized construct? Type-differential variant?

- **Height-as-hard-constraint: YES, recognized and formalized.** This is precisely the Healy–Nikolov / Rüegg / Jabrayilov line: _"requiring only H [max height] as an input parameter while making W a subject of optimization"_ (Jabrayilov et al., §4.1, RAG `doi-10-1007-978-3-319-50106-2-17`, page 5). Healy & Nikolov even allow **hard bounds on both** width and height (branch-and-cut). So "reject moves that increase height" is a legitimate, literature-grounded formulation — it is the _acceptance-gate_ reading the prior strata analysis landed on, and the literature agrees that a height bound (rather than a height objective) is the clean way to keep the problem feasible. Note the literature's subtlety: they warn that specifying **both** H and W a priori often yields _infeasible_ settings — supporting the strata choice to bound one dimension and optimize the other, not gate both.
- **Type-differential gate (hulls may grow, resources may not): NOT a named construct.** No paper in the corpus distinguishes size objectives by node type. The closest formal home is **constraint-based layout with per-element / per-group constraints** (Dwyer–Marriott VPSC/IPSep-CoLa, cluster containment, RAG `dwyer-ipsep-cola`, `research-thread-constraints`) and **topology-preserving constrained layout** (RAG `doi-10-1007-978-3-642-00219-9-22`), under which you _can_ pin resources (forbid re-stacking) while allowing container boxes to grow. That is the generic mechanism, but the _policy_ ("hulls carry flow so they may grow; leaves are atoms so they may not") is a strata-specific engineering choice with no literature precedent. Flag it as reasonable-but-unvalidated, not as a recognized pattern.

---

## ORIENTATION CORRECTION (coordinator challenge — conceded)

I originally wrote the operator as an "X-axis compaction, rows frozen." That silently assumed textbook axes. **Strata is rotated 90°:** RANK/layer axis = **X** (columns; width = #cols × pitch), free axis = **Y** (rows; height). rankSeparate spends WIDTH (adds columns) to buy a −42% HEIGHT reduction. Mapping the textbook operator onto strata's frame:

| textbook (layers vertical) | strata (layers horizontal) | effect in strata |
| --- | --- | --- |
| frozen partition = layer axis (Y) | frozen partition = **rank/column axis (X)** | width + LR untouched |
| compacted axis = free axis (X) | compacted axis = **free/row axis (Y)** | — |
| dimension that shrinks = **width** | dimension that shrinks = **HEIGHT (Y)** | height ↓ |
| guarantee = layer count fixed → height safe | guarantee = column count fixed → **width safe** | width can't grow |

So the "cannot-change-the-frozen-axis" operator, in strata, **reduces height and leaves width alone** — the opposite of what my summary implied. The owner's pull-left goal (P1/P3-width/P4 = pull stranded sinks to _earlier columns_) is a move along the **rank/X (layer) axis** — i.e. it _changes the frozen partition_, which this operator explicitly does not do. **Retracted:** the operator does not address pull-left width.

Note the removed greedy `strataXCompact` was the _reverse_ — it compacted the **X/rank (layer)** axis (slid units leftward toward earlier columns), which is the strata analog of textbook _layer_ compaction = re-ranking. That is precisely why it broke LR / re-stacked: compacting the layer axis is not the safe primitive; compacting the free axis is.

## Q5. Ranked ROBUST approaches for strata (axis-corrected)

**1. Free-axis (Y / row) network-flow / longest-path compaction, rank-columns (X) FROZEN. [MOST ROBUST — but a HEIGHT reducer, not the width fix]**

- What: replace strata's greedy dropY-skyline PACK with a constrained 1D compaction along **Y** (rows) — longest-path in a row-separation DAG or min-cost flow — with each unit's **rank/column (X) held fixed** and separation constraints preventing row overlap. Minimizes Y-extent (height) subject to the column grid.
- Why robust: **cannot increase height (it minimizes it) and cannot change width or LR by construction** (X frozen); poly-time and optimal for the Y axis; decades-proven (Brandes–Köpf 2001 §4.2 is exactly this primitive on the free axis; Klau–Mutzel 1999 1D-optimal; Jünger–Mutzel–Spisla 2018 network-flow 1D). It is the literature's "regularity as constraint, compaction as objective" done right (removed-doc line 34), replacing the greedy skyline.
- What it fixes: **P5's height re-growth** (when a pulled-back sink re-stacks in Y, a global Y-compaction re-minimizes that stacking instead of accepting greedy skyline) and **P3 region-box height**.
- What it does NOT fix: the owner's **pull-left width** goal (that's the X/rank axis). And it cannot beat the interval-clique lower bound of Q1c: if pulling a sink back put two units in overlapping columns, they can't share a row and the height floor rises — Y-compaction reduces only genuine Y-slack.
- Fit: **fits strata as a drop-in replacement for the PACK stage**, no re-architecture, LR/width-safe.

**1-alt. The WIDTH pull-left the owner actually wants is walled on this preset — conceded, not a compaction win.** Per docs/strata-xcompact-removed-findings.md: the only X-width dead space is _per-hull_ (rank empty in one hull, full in another); collapsing it creates backward cross-hull edges → LR-guard rejects it. The global grid is LR-safe but **inert** because ranks are globally full (16/16) + cards uniform-width (346px). A network-simplex X solve (`pipelineColumnPacking:"shorten"`, Gansner) is the principled X tool but is **very likely inert here for the same reason**: it pulls a node left only to its rank-separation floor, and on a globally-full uniform-pitch grid the current column _already equals_ that floor (pitch = card+gutter = min separation), so there is no X-slack to reclaim without re-ranking (proven catastrophic: +176–215 crossings, height ×4.3). So on _this_ preset the width axis is genuinely at a wall; the honest recommendation is to pursue height (Y) compaction, not width.

**2. Height as a hard ACCEPTANCE GATE on width/edge-length moves (CGLP-style). [ROBUST, matches owner intuition]**

- What: keep strata's objective {crossings, penetrations, edgeLength}; add a hard invariant — reject any candidate move whose total height exceeds the incumbent (optionally: allow hull-box growth, forbid resource-row growth per Q4's caveat).
- Why robust: literature-legitimate (Healy–Nikolov bound-on-height; Jabrayilov et al. "H as input, W optimized"). It is exactly the prior strata analysis's conclusion, now with citation backing. Cheap, monotone, cannot regress height.
- Edge cases: a pure gate can _stall_ (reject all improving moves because they all cost a little height) — it narrows the search, it doesn't widen it. Pair it with (1), which produces height-neutral moves for the gate to accept. The per-type variant is unvalidated (Q4) — ship gate-on-resources conservatively.
- Fit: **fits strata directly** as the owner proposes; lowest-risk policy layer over approach (1).

**3. Global aspect-ratio-driven layout (target-AR / MinWidth layering, or wrapping). [POWERFUL, RE-ARCHITECTURE]**

- What: replace local width/height fighting with a global AR objective — MinWidth layering to a target area (Rüegg et al.), or fold via Wrapping Layered Graphs, or an ARCOL-style AR-constrained coordinate phase.
- Why consider: philosophically dissolves the tradeoff by choosing the balance once, globally.
- Edge cases / risk: **breaks strata's single-direction data-flow readability** (wrapping introduces cross-row jump edges; height-bounded CGLP reverses arcs upward). High implementation cost; changes the core layering contract. Recommend only if the owner accepts a flow-readability hit for area.
- Fit: **requires re-architecture**; last resort / research spike, not a near-term build.

---

## SELF-ADVERSARIAL gaps

- **Did I overstate "provably requires more height"?** I initially want to call it a theorem; the honest reading is it's an _existence_ theorem (interval-graph clique / strip-packing lower bound), true only when vertical slack is exhausted. As a universal property it is FALSE — most instances have slack and shrink width for free. I have framed the prior analysis as "correct with the no-slack qualifier, overstated without it." If a reviewer reads the prior doc as claiming a blanket law, that is wrong; if it kept the "when no vertical slack exists" hedge, it is exactly right. This distinction is load-bearing and I could be over-charitable to the prior doc if its hedge was weaker than I assume — I did not re-read the prior doc's exact wording (flagged).
- **Does aspect-ratio wrapping break data-flow readability?** Yes — this is my strongest caveat and it undercuts the tidy "global AR dissolves the problem" story. Wrapping and arc-reversal both buy area by sacrificing the monotone L→R flow that strata uses to _mean_ data flow. So Q3's "dissolve" is qualified, not clean. I did not find a wrapping variant that preserves a single flow direction — if one exists it's the missing piece.
- **Is fixed-axis 1D compaction actually as safe as I claim?** The "cannot increase height" guarantee assumes the row assignment is truly frozen and separation constraints are correctly generated. If strata's PACK rows are not a clean total order per column, a naive constraint DAG could be infeasible or could _want_ to move a unit's row — at which point the guarantee evaporates. The guarantee is only as good as the "rows frozen" precondition. I asserted feasibility from the general theory, not from strata's actual PACK data structure — flagged as an implementation risk, not a proven property of strata specifically.
- **NP-hardness is about the OPTIMUM, not about strata's heuristic.** Klau–Mutzel/BES hardness says the _joint optimum_ is intractable; it does not say strata's greedy can't do well. I use hardness only to explain _why the axes fight_, not to claim strata's specific moves are hard. Don't over-read it as "therefore strata can't improve."

## MISSING PAPERS (full citations; RAG absence checked)

Checked against corpus "graph"; these are absent (or only present as forward-citation stubs) and would strengthen the tradeoff/compaction argument:

1. **Coffman, E.G. & Graham, R.L. (1972).** _Optimal scheduling for two-processor systems._ Acta Informatica 1(3):200–213. DOI 10.1007/BF00288685. — The origin of the Coffman–Graham width-bounded layering. Corpus has only secondary descriptions (GD Handbook); **primary absent**.
2. **Patrignani, M. (2001).** _On the complexity of orthogonal compaction._ Computational Geometry 19(1):47–67. DOI 10.1016/S0925-7721(01)00010-4. — The canonical NP-hardness proof for orthogonal (area/edge-length) compaction; corpus has Klau–Mutzel and BES but **not Patrignani**.
3. **Eiglsperger, M., Siebenhaller, M. & Kaufmann, M. (2005).** _An efficient implementation of Sugiyama's algorithm for layered graph drawing._ JGAA 9(3):305–325 (GD 2004, LNCS 3383). DOI 10.7155/jgaa.00113. — The standard efficient compaction/coordinate machinery for the Sugiyama pipeline; **absent** (named in charter, not in corpus).
4. **Gansner, E.R., Koutsofios, E., North, S.C. & Vo, K.-P. (1993).** _A technique for drawing directed graphs._ IEEE TSE 19(3):214–230. DOI 10.1109/32.221135. — The network-simplex X-coordinate / min-edge-length node placement (dot). Cited throughout the corpus (Gansner et al. [4]/[5]) but the **primary paper is absent**; it is the exact reference for network-flow-style horizontal compaction with fixed layers.
5. **Nachmanson, L. et al.** _Drawing graphs with a given aspect ratio_ (iterative Coffman–Graham to a target AR), referenced in Jabrayilov et al. §2 ([8]). Primary **absent** from corpus — the concrete "target aspect ratio via re-layering" precedent for Q3.
6. **Kieffer, S., Dwyer, T., Marriott, K. & Wybrow, M. (2016).** _HOLA: Human-like Orthogonal Network Layout._ IEEE TVCG 22(1):349–358. DOI 10.1109/TVCG.2015.2467451. — Combines orthogonal ordering + compaction with aesthetic/aspect goals; relevant to Q2/Q3, **absent**.
7. **Rüegg, U., Kieffer, S., Dwyer, T., Marriott, K. & Wybrow, M. (2014).** _Stress-Minimizing Orthogonal Layout of Data Flow Diagrams with Ports._ GD 2014 (RAG `doi-10-1007-978-3-662-45803-7-27`) — PRESENT; noted here because its "eliminate inter-layer whitespace" compaction via constrained stress majorization is a strong secondary reference for Q2's constraint-based compaction (not missing, but under-weighted above).
