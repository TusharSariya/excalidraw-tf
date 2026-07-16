# Strata / RCLL-v2 Graph-Layout Methodology Audit — 2026-07-15

**Purpose (read me first).** This is a handoff record of a two-round, 9-agent adversarial literature audit of the Terraform **strata** view's graph-layout methodology. The question asked was blunt: _"Has strata been built properly, or did the owner make a mistake in the graph-layout algorithms?"_ Future agents can use this to see **what each agent did, what it concluded, and which gaps/issues it found**, without re-running the whole audit. Every agent had graph-layout-rag (3k+ graph-drawing papers) + web + repo (docs/strata*, docs/rcll-v2*, and the strata source).

> **TL;DR verdict (unanimous, 9/9 agents, incl. 3 prosecutors who tried to break it):** > **SOUND / minor-gaps. No undiagnosed graph-layout mistake.** The one genuine algorithmic flaw — a non-monotone 2-pass descent that violated sifting's best-seen invariant — was already self-diagnosed and fixed this session via the opt-in `strataPackedConverge`. Everything else the prosecutors could indict was either (a) already in the repo's own diagnosis ledger with the literature-correct fix built, or (b) a documented, measured engineering trade. Several agents rated the methodology _above_ typical published-pipeline rigor.

---

## Method

- **Round 1:** 3 Fable agents, one per methodology pillar (ordering / objective+metrics / coordinate+geometry). Neutral framing.
- **Round 2 (replication + stress test):** 6 Fable agents, **2 per pillar** — one **neutral**, one **prosecutor** (told to assume a fatal mistake exists and find it; "if you can't substantiate one, say so — but attack hard first"). Round-2 agents were **blind** to Round-1 conclusions, so agreement is genuine independent convergence, not anchoring.
- All agents time-boxed (~8 min), unsandboxed, instructed to cite graph-layout-rag `doc_id`s and to shit-test their own conclusion.

**Three pillars audited:**

1. **Ordering** — hull vertical ordering + crossing minimisation (greedy packed-scoring coordinate descent, 2-pass cap, sift+relocate, band-depth banding).
2. **Objective / metrics / evaluation** — lexicographic `crossings ≻ penetrations ≻ length-L1`, ε-frontier, rt̂ (Ware 2002), churn (Sondag/ARI), Q7-axis, paired bootstrap CIs.
3. **Coordinate / geometry / architecture** — X network-simplex packing, A7 coordinate-refine, Y-axis NO-GO, band sharing, layered-vs-stress architecture choice.

---

## Alignment matrix

| Pillar | R1 (neutral) | R2 neutral | R2 prosecutor |
| --- | --- | --- | --- |
| Ordering | minor-gaps | minor-gaps | minor-gaps (no _new_ mistake) |
| Objective / metrics | minor-gaps | minor-gaps | minor-gaps (no proven fatal) |
| Coordinate / geometry | sound | sound | **actually-sound** ("could not substantiate a real mistake") |

**9/9 agents → sound / minor-gaps. 3/3 prosecutors failed to substantiate a fatal flaw.**

---

## Per-agent record

### Round 1

**R1-A · Ordering (neutral) → minor-gaps.** Did: skimmed rcll-v2-spec-v3.1 + packed-scoring source, 6 rag queries, cross-checked `terraformPipelineStrataOrdering.ts` / `terraformPipelineStrataPackedScoring.ts`. Findings: (1) The 2-pass cap + non-monotone acceptance chain **violates sifting's best-seen invariant**; field data says ~5–10 rounds, not 2 (`jgaa-2677`, `forward-10-1007-3-540-46648-7-22`). Real flaw, but the repo self-diagnosed it and built `strataPackedConverge`. (2) **No category error** — ordering nested hulls as atomic blocks along one axis is standard compound-graph practice (`sander-compound-directed-graphs`, `forster-compound-crossing-gd2002`, Forster diss `openalex-w1530155803`); owner even _empirically verified_ the 2D-inseparability boundary. (3) Candidate pool narrower than global sifting (all-positions); deterministic-only local-optima handling. Novel/good: scoring candidates on **real placed geometry** vs ordinal proxy.

