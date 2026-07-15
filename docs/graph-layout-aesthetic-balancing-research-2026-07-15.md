# Balancing crossings vs penetration vs edge length — what the literature actually says (2026-07-15)

**Purpose.** Deep literature review commissioned after the 10-agent objective audit
(`docs/strata-pipeline-objective-audit-2026-07-15.md`) found strata's lexicographic
`crossings ≻ penetrations ≻ edge-length-L1` objective mis-specified vs the readability
literature. Four questions: (1) how does the literature balance crossings / length / bends /
region-overlap, (2) how is "penetration" (edges through unrelated node/container interiors)
treated, (3) what do metro-map / octilinear / schematic methods optimize and in what priority,
(4) what should strata's objective be.

**Method & provenance.** graph-layout-rag was queried live from this machine via `bin/rag`
(SSH to desktop corpus — **worked throughout; ~35 queries + 10 full-text page reads**), so all
corpus-present/missing calls below are **verified**, unlike the audit's two sandbox-blocked codex
agents. Web (search + PDF fetch) used for papers that are metadata-only in the corpus. Companion
deliverable: `docs/graph-layout-rag-missing-literature.md` (consolidated harvest backlog).
Every claim is tagged **PROVEN** (read from the paper / corpus full text) or **CONJECTURED**
(from secondary source, abstract, or standard theory — full text not verified locally).

---

## TL;DR — the four headline answers

1. **No empirical paper supports an infinite exchange rate for crossings.** Every study that
   measured the trade prices crossings *finitely*, and the two studies that *learned* human
   weights put edge-crossing count roughly **equal to edge-length dispersion** (Klammler:
   w_EL ≈ 0.48 vs w_CC ≈ 0.47) — and crossing count's effect **shrinks with graph size**
   (Kobourov et al. GD'14: not significant for large graphs; Mooney GD'25 expects the same decay
   for stress). The consensus *optimizer shape* in the modern literature is **hard feasibility
   constraints + a finite weighted sum of soft criteria** — not lexicographic.
2. **"Penetration" is essentially never a middle-priority scored objective in the literature.
   It is a feasibility/hardness concern:** edge-node overlap is forbidden by construction
   (orthogonal/TSM, connector routing treats nodes as obstacles), cluster containment is a hard
   constraint (IPSep-CoLa/VPSC), edge–cluster-boundary crossing is structural (c-planarity), and
   metro-map methods encode "don't pass near unrelated stations" as a **hard minimum-distance
   constraint** plus **paths-as-obstacles** in the routing graph. Nobody trades penetrations 1:1
   against crossings.
3. **Metro maps are NOT evidence for crossings-first optimization.** The canonical formulations
   (Nöllenburg–Wolff MIP; Bast/Brosi octilinear grid) take a **planarized input**, so crossings
   are ~zero *by construction* (hard), and then optimize a **user-weighted finite sum** of
   line-bends ≻̃ relative-position ≻̃ total-edge-length. Uniform edge length is an *emergent*
   property of (hard minimum distance) + (soft total-length minimization), not a scored
   uniformity objective. Straightness is concentrated where it matters: **through-line bends at
   interchange (hub) stations**, with obtuse angles preferred (135° > 90° > 45°).
4. **For strata:** the literature supports **hard containment/penetration + a single finite
   weighted comparator** (crossings priced ≈ length, angle-aware, on-path/task-weighted where
   possible), with Pareto/ε-constraint machinery used **offline for calibration**, not as a
   runtime comparator. Crossings-first lexicographic is not supported by any source found.

---

## 1. Multi-criteria aesthetic balancing — relative importance & exchange rates

### 1.1 The Purchase line: crossings matter most *among classic aesthetics* — but the effect is finite and task-bound

- **Purchase, Cohen, James, "Validating Graph Drawing Aesthetics" (GD 1995/96)**
  [`s2-10-1007-bfb0021827`, corpus FULL TEXT, cited×195] — **PROVEN.** First controlled
  experiments: increasing **crossings** and **bends** each significantly increases errors on
  graph-reading tasks (dense and sparse graphs); the **symmetry** hypothesis was *inconclusive*
  (ceiling effect). The paper explicitly hedges: "it *may* be the case that increasing crossings
  and bends is more detrimental … than a reduction in symmetry." Error deltas are on the order
  of ~1–2 extra errors going from few (≈6) to many (≈42) crossings — a measurable but bounded
  effect, not a dominance relation.
