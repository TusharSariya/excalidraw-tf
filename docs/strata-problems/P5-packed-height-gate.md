# P5 — Packed has no height gate; pull-forward grows height (the crux)

**Status:** confirmed. Lever C — the **enabler** for P1/P3/P4. The owner's invariant ("packed never
increases height, only maintain or decrease") is sound **as an acceptance gate**, not as an intrinsic
property.

## How packed assigns Y from X (`dropY` skyline)

`terraformPipelineStrataPlacement.ts:325-333` — for a packed hull (region/vpc/subnetZone), units are placed
in a fixed `ordered` sequence; each calls `dropY(rects, x0, x1, topInset, isHull)` (`:80-102`):

```
y = topInset; while any placed rect overlaps [x0,x1] in X and sits below y:
    y = rect.y1 + gap        // drop below the tallest X-overlapping neighbor
```

A unit whose X-extent is **disjoint** from every placed rect lands at the **top row**; a unit whose X-extent
**overlaps** an occupant is **forced below it**. Hull height is emergent: `boxHeight = maxBottom + PAD`
(`:350,:360`). **There is no height minimization** — a single greedy top-down pass for a given ordering +
given X.

## The opposing-forces mechanism (confirmed at code level)

A far-right sink currently sits in a column X-disjoint from the center-left cluster, so `dropY` places it
**high** (shares a Y-row) — cheap height. **Pull it left into an earlier column and its X-extent now overlaps
the occupants there, so `dropY` MUST drop it below them → the band (and region/account box) grows taller.**
That is the fight: X-pull shortens the edge and narrows the box, but unless there is **vertical slack at the
sink's landing Y**, the same pull raises the skyline. Structural, not incidental.

## Height-monotonicity today — NONE

- Packed scorer objective = `{crossings, penetrations, lengthL1}` (`...PackedScoring.ts:90-95`), ε-band on
  crossings. **Height is not a term.**
- `chooseStrataRefinedPlacement` (`:700-766`) gates on `edgeCrossCap`, `strataRelocateScoreLess`
  (weightedCross, lengthL1), ε-band on weightedCross. **No height/box-extent comparison.**
- `refineStrataVerticalSlots` moves a leaf's Y within its rank toward its edge-target median — does not
  bound hull total height.

So packed today can and does pick a **taller** ordering if it scores better on crossings/pen/length. Nothing
observes height.

## Is a height-non-increasing gate the right coupling? Yes — as a gate.

- A gate "accept an X-pull only if `dropY` re-lays the affected hull with tallest-band height
  **maintained-or-decreased**" turns the two opposing forces into a **cooperating coupled X+Y move**: the
  pull becomes conditional on the skyline having slack to absorb it. Coherent with the existing acceptance
  pattern — a height guardrail alongside the crossings/length ones.
- **But it cannot be an intrinsic property, only a gate.** `dropY` provably trades width for height: two
  units with overlapping X-extents cannot share a row, so forcing them into the same columns to shrink width
  *requires* stacking them = strictly more height, unless slack exists elsewhere. Such moves must simply be
  **rejected** (kept wide). The invariant is "reject height-increasing pulls," not "packing is intrinsically
  height-monotone."

## Why this is Lever C (the enabler)

Every sink pull-back (P1, P3, P4) — and the block clamp — risks growing height, because rankSeparate spread
those sinks *to reduce height in the first place*. The height gate is the **universal referee** that lets any
of those relocations be applied safely: a relocation ships only if packed re-lays it height-neutral-or-
better; otherwise it's left alone. Build C first or alongside A.

## Candidate lever (C)

Add a **height-maintained-or-decreased acceptance gate** to the packed/relocation machinery (extend
`chooseStrataRefinedPlacement` or wrap the relocation post-pass): re-run `dropY` for the affected hull(s)
after a candidate X/Y move, compare tallest-band height (and/or hull box height) to the incumbent, reject if
it grew. Opt-in, default-off, additive. Pairs with a report metric so we can see how many pulls the gate
admits vs rejects.

## Risk / constraints

- Leaves some width on the table (moves that provably need height are rejected) — acceptable and correct.
- Must measure `dropY` re-lay cost per candidate (perf) — bounded to the affected hull.
- Interacts with ordering (P2): a better order creates more slack, so the gate admits more pulls; worth
  running B before/with A.
