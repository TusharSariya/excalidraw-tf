# strataXCompact — investigated, built, and REMOVED (findings)

**Status:** removed. The `strataXCompact` horizontal-compaction feature was built (commit `e2afd3a69`, then reworked to a column-grid variant), measured, found to be either **harmful** or **inert** on the real preset, and **reset out** back to baseline `bfcaedf11`. This doc records why, so nobody rebuilds it.

**TL;DR:** The owner's readability complaints (colinear cards, split peers, unequal columns, near-vertical arrows) were **artifacts of the greedy compaction itself**, not pre-existing defects. Removing the operator restores the clean baseline `columnX` grid. The _remaining_ horizontal dead space (nodes stranded far right, e.g. Account-04) is **LR-mandated** and cannot be removed by any column-reindexing pass without breaking left-to-right edge flow (the owner's #1 constraint) or re-ranking (proven catastrophic). The correct tool for real LR-safe compaction is a **network-simplex X-coordinate solve** (Gansner), which may already exist in-repo as `pipelineColumnPacking:"shorten"`.

## What was tried (three operators, all on the frozen preset `staging-extended-localstack-v2`)

1. **Greedy leftmost-pack** (`e2afd3a69`). Each unit slides independently to `min(deltaLr, deltaContain, deltaCollision)`, Y-frozen, clamped ≤ current x. It **discards the rank-column grid** strata already builds (`rankStrataClusters` → `columnX`, the only source of shared columns / uniform widths / gutters). Result: removed some dead space but produced exactly the owner's four defects —

   - **config/log colinear with s3** — collision only blocks Y-_overlapping_ obstacles; on different rows nothing blocks, so unrelated cards all pack to the same wall → same X.
   - **dynamodb/rds not sharing a column** — same mechanism, opposite face: different rows → different leftmost X; nothing re-couples peers that `columnX[sameRank]` used to align.
   - **unequal vpc-5b5 nested-column widths** — operator writes `x` only; uniform width was purely `columnWidths[col]=max` in the discarded grid.
   - **near-vertical arrows** — pulling a target to its LR lower bound _is_ the `centreX(t)≈centreX(s)` position. Leftmost-legal = vertically-aligned.

   All four are **inherent to per-node greedy packing**, not code bugs. Confirmed by a 4-agent research sweep (literature + codebase + defect-trace + design): _no serious layered engine (dot, ELK, dagre, yFiles) produces the free axis by greedy packing_ — they all do alignment-then-balanced-compaction, i.e. minimize width **subject to** a separation floor and shared-column identity. Regularity is a constraint; compaction is the objective minimized under it — never a standalone greedy pass.

2. **Per-hull column-grid snap.** Replaced the greedy target-X with a per-hull grid: each hull re-indexes its own ranks contiguously (drop per-hull-empty columns = compaction), uniform slot width, gutter baked into `colLeft`, snap via the rigid Y-frozen translator. Unit-tested green (shared columns, uniform width, gutters, no near-vertical). **But INERT on the real preset:** independent per-hull empty-rank collapse makes local column indices non-monotone across hulls → **28 new backward cross-hull edges** → the `LR-as-a-SET` guard correctly rejects the whole candidate → falls back to baseline. The design's assumption that within-hull monotonicity implies cross-hull LR is **empirically false**.

3. **Global shared column-grid snap.** One scene-wide rank→X map (collapse only _globally_-empty ranks, scene-wide uniform slot width). **LR-safe by construction** (0 backward edges — a single monotone map keeps every forward edge's target column strictly right of its source). **But also INERT on this preset, for the opposite reason:** the preset has **all 123 cards at exactly 346px** (uniform width already) and **all 16 ranks globally populated** (no globally-dead columns). The existing `columnX` grid (pitch 346+150) _already is_ the LR-safe global uniform grid, so the snap reproduces it exactly (`nonZeroDx=0`).

## The core result (both directions measured)

| approach | LR | compaction on preset | why |
| --- | --- | --- | --- |
| greedy leftmost-pack | **breaks it** (fakes compaction by inverting/aligning edges) | some, but ugly | discards the grid |
| per-hull grid | breaks it (28 backward edges) → rejected | none (rejected) | local indices non-monotone across hulls |
| global grid | safe (0 backward) | none | ranks globally full + cards uniform width ⇒ nothing to collapse |

The only horizontal dead space that exists on this preset is **per-hull** (a rank empty within one hull but occupied by another). Collapsing it is precisely what breaks cross-hull LR. **There is no free lunch:** per-hull-tight-compaction and global-cross-hull-LR are in direct conflict, and LR wins (owner's #1).

## Why the stranding is LR-mandated (Account-04)

A node stranded far right has a high rank _because it genuinely depends on an upstream node_ (an incoming edge from a lower rank). Its rank IS its LR lower bound. Pulling it left of that source reverses the arrow. So Account-04-style stranding is a **ranking/topology** consequence, not free dead space — no rank-preserving column pass (greedy or grid) can fix it. Re-ranking to shorten it is proven catastrophic (global length-min ranker: +176…+215 crossings, height ×4.3 — see `docs/strata-readability-synthesis-2026-07-15.md`).

## Recommendation for real LR-safe compaction (not built)

If measurable width reduction is wanted, the principled tool is a **global coupled network-simplex X-coordinate assignment** (Gansner TSE 1993: minimize Σ weighted edge length **subject to** a rank-separation floor ρ). It pulls stranded nodes as far left as LR _allows_ without ever inverting an edge, and the ρ floor gives gutters + forbids near-vertical edges. **The codebase may already have this** as `pipelineColumnPacking:"shorten"` (network-simplex, exact Gansner, ~−8.4% width, default-off — see the RCLL X-axis network-simplex work). **Next step if compaction is revived: check whether `pipelineColumnPacking:"shorten"` is wired for the strata view and what it does there — it is very likely the tool the owner actually wanted; `strataXCompact` was the wrong knob.**

## Research artifacts (ephemeral, in scratchpad/ at time of writing)

`scratchpad/xcompact-columns-research-{1-literature, 2-codebase, 3-defects, 4-design}.md` — the 4-agent sweep behind this doc (Brandes–Köpf / Gansner / Sander / IPSep-CoLa literature; the `columnX` grid facts; per-defect mechanisms; the column-model design). Fold into `docs/` if this work is ever revived.

## Bottom line

- **Shipped:** removal of the harmful greedy operator. Baseline `columnX` layout (`strataXCompact` never existed) is already the clean columnar layout — verify with the demo URL by simply **not** passing `strataXCompact=1`.
- **Not a column problem:** the remaining stranding is ranking/routing, tracked separately.
- **If revived:** use network-simplex (`pipelineColumnPacking:"shorten"`), not a greedy pack or a naive grid.
