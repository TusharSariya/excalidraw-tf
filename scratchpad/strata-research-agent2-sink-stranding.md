# Agent 2 — Sink Stranding / Vertex Promotion / Edge-Length Minimization

Charter: P1 (degree-1 DLQ sinks stranded +7/+9 columns) and P4 (9-node pure-sink "audit account" over-ranked +14 columns, multi-source fan-in). Robust, generic, literature-backed fixes — not edge-case hacks.

Ground truth used: `scratchpad/strata-problem-crystallization.md` (code-confirmed ranks/positions), CLAUDE shared context. Strata's rank rule in the frozen config is **`rankSeparate`/OD-14 = one global longest-path over `leafEdges ∪ sepEdges`**, where `sepEdges` are all-to-all sibling-separation edges; network-simplex (NS) is **skipped** whenever rankSeparate applies.

---

## HEADLINE (read this first)

**Sink stranding in strata is NOT the textbook longest-path pathology, and the fix is NOT vertex promotion.** Plain longest-path in the _as-soon-as-possible_ (ASAP) convention — the one Gansner's `init_rank` uses — already places a degree-1 sink at `rank(source)+1` (adjacent, P1's ideal) and a fan-in block at `max(rank(sources))+1` (clamped to deepest source, P4's ideal). The crystallization doc confirms this: the **base longest-path floor** gives ingress-DLQ rank 6 and account-04 ≈ r12–15. The stranding to r15 / r27–29 is **manufactured by the all-to-all `sepEdges`**, which convert sibling _ordering_ into rank _distance_. So the literature-correct fix is to (a) stop encoding separation as rank constraints and (b) assign ranks by the mechanism that provably minimizes weighted edge length subject to the _real_ edge constraints — **network simplex (Gansner et al. 1993)** — which centers each node at its tightest feasible layer near its neighbors. Everything below justifies and stress-tests this.

---

## Q1. Is sink stranding EXPECTED under longest-path layering?

**Both conventions, clarified:**

- **ASAP (top-justified / "as soon as possible"):** each node gets the _minimum_ feasible rank = `max over in-edges of (rank(pred)+δ)`. A source is at rank 0; a degree-1 sink sits one layer past its single predecessor; a fan-in node sits one layer past its _deepest_ predecessor. This is Gansner's `init_rank` (TSE93, p.9, `gansner-tse93`): "assigned the least rank that satisfies their in-edges."
- **ALAP (bottom-justified / "as late as possible"):** each node gets the _maximum_ feasible rank. This is the classic **"all sinks collapse into the last layer"** pattern — every sink is dragged to `H`, regardless of where its source sits.

**Canonical statement of the pathology** — Handbook of Graph Drawing, ch.13 "Hierarchical Drawing Algorithms" (`handbook-hierarchical`, p.421/Fig 13.6):

> "The advantages of the longest-path algorithm are its simplicity and its linear time complexity. The layerings it finds have the **minimum height**. However, it **performs very poorly in terms of drawing area, number of dummy vertices and edge density [HN02b]. The longest-path layerings tend to be very wide at the bottom layers.**"

That "very wide at the bottom" _is_ the sink pile-up: minimum height is bought by spreading nodes across the extreme layer. **This is exactly what strata's rankSeparate is exploiting** — it deliberately uses longest-path as a **−42% height lever**, and the sink stranding is the documented cost of that lever. So: stranding is _expected and inherent_ to any layering whose explicit objective is minimum height / maximum spread, and rankSeparate is that objective made worse by all-to-all separation edges.

**But the sharp finding for P1/P4:** the _degree-1 sink_ and the _fan-in block_ are NOT stranded by plain longest-path _in the ASAP direction_ — their rank there is tight to their deepest source (rank 6, r12–15 per the crystallization floor). They are stranded only because strata (i) adds `sepEdges` that lengthen the longest path through them, and (ii) uses the height-maximizing spread. **The pathology strata actually suffers is "separation-augmented longest-path," a superset of the textbook one — and the textbook remedies target the wrong half unless you first remove the separation-as-rank encoding.**

Standard remedies named in the literature for the generic longest-path pathology (Handbook §13.3; Healy & Nikolov `doi-10-1007-3-540-45848-4-2`): (1) network-simplex rank assignment [GKNV93]; (2) Coffman–Graham for bounded width; (3) min-width layering [TNB04]; (4) vertex-promotion post-process [NT06]; (5) exact min-edge-span ILP/branch-and-cut [HN02].

---

## Q2. Vertex promotion / pulling nodes toward neighbors — which mechanism actually places P1 adjacent and pulls P4 in?

**(a) Nikolov & Tarassov 2006, "Graph layering by promotion of nodes," DAM (`doi-10-1016-j-dam-2005-05-023`; described in Handbook p.424, `handbook-hierarchical`).** Mechanism: applied _after_ longest-path, repeatedly move a vertex from layer `Lk` to `Lk+1` (one layer _down/deeper_), recursively promoting predecessors, and _keep the move only if it reduces the total dummy-vertex count._ Objective = **fewer dummy vertices**, not edge length, not "pull sink to source."

- **Verdict for P1:** A degree-1 sink has out-degree 0. Promoting it _deeper_ strictly _adds_ a dummy on its single in-edge, so the heuristic will _never_ promote it — and even if it did, it moves it the _wrong way_ (further from the source). **Vertex promotion does NOT solve P1.** It is a source-side / interior-node tool.
- **Verdict for P4:** the block's anchors are sinks (out-degree 0) → same story. Promotion won't pull the block in.

**(b) Magruder & Bonn 2017, "Root demotion," JGAA (`jgaa-2468-root-demotion...` / `forward-10-7155-jgaa-00448`).** The dual: post-process that **demotes roots (sources) toward their children** to cut dummies. Also targets sources, not sinks. Not a P1/P4 fix either, though it is the correct _conceptual mirror_: what P1/P4 want is a **"sink/leaf pull toward parent"** (move the sink to a _smaller_ rank, tight to its predecessor). Neither promotion nor root-demotion is that operator directly — which is itself a finding: the operator strata needs is "tighten a leaf/leaf-block to `max(pred rank)+δ`," i.e. the ASAP rank of the _real_ edge set.

**(c) Network-simplex "balance" + tight-tree centering (Gansner et al. 1993, TSE93, `gansner-tse93`, p.7–9). THIS is the mechanism that solves both.**

- NS minimizes `Σ ω(v,w)·(λ(w)−λ(v))` s.t. `λ(w)−λ(v) ≥ δ(v,w)` (p.7). "Principle A3 prescribes making short edges … it is desirable to find an optimal node ranking, i.e., one for which the sum of all the weighted edge lengths is minimal."
- For a **degree-1 sink** (single in-edge, weight ω): the term `ω·(λ(sink)−λ(source))` is minimized at `λ(sink) = λ(source)+δ` = **adjacent**. NS drives every non-tree edge's slack to zero via negative-cut-value pivots (p.8), so the sink edge becomes _tight_. This is P1's exact desired outcome, provably optimal, from the edge set alone.
- For a **fan-in block** (many in-edges from heterogeneous source ranks): NS assigns the node the layer minimizing total weighted in-edge length. The feasibility floor is `max(source ranks)+δ` (deepest source), and the length objective pulls it down to exactly that floor when there is no out-edge pulling it further. **This is P4's "clamp the block to its deepest source rank"** — the crystallization's own prescription — realized as a side effect of a standard, published algorithm.
- The **`balance()` step** (p.9, remark 8): "Nodes having equal in- and out-edge weights and multiple feasible ranks are moved to a feasible rank with the fewest nodes … to reduce crowding and improve aspect ratio." This is the _centering_ behavior — for nodes with rank slack, NS spreads them to reduce column crowding **without changing edge-length cost**. It is a principled, cost-neutral version of what rankSeparate tries to do with brute all-to-all separation.

**Answer to Q2:** the mechanism that places a degree-1 sink adjacent to its source and clamps a fan-in block to its deepest source is **network-simplex ASAP-optimal ranking with tight-tree tightening (Gansner 1993)** — _not_ vertex promotion, which targets dummy count on the source/interior side and structurally cannot move a sink toward its parent.

---

## Q3. Edge-length / total-span minimization as an explicit objective — solved & scalable?

**At layer assignment:** YES, effectively solved.

- The problem "minimize total (weighted) edge span subject to `λ(w)−λ(v) ≥ δ`" is an integer program whose **constraint matrix is totally unimodular** (Gansner TSE93 p.7, `gansner-tse93`), so the LP relaxation has integral optima → solvable in polynomial time (LP, or equivalent min-cost-flow / circulation). Gansner's **network simplex** solves it and "in practice takes few iterations and runs quickly" (p.7). This is the graphviz `dot` production algorithm — battle-tested at scale.
- **Exact min-edge-span with additional (width) constraints** is harder: Healy & Nikolov 2002, "How to Layer a DAG" (`doi-10-1007-3-540-45848-4-2`) give a branch-and-cut ILP that minimizes total edge span while respecting width/dimension bounds — exact but exponential worst case; they position NS/heuristics as the scalable alternative. Mallach 2019 (`arxiv-1908-04104v1`) and Rüegg et al. 2016 "Generalization of the Directed Layering Problem" (`doi-10-1007-978-3-319-50106-2-16`, aka DLP) give compactness-aware exact/heuristic formulations.
- **Bottom line:** "minimize edge length subject to layer/separation constraints" is a _solved, scalable_ problem **when the constraints are the real edges plus min-length δ**. It stops being cheap only when you also _fix layer width/area_ (NP-hard, Healy–Nikolov). Strata does not need fixed width at ranking time — so the scalable NS answer applies directly.

**At coordinate assignment (the within/after-rank X or Y):** also solved.

- Brandes & Köpf 2002, "Fast and Simple Horizontal Coordinate Assignment" (`elk-10-1007-3-540-45848-4-3`): linear-time, aligns each node to the **median** of its neighbors and straightens edges (minimizing |coordinate difference| across edges) subject to the fixed within-layer order. (Use with the 2020 erratum, `forward-10-48550-arxiv-2008-01252`.) This is the standard tool for pulling a node's _coordinate_ toward its neighbors once its layer is fixed — directly relevant to **P2's within-column Y ordering** (put api6/api7 params near their sources' Y) and to the "left+up" joint move P5 needs.
- Jünger, Mutzel & Spisla 2018 (`forward-10-1007-978-3-030-04414-5-13`) give a min-cost-flow coordinate assignment that minimizes horizontal edge length under a _prescribed width_ — the coordinate-level analog of the width/length tradeoff strata fights in P5.

---

## Q4. The block/cluster move (P4) and multi-source fan-in

**Coherent whole-cluster placement — Sander 1996, "Layout of Compound Directed Graphs" (`sander-compound-directed-graphs`), and Forster 2002, "Applying Crossing Reduction to Layered Compound Graphs" (`forster-compound-crossing-gd2002`).**

- Sander lays out compound (nested-cluster) graphs on a _single global_ layered layout in which cluster containment is a first-class constraint, rather than recursively treating each cluster as an opaque node (which "ignores edges pointing beyond the subgraph border" and routes them sub-optimally — Sander §8). This is the literature basis for moving account-04 **as a coherent band** while keeping its cross-account edges honestly costed.
- Forster gives the key definition: a compound node's feasible layer band is `[Lmin(v), Lmax(v)]` = the min/max layer of the **leaves reachable inside it**. For the account-04 block, `Lmin` = deepest source rank +δ; the whole block can be slid coherently within `[Lmin, Lmax]`. **This formalizes "clamp the block to its deepest source rank"** as a compound-layering constraint, not an ad-hoc shift.

**Multi-source fan-in placement (the anchor sinks `sns.ops`, 8 sources; `cloudtrail`, 3 sources).** The literature answer is the **barycenter/median-of-sources layer, floored at the deepest source**:

- NS (Gansner) gives the _feasibility floor_ = `max(source ranks)+δ` and the length-optimal choice = that floor (no out-edges pull it deeper). So a pure fan-in sink lands exactly one layer past its deepest source. That is the robust, edge-set-derived placement; there is no "single upstream to co-move" (crystallization correctly refutes that framing) — the _deepest_ source is the binding constraint, and NS finds it automatically.
- For the _coordinate_ (Y) of a fan-in node, Brandes–Köpf's median alignment centers it among its many sources — the standard barycenter answer.

---

## Q5. Ranked ROBUST fixes mapped to P1/P4

### Fix 1 (most robust) — Restore network-simplex ranking on the REAL edge set; demote separation out of the rank constraints.

- **Mechanism:** replace `computeStrataSeparatedFloor` (all-to-all longest-path) with Gansner NS `min Σω·length s.t. λ(w)−λ(v)≥δ` over `leafEdges` only. Encode sibling separation where it belongs — as a **within-layer ordering / X-coordinate separation** (Sander compound + Brandes–Köpf), not as rank distance.
- **Solves:** P1 (degree-1 sink → tight/adjacent, proven optimal), P4 (fan-in block → clamped to deepest source via feasibility floor + length objective; slide the whole compound within `[Lmin,Lmax]`). Also shortens P3 edges and reduces frame pierces.
- **Citations:** Gansner et al. 1993 (`gansner-tse93`); Sander 1996 (`sander-compound-directed-graphs`); Forster 2002 (`forster-compound-crossing-gd2002`); Brandes & Köpf 2002 (`elk-10-1007-3-540-45848-4-3`).
- **Robust vs edge-case:** maximally robust — NS is the production `dot` algorithm on arbitrary DAGs; TU-matrix guarantees integral optima; edge-set-derived, no tuning.
- **Fits strata / re-architecture:** **partial re-architecture.** NS _already exists_ in the codebase and is _deliberately bypassed_ by rankSeparate. The work is not writing NS; it is (i) re-routing separation to the ordering/coordinate phase and (ii) reconciling with rankSeparate's height goal (see adversarial section). Medium cost, highest payoff.

### Fix 2 (targeted, lowest-risk, ships fastest) — Post-rank "leaf/leaf-block tightening" pass gated on the P5 height guard.

- **Mechanism:** after rankSeparate, for each **low-degree sink** (out-degree 0, in-degree small) and each **pure-sink compound block**, recompute its tight ASAP rank = `max(pred rank)+δ` and _pull it left_ to that rank **iff** the packed re-lay keeps hull height maintained-or-decreased (P5 gate) and does not invert any edge or add a frame pierce. This is the "sink-pull" mirror of Magruder–Bonn root demotion, restricted to leaves and clamped to the deepest predecessor.
- **Solves:** P1 directly (DLQ → rank 6/8); P4 (block clamp to r≈23–25, into the sparse band the crystallization identified); leaves everything else untouched.
- **Citations:** conceptual dual of Magruder & Bonn 2017 (`forward-10-7155-jgaa-00448`); feasibility floor from Gansner 1993 (`gansner-tse93`); `[Lmin,Lmax]` band from Forster 2002 (`forster-compound-crossing-gd2002`); height/width tradeoff gate motivated by Jünger–Mutzel–Spisla 2018 (`forward-10-1007-978-3-030-04414-5-13`).
- **Robust vs edge-case:** _moderately_ robust — it is a _generic operator_ (any low-degree sink, any pure-sink cluster), guard-gated, so it degrades gracefully to a no-op rather than thrashing. Not a bespoke per-preset hack. Less globally optimal than Fix 1 but far cheaper and reversible.
- **Fits strata:** **fits cleanly** — it is an opt-in, default-off post-pass that reuses the existing acceptance/height machinery; matches the repo's "targeted, guard-gated, source-relative relocation" gap the crystallization names as missing. This is the recommended _first ship_.

### Fix 3 (adjunct, not standalone) — Coordinate-level pull for P2/P5.

- **Mechanism:** Brandes–Köpf median alignment (with erratum) at Y-coordinate assignment to place fan-in sinks near their sources' Y within a rank, and to enable the joint "left+up" move P5 requires (a sink can only be pulled left if there is vertical slack at its landing Y).
- **Solves:** P2 (api6/api7 within-column inversion) and unlocks Fix 1/2's X-pulls under the height gate. Does _not_ fix ranking — must accompany Fix 1 or 2.
- **Citations:** Brandes & Köpf 2002 (`elk-10-1007-3-540-45848-4-3`) + erratum (`forward-10-48550-arxiv-2008-01252`); Rüegg et al. 2015 size/port-aware extension (`doi-10-1007-978-3-319-27261-0-12`).

**Ranking:** Fix 2 first (cheap, robust, ships now), Fix 1 as the principled target (highest payoff, needs the rankSeparate reconciliation), Fix 3 as the coordinate companion to both.

---

## SELF-ADVERSARIAL — where my own findings are weak

1. **Does promotion/tightening thrash on dense graphs?** Vertex promotion (Nikolov–Tarassov) is **cubic** and cascades: promoting one node recursively promotes all its predecessors (Handbook p.424). On a dense fan-in like `sns.ops` (8 sources) a naive tightening that moved the _sources_ would cascade widely. **Mitigation in my design:** Fix 2 only moves the **sink/leaf** (leaves have no successors to cascade) and clamps to `max(pred)+δ` in one shot — no recursion, no thrash. So the thrash risk is real for _promotion_ but _avoided_ by using the sink-side tightening instead. This is why I explicitly reject vertex promotion as the P1/P4 fix (Q2).

2. **Fix 1 directly fights rankSeparate's raison d'être — the honest core conflict.** rankSeparate exists to **maximize columns → minimize height (−42%)**. Pulling sinks/blocks toward their sources **collapses them into earlier columns → fewer columns → potentially MORE nodes per column → MORE height.** This is not a corner case; it is the same X-vs-height coupling P5 proves at code level (packed `dropY` derives Y from X; a left-pulled sink whose landing Y is occupied gets dropped below → taller box). So a _global_ NS re-rank could regress the very metric strata was tuned for. **This is the single biggest threat to Fix 1** and the reason Fix 2 (guard-gated, targeted, height-non-increasing) is the safer first move. Fix 1 is only correct if paired with an explicit height/aspect objective at ranking time (Rüegg DLP `doi-10-1007-978-3-319-50106-2-16`, or NS `balance()` used _for_ spread) — otherwise it trades P1/P4 legibility for height regression. I cannot claim Fix 1 is a free win; it is a _re-balancing of the objective_, and whether the owner wants shorter edges or shorter height is a product call, not a layout-theory fact.

3. **Is the P5 height gate always satisfiable?** No — the crystallization's own P5 analysis proves `dropY` can _provably require_ more height when two units have overlapping X and no vertical slack exists. So Fix 2's gate will _reject_ some P1/P4 pulls (leave the sink stranded) precisely when there is no slack. That means Fix 2 is **not guaranteed to fix every instance** of P1/P4 — only those with vertical slack at the landing Y (us-west-2 has slack only in upper rows). Honest ceiling: Fix 2 improves the tractable cases and no-ops the rest; it is not a universal cure.

4. **NS optimality is over the edge set I choose, not the drawing.** NS minimizes _weighted rank-span_, which is edge length _in the rank axis only_ and ignores crossings, penetrations, and the within-rank Y that dominate strata's objective. So NS "solves" edge length only in the narrow layering sense; the strata objective is multi-term. Claiming NS is "the fix" overstates it unless the ω weights and the separation-as-coordinate re-encoding are done carefully — otherwise NS could _increase_ crossings/pierces that the current separation happens to avoid. I have not verified that strata's current separation isn't _also_ doing useful crossing control; if it is, moving it wholesale to the coordinate phase could regress crossings. **This is an untested assumption in Fix 1.**

5. **Convention risk in my headline.** My "plain longest-path ASAP already places P1 adjacent" claim depends on strata's base floor being ASAP (top/source-justified). The crystallization confirms the _base_ floor gives rank 6 (adjacent), so ASAP holds here. But if any strata path uses ALAP/sink-justified layering elsewhere, the sink-adjacency claim would flip. I verified only the P1/P4 base-floor numbers, not every code path.

---

## MISSING PAPERS (full citations; absence-from-rag checked)

All the load-bearing papers **are present** in graph-layout-rag (doc_ids given inline above): Gansner et al. TSE93, Nikolov–Tarassov promotion, Healy–Nikolov "How to Layer a DAG," Handbook ch.13, Magruder–Bonn root demotion, Tarassov–Nikolov– Branke min-width, Sander compound, Forster compound crossing, Brandes–Köpf + erratum, Rüegg DLP, Jünger–Mutzel–Spisla flow, Mallach quadratic. Corpus coverage for this charter is strong.

Papers I _expected_ and did **not** surface in my queries (checked via topic + citation searches; flag for verification, do not assume truly absent):

1. **Eiglsperger, Siebenhaller & Kaufmann 2005, "An Efficient Implementation of Sugiyama's Algorithm for Layered Graph Drawing," JGAA 9(3):305–325.** DOI 10.7155/jgaa.00111. The standard _efficient_ NS-based Sugiyama pipeline that handles large node sizes without per-unit dummy blow-up — directly relevant to running NS on strata's variable-size hulls. Did not appear in my searches; likely a genuine gap. **Highest-value add for this charter.**

2. **Gansner, North & Vo (GNV2 / "improved" ranking+balance follow-up to TSE93), referenced in TSE93 as forthcoming.** Contains the _global_ rank-balancing that TSE93's greedy `balance()` only approximates — the principled version of what rankSeparate does by brute force. Referenced but I did not find a standalone entry.

3. **Coffman & Graham 1972, "Optimal scheduling for two-processor systems," Acta Informatica 1:200–213.** DOI 10.1007/BF00288685. The bounded-width layering primitive cited throughout the Handbook; present only as a _reference_, not a full PDF. Lower priority (strata doesn't need bounded width at ranking).

4. **North & Woodhull 2001, "Online hierarchical graph drawing," GD 2001.** Incremental/stable re-ranking — relevant if sink-tightening must be stable across the focus-reconcile re-clone (the canvas hover-unrender issue). Not surfaced; verify.

I did **not** write to `docs/graph-layout-rag-missing-literature.md` per instructions; the four above are staged here for the harvest owner.

---

## Files referenced

- `scratchpad/strata-problem-crystallization.md` (ground-truth ranks/positions)
- Code: `terraformPipelineStrataRankSeparate.ts` (`computeStrataSeparatedFloor`), `terraformPipelineStrataRank.ts` (`rankStrataClusters`, longest-path floor), `terraformPipelineStrataPlacement.ts` (`dropY` skyline, P5 coupling) — per graphify.
