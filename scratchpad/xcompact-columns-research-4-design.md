# Consistent-Column + Gutter model to REPLACE greedy leftmost-packing (strata X-compaction)

**Status:** design only, no code. Branch `strata-v3.2-w5-w10b`. Ships as opt-in toggle, default-off, byte-identical when off (repo convention). **Owner intent:** after horizontal compaction the diagram must keep a clean _layered / columnar_ look — uniform column slots + a real gutter — instead of the ragged off-grid result the current per-node leftmost-slide produces.

---

## 0. Why the current operator produces "weirdness" (the thing to replace)

The codebase **already has a column grid** and the current compaction throws it away:

- **Ranking already IS columns.** `placeStrataHulls` (`terraformPipelineStrataPlacement.ts:164-172, 233-239`) pins every leaf's `x0 = columnLeft(rank) = rank.columnX[r]`. `columnX` is a _global_ grid built by `computeGlobalColumnX` / `columnOffsetsFromWidths` (`terraformPipelineLayoutShared.ts:1199-1211`): `colLeft[i] = startX + Σ_{j<i}(widths[j] + PIPELINE_COLUMN_GAP)`. So a proper Sugiyama column look is the _starting_ state — column = rank, gutter = `PIPELINE_COLUMN_GAP`.
- **`refineStrataXCompact` (the current operator) demolishes it.** Its `delta = floor(min(deltaLr, deltaContain, deltaCollision))` (`terraformPipelineStrataXCompact.ts:295-360`) slides each unit _leftward by whatever the constraints individually allow_ — a per-node greedy leftmost partial shift onto an **arbitrary real X**, off any grid. Two consequences the owner sees:
  1. **Colinearity / near-vertical arrows.** Nothing forces a minimum horizontal gap between a source's new X and its target's new X; a degree-1 sink can be pulled until it sits almost directly under its source.
  2. **Ragged, non-uniform columns.** Sibling units that were column-aligned end at different X because each slid a different Δ. The operator's own guard note admits the grid is gone: grid `contiguityViolations` "stops detecting interleaving once a leaf leaves the rank grid" (`terraformPipelineStrataXCompact.ts:46-49`, codex #7).

The two things are actually one thing: **greedy per-node target-X**. The fix keeps the _entire proven hard-constraint machinery_ (Y-frozen rigid translate, LR-set guard, exact `{y,height}` guard, off-grid containment guard, structural guard) and changes ONLY the target-X policy: **snap each unit to a per-hull column grid** instead of sliding it to its individual leftmost.

The global grid is not enough by itself because it is (a) **global** (one column pitch shared by every hull — the owner wants each hull to establish its own grid) and (b) **never compacted** (empty ranks between sparse resources stay as full-width dead columns; that dead space is exactly what §II of the deadspace design set out to remove). The new model makes the grid **per-hull, re-indexed to drop empty columns, and uniform-width** — compact _and_ clean.

---

## 1. COLUMN ASSIGNMENT — what defines "same column"

**A column is a rank, re-indexed locally per hull-level.** For each hull `h`, take its _direct_ units (child-hull blocks + direct leaves — exactly `bh.placed` / the `infos` list in `layoutHull`). Each unit already carries `colSpan = [colMin, colMax]` (leaf ⇒ `[r,r]`; child hull ⇒ `[min,max] rank over its subtree leaves`, `terraformPipelineStrataPlacement.ts:211-224, 239`).

1. Collect the set of ranks touched by `h`'s direct units: `ranks(h) = sort(unique(⋃ colSpan))`.
2. **Re-index contiguously** (this is the compaction): `localIndexOfRank: Map<rank, i>` where `i = position of that rank in the sorted list`. Empty ranks between used ranks collapse — a resource stranded at rank 15 with ranks 9–14 empty in this hull lands in local column `(its position)`, not column 15. _This is where "remove dead space / shrink width" comes from, expressed on the grid._
3. A unit belongs to local columns `[localIndexOfRank(colMin) … localIndexOfRank(colMax)]`. A single-rank leaf occupies exactly one column; a multi-rank child hull spans a contiguous run.

