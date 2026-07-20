# RCLL Reading List — Graph Layout for Terraform Architecture Diagrams

**Audience:** a new researcher who wants to understand, extend, or replace the RCLL (readability-first compound layered layout) engine in this repo — the layout that turns a parsed Terraform plan into a hierarchical, containerized, strict left-to-right dataflow diagram on an Excalidraw canvas.

**How to use this list:** each entry says _why you're reading it_ and _how it hit this project_ — including the trap doors we actually fell into. The project's own decision history is the connective tissue: four spec rounds, one adversarial round-5 audit, several built-and-measured probes, and multiple NO-GO campaigns. Papers are ordered beginner → advanced within each section; sections are ordered roughly by the Sugiyama pipeline itself, because that pipeline _is_ the architecture.

**Search the corpus, don't just read this list.** The repo carries a local literature RAG over ~5,811 canonical documents (~41k chunks) of graph-drawing papers: `rag graph "<query>"` from the Mac (e.g. `rag graph "VPSC separation constraints" --tag constraints`). When a claim below feels thin, pull the primary source.

**Corpus-verified (2026-07-04).** Five parallel deep-research sweeps (~75 distinct corpus queries covering every pipeline area) checked this list against the corpus. Result: the narrative **core** below survives as the canon; each section now also carries a **deep bench** — corpus-verified additions tagged `[essential]` / `[rec]` / `[opt]`, each with its corpus `doc_id` (pull the paper with a title query, or expand its citation neighborhood with `rag cite graph <doc_id>`). What the sweep could _not_ find — papers missing from the corpus, and problems missing from the literature entirely — is collected in §14.

**Round-6 audit (2026-07-04, [`rcll-v2-shit-test-round6.md`](./rcll-v2-shit-test-round6.md) §6).** A live spot-check of this list against the corpus found: all 12 sampled doc_ids correctly attributed, but **a plain title search misses ~1/3 of papers that ARE present** (only `rag read graph <doc_id>` is a reliable existence check), ~1/4 of deep-read-tagged entries are metadata-only stubs, and **§14's flagship gap claim was wrong** — Forster 2004 is in the corpus with full text (see §4/§14 corrections below). OCR quality warnings: the Sander 96 TR and the Rüegg 1D-compaction full texts are garbled scans — for those two, verify quotes against the canonical URLs, not `rag read`.

**Companion project docs (read alongside, not after):**

| Doc | What it gives you |
| --- | --- |
| `docs/rcll-v2-spec-v2.md` + `docs/rcll-v2-spec-v3.md` | The normative spec (v2.0 base + v3 amendments — read together; v3 wins on conflict): algorithms A0–A7, constraints, milestones, verified literature |
| `docs/rcll-v2-shit-test-round5.md` | The round-5 adversarial audit — findings F1–F18, the Q2 seven-arm measurement, the churn probe, the corrected build order |
| `docs/rcll-v2-shit-test-round6.md` | The round-6 audit — spec-v2.0's new algorithms attacked, generalization measured on a 2nd preset + cyclic fixture, v1→v2 traceability matrix, this list's corpus audit |
| `docs/rcll-v2-architecture-decision.md` + `docs/rcll-v2-foundation-spec.md` | Rounds 1–4: how the architecture was chosen (and where round 4 over-rotated) |
| `docs/pipeline-rcll-layout-design.md` | The v1 RFC — priority lattice (§5), readability catalog (§23), decision log DEC-1..12 (superseded but explains _why_ v2 exists) |
| `docs/terraform-pipeline-import-agent-guide.md` | The import toggles (compact/compound/packed/ancillary) the layouts run under |
| `docs/excalidraw-canvas-architecture.md` | What happens to the layout _after_ layout — rendering, caching, hover |

## Document graph

| Relation | Link |
| --- | --- |
| Role | Aux |
| Status | Living — literature; Forster-missing claim corrected by round6/v3.0 |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`rcll-v2-architecture-decision.md`](./rcll-v2-architecture-decision.md) |
| Children | [`rcll-papers-reference-chart.md`](./rcll-papers-reference-chart.md) |
| Sisters | [`rcll-papers-reference-chart.md`](./rcll-papers-reference-chart.md); [`rcll-v2-shit-test-round6.md`](./rcll-v2-shit-test-round6.md) |
| Next (agent) | Cite papers; for corpus corrections open sister round6. |

---

## 0. The problem, in one paragraph (read before anything)

We regenerate an entire architecture diagram from Terraform source on every import — there is no incremental "add a node" path. The graph is: **directed** (dataflow, `A→B` means B depends on A), **compound** (resources nest in modules/VPCs/subnets — drawn as frames with titles), **mostly acyclic** (occasional cycles from `depends_on`), and **medium-scale** (~120–400 nodes, ~150–500 edges per preset). The owner's goals, in priority order: (1) **readability** — reads left-to-right like a proper flow, if `A→B` then B is right of A, compact but semantics-preserving, container-aware crossing/edge-length reduction; (2) **diff-stability** as a frozen not-regress _constraint_ (regenerate-per-PR diffs must be reviewable), never the objective. That priority ordering was itself the hardest-won result of the whole campaign — round 4 inverted it and round 5 reverted it with the owner's explicit ruling. Every paper below is read through that lens.

---

## 1. Foundations — start here if layered graph drawing is new to you

1. **Sugiyama, Tagawa, Toda 1981**, _Methods for Visual Understanding of Hierarchical System Structures_ (IEEE SMC-11). The founding paper of the layered ("Sugiyama") framework: assign nodes to layers, order within layers to reduce crossings, assign coordinates. Everything in RCLL — v1, v2, and the shipped v2-substrate passes — is a variation on these three phases plus two more (cycle removal before, edge routing after). Read it for the _decomposition_, not the specific heuristics (all superseded).

