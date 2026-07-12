# RCLL Layout Engine — Research & Papers Reference Chart

_Which papers actually shaped the Recursive Compound Layered Layout (RCLL) engine, validated against in-code citations and the design doc's own status annotations._

**Headline:** ~7 papers running in code · ~7 measured-and-rejected (one built-then-superseded) · the rest justify the priority order.

## Document graph

| Relation | Link |
| --- | --- |
| Role | Aux |
| Status | Living — built vs rejected paper chart |
| Hub | [`rcll-strata-doc-index.md`](./rcll-strata-doc-index.md) |
| Parent | [`rcll-reading-list.md`](./rcll-reading-list.md); [`pipeline-rcll-layout-design.md`](./pipeline-rcll-layout-design.md) |
| Children | — |
| Sisters | [`rcll-reading-list.md`](./rcll-reading-list.md) |
| Next (agent) | Quick triage of which papers shaped code; deep reads via reading-list. |

---

## ✅ Running in the engine (verified citations in source)

| Ref | Paper | What it got me |
| --- | --- | --- |
| **R1** | Sugiyama et al. — _Methods for Visual Understanding of Hierarchical System Structures_ (1981) | The 4-phase skeleton + longest-path layering (the columns) |
| **R2** | Gansner et al. — _A Technique for Drawing Directed Graphs_ / `dot` (1993) | The network-simplex X-ranker (`columnPacking:"shorten"`) that minimizes total edge length |
| **R6** | Sander — _Layout of Compound Directed Graphs_ (1996) | Recursive container nesting + the global sibling-separation ranker (`rankSeparate`) |
| **R7** | Forster — _Crossing Reduction in Layered Compound Graphs_ (2002) | The barycenter ordering proposal feeding crossing-minimization |
| **R10** | Brandes, Köpf — _Fast & Simple Horizontal Coordinate Assignment_ (2001) | The centering/straightener — hubs centered over fan-outs; its per-column down-separation is also the actual de-overlap step |
| **R12** | Rüegg et al. — _Size- & Port-Aware Horizontal Node Coordinate Assignment_ (2015) | Made that straightener respect real card sizes |
| **—** | Rüegg et al. 2016 + Liao–Wong 1983 _(cited inline)_ | Bidirectional 1-D compaction behind `columnCompact` (pull-left into whitespace) |


---

## ⚖️ Built-then-superseded, or evaluated & rejected (with measurement)

| Ref | Paper | What it got me |
| --- | --- | --- |
| **R14** | Dwyer et al. — _Fast Node Overlap Removal_ / VPSC (2005) | A VPSC-style `separateY1D` projection **was built** for hub-centering, measured, then **superseded** by R10's down-separation. Not in the current path. |
| **R11** | Jünger, Mutzel, Spisla — _A Flow Formulation for Coordinate Assignment_ (2018) | Branch "A2" — **ruled out by measurement** (v2 was density-bound, not optimizer-bound) |
| **R3** | Nikolov et al. — _MinWidth / node promotion_ | Layering alternative; longest-path chosen instead |
| **R16** | Coffman, Graham — _Optimal Scheduling for Two-Processor Systems_ (1972) | Width-bounded-layering alternative; not chosen |
| **R17** | Dwyer et al. — _IPSep-CoLa_ (2006) | Full constraint-solver option; rejected as non-deterministic / slow |
| **R9** | Kasperowski, von Hanxleden — _Top-Down Drawings of Compound Graphs_ (2023) | Scaling-compound precedent; rejected (hides detail via zoom) |
| **R5** | Jabrayilov et al. — _Compact Layered Drawings of General Directed Graphs_ (2016) | Aspect-fixing via arc reversal; rejected (breaks hard TFD order) |

---

## 📚 Conceptual / justification (shaped priorities, not implemented as code)

| Ref | Paper | What it got me |
| --- | --- | --- |
| **R8** | Doğrusöz et al. — _CoSE_ (2004) | The "cart-on-cart" recursive-sizing _model_ (REQ-1) — conceptual precedent; code is just bbox+pad |
| **R4** | Rüegg — _Sugiyama Layouts for Prescribed Drawing Areas_ (2018) | The aspect-ratio-target idea; still an open decision |
| **R21–R25** | Purchase / Ware / Huang–Eades–Hong | Evidence that crossings ≫ bends; path-tracing — _why_ crossing-min and straightening rank where they do |
| **R28** | _Faithfulness / Cluster-Faithful Graph Drawing_ (2024) | Justifies the faithfulness acceptance gates |
| **R26 / R27 / R29** | Archambault; Wallinger (edge-bundling); orthogonal routing | Catalogued, not built |
| **R18–R20** | Reingold–Tilford / Buchheim / van der Ploeg | Parent-centering aesthetic borrowed inside packed containers |
