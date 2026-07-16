# strataXCompact — root cause of the four (+1) column defects

Preset `staging-extended-localstack-v2`, `view=strata`, `strataXCompact=1`. Static, code-grounded diagnosis. Files:

- Operator: `packages/excalidraw/components/terraformPipelineStrataXCompact.ts`
- Pre-compaction column grid: `packages/excalidraw/components/terraformPipelineStrataRank.ts`
- Placement / grid consumption: `packages/excalidraw/components/terraformPipelineStrataPlacement.ts`
- Design: `docs/strata-xcompact-deadspace-design.md`

---

## The load-bearing fact: what the operator throws away

Before compaction, Strata has a genuine **column model** built in `rankStrataClusters`:

- `columnWidths[col] = max(unitWidthOf(id))` over every cluster whose `rank === col` (`terraformPipelineStrataRank.ts:186-192`) — a **uniform per-rank column width**.
- `columnX = columnOffsetsFromWidths(columnWidths, 0, PIPELINE_COLUMN_GAP)` (`:194`) — one **shared left-X per rank**, separated by a fixed **gutter** (`PIPELINE_COLUMN_GAP`).
- Every leaf at rank `r` is placed at `x0 = columnLeft(r) = rank.columnX[r]` (`terraformPipelineStrataPlacement.ts:234-237`, `164-172`). So all peers at the same rank are **colinear by construction**, in a column of **uniform width**, with a **gutter** to the next column.

`refineStrataXCompact` never reads `rank`, `columnX`, or `columnWidths`. It reads each unit's **live box `x`** and slides it to the leftmost legal position computed **per unit, independently** (`terraformPipelineStrataXCompact.ts:273-373`). The new X is `currentX − delta`, where

```
delta = floor( max(0, min(deltaLr, deltaContain, deltaCollision)) )   // :357-360
```

There is **no term** in that expression for "align with my rank peers," "keep a uniform column width," or "leave a gutter." The rank-column grid is discarded the moment phase 1 runs. Every defect below is a direct consequence.

---

## Defect 1 — "Account-04 is still NOT shifted left"

**Mechanism.** A hull moves only by `delta = min(deltaLr, deltaContain, deltaCollision)`, clamped `≥ 0` and floored (`:357-363`); `if (delta <= 0) continue` (`:361`). Account-04 is a child-hull _unit_ inside its parent; its `memberBoxes` are its whole subtree (`:274-290`). Any ONE of three bounds going to ~0 pins the entire block:

1. **LR incoming-edge bound** (`:298-318`). For every non-reversed edge `s→m` with `s` external and `m` a member leaf, `deltaLr ≤ centreX(mBox) − centreX(sBox)` (`:313`). This is a `min` over **all** such edges. Account-04 is a pure-sink block fed by external sources; a **single** incoming edge whose source center already sits at/near the target's center forces `deltaLr ≈ 0`. The operator will not move the target left past its source center (that would create a backward edge — LR is never relaxed).
2. **Collision bound** (`:331-355`). Obstacles are all non-member, non-ancestor boxes that **Y-overlap** a member and lie to its left; `deltaCollision = min(m.x − obRight)` (`:337-339`). Y is frozen, so if any Y-overlapping sibling box sits immediately to the left of any one member, `deltaCollision ≈ 0` and pins the block (leftmost **partial** shift = 0).
3. **Containment bound** (`:320-325`). `deltaContain = minMemberLeft − parentInnerLeft` (`parentInnerLeft = bh.box.x + framePad()`, `:257`). If the block already hugs its parent's inner-left edge, this is ~0.

The design (`docs/...:12`) promised the Account-04 block shift as "the single biggest win (−22 crossings / −20 pierce)." That win requires moving the block **and its sources together** (a coupled move) or moving it into a row that is actually empty at its frozen Y. The greedy, **per-unit** pass can do neither: it optimizes each unit in isolation, and the block's own LR/collision bound is tight.

**Verdict: INHERENT to greedy per-unit packing** (a design limitation — greedy single-unit leftmost cannot perform the coupled source+block move the win needs). Not a code bug; the three bounds are computed as specified.

---

## Defect 2 — "config and log purple box are IN LINE with the s3 bucket"

