# RCLL → v2 architecture decision

| Field | Value |
| --- | --- |
| Status | Decision document — supersedes the 2026-06-20 pivot memo; reconciles the 2026-06-23 assessment report + engine spec against the literature. **Round 3 (2026-06-26) audits the question frame itself** — see below. **⟢ Round 4 (2026-06-29): the two product facts the whole gate program depended on (Q0-USE, Q0-SCAFFOLD) are now ANSWERED, and 8 build decisions are locked — see the Round 4 section below. Round-4 additions are marked as `⟢ Round-4 amendment` callouts; rounds 1–3 prose is preserved as-written.** |
| Date | 2026-06-26 (rounds 1–3) · 2026-06-29 (round 4 amendment) |
| Scope | Pipeline-view layout architecture (Terraform import) |
| Supersedes | [`pipeline-rcll-v2-pivot-recommendation.md`](./pipeline-rcll-v2-pivot-recommendation.md) (2026-06-20) |
| Companions | [`rcll-architecture-assessment-report.md`](./rcll-architecture-assessment-report.md) · [`rcll-layout-engine-spec.md`](./rcll-layout-engine-spec.md) · RFC [`pipeline-rcll-layout-design.md`](./pipeline-rcll-layout-design.md) |

## Context (why this document exists)

The RCLL (Recursive Compound Layered Layout) Terraform "pipeline view" engine was built on a first attempt, accreting design mistakes made while learning the problem — most visibly **per-container recursion that produced cross-account backward edges**. The [pivot memo](./pipeline-rcll-v2-pivot-recommendation.md) (2026-06-20) recommended abandoning the RCLL rule stack for a "hull-first" `pipelineVariant:"v2"` engine.

This document is the result of **shit-testing that memo and the whole design history** against (a) the as-built code, (b) the local `graph-layout-rag` corpus, and (c) the broader graph-drawing literature, with a Codex outside-voice pass that independently read the code. It asks the question the user posed: **is v2 the optimal implementation that solves the problems v1 messed up (especially recursion)?**

**Discovery that reframes everything:** the pivot memo (Jun 20) is the _oldest_ of the document cluster. Two newer docs already supersede much of it — the [assessment report](./rcll-architecture-assessment-report.md) (Jun 23, a chief-architect findings pass) and the [engine spec](./rcll-layout-engine-spec.md) (Jun 23, an A-vs-B decision gated on measurements). So this is a **reconciliation + correction + extension** of all three against the canon, not a fresh memo.

**Method (read-only):** read all four RCLL docs + the 2,048-line RFC + code-map + loose-leaf research; two Explore agents verified the v2 seed code and the RCLL recursion/global-rank code against the design claims; ~20 `graph-layout-rag` corpus queries; a 12-agent web-research workflow (8 architecture dimensions + 4 adversarial verifications); direct code reads to settle load-bearing facts; and a Codex outside-voice pass that **independently read the code and confirmed the central correction**.

---

## VERDICT (the headline)

**Is v2 the optimal implementation that solves everything RCLL messed up? — No, but it is the correct _backbone_, and it is the right thing to grow.** Three parts:

1. **The core primitive is settled and both engines already have it.** "Rank base/leaf nodes in ONE global frame; derive cluster spans bottom-up" (Sander 1996) is canonical, and the canonical _engines_ converged on it — **Graphviz's original recursive cluster algorithm produced backward edges and was fixed by `newrank=true` = one global rank**, exactly v2's global depth grid. RCLL _also_ already has it (`computeGlobalSeparatedFloor`, shipped). So the pivot memo's premise ("RCLL ranks each hull in an independent frame → backward edges") is **stale** — it describes a superseded round-3 state.
2. **v2 is the _cleaner embodiment_ (≈960 lines vs ≈8,743), encodes dataflow correctly, and sidesteps the cyclic-hull fight** — but it is **~30 % of a readable engine** (estimate). It deletes the two Sugiyama phases (crossing-minimization, coordinate-assignment) that 30 years of research call the _primary_ readability drivers. "Zero backward edges" is necessary, not sufficient; skyline Y-packing optimizes _area_, not _crossings_ → risk of "compact-but-tangled blocks."
3. **The right move is Option B: grow v2 into the canonical compound-layered backbone** (one global dataflow coordinate frame + recursive skyline placement), with three corrections to the existing spec — **but only after the cheap Q2/Q3/Q4 measurements give B an empirical driver.** Until then, **A stays** (it passes its gates).

> **⟢ Round-4 amendment (2026-06-29) — the gate this verdict deferred to is now resolved.** Rounds 1–3 left the engine pick "A-now / B-gated" *precisely because* the two product premises (Q0-USE, Q0-SCAFFOLD) were unknown. They are now answered: import **every PR / plan / drift**, and the scene is an **editable seed** (not a kept render). Per the Round-3 logic, that flips Q4 (stability) to the **top gate**, makes **determinism + diff-stability + identity-keyed overlay persistence** the #1 objective (ahead of crossing/width aesthetics), and resolves the contest **not** to "grow v2" but to the **false-binary collapse Round 3 flagged: refactor RCLL onto the depth-pinned `X = columnX[depth]` coordinate model** (keeping RCLL's hardened ancillary/gates/determinism while adopting v2's by-construction X). The build is specified in [`rcll-v2-foundation-spec.md`](./rcll-v2-foundation-spec.md); the 8 locked decisions are in the **Round 4** section below.

---

## Three load-bearing corrections (the shit-test results)

### CORR-1 — The pivot memo's central premise is STALE ✅

RCLL's failure was "ranking each hull interior in its own independent coordinate frame" — the **round-3** `rankSeparate` state. **Round-4 already fixed it**: `computeGlobalSeparatedFloor` (`terraformPipelineRcllRankSeparate.ts:194`) collects ALL leaves, builds one whole-model leaf DAG, runs ONE `longestPath` → **0 backward edges / −42 % height** composed with lane-rise. _Both_ engines now have the correct primitive; the real difference is the **host model** (per-container recursion vs global-first), not the primitive. (Engine spec §1; assessment report §2.2.)

### CORR-2 — v2 columns on DATAFLOW depth, not topology depth ⚠️ (corrects the assessment report, double-verified)

Assessment report §2.4 / SA-4 claims v2 "columns on **static topology depth** (provider→account→region), not on dataflow edges." **This is a misread.** Verified independently by an Explore agent AND by Codex reading the code:

- `cluster.depth` is set from `computeDepths(collapsedEdges, clusterIds)` in `preparePipelineLayout` (`terraformPipelineLayoutShared.ts:1458`), and `computeDepths` is **longest-path over the collapsed Terraform-dependency (dataflow) edges** (`terraformPipelineLayoutShared.ts:485`).
- v2 uses `columnX[cluster.depth]` for X (`terraformPipelineV2Pack.ts:103`; header `:7-11`).

So v2 **encodes dataflow direction in X** (the semantics RCLL _intends_) and gets it cheaply because the **leaf** dataflow graph is acyclic. The cyclic-hull saga that consumed RCLL rounds 1–4 **never arises in v2** because v2 ranks _leaves_, never _hulls_. This removes the assessment report's main objection to v2.

### CORR-3 — Drop the "import rankSeparate all-to-all separation" next-step; v2 gets forwardness by construction _for acyclic dataflow_ ✅ (qualified per Codex)

