# RCLL — minimizing Y-edge-length for loose / leaf resources (research + recommendations)

**Date:** 2026-06-24 **Question (user):** loose resources (standalone S3 buckets, DynamoDB tables) are pushed to the top of their column, so their single edge is stretched much longer than necessary. "I think I made a 'push loose resources up' decision and it was wrong, and it's fighting the Y-adjust that minimizes hierarchical edge length." How do we minimize edge length by Y-adjust — for loose resources first, but **containerized and hierarchical**, even if it doesn't move the metric on the dense canonical preset today?

**Method:** four parallel research streams — codebase mechanism (file:line + git), Y-axis design history (`docs/pipeline-rcll-layout-design.md` + `docs/rcll-code-map.md`), graph-drawing literature (graph-layout-rag), and practitioner/internet best practices.

---

## 1. Diagnosis — there was no "push loose resources up" decision to undo

The most important finding: **there is no degree-based / "loose-resource pusher" anywhere in the code.** The "pushed up" symptom is an _emergent_ conflict between two mechanisms, and your mental model ("I made a bad rule, remove it") is slightly off — there is nothing to remove; there is a half-finished phase to complete.

**Mechanism A — top-anchored, source-order column stack (always on, cannot be disabled).** Every node's _initial_ Y is assigned by stacking top→down from the container content-top (`startY`), ordered by `(minDescendantSequence, key)` — **neighbor position is never consulted**.

- `placeForcedBands` — `terraformPipelineRcllPlacement.ts:402-413` (`cursorY = startY` … `cursorY += height + gap`)
- `placePackedColumns` — `terraformPipelineRcllPlacement.ts:419-441` (first child per column = `startY`, line 433)
- `layoutLanesOnAxis` non-straighten leaf stack — `terraformPipelineRcllPlacement.ts:899-911`
- Order key `minDescendantSequence` = min **source-encoding sequence** of a node's descendants — `terraformPipelineRcllModel.ts:125-138`. A standalone S3/DynamoDB leaf with a low `firstSequence` sorts to the **front of the column → container top**.

This was a deliberate, _documented_ milestone choice, not a mistake. Commit **`c25f0b2a1`** (M3a, 2026-06-17): _"packed = column-stack … stacked top-down by (minDescendantSequence, key). **Intentionally un-centered (centering is M5/T5)** and no row-sharing (M7/T6) — the honest Sugiyama coord."_ The un-centered top-anchor was always meant to be fixed later by the straightening phase.

**Mechanism B — the Brandes–Köpf straightener (`straighten=1`) that was supposed to fix it, but is crippled three ways.** `applyStraightening` / `applyStraighteningWithOccupancy` — `terraformPipelineRcllPlacement.ts:444-499`, `:769-814`; core `straightenColumns` / `alignAndCompact` — `terraformPipelineStraighten.ts:60-269`. It computes a balanced neighbor-median Y (`avg = (down+up)/2`, `:240-242`) — which is correct — but then three things defeat it for loose leaves:

1. **Asymmetric clamp — it can only push DOWN, never lift UP.** The lane path re-clamps the aligned Y via `riseStackY(..., Math.max(segmentTop, proposed), true)` (`:799-805`), and `riseStackY` only ever _raises_ Y to clear overlaps and **floors at `startY`** (`:1106-1121`). The packed path walks each column `top = Math.max(avg, cursor)` (`terraformPipelineStraighten.ts:252`) and then **normalizes the topmost leaf back to `segmentTop`** (`:257-267`). So a leaf can be pushed _down_ to respect ordering/overlap, but **cannot be lifted up to meet a lower neighbor** — and the normalize-to-top step actively re-pins the column's first leaf to the top.
2. **No dummy nodes / one-column reach only.** B–K here chains only through neighbors exactly **one column away** (`terraformPipelineStraighten.ts:21-24`). A loose leaf whose only neighbor is several columns away (or later-sequenced) has _no_ adjacent-column anchor and stays un-aligned at the column top.
3. **Single normalization re-imposes the top bias** — the literature's whole point (see §3) is that you average the four passes and let the result stand; normalizing the top leaf back to `segmentTop` throws that away.

**Net:** A pins the loose leaf to the top by source order; B is structurally unable to pull it back down to its neighbor; its edge stretches the full column height. That is exactly the reported symptom.