**R1-B · Objective/metrics (neutral) → minor-gaps.** Findings: (1) Lexicographic `crossings ≻ pen ≻ length` is theoretically **indefensible as an infinite exchange rate** (Ware prices a crossing finitely, ~0.654s), _but the repo already knows_ — `strata-view-w8b-epsilon-frontier.md` states the critique verbatim, built the ε-constraint remedy, dumped the frontier, and parked δ=0 pending owner adjudication. (2) rt̂ is a **legitimate, careful** use of Ware 2002 (`doi-10-1057-palgrave-ivs-9500013`): `terraformPipelineStrataPathMetrics.ts:38-50` reproduces the regression exactly, `cr`-on-path, "relative use only". (3) Eval rigor strong. Two real gaps: **no multiple-comparison control** (FDR/Bonferroni) on REPORT cells; **n=1 human rater** (Q7).

**R1-C · Coordinate/geometry (neutral) → sound.** Findings: (1) **Y-axis NO-GO is correct** per literature — genuine 2D-inseparability; the only fix is a full coupled 2D solve (IPSep-CoLa `dwyer-ipsep-cola`), which the owner identified and scoped out. (2) X packing = **canonical Gansner network-simplex** (`gansner-tse93`), correctly extended with zero-weight constraint edges (W5b joint probe). (3) Global-frame compound architecture matches Sander/`newrank`/ELK; layered (not force-directed) is right for a directed dataflow DAG. Minor gaps (self-flagged): no size-aware Brandes-Köpf pass, hull-greedy-sift vs Forster, Y-band sharing unbuilt.

### Round 2 (blind)

**R2-A1 · Ordering (neutral) → minor-gaps.** Verified code directly. Confirmed R1-A. Extra: the legacy packed acceptance chain was **proxy-blind** (counted crossings on a synthetic banded-stack trial the packed layout never renders; read 0 for both orders while true scene crossings were 123 vs 120 — R9-F1), self-caught and remedied by real-geometry scoring. Notes exact-integer geometry (doubled coords, `orient2`, cross-multiplied rational barycenters — no float-ULP tie hazards) as above-typical. Recommends: iterate to a bounded fixed point (5–10 rounds) with best-seen as default; global sifting as candidate generator; optional restarts. Cites `handbook-hierarchical`, `openalex-10-1007-3-540-45848-4-10` (OSCM NP-hard), `doi-10-4230-lipics-gd-2024-48` (model-order).

**R2-A2 · Ordering (prosecutor) → minor-gaps (no new undiagnosed mistake).** Strongest indictment: best-seen-invariant violation under non-monotone adoption (`forward-10-1007-3-540-46648-7-22` cited ×72). Holds as an algorithm flaw by field standards — but **already diagnosed and fixed** (`packedConverge`). **Residual, sharpest new point:** `packedConverge` is an independent opt-in rather than **implied by `ε>0` / `strataSiftRelocate`**. At ε=0 it's inert; the only configs where it matters are exactly those where leaving it off **ships a known best-seen-invariant violation for zero benefit**. Rejected as non-mistakes: barycenter "not used" (FALSE — exact-rational barycenter sweep present), Forster "not used" (partially false — group-sift keeps satellites contiguous), greedy-vs-metaheuristics (determinism/diff-stability requirement makes greedy+exact-oracle coherent).

**R2-B1 · Objective/metrics (neutral) → minor-gaps.** Confirmed R1-B. rt̂ "unusually faithful" — intercept omitted, `cr`-on-path ("the classic misuse is absent"), 2–5-hop stimulus range. ε-band = textbook ε-constraint scalarization. New supporting cite: **Purchase 2024** (`s2-10-48550-arxiv-2409-04493`, "Perception of Stress in Graph Drawings") questions whether stress is even _perceived_ — which _supports_ the choice not to optimise stress. Gaps reaffirmed: rt̂ external validity (fit on straight-line abstract stimuli; applied to orthogonal/hull-contained edges), N=1 rater, no family-wise correction (mitigated by conservative all-must-pass gate).