The pivot memo's Next-Step #1 (import global ranking + all-to-all separation from `rankSeparate`) is **redundant and harmful**: v2 already has global ranking (the depth grid) and needs **no separation constraints** — importing `rankSeparate`'s `for a∈leaves(A), b∈leaves(B): rank(a)<rank(b)` (real cross-product, `terraformPipelineRcllRankSeparate.ts:244-248`) just re-adds the measured **+28 % width / +45 % crossings**. The literature agrees: all-to-all separation is the **brute-force non-canonical special case**; forwardness in Sugiyama is a _consequence_ of a proper layering, not an explicit constraint [Gansner TSE93 §2]; cluster integrity is kept by **border nodes + contiguity** (Sander §4–5), or at worst a single per-cluster span constraint `maxcol(A) < mincol(B)`.

**Codex caveat (material — corrects an overclaim):** "by construction" holds **only for an acyclic collapsed TFD graph.** `computeDepths` has a cycle fallback — unresolved (cyclic) nodes get `firstSequence`, not a legal topological rank (`terraformPipelineLayoutShared.ts:501`), and v2 still renders, only emitting a warning via `pipelineCycleWarnings` (`terraformPipelineLayoutFinalize.ts:26`). So **"zero backward edges" is NOT a universal v2 invariant** — it holds for acyclic dataflow (the v2 preset's leaf graph is acyclic). **Cyclic TFD needs an explicit reject/repair/back-edge-styling story** (RCLL has this via EXT-12 dashed back-edges; v2 today just warns) → this is a v2 **gap** (listed below).

**Also (assessment report X3, correct):** in RCLL the +28 % width was the _intentional_ cost creating X-disjoint ranges so lane-rise trades width→height (net −42 %). v2 recovers height _differently_ (skyline Y-packing of X-disjoint blocks), so the height story must be **re-derived** under v2 semantics (= measurement Q3). RCLL-rankSep+M4 Compact (~8,377 px) is **not** obviously taller than v2 (~10,056 px); the pivot memo's headline compares v2 only to _classic_ (18,522 px), a weak baseline.

---

## Two precision fixes from Codex (folded into this doc)

- **"Non-recursive" is the wrong word.** v2's `layoutHullBlock` still recurses over child hulls (`terraformPipelineV2Pack.ts:294`). The real distinction is a **single global dataflow X frame + recursive _placement_**, not "no recursion." The lesson from the whole RCLL saga is precise: **local coordinate _frames_ are the anti-pattern, not recursion.** Option B is framed throughout as "one global coordinate frame," never "non-recursive."
- **Network-simplex is a B _addition_, not current v2 evidence.** v2 doesn't wire `networkSimplexRank` into prep (`terraformPipelineLayoutV2.ts:105`); RCLL does (`terraformPipelineLayoutRcll.ts:478`). The exact-Gansner NS kernel (`pipelineColumnPacking:"shorten"`, −8.4 % width) **already exists in the repo** — B reuses it in v2's prep; it is not new research.
- **The "global grid" story has an exception worth stating:** v2 spills pure-sink fan-out bundles _off_ the column grid, right of their anchor (`terraformPipelineV2Pack.ts:366`); forwardness there comes from "external sinks have no out-edges" (`unitIsExternalSink`, `:188`), not from the grid itself.

---

## What the literature says is canonical (citations)

- **Sander 1996, _Layout of Compound Directed Graphs_** — global partitioning of **base nodes** into layers via a single **nesting graph**; clusters get **explicit border dummy nodes** `u(−)/u(+)` ranked _in the same global sort_ + a border-correction pass; long/border-crossing edges split into dummy chains. (Adversarial-verify result: "derive spans from base-node bbox" oversimplifies — borders are first-class ranked entities.) <https://publikationen.sulb.uni-saarland.de/bitstream/20.500.11880/25862/1/tr-A03-96.pdf>
- **Forster 2002, GD'02** — 2-layer crossing reduction on **base nodes globally** while respecting hierarchy via border edges (never all-to-all separation). His dissertation notes border nodes alone don't _prevent_ cluster crossings → explicit cluster-ordering is still needed. <https://link.springer.com/content/pdf/10.1007/3-540-36151-0_26.pdf>
- **Graphviz `newrank=true`** — recursive clusters could place a head above its tail (a backward edge); the fix is one global rank = v2's grid. <https://graphviz.org/docs/attrs/newrank/> · Gansner et al. TSE93 <https://www.graphviz.org/documentation/TSE93.pdf>
- **ELK Layered + `hierarchyHandling=INCLUDE_CHILDREN`** — the production reference for global-rank compound layered; default `SEPARATE_CHILDREN` is the per-container-frame failure mode. But ELK keeps clusters as **first-class constraints in a _coupled_ solve**, and its authors call INCLUDE_CHILDREN "invasive… increases complexity," with many ordering strategies that "do not work" under it → **v2/B is a _decoupled simplification_ of ELK** that buys by-construction forwardness by _giving up ELK's joint crossing optimization_. <https://eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html> · arXiv:2311.00533 <https://arxiv.org/abs/2311.00533>
- **dagre / Mermaid** — global rank + post-pass border-nodes; nested-cluster ordering/overlap is the recurring _failure surface_ (dagre #125 / #158 / #238; Mermaid recommends "switch to ELK"). **Lesson: concentrate v2 testing on overlap-free rectangle derivation + Y-packing, not on ranking.**
- **Recent work (2022–2026) does NOT supersede Sander/Forster for cross-cluster direction** — confirmed by two independent searches; **GD 2025 had _zero_ compound-directed-layered papers** and the authoritative survey (Handbook ch., Healy–Nikolov) is 2013 with no successor. _Top-Down Drawings of Compound Graphs_ (arXiv:2312.07319) wraps classic layout in a top-down _process_; _Overview+Detail_ (arXiv:2408.04045) uses **Flexible Reingold–Tilford** (non-layered, _corrected_ — not "per-cluster dagre") + ports for a _different_ problem (multi-level legibility) and reports **no readability metrics**. Both are **decoupled** and ELK-endorsed → they _validate_ decoupling (Round-2 N3), not reject it. **Nuance (N2):** "the canon condemns recursion" is too strong — ELK _and_ yWorks both **default** to recursive per-cluster layering; the global frame is the right **opt-in** _specifically when cross-cluster edges must be optimized_ (our case). Sander/Forster remain SOTA.

**Net:** the canonical target is the standard compound-layered (ELK-style) pipeline run **once, over a global frame**. v2 is the right backbone (~30 %); RCLL is ~90 % of it "wearing a per-container exoskeleton" the canon explicitly avoids (Sander §4).

---

## v2's real gaps (ranked by readability impact)

1. **No crossing-minimization / ordering phase** (real gap — but NOT automatically the biggest; reframed by Round-2 N1). v2 derives Y from skyline _packing_ (area objective) + `firstSequence` ties + fan-out bundle grouping — no barycenter/sifting. The doc originally called this "the #1 readability aesthetic [Purchase GD'95]"; **round-2 research demotes that for our task**: Purchase's crossing-count primacy was measured on _small, abstract, undirected, structural-comprehension_ graphs. For **directed path-tracing** (tracing dataflow) the levers reorder to **(i) flow consistency / few back-edges → (ii) path continuity / straight long edges → (iii) crossing _angle_ → (iv) crossing _count_** [Ware et al. 2002; Huang/Eades/Hong 2008–2014], and crossing count is **not significant on large graphs** [Kobourov/Pupyrev/Saket GD'14]. In an orthogonal/layered drawing most crossings are already ~90° → low ROI per removed crossing. **So gap #2 (coordinate-assignment/straightness) is _at least_ co-equal with this one**, and an _angle-aware_ objective beats chasing minimal count. v2's "177 crossings" may be lucky on the preset; RCLL-with-`crossingMin` reached ~221–260 on the _separated_ layout. **Q3 must compare crossings head-to-head.** Fix: Forster base-node compound crossing reduction, ideally angle-aware.
2. **No coordinate-assignment / edge-straightening (Brandes–Köpf).** Packing won't align a node with its next-column successor → diagonal long edges [Gansner; Rüegg GD'15]. RCLL already built `straighten` + `coordRepack`.
3. **Cyclic-TFD handling is absent** (per the Codex caveat in CORR-3) — v2 falls back to model order + a warning; no back-edge styling/repair. RCLL has EXT-12.
4. **Mental-map instability** (mechanism real; harm CONTESTED — Round-2 N4). Skyline packing is order-sensitive; one added resource can reflow the whole skyline — _true_, and supported by the packing/treemap-stability literature, **but not by the originally-cited [Archambault & Purchase GD'12]**, which is the _pro-stability outlier_ in a split literature (Purchase & Samra 2008 and Saffrey & Purchase 2008 found _no benefit or even harm_; the benefit is task-specific to re-finding named nodes, not topology reading). For an **import-once** diagram there is no prior mental map on first render → harm only bites on re-import of a _memorized_ diagram. **Keep Q4 but at lower priority**; if it bites, fix with an **order-preserving, gap-avoiding packer** (Domrös et al. 2021) or **stable-treemap local moves** (Sondag et al. 2018), scored by a _relative-position_ metric. (= measurement Q4, downgraded.)
5. **Weak aspect/width control.** Longest-path on X is width-pessimal. **Fix already in-repo:** network-simplex ranking + column compaction (`shorten`, −8.4 % width) — neutralizes RCLL's REQ-7 hybrid-column worry _without_ reintroducing local direction-axis frames (clustered-level-planarity: cross-cluster monotonicity _requires_ globally-consistent leveling).

> **⟢ Round-4 amendment (2026-06-29):** "longest-path on X is width-pessimal" overstated the *default*. The default path **widens, then compacts away dead width**; the −8.4 % network-simplex narrowing is the *optional* `pipelineColumnPacking:"shorten"`, **default-OFF**. So R5 needs **no objective inversion** (an earlier shit-test draft wrongly called the width target "backwards"). **Decision D3: keep the widen-then-compact philosophy; v2's only change is making it deterministic / diff-stable.** Grid-packing of TFD-independent resources (rows × columns within a container) is deferred to a later pass. See **Round 4** below.
6. **Overlap-free rectangle derivation is the real risk surface** (dagre/graphviz break here, not on ranking) — harden + gate on the cyclic-provider all-resources config. (= Q4.)
7. **Thin ancillary** (≈20-line wrap) vs RCLL's hardened 1,014-line slack allocator — **port the RCLL allocator regardless of host.**

---

## The options (benefits / drawbacks / citations)

### Option A — Stay on RCLL; prune dead toggles

- **Benefits:** zero risk; passes its gates; preserves the hardened ancillary + gate battery; the global-rank primitive is already in. Right answer until a metric demands otherwise.
- **Drawbacks:** keeps the recursion exoskeleton the canon condemns (Sander §4); readability stays **host-capped** (the cyclic provider collapses interiors onto one dense-rank axis → the M4/M5/M6 no-ops); toggle sprawl (≈4 of 12 toggles measured-dead).

### Option B — Grow v2 into the canonical compound-layered backbone ⭐ (recommended _target_, gated on measurements)

One global dataflow coordinate frame + recursive skyline placement, behind the existing `pipelineLayoutVariant` flag. Refined P-phases:

```text
import → [P1 cycle: keep leaf-DAG acyclic; explicit cyclic-TFD repair = greedy-FAS reversal + back-edge restyle, model-order tie-break — CORR-3 gap]
       → [P2 layer-assign leaves, ONE frame — wire the existing network-simplex kernel, not longest-path]
       → [P3 cluster integrity: BORDER-NODE contiguity, NOT all-to-all separation — needs its own design milestone]
       → [P4 crossing-min on BASE nodes, hierarchy-contiguous (Forster), angle-aware + model-order-biased — co-equal with P5 (Round-2 N1), not "the biggest gap"]
       → [P5 coordinate-assignment: size/port-aware Brandes–Köpf (use 2020 Erratum fix) (+ optional prescribed-height flow, Jünger/Mutzel/Spisla)]
       → [P6 route: orthogonal/port edges (out=east, in=west) on top — Spönemann/ELK]
       → derive cluster rects → order-preserving, gap-avoiding pack of residual X-disjoint blocks (stable; Domrös 2021 / Sondag 2018) → export]
```

- **Benefits:** correct-by-construction direction (for acyclic dataflow); deletes toggle sprawl + the recursive exoskeleton; matches the canon; recovers readability RCLL can't reach (P4/P5 run on a global frame _with_ Y-room). Reuses the v2 seed + ports RCLL's ancillary allocator, gate battery, `diagnosePipelineScene`, and export; `computeGlobalSeparatedFloor` becomes the **spine, not a lever**.
- **Drawbacks / risks:** real engineering (~3–6 weeks, _estimate_). **P3 border/dummy nodes are the highest-blast-radius change and are currently a _phase label, not a migration plan_** — virtual vertices must thread cluster builds, layout boxes, frame emitters, ancillary strips, edge parenting, diagnostics, determinism, and the CON-12 gate (own milestone, full gate battery). Border nodes _dissolve_ the X-disjoint-range property RCLL's −42 % height win relied on (X3) → height re-derived. B is a _decoupled simplification_ of ELK → it gives up ELK's joint crossing optimization, so P4 quality must be measured. **Round-2 de-risk (N3):** the _magnitude_ of that loss is graph-dependent and, for our shape, probably small — ELK's own head-to-head (Schelten 2016) shows coupling helps most for _many tiny clusters_ (−63 % crossings) and **≈0 % median for few large clusters** (our case: a handful of containers each holding many resources), sometimes worse; ELK **defaults to decoupled** (`SEPARATE_CHILDREN`) and ships a decoupled "model order" path. Decoupling is mainstream, not an anti-pattern.

### Option C — Hybrid: v2 skeleton + local Sugiyama inside genuinely-hierarchical sub-regions (TALA lesson)

- **Benefits:** D2/Terrastruct **TALA** — the most sophisticated cloud-arch engine — does exactly this (containers first-class; apply hierarchy _only_ where the model is hierarchical). Likely beats pure v2 on dense sub-pipelines. <https://terrastruct.com/tala/>
- **Drawbacks:** re-introduces _some_ local-frame complexity (keep it on the _placement_ axis, never the direction axis); more moving parts. Best as a **P4/P5 refinement of B**, not a separate engine.

### Option D — Orthogonal / stress / constraint-solver as PRIMARY — rejected, borrow pieces

- Orthogonal+ports (Spönemann/ELK) is an **edge-routing add-on to layered** → adopt as B's P6.
- Stress-orthogonal (arXiv:1408.4626) loses the right-of guarantee → disqualifying as primary.
- HOLA / ARCOL — undirected, no clusters/flow → wrong shape; borrow ARCOL's aspect-ratio objective as a soft target.
- Constraint solvers (libcola / IPSep-CoLa / VPSC) — declined as primary (non-deterministic; soft constraints silently violate → re-add backward edges; alignment blow-up; <100 nodes). **Excellent as a B refinement layer** (localized VPSC overlap-removal within fixed columns = the loose-leaf doc's R2). <https://www.adaptagrams.org/documentation/libcola.html>
- **ML / deep-learning layout — considered & rejected (Round-2 N7):** every published learned layout (DeepGD, SmartGD, CoRe-GD) is an _undirected, soft-aesthetic_ force/stress emulator with **no compound-container support and no hard-constraint guarantees**, and neural inference is **not bit-reproducible** → violates our determinism + no-backward-edge contract. The only plausible future entry is an ML heuristic _inside_ the deterministic pipeline (a GNN ordering oracle), which is parity-at-best with the median/network-simplex heuristics today → not a contender, just a "watch." <https://arxiv.org/abs/2106.15347>
- **Market validation (refreshed Round-2, N5):** the market splits into _directed-but-flat_ (terraform graph / Rover / Pluralith / InfraMap / Overmind — Graphviz DAGs, no hull tree) and _nested-containers-but-no-dataflow_ (Cloudcraft / Hava / Cloudockit — containment grids, connections decorative). **Correction:** AWS Workload Discovery = **Cytoscape.js + fcose force-directed** (not "dagre+cola") = hairball, and is **confirmed retiring 2026-08-14** (→ CloudWatch App Map + DevOps Agent). Only D2/TALA + ELK do directional-layout-through-containers, but as _generic, hand-authored_ engines (TALA is container-first, not dataflow-first). **No tool does global-dataflow-through-the-hull-tree from live infra** → reword "unvalidated by prior art" to **application novelty** (the _primitive_ is prior art via ELK/TALA; the _application_ — global dataflow × full cloud hull-tree × live infra — is unclaimed). New 2025–26 entrants (Multiplayer OTel, Pulumi Insights 2.0, AI text-to-diagram) don't occupy the lane → still measure.

### Option E — Don't build a layout engine: emit to elkjs (buy the math, own the edges) ⭐ (Round-3 addition; belongs in the bake-off)

The doc's _own_ literature section proves the target IS ELK's exact algorithm set (Sander/Forster/Brandes–Köpf/FAS/model-order, `INCLUDE_CHILDREN`). Both A (8,743 lines) and B (3–6 weeks + the highest-blast-radius P3 border-node migration) are **build options for 30-year-old commodity math the Kiel group maintains for free.** Option E: build the **global leaf-DAG + cluster constraints**, hand them to **[elkjs](https://github.com/kieler/elkjs)** (`layered` + `hierarchyHandling=INCLUDE_CHILDREN`), and own only the genuinely-novel parts — **Terraform extraction, the hull tree, and the editable Excalidraw rendering.**

- **Benefits:** deletes _both_ bespoke engines' maintenance burden; gets P4/P5 (crossing-min + Brandes–Köpf) and the cyclic-TFD story for free and battle-tested; redirects the 3–6 week budget to extraction + canvas; model-order is a first-class ELK option. If it clears Q2/Q3/Q4 it dominates on cost-of-ownership.
- **Drawbacks / unknowns:** ELK's `INCLUDE_CHILDREN` is the "invasive" coupled mode (Round-2 N3) — quality/perf on our shape is the _same_ open question as B's, just measured on someone else's code; loses fine control over the ancillary allocator + the determinism spine (must verify elkjs is bit-reproducible across versions); WASM/JS bundle + async layout in the import path; and the hull→border-node encoding still has to be authored on our side (the P3 problem doesn't fully vanish, it moves to the ELK input format). **Add elkjs as a third arm in Q3** — it is the cheapest way to find out whether _either_ bespoke engine earns its keep.

---

## Gating measurements as concrete tasks (with pass/fail thresholds)

The A-vs-B call **resolves on these**, not on more prose. All are cheap and measurement-only.

| # | Task | Method | PASS (→ implication) |
| --- | --- | --- | --- |
| **Q1** | Attribute the ~49 s browser wall-clock | Expose `terraformImportProfilerSummary()` on `window` (dev-flag-gated) + apply-path spans; chrome-devtools-mcp trace on the canonical view; 3-run median | If layout < ~10 % of wall-clock → "scalable import" is **not** a layout problem → perf work stays out of layout (A confirmed for perf) |
| **Q2** | True RCLL everything-on legibility | Add an `rcll` arm to `terraformPipelineSemanticAudit.test.ts` (with `crossingMin` ON); report crossings / near-straight % / median ΔY on `staging-extended-localstack-v2` | If RCLL near-straight is high and crossings ≈ v2 → **RCLL is already legible → readability work (and B's main driver) drops** |
| **Q3** | v2 vs RCLL-everything-on bake-off | Engine-agnostic metrics on **all-resources + cyclic provider**: bounds, aspect, **forward-edge %**, **near-straight-long-edge %**, crossings (diagnostic), collisions, ancillary completeness; hard precheck that v2 produces a valid, collision-free, non-degraded scene | B gains its driver **only if**: v2 **forward-edge % and near-straight-long-edge % ≥ RCLL-best** **AND** v2 aspect closer to target **AND** v2 valid+overlap-free+non-degraded on the cyclic provider. Crossings are a **tiebreaker diagnostic, NOT a gate** (Round-3 fix: the prior `crossings ≤ RCLL-best` necessary-condition contradicted N1). Any primary fail → **A stands** |
| **Q4** | v2 skyline stability _(priority lowered — Round-2 N4: import-once weakens the mental-map harm; score with a relative-position metric, not raw displacement. **Conditional promotion — Round-3 Q0-USE:** if usage turns out import-per-PR, Q4 promotes to a TOP gate)_ | Add-one-resource reflow test + overlap-free assertion on all-resources+cyclic | If add-one reflows the whole skyline (relative-position break) or overlaps → v2 needs an order-preserving/stable packer (Domrös 2021 / Sondag 2018) _before_ B is viable |

**Decision rule:** B becomes a build **iff** Q3's **primary** gate passes (forwardness + straightness, _not_ crossing count) **and** Q2 shows RCLL is materially worse than v2; **and** Q4 shows stable overlap-free derivation. If Q1 = DOM/parse, perf work stays out of layout regardless. Otherwise **A stays**; B remains the spec'd-for-later target.

These four map onto the engine spec's Q1–Q3 (§7) plus a new Q4 (skyline stability) surfaced by this review. **Round 3 (below) adds Q0-TASK / Q0-SCAFFOLD preconditions and Q5–Q7, and demotes crossing count inside Q3 to match N1.**

---

## What already exists (reuse, don't rebuild)

- `computeGlobalSeparatedFloor` (global leaf ranking), the CON-12 gate battery, `diagnosePipelineScene` / `countPlacedCrossings`, the 1,014-line ancillary allocator, the network-simplex kernel (`shorten`), export / frame-parenting — all port into B. v2 seed (`terraformPipelineV2*.ts`) is the backbone.

## Not in scope (of any work this document authorizes)

> **⟢ Round-4 amendment (2026-06-29):** this section reflects the rounds-1–3 "specify + measure, don't build" posture. Round 4 **supersedes it**: with Q0-USE/Q0-SCAFFOLD answered, the build is **authorized** as a refactor of RCLL onto the depth-pinned model — see [`rcll-v2-foundation-spec.md`](./rcll-v2-foundation-spec.md). The items below are re-scoped: the Foundation build is now in-scope; "grow v2 / Option B border-node P3" is *not* the chosen path (we refactor RCLL instead).

- Building Option B (the engine) — gated on Q2/Q3/Q4 passing. This document only specifies it + the measurements.
- Pruning RCLL's dead toggles — defer to whichever host wins.
- The border-node P3 migration design — flagged as its own milestone (highest blast radius); not designed here.

---

## Round 2 — pressure-test & deep-research refresh (2026-06-26)

A second, deeper pass to _shit-test every assumption_, surface research conflicts, and check for 2024–2026 field shifts: **8 independent web-research agents** (one per load-bearing assumption: compound-layout SOTA, coupled-vs-decoupled crossing-min, crossings-as-#1-aesthetic, coordinate-assignment SOTA, cycle handling, ML/GNN layout, stability/mental-map, market scan) + **~15 graph-layout-rag corpus queries** + targeted PDF deep-reads. **Headline: the architecture verdict stands, but seven assumptions needed correction/nuance and one — the crossing-min priority — is materially reframed.**

### What held under attack (validated)

- **Sander 1996 + Forster 2002 remain canonical/SOTA** for the compound _directed layered_ cross-cluster-direction problem. **No 2022–2026 supersession** (two independent searches; GD 2025 had zero such papers; the 2013 Handbook chapter has no successor). The global-rank primitive (CORR-1) is confirmed correct.
- **FAS-reversal + back-edge restyling is the universal production cycle default** (graphviz/dagre/ELK); cyclic-level drawing has near-zero adoption — confirms CORR-3's P1 direction, and the back-edge restyle has HCI backing (Holten & van Wijk CHI'09: tapered/distinct encodings read direction best).
- **Brandes–Köpf is still the 2026 coordinate-assignment default** (ELK, dagre); ELK's BK _is_ the size/port-aware Rüegg GD'15 variant — exactly our heterogeneous-boxes case.

### Corrections & nuances (with citations)

- **N1 — crossing-COUNT is NOT the #1 readability lever for our task (the biggest reframe).** Purchase's primacy result was on _small, abstract, undirected, structural-comprehension_ graphs. For **directed path-tracing** the levers reorder: **flow consistency / few back-edges → path continuity / straight long edges → crossing _angle_ → crossing _count_** [Ware et al. 2002; Huang/Eades/Hong 2008–2014], and count is _not significant on large graphs_ [Kobourov/Pupyrev/Saket GD'14]. Most crossings in an orthogonal/layered drawing are already ~90° → low ROI per removed crossing. **Gap #2 (coordinate-assignment/straightness) becomes at least co-equal with gap #1**, and an _angle-aware_ objective beats minimal count. (Gap list updated.)
- **N2 — "recursion is the anti-pattern" is overstated.** ELK _and_ yWorks both **default to recursive** per-cluster layering; the global cross-hierarchy frame is the _opt-in, "invasive"_ mode. Recursion is the pragmatic default; the global frame is the **correct-but-costly** answer _specifically when cross-cluster edges must be optimized_ — exactly our cross-account/region dataflow case, so the choice stands; the framing should be "global is right _for our workload_," not "recursion is condemned."
- **N3 — decoupling cost is probably SMALL for our shape (de-risks Option B).** ELK's own head-to-head (Schelten 2016, _Hierarchy-Aware Layer Sweep_): coupling helps most for _many tiny clusters_ (−63 % crossings), **≈0 % median for few large clusters / random graphs**, and _sometimes worse_ → ELK gates coupling behind a per-subgraph heuristic and **defaults decoupled**. Cloud-infra = few large containers = the regime where joint optimization helps least. ELK's own _Model Order_ line is a shipping decoupled path "without a complex hierarchy-aware algorithm." Decoupling is mainstream.
- **N4 — mental-map instability (Q4) is contested & import-once-weakened.** The reflow mechanism is real (packing/treemap-stability literature) but [Archambault & Purchase GD'12] is the **pro-stability outlier** in a split literature (Purchase & Samra 2008; Saffrey & Purchase 2008 found _no benefit/harm_; benefit is task-specific to re-finding named nodes, not topology reading). Import-once has no prior map to break → harm only on re-import of a memorized diagram. **Keep Q4, lower its priority**; fix (if it bites) with an order-preserving gap-avoiding packer (Domrös et al. 2021) or stable-treemap local moves (Sondag et al. 2018), scored by a _relative-position_ metric.
- **N5 — market refresh.** AWS Workload Discovery = **Cytoscape.js + fcose** (not "dagre+cola"), **confirmed retiring 2026-08-14**. Reword "unvalidated by prior art" → **application novelty** (primitive = prior art via ELK/TALA; the application of global dataflow × full cloud hull-tree × live infra is unclaimed). New entrants (Multiplayer OTel, Pulumi Insights 2.0, AI text-to-diagram) don't occupy the lane.
- **N6 — implementation caveats.** Brandes–Köpf has a **2020 Erratum** (Brandes/Walter/Zink; two correctness flaws) — use the corrected version if hand-rolling. The prescribed-dimension flow formulation is **Jünger/Mutzel/Spisla 2018** (not Rüegg). "One global frame" is _our engineering inference_, not a literature finding — the defensible literature statement is narrower: _straightening needs cross-axis slack; a tight prescribed width caps achievable straightness_.
- **N7 — ML/DL layout: now explicitly considered & rejected** (Option D) rather than silently omitted — correct rejection (undirected, soft-aesthetic, non-deterministic, no compound support), but a reader will ask.

### Research conflicts surfaced (where the field is genuinely split)

- **Recursive vs global frame** — production tools default recursive; canon says global for cross-cluster edges. Resolves _for our case_ (N2).
- **Crossing-count primacy** — Purchase 1997 ("by far #1") vs Ware 2002 (path-length/continuity) vs Huang 2008–14 (angle) vs Kobourov 2014 ("n.s. on large graphs"). Task- and scale-dependent (N1).
- **Mental-map value** — A&P 2012 ("helps") vs Purchase & Samra / Saffrey & Purchase 2008 ("no benefit/harm"). Contested, task-specific (N4).
- **Coupled vs decoupled crossing-min** — ELK INCLUDE_CHILDREN ("invasive") vs ELK's own decoupled Model Order (shipping). ELK defaults decoupled; magnitude graph-dependent (N3).

### 2024–2026 field shifts worth tracking

- **The Kiel/ELK "Model Order" program** (Domrös & Riepe, _Determining Sugiyama Topology with Model Order_, GD 2024; _Diagram Control and Model Order for Sugiyama Layouts_, 2024) — deterministic, order-preserving, structural-prior Sugiyama: **the closest published analog to v2/B's "buy by-construction order, skip the joint optimization" thesis**, and directly relevant to our determinism requirement. **Recommend adopting model-order as the determinism/tie-break spine across P1 (cycle), P4 (crossing-min), P-pack.** The single most relevant new thread.
- **Order-preserving gap-avoiding packing** (Domrös et al. 2021/2023) + **Stable Treemaps via Local Moves** (Sondag et al. 2018) — concrete stable+compact replacements for ad-hoc skyline packing (P-pack / Q4 fix).
- **Layered crossing-min stays NP-hard / parameter-intractable** (arXiv:2510.13335, Oct 2025) — reinforces why decoupling + by-construction order is attractive.
- **ML graph layout matured** (CoRe-GD ICLR'24, SmartGD) but still undirected/soft/non-deterministic — has _not_ changed the constraint picture (N7).
- **Market:** force-directed cloud diagrams retreating (AWS WD retiring); containment-grid still commercially dominant; AI text-to-diagram is the loud 2025–26 movement (orthogonal to layout).

**Net of round 2:** no change to **A-now / B-as-gated-target**. The literature is now resolved into _settled vs genuinely-contested_, removing ambiguity: the canon (Sander/Forster/Brandes–Köpf/FAS-reversal) is firm; the contested points (crossing-count priority, mental-map value, coupling magnitude) all happen to **favour our decoupled, by-construction-order design for our specific shape** (few large containers, directed dataflow, import-once). The owed work is still the empirical Q1–Q4 — now with **Q4 downgraded**, **crossing-min reframed as angle-aware and co-equal with straightening**, and **model-order added as the determinism spine**.

## Round 3 — are we even asking the right questions? (2026-06-26)

Rounds 1–2 pressure-tested the _answers_ inside an A-vs-B / intrinsic-aesthetic / one-preset frame. Round 3 attacked the **frame itself**: a meta-audit (4 diverse-lens reframers — task/HCI, product/market, viz-representation, requirements-archaeology — + a completeness critic, then an advocate→skeptic adversarial verdict on 9 candidate reframes; 24 agents). **Result: the architecture verdict still holds (A-now / B-gated), but the gate program was asking sharp questions inside a frame it never validated.** All 9 stress-questions came back _complement_ (sharpen the gates), none strong enough to flip A-vs-B alone — but the genuinely decision-changing questions were ones **neither the doc nor the round-1/2 research had asked.**

### The frame's two load-bearing premises are UNKNOWN (not assumed-true)

The whole Q1–Q4 program silently assumes (a) the imported layout is a **kept, read-only artifact** and (b) usage is **import-once**. Asked directly, both are **"don't know — no usage signal."** That is the single most important finding: **the gates optimize user-readability, but there is no measured user.** Consequences, now explicit rather than buried:

- **Q0-SCAFFOLD (str 5, the biggest unturned stone).** The output is a _hand-editable Excalidraw scene, not a render_. This is an **editor**, not a viewer. If engineers treat the imported layout as a throwaway **scaffold** they drag into their own mental model, then the A-vs-B crossing/straightness bake-off **optimizes a draft nobody keeps** (Q2/Q3 go second-order), and the real requirement — which the doc _and all 22 reframer candidates missed_ — is **preserving the user's manual arrangement across re-import**, the _inverse_ of Q4's auto-layout stability, which **both engines currently destroy.**
- **Q0-USE (str 5).** Import-once vs import-every-PR (`terraform plan` / drift diff) is the exact premise behind Round-2 N4's downgrade of Q4. If usage is import-per-PR, **Q4 flips from lowest to top gate**, v2's order-sensitive skyline becomes potentially **disqualifying**, RCLL determinism becomes a _feature_, and **the winner can flip to A.**

> **⟢ Round-4 amendment (2026-06-29) — both product facts are now ANSWERED (no longer "don't know").** **Q0-USE = import every PR / plan / drift** (not import-once). **Q0-SCAFFOLD = editable seed the user rearranges** (not a kept render). Following the Round-3 logic above, this **triggers** the conditional promotions: Q4 stability becomes the **top gate**; v2's order-sensitive skyline is **disqualifying as-is** and must be made diff-stable; RCLL determinism becomes a **feature**; and the real requirement is **preserving the user's manual arrangement across re-import** — refined to: persist **groupings (as layout constraints), annotations (anchored to an element), and style edits — all keyed by Terraform address**; auto-layout still owns geometry (manual *positions* are not preserved); conflict policy = *re-place changed elements*; diff = *in-place highlighting*. This is the input that produced the 8 locked decisions in **Round 4** below.

**Implication:** until these two product facts are known, the gates are honest **engineering-quality proxies** (validity, overlap-freedom, forwardness, straightness, TCO) — they cannot claim to optimize user task-success. With no usage signal, the defensible optimand is the **capability + cost-of-ownership + author judgment**, not a task oracle that doesn't exist. _A-now still holds regardless_ (it's a reversible flag at near-zero marginal cost; B has real downside, A has none).

### The one unambiguous internal contradiction (fixed above)

**Q3 made `v2 crossings ≤ RCLL-best` a _necessary condition_ — directly contradicting the doc's own N1** (crossing count is the 4th-order lever, n.s. at this scale). The skeptic confirmed it as self-undermining. **Fixed:** Q3's primary gate is now **forward-edge % + near-straight-long-edge %**, crossings demoted to a tiebreaker diagnostic. A borderline v2 with marginally more crossings but better straightness now correctly _passes_ instead of failing a gate the doc's own reasoning calls wrong.

### Revised question set (additions — see Q3/Q4 table edits + Option E above)

| Q | What it adds | Augments / replaces |
| --- | --- | --- |
| **Q0-TASK** | Name ONE primary task (path-trace a dependency? locate a resource? read cluster membership? see what changed?) + the decision the reader makes + import cadence. Q2's "materially worse" / Q3's "closer to target" are undefined without it. | new precondition; makes Q2–Q4 interpretable |
| **Q0-SCAFFOLD** | Kept artifact vs editable seed; if seed, define what must survive re-import (the user's edits). | new frame-level gate; if it fires, demotes Q2/Q3 and rewrites Q4 |
| **Q3 (third arm)** | Add **elkjs / Option E** + two stratifying presets: a _many-small-containers_ scene (tests N3) and a _cyclic-LEAF-TFD_ scene (tests v2's real CORR-3 gap — the current cyclic-provider preset is cyclic at the _hull_ level, which v2 sidesteps, so it never exercises v2's actual gap). | extends Q3 |
| **Q5-TCO** | Cost-of-ownership: maintainer onboarding, dead-toggle surface, P3 blast radius vs line-count savings. The pivot was _about_ maintainability, yet every gate measures pixels — the rule structurally can't express its own motivation. Let B / a clean rewrite / elkjs win on TCO even at readability-parity. | new axis |
| **Q6-FIDELITY** | Does the extracted hull-tree + edge set match deployed reality (IAM / network / runtime / cross-account edges `terraform graph` structurally cannot see)? Straightening a declared-only edge set beautifully is optimizing the wrong graph. Orthogonal to A-vs-B but may outrank layout for the next unit of work. | reorders the backlog |
| **Q7-AXIS** | Validate X encodes runtime **dataflow**, not Terraform **reference/create order** (often the semantic reverse: `lambda` references `queue.arn` → dep edge `lambda→queue`, but data flows `queue→lambda`). Hand-label 20 cross-hull edges before optimizing straightness/forwardness on that axis. | upstream validity gate, ahead of Q2/Q3 |

**Dropped as distractions** (orthogonal to the engine pick; tracked, not gated): LLM/semantic hull grouping (collides with the determinism contract), adjacency-matrix/NodeTrix (loses the path-trace task), Sankey/flow-magnitude (Terraform edges are unweighted booleans), and pure market willingness-to-pay (reweights the whole layout investment, not RCLL-vs-v2).

**Net of round 3:** the research is rigorous and the **A-now / B-gated verdict is unchanged** — but it was over-instrumented relative to its premises. Before committing the 3–6 week B build, the cheapest and highest-leverage moves are not more layout metrics: (1) settle the two product facts (Q0-SCAFFOLD, Q0-USE) — they can flip the winner to A and even moot the contest; (2) add **elkjs as a Q3 arm** before hand-rolling commodity math; (3) the now-fixed Q3 gate; (4) treat the gates honestly as engineering-quality proxies, not user-readability oracles, until there's a measured user. The frame is no longer asking only "which engine draws the prettiest static picture" — it now also asks "is the picture even the product, who reads it, how often, and is it true."

## Outside-voice second opinion (Codex)

- **CODEX** independently read the code and **confirmed CORR-2** (`terraformPipelineLayoutShared.ts:485/:1458`, `terraformPipelineV2Pack.ts:103`); caught the "by-construction" overclaim (cyclic fallback `:501`), the "non-recursive" imprecision (`:294`), the off-grid sink spill (`:366`), the network-simplex mispositioning (`terraformPipelineLayoutV2.ts:105`), and the under-specified P3. All folded in above.
- **CROSS-MODEL:** strong agreement. Both reviewers: v2 is the right backbone but ~30 % of a readable engine; the A-vs-B decision is **data-gated, not prose-gated.** Hence the deliverable is **docs + concrete measurement tasks with pass/fail thresholds** rather than a stall.

---

## Round 4 — independent shit-test + 8 locked build decisions (2026-06-29)

> This whole section is a **Round-4 amendment.** It does not rewrite rounds 1–3; it records what changed once the two product facts (Q0-USE, Q0-SCAFFOLD) were answered, what was re-verified at source, and the build decisions now locked. The companion build doc is [`rcll-v2-foundation-spec.md`](./rcll-v2-foundation-spec.md).

**Method.** A 9-agent drill (2 ground-truth code reads + 3 literature/web research over the desktop GPU `graph-layout-rag` + 3 syntheses + 1 adversarial critic), then a manual reconstruction of the one synthesis the workflow dropped (the packer) and resolution of the six contradictions the critic raised. Two load-bearing facts were re-verified directly against source before locking anything.

### Re-verified at source (Round 4)

- **CORR-1/2/3 still hold** as written in rounds 1–3 (global leaf ranking; v2 columns on dataflow depth; forwardness-by-construction for acyclic collapsed TFD).
- **The within-column Y-ordering key is diff-UNSTABLE.** `firstSequence = min(edge.sequence)` is the primary within-column sort (`terraformPipelineV2Pack.ts:350-355`, `:453-457`), and `edge.sequence` is a **file-position counter** — `let sequence = 0` (`terraformDeclaredDataFlow.ts:218`) → `edges.push({…sequence}); sequence += 1` (`:282-283`), incremented once per edge in parse order. So inserting one edge mid-`.tfd` renumbers every later edge and **reshuffles the Y of unrelated nodes.** Pure determinism holds; *diff-stability* does not. **This is the crux the build must fix (D1).**
- **`applyDepthFloorIfValid` is gate-AND-commit, not a pure predicate.** It mutates `cluster.depth` in place on success ("DUAL-WRITE #1", `terraformPipelineLayoutShared.ts:606`). A constraint relax-and-re-solve loop therefore needs a pure (non-mutating) feasibility variant — the pure check already exists inline at `:598-601` and can be extracted.

### The reframe that drives the decisions: determinism ≠ diff-stability

- **Pure determinism** (same input → same output) the engine **already has** (no `Math.random`/`Date`; every sort ends in `localeCompare`). A "run-twice-deep-equal" test proves *only* this and must **not** be cited as evidence of stability.
- **Diff-stability** (small input change → small, localized output change) the engine **lacks**, because of the file-position ordering key above. The answered Q0 facts make diff-stability the **#1 objective**. Geometry diff-stability is owned by the **ordering-key fix (D1)** via statelessness + a content-stable key (the Model-Order result) — **not** by stateful previous-layout anchoring (DynaDAG/Sondag/cola.js are path-dependent → rejected). Note: "byte-stable for unchanged elements" is *not* achievable (`x/y` are serialized and a neighbour's add legitimately moves a node); the honest target is *diff-stable*.

### The 8 locked decisions

| # | Decision | Choice | Notes |
| --- | --- | --- | --- |
| **D1** | Within-column Y-ordering key | **Predecessor-address barycenter** (sorted upstream addresses, then own address) | Replaces `firstSequence`. Content-stable *and* dataflow-legible (keeps same-source siblings adjacent → helps R4). The single highest-leverage change; everything depends on it. |
| **D2** | Identity depth | **Derive `element.id = tf:<role>:<address>`** | Reuses Excalidraw reconcile/z-order/version machinery + stable annotation anchors. Done in a post-convert id-rewrite pass; edges keyed by sorted endpoints (not `sequence`); ordinals content-derived. |
| **D3** | R5 width policy | **Keep current widen-then-compact; just make it deterministic / diff-stable** | Corrects the earlier "width is backwards" overclaim (that was the *optional* default-OFF NS narrowing). Grid-packing of TFD-independent resources deferred to a later pass. |
| **D4** | R4 container crossings | **Soft gate (ranked penalty)** | Add a container-pierce count (`segmentsCross` vs frame rects); the packing-search ranks candidates by it. Today it is measured nowhere. Distinct from — and lighter than — the deferred barycenter crossing-min sweep. |
| **D5** | Cyclic-leaf (R3) policy | **Repair: FAS reversal + back-edge restyle** | Reverse the minimum feedback arc set, lay the rest strictly L-to-R, draw the reversed edge(s) styled. The silent un-styled backward arrow (today's v2) is a bug fixed regardless. |
| **D6** | Containment-schema generalization | **Inside Foundation** | Replace the hardcoded 6-level AWS role enum (`topologyPathForCluster`) with a configurable containment schema (ordered level descriptors + per-level pack/band policy) as part of the core refactor. This is the original "won't generalize" worry, handled head-on. |
| **D7** | elkjs parallel spike | **Skip; commit to the depth-pinned RCLL refactor** | Direction is literature-confirmed; elkjs can't be the engine (not bit-reproducible → fails the determinism contract). Measure against our own RCLL baselines. |
| **D8** | Docs / green light | **Amend this doc + reconcile the Foundation spec** | This Round-4 section + the inline `⟢` callouts; build doc updated to match. |

### What Round 4 supersedes (pointers, originals preserved)

- **VERDICT** "A-now / B-gated, grow v2" → resolved by the answered Q0 facts to **refactor RCLL onto the depth-pinned model** (inline callout at VERDICT).
- **Gap #5** "longest-path width-pessimal / width control weak" → **D3** (inline callout at the gap).
- **Q0-USE / Q0-SCAFFOLD** "don't know" → **answered** (inline callout in Round 3).
- **Q4** "lowest priority / conditional" → **top gate** (diff-stability is now #1), via the answered Q0-USE.
- **Gap #1 / N1** crossing-count demotion → unchanged as *count*, but **R4 container-pierce becomes a soft gate (D4)** — the container-pierce objective N1 explicitly did *not* excuse.

### Round-4 sources (2026-06-29)

- **Domrös & von Hanxleden 2024 (GD'24)**, _Diagram Control and Model Order for Sugiyama Layouts_ (arXiv:2406.11393) — stateless model-order stability ("small textual change → small diagram change"); "Strategy 1" keeps crossing-min primary with model order as the stable tie-break. Grounds **D1**. <https://arxiv.org/abs/2406.11393>
- **North & Woodhull 2001 (GD'01)**, _Online Hierarchical Graph Drawing_ (DynaDAG) — stable layered layout via a *previous-layout anchor* (path-dependent); **rejected** for our determinism contract. <https://graphviz.org/documentation/NW01.pdf>
- **Dwyer, Marriott, Stuckey 2005 (GD'05)**, _Fast Node Overlap Removal_ (VPSC) — deterministic per-dimension separation projection; acyclic-constraint-graph feasibility test. The *theory* behind the grouping-constraint conflict policy (its solver is **not** adopted; only the deterministic projection / feasibility check). <https://link.springer.com/chapter/10.1007/11618058_15>
- **Eades, Lin, Smyth 1993** (greedy FAS) — minimum-feedback-arc-set cycle reversal; grounds **D5**. <https://doi.org/10.1016/0020-0190(93)90079-O>
- **Citation fix to verify:** the GD'24 "model order" thread is by Domrös & von Hanxleden (arXiv:2406.11393); confirm the authorship attributed to "Domrös & Riepe" in the Round-2 sources for _Determining Sugiyama Topology with Model Order_.

---

## References

- **Sander 1996**, _Layout of Compound Directed Graphs_ — §4 (not recursive), §5 (dummy/border nodes), comparison section. The canonical source. <https://publikationen.sulb.uni-saarland.de/bitstream/20.500.11880/25862/1/tr-A03-96.pdf>
- **Forster 2002**, _Applying Crossing Reduction Strategies to Layered Compound Graphs_ — §4.1 base-node-global reduction. <https://link.springer.com/content/pdf/10.1007/3-540-36151-0_26.pdf>
- **Gansner et al. 1993 (TSE93)**, _A Technique for Drawing Directed Graphs_ — network-simplex ranking; forwardness as a consequence of layering (§2). <https://www.graphviz.org/documentation/TSE93.pdf>
- **Graphviz `newrank`** — one global rank fixes recursive-cluster backward edges. <https://graphviz.org/docs/attrs/newrank/>
- **ELK** `hierarchyHandling` reference + arXiv:2311.00533 (INCLUDE_CHILDREN is "invasive"). <https://eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html> · <https://arxiv.org/abs/2311.00533>
- **Brandes–Köpf** — coordinate assignment; **Rüegg/Schulze GD'15** — node-size-aware variant.
- **Purchase 1995 (GD'95)** — crossings are the dominant readability aesthetic.
- **Archambault & Purchase GD'12** — mental-map / stability under change.
- **D2/Terrastruct TALA** — container-first hybrid. <https://terrastruct.com/tala/>
- **Adaptagrams libcola / IPSep-CoLa / VPSC** — constraint solvers (declined as primary). <https://www.adaptagrams.org/documentation/libcola.html>

**Round-2 sources (2026-06-26 deep-research refresh):**

- **Ware, Purchase, Colpoys, McGill 2002**, _Cognitive Measurements of Graph Aesthetics_ — for path-tracing, path-length + continuity outrank crossings. <https://eprints.gla.ac.uk/14111/>
- **Huang, Hong, Eades 2008 / 2014**, _Effects of Crossing Angles_ / _Larger crossing angles make graphs easier to read_ — crossing _angle_ > count; near-orthogonal crossings ~free. <https://ieeexplore.ieee.org/document/4475457> · <https://www.sciencedirect.com/science/article/abs/pii/S1045926X14000317>
- **Kobourov, Pupyrev, Saket 2014 (GD'14)**, _Are Crossings Important for Drawing Large Graphs?_ — crossings _not significant_ on large graphs. <https://www2.cs.arizona.edu/~kobourov/crossings.pdf>
- **Purchase 1997**, _Which Aesthetic has the Greatest Effect on Human Understanding?_ — the "crossings #1" source, scoped to small abstract undirected graphs. <https://dl.acm.org/doi/pdf/10.1145/264216.264222>
- **Schelten 2016**, _Hierarchy-Aware Layer Sweep_ (MSc, Kiel) — coupled-vs-decoupled crossing-min head-to-head; coupling helps tiny clusters, ≈0 % for few large clusters. <https://rtsys.informatik.uni-kiel.de/~biblio/downloads/theses/alan-mt.pdf>
- **Domrös, Kasperowski, Petzold, von Hanxleden 2023/2024**, _The Eclipse Layout Kernel_ — verbatim INCLUDE_CHILDREN "invasive… do not work"; ELK Model Order as decoupled alternative. <https://arxiv.org/html/2311.00533v1>
- **Domrös & Riepe 2024 (GD'24)**, _Determining Sugiyama Topology with Model Order_ — deterministic order-preserving Sugiyama (model-order spine). <https://drops.dagstuhl.de/storage/00lipics/lipics-vol320-gd2024/LIPIcs.GD.2024.48/LIPIcs.GD.2024.48.pdf>
- **Domrös, Lucas, von Hanxleden, Jansen 2021**, _On Order-preserving, Gap-avoiding Rectangle Packing_ (IVAPP'21; "Revisiting…" LNCS 2023) — stable + compact packer for the skyline gap. <https://www.scitepress.org/Papers/2021/101864/101864.pdf>
- **Sondag, Speckmann, Verbeek 2018**, _Stable Treemaps via Local Moves_ (IEEE TVCG) — local-move stability without sacrificing quality. <https://ieeexplore.ieee.org/document/8019841/>
- **Archambault & Purchase 2012 (GD'12)** _Mental Map Preservation Helps…_ vs **Purchase & Samra 2008** / **Saffrey & Purchase 2008** — the contested mental-map literature. <https://link.springer.com/chapter/10.1007/978-3-642-36763-2_42> · <https://eprints.gla.ac.uk/35837/>
- **Brandes, Walter, Zink 2020**, _Erratum: Fast and Simple Horizontal Coordinate Assignment_ — two BK correctness flaws. <https://arxiv.org/abs/2008.01252>
- **Jünger, Mutzel, Spisla 2018**, _A Flow Formulation for Horizontal Coordinate Assignment with Prescribed Width_. <https://arxiv.org/abs/1806.06617>
- **Eades, Lin, Smyth 1993** (greedy FAS) + **Holten & van Wijk 2009 (CHI)** (directed-edge encoding) — cycle reversal + back-edge restyle. <https://doi.org/10.1016/0020-0190(93)90079-O> · <https://doi.org/10.1145/1518701.1519054>
- **ML layout (rejected):** DeepGD <https://arxiv.org/abs/2106.15347>, SmartGD <https://arxiv.org/abs/2206.06434>, CoRe-GD (ICLR'24) <https://arxiv.org/abs/2402.06706>.
- **_Tight Parameterized (In)tractability of Layered Crossing Minimization_, 2025** (arXiv:2510.13335) — layered crossing-min stays hard. <https://arxiv.org/abs/2510.13335>
- **Market (2025–26):** AWS Workload Discovery (fcose; retiring 2026-08-14) <https://github.com/aws-solutions/workload-discovery-on-aws>; Cloudcraft "Live" <https://www.cloudcraft.co/>; D2/TALA <https://terrastruct.com/tala>; Multiplayer <https://www.multiplayer.app/>.

**Round-3 sources (2026-06-26 question-frame audit):**

- **elkjs** — ELK compiled to JS; `layered` + `hierarchyHandling=INCLUDE_CHILDREN` is the off-the-shelf form of Option B's target (Option E). <https://github.com/kieler/elkjs>
- **Lee, Plaisant, Parr, Fekete, Henry 2006**, _Task Taxonomy for Graph Visualization_ (BELIV'06) — the canonical task list (adjacency / accessibility / common-connection / topology); grounds Q0-TASK. <https://www.cs.umd.edu/~ben/papers/Lee2006Task.pdf>
- **Saket, Simonetto, Kobourov, Börner 2014**, _Node, Node-Link, and Node-Link-Group… Task-Based Evaluation_ (TVCG) — readability is task-dependent; group encoding helps membership tasks. <https://ieeexplore.ieee.org/document/6875964>
- **Ghoniem, Fekete, Castagliola 2005**, _On the Readability of Graphs Using Node-Link vs Matrix_ — node-link wins **path-following** (our primary task), matrices win density; grounds keeping node-link + the Q-REP rejection. <https://www.lri.fr/~fekete/ps/GhoniemFeketeCastagliola_InfoVis04.pdf>
- **van Ham & Perer 2009**, _"Search, Show Context, Expand on Demand"_ (TVCG) — degree-of-interest interaction as the scale lever (grounds the interaction complement, and the drill-down measurement unit in revised Q2). <https://ieeexplore.ieee.org/document/5290710>
- **Yoghourdjian et al. 2018/2021**, _Graph Thresholding / Scalable readability_ — readability degrades with size; supports measuring on collapsed + drill-down units, not the flattened scene. <https://arxiv.org/abs/2108.03362>
- Internal: [`pipeline-rcll-v2-pivot-recommendation.md`](./pipeline-rcll-v2-pivot-recommendation.md), [`rcll-architecture-assessment-report.md`](./rcll-architecture-assessment-report.md), [`rcll-layout-engine-spec.md`](./rcll-layout-engine-spec.md), [`pipeline-rcll-layout-design.md`](./pipeline-rcll-layout-design.md), [`rcll-loose-leaf-edge-length-research.md`](./rcll-loose-leaf-edge-length-research.md).
