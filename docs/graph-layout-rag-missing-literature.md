# graph-layout-rag — consolidated missing-literature backlog (2026-07-15)

**What this is.** The owner's ingest backlog: every paper found relevant to the strata
objective/aesthetic-balancing question that is **not** (or not fully) in graph-layout-rag.
Consolidates and dedupes the missing-papers list from
`docs/strata-pipeline-objective-audit-2026-07-15.md` with the new findings of
`docs/graph-layout-aesthetic-balancing-research-2026-07-15.md`.

**Verification status.** `bin/rag graph` (SSH → desktop corpus) **worked throughout this
session** — every entry below was probed with at least one targeted corpus query, so
present/missing calls are **verified as of 2026-07-15** (unlike the audit's two
sandbox-blocked codex agents, whose entries are re-checked here). "Metadata-only" = the corpus
has the bibliographic record but `has_pdf=false` (verified via `rag read --json`).

**Corrections to the audit's list** (probe-verified):
- van Ham & Rogowitz TVCG 2008 — audit said absent → **PRESENT, full text** (`forward-10-1109-tvcg-2008-155`).
- Purchase GD'96 "Validating graph drawing aesthetics" — **PRESENT, full text** (`s2-10-1007-bfb0021827`); only the 1997 follow-up is missing.
- Audit's "unverified codex" canon entries mostly **PRESENT**: Sugiyama–Tagawa–Toda 1981 (`doi-10-1109-tsmc-1981-4308636`, metadata-only), Brandes–Köpf (`elk-10-1007-3-540-45848-4-3`, full + erratum), Sander VCG (`forward-10-1007-3-540-58950-3-371`, full) + compound TR (`sander-compound-directed-graphs`, full), Bachmaier et al. global k-level sifting (`jgaa-2677…`, full), Nachmanson GLEE (`forward-10-1007-978-3-540-77537-9-38`, full), North–Woodhull (`graphviz-dynadag`, full).

---

## 1. MISSING — confirmed absent (harvest these)

### A. Multi-criteria balancing / empirical aesthetics

| # | Paper | Why it matters | Where to get it |
|---|---|---|---|
| A1 | **Purchase, H.C. — "Which aesthetic has the greatest effect on human understanding?"** GD 1997, LNCS 1353, pp. 248–261. DOI 10.1007/3-540-63938-1_67 | The original aesthetic-priority ranking (crossings strongest, bends second); the paper strata's "crossings-first" instinct descends from — and it prices the effect finitely | SpringerLink; author's page (dcs.gla.ac.uk/~hcp) |
| A2 | **Kieffer, Dwyer, Marriott, Wybrow — "HOLA: Human-like Orthogonal Network Layout."** TVCG 22(1):349–358, 2016. DOI 10.1109/TVCG.2015.2467451 | Objective derived FROM human layouts (study → algorithm → validation) — the exact antidote pattern for strata's uncalibrated weights | Open PDF: marvl.infotech.monash.edu/~dwyer/papers/hola2015.pdf; code github.com/skieffer/hola |
| A3 | **Kieffer, Dwyer, Marriott, Wybrow — "Incremental grid-like layout using soft and hard constraints."** GD 2013, LNCS 8242. DOI 10.1007/978-3-319-03841-4_50 | HOLA's machinery: explicit hard-vs-soft constraint split for grid-like (metro-style) layout of node-link diagrams | SpringerLink; Monash marvl page |
| A4 | **Kobourov, Pupyrev, Saket — "Are Crossings Important for Drawing Large Graphs?"** GD 2014, LNCS 8871:234–245. DOI 10.1007/978-3-662-45803-7_20, arXiv:1408.4980 | Crossings' impact significant for small graphs, NOT significant for large — directly undercuts crossings-first at strata's scene sizes | arXiv PDF; www2.cs.arizona.edu/~kobourov/crossings.pdf |
| A5 | **Huang, Eades, Hong — "Larger crossing angles make graphs easier to read."** JVLC 25(4):452–465, 2014. DOI 10.1016/j.jvlc.2014.03.001 | The ~70° crossing-angle threshold; justifies an angle term next to (not below) the count term | ScienceDirect; preprint via ResearchGate |
| A6 | **Okoe, Jianu — "GraphUnit: Evaluating Interactive Graph Visualizations Using Crowdsourcing."** EuroVis/CGF 34(3):451–460, 2015. DOI 10.1111/cgf.12657 | Crowdsourced evaluation harness — the cheap version of the blinded pairwise preference set (audit P1-3) | Wiley; author copy engineering.virginia.edu/~rj4bg |
| A7 | **Bennett, Ryall, Spalteholz, Gooch — "The Aesthetics of Graph Visualization."** Computational Aesthetics (CAe) 2007, pp. 57–64. DOI 10.2312/COMPAESTH/COMPAESTH07/057-064 | The standard survey of aesthetic heuristics + their perceptual grounding | EG Digital Library; open PDF via cs.uvic.ca |
| A8 | **Dawson, Munzner, McGrenere — "A search-set model of path tracing in graphs."** Information Visualization 14(1), 2015. DOI 10.1177/1473871614550536 | Predictive cognitive model of path tracing — the successor to Ware 2002's task model; what an "on-path" crossing term should look like | SAGE; UBC author copy (cs.ubc.ca/labs/imager) |
| A9 | **Yoghourdjian, Yang, Dwyer, Lawrence, Wybrow, Marriott — "Scalability of network visualisation from a cognitive load perspective."** TVCG 27(2):1677–1687, 2021. DOI 10.1109/TVCG.2020.3030459 | How readability effects decay with graph size (cognitive-load framing) — sizes the crossing weight for strata-scale scenes | IEEE; Monash open copy |

