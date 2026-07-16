# Strata horizontal / "column" model — code-grounded map

Reverse-engineered for a consistent-column-width + gutter mechanism. All file:line refs are `packages/excalidraw/components/` unless noted. Constants live in `terraformPipelineLayoutShared.ts`.

## TL;DR

- **Yes, strata HAS a column abstraction** — the global **rank grid**: every leaf gets an integer `rank`, and `X(leaf) = columnX[rank]`. `columnX` is a single flat array of column left-edges shared by the WHOLE hull tree (`StrataRankResult.columnX`). It is a uniform-LEFT-EDGE lane grid with a per-column width and a fixed inter-column gutter (`PIPELINE_COLUMN_GAP = 150`).
- **But cards are NOT uniform-width**: each card keeps its own content width, left-aligned in its column; the column width only decides where the _next_ column starts.
- **xcompact is the wrong place for a column policy** — it is a leftward compactor that _destroys_ the grid (slides cards off `columnX` to their leftmost-legal X). It is precisely what "broke the column look."
- **Single best hook for consistent-width columns + min gutter (Y-frozen, rank-preserving):** `rankStrataClusters` at `terraformPipelineStrataRank.ts:185–194`, where `columnWidths` and `columnX` are computed. It is upstream of placement, purely X-axis, and never touches the rank map or any Y — so it is rank-preserving and Y-frozen by construction.

---

## 1. RANK / COLUMN MODEL — how a node's X is determined

There **is** an explicit column index: the integer **rank**.

- `rankStrataClusters` (`terraformPipelineStrataRank.ts:49`) computes `rank: Map<clusterId, number>` via `longestPathFloor` (Kahn longest-path over E′; `:233`), optionally replaced by network-simplex (`:162`) or the separated floor (`:124`).
- From the ranks it builds the **column grid** (`:185–194`):
  ```
  columnCount  = maxRank + 1
  columnWidths[col] = max over clusters with rank==col of unitWidthOf(id)   // per-column max card width
  columnX      = columnOffsetsFromWidths(columnWidths, 0, PIPELINE_COLUMN_GAP)  // left edges
  ```
  `columnOffsetsFromWidths` (`terraformPipelineLayoutShared.ts:1199`) is a running sum: `x[i] = x[i-1] + widths[i-1] + gap`. So the gutter between columns is `PIPELINE_COLUMN_GAP = 150` (`terraformPipelineLayoutShared.ts:111`) plus the previous column's max-card slack.
- The result type documents it as a first-class concept: `StrataRankResult.columnX` — _"Global column left edges from per-column max leaf width + COLUMN_GAP"_ (`terraformPipelineStrataTypes.ts:273`).

A node's X is then **purely derived from the rank grid**, not from packed placement: `placeStrataHulls` → `columnLeft(r) = rank.columnX[r]` (`terraformPipelineStrataPlacement.ts:164`), and each leaf's box is `x0 = columnLeft(rank)`, `x1 = x0 + rect.width` (`terraformPipelineStrataPlacement.ts:233–240`). The placement header states it plainly: _"X is pinned to the global columnX grid throughout"_ (`:18`). `dropY` derives **only Y** (`:80–102`); it never touches X. So packed placement + dropY set Y; **X = columnX[rank]** always.

**Is there a uniform-width lane abstraction?** Yes but only at the LEFT EDGE. All leaves at the same rank share `columnX[r]` (same left edge), and `columnWidths[col]` is uniform _for that column_. But leaves are **left-aligned and keep their own content width** — the column width governs the next column's offset, not the card's rendered width. So it is a "uniform-left, per-column-max-width, fixed-gutter" grid, not "uniform-width cards."

**rankSeparate**: `computeStrataSeparatedFloor` (called `terraformPipelineStrataRank.ts:124`) _replaces the rank map_ to push one-way sibling units into different ranks (the −42% height lever). It adds/moves ranks → more columns → clusters land in different columns. It changes _which_ column a node is in; it does not change the column-grid machinery (still `columnWidths`/`columnX` at `:185–194`).

## 2. WIDTHS — uniform or per-card?

**Per-card, variable, left-aligned.** No uniform card width.

