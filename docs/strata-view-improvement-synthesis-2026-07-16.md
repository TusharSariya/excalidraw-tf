# Strata view improvement — literature synthesis (8-agent research + adversarial cross-examination)

**Date:** 2026-07-16. **Question:** are the observed layout problems (P1–P5, see `docs/strata-problems/`)
*expected* given strata's algorithms, and what **robust, generic, literature-backed** fixes exist —
not edge-case hacks? **Method:** 8 opus research agents (graph-layout-rag + open literature + code),
then 4 adversarial cross-examinations that overturned two headline claims. All claims cited (author/year +
rag doc_id or DOI). Sources: `scratchpad/strata-research-agent{1-8}-*.md`,
`scratchpad/strata-problem-crystallization.md`.

## BLUF

- **The problems are strata-specific, NOT inherent to Sugiyama.** Two bespoke choices cause everything:
  (1) `rankSeparate`/OD-14 puts sibling **separation on the layering axis** (should be at coordinate
  assignment — *every* canonical treatment does), which strands low-degree sinks/blocks far from their
  sources (P1/P3/P4); (2) `dropY` is a **skyline strip-packer used as the sole coordinate mechanism** with
  height unscored (P2/P5).
- **The tempting "principled" fixes are measured/reasoned DEAD-ENDS** — network-simplex re-ranking (any
  form, incl. the constraint-augmented joint solve) is a **measured NO-GO** (`strata-view-w5b-joint-ns-probe.md`);
  a constraint-layer hits the same wall; global/grid X-compaction is walled + was already removed.
- **The surviving prescription re-validates the prior 13-agent synthesis** from three independent angles:
  a **targeted, guard-gated X-shift** of specific over-ranked sinks/blocks, under a **height *gate*** (not a
  global height objective), plus **border-node routing** for pierces and a **transpose pass** for ordering,
  and a **principled Y-compaction** to replace `dropY` for height.
- **Comprehension is driven by crossings / edge-length / pierces; box *height* is the weakest comprehension
  metric.** Your height invariant is right *as a gate*, over-reaching *as a global objective*.

---

## 1. Diagnosis — expected, and why (unanimous across 8 agents)