> Two populations, do not conflate them. (a) **Genuinely unconnected** resources are already handled correctly by the ancillary "Unconnected" bands placed _below_ content (`placeAncillaryBands` `:1286-1311`, DI-ANC-1..6) — that's a _packing_ problem, not a coordinate problem, and is not the culprit. (b) Your S3/DynamoDB examples **have an edge that is too long** — that is the _coordinate-assignment_ problem above. The fix targets (b).

---

## 2. What the literature says the fix is (all four streams agree)

The "loose leaf pinned to the top of a column" symptom is the **textbook signature of a coordinate-assignment phase with no working neighbor-centering objective** — equivalently, ELK's `SIMPLE` strategy or a single-direction Brandes–Köpf pass without the four-run **balancing**. Every canonical fix replaces the top-anchor with a step that minimizes edge length toward the neighbor's coordinate. A degree-1 leaf is handled _for free_ by all of them because it has a single, unopposed pull term.

| Technique | Source | Core idea | Fit here |
| --- | --- | --- | --- |
| **Priority / median method** | Gansner GKNV93 (TSE93.pdf); Handbook of GD §13.6 | Sweep; move each node to the **median of placed neighbors**; high-degree/dummy nodes win ties. A leaf is _lowest priority_ → slides all the way to its single neighbor. | Simplest correct fix; maps onto "slide within band, don't overlap siblings." |
| **Brandes–Köpf + 4-run balancing** | Brandes–Köpf GD'01; erratum Brandes–Walter–Zink 2020 (arXiv:2008.01252) | Align each vertex to its **median neighbor** into blocks; run leftmost/rightmost × up/down; **average the four** to kill the top/left bias. O(N). | **You already have ~⅔ of this.** The missing piece is removing the down-only clamp + normalize-to-top and letting the balanced value stand. |
| **Size-/port-aware B–K** | Rüegg et al., ELK, GD'15 | B–K extended so real node **sizes and ports** are honored during alignment. | The production form for variable-size nodes living in frames — the natural target architecture. |
| **VPSC + cluster containment** | Dwyer–Koren–Marriott IPSep-CoLa TVCG'06; **Dwyer–Marriott–Stuckey 2005 (cluster containment)** | Set each leaf's _desired_ Y = neighbor's Y; solve per-axis QP for the **nearest feasible Y under non-overlap + "stay inside parent bbox"**. | **The exact match for "containerized & hierarchical."** Containment is just one more separation constraint; runs on the Y axis alone, leaving X/ranks untouched. |
| **Min-cost-flow coord assignment w/ prescribed width** | Jünger–Mutzel–Spisla GD'18 (jgaa paper500) | Minimize total edge length **while bounding max width** and per-pair min/max gaps; can force chosen edges straight. | The optimal option when you also want to cap frame width. |
| **Network-simplex on auxiliary graph** | Gansner GKNV93 | Exact min total weighted edge length; edge-type weights real-real=1, real-virtual=2, virtual-virtual=8 (keep long/dummy chains straight, still pull real leaves). | You already shipped NS on the **X** axis (`columnPacking:"shorten"`); this is its **Y** analog. |
| **Dummy nodes for column-skipping edges** | standard Sugiyama; **= your DEC-5** (PARKED/OPEN) | Insert virtual nodes along long edges so multi-column edges have a chain to align along. | **Prerequisite** for fixing the distant-neighbor leaf subclass (Mechanism-B limitation #2). |

---

## 3. What is CLOSED — do not re-propose

From the Y-axis decision ledger (`docs/pipeline-rcll-layout-design.md`):

- **Per-container / local-frame hull X-stagger + Y-rise → NO-GO** (DEC-12(B), DI-DEB-4/5): illegal cross-account edge inversions **and** height _rose_ +2.7%. This is about moving **whole hulls**, which is a different axis from leaf coordinate assignment — your loose-leaf ask is **not** this closed door, but don't accidentally reframe it as one. (The _global_ form, `rankSeparate`/DEC-13, is the shipped GO.)
- **Median hub-centering as the straightening target → superseded** (§9.5 item 1): it "buys its own metric by spending straightness" (crossings 247→274, near-straight halved). Lesson: gate any new centering on **near-straight + crossings**, not just the centering rate.
- **The straightener (B–K A1) measured NO-OP on the dense canonical preset v2** (§9.5 item 2) — _because of column density (Axis-2), not optimizer quality_: 85% of v2 edges are adjacent-column with no Y-room. **This does not apply to loose leaves**, which are by definition the sparse tail _with_ Y-room — so completing the straightener can help the loose-leaf subpopulation even though it was inert in aggregate. This is the key reason your "do it even if the metric doesn't move today" instruction is correct: the architecture is right, v2's density just hides the win.

**OPEN / parked doors you can use:** DEC-5 dummy nodes (the named escalation for long-edge straightness), DEC-10 independence gap, and the whole VPSC family (not yet tried on the leaf axis).

---

## 4. Recommendations (ranked, mapped to code)

### R1 — Unclamp + de-bias the straightener you already have (smallest correct fix)

Targets Mechanism-B defects #1 and #3 directly.

- Allow the balanced median Y to **lift a leaf upward**, bounded only by the **container content box top** (containment), not by `startY`-of-current-stack. I.e. replace the `Math.max(segmentTop, proposed)` / `riseStackY` floor (`terraformPipelineRcllPlacement.ts:799-805`, `:1106-1121`) with a true two-sided placement clamped to `[containerTop, containerBottom]`.
- **Drop the normalize-topmost-to-`segmentTop`** step (`terraformPipelineStraighten.ts:257-267`); let the four-pass average stand (this _is_ B–K balancing).
- Gate behind a new default-OFF toggle (e.g. `straightenLift` or fold into `straighten` v2), measure on a **sparse** preset, not just v2.
- **Risk:** low; reuses built infra. **Watch:** crossings + near-straight (the §9.5-item-1 trap), and containment collisions (re-run the CON gates).

### R2 — Per-container VPSC pass on Y with containment (the architecture you actually asked for)

"Containerized and hierarchical even if it doesn't reduce edge length today" = this. Add a Y-only constraint solve per container: **desired Y = median of connected neighbors; constraints = sibling min-gap (non-overlap) + stay-inside-parent-bbox** (Dwyer–Marriott–Stuckey cluster containment). Generalizes beyond loose leaves to every node, composes with the existing hierarchy (run bottom-up per frame), and is provably containment-safe. This is the principled replacement for the ad-hoc `riseStackY` clamp. Larger build; the right long-term target. Consider the **size-/port-aware B–K** (ELK Rüegg'15) as a lighter-weight middle path that still honors node sizes + frames.

### R3 — Dummy nodes (DEC-5) for distant-neighbor leaves (prerequisite for the hard subclass)

A loose leaf whose neighbor is several columns away can't be aligned by _any_ one-column-reach method. Activating DEC-5 (virtual nodes along column-skipping edges, with GKNV edge-type weights 1/2/8 so the dummy chain stays straight) is the prerequisite that makes R1/R2 work for that subclass. Already named in the docs as the escalation — this is the trigger.

### R4 — A Y-axis network-simplex (symmetry with the shipped X-axis `shorten`)

You already built exact Gansner NS for the **X** axis (`columnPacking:"shorten"`). The auxiliary-graph NS minimizes total weighted edge length on **either** axis. A Y-axis variant, run _within container bounds_, is the exact-optimum version of R1/R2. Highest fidelity, most work; only worth it if R1/R2 measure well and you want the optimum. Note the X-axis lesson from memory: **exact-to-optimum is required** (heuristics stalled at −7–10% false wins).

---

## 5. Suggested first move

Do **R1** behind a default-OFF toggle and measure on a **deliberately sparse preset** (the loose-leaf regime), reporting median edge ΔY + near-straight + crossings + CON gates A/B. That validates the unclamp hypothesis cheaply and tells you whether to invest in the R2 VPSC architecture. If R1's distant-neighbor leaves stay stuck, that's the signal to pull in **R3** (dummy nodes) before R2. Keep the canonical-preset NO-OP expectation explicit — the win shows up on sparse layouts, exactly as your instinct said.

---

### Primary sources

Gansner GKNV93 `https://www.graphviz.org/documentation/TSE93.pdf` · Handbook of GD §13.6 `https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/hierarchical.pdf` · Brandes–Köpf GD'01 `https://link.springer.com/chapter/10.1007/3-540-45848-4_3` + erratum `https://arxiv.org/abs/2008.01252` · ELK size/port-aware B–K (Rüegg GD'15) `https://link.springer.com/chapter/10.1007/978-3-319-27261-0_12` · Dwyer–Marriott–Stuckey cluster containment `http://marvl.infotech.monash.edu/~dwyer/papers/fnr.pdf` · IPSep-CoLa TVCG'06 (DOI 10.1109/tvcg.2006.156) · Jünger–Mutzel–Spisla GD'18 `https://link.springer.com/chapter/10.1007/978-3-030-04414-5_13` · ELK node placement `https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-nodePlacement-strategy.html`