2. **Healy & Nikolov, "Hierarchical Drawing Algorithms"** — Chapter 13 of the _Handbook of Graph Drawing and Visualization_ (Tamassia, ed.; chapters are free on the Brown CS site). The best single survey of the five-phase pipeline: cycle removal options, layering options (with the p. 421 verdict that longest-path layering "performs very poorly in terms of drawing area, number of dummy vertices and edge density" — this line is why the spec's OD-1 keeps network simplex on the table), crossing minimization, coordinate assignment. **This is the map; read it before any single-phase paper.**

3. **Battista, Eades, Tamassia, Tollis 1999**, _Graph Drawing: Algorithms for the Visualization of Graphs_ (the "GD book"), ch. 9 (layered drawings). Textbook depth where the Handbook chapter is survey depth. Optional if you read Healy–Nikolov carefully; useful for proofs (e.g. why one-sided crossing minimization is NP-hard, which justifies every heuristic in this space).

4. **Gansner, Koutsofios, North, Vo 1993**, _A Technique for Drawing Directed Graphs_ (IEEE TSE) — <https://www.graphviz.org/documentation/TSE93.pdf>. The `dot` paper. Read it early even though parts are advanced: it is the single most _implemented_ design in this space, and this repo contains an exact implementation of its network-simplex ranking (`computeNetworkSimplexDepths`, shipped behind `pipelineColumnPacking:"shorten"`). Also the source of the "forwardness is a consequence of layering" framing that grounds the strict L→R requirement (R1).

**Websites / working systems (skim all four; they are the practice to the papers' theory):**

- **Eclipse Layout Kernel (ELK)** docs, `layered` algorithm reference — the most configurable production Sugiyama implementation; its option catalog is a checklist of every design decision you will face. The Kiel group (von Hanxleden) behind ELK also produces the model-order papers in §5.
- **Graphviz** documentation + gallery — `dot` in practice; note its cycle breaker is DFS-based, _not_ greedy FAS (v1 of our spec overclaimed greedy FAS as "the universal production default"; only ELK defaults to it — corrected in spec §10).
- **dagre** (the JS port of dot's ideas) wiki and issue tracker — instructive precisely because of its limitations with compound graphs; many "why does my nested layout break" issues are previews of problems A0 solves.
- **Terrastruct D2 / TALA** — a commercial layout engine built specifically for software architecture diagrams (containers first-class). The closest thing to a competitor for this exact problem; their blog posts on why general-purpose layouts fail on architecture diagrams articulate the same pain that motivated RCLL.

---

## 2. Cycle removal — the smallest phase, the dumbest trap

The graph must be acyclic before layering; cycles get repaired by _reversing_ a small set of edges (drawn later as styled back-edges), never deleting them.

1. **Eades, Lin, Smyth 1993**, _A fast and effective heuristic for the feedback arc set problem_ (IPL) — <https://doi.org/10.1016/0020-0190(93)90079-O>. GreedyFAS: repeatedly peel sinks (append to a right sequence) and sources (append to a left sequence), else remove the max-degree-difference vertex; edges pointing right-to-left in the final sequence are the feedback set. Simple, linear-time, good quality. This is spec algorithm A3.

2. **Geladaris, Lionakis, Tollis 2023**, _Computing a Feedback Arc Set Using PageRank_ (JGAA 27(8)) — read §2's **verbatim restatement of GreedyFAS (Algorithm 1)**. This is the paper that settled our round-5 trap: the correct construction is `s2 ← u·s2` (prepend sinks) then **`s = s1 s2` — concatenation, NO reverse**. **Trap door (F1/A3):** v1's pseudocode wrote `s = leftSeq ++ reverse(rightSeq)`, a double reverse that misclassifies plain acyclic chains as feedback edges. It read plausibly and survived four spec rounds. Cross-check pseudocode against a second source _always_; this one bug alone justified the round-5 audit.

3. **Brandenburg & Hanauer 2011**, _Sorting heuristics for the feedback arc set problem_ (§2.4) — the second confirming source for the construction, plus context on how GreedyFAS compares to sorting-based heuristics.

4. **Berger & Shor 1990**, _Approximation algorithms for the maximum acyclic subgraph problem_ — optional; the approximation-theory backdrop. Read if you want to know how far heuristics can be from optimal (answer: FAS is APX-hard; nobody in production cares, minimality is not the goal — _stability and determinism of the chosen set_ is).

**Project-specific engineering the papers don't cover** (spec A3): self-loops must be dropped from ranking input (they are neither forward nor reversible); disconnected graphs need per-SCC condensation with an explicit composition rule (`F = ⋃` of SCC-local sets); and the reversal set should be _deterministic under content-neutral edits_, which is a diff-stability requirement no FAS paper discusses.

**Deep bench (corpus-verified):**

- `[opt]` _Improved Combinatorial Approximation Algorithms for Feedback Arc Set and Rank Aggregation Problems_ (Ostovari & Zarei, JGAA 2026) — `jgaa-3028-improved-combinatorial-approximation-algorithms-for-feedback-arc-set-a` — the current state of the art beyond heuristics; a reference bookend, not a design driver on mostly-acyclic inputs.

**Corpus status: thin — here the reading list is ahead of the corpus.** ELS93 exists only as a metadata stub (`elk-10-1016-0020-0190-93-90079-o`, no full text); Brandenburg–Hanauer 2011 and Berger–Shor 1990 are absent entirely; nothing on weighted or SCC-scoped FAS either. Harvest candidates — see §14.

---

## 3. Ranking / layering — where "strict left-to-right" is enforced

The X-axis is semantic here: rank = dependency depth. This is requirement R1 and it is non-negotiable, which _constrains_ which literature applies.

1. **Healy & Nikolov ch. 13, layering section** (again) — the menu: longest-path (fast, floor-quality), Coffman–Graham (width-bounded), network simplex / LP (minimizes total weighted edge length). Know all three even though only two are in play here.

2. **Gansner et al. TSE93 §2** — network-simplex ranking in full. The key concepts: tight trees, cut values, entering/leaving edges. Our implementation is per-component and exact. **What we measured (X-axis network-simplex campaign, memory: `rcll-xaxis-network-simplex-built`):** NS "shorten" won **−8.4% width** on the canonical preset but _trades a small crossings increase_ — and an earlier probe's "crossings flat" claim turned out to be config-specific. Lesson: layering interacts with crossing minimization; never gate a layering change on one metric measured under one configuration. **Trap door (UX, fixed on `fix/terraform-import-measurement-bugs`):** the option-guard silently demoted the owner's requested `shorten` to `compact` for months — he never saw the layout he thought he was evaluating. Instrument your toggles end-to-end before trusting any A/B.

3. **Coffman & Graham 1972** (width-constrained layering) — optional. Read only if diagram width becomes a gated requirement (R5 is currently report-only).

**Project constraint the literature fights you on:** RCLL pins X to dependency depth ("depth-pinned X") and the spec keeps longest-path as the _floor_ with NS as an opt-in behind a validity gate (OD-1, `isDepthFloorValid`). Pure layering literature optimizes edge length freely; here the semantic X-axis wins ties. When a paper's improvement requires re-ranking freedom, check whether it survives the pin before investing.

**Deep bench (corpus-verified) — the post-2000 layering line the core skipped entirely (mostly the Kiel/ELK research cluster; the sweep's biggest correction to this list):**

- `[essential]` _How to Layer a Directed Acyclic Graph_ (Healy & Nikolov, GD'01) — `doi-10-1007-3-540-45848-4-2` — the canonical ILP: minimize dummy vertices under width/height bounds; the conceptual bridge between our longest-path floor and network simplex, with the classic side-by-side layering comparison figure.
- `[essential]` _Graph layering by promotion of nodes_ (Nikolov & Tarassov, DAM 2005) — `elk-10-1016-j-dam-2005-05-023` — a cheap post-pass on a longest-path layering that promotes nodes to cut dummy count. RCLL's ranking _is_ a longest-path floor, so this is the lowest-effort layering-quality upgrade in the literature (it's ELK's `NIKOLOV` layering improver).
- `[essential]` _A Generalization of the Directed Graph Layering Problem_ (Rüegg, Ehlers, Spönemann, von Hanxleden, GD'16) — `doi-10-1007-978-3-319-50106-2-16` — GDLP merges cycle removal and layering into one trade-off (reversed edges vs dummies/compactness). RCLL runs A3 and A1 as separate stages; this paper is the argument for or against coupling them.
- `[rec]` _Generalized Layerings for Arbitrary and Fixed Drawing Areas_ (Rüegg et al., JGAA 2017) — `jgaa-2475-generalized-layerings-for-arbitrary-and-fixed-drawing-areas` — the fuller journal version of GDLP with SAT/heuristic solvers; if you read only one of the two, read this.
- `[rec]` _Compact Layered Drawings of General Directed Graphs_ (Jabrayilov, Mallach, Mutzel, Rüegg, von Hanxleden, GD'16) — `arxiv-1609-01755v1` — MIP layering under explicit height _and_ width bounds with reversed-edge cost; an exact optimality yardstick at our 120–400-node scale, and relevant to aspect-ratio control (R5).
- `[rec]` _In search for efficient heuristics for minimum-width graph layering with consideration of dummy nodes_ (Nikolov, Tarassov, Branke, ACM JEA 2005) — `doi-10-1145-1064546-1180618` — the experimental study of width-bounded layering that actually accounts for dummy-vertex width (Coffman–Graham does not — pair it with the CG slot rather than replacing it).
- `[rec]` _An Efficient Implementation of Sugiyama's Algorithm_ (Eiglsperger, Siebenhaller, Kaufmann, GD'04) — `doi-10-1007-978-3-540-31843-9-17` — never materialize dummy chains at all (O((|V|+|E|)·log|E|)); the engineering paper for keeping ordering fast on long Terraform dependency chains within a per-PR regeneration budget.
- `[opt]` _Root demotion_ (JGAA 2017) — `jgaa-2468-root-demotion-efficient-post-processing-of-layered-graphs-to-reduce-du` — the complement to node promotion; near-free once a promotion pass exists.
- `[opt]` _A Branch-and-Cut Approach to the DAG Layering Problem_ (Healy & Nikolov, GD'02) — `openalex-10-1007-3-540-36151-0-10`; _A Natural Quadratic Approach to GDLP_ (Mallach, GD'19) — `forward-10-1007-978-3-030-35802-0-40`; _minimum-width layering revisited_ (Kiel TR 1701) — `kiel-minimum-width-layering` — exact baselines and the "max scale" quality measure tied to real drawing area.
- `[opt]` _Sugiyama Layouts for Prescribed Drawing Areas_ (Rüegg, PhD dissertation, Kiel 2018) — `thesis-ruegg-sugiyama-prescribed-areas` — consolidates the whole GDLP / generalized-layering / wrapping line in one document; the efficient single read.

---

## 4. Crossing minimization & within-layer ordering — the deepest branch history

This is the phase with the most project scar tissue. Read the papers _with the traps_.

1. **Sugiyama et al. 1981 (again) + Eades & Wormald 1994** (median heuristic; also the NP-hardness of one-sided crossing minimization) — barycenter and median ordering, the two workhorse heuristics. Everything practical is layer-by-layer sweeps of one of these.

2. **Jünger & Mutzel 1997**, _2-Layer Straightline Crossing Minimization: Performance of Exact and Heuristic Algorithms_ (JGAA) — the experimental comparison. Barycenter and median are near-optimal on sparse graphs; exact methods don't pay at our scale. This is why the spec specifies K=4 alternating barycenter sweeps and not an ILP.

3. **Forster 2002** (GD'02), _Applying Crossing Reduction Strategies to Layered Compound Graphs_ — **the compound-scoped ordering paper.** Crossing reduction must respect cluster contiguity: nodes of the same container stay contiguous in each layer's order, and ordering happens hierarchically (order the containers, then order within). This is the backbone of spec A2's "hull-scoped" design. **Why it matters here:** an unscoped barycenter sweep will happily interleave two subnets' resources in a column — zero crossings gained, containment destroyed (breaks R2). Round 5 found v1's A2 had **no hull contiguity guarantee at all** (finding F2).

4. **Domrös & von Hanxleden 2024** (GD'24), _Diagram Control and Model Order for Sugiyama Layouts_ — arXiv:2406.11393. Model order = the order things appear in the source text (for us: Terraform file position, `firstSequence`). Two strategies: **Strategy 1** — crossing-min sweeps are primary, model order breaks ties (stable _and_ readable); **Strategy 2** — model order is primary (the paper's own evaluation rejects it as a default: it "produces ONO layouts" — ordered-but-not-optimized). **The biggest trap of the campaign (F2):** v1's A2 was a single forward predecessor-barycenter pass with address tiebreaks — i.e., _Strategy 2 in spirit_ — while citing this paper as support. The citation actively refuted the design it was attached to. Round 5's rule ever since: **verify the citation says what the spec says it says.** Companion paper: Domrös et al., _Determining Sugiyama Topology with Model Order_ (LIPIcs GD 2024) — note v1 miscredited its authorship, a smaller instance of the same disease.

5. **Sander 1996**, _Layout of Compound Directed Graphs_ (Saarland tech report A03-96) — <https://publikationen.sulb.uni-saarland.de/bitstream/20.500.11880/25862/1/tr-A03-96.pdf>. The other compound-layout pillar: global base-node ranking with derived cluster spans, border nodes, title handling. Spec A0 ("the algorithm v1.0 never wrote") is Sander-shaped: post-order hull layout, padded extents, frame titles reserved in the footprint. Read Sander and Forster together — together they are ~80% of what "compound Sugiyama" means.

**Branch history for this phase (what we built, measured, and killed):**

- **`coordRepack` (BUILT, shipped default-off):** per-column permutation re-packing for intra-container Y-edge-shortening — **−32.9% intra |ΔY|** on v2. Two alternatives were rejected on measurement: _barycenter-order-key_ (reordering by barycenter key alone) and _dummy-chain-based repack_. Also learned: the apparent "39–96% improvement ceilings" in early probes were a **band-growth mirage** — the metric denominator grew with the layout. Audit your metric's denominator before celebrating.
- **Q2 seven-arm A/B (the decisive measurement, round 5):** no rcll arm beat the v2 baseline on the canonical preset (177 crossings / 402px deviation / 0.17 near-straight); the "readable" profile _worsened_ deviation +43%. This killed the "harden v1-rcll" branch and locked the v2-substrate architecture. Caveat carried forward: one preset, one run per arm, unequal edge denominators — strong directional evidence, not proof.
- **Crossing _count_ is the wrong gate (owner-calibrated):** the owner's preferred view is the arm with the _most_ crossings (371) — it wins vertical deviation, height, hub centering, containment. See §6 below before you optimize crossings.

**Slot upgrades (corpus-verified):** cite Jünger–Mutzel via the canonical JGAA journal version (`doi-10-7155-jgaa-00001`); the GD'95 variant (`doi-10-1007-bfb0021817`) carries the LP/branch-and-cut mechanics with full text. For port constraints, Schulze's 2014 dissertation (`thesis-schulze-layered-port-constraints`) supersedes the JVLC article (`elk-10-1016-j-jvlc-2013-11-005`) on compound/cross-hierarchy port ordering.

**Deep bench (corpus-verified):**

- `[essential]` _Preserving Order during Crossing Minimization in Sugiyama Layouts_ (Domrös & von Hanxleden, 2021 TR / MODELSWARD'22) — `openalex-10-21941-bii-2103` (published: `elk-10-5220-0010833800003124`) — the **origin paper of the model-order line**: how to weigh source order against barycenter inside a production crossing minimizer. The GD'24 papers in the core build on this — read it first.
- `[essential]` _Using Sifting for k-Layer Straightline Crossing Minimization_ (Matuszewski, Molitor, Schönfeld, 1999) — `forward-10-1007-3-540-46648-7-22` — the canonical layered-sifting paper. Sifting is the natural post-pass on top of barycenter for RCLL: positional moves compose cleanly with hull constraints (only test positions inside the container's contiguous block).
- `[essential]` _Global k-Level Crossing Reduction_ (Bachmaier, Brandenburg, Brunner, Hübner, JGAA 2011) — `jgaa-2677-global-k-level-crossing-reduction` — replaces the layer-by-layer sweep with global sifting over all levels at once, handling long edges and constraints; directly addresses the known sweep failure mode (oscillating local optima between layers).
- `[rec]` _Model Order in Sugiyama Layouts_ (Domrös, Riepe, von Hanxleden, 2023) — `doi-10-5220-0011656700003417` — the middle paper of the model-order line; and the **Model Order dissertation** (Domrös, Kiel 2025) — `openalex-10-21941-kcss-2025-3` — the umbrella reference consolidating 2021→2024 including the diff-noise/stability arguments. Best single deep read for RCLL's stability-as-constraint stance.
- `[rec]` _An SDP approach to multi-level crossing minimization_ (Chimani, Hungerländer, Jünger, Mutzel, ACM JEA 2012) — `s2-10-1145-2133803-2330084` — the strongest exact k-level method; an optimality yardstick for how far hull-scoped heuristics sit from the unconstrained optimum.
- `[rec]` _STRATISFIMAL LAYOUT_ (Di Bartolomeo, Riedewald, Gatterbauer, Dunne, 2021) — `stratisfimal-layout` — modular ILP co-modeling crossings, edge bendiness, and **group contiguity** as toggleable constraints — the closest exact formulation of RCLL's hull-scoped objective in the corpus. Too slow for production; the constraint formulations are directly reusable as specifications.
- `[rec]` _Port Constraints in Hierarchical Layout of Data Flow Diagrams_ (Fuhrmann, Spönemann, Mutzel, von Hanxleden, 2010) — `doi-10-1007-978-3-642-11805-0-14` — the KIELER predecessor to Schulze 2014; its dataflow-diagram framing matches RCLL's genre more directly than the journal version's generality.
- `[opt]` Sifting speedups (Günther et al. 2001, `openalex-10-1007-3-540-44541-2-24`); _OSCM is NP-hard even for sparse graphs_ (Muñoz, Unger, Vrt'o 2002, `openalex-10-1007-3-540-45848-4-10` — Terraform graphs are sparse; sparsity won't buy exactness); _bottleneck crossing minimization_ (Stallmann, JEA 2012, `s2-10-1145-2133803-2212314` — minimize the _worst_ edge's crossings rather than the total, an interesting readability-first objective given that a few terrible edges hurt more than many mild ones); parameterized complexity frontier (2025, `arxiv-2510-13335v1`).

**Correction (round-6 audit):** **Forster 2004, _A fast and simple heuristic for constrained two-level crossing reduction_, IS in the corpus with full text** — `forward-10-1007-978-3-540-31843-9-22` (GD 2004, LNCS 3383 pp. 206–216, published 2005 — the year label caused the earlier miss). It is the single most implementation-relevant reference for hull-scoped ordering (merge-on-violation constrained barycenter, <1% from optimal) and is now the designated A2 upgrade path (spec v3 OD-12). Read it before building A2's sweeps.

---

## 5. Coordinate assignment — the identified lever nobody had scheduled

Round 5's sharpest empirical result: near-straightness was **pinned at 0.10–0.17 across all seven measured arms** — no existing flag combination moved it. Coordinate assignment is the standard Sugiyama phase for edge straightness, and it was absent from every version of every spec until A7. If you are the new researcher looking for the highest-value open work, it is this section.

1. **Brandes & Köpf 2001**, _Fast and Simple Horizontal Coordinate Assignment_ (GD'01) — the standard: four alignment passes (up/down × left/right), vertical alignment to medians, horizontal compaction, then balance the four candidate coordinates. Linear time, straightens long edges, well-behaved.

2. **Brandes, Walter, Zink 2020**, _Erratum: Fast and Simple Horizontal Coordinate Assignment_ — arXiv:2008.01252. **Mandatory if you hand-roll BK** (the spec says so explicitly): the original paper's compaction has a correctness bug that survived two decades of citation. Second instance of the campaign's core lesson — even canonical pseudocode lies.

3. **Rüegg, Schulze et al. GD'15** (size-aware coordinate assignment, from the ELK group) — BK assumes uniform node sizes; Terraform nodes are icons+labels+frames of wildly different sizes. This adaptation matters here more than in most applications.

4. **Isotonic regression / Pool-Adjacent-Violators (PAV)** — any standard treatment (e.g. Best & Chakravarti 1990). Spec A7's default option is a per-hull _median-nudge with PAV projection_ (Jacobi-style batch updates, bottom-up with re-anchoring) rather than full BK, because A7 must operate on a depth-pinned grid inside compound hulls where BK's free-x assumptions don't hold. PAV is how you nudge toward medians _without violating the within-column order_ the crossing phase just fought for.

**Trap door (round-5 self-inflicted, F-corrected):** the round-5 report's first draft "corrected" the spec by inserting "add BK-with-erratum Y-refinement" _without normative pseudocode_ — committing exactly the executability sin it was condemning. Codex caught it. A phase is not scheduled until its algorithm, acceptance thresholds, and interaction with existing invariants (here: R2 containment, C-collision gates, re-anchoring after hull extent changes) are written down.

**Deep bench (corpus-verified):**

- `[essential]` _A fast heuristic for hierarchical Manhattan layout_ (Sander, GD'95) — `doi-10-1007-bfb0021828` — the linear-segments/pendulum coordinate method: the main practical alternative to Brandes–Köpf, designed for large compiler graphs with varied node sizes and Manhattan edge routing; ancestor of ELK's `LINEAR_SEGMENTS` placer. One paper covers both the coordinate-assignment and orthogonal-routing levers.
- `[essential]` _ELK Layered — algorithm reference_ — `elk-layered-algorithm-reference` — engineering ground truth: enumerates the node-placement strategies (BK, linear segments, network simplex) and the intermediate processors a production pipeline runs. Read §13.6 of the Handbook (`handbook-hierarchical` — priority method, LP formulations, BK) as its survey companion _before_ committing to BK vs median-nudge+PAV.
- `[rec]` _A Flow Formulation for Horizontal Coordinate Assignment with Prescribed Width_ (Spisla, Jünger, Mutzel, JGAA 2019) — `crossref-10-7155-jgaa-00500` — min-cost-flow coordinate assignment under a width bound; the exact-method companion to BK when aspect ratio is constrained (as RCLL's R5 wants).
- `[rec]` _STRATISFIMAL LAYOUT_ (again, from §4) — its explicit **bendiness-reduction objective** makes it an optimal-baseline oracle for measuring how far any heuristic coordinate pass is from optimum on our graph sizes.
- `[opt]` _Upward Planarization Layout_ (Chimani et al., 2010) — `forward-10-1007-978-3-642-11805-0-11` — a whole alternative pipeline (planarize first, then draw); read only if crossing quality ever becomes the binding constraint.

Corpus doc_ids for the core slots: BK original `brandes-koepf-horizontal-coordinate-assignment`; the 2020 erratum `forward-10-48550-arxiv-2008-01252`; size-and-port-aware `doi-10-1007-978-3-319-27261-0-12`.

---

## 6. What "readable" even means — the aesthetics-evidence literature

Read this section _before_ building any gate metric. The project's round-4 crisis was a misreading of exactly these papers.

1. **Purchase 1997 / Purchase 2002** (_Which aesthetic has the greatest effect?_ and the metrics follow-ups) — the founding empirical work: crossings matter most, then bends, then symmetry. The effect sizes are task- and scale-dependent — that qualifier is the whole game.

2. **Ware, Purchase, Colpoys, McGill 2002**, _Cognitive Measurements of Graph Aesthetics_ (Information Visualization 1(2)) — for **path-tracing tasks** (ours!), _continuity along the path_ (geodesic tendency, few direction changes) outranks raw crossing counts; crossings on the path matter, crossings elsewhere barely do. This paper predicted the owner's revealed preference before we measured it.

3. **Kobourov, Pupyrev, Saket 2014** (GD'14), _Are Crossings Important for Drawing Large Graphs?_ — **read with the round-5 corrected interpretation (spec §10):** crossings were significant at 40 vertices (time p<.01, accuracy p<.05) and only n.s. _in aggregate_ at 120 (large-dense accuracy still significantly hurt); the "<39% accuracy" number belongs to a 150-vertex preliminary; stimuli were _undirected_ force-directed layouts, not layered. **Trap door (round 4's over-rotation):** an earlier round read this literature as "crossings don't matter at scale → defer ALL readability work, ship diff-stability first." That inference was wrong twice over — wrong scale regime for our per-container graphs, and "crossing count is a weak metric" does not imply "readability is deferrable." The owner's explicit ruling (readability #1) plus Q2 reversed it.

4. **Huang, Eades et al.** (crossing angles, eye-tracking studies) — optional depth: _how_ edges cross matters (near-perpendicular crossings are cheap, shallow-angle crossings are expensive). Relevant if you build a weighted crossing metric.

5. **Kieffer, Dwyer, Marriott, Wybrow 2016**, _HOLA: Human-like Orthogonal Network Layout_ (TVCG) — what humans actually produce when asked to draw good diagrams, and a layout that imitates it. The best existing articulation of "readable" as an optimization target rather than a proxy-metric pile.

**The project's operating conclusion (spec D9):** the gate-metric family that tracks the owner's eye is **vertical deviation, near-straight %, hub centering, aspect ratio, container-pierce + contiguity** — with crossing count kept as a _diagnostic_, normalized by eligible edge pairs. The owner picked the highest-crossings arm as his daily view because it wins everything else. Any researcher optimizing this system against raw crossing counts is optimizing the wrong number, with the owner's own preference as the counterexample.

**Slot upgrades (corpus-verified):** the vague "Huang et al." slot gets two concrete anchors — **Huang & Huang 2010**, _Exploring the relative importance of crossing number and crossing angle_ (`doi-10-1145-1865841-1865854`), the head-to-head study and the sharpest citation for demoting crossing _count_; and Huang's eye-tracking study (2007/08, `forward-10-48550-arxiv-0810-4431`) as its mechanism companion (crossings slow reading at the crossing point rather than derailing it). For Purchase 2002, add the metrics companion _Metrics for Graph Drawing Aesthetics_ (JVLC 2002, `s2-10-1006-jvlc-2002-0232`) — the operationalization RCLL's computable gate actually resembles.

**Deep bench (corpus-verified):**

- `[essential]` _The State of the Art in Empirical User Evaluation of Graph Visualizations_ (Burch et al., 2020) — `s2-10-1109-access-2020-3047616` — the consolidated survey of the entire evidence base this section samples piecemeal.
- `[essential]` _Exploring the limits of complexity: a survey of empirical studies on graph visualisation_ (Yoghourdjian, Archambault, Diehl, Dwyer, Klein, Purchase, Wu, 2018) — `openalex-10-1016-j-visinf-2018-12-006` — catalogs the graph sizes user studies actually used and shows most evidence comes from graphs well under 100 nodes. **This paper defines the extrapolation risk at RCLL's 120–400-node scale — cite it whenever defending owner-calibration over literature defaults.**
- `[essential]` _A graph reading behavior: geodesic-path tendency_ (Huang, Eades, Hong, 2009) — `doi-10-1109-pacificvis-2009-4906848` — readers follow edges that head geometrically toward the target; the perceptual foundation under RCLL's vertical-deviation and near-straight metrics beating crossing count.
- `[essential]` _Domain-Specific Rules Override Aesthetic Graph Drawing Criteria_ (Helmke, Doğan, Scheffler, Wrobel, GD 2024) — `s2-10-1007-978-3-031-71291-3-4` — in engineering-diagram domains, domain conventions (e.g. flow direction) trump classical aesthetics including crossings. Direct external validation of the owner-calibrated stance.
- `[essential]` _Readability metric feedback for aiding node-link visualization designers_ (Dunne, Ross, Shneiderman, Martino, 2015) — `s2-10-1147-jrd-2015-2411412` — the standard computable readability-metric family including group-level metrics; the direct precedent for RCLL's gate design.
- `[rec]` _Same Quality Metrics, Different Graph Drawings_ (2025) — `arxiv-2508-15557v1` — adversarial result: layouts can game individual quality metrics while looking bad. **The Goodhart warning every metric-gated layout engine must internalize** — it is the literature's argument for RCLL's multi-metric family over any single gate number.
- `[rec]` _Stress in Graph Drawings: Perception, Preference, and Performance_ (Mooney, Purchase et al., GD 2025) — `s2-10-4230-lipics-gd-2025-38` — the modern methodology template for perception/preference/performance triangulation (what a rigorous version of "the owner's eye" study would look like).
- `[opt]` _The Perception of Graph Properties in Graph Layouts_ (Hansen et al., 2018, `openalex-10-1111-cgf-13410`); _Shape-Based Quality Metrics_ (Nguyen, Klein, Eades, Hong — doc*id prefix `jgaa-2512`); \_Universal Quality Metrics for Graph Drawings* (GD 2025, `s2-10-4230-lipics-gd-2025-30`); _Aesthetic Discrimination of Graph Layouts_ (Klammler, Mchedlidze, Pak, `s2-10-1007-978-3-030-04414-5-12` — a learned aesthetic judge); _UML user preferences_ (JGAA 2002, doc_id prefix `jgaa-2865` — the better source when arguing about diagram-domain preferences vs abstract graphs).

---

## 7. Stability, the mental map, and diff-aware layout

The other half of the project's identity. RCLL regenerates the whole diagram per PR; the question is what the _diff_ looks like.

1. **Misue, Eades, Lai, Sugiyama 1995**, _Layout Adjustment and the Mental Map_ (JVLC) — the founding "mental map" paper: orthogonal ordering, proximity, topology as the three things to preserve across layout updates. The vocabulary everything else uses.

2. **Purchase & Samra 2008** and **Saffrey & Purchase 2008** — empirical tests of whether preserving the mental map actually helps task performance. **Results: mixed to null.**
3. **Archambault & Purchase 2012** (GD'12, and the later "mental map and memorability" work) — the modern synthesis: stability helps for _some_ tasks (revisitation, change detection), not universally. **Why 2+3 matter here (spec §10, corrected reading):** the mental-map literature is split-to-null as a _cognitive universal_ — so RCLL's diff-stability requirement is justified by the **product cadence** (a regenerated diagram attached to a PR must have a reviewable visual diff), not by claimed psychology. That reframe is what demoted diff-stability from round 4's objective to v2's _frozen not-regress constraint_ — arguably the single most important architectural sentence in the spec.

4. **Sondag, Speckmann, Verbeek 2018**, _Stable Treemaps via Local Moves_ (TVCG) — <https://ieeexplore.ieee.org/document/8019841/>. Source of spec A4's stability metric: the **pairwise 8-sector relative-position measure** (for each node pair, which of 8 directional sectors does B occupy relative to A; count sector changes across versions). **Trap door (F3, the inverted citation):** v1's A4 gated on absolute position deltas and a malformed "ordinalFlips" formula — while citing this paper, whose Fig. 19 argument is precisely that absolute-position deltas are "not sufficient to measure the stability." The citation refuted the metric it decorated. |Δpos| survives only as a supplementary stat (Tak & Cockburn lineage).

5. **Diehl & Görg 2002** (foresighted layout) and **North's DynaDAG** — the previous-layout-anchoring school: feed the old layout in as a constraint. **Rejected for RCLL** (spec §10): path-dependent — the layout you get depends on the edit history, which breaks reproducibility (same .tf must yield the same diagram, byte-identical) and makes CI-regenerated diagrams diverge from local ones. This rejection is load-bearing; understand it before proposing incremental layout.

6. **Domrös et al.** model-order/stability papers (ELK group, various) — the practical middle path RCLL adopted: derive stability from _stable inputs_ (source order, addresses) and _deterministic algorithms_, not from remembering the previous output.

**What we measured (churn probe, round 5 — `terraformPipelineChurnProbe.test.ts`):** determinism ≠ diff-stability, exactly as the foundation spec argues. One inserted edge on the v2 engine moved 20/123 addresses — **19 of them unrelated** (median |Δy| 634px); mechanism = the edit shifts `firstSequence` _ranks_, which cascades through the skyline packer's sequential placement. Rank-neutral edits produce zero churn. rcll's placement was ~4× less churn-prone on minimal-add. Diff-instability is real, _rank-conditional_, and mechanical — not the round-4 rhetoric of "every edit reshuffles everything."

**Slot upgrades (corpus-verified):** cite Archambault & Purchase via the **IJHCS 2013 journal version**, _The "Map" in the mental map_ (`forward-10-1016-j-ijhcs-2013-08-004`) — it consolidates and supersedes the GD'12 results and is the right citation for a "frozen not-regress" constraint justified by product cadence. For DynaDAG, cite _On-line Hierarchical Graph Drawing_ (`graphviz-dynadag`, the fuller PDF). For Diehl–Görg, the better-fitting follow-up is Görg, Birke, Pohl, Diehl 2005 (foresighted layout applied to _hierarchical_ drawings — RCLL's substrate; `forward-10-1007-978-3-540-31843-9-24`). Corpus ids for the core: Sondag `doi-10-1109-tvcg-2017-2745140`; Tak & Cockburn `doi-10-1109-tvcg-2012-108`.

**Deep bench (corpus-verified):**

- `[essential]` _New Quality Metrics for Dynamic Graph Drawing_ (Meidiana, Eades, Hong, 2020) — `arxiv-2008-07764v2` — modern change-faithfulness/stability metrics; the natural complement to the Sondag 8-sector measure in A4's metric family.
- `[essential]` _Incremental diagram layout for automated model migration_ (Rüegg, von Hanxleden et al., 2016) — `doi-10-1145-2976767-2976805` — the closest published analog to RCLL's product situation: modeling-tool node-link diagrams re-laid-out under model change, with stability requirements, in a layered (ELK) setting.
- `[rec]` _A Quantitative Comparison of Stress-Minimization Approaches for Offline Dynamic Graph Drawing_ (Mader & Brandes, GD'11) — `forward-10-1007-978-3-642-25878-7-11` — the reference methodology for measuring the stability/quality trade-off (linking, anchoring, aggregation).
- `[rec]` _How Important Is the "Mental Map"?_ (Purchase, Hoggan, Görg, GD'06) — `openalex-10-1007-978-3-540-70904-6-19` — the classic null-ish result; ammunition for keeping stability a constraint, not an objective.
- `[opt]` _Using constraints to achieve stability in automatic graph layout algorithms_ (Paulisch & Newbery, CHI 1990) — `openalex-10-1145-97243-97250` — the origin of layered-layout stability constraints; historical context for DynaDAG.

**Literature gap (open problem, §14):** the corpus — and apparently the field — has no dedicated work on _diff-oriented_ layout comparison (side-by-side, non-animated, PR-review-style). The Rüegg 2016 + model-order line is the nearest substitute.

---

## 8. Constraint-based layout — the road not taken (and one NO-GO to respect)

1. **Dwyer, Koren, Marriott 2006**, _IPSep-CoLa: An Incremental Procedure for Separation Constraint Layout_ + **Dwyer & Marriott's VPSC** (_Fast Node Overlap Removal_, GD'05) — separation constraints (`x_a + gap ≤ x_b`) solved by projection; the engine behind WebCola. The natural formalism for "containers must not overlap" and "title strips are reserved."
2. **Dwyer, Koren, Marriott — DIG-COLA** (directed graph layout via constrained stress majorization) — layered-ness as constraints on an energy model rather than a pipeline.

   **Why RCLL rejected libcola/IPSep as the primary engine** (spec §10): non-deterministic (iterative solvers, floating-point order sensitivity) — fails the byte-reproducibility requirement R6. They remain the right vocabulary for _thinking about_ the geometry phase even where we hand-roll deterministic equivalents.

3. **The Y-axis hull-coordination NO-GO (project result — memory: `rcll-y-axis-hull-coord-nogo`, respect it before re-proposing):** moving whole hulls in Y to shorten cross-container edges was killed _twice_ — first per-hull (3.89%, under-measured), then re-tested with a coupled all-level solve (unconstrained ceiling 99.91%, constrained NO-GO). Root cause: the feasible region is **intrinsically 2D-inseparable** — frames are subtree bounding boxes and the lane-rise pass interleaves X-disjoint subtrees in Y, so no Y-only solve has room to move. Any future attempt must be a joint X-Y formulation, i.e. a different (and much more expensive) problem.

4. **Skyline / strip packing** (any survey of rectangle packing heuristics) — the v2 compaction substrate is a skyline packer. Its _sequential_ nature is exactly the churn mechanism in §7 — placement of item N depends on 1..N−1, so a rank change cascades. Packing literature optimizes density; nobody in that literature measures placement _stability under input perturbation_. Open gap, publishable.

**Slot upgrades (corpus-verified):** read VPSC via the corrected/extended follow-up _Fast Node Overlap Removal_ (Marriott, Stuckey, Dwyer, 2006 — `openalex-10-1007-11618058-15`) alongside (or instead of) the GD'05 paper; pair IPSep-CoLa with the 2008 Discrete Applied Math journal unification (below) — the 2006 conference algorithm has convergence weaknesses the journal version fixes.

**Deep bench (corpus-verified):**

- `[essential]` _Using One-Dimensional Compaction for Smaller Graph Drawings_ (Rüegg, Schulze, Carstens, von Hanxleden, GD'16) — `elk-10-1007-978-3-319-42333-3-16` — deterministic post-pass 1D compaction of layered drawings with variable-size nodes (ELK's `compaction` processor). **The closest published analog to what a deterministic, churn-aware skyline replacement in RCLL should look like.**
- `[essential]` _The Eclipse Layout Kernel_ (Schulze, Spönemann, von Hanxleden, Domrös, Rüegg, 2023) — `s2-10-48550-arxiv-2311-00533` — the production compound layered engine: recursive per-container layout, hierarchical edges, ports, deterministic phase pipeline. The best single "how a shipped RCLL-shaped system decomposes the problem" read.
- `[essential]` _Constrained graph layout by stress majorization and gradient projection_ (Dwyer, Koren, Marriott, 2008) — `forward-10-1016-j-disc-2007-12-103` — the journal-form unification of the VPSC/IPSep line: separation constraints as a QP. If constraint formalisms inform hand-rolled deterministic passes, steal from here.
- `[rec]` _A skyline heuristic for the 2D rectangular packing and strip packing problems_ (Wei, Oon, Zhu, Lim, 2011) — `doi-10-1016-j-ejor-2011-06-022` — **the literature root of RCLL's actual packer**; understanding its sequential greediness is understanding the diff-churn mechanism (improved variant: `doi-10-1016-j-cor-2016-11-024`).
- `[rec]` _Disconnected Graph Layout and the Polyomino Packing Approach_ (Freivalds, Ķikusts, Doğrusöz, 2002) — `doi-10-1007-3-540-45848-4-30` — deterministic packing of disconnected components/hulls with better area/aspect behavior than row or skyline packing; a candidate replacement for packing sibling containers.
- `[rec]` _Topology Preserving Constrained Graph Layout_ (Marriott, Wybrow, Dwyer, 2009) — `doi-10-1007-978-3-642-00219-9-22` — constrained layout that provably preserves containment + non-overlap of an input layout; **the formal treatment of exactly the invariant that killed the hull-Y campaign.**
- `[rec]` _Optimal Compaction of Orthogonal Grid Drawings_ (Klau & Mutzel, 1999) — `doi-10-1007-3-540-48777-8-23` — the constraint-graph (pair of 1D DAGs) formulation of compaction, solved exactly; the standard deterministic formalism for "tighten without overlap."
- `[rec]` _Efficient Node Overlap Removal Using a Proximity Stress Model_ (PRISM; Gansner & Hu) — `graphviz-prism-overlap` (journal: `jgaa-2721-efficient-proximity-preserving-node-overlap-removal`) — the main non-VPSC overlap-removal family; useful contrast for what "preserve the layout while de-overlapping" should mean.
- `[rec]` _Revisiting Stress Majorization as a Unified Framework for Interactive Constrained Graph Visualization_ (Wang et al., TVCG 2017) — `doi-10-1109-tvcg-2017-2745919` — where the rejected libcola line evolved to: cluster non-overlap, containment, and alignment folded into one majorization framework.
- `[rec]` _fCoSE: A Fast Compound Graph Layout Algorithm with Constraint Support_ (Balci & Doğrusoz, TVCG 2021) — `s2-10-1109-tvcg-2021-3095303` — the current best compound engine _outside_ the layered family; the non-Sugiyama baseline to know (port variant CoSEP: `forward-10-1177-14738716211028136`).
- `[opt]` _Scalable, Versatile and Simple Constrained Graph Layout_ (Dwyer, 2009, `forward-10-1111-j-1467-8659-2009-01449-x`); _Node Overlap Removal by Growing a Tree_ (GD'16, `doi-10-1007-978-3-319-50106-2-3` — very simple and deterministic).

---

## 9. Edge routing — the acknowledged hole

Round-5 finding F17: container-pierce is _measured_ (A5) but no requirement ever _owned_ routing — edges are straight chords that pierce frame boundaries. Scheduled as the post-M3 readability increment (EXT-3).

1. **Wybrow, Marriott, Stuckey** — _libavoid_ papers (object-avoiding orthogonal and polyline connector routing, GD'09 lineage). The production-grade routing engine (yEd/Dunnart lineage); the algorithmic reference for "route around frames, not through them."
2. **Gansner et al.** spline routing in dot (TSE93 §5 + the follow-up piecewise-Bézier work) — the classic funnel/spline approach for layered layouts.
3. **Holten & van Wijk 2009** (CHI), _Force-Directed Edge Bundling_ — cited in the spec not for bundling but for the perceptual findings on edge _styling_; grounds A3's styled back-edge rendering (a reversed edge must be visually honest).
4. **Schulze, Spönemann, von Hanxleden 2014**, _Drawing Layered Graphs with Port Constraints_ (JVLC) — ports: edges attach at defined points on node boundaries. The likely shape of RCLL's routing future, since Terraform edges have natural port semantics (which listener, which subnet attachment).

**Slot upgrades (corpus-verified):** pin the libavoid slot to the two concrete papers — _Incremental Connector Routing_ (GD'05, `doi-10-1007-11618058-40`, the poly-line original) and _Orthogonal Connector Routing_ (GD'10, `wybrow-marriott-stuckey-orthogonal-connectors-2010`, the variant RCLL would actually implement). Supplement TSE93's spline sketch with **DGKN97**, _Implementing a General-Purpose Edge Router_ (`graphviz-edge-router`) — Graphviz's fixed production algorithm (visibility graph → shortest path → spline fitting); TSE93 itself admits its splines "sometimes bend sharply inside virtual node boxes." And prefer **Holten 2006, _Hierarchical Edge Bundles_** (`forward-10-1109-tvcg-2006-147`) over the 2009 force-directed paper — HEB bundles along an existing hierarchy, which RCLL's container tree already provides.

**Deep bench (corpus-verified):**

- `[rec]` _Method for Orthogonal Edge Routing of Directed Layered Graphs with Edge Crossings Reduction_ (2021) — `forward-10-5121-csit-2021-111821` — orthogonal routing specialized to layered directed graphs using inter-rank "pipes"/lanes with port-derived node dimensions; the closest published recipe to RCLL's first routing increment (EXT-3).
- `[rec]` _Clustered edge routing_ (Bouts & Speckmann, 2015) — `openalex-w3212372015` — routing that respects cluster/container structure so edges don't cut through groups; the direct literature match for "edges must not pierce frames."
- `[rec]` _An extended evaluation of the readability of tapered, animated, and textured directed-edge representations_ (Holten, Isenberg, van Wijk, Fekete, 2011) — `openalex-10-1109-pacificvis-2011-5742390` — empirical evidence on rendering edge _direction_ (arrows vs tapering vs curvature); directly informs how reversed back-edges and the L→R flow encoding should be drawn.
- `[opt]` _Orthogonal Hyperedge Routing_ (Wybrow, Marriott, Stuckey, 2012, `doi-10-1007-978-3-642-31223-6-10` — bus-style shared trunks for fan-in/fan-out); _Divided Edge Bundling_ (Selassie, Heimerl, Heer, 2011, `doi-10-1109-tvcg-2011-190` — the only bundling variant that doesn't destroy direction legibility); _Edge routing with ordered bundles_ (Pupyrev, Nachmanson et al., 2015, `doi-10-1016-j-comgeo-2015-10-005` — bundles with a defined edge order so individual edges stay traceable); _Edge Label Placement in Layered Graph Drawing_ (Schulze, Wechselberg, von Hanxleden, 2018, `elk-10-1007-978-3-319-91376-6-10` — labels compete with edges for space in icon+label nodes).

**Corpus gap (§14):** nothing anywhere on the _aesthetics of rendering reversed feedback edges_ in layered drawings — the corpus covers computing the feedback set, not drawing it. Web search territory, and possibly a genuine literature hole.

---

## 10. Determinism, identity, and collaborative-canvas engineering

No papers here — this is where the literature runs out and the round-5 findings _are_ the reading. The lesson block that cost the most tokens to learn:

- **Stable identity** (spec A6): elements get content-derived ids (`tf:role:address`, percent-encoded, injective — naive "strip unsafe characters" schemes collide), direction-preserving length-prefixed edge ids, FNV-1a content seeds clamped nonzero (`(hash & 0x7fffffff) || 1` — seed 0 is RoughJS's "unseeded" sentinel and yields `Math.random` at render time; this was a real shipped bug).
- **Version semantics:** a content-hash "version" is _invalid_ for Excalidraw's collaboration layer — reconcile compares versions numerically, so versions must be monotone (generation-based) and deletions need tombstones or peers resurrect them. v1 speced constant `version=1/versionNonce=0`, which would have made regenerations silently never propagate to collaborators.
- **The regenerate path is `replaceAllElements`, not `reconcileElements`** — four spec rounds aimed the edit-survival design at a code path that never runs on import (finding S7). Verify which code actually executes before designing around it.
- **Option threading:** five silent-drop seams between a URL toggle and the layout engine (sceneContext literal, guards, apply-mapper, cache allowlist, variant clobber). The measurement infrastructure is part of the system under study.

Reference reading: `docs/rcll-v2-spec-v2.md` §6 (A6) and the round-5 report findings F5/F13–F15 — plus Excalidraw's own `reconcile.ts` / `restore.ts` if you touch identity.

---

## 11. Domain context — architecture-diagram layout in the wild

Lighter reading; calibrates what "good" looks like for _this_ diagram genre.

- **Terrastruct blog** — the TALA engine posts (containers as first-class layout objects; why dagre/graphviz-class engines fail on software architecture). The competitor analysis for RCLL.
- **AWS/GCP reference-architecture diagram galleries** — the human-drawn gold standard: note the conventions (L→R or T→B flow, containers rarely pierced, hubs centered, ancillary services banished to edges). RCLL's metric family is an attempt to formalize exactly these conventions.
- **ELK `layered` documentation** (again, as a website) — read the _options_ page end-to-end once; it is the field's institutional memory of every knob that ever mattered.
- **Graphviz gallery + dagre issue tracker** — failure modes of general engines on compound graphs; useful for building intuition about _why_ A0 exists.

**Deep bench (corpus-verified):**

- `[essential]` _Visualizing Dataflow Graphs of Deep Learning Models in TensorFlow_ (Wongsuphasawat et al., TVCG 2017) — `forward-10-1109-tvcg-2017-2744878` — **⚠ metadata-only stub (round-6 audit): no local PDF despite the essential billing; harvest the open IDL copy (idl.cs.washington.edu/files/2018-TensorFlowGraph-VAST.pdf)** — **the closest real production system to RCLL in the entire corpus**: hierarchical, containerized, layered dataflow at hundreds of nodes, with extraction/clustering decisions driven explicitly by legibility (they ancillary-extract high-degree "auxiliary" nodes — the same move as RCLL's ancillary toggle). Read it as a case study in every trade-off this list covers.
- `[opt]` The UML-layout classics — _A new approach for visualizing UML class diagrams_ (Gutwenger, Kupke et al., 2003, `forward-10-1145-774833-774859`), topology-shape-metrics for UML (Eiglsperger et al., `forward-10-1145-774833-774860`), and Seemann's Sugiyama-for-UML (1997, `forward-10-1007-3-540-63938-1-86`) — the prior diagram-genre adaptation of exactly this machinery, mixed hierarchical/non-hierarchical edges included.

---

## 12. The branch map — every major path, and how it ended

For orientation: what was tried, what survived. Details live in the linked docs/memories.

| Branch | Verdict | Why |
| --- | --- | --- | --- | --- |
| v1 RCLL spec (rounds 1–4) as written | **NO-GO** (round 5) | A2 implemented the strategy its own citation rejects; A3 pseudocode broken; A4 metric inverted vs its citation; S7 aimed at a code path that never runs |
| Round-4 priority inversion (diff-stability #1) | **Reverted** | Owner ruling + Q2 + corrected literature reading; stability is now a frozen constraint, readability the objective |
| "Harden v1-rcll instead of new engine" | **Killed empirically** (Q2) | No rcll arm beat the v2 baseline; `readable` profile worsened deviation +43% |
| v2-substrate architecture (new engine on v2 compaction) | **LOCKED** | Q2 supported it; strongest pro-spec result of round 5 (single-preset caveat carried) |
| Network-simplex X (`shorten`) | **BUILT**, default-off | −8.4% width; trades small crossings increase; gate on width+structural, not crossings |
| `coordRepack` (per-column Y re-pack) | **BUILT**, default-off | −32.9% intra | ΔY | ; barycenter-order-key and dummy-chain variants rejected |
| Y-axis hull coordination | **NO-GO ×2** | Feasible region intrinsically 2D-inseparable (frames = subtree bboxes + lane-rise interleaving) |
| M3a placement geometry (boxes, forced bands, derived frames) | **SHIPPED** | Collision gate 0 on v2 compact+full; first geometry milestone |
| Coordinate assignment (A7) | **The open lever** | Near-straight pinned 0.10–0.17 in every measured arm; only unscheduled standard phase; now specced, not built |
| Edge routing | **Unbuilt, now owned** (EXT-3) | Chords pierce frames; measured by A5, scheduled post-M3 |

---

## 13. Suggested reading order (the path, if you read nothing else)

1. Healy & Nikolov ch. 13 (the map) → §0–1 project docs skim (spec §0–§5).
2. Gansner TSE93 (the canonical system).
3. Sander 96 + Forster 02 back-to-back (compound = your actual problem).
4. Domrös GD'24 (arXiv:2406.11393) **with round-5 finding F2 open beside it** — the Strategy 1/2 trap is the single best lesson in citation discipline this project offers.
5. Brandes–Köpf 01 + the 2020 erratum (the lever you'll probably be asked to build).
6. Ware 02 + Kobourov 14 (corrected reading) + the Q2 table in the round-5 report §4 — internalize why crossing count is not the gate.
7. Sondag 18 + Misue 95 + Archambault–Purchase (stability: metric, vocabulary, and why it's a constraint not an objective).
8. Eades–Lin–Smyth 93 via Geladaris 23's Algorithm 1 (small paper, big trap).
9. Then: `rcll-v2-spec-v2.md` end-to-end. It will read as an annotated bibliography of everything above, which is what a good spec is.

(That path covers the core. The per-section **deep benches** are pull-on-demand: when a design question opens — "should layering absorb cycle removal?", "what replaces the skyline?" — the bench for that section is the curated next layer before you fall back to raw corpus queries.)

**Standing lessons (the trap-door summary):**

- **Verify citations against their PDFs.** Three separate spec algorithms (A2, A3, A4) cited papers that refuted the design they were attached to.
- **Canonical pseudocode lies** — GreedyFAS's restatement drift and BK's 19-year erratum.
- **Audit metric denominators** — band-growth mirages, unequal edge populations, vacuous hub-center zeros, un-normalized crossing counts all occurred in this project.
- **Derive thresholds and validate them on disjoint presets** — same-fixture gates overfit.
- **Instrument the toggle path** — measurements through silently-dropped options are measurements of nothing (five seams, the `shorten` demotion).
- **Determinism ≠ stability, and stability ≠ psychology** — it's a product-cadence constraint, measured pairwise-relationally (Sondag), gated not optimized.
- **One preset is directional evidence, never proof.** Every gate in the spec now requires ≥2 structurally different presets. So should yours.

---

## 14. Corpus verification report — coverage, gaps, and harvest list

**Method (2026-07-04):** five parallel deep-research sweeps against the graph-layout-rag corpus (~5,811 documents), ~75 distinct query phrasings covering cycle removal, layering, crossing minimization, model order, coordinate assignment, edge routing, ports, compound/clustered layout, constraints, compaction/packing, empirical aesthetics, mental map/dynamic stability, evaluation methodology, and diagram-genre systems. Gateway verified healthy under the concurrent load (queue empty, 0 failed jobs, ~8s/query end-to-end dominated by SSH, not GPU).

**Coverage verdict by area:**

| Area | Corpus | Notes |
| --- | --- | --- |
| Layering / ranking | **Strong** | Entire Kiel/ELK post-2000 line present with full texts — the sweep's biggest addition to this list (§3 bench) |
| Crossing minimization | **Strong** | Heuristic, exact (SDP/ILP), sifting, complexity frontier all present |
| Model order / determinism | **Excellent** | Complete Domrös/von Hanxleden line 2021→2025 incl. dissertation |
| Coordinate assignment | **Strong** | BK + erratum + size/port-aware + flow formulation + Sander pendulum + surveys |
| Edge routing / ports | **Good–Strong** | libavoid family, Graphviz routers, clustered routing, full KIELER/ELK port cluster |
| Compound / constraints / compaction | **Strong–Excellent** | Full Dwyer/Marriott program; compaction lineage; skyline/polyomino packing roots |
| Empirical aesthetics | **Strong** | Purchase lineage, both major surveys, Huang line, current GD'25 perception work |
| Mental map / dynamic stability | **Strong** | Full Purchase–Archambault arc, DynaDAG, foresighted family, modern metrics |
| Cycle removal / FAS | **Thin** | The one area where this reading list is ahead of the corpus |

**Harvest candidates (round-6 revision — add to the next `yarn graph-rag:harvest`):**

1. ~~Forster 2004~~ — **REMOVED: it's in the corpus with full text** (see §4 correction).
2. **Charytitsch & Nascimento 2026**, _Constrained Incremental Graph Drawing_ (EJOR / arXiv:2508.15949) — the literature formalization of diff-stable-per-PR regeneration; shapes T2's objective framing.
3. **Edge-Path Bundling** (Wallinger et al., TVCG 2022, arXiv:2108.05467) + **Bundling-Aware Graph Drawing** (GD 2024.15) — traceability-preserving hub relief.
4. **Dobler & Roithinger 2025**, _Layered Graph Drawing with Few Gaps and Few Crossings_ (arXiv:2502.20896) — long-edge compactness for Sugiyama layouts.
5. **Brandenburg & Hanauer 2011** (FAS sorting heuristics) — absent; free PDF at uni-passau (MIP-1104). **Eades–Lin–Smyth 1993** full text (metadata stub; Elsevier paywall — bib-only if unobtainable). Berger–Shor 1990 stays optional (algorithm is described in `handbook-hierarchical` §13.2.2).
6. **TF-visualizer PDF** (see §11 stub flag), **Wei et al. 2011** skyline (stub — the A0 packer's literature root), **Huang 2009** geodesic tendency (stub), **CHI 2025 bundling-perception** (decision evidence), **gdMetriX** (GD'24 tooling for the T9 harness).
7. **Rendering reversed feedback edges** (styling, not computing) — round-6 web sweep confirms this is a **genuine literature hole**, not a corpus gap: nothing exists. Reframed as an in-house A/B opportunity alongside A3's styled back-edges.

**Genuine literature gaps (≠ corpus gaps — the field itself is silent; each is both a risk to RCLL and a publishable opening, cross-ref §12):**

1. **Stable / order-preserving packing** — packing literature optimizes density; nothing measures placement stability under input perturbation. RCLL's skyline-churn problem lives exactly here.
2. **Diff-oriented layout comparison** — side-by-side, non-animated, PR-review-style stability; the mental-map literature is all animation/revisitation. Rüegg 2016 + model order are the nearest neighbors.
3. **Empirical readability at 100–500 nodes** — Yoghourdjian et al. 2018 documents that most user studies use far smaller graphs; owner-calibration is a rational response to this evidence gap, and the survey is the citation that says so.

**Scale honesty:** the corpus holds ~5,811 canonical documents; this list now names ~85. That ratio is correct, not lazy — the corpus is a _retrieval_ substrate (harvested broadly around graph drawing, including force-directed, treemaps, GNN noise, and adjacent fields), and the sweep's relevance filtering discarded the bulk as off-topic for a layered compound dataflow engine. The core+bench split is the useful structure: read the core, pull bench papers on demand, and query the corpus when a specific design question exceeds both.