**"Same column" = same local rank index within the hull.** This gives the owner's peer semantics for free:

- `dynamodb` + `rds` that share a source and sit at the same rank → same `colSpan` → **same column** ✓.
- `config`/`log` at a different rank than `s3` → different local index → **different columns, never colinear** ✓.
- Left/right satellites of an all-resources resource live at `rank−1` / `rank+1` → distinct columns on either side of the main column, automatically (§5).

No new clustering heuristic is invented — column identity is the existing rank, which is topology-derived and already LR-consistent. We do not re-rank (the readability synthesis §2 and deadspace §2 both prove a ranker swap is catastrophic: crossings +176…+215, Y-length ×4.3).

---

## 2. UNIFORM WIDTH — slot vs card

**Slot ≠ card.** The card keeps its own content width (never mutated — we only ever write box `x`, exactly as xcompact does). A **column slot** is a uniform-width lane the card is placed _into_.

Per hull `h`, one uniform slot width for the whole hull-level (owner: _"the column slots are uniform width"_):

```
slotW(h) = max(
   max over single-column direct units u of  width(u),                       // widest card fits
   max over multi-column direct units u of    ceil((width(u) − (span(u)−1)*gutter) / span(u))
)                                                                             // a spanning hull fits across its columns
```

- The first term guarantees every single-rank card fits in one slot.
- The second guarantees a child-hull that spans `span(u)` columns fits across `span(u)` slots + the `(span−1)` interior gutters it straddles. (Solving `span*slotW + (span−1)*gutter ≥ width(u)` for `slotW`.)
- **Uniform across sibling columns** — every column in `h` gets the _same_ `slotW(h)`, so the grid reads as clean equal columns. Cards narrower than `slotW` are **left-aligned** inside their slot (left-align, not centre, so the LR flow edge leaves the left edge predictably and short cards don't drift toward the gutter). This is the literal owner requirement: internal card widths vary, slot widths are uniform.

> **Sub-option `strataColumnUniformPerColumn` (default off within this feature):** set `slotW` _per column_ = max card width in that column, instead of one hull-wide `slotW`. Tighter (less whitespace) but columns are no longer equal-width. The owner asked for _uniform_, so hull-wide `slotW` is the recommended default; per-column is offered only if the whitespace of a single very-wide card proves objectionable.

Card placement inside its slot: `card.x = colLeft(localIndex) + 0` (left-aligned). We never touch `card.width`.

---

## 3. GUTTER — where the inter-column margin comes from

**New constant, derived from the existing pipeline spacing so it stays visually consistent:**

```
STRATA_COL_GUTTER = PIPELINE_COLUMN_GAP           // reuse the grid's own column gap (default)
```

Read at _call time_ (the SDEC NaN rule — no module-level const derived from LayoutShared; mirror `framePad()` at `terraformPipelineStrataXCompact.ts:82-83`). Rationale for reusing `PIPELINE_COLUMN_GAP`: it is already the inter-column gap in `columnOffsetsFromWidths`, so a compacted hull's internal pitch matches the surrounding global grid — no visual seam. If the owner wants columns _more_ separated than the global grid (to fight near-vertical edges harder), expose `strataColumnGutter?: number` on `StrataEngineOptions` defaulting to `PIPELINE_COLUMN_GAP`; a floor of `FRAME_PAD` (28) is a safe minimum so columns never abut.

**Enforcement is structural, not a guard:** the column-left function _bakes the gutter in_, so two adjacent columns are gutter-separated by construction:

```
colLeft(h, i) = originX(h) + i * (slotW(h) + gutter)          // pitch = slotW + gutter > 0 always
```

`originX(h) = bh.box.x + framePad()` (the hull's inner-left — same anchor the current operator uses for containment, `terraformPipelineStrataXCompact.ts:257`). Because every column left is `originX + i*pitch` and `pitch ≥ slotW + FRAME_PAD > 0`, **no two columns can abut or go colinear** — the gutter is a property of the coordinate formula, impossible to violate. (Contrast the current operator, where inter-unit gap is whatever `deltaCollision` happened to leave.)

---

## 4. COMPACTION SUBJECT TO COLUMNS (Y-frozen)

The whole point: turn "remove dead space" from **per-node greedy** into **grid-snap**, so height stays invariant and width shrinks but columns stay aligned.

Per hull `h`, bottom-up postorder (deepest first — identical traversal to the current operator, `terraformPipelineStrataXCompact.ts:154-161`), on already-placed geometry:

1. Build `HullColumnGrid(h)` (§1 ranks → local indices, §2 `slotW`, §3 gutter, `originX`).
2. For each direct unit `u` with `colSpan=[cmin,cmax]`:
   - `newLeft = colLeft(h, localIndexOfRank(cmin))`.
   - `Δ = newLeft − currentLeft(u)` (`currentLeft(u) = liveUnitBox(incumbent,u).x`).
   - **Compaction direction:** because empty columns collapse and `slotW` ≤ the global per-depth max width, `newLeft ≤ currentLeft` for essentially every unit ⇒ `Δ ≤ 0` (leftward). We do **not** clamp to `Δ ≤ 0`, though — a unit may need to move slightly _right_ to sit on its uniform column (e.g. a narrow card whose global column started further left). That is fine and still Y-frozen; the width still shrinks overall because dead columns are gone. (If the owner insists compaction is strictly non-expanding, gate `originX`/`slotW` so the rightmost column right ≤ old content right; but grid-snap with small right nudges is what makes it _look_ uniform.)
   - Apply the shift with the **existing rigid translator** `translateUnitX(incumbent, h.id, u, movedLeafIds, movedHullIds, Δ)` (`terraformPipelineStrataXCompact.ts:199-246`) — it already updates every descendant leaf box, every subtree hull box, and the parent's `placed` entry coherently, and it **never writes `{y,height}`**.
3. **Y is literally kept** (`localYTop` / box `y` untouched; `dropY` is never re-run) ⇒ node/frame height invariant by construction — the exact argument codex accepted in §8b.1 of the deadspace design, unchanged here.

**Why height stays valid even though X-extents change (the soundness core):** `dropY` assigned each unit's Y-row purely from **X-extent overlap** among same-hull units. Two units at _different_ ranks map to _different_ columns separated by a gutter ⇒ still X-disjoint ⇒ their old shared row is still legal. Two units at the _same_ rank were X-identical, so `dropY` already stacked them in _different_ rows ⇒ they never shared a row. Snapping to a distinct-column-per-rank, gutter-separated grid **preserves exactly the X-overlap relation `dropY` used**, so every frozen Y-row remains collision-free. Any residual is caught by the structural + containment guards (below).

**Phase 2 frame tighten is reused unchanged.** After the content snap, run the existing `tightenStrataHullFrames` (`terraformPipelineStrataXCompact.ts:437-530`) to hug each hull box to its now-gridded children ± `FRAME_PAD`, floored to the title strip. It already writes hull `x`/`width` only, cascades bottom-up, and shrinks the outer frame. No change needed.

**Same final guards, unchanged** (`passesFinalGuards`, `terraformPipelineStrataXCompact.ts:828-858`): structural overlap + title, off-grid containment/interleave, **LR-as-a-SET** (zero new backward non-reversed edge), **exact per-box `{y,height}`**, title clearance. On any failure fall back to pre-tighten, else input. Grid-snap should _pass these more often_ than the free slide, because it can't produce off-grid interleave and can't pull a target left of its source (§6).

---

## 5. NESTING + SATELLITES

**Per-hull grids, established bottom-up (owner: "each hull establishes its own column grid").** Because the traversal is postorder, a child hull is fully gridded-and-tightened _before_ its parent lays out. To the parent, the child hull is a single **rigid block** whose width is its own tightened box width and whose `colSpan` is its subtree rank range. The parent builds _its own_ `HullColumnGrid` over its direct units (leaf cards + child-hull blocks) with its own `slotW`, gutter and `originX`. So:

- **vpc-5b5 with 4 nested resources:** the vpc hull computes one grid over those 4 units; if they occupy 4 distinct ranks they get 4 uniform columns; peers sharing a rank share a column. Uniform `slotW(vpc-5b5)` = widest of the 4 cards. Independent of any sibling vpc's grid ✓.
- **A child hull that spans multiple parent ranks** occupies a contiguous run of parent columns `[localIndex(cmin)…localIndex(cmax)]`; its block width was already sized to fit that run via the §2 spanning term.

**Left/right satellites (all-resources view).** A resource `m` with a LEFT satellite and a RIGHT satellite has them at `rank(m)−1` and `rank(m)+1` (they _are_ separate ranks in the model). Re-indexing maps those to the column immediately left and immediately right of `m`'s column, all at the same uniform `slotW`, all gutter-separated. So a satellited resource reads as a clean 3-column band `[left | main | right]` with no special-casing — the "consistent columns within the same hull" property the owner asked for falls out because satellites are just more units on the same hull grid. If a satellite and the main share a rank in some model (unusual), they share a column and `dropY`'s row-stacking keeps them vertically separated, uniform-width, still no weirdness.

`HullColumnGrid` data structure:

```ts
type HullColumnGrid = {
  hullId: string;
  originX: number; // bh.box.x + framePad()
  slotW: number; // uniform slot width for this hull-level
  gutter: number; // STRATA_COL_GUTTER (call-time)
  localIndexOfRank: Map<number, number>; // rank -> contiguous local column index (dead ranks dropped)
  colCount: number;
  colLeft(i: number): number; // originX + i*(slotW+gutter)
  colSpanLocal(u: StrataUnit): [number, number]; // via colSpan -> localIndex
};
```

Built once per hull inside the postorder loop; discarded after that hull's units are snapped. No global state (SDEC NaN safe).

---

## 6. NEAR-VERTICAL EDGES — the structural guarantee greedy packing lost

**Claim:** for any non-reversed edge `s → t`, the horizontal separation between the source column and target column is ≥ one gutter, so no edge can be near-vertical.

- LR ranking gives `rank(s) < rank(t)` for every forward edge. When `s` and `t` are direct units of the _same_ hull, `localIndex(rank(t)) ≥ localIndex(rank(s)) + 1` (re-indexing is monotone in rank), so `colLeft(t) − colLeft(s) ≥ pitch = slotW + gutter ≥ slotW + FRAME_PAD`. The horizontal run of the edge is at least the gutter even in the worst case (adjacent columns, zero-width cards). **Near-vertical is impossible by the column formula.**
- When `s` and `t` are in different hulls, the edge is a cross-hull chord; the target hull's `originX` is at or right of the source's column, and the LR-set guard forbids any new backward edge, so the chord still runs left-to-right. The gutter floor guarantees the _entered_ column is at least `FRAME_PAD` right of the source's right edge.

This is the property the free-slide operator cannot make: it minimizes `centerX(t) − centerX(s)` toward zero (its `deltaLr` bound is the _maximum_ legal leftward pull, i.e. it pulls the target as close under the source as LR allows), which is exactly how near-vertical arrows appear. The grid model instead **quantizes** target-X to a column whose left is a whole `pitch` right of the source column — a minimum-horizontal-separation guarantee, not a minimization.

To make this a _checked_ invariant (belt-and-suspenders), add a report/guard metric `strataMinEdgeRunX(candidate) = min over non-reversed edges of |centerX(t) − centerX(s)|` and assert `≥ gutter` in the harness. It is not a hard fallback gate (it holds by construction) but catches a formula regression.

---

## 7. RELATION TO EXISTING xcompact — recommendation

**Three options considered:**

| Option | What | Verdict |
| --- | --- | --- |
| (a) Rewrite `refineStrataXCompact`'s target-X in place | Change `delta` computation from greedy-leftmost to grid-snap inside the same function | Riskiest — entangles the two policies; hard to A/B; breaks the existing `strataXCompact` toggle's meaning |
| (b) **New post-placement column operator, reusing xcompact's machinery** | New `refineStrataColumnGrid` sibling that shares `translateUnitX`, `tightenStrataHullFrames`, `passesFinalGuards`; only the per-unit target-X differs (grid-snap) | **RECOMMENDED** |
| (c) Placement-time per-hull grid | Change `placeStrataHulls` to re-index columns before `dropY` | Rejected — re-running placement re-derives Y via `dropY` and risks the height invariant (deadspace §3.1 / codex §8b.1); Y-frozen demands a _post-A7_ pass |

**Recommendation: option (b) — a new post-A7 placement operator, opt-in, default-off.**

It is a _placement-time column MODEL expressed as a post-placement pass_: it establishes a genuine per-hull column grid (not just a constraint tweak), but runs after A7 on placed geometry so Y is frozen by construction. It is **not** a rewrite of the free-slide operator — it is a _different target-X policy over the same rigid-translate + guard substrate_, which is why it inherits every proven hard-constraint (Y/height exact, LR-set, containment, structure) at zero re-derivation cost.

**Integration plan:**

1. **Toggle:** `strataColumnCompact?: boolean` on `StrataEngineOptions` (`terraformPipelineStrataTypes.ts:17`), default `false` in `terraformStrataDefaults.ts`; optional `strataColumnGutter?: number` (default `PIPELINE_COLUMN_GAP`) and `strataColumnUniformPerColumn?: boolean` (default `false`). UI in `TerraformStrataSettings.tsx`; URL param in `terraformDemoUrlParams.ts`. **Flag off ⇒ return `placement` by reference (byte-identical `sceneSignature`).**
2. **Mutual exclusion with `strataXCompact`:** they are two X-compaction policies; if both set, `strataColumnCompact` wins (it subsumes dead-space removal). Document and assert.
3. **Threading gotcha (load-bearing):** forward the new options in the `sceneContext` literal in `terraformLayoutCore.ts` (strata block ~`:1191`) or they are silently dropped on the real app/worker path (this exact bug is memorialized in the RCLL option-threading memory and deadspace §5). Add an assertion to `terraformLayoutCoreStrataThreading.test.ts`.
4. **New file** `terraformPipelineStrataColumnCompact.ts` exporting `refineStrataColumnGrid(placement, model, edgesPrime, options)`. Imports: `translateUnitX` behavior (extract the current private helper into a shared internal, or re-implement the same rigid box-map update — it is ~45 lines and pure), `tightenStrataHullFrames`, `passesFinalGuards`, `strataUnitId`, `PIPELINE_COLUMN_GAP`/`PIPELINE_FRAME_PAD` (call-time reads). No module-level LayoutShared-derived consts.
5. **Call site:** wherever `refineStrataXCompact` is invoked in the strata pipeline, dispatch to `refineStrataColumnGrid` when `strataColumnCompact` is set. Same report meta (`StrataXCompactReport` — reuse; `heightDelta` MUST be 0, `widthDelta ≤ 0`, plus a new `columnsUniform: boolean` and `minEdgeRunX: number`).
6. **Hard constraints honored (unchanged from xcompact):** Y-frozen (write `x` only), LR never relaxed (LR-set guard + the §6 structural guarantee), containment (off-grid-safe live-box check), exact `{y,height}`, no box overlap, TFD/hierarchy/ranks preserved (we do not re-rank — column index is derived from existing rank).

**Acceptance gates (frozen H0 harness + real app path):**

- Default-off byte-identical (`sceneSignature`).
- LR feasible (`reversedEdges===0`, LR-set introduces no new backward edge).
- Exact per-box `{y,height}` (any rise is a bug, not a tradeoff).
- Width / X-length down (`widthDelta ≤ 0`, `lengthL1X ↓`) — dead columns removed.
- **New:** every hull's direct-unit columns are uniform-width (`columnsUniform`), and `minEdgeRunX ≥ gutter` (no near-vertical).
- Owner cases still improve: C2 DLQ pulled to its (re-indexed) column near rank 8/10; Account-04 block snapped to a compact column run; us-west-2 leaves gridded — but now _on a clean grid_, not a free slide.
- Codex-clean.

---

## 8. Data-structure sketch (operator core)

```ts
export function refineStrataColumnGrid(
  placement: StrataPlacementResult,
  model: StrataModel,
  edgesPrime: readonly StrataPrimeEdge[],
  options: StrataEngineOptions,
): StrataPlacementResult {
  if (!options.strataColumnCompact) return placement; // byte-identical
  const gutter = options.strataColumnGutter ?? PIPELINE_COLUMN_GAP; // call-time
  let incumbent = placement;

  for (const hull of hullPostorder(model)) {
    // deepest first
    const bh = incumbent.boxedHulls.get(hull.id);
    if (!bh || bh.placed.length === 0) continue;

    // 1. ranks present among DIRECT units -> contiguous local column indices
    const ranks = sortedUnique(bh.placed.flatMap((pu) => spanRanks(pu.unit)));
    const localIndexOfRank = new Map(ranks.map((r, i) => [r, i]));

    // 2. uniform slot width (§2) — cards never resized
    const slotW = uniformSlotWidth(
      bh.placed,
      incumbent,
      gutter,
      options.strataColumnUniformPerColumn,
    );

    // 3. grid origin + colLeft (§3) — gutter baked in
    const originX = bh.box.x + framePad();
    const colLeft = (i: number) => originX + i * (slotW + gutter);

    // 4. snap each unit to its column-left, Y frozen (§4)
    for (const pu of orderByCurrentX(bh.placed, incumbent)) {
      // deterministic
      const [cmin] = colSpanOf(pu.unit); // from colSpan
      const newLeft = colLeft(localIndexOfRank.get(cmin)!);
      const dx = newLeft - liveUnitBox(incumbent, pu.unit)!.x;
      if (dx === 0) continue;
      incumbent = translateUnitX(
        incumbent,
        hull.id,
        pu.unit,
        subtreeLeafIds(pu.unit),
        subtreeHullIds(pu.unit),
        dx,
      ); // writes x only
    }
  }

  const tightened = tightenStrataHullFrames(incumbent, model); // reused, X-only
  if (passesFinalGuards(tightened, placement, model, edgesPrime))
    return tightened;
  if (
    incumbent !== placement &&
    passesFinalGuards(incumbent, placement, model, edgesPrime)
  )
    return incumbent;
  return placement; // fall back
}
```

Everything below `translateUnitX` / `tightenStrataHullFrames` / `passesFinalGuards` is the _existing, codex-reviewed_ xcompact code. The only new logic is the ~30 lines of `HullColumnGrid` construction and the target-X = `colLeft(localIndex(cmin))` substitution.

---

## 9. Biggest risk (single)

**Uniform hull-wide `slotW` + gutter can make a hull WIDER than the free slide, not narrower, when one card is much wider than its peers** — every column inflates to the widest card, so a hull with one 400px card and five 80px cards spends `6 × (400+gutter)` instead of packing tight. That directly fights the "must still compact / shrink width" requirement and could trip the (optional) non-expanding gate or produce a worse `widthDelta` than `strataXCompact`. Mitigation is the `strataColumnUniformPerColumn` sub-mode (per-column max width, tight but not equal-width) — but that trades away the very uniformity the owner asked for. **The uniform-width-vs-compactness tension is the core design risk and the thing to validate first on the frozen harness** (measure `widthDelta` under hull-wide vs per-column `slotW` on `staging-extended-localstack-v2`), because if hull-wide uniform expands width on the real preset, the owner has to choose which of the two stated requirements (uniform columns _or_ narrower width) wins.
