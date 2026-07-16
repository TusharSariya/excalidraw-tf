# Agent 7 — Data-flow / infra-architecture readability METRICS + MIXED/SEMANTIC LAYOUT

Charter: what does the literature say GOOD looks like for layered infra/data-flow diagrams, and does it support treating HULLS (data-flow containers) differently from leaf RESOURCES? Robust, generic, literature-backed only. Cite (author/year + rag doc_id/DOI). Self-adversarial throughout.

Corpus: `graph-layout-rag` queried from Mac via `bin/rag graph`. doc_ids given inline. Where a paper is asserted from general knowledge and NOT confirmed in-corpus, it is flagged in §MISSING PAPERS.

---

## 1. ESTABLISHED readability metrics/aesthetics for layered/DAG + data-flow diagrams, and which EMPIRICALLY matter most

### The canonical aesthetics (Sugiyama tradition)

Sugiyama, Tagawa & Toda 1981, "Methods for Visual Understanding of Hierarchical System Structures" (`doi-10-1109-tsmc-1981-4308636`) established the layered ideal and its four aesthetics, still the scaffold every layered layout (dot, ELK, strata) optimizes:

1. **Few edge crossings**
2. **Short/uniform edge length** (few long edges spanning many layers → few dummy nodes)
3. **Straight, few-bend edges** (uniform edge direction / "upwardness" — all edges point the same way across layers)
4. **Balanced/even node distribution** within and across layers.

Purchase 2002, "Metrics for Graph Drawing Aesthetics" (`openalex-10-1006-jvlc-2002-0232`, DOI 10.1006/jvlc.2002.0232) formalizes these as _continuous_ computable metrics (crossings, bends, minimum angle, orthogonality, symmetry, node/edge distribution) — the standard vocabulary for scoring a drawing. GdMetriX (`s2-10-4230-lipics-gd-2024-45`) is a recent NetworkX implementation of the same metric family, confirming they remain the operative set.

### Which of these EMPIRICALLY drive comprehension (ranked by evidence strength)

- **Edge crossings — #1, robustly.** Purchase, Cohen & James 1997, "Validating Graph Drawing Aesthetics" (`s2-10-1007-bfb0021827`, cited×195 — the single most-cited empirical result here) ran controlled human tasks and found **minimizing crossings has by far the largest positive effect on human understanding**, bends second, symmetry a weak/inconclusive third. Replicated across the Purchase program (UML study `s2-527ca0518fca9efdbea27c8a3289a4c8d67e22f6`; survey `s2-10-1109-access-2020-3047616` summarizes the same ordering: bends and crossings dominate).
- **Crossing ANGLE — strong secondary.** Huang & Huang 2010, "Exploring the relative importance of crossing number and crossing angle" (`doi-10-1145-1865841-1865854`): when crossings are unavoidable, near-90° crossings cost far less comprehension than shallow-angle ones. This is why an angle term matters _given residual crossings_ — but it is subordinate to crossing _count_.
- **Continuity / path-following (edge straightness) — cognitively grounded.** Ware, Purchase, Colpoys & McGill 2002, "Cognitive Measurements of Graph Aesthetics" (`doi-10-1057-palgrave-ivs-9500013`): the dominant cost in node–link tasks is _tracing a path_; **continuation (low bends / straight edges along a path) and few crossings-on-the-path** are what make tracing cheap. Total edge length per se is only weakly tied to comprehension — it matters _insofar as_ long edges create crossings, bends, and hard-to-follow long traces.
- **Edge length / area / symmetry — weaker, mostly aesthetic-preference not task-performance.** No strong comprehension result isolates "shorter total edge length" as directly improving task accuracy; its value is instrumental (shorter edges → fewer crossings, easier tracing, tighter mental grouping). Symmetry and pure area were inconclusive in Purchase's studies.

### Mapping strata's THREE problems onto the highest-impact metrics