**Mechanism.** Collision only fires for obstacles that **Y-overlap** a member (`yOverlap` gate, `:333`, def `:98-99`). `config`, `log`, and `s3` sit on **different Y rows** (the packed `dropY` skyline stacks X-disjoint siblings on distinct rows, `terraformPipelineStrataPlacement.ts:325-333`), so none of them is a leftward obstacle for the others. With no Y-overlapping blocker, each one's `deltaCollision` is `+∞` and the binding bound becomes **containment**: `parentInnerLeft = bh.box.x + framePad()` — **the same value for all three** (same parent hull, `:257`). Greedy leftmost therefore packs all three to the **identical** leftmost X → they become colinear with the s3 bucket.

Distinct rank columns are collapsed onto one X precisely because "leftmost legal" is the same wall for every unit that shares a parent and has nothing to its left. The operator has no gutter and no per-unit column slot to keep them apart.

**Verdict: INHERENT to greedy leftmost pack.** Column collapse is definitional, not a bug.

---

## Defect 3 — "dynamodb and rds should be in the SAME column but aren't"

**Mechanism.** The exact opposite face of Defect 2, from the same root. Each peer computes its own `delta` independently in the per-unit loop (`:273-373`). Because `dynamodb` and `rds` sit on **different frozen Y rows**, they have **different Y-overlapping obstacles** to their left (different `deltaCollision`, `:331-355`) and **different incoming edges** (different `deltaLr`, `:298-318`). Two different bounds → two different leftmost X → misaligned. Pre-compaction they were aligned only because both had `x0 = columnLeft(sameRank)` (`terraformPipelineStrataPlacement.ts:234-237`); the operator never consults rank again, so nothing re-couples the siblings.

**Verdict: INHERENT to greedy per-unit packing.** There is no shared-column constraint to give peers a common X; not a bug.

---

## Defect 4 — "vpc-5b5's 4 nested resources: column widths should be equal"

**Mechanism.** The operator writes `x` **only** — `shiftBoxX` preserves `width` verbatim (`:89-94`), and phase 2 writes hull `x`/`width` but never a leaf box (`tightenStrataHullFrames`, `:437-530`, returns `leafBoxes` by reference). Each leaf's width is its intrinsic card width from `clusterFrameLocalRect(cluster)` (`terraformPipelineStrataPlacement.ts:230,236-237`), which is **heterogeneous per resource**. The uniform-column-width illusion came entirely from the pre-compaction grid: `columnWidths[col] = max width in column` + a shared `columnX` pitch (`terraformPipelineStrataRank.ts:186-194`). After compaction each nested resource sits at its **own** leftmost X with its **own** width and **no shared column pitch**, so the effective column widths differ.

The operator has **no concept of a uniform column width or a per-level column pitch** — it optimizes X position, never width, and never equalizes siblings.

**Verdict: INHERENT.** Equal column widths were a property of the discarded rank grid; the compactor was never designed to preserve or reconstruct it.

---

## Cross-cutting — "nearly vertical arrows"

**Mechanism.** The LR bound is `deltaLr ≤ centreX(target) − centreX(source)` (`:313`), and greedy packs the target as far left as legal. For a degree-1 sink the LR bound is frequently the **binding** constraint, so the target slides until its center reaches **exactly its source's center** — the leftmost-legal position _is_ the vertical-alignment position. Source and target X then nearly coincide → the `s→m` edge renders near-vertical. Packing "toward the source column" is literally packing toward `centreX(source)`.

**Verdict: INHERENT** — a direct, definitional consequence of clamping the shift to the LR lower bound (`min(deltaLr, …)`). Not a bug.

---

## The one shared root cause (one sentence)

`refineStrataXCompact` optimizes **each unit's X independently** to its own leftmost constraint-legal position (`delta = min(LR, containment, collision)`, `terraformPipelineStrataXCompact.ts:357-360`), discarding the rank-column grid (`columnX`/`columnWidths`, `terraformPipelineStrataRank.ts:186-194`) that alone provided **shared columns, uniform column widths, and inter-column gutters** — so it has no notion of a column at all.

## Bug vs. inherent

- **All four defects + the near-vertical arrows are INHERENT to the greedy always-compact design**, not separate code bugs. The operator faithfully implements per-unit leftmost packing; column identity, uniform width, gutters, and peer alignment are simply not represented in its objective.
- The only nuance: **Defect 1 (Account-04)** is the one that also exposes a _capability_ gap — greedy single-unit moves cannot perform the coupled source+block shift the design's "biggest win" requires — but the code is still doing exactly what it was told (stop at the tightest of LR/collision/containment).
- No genuine implementation bug (miscomputed bound, stale box, wrong membership) was found driving any of the five symptoms.