- Leaf card width = `clusterFrameLocalRect(cluster).width` (the frame's true local rect), read at `terraformPipelineStrataPlacement.ts:230–240` (`x1 = x0 + rect.width`) and independently by the ranker as `unitWidthOf` (`terraformPipelineStrata.ts:414–417`).
- Column _slot_ width = `max` card width in that column (`terraformPipelineStrataRank.ts:186–193`). This is the only place a "column width" exists, and it drives only the next column's left edge via `columnOffsetsFromWidths`.
- Child-hull unit width = `cl.boxWidth` (its own placed extent), `terraformPipelineStrataPlacement.ts:222`.
- Hull frame width = `maxX1 - minX0 + 2*FRAME_PAD` (`terraformPipelineStrataPlacement.ts:359`) — hugs content, not a column multiple.

So sibling cards in a hull have **their own content widths with variable horizontal gaps** (the gap = `columnX[r+1] - (columnX[r] + cardWidth)` = `COLUMN_GAP + (columnMaxWidth - thisCardWidth)`).

## 3. GUTTERS / PADDING — horizontal spacing constants

- `PIPELINE_COLUMN_GAP = 150` (`terraformPipelineLayoutShared.ts:111`) — the inter-column (rank-axis) gutter, applied by `columnOffsetsFromWidths`. **This is the only horizontal inter-column margin.**
- `PIPELINE_FRAME_PAD = 28` (`:110`) — hull inner padding on all sides (`terraformPipelineStrataPlacement.ts:358–360`); also the phase-2 frame-hug pad in xcompact.
- `PIPELINE_MARGIN = 50` (`:109`) — canvas origin offset (`terraformPipelineStrataPlacement.ts:403`).
- `PIPELINE_LANE_GAP_Y = 96`, `PIPELINE_CLUSTER_GAP_Y = 36` (`:112–113`) — **Y-only** stacking gaps (`dropY`/`gapBetween`, `terraformPipelineStrataPlacement.ts:70–72`).

Cards do not abut: within a column they are separated in Y (dropY); across columns the horizontal gap is `COLUMN_GAP` + max-width slack. There is **no per-card horizontal gutter constant** beyond the column gap.

## 4. NESTING — how nested hulls lay out children horizontally

**No per-hull column alignment. One global grid for every level.**

- `layoutHull` recurses post-order (`terraformPipelineStrataPlacement.ts:201–365`). A child hull is a rigid box; its unit x-extent is `[boxXLeft, boxXLeft+boxWidth]` (`:222`) — itself derived from its leaves' global `columnX` positions.
- A direct leaf's x-extent is `columnLeft(rank)` on the **same global `columnX` grid** (`:233–240`) — a leaf inside a deeply nested VPC hull uses the same columnX[r] as a top-level leaf at rank r.
- Within a packed hull, `dropY` (`:325–333`) packs units vertically by their global x-extents so X-disjoint siblings share a Y-row. Horizontal placement is entirely inherited from the global grid; the hull only computes Y and its own bounding box.
- So a "VPC hull containing 4 resource cards" places those 4 cards at whatever global columns their ranks fall in (free packing in Y, fixed columns in X). There is no notion of "this hull's local columns 0..3."

## 5. ALL-RESOURCES VIEW / SATELLITES

**No explicit left/right satellite / column-satellite concept in the geometry.** The word "satellite" appears only as a **Y-ordering** device:

- `pushGroupSift` (`terraformPipelineStrataOrdering.ts:537–584`): for an anchor leaf it grows a "satellite set" — companion leaves whose _every_ lifted edge stays inside the group (`:562`), capped at 4 — and tries the whole group contiguously at each sequence boundary. This is a candidate **ordering** (Y-sequence) move, not an X placement. A satellite is not placed "beside" the main node in a column; it is kept adjacent in the vertical band sequence.
- The OD-15 sift/relocate machinery (`strataSiftRelocate`) similarly operates on the Y sequence / vertical slots, not on horizontal satellites.

There is no code that places a resource's dependents as left/right column neighbours.

## 6. HOOK POINTS for consistent-column-width + min-gutter (Y-frozen, rank-preserving)

Downstream readers of the grid (all X-only consumers of `rank.columnX`): `placeStrataHulls` (`terraformPipelineStrataPlacement.ts:164`), which is the single funnel; A7 coord-refine and xcompact only move Y / slide X but read the same boxes.

### (a) Assign nodes to uniform-width columns + (b) enforce a min inter-column gutter

**Best single hook: `rankStrataClusters`, `terraformPipelineStrataRank.ts:185–194.** This block is where the entire X grid is born. It:

- reads: `rank` map + `opts.unitWidthOf(id)`;
- writes: `columnWidths[]` then `columnX[]` (via `columnOffsetsFromWidths`, gap = `PIPELINE_COLUMN_GAP`).

A uniform-width policy is a localized rewrite here:

```
// uniform column slot width = global (or per-band-level) max card width
const uniform = Math.max(0, ...columnWidths);
columnWidths = columnWidths.map(() => uniform);
columnX = columnOffsetsFromWidths(columnWidths, 0, minGutter);   // minGutter replaces/augments COLUMN_GAP
```

Why this hook is correct:

- **Rank-preserving** — it never touches `rank`; nodes stay in their columns.
- **Y-frozen** — `columnX` feeds _only_ X (`columnLeft` at placement `:164`); no Y path reads it. dropY/A7 recompute Y from x-extents, but with a _wider_ uniform column the x-extents shift right uniformly, so relative Y-packing is stable and heights are unaffected (X affects width only — the same invariant xcompact relies on).
- Single source of truth: every consumer (`placeStrataHulls`, coord-refine, xcompact) reads `rank.columnX`, so nothing else needs to change for the _grid_ to change.

Caveat: this makes column _slots_ uniform (uniform left-edge spacing + gutter). It does **not** make the _cards_ fill the slot — cards remain left-aligned at `columnX[r]` with their own `rect.width` (`terraformPipelineStrataPlacement.ts:233–240`). To also make cards visually fill a uniform column you must widen the leaf boxes, which changes rendered card width — a larger, geometry-touching change in placement (`:233–240`) and/or scene build (`terraformPipelineStrataSceneBuild.ts:161–192`, where the built skeleton is translated onto `box`). Recommend uniform _slots_ first (cheap, grid-level), card-fill second (invasive).

Per-hull-level uniform columns (Q6a "within each hull-level") do **not** exist today — the grid is flat/global. Getting per-hull columns would require either (i) a per-hull `columnX` computed inside `layoutHull` and threaded to `columnLeft` (a placement-level change, `terraformPipelineStrataPlacement.ts:164`, `:233`), or (ii) accepting the global grid but making it uniform per rank (the (a) change above). The global-grid-uniform route is far cheaper and preserves the "X pinned to grid" invariant everywhere.

### (c) Keep it Y-frozen and rank-preserving — why xcompact is the WRONG place

`refineStrataXCompact` (`terraformPipelineStrataXCompact.ts:106`) is a post-A7 leftward compactor: it slides each unit to its **leftmost legal X** bounded by LR / containment / collision (`:298–360`). That deliberately **removes** the uniform column grid — after it runs, a card's X is no longer `columnX[rank]` (that is the "broke the column look" symptom). It:

- reads/writes placed geometry (`leafBoxes`, `boxedHulls` boxes), Y frozen, height-invariant (`strataYHeightPreserved` guard, `:702`);
- has no concept of columns; its phase-2 `tightenStrataHullFrames` (`:437`) even shrinks frames to hug compacted content.

So a column policy must be established **upstream** (at the grid, §6a) and xcompact must either be OFF or taught to snap to the grid. If you want consistent columns, do not add it in xcompact; set the grid in `rankStrataClusters` and leave `strataXCompact` off (or make it grid-snapping instead of leftmost-packing).

### Threading / plumbing (if a new toggle is needed)

Follow the existing pattern (mirrors `strataXCompact`): add option to `TerraformStrataSceneOptions` (`terraformPipelineStrata.ts:34+`) → resolve in the body (`:230–285`) → pass into the `rankStrataClusters` opts object (`terraformPipelineStrata.ts:404–418`) → consume in `terraformPipelineStrataRank.ts:185–194`. Type mirror on `StrataEngineOptions` (`terraformPipelineStrataTypes.ts:17`). All engine toggles are opt-in / default-off / flag-off byte-identical (repo convention). Real-app-path gotcha: forward in the `sceneContext` literal in `terraformLayoutCore.ts` or it is silently dropped (per RCLL option-threading memory).