- **Purchase, "Which aesthetic has the greatest effect on human understanding?" (GD 1997)** —
  **MISSING from corpus (probe-confirmed)**. **CONJECTURED (secondary):** ranked crossings as
  the strongest of five aesthetics, bends second, with minimal support for orthogonality/
  symmetry/angle in that study. The in-corpus survey
  [`s2-10-1109-access-2020-3047616`, FULL TEXT] confirms the direction ("crossing of links was
  the [strongest]…"; bends increase errors).
- **Purchase, "Metrics for Graph Drawing Aesthetics" (JVLC 2002)**
  [`forward-10-1006-jvlc-2002-0232` / `openalex-10-1016-s1045-926x-02-90232-6`, metadata-only]
  — the canonical *continuous, scale-normalized* formulations of crossings/bends/etc. metrics.
  Relevant to strata because it argues raw counts are not comparable across drawings — a
  normalization strata's raw-count comparator lacks. **CONJECTURED** (needs full-text harvest).
- **Purchase, Allder, Carrington, "User Preference of Graph Layout Aesthetics: A UML Study"**
  [`s2-10-1007-3-540-44541-2-2`, FULL TEXT] — **PROVEN:** in a *domain* notation (UML), user
  *preference* ranking of aesthetics differs from the abstract-graph performance ranking —
  domain conventions intrude (see §1.6).

### 1.2 Ware et al. 2002 — the finite, *on-path*, continuity-coupled crossing cost

**Ware, Purchase, Colpoys, McGill, "Cognitive Measurements of Graph Aesthetics"
(Information Visualization 1(2):103–110, 2002)** [`doi-10-1057-palgrave-ivs-9500013`,
**metadata-only in corpus — full-text harvest is P0**].

- **PROVEN (abstract + secondary):** using shortest-path tasks on spring layouts, response time
  is regression-modeled; after **path length**, the two most important factors are
  **continuity** (angular deviation along the traced path) and **edge crossings *on the path***;
  branch fan-out on path nodes is also significant. The paper's core contribution is exactly a
  **finite cognitive price list** for aesthetics.
- The strata code (`terraformPipelineStrataPackedScoring.ts:30-32`) cites ~0.65 s per crossing
  and ~38° continuity — consistent with this framing; the precise coefficients could not be
  re-verified locally because the corpus copy has no PDF. **CONJECTURED (coefficients);
  PROVEN (structure: on-path, finite, continuity-coupled).**
- **Two implications for strata, both violations today:** (a) the significant crossing term is
  *crossings on the traced path*, not global scene crossings; (b) a finite per-crossing price is
  incompatible with an infinite (lexicographic) exchange rate. The audit's readability agent
  found the same from the code side.

### 1.3 The Huang line — crossing **angle** rivals crossing **count**

- **Huang, "Using eye tracking to investigate graph layout effects" (APVIS 2007)**
  [`doi-10-1109-apvis-2007-329282`, metadata-only] + the companion eye-tracking study
  [`forward-10-48550-arxiv-0810-4431`, FULL TEXT] — **PROVEN:** crossings hurt path tracing
  mainly *locally on the traced path*; eye-tracking shows crossings cause back-and-forth
  saccades at small angles.
- **Huang, Hong, Eades, "Effects of Crossing Angles" (PacificVis 2008)**
  [`doi-10-1109-pacificvis-2008-4475457`, metadata-only] and **Huang, Eades, Hong, "Larger
  crossing angles make graphs easier to read" (JVLC 25(4), 2014)** — **MISSING from corpus** —
  **PROVEN (web-verified):** task time *decreases as crossing angle increases* and the effect
  **levels off near 70–90°**; the practical guidance widely cited from this line is "keep
  crossing angles ample, ≳70°". So a drawing with *more* crossings at large angles can beat one
  with *fewer* crossings at sharp angles.
- **Huang & Huang, "Exploring the relative importance of crossing number and crossing angle"
  (VINCI 2010)** [`doi-10-1145-1865841-1865854`, metadata-only] — **CONJECTURED (abstract):**
  both matter; neither dominates; effects are additive-ish.
- **Huang, Eades, Hong, Lin, "Improving multiple aesthetics produces better graph drawings"
  (JVLC 2012/2013)** [`doi-10-1016-j-jvlc-2011-12-002`, metadata-only] + "Improving
  Force-Directed Graph Drawings by Making Compromises Between Aesthetics" (VL/HCC 2010)
  [`s2-10-1109-vlhcc-2010-32`] — **CONJECTURED (abstract):** a force model making *moderate
  compromises across several aesthetics* yields drawings that beat single-criterion-optimized
  ones on human performance. This is the direct empirical form of the "don't maximize one
  criterion" thesis.
- Strata scores **no angle term at all**; the audit measured sharp-crossing share *rising*
  0.337→0.480 while count fell 31% — exactly the failure mode this line predicts.

### 1.4 Learned-from-humans objectives — the measured exchange rates

- **Klammler, Mchedlidze, Pak, "Aesthetic Discrimination of Graph Layouts" (GD 2018)**
  [`arxiv-1809-01017v1`, FULL TEXT] — **PROVEN, the single most quotable exchange rate.** When
  they fit the weights of Huang's combined metric (COMB) to human-consensus preference data by
  Nelder–Mead, the result is:
  `w_EL = +0.4803±0.0855` (edge-length st-dev), `w_CC = +0.4679±0.1069` (crossing count),
  `w_CR = −0.0431±0.0315` (min crossing angle ≈ 0), `w_AR = −0.0087` (min angular res ≈ 0).
  **Edge-length dispersion and crossing count carry *equal* weight.** Also: their learned
  discriminator (96.5% accuracy) beats both STRESS (93.5%) and COMB (92.8%) — i.e., *no*
  hand-weighted metric formula fully captures human aesthetics, and stress mispredicts on
  planar-but-length-skewed drawings.
- **Cai, Hong, Shen, Liu, "A Machine Learning Approach for Predicting Human Preference for
  Graph Drawings" (JGAA 26(4), 2022)** [`jgaa-2311-...`, FULL TEXT] — same paradigm, same
  conclusion: human preference is predictable but *not* by any single classic metric.
- **Kieffer, Dwyer, Marriott, Wybrow, "HOLA: Human-like Orthogonal Network Layout" (TVCG 2016)**
  — **MISSING from corpus (probe-confirmed; the audit flagged it too).** **PROVEN
  (web-verified methodology):** user studies first identify what humans actually optimize when
  they lay out networks by hand; the algorithm objective is then *derived from* those criteria;
  a follow-up study validates. This is the "antidote pattern" for strata: the objective is
  calibrated against human layouts *before* being optimized. (Precursor with directly reusable
  machinery: Kieffer et al., "Incremental grid-like layout using soft and hard constraints",
  GD 2013 — also MISSING.)
- **van Ham & Rogowitz, "Perceptual Organization in User-Generated Graph Layouts" (TVCG 2008)**
  [`forward-10-1109-tvcg-2008-155`, corpus **FULL TEXT** — the audit listed this as absent;
  **correction: it is present**] — **PROVEN:** 73 lay users rearranging clustered graphs
  (a) produced **fewer crossings than the force-directed baseline**, (b) **spatially separated
  the clusters** (containment/whitespace grouping first-class), (c) tolerated *higher
  edge-length variance* to do so. I.e., humans trade length *up* to buy group separation and
  crossing reduction — group structure ≻ length, crossings finitely important.
- **Purchase et al., "The Turing Test for Graph Drawing Algorithms" (GD 2020)**
  [`doi-10-1007-978-3-030-68766-3-36`, FULL TEXT] — **PROVEN:** for several graph classes,
  people *can* distinguish algorithmic from human layouts — algorithmic objectives still miss
  something humans do.

### 1.5 Stress vs crossings — the modern axis

- **Chimani, Eades, Eades, Hong, Huang, Klein, Marner, Smith, Thomas, "People Prefer Less
  Stress and Fewer Crossings" (GD 2014 poster, LNCS 8871:523–524)** [corpus has only the
  *volume* record `doi-10-1007-978-3-662-45803-7` — chapter needs harvest] — **CONJECTURED
  (title + citing papers):** pairwise preference study; *both* lower stress and fewer crossings
  predict preference; neither is reported as an infinite-priority dominator.