| Strata symptom | Metric it violates | Empirical impact rank |
| --- | --- | --- |
| **Long edges to stranded sinks (DLQ/SSM/S3/audit)** | edge length + creates crossings & long traces | length weak _directly_, but **the crossings & broken path-continuity it induces are #1/#3** |
| **Frame/box PIERCES (edge tunnels a node)** | node–edge overlap / occlusion | **high** — literature treats edges-through-nodes as a first-order legibility defect (overlap papers `s2-10-1109-iv-2017-14` and the ELK size-aware line `doi-10-1007-978-3-319-27261-0-12` route edges to _avoid_ passing through node boxes as a hard goal) |
| **Wide/tall boxes (emergent, unscored height)** | area / node-distribution | **weakest direct comprehension link** — this is the one strata complaint with the least empirical backing as a _comprehension_ problem (see §4 adversarial) |

**Punchline for §1:** the metrics that actually drive comprehension are **crossings (count) > bends/ continuity + crossing-angle**. Strata's long-edge and pierce problems are _legitimately_ high-impact because they degrade crossings and path-continuity. Its box-size problem is the _least_ empirically load-bearing as a comprehension metric — it is largely an aesthetic/compactness preference.

---

## 2. INFRASTRUCTURE / DATA-FLOW / architecture-diagram layout specifically

There IS a targeted literature; generic Sugiyama misses several conventions it prescribes:

- **Data-flow diagrams with PORTS + containment (the closest analog to strata).** Rüegg, Kieffer, Dwyer, Marriott & Wybrow, "Stress-Minimizing Orthogonal Layout of Data Flow Diagrams with Ports" (`doi-10-1007-978-3-662-45803-7-27`) and Schulze/Fuhrmann/von Hanxleden (ELK), "Port Constraints in Hierarchical Layout of Data Flow Diagrams" (`elk-10-1007-978-3-642-11805-0-14`). Prescriptions generic Sugiyama lacks: (a) **ports** — edges attach at fixed sides so flow direction reads consistently; (b) **orthogonal routing that respects container boundaries** (edges route _around_ boxes, not through — directly the pierce problem); (c) **node SIZE is first-class** — Rüegg, "Size- and Port-Aware Horizontal Node Coordinate Assignment" (`doi-10-1007-978-3-319-27261-0-12`) extends Brandes–Köpf coordinate assignment so _large_ nodes (≈ hulls) get correct spacing instead of being treated as points.
- **Compound / clustered DIRECTED layout (containment = boundary).** Sander, "Layout of Compound Directed Graphs" (`sander-compound-directed-graphs`) is the reference for laying out a _directed_ graph whose nodes are nested containers — exactly account→region→VPC→subnet→resource. It keeps containers as convex regions and lays out inter- and intra-container edges in one layered pass. Also CoSEP (`forward-10-1177-14738716211028136`) and the biological-pathway compound layouts (`s2-10-1007-978-3-540-31843-9-45`).
- **Containment as a hard constraint.** Dwyer, Marriott & Stuckey 2005, "Constraint-based layout with cluster containment" (`research-thread-constraints`, cited×832) — the canonical statement that _cluster/container boundaries are non-overlapping convex constraints_ the layout must satisfy. This is the formal backing for "hulls are boundaries, not decoration."
- **Grouped-network compaction.** Yoghourdjian et al., "High-Quality Ultra-Compact Grid Layout of Grouped Networks" (`yoghourdjian-ultra-compact-grid-grouped`) — grouping + compactness jointly.
- **Domain-specific layout is itself an endorsed idea.** "Domain-Centered Support for Layout, Tasks and Specification for Control Flow Graph Visualization" (`s2-10-1109-vissoft55257-2022-00013`) and SetCoLa (`forward-10-1111-cgf-13440`, "High-Level Constraints for Graph Layout") argue that _domain conventions_ (here: cloud/infra) should be encoded as constraints layered on a base algorithm — not left to generic Sugiyama.

**What generic Sugiyama misses that this literature prescribes:** ports/consistent flow attachment; orthogonal boundary-respecting routing (no pierces); **node/container SIZE as first-class**; hard containment; and encoding domain conventions as constraints. Strata already does layered + containment but scores on chords and treats sinks as points → it inherits exactly the gaps this literature fixes.

---