**Ranking (root of P1/P3/P4).** Strata's `rankSeparate` = longest-path layering over a DAG augmented with
**all-to-all sibling-separation edges**, which turns sibling *ordering* into rank *distance*. Plain
longest-path already places a degree-1 sink at `source+1` and a fan-in block at `max(source)+1` (the
crystallization's "base floor"); the stranding to rank 15 / r27–29 is **manufactured by the separation
edges**. Every canonical method puts separation at **coordinate assignment**, never at layering
(Brandes–Köpf `elk-10-1007-3-540-45848-4-3`; Dwyer IPSep-CoLa `dwyer-ipsep-cola`; Gansner TSE93
`gansner-tse93` whose `min Σ ω·edge-length` objective exists precisely to prevent this L1 blowup).
Stranding is the *documented cost* of longest-path's height benefit (Handbook of Graph Drawing ch.13) —
`rankSeparate` is a **−42% height lever** and sink-stranding is what it pays for that.

**Packing (root of P2/P5).** `dropY` is textbook **skyline / bottom-left strip-packing** (Baker–Coffman–Rivest
1980; VLSI left-edge track-assignment) — a method for compacting an *unordered set*, misapplied as the
*coordinate assignment* of edge-connected leaves. It fixes X, derives Y greedily, and leaves **height an
unscored by-product** with **no edge-length objective on Y at all**. The standard tools (network-simplex
X-coords; Brandes–Köpf) treat the cross-axis extent as a *constrained bound*, never an emergent number.

**One-line root cause:** strata mis-places two things — **separation onto the layering axis** and
**packing in place of coordinate assignment** — so sinks strand far from sources (long edges, pierces,
wide/tall boxes) and every naive counter-move trades width for height.

---

## 2. Dead-ends — measured or reasoned (do NOT re-attempt)

| Approach | Verdict | Evidence |
|---|---|---|
| Global / greedy / grid **X-compaction** | **Removed / walled** | `docs/strata-xcompact-removed-findings.md`: greedy → colinear/near-vertical; per-hull grid → 28 backward edges; global grid → **inert** (ranks globally full, cards uniform-width). |
| **NS-rank, `rankSeparate` off** (plain Gansner) | **Loses −42% height → ×4.3 height** | Config flip (`strataNetworkSimplexRank:true` + `strataRankSeparate:false`) — testable today; height blowup predicted, cheaply confirmable. |
| **Joint constrained NS** (separation as zero-weight constraints) | **Measured NO-GO** | `docs/strata-view-w5b-joint-ns-probe.md` (2026-07-12): held height (14,105 vs 14,126) but crossings-on-path +6/+7, rt̂ p90 +4.5/+5.4. |
| **Constraint-layer** (IPSep-CoLa / SetCoLa optimizing rank-span) | **Same wall** | The joint NS *is* this philosophy; it failed for a reason intrinsic to the rank-span objective — shortening a sink's span **densifies its column** → more path crossings. |

**The deep lesson: rank-span compression is the wrong lever.** Any objective that pulls a sink to a tighter
rank densifies the target column and pushes crossings onto traced paths. This is *why* the fix must be a
*targeted geometric shift of individual low-degree sinks*, not a ranker change.

---

## 3. The surviving toolkit — robust, literature-backed, mapped to P1–P5

| Lever | Fix | Solves | Literature | Robust? | Fit |
|---|---|---|---|---|---|
| **A** | **Targeted, guard-gated X-shift** — move a specific over-ranked **degree-1 sink / pure-sink block** toward its source, off-grid, into existing dead space; crossing-neutral *by degree*; keep `rankSeparate`. | P1, P4, P3-width | prior 13-agent synthesis #1; contrasts NS (Gansner) | Robust *if guarded* (unguarded = the removed pass) | Additive post-pass; **no re-architecture** |
| **C** | **Height GATE** (maintain-or-decrease) + **VPSC slack-aware local Y-repair** — accept an A-move only if `dropY` re-lays the hull height-neutral-or-better. | enables A; P5 | Coffman–Graham / Jabrayilov Compact Generalized Layering (`doi-10-1007-978-3-319-50106-2-17`); Dwyer VPSC (`dwyer-ipsep-cola`) | Robust; **provably cannot regress −42% height** (monotone) | Extends existing ε-band accept; **no LP solver** |
| **B** | **Per-rank weighted-median + TRANSPOSE (adjacent-exchange) pass**, iterated, scored on **true rendered segment intersections**. | P2 | Gansner `dot` transpose (`gansner-tse93`); Eades–Wormald 1994 (NP-completeness ⇒ need it) | Robust; the primitive strata lacks | Added pass; **PREREQ: fix the inverted-chord crossing proxy** (prior objective audit bug) |
| **D** | **Border-node insertion / routing** for cross-container edges — cross the VPC frame **once, cleanly at the boundary**. | P3-pierce | Sander 1996 (`sander-compound-directed-graphs`); Forster 2002 (`forster-compound-crossing-gd2002`) | Robust, 30-yr-deployed | Additive; **pierce is topologically floored at 1** — minimizes, can't eliminate |
| **Y-comp** | **Principled Y-compaction** (network-flow / longest-path, **columns frozen**) to replace greedy `dropY`. | P3-region-height, P5 | Brandes–Köpf §4.2 horizontal compaction (`elk-10-1007-3-540-45848-4-3`); network-flow compaction | Robust; **monotonically reduces height, can't grow width or break LR** | Replaces the `dropY` anti-pattern for connected leaves |

**Deferred endgame:** replace longest-path+`dropY` wholesale with NS-rank + size/port-aware Brandes–Köpf
(Rüegg 2015 `elk-10-1007-978-3-319-27261-0-12`) — but NS-rank is a measured NO-GO here, so this is
**not** recommended until the targeted operators are exhausted.

### Crucial reconciliation (from cross-examination)
- **Width/pull-left cannot be a coordinate move** — it's walled on this preset (full ranks + uniform cards +
  hard LR). So **Lever A is a *rank-level, surgical, off-grid* relocation of individual sinks**, not a
  coordinate compaction. Global = walled; targeted-guarded = works (the 71,300px dead space the removed
  greedy pass proved exists is reachable one sink at a time, under guards).
