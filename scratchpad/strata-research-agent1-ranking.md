# Strata research — Agent 1: RANK / LAYER ASSIGNMENT

Charter: is strata's rank-assignment pathology (P1/P3/P4) EXPECTED, what does the literature say about longest-path vs network-simplex vs Coffman–Graham vs promotion, is there a literature-sound way to keep the height benefit without the edge-length blowup, and 2–3 robust cited fixes. All claims tie to the graph-layout-rag corpus (doc_ids) or primary PDFs. Adversarial self-critique at the end.

**Axis note (load-bearing):** strata is a _transposed_ Sugiyama — the LAYER axis is X (columns), within-layer is Y. "Compact height by spreading columns" = push nodes onto MORE layers so fewer siblings share a Y-band. So everything the literature says about the _width_ of a layering maps to strata's _height_, and everything about _number of layers / edge length along the layer axis_ maps to strata's _horizontal spread_. rankSeparate is a **layering-stage** lever being used to buy a **within-layer (Y)** benefit — keep that mismatch in view.

---

## Answer 1 — Is the pathology EXPECTED?

**Verdict: split.** The _class_ of problem (longest-path trades short edges for height/width) is a documented, textbook pathology. But strata's _specific_ symptom — a degree-1 DLQ sink landing +7/+9 columns past its only source (P1), a 9-node pure-sink account +14 columns (P4) — is **NOT** what plain longest-path does. Ground truth confirms it: the pure longest-path floor puts each DLQ at `source_rank + 1` (crystallization doc, "base" column). The +9 comes entirely from `rankSeparate` injecting **all-to-all sibling-separation edges into the layering DAG**. That is an _off-label_ use of the layer axis that no layering paper in the corpus sanctions.

**What the literature actually says each ranker optimizes:**

- **Longest-path** (Gansner TSE93 §2.3 `init_rank`; handbook-hierarchical §13.3.2, `handbook-hierarchical` cited×37978). Verbatim from Gansner's `init_rank`: _"viewing the graph as a poset and assigning the minimal elements to rank 0. These nodes are removed... the new set of minimal elements are assigned rank 1, etc."_ → O(V+E), **minimizes the number of layers = minimum height (min layer-axis extent)**. Documented drawback: it says nothing about edge length or balance, so it produces **excessive width and long edges** — the handbook and the Kiel minimum-width work (`kiel-minimum-width-layering`, `openalex-10-21941-bii-1701`, Nikolov–Tarassov–Branke 2005) treat "longest-path is minimum-height but its width is uncontrolled" as the motivating pathology for an entire research thread. The as-late-as-possible dual of longest-path is precisely what _piles sinks into the last layer_ — this IS a documented stranding pathology, but strata's `computeStrataSeparatedFloor` is not even doing that; it's doing longest-path over `leafEdges ∪ sepEdges`.

- **Network simplex** (Gansner TSE93 §2.2–2.3, `gansner-tse93` cited×675; restated in `graphviz-overview-short` EGKNW03, `handbook-hierarchical`). Objective, verbatim: _"it is desirable to find an optimal node ranking, i.e., one for which the sum of all the weighted edge lengths is minimal,"_ i.e.

  ```
  min  Σ_(v,w)∈E  ω(v,w)·(λ(w) − λ(v))
  s.t. λ(w) − λ(v) ≥ δ(v,w)   ∀ (v,w) ∈ E
  ```

  Crucially NS's _own_ feasible-tree init is longest-path; NS then runs cut-value exchanges (`leave_edge`/`enter_edge`) that **lengthen tree edges with negative cut value until edges become tight**, i.e. it actively _shortens_ weighted edge length relative to longest-path. **This is exactly the machinery that prevents sink stranding by construction** — see Answer 2.