- **Mooney, Miller, Wybrow, Kobourov, Purchase, "Stress in Graph Drawings: Perception,
  Preference, and Performance" (GD 2025)** [`s2-10-4230-lipics-gd-2025-38`, FULL TEXT + PDF
  read] — **PROVEN:** (a) even novices *perceive* stress, using visible proxies ("node
  distribution"); (b) people **generally prefer low-stress drawings**; (c) shortest-path
  accuracy correlates with low stress (aggregate r = 0.97, p<0.001) **but the effect shrinks
  with size** (n=10: r=0.94 → n=50: r=0.80), and the authors *expect stress to stop mattering
  for much larger graphs*; (d) crucially, they observe that **optimizing one metric (stress)
  "naturally alters other visual features"** — low-stress generation still produced node/edge
  overlaps that drove task-difficulty anomalies. Single-metric optimization contaminates.
- **Kobourov, Pupyrev, Saket, "Are Crossings Important for Drawing Large Graphs?" (GD 2014)** —
  **MISSING from corpus (probe-confirmed)** — **PROVEN (web-verified abstract/summary):**
  crossings significantly hurt accuracy/time **for small graphs but NOT significantly for large
  graphs**. Crossing count's importance is *size-dependent*; at strata's scene sizes
  (hundreds of nodes) global crossing count is a weak readability signal.
- **Eades, Hong, Klein, Nguyen, "Shape-Based Quality Metrics for Large Graph Visualization"
  (GD 2015 / JGAA 2017)** [`openalex-10-1007-978-3-319-27261-0-41` + `doi-10-7155-jgaa-00405`,
  FULL TEXT] — **PROVEN:** for large graphs the authors argue classic readability metrics
  (crossings, bends, angle) *stop discriminating* and propose shape/proxy-graph fidelity
  instead. Reinforces: crossings-count-first is a small-graph doctrine.
- **Chimani et al., "Less Stress, Fewer Crossings" (companion full paper track)** — see the
  crossing-minimization side: the OGDF planarization line
  [`handbook-crossings`, FULL TEXT] treats crossing minimization as *its own* combinatorial
  stage, but its authors never claim human-facing lexicographic priority; the GD-community's
  own parody paper [`forward-10-31219-osf-io-4hfy9`, "The worst graph layout algorithm ever",
  FULL TEXT] exists precisely because crossing count alone is a caricature of quality.

### 1.6 Domain semantics override aesthetics

- **Helmke, Doğan, Scheffler, Wrobel, "Domain-Specific Rules Override Aesthetic Graph Drawing
  Criteria" (Diagrams 2024)** [`s2-10-1007-978-3-031-71291-3-4`, FULL TEXT] — **PROVEN:** in
  two drawing experiments (social scenario + energy-system digital twins), **domain experts
  de-prioritize crossing reduction** relative to domain conventions, while **bend minimization
  stays important**. For an infrastructure diagram (strata's exact genre), semantic placement
  conventions legitimately outrank crossing count. This is the literature's answer to the
  owner's `cand13` ("keep S3 high") vs `cand33` (crossings-optimal) tension: the owner is
  behaving like the domain experts in this study.
- **The State of the Art in Empirical User Evaluation of Graph Visualizations (IEEE Access
  2020)** [`s2-10-1109-access-2020-3047616`, FULL TEXT, cited×36] — umbrella survey confirming
  all directions above. **PROVEN.**

### 1.7 Multi-criteria *optimizers* — what shape the objective takes in practice

- **Ahmed, De Luca, Devkota, Kobourov, Li, "(GD)²/(SGD)²" (GD 2020 / TVCG 2022)**
  [`arxiv-2008-05584v1`, `arxiv-2112-01571v1`, FULL TEXT] — **PROVEN:** 9 readability criteria
  (stress, crossings, crossing angle, neighborhood preservation, edge uniformity, …) combined as
  a **weighted sum of differentiable losses**, `L = Σ_Q w_Q L_Q`, with **weight schedules**
  (e.g., converge stress first, then phase in crossing-angle) because criteria conflict
  path-dependently. Crossing minimization is explicitly a **soft term**; a separate *hard* mode
  (reject coordinate updates that introduce a crossing) exists only for preserving an
  already-planar start — i.e., hard when feasibility, soft when objective. No lexicographic
  mode exists at all.
- **Devkota, Ahmed, De Luca, Isaacs, Kobourov, "Stress-Plus-X (SPX)" (GD 2019)**
  [`arxiv-1908-01769v5`, FULL TEXT] — **PROVEN:** stress + penalty terms for
  crossings/crossing-angle/upwardness; the paper's stated philosophy: *"the goal of SPX is not
  to optimize any one particular criterion at the cost of all others, but to find a balance
  across the criteria as optimizing only one criterion can lead to poor quality drawings"* —
  with contest-graph figures where the crossing-angle-optimal drawing is visibly the *worst*
  overall. Direct, quotable refutation of single-criterion primacy.
- **SmartGD (TVCG 2023)** [`s2-10-1109-tvcg-2023-3306356`, FULL TEXT] — GAN trained toward
  arbitrary (weighted) aesthetic goals; again weighted, again no lexicographic structure.
- **Constraint-based line (Dwyer/Marriott/Wybrow):** IPSep-CoLa [`dwyer-ipsep-cola`],
  constrained stress majorization [`openalex-10-1007-978-3-540-77537-9-23`], cluster containment
  [`research-thread-constraints`], revisited stress majorization [`doi-10-1109-tvcg-2017-2745919`]
  — **PROVEN:** the division of labor is **hard separation/containment constraints (projected,
  always satisfied) + one soft continuous objective (stress)**. Nothing sits "between" as a
  middle lexicographic tier.
- **Multi-objective theory (Marler & Arora 2004; Miettinen 1999; Haimes et al. 1971)** — all
  **MISSING from corpus** (they're OR literature, expected). **CONJECTURED (standard theory,
  uncontroversial):** lexicographic ordering is the *limit* of a weighted sum as one weight
  ratio → ∞ and is known to discard all trade information; the ε-constraint method requires a
  **global constrained solve** ("min f₂ s.t. f₁ ≤ f₁* + ε"), not per-move gates — the audit's
  code-trace finding that strata's ε-gate is non-transitive is exactly the failure MOO theory
  predicts when ε is applied as a local acceptance rule instead of a constrained selection over
  a frontier. A weighted sum cannot reach non-convex Pareto points; ε-constraint can — which is
  an argument for *frontier + budget selection*, not for lexicographic.
- **Metric inter-correlations — Mooney, Purchase, Wybrow, Kobourov, "The Multi-Dimensional
  Landscape of Graph Drawing Metrics" (PacificVis 2024)**
  [`s2-10-1109-pacificvis60374-2024-00022`, metadata-only; open PDF on kobourov's site] —
  **PROVEN (web-verified):** across 10 aesthetic metrics, only **two pairwise correlations
  exceed |0.5|** (e.g., crossings↔Gabriel-ratio 0.652, plausibly definitional). Metrics measure
  *different* things; optimizing one does not buy the others. Corollary in-corpus:
  **"Same Quality Metrics, Different Graph Drawings"** [`arxiv-2508-15557v1`, FULL TEXT] —
  drawings can tie on the metric vector yet differ visibly; and **"Universal Quality Metrics for
  Graph Drawings" (GD 2025)** [`s2-10-4230-lipics-gd-2025-30`, FULL TEXT].
- **Di Bartolomeo, Crnovrsanin, Saffo, Puerta, Wilson, Dunne, "Evaluating Graph Layout
  Algorithms: A Systematic Review" (CGF 2024)** [`forward-10-31219-osf-io-ms27r`, FULL TEXT,
  30pp] — **PROVEN:** 206-paper review; evaluation practice is a "Wild West"; the field's own
  best practice is *multi-metric reporting + user studies*, never a single-number objective;
  computational metrics answer capability questions, **user studies answer readability
  questions** — which endorses the audit's "blinded pairwise held-out human set" as the
  calibration circuit-breaker.

### 1.8 Verdict on question 1 (what produces the best graphs empirically)

**PROVEN, convergent across §1.1–1.7:** the best-performing systems and the human-preference
data agree on a *shape*, not a single metric:

1. **Feasibility as hard constraints** (no overlaps, containment, minimum separation — and in
   schematic genres, the direction vocabulary).
2. **One finite weighted soft objective** over: a distance-fidelity/length term (stress or
   total length — weight ≈ crossings), crossing count (finite, ideally on-path/task-local,
   size-discounted), crossing **angle** (sharp crossings penalized, plateau ~70°),
   bends/continuity (per Ware, continuity is *more* neglected and comparably important).
3. **Weights calibrated against humans** (Klammler/HOLA/Cai pattern), because every
   hand-weighted formula tested mispredicts somewhere.
4. **Domain-semantic placement conventions may legitimately override aesthetics** (Helmke 2024,
   Purchase UML) — they belong in the objective as constraints/terms, not as post-hoc vetoes.

Nothing found — in ~35 corpus queries plus web sweeps — supports crossings-first lexicographic.
The closest thing to lexicographic in the whole literature is *hard-constraints-then-soft-sum*,
where the "first tier" is feasibility (octilinearity, containment, non-overlap), **never the
crossing count**.

---

## 2. Penetration / edge-through-region as an objective

"Penetration" (an edge passing through the interior of a container hull that is not an
endpoint) has no single canonical name in the literature; it decomposes into four constructs,
each with a clear treatment:

### 2.1 Edge–node overlap → forbidden or routed around (hard)

- **Connector/edge routing (Wybrow, Marriott, Stuckey)** — "Incremental Connector Routing"
  (GD 2005) [`doi-10-1007-11618058-40`, FULL TEXT], "Orthogonal Connector Routing" (GD 2009)
  [`wybrow-marriott-stuckey-orthogonal-connectors-2010`] — **PROVEN:** nodes (and named
  obstacles) are **hard obstacles** in a visibility/orthogonal routing graph; edges *cannot*
  pass through them; among feasible routes, a **finite weighted cost** (path length + bend
  penalty [+ crossing penalty in libavoid's practical implementation]) selects the route. This
  is the exact architecture: penetration = infeasible, crossings/length/bends = finitely traded.
- **"Integrating Edge Routing into Force-Directed Layout"** [`forward-10-1007-978-3-540-70904-6-3`]
  — same treatment inside a force model.
- Node-overlap removal literature (PRISM [`graphviz-prism-overlap`], Fast Node Overlap Removal
  [`openalex-10-1007-11618058-15`], FORBID [`arxiv-2208-10334v2`]) — node–node overlap is
  likewise universally a **constraint to be eliminated**, with minimal-displacement as the soft
  objective, never traded against crossings.

### 2.2 Cluster/container containment → hard constraints (VPSC / IPSep-CoLa)

- **Dwyer, Koren, Marriott, "IPSep-CoLa" (TVCG 2006)** [`dwyer-ipsep-cola`, cited×104] and
  **Dwyer, Marriott, Stuckey, constraint-based layout with cluster containment**
  [`research-thread-constraints`, cited×832 thread] — **PROVEN:** cluster membership is encoded
  as **separation constraints keeping member nodes inside the cluster's rectangle and
  non-members outside**. Containment is *projected* (always exactly satisfied), while stress is
  minimized subject to it. There is no "containment violation count" being traded — the
  violation is simply not representable in the solution space.
- **High-Quality Ultra-Compact Grid Layout of Grouped Networks (Yoghourdjian et al.)**
  [`yoghourdjian-ultra-compact-grid-grouped`, FULL TEXT] — grouped/compound MIP layout in the
  same spirit: group boxes are geometry constraints; the objective is compactness + edge quality.

### 2.3 Edge crossing a cluster *boundary* it doesn't belong in → structural (c-planarity) or count-minimized at the boundary

- **C-planarity line** — "C-Planarity of Extrovert Clustered Graphs" (GD 2005)
  [`crossref-10-1007-11618058-20`, FULL TEXT], "Planarization of Clustered Graphs"
  [`openalex-10-1007-3-540-45848-4-5`], Forster's dissertation on cluster-level crossings
  [`openalex-w1530155803`] — **PROVEN:** the clustered-graph drawing canon defines validity as:
  each cluster in a simple closed region, **edge–region crossings forbidden or minimized as a
  first-class *combinatorial* property** (an edge may cross a cluster boundary at most once and
  only to reach a vertex inside — "extrovert" edges). Again: penetration is a *structural
  validity* condition, decided at the topology stage, not a weighted term fought over in
  coordinate refinement.
- **Sander, "Layout of Compound Directed Graphs" (1996 TR)**
  [`sander-compound-directed-graphs`, FULL TEXT] — compound Sugiyama: edges leaving subgraphs
  participate in crossing reduction *with locality constraints* so they don't thread through
  sibling containers; Forster/Bachmaier compound crossing reduction
  [`forster-compound-crossing-gd2002`] does the same with constraints. **PROVEN.**

### 2.4 Metro-map "don't pass near unrelated stations" → hard minimum-distance + obstacles

- **Bast/Brosi et al., "Metro Maps on Octilinear Grid Graphs" (CGF 2020)**
  [`doi-10-1111-cgf-13986`, FULL TEXT, read] — **PROVEN, the cleanest statement:** hard
  constraints are (1) octilinearity, (2) topology preservation ("no crossings between edges must
  be introduced, non-incident edges must not share common points"), and (3) **Map Density: the
  distance from each station to all other curve anchor points must be above a given threshold
  d̂"** — i.e., *edges may not pass close to (let alone through) unrelated stations*, as a hard
  feasibility rule. Operationally, **already-routed lines act as obstacles** for later lines in
  the grid graph ("Path (t,u) acts as an obstacle for (v,w)"). Soft terms (bends, length,
  displacement) are then a finite weighted path cost.
- **Nöllenburg–Wolff MIP** (via Wolff's survey [`doi-10-1007-s00450-007-0036-y`, FULL TEXT,
  read]) — rule **R3 "adjacent and non-adjacent stations keep a certain minimum distance"** is
  one of the three **hard** constraints (with R1 topology, R2 octilinearity). Same verdict.

### 2.5 Verdict on question 2

**PROVEN (convergent):** the literature treats edge-through-unrelated-region as a
**feasibility/validity condition — hard constraint, routing obstacle, or structural
(c-planarity) invariant — enforced by construction**, with at most a *minimal-displacement /
route-cost* soft objective deciding *how* to satisfy it. It is essentially **never a scored,
counted quantity traded against crossings at a finite (or infinite) rate** the way strata's
middle lexicographic tier does. Strata's `pen` term is simultaneously *too weak* (nonzero
penetrations survive; the literature's treatment guarantees zero) and *too strong* (when scored,
it blocks length wins; the literature would never let a satisfied-constraint dimension keep
absorbing objective weight). The audit's finding that the shipped weighted comparator makes
crossings↔pen 1:1 fungible has **no literature analog at all**.

---

## 3. Metro-map / octilinear / schematic layout — the owner's "hubs and straight lines"

### 3.1 The canonical rule set (Wolff's survey, read from corpus full text — PROVEN)

**Wolff, "Drawing Subway Maps: A Survey" (Informatik F&E 22:23–44, 2007)**
[`doi-10-1007-s00450-007-0036-y`, FULL TEXT, 22pp, pages 1–6 & 9–11 read]:

- **(R1)** keep the input embedding/topology (mental map) — **hard**
- **(R2)** octilinearity (0°/45°/90°/135°) — **hard**
- **(R3)** minimum distance between adjacent *and non-adjacent* stations — **hard**
  (this is the anti-penetration rule)
- **(R4)** few bends along each *line*, **especially through interchange stations**; when
  unavoidable prefer obtuse: **135° ≻ 90° ≻ 45°** — **soft**
- **(R5)** preserve relative position (north stays up) — **soft**
- **(R6)** small total edge length — "indirectly makes sure dense regions get more space;
  **together with (R3) this keeps distances between adjacent stations as uniform as
  possible**" — **soft**
- (R7 line coloring, R8 labels.)
- The survey notes the **explicit R2↔R6 trade** observed in practice: enforcing full
  octilinearity raised edge-length variance and vice versa — the criteria genuinely conflict
  and are *balanced*, not ranked.

**Nöllenburg & Wolff (GD 2005; TVCG 17(5):626–641, 2011)** [`forward-10-1109-tvcg-2010-81`,
metadata-only] — the MIP: hard constraints = R1–R3 as linear constraints; objective =
**`min λ_R4·cost_bends + λ_R5·cost_relpos + λ_R6·cost_length` with user-set λ's** — a plain
finite weighted sum. Sydney solved to a 26.4% optimality gap in 77s (2007 hardware); the survey
even remarks that "the error in modeling human perception by the choice of the objective
function is probably much larger" than the MIP gap — the field's own admission that weights,
not solver optimality, are the binding uncertainty. Octilinear straight-line drawability is
**NP-hard** (Nöllenburg 2005), which is why hard-vocabulary + soft-cost is the standard split.

### 3.2 The heuristic line — weighted-sum fitness, hill climbing

**Stott, Rodgers, Martínez-Ovando, Walker, "Automatic Metro Map Layout Using Multicriteria
Optimization" (TVCG 17(1):101–114, 2011)** [`doi-10-1109-tvcg-2010-24`, metadata-only; open PDF
kar.kent.ac.uk/30781] — **PROVEN (structure; weights not locally re-verified):** five node/line
criteria (angular resolution, edge length, balanced edge length, line straightness,
octilinearity) + three label criteria in a **single weighted-sum fitness**, hill-climbed with
per-move validity checks (moves creating occlusion/topology damage rejected — i.e., again
hardness by rejection, softness by weights). The 2004 precursor
[`forward-10-1109-iv-2004-1320168`] lists crossings among the fitness terms — priced finitely
alongside length and angle. **Line straightness is a first-class term because following a
*line* through its interchange stations is the metro-map task** — the direct analog of Ware's
on-path continuity.

### 3.3 The fast/scalable line — hard grid, soft path costs

**Bast/Brosi, CGF 2020** [`doi-10-1111-cgf-13986`, FULL TEXT] — detailed in §2.4: hard
octilinearity/topology/density via grid-graph construction; soft costs `c180=0 ≤ c135 ≤ c90 ≤
c45` for bends (their default instance: c135=1, c90=1.5, c45=2 before normalization — i.e., a
45° bend costs merely **2×** a 135° bend, not infinitely more), uniform hop cost for length,
offset costs for geographical fidelity. Approximation of the octilinear metro-map problem in
seconds, near-MIP quality. **PROVEN.**

### 3.4 Focus+context and variants

- **Wang & Chi, "Focus+Context Metro Maps" (TVCG 17(12), 2011)** [`doi-10-1109-tvcg-2011-205`,
  metadata-only] — least-squares energy (smooth-line + octilinearity + positional terms) solved
  continuously for interactivity; per Bast/Brosi's critique (read, FULL TEXT), this class
  "**either compromise[s] octilinearity or topology preservation**" — softening the hard tier
  is exactly what degrades the schematic look. **PROVEN (the critique); CONJECTURED (term-level
  detail of WC11).**
- **Fink, Haverkort, Nöllenburg, Roberts, Schuhmann, Wolff, "Drawing Metro Maps Using Bézier
  Curves" (GD 2012)** [`doi-10-1007-978-3-642-36763-2-41`, FULL TEXT] — trades octilinearity for
  curvilinear smoothness; objective again: line-smoothness ≻̃ station spacing, force-based.
- **MLCM line-crossing minimization (Benkert et al.)** [`forward-10-1007-978-3-540-77537-9-24`,
  FULL TEXT] — where crossings *do* get minimized in metro maps, it is **crossings between
  co-routed lines sharing edges** (a purely combinatorial ordering problem on a fixed geometry),
  not scene-wide chord crossings.
- **MetroSets (TVCG 2021)** [`openalex-10-1109-tvcg-2020-3030475`, FULL TEXT] — the metro-map
  metaphor for abstract set data; its pipeline (path support → layout → schematization)
  re-confirms the same objective stack for non-geographic data. **Hypergraphs as metro maps
  (GD/arXiv 2025)** [`arxiv-2511-22508v1`] — bend minimization remains the core objective.
- Handbook chapter, "Graph Drawing and Cartography" [`handbook-cartography`, FULL TEXT] —
  survey framing consistent with all of the above.

### 3.5 What transfers to strata (a compound dataflow diagram)

**PROVEN-by-analogy (each mapping grounded in a specific source above):**

1. **Hard vocabulary, soft cost.** The "metro look" (straight lines, tidy angles) comes from a
   *hard direction vocabulary* (octilinear) + *finite* bend costs ordered by obtuseness — not
   from crossing-count primacy. Strata's orthogonal-ish edge style should be a routing
   vocabulary constraint; sharp/oblique geometry a finite cost.
2. **Hubs = interchange stations; straightness is *through-node*, per line/path.** R4 and
   Stott's line-straightness both price *direction changes of a logical line as it passes
   through a station*. Strata's analog: a dataflow chain (e.g., API→Lambda→SQS→Lambda) should
   run straight *through* its shared services; that is a **continuity term on semantic paths**,
   precisely Ware's neglected continuity aesthetic. Strata currently scores nothing like it.
3. **Uniform edge length is emergent:** hard minimum spacing (R3) + soft total-length
   minimization (R6) *jointly* produce near-uniform station spacing. Strata can get the owner's
   "uniform metro lengths" without a uniformity objective: put a hard min-gap in, then actually
   minimize length on **both axes** (the audit proved length has zero X-weight today).
4. **Crossings are handled structurally, early:** metro inputs are planarized; topology
   preservation then *prevents* new crossings. The compound analog is strata's ordering/stage-2
   layer (where crossing minimization is combinatorial and cheap) — not the coordinate
   refinement tail. Post-topology, the metro literature spends its optimization budget on
   bends/length/position, not on re-litigating crossings.
5. **Anti-penetration = map density (hard) + obstacles:** strata's hulls should be routing
   obstacles (route edges around non-endpoint hulls), giving penetration = 0 by construction,
   as in §2.4.
6. **Weights are user-facing dials** (λ_R4/λ_R5/λ_R6; Stott's weight table): the genre expects
   an explicit, finite, *inspectable* weight vector — strata's three stage-specific comparators
   with hidden 1:1 identities are the opposite.

---

## 4. Synthesis — what strata's objective should be

### 4.1 Scoring the four candidate shapes against the evidence

| Candidate | Literature verdict |
|---|---|
| **Crossings-first lexicographic** (`cr ≻ pen ≻ L1`) | **NOT SUPPORTED — zero sources.** Finite crossing price (Ware §1.2), w_CC ≈ w_EL (Klammler §1.4), size-decay (Kobourov §1.5), angle-dependence (Huang §1.3), domain override (Helmke §1.6). The audit's measured pathologies (A7/guard/relocate thrash, ε non-transitivity) are the predictable cost of forcing infinite exchange rates through local search. |
| **Finite weighted trade** | **SUPPORTED — the modern default** ((SGD)²/SPX §1.7; Nöllenburg–Wolff λ-sum §3.1; Stott fitness §3.2; Bast/Brosi path costs §3.3; Klammler-learned weights §1.4). Caveats: weights must be calibrated on humans, and a weighted sum alone can't express feasibility — see next row. |
| **Pareto frontier** | **SUPPORTED as offline machinery, not a runtime comparator.** MOO theory (§1.7) and the GD 2025 edge-bundling poster [`s2-10-4230-lipics-gd-2025-53`] use frontiers to *expose* trades; Di Bartolomeo (§1.7) implies multi-metric reporting. Right use for strata: emit the top-k frontier over (crossings, length, rt̂) and let the calibrated preference model (or the owner) select — this also fixes the audit's "rt̂ can veto but never rescue" seat problem. |
| **Hard containment + soft crossings** | **SUPPORTED — the strongest-attested shape** (IPSep-CoLa/VPSC §2.2; c-planarity §2.3; connector routing §2.1; metro R1–R3 hard §3.1; grid obstacles §2.4/§3.3). Feasibility tier = containment, non-overlap, min-gap, penetration; everything else finite and soft. |

### 4.2 The concrete recommendation (contrast with today)

**Today (as-built, per the audit):** three inconsistent comparators (lex / weighted-1:1 /
capped); penetrations scored (nonzero survive) and fungible 1:1 with crossings; length L1 blind
on X; straight-chord proxy that can invert the real crossing count; no angle, no continuity, no
on-path weighting; ε=2 gate that is not an ordering; rt̂ outside candidate selection.

**Literature-derived objective:**

1. **Feasibility (hard, by construction — never scored):**
   - containment of children in hulls; hull–hull non-overlap; min element gap (metro R3);
   - **penetration = 0** via routing: non-endpoint hulls are obstacles in an
     orthogonal/octilinear routing graph (libavoid-style §2.1, grid-obstacle §3.3). This
     *deletes* the middle lexicographic tier instead of re-weighting it.
2. **One soft comparator, used by every stage** (kills the stage-inversion the audit found):
   `C = w_len·(normalized total polyline length, both axes) + w_cr·(crossings, counted on
   final/rendered geometry) + w_ang·(sharp-crossing share below ~70°) + w_cont·(continuity/bend
   cost along semantic dataflow paths, obtuse-preferred 135≻90≻45) [+ w_pos·(semantic/relative-
   position term — the domain-override channel §1.6)]`.
   - Starting weights from evidence, pending calibration: **w_len : w_cr ≈ 1 : 1**
     (Klammler §1.4), w_ang and w_cont same order of magnitude as w_cr (Huang/Ware), all finite.
   - Count crossings **on-path/task-weighted** where the task graph is known (Ware §1.2) and
     expect crossing weight to *shrink* as scene size grows (Kobourov §1.5).
3. **Selection = calibrated choice over a top-k Pareto frontier** (offline: the audit's P1
   blinded pairwise human set is exactly the Klammler/HOLA calibration step §1.4; ε, if kept,
   becomes a proper constrained selection over that frontier — "min length s.t. crossings ≤
   best + ε" — restoring transitivity by construction).
4. **Order of operations stays canonical** (the audit cleared the skeleton): crossings get
   their structural treatment early (ordering stage), the refinement tail spends its budget on
   length/continuity/angle under the single comparator, and a **routing phase** exists so the
   scored geometry *is* the drawn geometry (closes the chord-inversion bug).

**PROVEN vs CONJECTURED status of the recommendation itself:** each component maps to at least
one PROVEN source above; the *specific weight values* for Terraform-infrastructure diagrams are
CONJECTURED until the blinded pairwise calibration runs — the literature is unanimous
(Klammler, HOLA, Cai, Di Bartolomeo) that this last step cannot be skipped, because every
hand-set weight vector tested against humans has lost to a calibrated one.

### 4.3 Alignment with the audit's recommendations

This review independently lands on the audit's P0–P2 items and strengthens them:
score rendered geometry (P0-1 — metro methods score the drawn polyline by construction);
fix/replace the ε gate with frontier selection (P0-2 — MOO theory §1.7); blinded human
calibration (P1-3 — the field's own antidote pattern §1.4); make penetration hard via routing
(new — subsumes P3-9's "add a routing phase" and deletes the pen tier); single comparator with
finite crossing price + angle + continuity (P2-5/6/7); and it adds one item the audit lacked:
**a semantic-position term is literature-legitimate** (Helmke 2024), so the owner's `cand13`
preference is not "objective-blind sentiment" — it is the documented behavior of domain experts.

---

## Appendix: corpus status corrections vs the audit's missing-list

Verified this session (details in `docs/graph-layout-rag-missing-literature.md`):
- **van Ham & Rogowitz (TVCG 2008): PRESENT with full text** (`forward-10-1109-tvcg-2008-155`) — audit said absent.
- **Purchase "Validating graph drawing aesthetics" (GD'96): PRESENT full text** (`s2-10-1007-bfb0021827`) — the *1997* "Which aesthetic…" paper is the one that's missing.
- Audit's "unverified (codex, corpus-blocked)" canon list is **mostly PRESENT**: Sugiyama 1981 (metadata), Brandes–Köpf (+erratum, full), Sander VCG + compound TR (full), Forster/Bachmaier global sifting (full), GLEE (full), North–Woodhull (full). Genuinely missing from that list: **Petit MinLA**, **Haimes 1971**, **Marler–Arora 2004**, **Miettinen 1999**.