## 3. MIXED / SEMANTIC / CONSTRAINT layout — does anything justify "hulls may grow in height, resources may not"?

This is the crux. Honest verdict: **PARTIAL — the _mechanism_ (per-node-class constraints on a base layout) is very well supported; the _specific policy_ (containers spread vertically = good, leaves spread = bad) is NOT stated by any paper and is the owner's inference.**

### What IS strongly literature-backed

- **Constraint-based layout with typed/per-class constraints.** Dwyer, Koren & Marriott 2006, "IPSep-CoLa" (`dwyer-ipsep-cola`, cited×104) and Dwyer/Marriott/Stuckey 2005 cluster containment (`research-thread-constraints`): you can impose separation, alignment, and containment constraints on _arbitrary subsets_ of nodes over a base layout. **SetCoLa** (`forward-10-1111-cgf-13440`) explicitly provides _high-level, group-scoped_ constraints — "apply constraint C to all nodes of type T." So "apply a height/compaction constraint to leaf-type nodes but not container-type nodes" is _exactly_ the kind of typed constraint this line of work is built to express. **The differential-treatment MECHANISM is textbook constraint-based layout.**
- **Size-awareness = treat big things differently.** Rüegg size-/port-aware coordinate assignment (`doi-10-1007-978-3-319-27261-0-12`): large nodes are _intrinsically_ handled differently from point-like nodes in coordinate assignment. Containers (hulls) being large and resources being small is already a size distinction the literature acts on.
- **Position should encode meaning (secondary notation / cognitive effectiveness).** Moody 2009, "The Physics of Notations" (`doi-10-1109-tse-2009-67`) and the secondary-notation discussion in Domrös & von Hanxleden's "Diagram Control and Model Order for Sugiyama Layouts" (`arxiv-2406-11393v1`): **spatial arrangement carries semantics ("secondary notation")** — sources top/left, sinks bottom/right, related things adjacent. This supports the _general_ claim that a container whose spread conveys data-flow structure is carrying real information, so compacting it away destroys signal — but it does NOT specifically say "let containers grow in height."

### What is NOT literature-backed (the owner's specific hunch)

No paper in-corpus (or in my knowledge) states "data-flow **containers** should be permitted vertical spread because it is informative, while **leaf** resources should be height-constrained because they are terminals." That precise per-type height policy is an _inference_ the owner is drawing from the general principles above. It is **plausible and constructible as a SetCoLa-style typed constraint**, but it is a _design hypothesis_, not an empirical finding. The literature gives you the _tool_ and a _general rationale_ (position-encodes-meaning + size-awareness), not the _specific rule_.

---

## 4. Is current strata output "expected"/acceptable, or genuinely poor? (adversarial)

**Split verdict:**

- **The pierces and long stranded-sink edges are GENUINELY poor by the metrics that matter.** Edges through node boxes (pierces) are a first-order legibility defect the infra/data-flow literature treats as something to _route around_ (§2). Long sink edges degrade path-continuity (Ware 2002) and induce crossings (Purchase 1997) — the #1 and #3 comprehension drivers. Fixing these is well-justified. This aligns with the 13-agent synthesis: the biggest win (Account-04 block shift, −22 crossings / −20 pierces) improves exactly the top-ranked metrics.
- **The box-SIZE/height complaint is where the owner is most likely over-indexing.** Area and node-distribution are the _weakest_ empirical comprehension metrics (§1). There is **no strong evidence that a taller container box hurts comprehension** — and Purchase-style results would, if anything, prefer _not_ trading crossings/continuity for compactness. The synthesis's own factorial flags this: blanket compaction that reduces height at the cost of crossings is _catastrophic_ (+176…+215 crossings). So "packed, not respecting height" as a _global_ objective is metric-unjustified. The owner's compactness preference is partly an **aesthetic/screen-real-estate** concern, not a comprehension one.