### B. Multi-objective optimization theory (OR canon — expected absent from a GD corpus, but the ε/lex questions need them)

| # | Paper | Why it matters | Where to get it |
|---|---|---|---|
| B1 | **Marler, Arora — "Survey of multi-objective optimization methods for engineering."** Struct Multidisc Optim 26(6):369–395, 2004. DOI 10.1007/s00158-003-0368-6 | The standard taxonomy: weighted-sum vs lexicographic vs ε-constraint, and when each is valid — the theory strata's comparator zoo violates | SpringerLink; widely mirrored PDF |
| B2 | **Miettinen — "Nonlinear Multiobjective Optimization."** Kluwer 1999. DOI 10.1007/978-1-4615-5563-6 | Book-length treatment; proper ε-constraint (global constrained solve, not per-move gates) | Springer (book); library |
| B3 | **Haimes, Lasdon, Wismer — "On a bicriterion formulation of the problems of integrated system identification and system optimization."** IEEE Trans. SMC-1(3):296–297, 1971. DOI 10.1109/TSMC.1971.4308298 | The ε-constraint method's origin — cited when arguing strata's ε-gate is not the ε-constraint method | IEEE Xplore |
| B4 | **Petit — "Experiments on the minimum linear arrangement problem."** ACM J. Experimental Algorithmics 8 (2003), art. 2.3. DOI 10.1145/996546.996554 | MinLA = the pure edge-length-minimization baseline for 1-D orderings (strata's row-order problem is MinLA-adjacent) | ACM DL; UPC author copy (cs.upc.edu/~jpetit) |

### C. Metro-map / schematic (gaps in an otherwise strong corpus area)

| # | Paper | Why it matters | Where to get it |
|---|---|---|---|
| C1 | **Wu, Niedermann, Takahashi, Roberts, Nöllenburg — "Shape-Guided Mixed Metro Map Layout."** CGF 41(7), 2022 (PacificVis). arXiv:2208.14261 | Recent mixed-schematic method; also a compact survey of the objective stack in current metro-map work | arXiv PDF |
| C2 | **Hong, Merrick, do Nascimento — "Automatic visualisation of metro maps."** JVLC 17(3):203–224, 2006. DOI 10.1016/j.jvlc.2005.09.001 | The spring-embedder arm of the three canonical metro methods (survey compares against it); *probable-missing* — never surfaced across six metro corpus queries | ScienceDirect; USyd author copy |
| C3 | **Nöllenburg — "A Survey on Automated Metro Map Layout Methods."** Schematic Mapping Workshop 2014 (+ IEEE TVCG survey material) | Consolidated objective/priority tables across MIP vs heuristic methods — the fastest single ingest for "what do metro methods optimize" | i11www.iti.kit.edu/extra/publications/n-samml-14.pdf |

*(Metro core already present: Wolff survey full text, Bast/Brosi octilinear grid full text,
Bézier metro full text, MLCM full text, MetroSets full text, Stott/Rodgers 2004+2011 and
Nöllenburg–Wolff 2010/11 as metadata — see §2 for the full-text upgrades.)*

---

## 2. PRESENT but metadata-only — needs full-text PDF harvest

These have corpus records (`has_pdf=false` verified) — queries hit them but `rag read` can't
open them. Full-text harvest priority order:

| # | Paper | doc_id | Priority / why |
|---|---|---|---|
| M1 | **Ware, Purchase, Colpoys, McGill — "Cognitive Measurements of Graph Aesthetics."** Inf. Vis. 1(2):103–110, 2002. DOI 10.1057/palgrave.ivs.9500013 | `doi-10-1057-palgrave-ivs-9500013` | **P0** — the rt̂ source cited by name in strata code; the exact regression coefficients (the "~0.65s/crossing") can't be locally verified until this is ingested. SAGE paywall; author copy via ccom.unh.edu/vislab (Ware) |
| M2 | **Chimani, Eades, Eades, Hong, Huang, Klein, Marner, Smith, Thomas — "People Prefer Less Stress and Fewer Crossings."** GD 2014, LNCS 8871:523–524 | corpus has only the *volume* record `doi-10-1007-978-3-662-45803-7` | **P0** — the stress-vs-crossings preference poster; 2 pages. SpringerLink chapter; Osnabrück author copy |
| M3 | **Stott, Rodgers, Martínez-Ovando, Walker — "Automatic Metro Map Layout Using Multicriteria Optimization."** TVCG 17(1):101–114, 2011. DOI 10.1109/TVCG.2010.24 | `doi-10-1109-tvcg-2010-24` | **P1** — the weighted-fitness weight table (exact numbers) lives in the full text. Open PDF: kar.kent.ac.uk/30781/1/tvcgMetro.pdf (KAR fetch failed from Mac — self-signed cert; harvest from desktop) |
| M4 | **Nöllenburg, Wolff — "Drawing and Labeling High-Quality Metro Maps by Mixed-Integer Programming."** TVCG 17(5):626–641, 2011. DOI 10.1109/TVCG.2010.81 | `forward-10-1109-tvcg-2010-81` | **P1** — the canonical hard/soft MIP (λ-weighted soft sum). Author copy: i11www.iti.kit.edu |
| M5 | **Wang, Chi — "Focus+Context Metro Maps."** TVCG 17(12):2528–2535, 2011. DOI 10.1109/TVCG.2011.205 | `doi-10-1109-tvcg-2011-205` | P2 — the least-squares/soft-octilinearity arm | 
| M6 | **Huang — "Using eye tracking to investigate graph layout effects."** APVIS 2007. DOI 10.1109/APVIS.2007.329282 | `doi-10-1109-apvis-2007-329282` | P1 — on-path crossing mechanism (note: closely related eye-tracking study IS full-text as `forward-10-48550-arxiv-0810-4431`) |
| M7 | **Huang, Hong, Eades — "Effects of Crossing Angles."** PacificVis 2008. DOI 10.1109/PACIFICVIS.2008.4475457 | `doi-10-1109-pacificvis-2008-4475457` | P1 — angle-effect primary study |
| M8 | **Huang, Huang — "Exploring the relative importance of crossing number and crossing angle."** VINCI 2010. DOI 10.1145/1865841.1865854 | `doi-10-1145-1865841-1865854` | P1 — the count-vs-angle head-to-head |
| M9 | **Huang, Eades, Hong, Lin — "Improving multiple aesthetics produces better graph drawings."** JVLC 24(4):262–272, 2013. DOI 10.1016/j.jvlc.2011.12.002 | `doi-10-1016-j-jvlc-2011-12-002` | **P0** — the direct empirical "balanced compromise beats single-criterion max" result (companion VL/HCC 2010 `s2-10-1109-vlhcc-2010-32` also metadata-only) |
| M10 | **Purchase — "Metrics for Graph Drawing Aesthetics."** JVLC 13(5):501–516, 2002. DOI 10.1006/jvlc.2002.0232 | `forward-10-1006-jvlc-2002-0232` (+ dup `openalex-10-1016-s1045-926x-02-90232-6`) | P1 — scale-normalized continuous metric formulations (fixes raw-count comparability) |
| M11 | **Purchase, Carrington, Allder — "Empirical Evaluation of Aesthetics-based Graph Layout."** Empir. Softw. Eng. 7:233–255, 2002. DOI 10.1023/A:1016344215610 | `doi-10-1023-a-1016344215610` | P2 |
| M12 | **Mooney, Purchase, Wybrow, Kobourov — "The Multi-Dimensional Landscape of Graph Drawing Metrics."** PacificVis 2024. DOI 10.1109/PacificVis60374.2024.00022 | `s2-10-1109-pacificvis60374-2024-00022` | **P1** — metric inter-correlation study (only 2 pairs >|0.5|). Open PDF: www2.cs.arizona.edu/~kobourov/gd-metrics2024.pdf |
| M13 | **Sugiyama, Tagawa, Toda — "Methods for Visual Understanding of Hierarchical System Structures."** IEEE TSMC-11(2):109–125, 1981. DOI 10.1109/TSMC.1981.4308636 | `doi-10-1109-tsmc-1981-4308636` | P2 — the framework origin (pipeline canon; secondary coverage is rich in-corpus) |
| M14 | **Nöllenburg — "Automated drawing of metro maps."** Diploma thesis / KIT TR 2005. DOI 10.5445/IR/1000004123 | `forward-10-5445-ir-1000004123` | P2 — the MIP's long-form derivation + NP-hardness. Open: publikationen.bibliothek.kit.edu |
| M15 | **Stott, Rodgers — "Metro map layout using multicriteria optimization."** IV 2004. DOI 10.1109/IV.2004.1320168 | `forward-10-1109-iv-2004-1320168` | P2 — fitness-term list incl. crossings priced finitely |
| M16 | **Eades, Huang, Hong — "A Force-Directed Method for Large Crossing Angle Graph Drawing."** 2010. | `s2-d0bf424df6b633d84e29ca62d57fcd253538115a` | P2 — first algorithm to *use* crossing angle as an objective |
| M17 | **Cai, Hong et al. — sociogram/crossings JGAA record** DOI 10.7155/jgaa.00152 | `doi-10-7155-jgaa-00152` metadata; note full text exists as `jgaa-2767-...` | dedupe/link rather than harvest |

---

## 3. PRESENT with full text — on-point, use these (no action)

For orientation: the papers this review leaned on that are already fully ingested —
Purchase GD'96 validating (`s2-10-1007-bfb0021827`); eye-tracking layout-effects
(`forward-10-48550-arxiv-0810-4431`); Klammler aesthetic discrimination (`arxiv-1809-01017v1`);
Cai et al. ML preference (`jgaa-2311-...`); van Ham & Rogowitz (`forward-10-1109-tvcg-2008-155`);
Turing Test for GD (`doi-10-1007-978-3-030-68766-3-36`); (GD)²/(SGD)² (`arxiv-2008-05584v1`,
`arxiv-2112-01571v1`); SPX (`arxiv-1908-01769v5`); SmartGD (`s2-10-1109-tvcg-2023-3306356`);
shape-based metrics (`openalex-10-1007-978-3-319-27261-0-41`, `jgaa-2512-...`); Mooney
perception-of-stress (`s2-10-48550-arxiv-2409-04493`) and GD 2025 stress P/P/P
(`s2-10-4230-lipics-gd-2025-38`); Universal Quality Metrics GD 2025
(`s2-10-4230-lipics-gd-2025-30`); Same-Metrics-Different-Drawings (`arxiv-2508-15557v1`);
GdMetriX (`s2-10-4230-lipics-gd-2024-45`); Di Bartolomeo systematic review
(`forward-10-31219-osf-io-ms27r`); worst-layout-ever (`forward-10-31219-osf-io-4hfy9`);
Domain-Specific-Rules-Override (`s2-10-1007-978-3-031-71291-3-4`); empirical-evaluation SotA
survey (`s2-10-1109-access-2020-3047616`); Wolff subway survey (`doi-10-1007-s00450-007-0036-y`);
Bast/Brosi octilinear grid (`doi-10-1111-cgf-13986`); Bézier metro
(`doi-10-1007-978-3-642-36763-2-41`); MLCM (`forward-10-1007-978-3-540-77537-9-24`); MetroSets
(`openalex-10-1109-tvcg-2020-3030475`); cartography handbook chapter (`handbook-cartography`);
crossings handbook chapter (`handbook-crossings`); IPSep-CoLa (`dwyer-ipsep-cola`);
constrained stress majorization (`openalex-10-1007-978-3-540-77537-9-23`); cluster-containment
thread (`research-thread-constraints`); connector routing (`doi-10-1007-11618058-40`,
`wybrow-marriott-stuckey-orthogonal-connectors-2010`); c-planarity cluster canon
(`crossref-10-1007-11618058-20`, `openalex-10-1007-3-540-45848-4-5`); Sander compound
(`sander-compound-directed-graphs`); compound crossing reduction
(`forster-compound-crossing-gd2002`); ultra-compact grouped grid layout
(`yoghourdjian-ultra-compact-grid-grouped`).

---

## 4. Harvest notes

- The KAR (kent.ac.uk) PDF host presents a self-signed cert chain from this Mac — fetch M3 from
  the desktop or via the ResearchGate/CORE mirrors.
- `rag read` outputs nothing without `--json` (bin/rag summary path bug for `read`; workaround:
  always pass `--json`).
- Duplicate doc_id pairs observed (same paper under `doi-*`, `s2-*`, `forward-*`, `openalex-*`
  prefixes) for: Purchase Metrics 2002, Klammler (arxiv + s2), (SGD)² (arxiv + s2), Stott 2004
  (iv-2004 forward), shape-based metrics (×3), Effects-of-Sociogram (×2), Di Bartolomeo review
  (osf + cgf). A dedupe pass during the next ingest would improve `cite`-graph keying.


---

## Appendix — 13-agent readability investigation harvest (2026-07-15)


Compiled by JOINT-SYNTH from the 11 per-agent "missing from graph-layout-rag" stubs
(F-CROSS, F-PEN, F-LEN, F-ANG, F-HUB, F-LR, M-MEAS, M-OBJ, CASE-C1/C2/C3). Deduped
and grouped by theme. Sources tagged `[agent]`; "present" notes what the corpus already
has so we don't re-harvest. **P0** = load-bearing for the prescription (harvest first).

## Layering / ranking (flow axis — the X-operator's theory)
1. **Gansner, North, Vo — "GNV2" full min-cost-flow / LP optimal ranking** (the treatment TSE93 §2.2 forward-references) — corpus has only the TSE93 summary. Sharpens the height↔length bicriteria. `[F-LEN]`
2. **Eiglsperger, Siebenhaller, Kaufmann — "An Efficient Implementation of Sugiyama's Algorithm for Layered Graph Drawing"** (GD 2004) — modern NS-layering + Brandes–Köpf coordinate combo; the concrete implementation template. `[F-LEN, F-LR]`
3. **Coffman–Graham layering** primary (width-bounded layering) — the third corner of the height/width/length trilemma; needed to reason about the height-regression risk. `[F-LEN]`
4. **Petit — "Experiments on the Minimum Linear Arrangement Problem"** — canonical MinLA empirical baseline; corpus has only downstream MinLA theory. `[F-LEN]`
5. **Compound / containment-constrained ranking + x-coordinate assignment** — the real gap: hierarchically-contained (hull/cluster) rank compaction and rigid group/hull horizontal translation subject to inter-group separation + LR precedence. Pull on: ELK `RectPacking`/compound `layered` compaction, Sander compound Sugiyama, priority/network-simplex compaction with group constraints. `[F-LEN, CASE-C3]` — *present & sufficient for the flat + port-aware half:* Gansner TSE93 `gansner-tse93`, Rüegg et al. size/port-aware X-assignment `elk-10-1007-978-3-319-27261-0-12`.
6. **"Pull sinks toward sources" — barycenter / median-X on terminal rank / dot `rank=sink`** — frames the guarded left-shift for pure-sink accounts (the C3-block dead-gap). `[CASE-C3]`
7. **Interval-constrained single-vertex re-ranking that trades −1 crossing for a length increase** (bicriteria, tiny-gain regime) — the exact C1 operator; no citation located. `[CASE-C1]`

## LR / upward-drawing feasibility
8. **Sugiyama–Tagawa–Toda 1981 — "Methods for Visual Understanding of Hierarchical System Structures"** (IEEE SMC-11) — foundational LR/layered framework AND the explicit "priority = degree" ordering rule; corpus is metadata-only. `[F-LR, F-HUB]`
9. **Di Battista–Tamassia upward planarity (1988); Garg–Tamassia upward-planarity complexity (1995)** — the primary complexity results for LR-feasibility ≡ upward/monotone drawing; corpus surfaces only JGAA monotone-drawing hits. `[F-LR]`
10. **Brandes–Köpf under non-unit / shared (banded) slots** — coordinate assignment when multiple nodes share a layer-perpendicular band (strata's packed-row regime); no source found. BK itself is present (`elk-10-1007-3-540-45848-4-3` + erratum `arxiv-2008.01252`). `[F-LR]`
11. **Dataflow left-to-right convention primary** (structured-analysis / SADT / DFD / UML-activity layout norms) — the "TFD left-to-right rule" is asserted with no cited primary. `[F-LR]`

## Penetration / clustered planarity / containment
12. **Feng, Cohen, Eades 1995 — "Planar Drawing of Clustered Graphs"** (GD'95) — c-planarity origin, the hard/definitional formulation; cited, no PDF. `[F-PEN]`
13. **Sugiyama & Misue 1991 — "Visualization of structural information: automatic drawing of compound digraphs"** (IEEE SMC) — compound-layout origin; cited only. `[F-PEN]`
14. **Dwyer, Marriott, Stuckey 2006 — IPSep-CoLa / "Fast Node Overlap Removal"** — the containment-as-separation primary source; metadata stub, no extractable text. `[F-PEN]`
15. **Bouts & Speckmann 2015 — "Clustered Edge Routing"** (PacificVis) — edges routed around cluster hulls with permeable ancestor hulls = the exact routed-penetration model; repo's router cites it, corpus lacks the PDF. **P0** (the penetration-by-routing prescription rests on it). `[F-PEN]`
16. **Nöllenburg & Wolff 2011 — "Drawing and Labeling High-Quality Metro Maps by MIP"** (IEEE TVCG, `forward-10-1109-tvcg-2010-81`) — metadata-only; H1–H4 hard-constraint list + lazy-constraint tractability + the interchange-bend cost (the `thru`-continuity term template). **P0.** `[F-PEN, F-HUB]`
17. **Fulek & Tóth 2019 — "Atomic Embeddability, Clustered Planarity, and Thickenability"** (SODA) — poly-time c-planarity; absent. `[F-PEN]`
18. **Dwyer et al. 2008 — "Dunnart: A Constraint-based Network Diagram Authoring Tool"** — applied hard-constraint authoring; not in corpus. `[F-PEN]`

## Crossing angle / straightness / octilinearity
19. **Ware, Purchase, Colpoys, McGill 2002 — "Cognitive Measurements of Graph Aesthetics"** (Info Vis, `doi-10-1057-palgrave-ivs-9500013`) — **metadata-only; full text is the P0 harvest** for the on-path continuity coefficient the whole hub/straightness prescription rests on (code embeds the coefficients only). Flagged independently by F-ANG, F-HUB, M-MEAS. **P0.** `[F-ANG, F-HUB, M-MEAS]`
20. **Huang, Eades, Hong, Lin 2013/2014 — "Improving Multiple Aesthetics Produces Better Graph Drawings"** (JVLC) — the joint crossing-angle × crossings × symmetry tradeoff study; directly on-point for the angle-redundancy question. `[F-ANG]`
21. **Argyriou, Bekos, Symvonis — "Maximizing Total Resolution / RAC via SGD"** + crossing-resolution follow-ups to Huang 2008 — the quantitative response-time-vs-angle curve to pin θ\* (vs the 70° default). `[F-ANG]`
22. **Kieffer, Dwyer, Marriott, Wybrow 2016 — "HOLA: Human-like Orthogonal Network Layout"** — orthogonal-with-good-angles for hierarchical/DAG layouts (closer to the LR case than metro). `[F-ANG]`
23. **Bekos / Didimo — "Graph Drawing Beyond Planarity" survey, RAC / large-angle chapters** — the soft-vs-hard angle tractability boundary under a layered/LR skeleton. `[F-ANG]`
24. **Empirical study of octilinearity value in NON-metro (software/architecture/dependency) diagrams** — all corpus octilinear work is transit-map; whether the ~27% octilinear deficit hurts dependency-graph readability is open & un-cited. `[F-ANG]`
25. **Dawson / Ware search-set path-tracing follow-ups** — eye-tracking on tracing a path *through* nodes (branch fan-out cost at through-nodes); needed to price the `thru`-weight. `[F-HUB]`
26. **Purchase 1997 — "Which aesthetic has the greatest effect on human understanding?"** — the bends-second ranking underpinning continuity priority; missing. `[F-HUB]`
   - *Present & adequate for hub rendering:* Bach confluent (2016), Zheng power-confluent (2019), Holten FDEB (2009). Gap is placement/perception, not rendering.

## Measurement / proxy-fidelity theory
27. **Biased-but-monotone proxy metrics / surrogate-objective fidelity** — when a cheap surrogate preserves rank order vs when it sign-flips; the empirical result was measured here, corpus lacks the theory reference. `[M-MEAS]`
28. **Chord-vs-rendered / pre-vs-post-routing metric divergence as a named result** — measuring the same graph on straight chords vs its routed rendering; Mooney 2025 (per-edge-geometry distributions) is the nearest vehicle, no direct paper. `[M-MEAS, F-CROSS]`
29. **Crossing-angle ↔ crossing-count anti-correlation quantified** — Huang 2008 is qualitative eye-tracking; no metric-landscape paper co-plots the two on one corpus (Mooney's landscape work nearest). `[M-MEAS]`
30. **Size-portability of fixed exchange-rate weights (penW:crossW) under un-normalized counts** — Klammler-style weight-learning exists (`arxiv-1809-01017v1`), the normalization-sensitivity analysis does not. `[M-MEAS]`
31. **Crossing count of centre-chord proxies vs boundary-attached rendered edges** (the +18% over-count bias); **angle-weighted crossing cost validated at n≈hundreds layered/orthogonal drawings** (Huang's is small node-link); **crossings inside compound/clustered layered drawings**; **pre-refinement vs post-refinement ranking-inversion hazard** (scoring proxy geometry the compaction then re-orders — an engineering pitfall the literature doesn't name). `[F-CROSS]`

## Multi-objective-optimization / OR theory (all expected-absent from a graph-drawing corpus; harvest only if the objective rework proceeds)
32. **Haimes, Lasdon, Wismer 1971** — ε-constraint method origin (authority for "ε = constrained selection over a Pareto frontier"). `[M-OBJ]`
33. **Miettinen 1999 — *Nonlinear Multiobjective Optimization*** — lexicographic as the weight-ratio→∞ limit of weighted-sum; weighted-sum cannot reach non-convex Pareto points, ε-constraint can. `[M-OBJ]`
34. **Marler & Arora 2004 — "Survey of multi-objective optimization methods for engineering"** — weighted-sum vs lexicographic vs ε-constraint validity/normalization. `[M-OBJ]`
35. **Charnes & Cooper — goal programming (lexicographic/preemptive)** — the OR framing strata's lexicographic keys unknowingly are. `[M-OBJ]`
   - *Present & sufficient for the graph-drawing side:* Klammler `arxiv-1809-01017v1`, Ahmed `(SGD)²`, Bast/Brosi, Nöllenburg-Wolff, Dwyer/IPSep-CoLa.