- **Coffman–Graham** (handbook-hierarchical §"The Coffman–Graham Algorithm"; original Coffman & Graham 1972). Assigns layers bottom-up keeping ≤ W nodes per layer → **bounds width (bounds strata's per-column count / Y-band load)** at the cost of MORE layers (more horizontal spread) and, per handbook, _"a large amount of dummy [nodes]"_. It optimizes width, not edge length.

- **Promotion-based layering** (Nikolov & Tarassov, _Graph layering by promotion of nodes_, DAM 2005, `elk-10-1016-j-dam-2005-05-023` cited×23; Tarassov–Nikolov– Branke GD2004 `forward-10-1007-978-3-540-24838-5-42`). Starts from a longest-path layering and **promotes** nodes upward to reduce the number of dummy nodes / width without increasing height — a post-hoc width fix that optimizes dummy-count, not edge length.

**Bottom line:** the _edge-length blowup_ strata suffers is the textbook consequence Gansner's objective (`min Σ ω·length`) was written to prevent, and strata is running the one ranker (longest-path) that ignores that objective — _then making it worse_ by adding separation constraints to the layer axis. So the pathology is "expected" only in the weak sense that using length-blind layering + metric separation-as-layering is known to be the wrong tool.

---

## Answer 2 — How the standard rankers avoid P1/P4 by construction

**Network simplex (the standard, `gansner-tse93`).** A degree-1 sink `s` with its single in-edge `(u→s)` contributes exactly `ω(u,s)·(λ(s) − λ(u))` to the objective. Minimizing drives `λ(s) → λ(u) + δ(u,s)`, i.e. **the sink sits one layer past its source — the P1/P4 symptom cannot occur in an optimal ranking.** The `balance()` step (TSE93 Fig-2-1 line 8) additionally spreads nodes with equal in/out weight to the _least-crowded feasible rank_ "to reduce crowding and improve aspect ratio... does not change the cost" — i.e. it gives _some_ of the height/aspect benefit strata chases via rankSeparate, but only among cost-neutral moves, so it never lengthens a real edge. Tradeoff vs longest-path: NS uses ~more iterations (empirically few, "runs quickly"; not proven polynomial) and yields **more layers than the minimum** (worse height/horizontal-extent) in exchange for short edges. This is the direct, generic cure for P1/P3/P4.

**Coffman–Graham.** Bounds per-layer width ≤ W. For strata this directly caps the "13-member fat column" that P1/P2 pile into (rank 15). Tradeoff: adds layers (horizontal spread grows) and many dummy nodes → more bends. Avoids _fan-in crowding_ (P2) by construction, but does not by itself pull a lone sink tight.

**Min-dummy / tight-tree feasible ranking** (Gansner `feasible_tree`/`tight_tree`, Fig-2-2). A _tight_ tree makes every tree edge slack-0; the feasible ranking it induces already places leaves tight. Gansner even notes _"leaf nodes... may be ignored, since the rank of a leaf is trivially determined in an optimal ranking"_ — the paper explicitly calls out that **leaf/sink ranks are trivial in an optimal ranking**, which is exactly the class of node strata mis-ranks. This is the cheapest partial fix (Answer 4, Fix B).

**Promotion.** Optimizes width/dummy-count, not sink placement; would help P2's fat column but not P1/P4's stranded sinks. Weakest match to strata's symptoms.

Quantified tradeoff table:

| Ranker | Optimizes | Height (layers/X-extent) | Width (per-layer/Y-load) | Edge length | Sink stranding | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Longest-path | # layers (min height) | **min** | uncontrolled (can be huge) | uncontrolled (long) | ALAP dual strands; ASAP does not | O(V+E) |
| **Network simplex** | Σ ω·length | slightly > min | moderate (balance step) | **min weighted** | **impossible in optimum** | ~few simplex iters |
| Coffman–Graham | width ≤ W | grows | **bounded W** | uncontrolled + dummies | not addressed | O(V²) |
| Promotion | dummy count / width | ≈ preserved | reduced | reduced (fewer dummies) | not addressed | poly, iterative |
| rankSeparate (strata) | height via separation | **min (goal)** | traded for X-inflation | **blown up (P1/P3/P4)** | **caused** | longest-path |

---

## Answer 3 — Keep the height benefit WITHOUT the edge-length blowup

**Does the literature put "separation" at the layering stage? Essentially no.** Across the corpus, separation constraints live at **coordinate assignment**, not layer assignment:

- **Brandes–Köpf, _Fast and Simple Horizontal Coordinate Assignment_, GD 2001** (`elk-10-1007-3-540-45848-4-3`; erratum `s2-6117d268d7f980d8685b6f89f82113eab96dd874`, Brandes–Walter–Zink 2020). Minimum node separation within a layer is enforced by **block alignment in the coordinate solve**, after layering and ordering are fixed. Separation is a _coordinate_ concern, by design.
- **Dwyer, Koren, Marriott, _IPSep-CoLa_, TVCG 2006** (`dwyer-ipsep-cola` cited×104). Arbitrary **separation constraints** ("keep this pair ≥ g apart on the Y axis," "these siblings must not overlap") are solved _inside_ a stress-majorization coordinate optimisation — a gradient-projection over continuous coordinates. This is the canonical "separation without distorting the discrete structure" result. Its directed variant **Dig-CoLa** (`openalex-10-1109-infvis-2005-1532130`, Dwyer–Koren 2005) shows you can even keep the _hierarchy_ (layer) signal as a soft constraint while separation stays continuous.
- **Size-/port-aware coordinate assignment** (`doi-10-1007-978-3-319-27261-0-12`) and the **ELK Layered** reference (`elk-layered-algorithm-reference`) both place node-size/spacing handling in the coordinate/compaction phase, never in layer assignment.

So the height benefit strata wants — _spread sibling leaves so fewer collide in a Y-band_ — is, in every canonical treatment, a **Y-coordinate / within-layer ordering** problem, not a layer-index problem. Injecting it into the layering DAG (rankSeparate) is the category error that produces the L1 edge-length blowup.

**Three literature-sound ways to keep the benefit:**

1. **Move separation to Y-coordinate assignment.** Rank with NS (short edges); then enforce sibling separation as **Brandes–Köpf min-separation** or, more flexibly, **IPSep-CoLa separation constraints** in the packer/coordinate stage. The height compaction is bought where it belongs (continuous Y), and edge length is not disturbed. Strata already has a bespoke `dropY` skyline packer — this is where a separation/no-overlap constraint should live, not in the rank DAG.
2. **Separation as SOFT weights in NS, not hard layering edges.** If separation must stay in ranking, express it as low-ω edges in Gansner's `min Σ ω·length` so that _real_ edges (high ω) dominate and a separation preference can never push a degree-1 sink 9 columns right (it would cost `ω_real·9`). This is the standard "priority via edge weight" idiom (Gansner TSE93 uses ω=1/2/8 for inter-cluster/normal/intra-cluster edges precisely to trade importance).
3. **Bound the Y-band load with Coffman–Graham width W** instead of all-to-all separation: cap per-column occupancy → fewer siblings share a band → the same height benefit, achieved by a width bound rather than by lengthening edges.

---

## Answer 4 — Ranked robust fixes

### FIX A (most robust) — Network-simplex ranking + relocate separation to Y

Replace `computeStrataSeparatedFloor` as the _floor_ with Gansner network-simplex (`min Σ ω·(λ(w)−λ(v))`, `gansner-tse93`), and move sibling-separation to the Y-coordinate/packing stage as Brandes–Köpf min-separation or IPSep-CoLa constraints (`elk-10-1007-3-540-45848-4-3`, `dwyer-ipsep-cola`).

- **Maps to:** P1 (DLQ pulled tight to source+1 by min-length), P3 (region sinks no longer inflated right), P4 (pure-sink account can't be over-ranked — leaf ranks are trivial in an optimum, TSE93).
- **Robust vs edge-case:** ROBUST/GENERIC. It's the reference Sugiyama ranker; behaviour is monotone in graph size and independent of the DLQ-specific topology. Scales to 100s of nodes (dot ships it for far larger).
- **Fits strata / replaces rankSeparate:** the Gansner NS ranker is **already wired and reachable inside strata's own rank pipeline** behind a dedicated, end-to-end-plumbed flag `strataNetworkSimplexRank` (see CODE RESOLUTION below). So the **ranker swap is a config flip** — set `strataNetworkSimplexRank: true`
  - `strataRankSeparate: false` (mutually exclusive; rankSeparate wins if both) — **not a net-new build**. The **net-new** part is only Fix A's _second half_: relocating the separation/height objective to the Y-coordinate/packing stage, which no separation-constrained packer currently implements.

### FIX B (cheapest, targeted) — Post-ranking tight-tree leaf pull

Keep the current floor but add a **degree-1 / leaf pull-tight pass**: any leaf or degree-1 sink is reassigned to `source_rank + δ` (the tight-tree feasible ranking, Gansner `feasible_tree`/`tight_tree`, TSE93 Fig-2-2; TSE93 explicitly: _"the rank of a leaf is trivially determined in an optimal ranking"_).

- **Maps to:** P1 and P4 directly (both are degree-1 / pure-sink stranding). Does NOT fix P2 (fan-in ordering) or P3 (multi-edge region sinks).
- **Robust vs edge-case:** SEMI-ROBUST. Principled (it's a slice of NS's optimality condition) but only covers the leaf/degree-1 subclass; a degree-2 sink still mis-ranks. It is a targeted guard, not a general cure — honest about that.
- **Fits strata / replaces rankSeparate:** **fits without replacing** rankSeparate — runs as a corrective pass after `computeStrataSeparatedFloor`. Lowest blast-radius; good first ship if ripping out rankSeparate is too disruptive.

### FIX C — Coffman–Graham bounded-width layering

Replace the all-to-all separation with a **width bound W** on per-column occupancy (Coffman–Graham, handbook-hierarchical; original Coffman–Graham 1972).

- **Maps to:** P2 (fat rank-15 column capped) and indirectly P1/P4 (a bounded column can't absorb a stranded sink).
- **Robust vs edge-case:** ROBUST for the _width/height_ goal, but it does not minimise edge length, so it can still leave long edges (mitigated by dummies) and adds bends. Choosing W is a tuning knob.
- **Fits strata / replaces rankSeparate:** **requires replacing rankSeparate**; more invasive than A because NS is already present and CG is not.

**Ranking: A > B > C.** A is the generic root-cause fix and reuses existing NS; B is the low-risk targeted patch; C solves the width goal but not the length goal.

---

## CODE RESOLUTION — does NS-rank already run on strata? (vs Agent 4)

Traced in source (not inferred). Both my original phrasing and Agent 4's reading were partly wrong; the precise truth:

**1. Strata, rankSeparate OFF — what assigns ranks?** By default, **plain longest-path floor**, NOT network-simplex. `rankStrataClusters` (`terraformPipelineStrataRank.ts`) computes `longestPathFloor` at L99, sets `rank = floorRank` at L105, and the branch at **L159–160** (`else if (!opts.networkSimplexRank) { nsSkipReason = "flag-off" }`) leaves the plain longest-path floor in place. NS (`computeNetworkSimplexDepths`, L162) runs **only in the L161 `else` branch — i.e. only when `networkSimplexRank === true` AND rankSeparate is off**. So my sentence "NS is the path that runs when rankSeparate is off" was **WRONG** — the default-when-rankSeparate-off path is longest-path; NS is a _second, independently-gated_ option.

**2. Is an NS-rank step actually WIRED and REACHABLE inside strata's own ranking?** **YES.** Strata has its **own dedicated flag** `strataNetworkSimplexRank` (`terraformPipelineStrata.ts` L36, L229–235) → `engineOptions.networkSimplexRank` (L329) → `rankStrataClusters({ networkSimplexRank, ... })` (L387) → the real Gansner min-weighted-span kernel `computeNetworkSimplexDepths` (`terraformPipelineLayoutShared.ts` L766: _"feasible tight tree → cut values → entering/leaving pivots to the EXACT optimum … Σ w·span"_, cited to Gansner TSE93) at rank.ts L162. It is a **shared** kernel, **not rcll-only**. It is plumbed end-to-end on the real app path: sceneContext (`terraformLayoutCore.ts` L608), import session (`terraformImportSession.ts` L72), share URL (`terraformCanvasShareUrl.ts` L88), and a demo URL param `strataNsRank` (`terraformDemoUrlParams.ts` L964) — a genuine user-facing toggle, not harness-only.

**Where Agent 4 was right / wrong.** Agent 4 correctly saw (a) the RCLL wiring `networkSimplexRank: columnPacking === "shorten"` (`terraformLayoutCore.ts` L554), which feeds the _RCLL_ builder, and (b) the suppression when rankSeparate is live (`rank-floor-conflict-rankseparate-wins-network-simplex`, emitted at strata.ts L232–239 and mirrored in toggleGuards.ts L103–104). But concluding "NS-rank is RCLL-only and inert on strata" is **wrong**: strata has a _separate, parallel_ flag (`strataNetworkSimplexRank`) that reaches the _same shared Gansner kernel_ through strata's own ranker. The suppression only fires when **both** rankSeparate and NS are requested (rankSeparate wins); it does not make NS unreachable — it makes NS and rankSeparate mutually exclusive.

**3. Net verdict.** "NS-rank already runs on strata when rankSeparate is off" = **FALSE** (default is plain longest-path, no NS). "Using NS-rank on strata is a net-new build" = **ALSO FALSE**. The ranker is fully wired and reachable behind `strataNetworkSimplexRank`; enabling it is a **config flip** (`strataNetworkSimplexRank: true` + `strataRankSeparate: false`). Only the **height-recovery half** of Fix A (separation → Y-coordinate/packing) is net-new. So P1/P4 can be tested against the real Gansner ranker on strata _today_ by flipping two flags — no code required to try it.

---

## SELF-ADVERSARIAL — gaps & weaknesses in my own findings

- **The hardest hole: I'm assuming the height benefit survives relocation.** rankSeparate demonstrably buys −42% height by column-spreading. FIX A asserts the packer can recover that via Y-separation constraints, but I have NOT proven the packer's `dropY` skyline can express IPSep-style constraints, nor that the recovered height matches. It's plausible (IPSep-CoLa is literally "separation in the coordinate solve") but **unverified against strata's actual packer**. This could be the difference between "clean fix" and "rip out two stages." A W5b-style paired probe (NS floor + separation-constrained pack vs current) is required before believing the height number.
- **NS + hulls interaction unexamined.** Strata's DAG is a _quotient_ over sibling-units under nested hulls, and edges pierce containers. Gansner NS is for flat DAGs; the corpus's compound-layering work (Sander `sander-compound-directed-graphs`, Forster `forster-compound-crossing-gd2002`) handles nesting at _layering_ time but I did not verify NS's cut-value argument holds once containment constraints are added. My "sink pulled tight by min length" claim assumes the containment doesn't re-pin it. That assumption is load-bearing and untested.
- **rankSeparate might encode a real constraint I'm dismissing as a hack.** All-to-all sibling separation may be a proxy for a legitimate readability invariant (siblings should be visually distinguishable columns). If so, FIX A's "move it to Y" changes the _visual_ semantics, not just the mechanism. I'm treating it purely as a height lever; the owner's "height-growth OK for HULLS not RESOURCES" nuance hints the real constraint is subtler than I modelled.
- **Balance() overclaim.** I lean on NS's `balance()` to recover aspect ratio, but TSE93 restricts it to nodes with _equal in/out weight_ and cost-neutral moves — in a sink-heavy infra graph most nodes are NOT balanced, so balance() may do very little. I may be overselling the "free height" from NS.
- **Scaling caveat.** NS is empirically fast but not proven polynomial; on 100s of nodes it's fine (dot handles thousands), but strata runs it inside a packing/scoring search loop — repeated NS calls could dominate the ~20s build. Not benchmarked here.
- **FIX B leaves P2/P3.** Honest: it's a leaf patch. If the owner's top pain is the fan-in column (P2), B does nothing and the win is smaller than it looks.
- **Source now verified (see CODE RESOLUTION).** The "fits strata" claim is no longer inferred: I traced rank.ts / strata.ts / layoutShared.ts / layoutCore.ts and confirmed the Gansner NS ranker is reachable on strata via `strataNetworkSimplexRank` (config flip, not net-new). Residual risk is only the height-recovery half of Fix A, which IS net-new.

---

## MISSING PAPERS (staging for main agent; do NOT write to docs/ myself)

The corpus is **well-stocked for ranking** — Gansner TSE93 (`gansner-tse93`), handbook (`handbook-hierarchical`), Coffman–Graham (via handbook), Nikolov–Tarassov promotion (`elk-10-1016-j-dam-2005-05-023`), min-width (`kiel-minimum-width-layering`, `openalex-10-21941-bii-1701`), Brandes–Köpf (`elk-10-1007-3-540-45848-4-3` + erratum), IPSep-CoLa (`dwyer-ipsep-cola`), Dig-CoLa (`openalex-10-1109-infvis-2005-1532130`), Sander compound (`sander-compound-directed-graphs`), Eiglsperger (`jgaa-2804`), Healy–Nikolov branch-and-cut (`openalex-10-1007-3-540-36151-0-10`) are all PRESENT.

Genuinely likely-absent, ranking-relevant:

1. **Coffman, E.G. & Graham, R.L. — "Optimal scheduling for two-processor systems." Acta Informatica 1(3):200–213, 1972. DOI 10.1007/BF00288685.** The _primary source_ for Coffman–Graham layering; corpus only has it via the handbook's secondary description. Matters because FIX C rests on it and the width-bound guarantee is stated precisely only in the original. **Absent** from graph-layout-rag (no hit for the 1972 scheduling paper; only handbook mentions).

2. **Sugiyama, K., Tagawa, S., Toda, M. — "Methods for visual understanding of hierarchical system structures." IEEE T-SMC 11(2):109–125, 1981. DOI 10.1109/TSMC.1981.4308636.** The founding Sugiyama paper that defines the layering→ordering→coordinate pipeline strata instantiates. Matters as the canonical justification for _why_ separation belongs at coordinate assignment, not layering. **Appears absent** as a primary doc (referenced only indirectly). Worth confirming via `rag graph "Sugiyama Tagawa Toda 1981 hierarchical"`.

3. **Nikolov, N.S., Tarassov, A., Branke, J. — "In search for efficient heuristics for minimum-width graph layering with consideration of dummy nodes." ACM J. Experimental Algorithmics 10, 2005. DOI 10.1145/1064546.1180618.** Present as a stub (`research-thread-layer-assignment`) but as a _thread note_, not the full PDF — the quantitative width-vs-dummy tradeoffs behind FIX C's tuning are in the full text. Flag for **full-PDF harvest** (currently metadata-only in corpus).

4. **Gansner, E., North, S., Vo, K-P. — "DAG — A program that draws directed graphs." Softw. Pract. Exper. 18(11), 1988 (the "GNV2"/forthcoming balancing paper TSE93 defers global rank-balancing to).** Matters because strata's height/aspect goal is exactly the "global balancing" TSE93 says it won't cover. **Likely absent.** Low priority (largely superseded by TSE93).

---

## TIGHT SUMMARY (for return)

- **Pathology expected?** _Partly._ Longest-path being length-blind (uncontrolled width/edge-length) is a textbook pathology (Gansner TSE93 Principle A3; Kiel min-width thread). But strata's _specific_ sink stranding (+7/+9/+14 columns) is NOT plain longest-path — pure longest-path places a degree-1 sink at source+1. It's caused by `rankSeparate` putting **all-to-all metric separation into the layer axis**, which every canonical treatment (Brandes–Köpf, Dwyer IPSep-CoLa) says belongs at **coordinate assignment**, not layering. The resulting L1 blowup is exactly what Gansner's `min Σ ω·length` objective exists to prevent.
- **Single most robust fix:** **Rank with Gansner network-simplex** (`min Σ ω(v,w)(λ(w)−λ(v))`, `gansner-tse93` / TSE93 §2.2–2.3 — **already wired and reachable on strata** via the `strataNetworkSimplexRank` flag; a config flip `strataNetworkSimplexRank:true`+`strataRankSeparate:false`, NOT a net-new build, code-verified in CODE RESOLUTION) so degree-1 sinks are tight by construction, and **relocate sibling-separation to the Y-coordinate/packing stage** as Brandes–Köpf min-separation (`elk-10-1007-3-540-45848-4-3`) or IPSep-CoLa separation constraints (`dwyer-ipsep-cola`). Biggest open risk: not yet proven the packer can recover rankSeparate's −42% height via Y-constraints — needs a paired probe before committing.