**Adversarial reframe of the owner's hypothesis:** "packed height is preferred for hulls but not leaves" can be read two ways. (a) _"Let hulls stay tall so flow is visible"_ — this is really an argument to **NOT compact hulls**, i.e. protect informative vertical spread. That is defensible (secondary notation). (b) _"Compact leaves aggressively"_ — defensible only because leaf sinks are degree-1 terminals whose position carries little flow information, so pulling them toward their source (the X-shift operator the synthesis recommends) costs no comprehension. **Both readings reduce to: apply compaction to leaves, exempt containers — which is a typed constraint, and which happens to be what the X-shift-operator recommendation already does.** The owner is directionally right about the _policy shape_ even though the "height is the metric" framing is the weakest part.

---

## 5. Top 2–3 ROBUST, literature-backed recommendations for what strata SHOULD optimize

**#1 (highest confidence) — Optimize crossings first, path-continuity/crossing-angle second; treat node–edge PIERCES as a hard legibility defect, not a scored soft term.**

- Backing: Purchase/Cohen/James 1997 (`s2-10-1007-bfb0021827`) crossings dominate; Ware 2002 (`doi-10-1057-palgrave-ivs-9500013`) continuity; Huang 2010 (`doi-10-1145-1865841-1865854`) angle; overlap literature on edges-through-nodes.
- Fits strata: it already scores crossings/penetration; the fix is (a) score on _rendered_ geometry and (b) route edges around container boundaries (ELK/Rüegg data-flow ports) so pierces go to ~0.
- Robust vs edge cases: crossings-first is the most replicated result in the field; low risk.

**#2 — Add a targeted, type-scoped X-shift / compaction operator: pull degree-1 leaf sinks toward their source; leave container hulls' internal spread intact.** (Converges with the 13-agent synthesis #1, but on _metric_ grounds.)

- Backing: SetCoLa group-scoped constraints (`forward-10-1111-cgf-13440`) + IPSep-CoLa/cluster containment (`dwyer-ipsep-cola`, `research-thread-constraints`) justify _typed_ constraints; Rüegg size-aware placement (`doi-10-1007-978-3-319-27261-0-12`) justifies treating large containers ≠ point leaves; Ware continuity justifies shortening leaf traces.
- Per-type policy: **YES, apply compaction to leaves, exempt containers** — this is the literature-supported _form_ of the owner's hunch. Frame it as "protect informative container spread
  - shorten uninformative leaf traces," NOT as "minimize container height."
- Robust vs edge cases: degree-1 sinks are crossing-neutral under X-shift (proven in synthesis C2), so this improves length/continuity with no crossing regression. Must stay guard-gated (blanket ranker swap is catastrophic — synthesis).

**#3 (lower priority) — Do NOT adopt "packed height" as a global objective; keep container height UNSCORED/permitted and instead encode containment + boundary-avoiding routing as hard constraints.**

- Backing: area/height is the weakest comprehension metric (§1, §4); cluster-containment as a hard constraint (Dwyer/Marriott/Stuckey `research-thread-constraints`); secondary notation (Moody `doi-10-1109-tse-2009-67`) says container spread can be informative.
- Fits strata: strata already leaves height emergent/unscored — the literature _endorses_ that choice for containers. The recommendation is to resist the temptation to add a height gate.

---

## SELF-ADVERSARIAL GAPS (am I rationalizing the owner's hunch?)