- **Height gate vs objective:** height as a *maintain-or-decrease gate* is theorem-backed (Compact
  Generalized Layering) and can't regress height; height as a *global objective* is weakly supported and
  is **not** recommended (Agent 7). Your invariant is right — as a gate.

---

## 4. Sequenced build plan (proposal — nothing built)

1. **Lever C first** — the height gate + VPSC slack repair. Small, additive, unblocks A, provably height-safe.
2. **Lever A gated by C** — targeted sink/block relocation. Biggest visual win (P1 DLQs, P4 account block,
   P3 region width). Start with degree-1 sinks (crossing-neutral), then pure-sink blocks (clamped to
   max-source rank).
3. **Y-compaction** — replace `dropY` for connected leaves (P3 region height, P5). Independent of A/C.
4. **Lever B** — transpose pass, **after** fixing the inverted-chord crossing proxy (P2).
5. **Lever D** — border-node routing (P3 pierce), after A proves the region-size win.

**Acceptance gates (all opt-in, default-off, byte-identical when off):** LR never relaxed; per-box
`{y,height}` exact under the gate; width/edge-length down; crossings-on-path ≤ baseline; **height
maintained-or-decreased**; pierces ≤ baseline (floored at 1). Measure on the frozen H0 harness +
`staging-extended-localstack-v2`.

---

## 5. Honest framing for the owner (where research disagrees with the eyeball)

- **Comprehension metrics rank: crossings → path-continuity/bends/crossing-angle → pierces** (Purchase 1997
  `s2-10-1007-bfb0021827`; Ware 2002 `doi-10-1057-palgrave-ivs-9500013`; Huang 2010 `doi-10-1145-1865841-1865854`).
  **Box height/area is the weakest comprehension driver.** The long-edge and pierce problems are genuinely
  high-impact; the *box-size* problem is largely aesthetic/screen-space.
- **The pierce cannot be eliminated** — an in-VPC source → region-level (`vpc=none`) sink must cross the
  frame an odd number of times (min 1). Border-node routing minimizes it to one clean crossing; only a
  containment change (factually wrong here) removes it.
- **"Hulls may grow in height, leaves may not"** is a *plausible, constructible* typed constraint (SetCoLa /
  IPSep-CoLa) but **not a named empirical finding** — your inference, defensible as a constraint, not a law.
- **The width you want to reclaim is largely LR-mandated** (a stranded node's rank *is* its dependency
  floor); the targeted operator recovers what's geometrically free, not the rank-mandated part.

## 6. Cheap experiments you can run today (no build)
- **Confirm the NS-rank NO-GO** for the plain end: `strataNetworkSimplexRank:true` + `strataRankSeparate:false`
  on `staging-extended-localstack-v2` via the H0 harness — expect the ×4.3 height blowup.
- The joint-NS end is already measured (`strata-view-w5b-joint-ns-probe.md`).

## Citations (rag doc_id / DOI)
Gansner TSE93 `gansner-tse93`; Brandes–Köpf `elk-10-1007-3-540-45848-4-3`; Rüegg size/port-aware
`elk-10-1007-978-3-319-27261-0-12`; Sander compound `sander-compound-directed-graphs`; Forster
`forster-compound-crossing-gd2002`; IPSep-CoLa/VPSC `dwyer-ipsep-cola`; Jabrayilov Compact Generalized
Layering `doi-10-1007-978-3-319-50106-2-17`; Klau–Mutzel `doi-10-1007-3-540-48777-8-23`;
Bannister–Eppstein–Simons `jgaa-2643-inapproximability-of-orthogonal-compaction`; Healy–Nikolov
`doi-10-1007-3-540-45848-4-2`; Purchase `s2-10-1007-bfb0021827`; Ware `doi-10-1057-palgrave-ivs-9500013`;
Huang count-vs-angle `doi-10-1145-1865841-1865854`. New-to-corpus harvests: see
`docs/graph-layout-rag-missing-literature.md` §N (Coffman–Graham 1972, Baker–Coffman–Rivest 1980,
Patrignani 2001, Eades–Wormald 1994, Jünger–Mutzel 1997, Doğrusöz 2009; +Nikolov–Tarassov–Branke 2005 full-text).