**R2-B2 · Objective/metrics (prosecutor) → minor-gaps (no proven fatal).** Went **external** to verify Ware coefficients (corpus entry is metadata-only, no PDF). Via **Dawson, Munzner, McGrenere 2015** ("A search-set model of path tracing", full PDF): Ware's factor set is `sp-ln/sp-cn/sp-ex/ sp-br`, importance ordering length > continuity > crossings, R²≈0.79 — all triangulate with the code's k/con/cr/br and claimed R²=.784, and `RT_PARITY_EPSILON=0.25s ≈ 14.7°` checks out. **So the coefficients are NOT fabricated.** **New, specific nit:** the code counts `cr` as _distinct non-path arrows crossing the path_ (per-arrow) and attributes it to Ware, but Dawson describes Ware's `sp-ex` as _total edge-edge crossings on the path_ (per-**intersection**) — dense scenes where one arrow crosses twice are underpriced. Unproven (couldn't reach Ware's primary), monotone-related, small impact under relative/paired use. Recommends: soften the code comment or obtain Ware's primary PDF; ingest it into the corpus.

**R2-C1 · Coordinate/geometry (neutral) → sound.** Confirmed R1-C, code-level. X-axis NS = Gansner TSE93 ranking NS (tight tree → cut values → pivots → balance, Bland's rule for determinism), the canonically-correct use, fail-safe via `applyDepthFloorIfValid`. Y straightener is BK-style and the repo **cites the BK 2020 erratum** (`s2-6117d268...`, arXiv:2008.01252) as "mandatory if you hand-roll BK" — most industrial impls (incl. dagre) miss this. Global-rank primitive = Sander / Graphviz `newrank`. Minor gaps: unified min-cost-flow coordinate assignment (Jünger-Mutzel-Spisla `crossref-10-7155-jgaa-00500`) not built (cited, triaged); cyclic-dataflow policy open; per-container coordRepack accept-gate allows small scene drift.

**R2-C2 · Coordinate/geometry (prosecutor) → actually-sound (no substantiated mistake).** Attacked 6 angles, all fail: (1) Y-NO-GO-as-cop-out **does not hold** — repudiated the greedy pass on challenge, re-ran a **coupled hierarchical 1D-VPSC + exact PAVA** solve (unconstrained ceiling 99.91%, constrained Y-only made ΔY _worse_ 271→1831px); the wall is objective-side (forwardness feasible region), not solver-side; IPSep-CoLa cites accurate. (2) No BK = minor documented gap; A7 refine is a **CI-excluding-zero task-time win** (first over v2). (3) Sift chases crossings — no, K=4/A7 defaults chosen on **Δrt̂**, crossings are "a diagnostic, never a gate". (4) NS misapplied — no, they **falsified their own DI-NS-4** "cannot compose" claim then kept the exclusion on measurement (RS worsens traced-path crossings 123→220). (5) Y-band breaks Sander — no, Sander constrains the layer axis (=X here), band sharing is on the orthogonal packing axis. (6) Wrong family — layered defensible (determinism + forwardness disqualify stress/CoLa). Two surviving gaps: **elkjs "not deterministic" claim never measured** (process gap); **P5/BK straightening deferred**.

---

## Consolidated findings

### The one genuine algorithmic flaw (already fixed this session)

**2-pass greedy descent returned the rolling incumbent, not the best-seen** → violates sifting's best-seen invariant; adoption is provably non-monotone when `ε>0` or the relocate-weighted rule is active (module header self-documents an oscillation counterexample). Measured cost on the owner's real config: dominant order `cand33` held-then-dropped, 174 vs 169 crossings. **Fixed** by `strataPackedConverge` (opt-in, default-off, byte-identical off) — returns the best-seen adopted snapshot under the active comparator. This is the literature-correct remedy (best-seen adoption). See `terraformPipelineStrataPackedScoring.ts` and the plan/memory for the build.

### Gaps & issues (deduplicated, with severity and who raised it)

| # | Severity | Issue | Raised by | Suggested action |
| --- | --- | --- | --- | --- |
| G1 | **Medium (actionable)** | `strataPackedConverge` is a separate opt-in; at ε=0 it's inert, so the only configs where it matters are those where OFF ships a known best-seen-invariant violation "for zero benefit". | R2-A2 (+R1-A, R2-A1 in spirit) | Make it **auto-engage** when `ε>0` or `strataSiftRelocate` is on (keep byte-identical at ε=0). |
| G2 | Low–Medium | Descent capped at exactly **2 passes**; field iterates to a fixed point (~5–10 rounds). The `!changed` break exists; only the hard cap binds. | R1-A, R2-A1, R2-A2 | Bounded fixed-point loop (cap 5–10, break on no-change) instead of literal 2. Weigh vs geometry-oracle cost. |
| G3 | Low | **Narrow candidate pool** vs all-positions global sifting; sift bases generated from initial+final snapshots only, never regenerated against the rolling incumbent (selection-surface staleness, Config B). | R1-A, R2-A1, R2-A2 | Optional: wider/global-sifting move set; owner-gated (measured churn tradeoff). |
| G4 | Low (fidelity nit) | `cr` counted **per-arrow** but attributed to Ware's **per-intersection** `sp-ex` (Dawson 2015). Underprices dense multi-cross arrows. Unproven; monotone-related; relative use. | R2-B2 | Soften the code comment, or verify Ware primary. |
| G5 | Low (infra) | Ware 2002 (`doi-10-1057-palgrave-ivs-9500013`) is **metadata-only in graph-layout-rag** — coefficients can't be locally verified. | R2-B2 | Ingest the primary PDF into the corpus. |
| G6 | Low (stats) | **No multiple-comparison / FDR control** across the many battery-cell bootstrap CIs. Mitigated by conservative all-must-pass gate direction. | R1-B, R2-B1, R2-B2 | Add Benjamini–Hochberg/Holm note over REPORT cells, or pre-register one primary endpoint per battery. |
| G7 | Low (validity) | **Q7-axis is n=1 rater** (owner); Wilson interval covers item-sampling only, not rater variance. | R1-B, R2-B1, R2-B2 | Get 3–5 external raters before treating direction-reading as settled. |
| G8 | Low (objective) | Lexicographic `crossings ≻ … ≻ length` = **infinite exchange rate**; literature prices a crossing finitely. **Self-documented + ε-gated + owner-adjudication pending** — not a hidden mistake. | R1-A, R1-B, R2-B1, R2-B2 | Owner decision on ε default; optionally report stress alongside (Chimani 2014 `doi-10-1007-978-3-662-45803-7`). |
| G9 | Low (process) | **elkjs "not bit-reproducible" claim never measured** — the cheapest falsification arm was waved off on an unverified assertion. | R2-C2 | Run the elkjs determinism arm, or downgrade the claim to "unverified". |
| G10 | Low | Canonical **Brandes-Köpf / P5 straightening still unbuilt** while the packing axis accumulates bespoke passes (A7, coordRepack, sift, converge). Task-metric-covered by A7. | R1-C, R2-C1, R2-C2 | Consider a size/port-aware alignment pass (`doi-10-1007-978-3-319-27261-0-12`) if A7/coordRepack plateau. |

### What the audit rated as _above_ typical practice (do not "fix")

- **Scoring candidate orderings on real placed geometry** (skyline trial-placement + exact segment-rect crossing semantics), not ordinal proxy crossings — most published pipelines never validate the proxy against the rendered drawing.
- **Exact integer geometry** (doubled coordinates, integer `orient2`, cross-multiplied rational barycenters) — eliminates float-ULP tie hazards; deterministic/diff-stable by construction.
- **Faithful Ware-2002 rt̂** with the subtle details right (intercept omitted, `cr`-on-path, bounded path lengths, "relative use only") + the rt̂ attenuation model for interactive highlight (no known literature analogue).
- **Self-falsifying audit cadence** — the repo repeatedly overturns its own prior claims with measurement (DI-NS-4 "cannot compose", the 3.89% Y-census, "crossings primacy", R9 proxy-blindness).
- **BK-2020-erratum awareness** — cited and mandated; missed by most industrial implementations.

---

## Key literature (doc_ids cited across the audit)

- **Sifting / crossing-min:** `forward-10-1007-3-540-46648-7-22` (Matuszewski et al., sifting to fixed point), `jgaa-2677-global-k-level-crossing-reduction` (Bachmaier, block sifting; "~10 rounds"), `openalex-10-1007-3-540-44541-2-24` (speeding up sifting), `openalex-10-1007-3-540-45848-4-10` (OSCM NP-hard), `forward-10-1287-ijoc-11-1-44` (GRASP/path-relinking).
- **Compound / clustered layout:** `sander-compound-directed-graphs` (Sander 1996), `forster-compound-crossing-gd2002` (Forster GD2002), `openalex-w1530155803` (Forster diss), `openalex-10-48550-arxiv-2312-07319` (top-down compound), `doi-10-4230-lipics-gd-2024-48` (model-order Sugiyama).
- **Coordinate assignment:** `gansner-tse93` / `openalex-10-1109-32-221135` (network simplex), `s2-6117d268d7f980d8685b6f89f82113eab96dd874` (Brandes-Köpf 2020 **erratum**), `doi-10-1007-978-3-319-27261-0-12` (size/port-aware BK), `crossref-10-7155-jgaa-00500` / `forward-10-1007-978-3-030-04414-5-13` (Jünger-Mutzel-Spisla min-cost-flow coords).
- **Constraint / 2D:** `dwyer-ipsep-cola` (IPSep-CoLa, cited ×104), `research-thread-constraints` (Dwyer-Marriott-Stuckey cluster containment), `openalex-10-1007-11618058-15` (FTA overlap removal).
- **Readability / metrics:** `doi-10-1057-palgrave-ivs-9500013` (**Ware et al. 2002** — the rt̂ source; metadata-only in corpus, see G5), `doi-10-1109-tvcg-2017-2745140` (Sondag stable treemaps / M1_rel), `doi-10-1007-978-3-662-45803-7` (Chimani 2014, "Less Stress and Fewer Crossings"), `arxiv-1908-01769v5` (Stress-Plus-X), `s2-10-48550-arxiv-2409-04493` (Purchase 2024, stress perception), `s2-10-1109-access-2020-3047616` (empirical user-eval survey), `doi-10-1109-apvis-2007-329282` (Huang eye-tracking), plus Dawson-Munzner-McGrenere 2015 (external, cs.ubc.ca — used to triangulate the Ware coefficients).

---

## Recommended next steps (in priority order)

1. **G1 — auto-engage `strataPackedConverge`** when `ε>0`/`siftRelocate` (byte-identical at ε=0). Highest value/lowest risk; directly follows from what shipped this session.
2. **G6/G7 — evaluation hygiene:** add an FDR note over REPORT cells; recruit 3–5 external Q7 raters.
3. **G2 — bounded fixed-point descent** (cap 5–10, break on no-change) if build-time budget allows.
4. **G4/G5 — Ware fidelity:** soften the `cr` comment + ingest the Ware 2002 PDF into graph-layout-rag.
5. **G8 — owner ruling** on the ε default (crossings-vs-length exchange).
6. **G9/G10 — deferred:** run the elkjs determinism arm; revisit BK/P5 straightening if A7 plateaus.

---

## Provenance

- Audit run 2026-07-15 on branch `strata-v3.2-w5-w10b`. 9 Fable research agents (3 + 6), blind Round 2, neutral + prosecutor roles. Read-only; no code changed by the audit.
- Related: `strataPackedConverge` build (this session) — see `~/.claude/plans/lets-do-a-real-cozy-eich.md` and memory `strata-row-order-nonconvergence`.
- Source-of-truth for the methodology being audited: `docs/rcll-v2-architecture-decision.md`, `docs/rcll-v2-spec-v3.1.md` / `-v3.2.md`, `docs/strata-view-*.md`, `docs/rcll-loose-leaf-edge-length-research.md`, and the `terraformPipelineStrata*` sources.