- **The hulls-vs-resources HEIGHT split is my weakest claim.** I found NO paper that says "containers should grow in height." I am reconstructing it from (a) constraint-based typed layout (mechanism, solid) + (b) secondary notation (general, solid) + (c) size-awareness (solid). The _specific policy_ is an interpolation. I flagged this honestly in §3/§4. If the owner reads my report as "literature says let hulls grow tall," that is an over-read — literature says "you _can_ apply different constraints per type, and container spread _can_ carry meaning," which is weaker.
- **I am asserting the crossings>length>angle ordering as near-universal.** Caveat: Purchase's studies used small/generic graphs and specific tasks (path/adjacency). Strata's diagrams are large, nested, domain-specific infra — the ordering _probably_ transfers but is not _proven_ on this class. The synthesis's own note that "weights stay conjectural pending blinded human calibration" applies to me too: I have empirical backing for the _ranking_ but not for strata-specific _exchange rates_.
- **"Pierces are a first-order defect" — I inferred this from overlap/routing literature, not from a study that isolates node-edge-overlap comprehension cost.** It is standard practice (every orthogonal router avoids it) but I did not find a Purchase-style controlled experiment measuring _pierce_ cost specifically. Treat as strong convention, not proven metric.
- **Edge length's direct comprehension effect is weak — so my recommendation to shorten leaf edges is justified via _continuity/crossings_, not via length itself.** If someone argued "length doesn't matter empirically, so leave the long DLQ edges," the rebuttal is the crossings + broken-trace they cause, not length per se. I want to be honest that "minimize edge length" is instrumentally, not intrinsically, backed.
- **Confirmation-bias check:** my three recommendations _converge_ with the prior 13-agent synthesis (X-shift operator, leaf vs block). I reached them from an independent (metrics) starting point, which is corroborating — but I should flag the risk that I anchored on the synthesis doc I read first. The one place I _diverge_ from a naive reading of the owner: I actively argue AGAINST a global height/ packed objective, which the owner's framing leans toward.

## MISSING PAPERS (full citations; absence-from-rag checked where noted)

Present in corpus (used above): Purchase/Cohen/James 1997 (`s2-10-1007-bfb0021827`); Purchase 2002 Metrics (`openalex-10-1006-jvlc-2002-0232`); Ware/Purchase/Colpoys/McGill 2002 (`doi-10-1057-palgrave-ivs-9500013`); Huang & Huang 2010 (`doi-10-1145-1865841-1865854`); Sugiyama/ Tagawa/Toda 1981 (`doi-10-1109-tsmc-1981-4308636`); Rüegg data-flow ports (`doi-10-1007-978-3-662-45803-7-27`) + size-aware (`doi-10-1007-978-3-319-27261-0-12`); ELK port constraints (`elk-10-1007-978-3-642-11805-0-14`); Sander compound directed (`sander-compound-directed-graphs`); Dwyer IPSep-CoLa (`dwyer-ipsep-cola`) + cluster containment (`research-thread-constraints`); SetCoLa (`forward-10-1111-cgf-13440`); Moody Physics of Notations (`doi-10-1109-tse-2009-67`); STRATISFIMAL (`stratisfimal-layout`).

Likely-MISSING / not confirmed in corpus (worth harvesting):

1. **Kieffer, Dwyer, Marriott & Wybrow 2016, "HOLA: Human-like Orthogonal Network Layout," IEEE TVCG 22(1):349-358, DOI 10.1109/TVCG.2015.2467451.** Query returned ARCOL/data-flow-ports, not HOLA — **appears ABSENT.** Directly relevant: encodes _human_ layout conventions (orthogonal, port-like, symmetry) as an objective — the strongest single reference for "what humans draw" for infra-style networks. HIGH priority to add.
2. **Purchase 1997/2000, "Which aesthetic has the greatest effect on human understanding?" (GD'97, LNCS 1353).** The GD'97 paper IS the "Validating…" doc (`s2-10-1007-bfb0021827`) — present under a different title. No action.
3. **Bennett, Ryall, Spalteholz & Gooch 2007, "The Aesthetics of Graph Visualization" (Computational Aesthetics).** Survey ranking aesthetics — not seen in queries; verify absence.
4. **Ware & Bobrow / Holten & van Wijk 2009 "Force-Directed Edge Bundling…" perception work.** Edge bundling for readability under many long edges (strata's DLQ fan-out) — bundling papers present but the perception-eval one not confirmed.
5. **Petre 1995, "Why looking isn't always seeing: readership skills and graphical programming" (CACM).** Foundational _secondary-notation_ empirical paper (spatial layout carries meaning) — underpins §3's "container spread is informative" claim more directly than Moody. Not in corpus (Moody `tse-2009-67` present as proxy). Verify absence.
6. **Marriott, Purchase, Wybrow & Goncu 2012, "Memorability of Visual Features in Network Diagrams" (`doi-10-1109-tvcg-2012-245`, PRESENT).** Not missing — noted for completeness (recall/memory angle on layout).
