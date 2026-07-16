# P1 — SQS→DLQ long horizontal edges (account02 us-east-1)

**Status:** confirmed (with correction). Lever A candidate. Interlinked with [P4](P4-account04-block-shift.md)
and [P3](P3-uswest2-region-size.md) (same root); gated by [P5](P5-packed-height-gate.md).

## Ground truth

| resource | rank | base (longest-path floor) | x | y | degree |
|---|---|---|---|---|---|
| ingress_queue `sqs_queue.this[0]` | 8 | 5 | 3968 | 6715 | — |
| ingress_queue `sqs_queue.dlq[0]` | **15** | **6** | **7440** | 6831 | **1 (in ← its own queue)** |
| egress_queue `sqs_queue.this[0]` | 10 | 7 | 4960 | 6715 | — |
| egress_queue `sqs_queue.dlq[0]` | **15** | **8** | **7440** | 6600 | **1** |

Edge lengths: chordDx ≈ 6944 (ingress) / 4960 (egress), chordDy ≈ ±231 — long, near-horizontal.

## The problem

Each `*-dlq` is a **degree-1 sink** of exactly one SQS queue. Plain longest-path would place it **one column
past its source** (ingress 5→6, egress 7→8). Instead both DLQs land at **rank 15** (+9 / +7 columns), the
fattest column in the graph (13 clusters), drawing a long near-horizontal edge to a node that only it
consumes.

## What pins it

**`rankSeparate` / OD-14 all-to-all sibling separation** (`terraformPipelineStrataRankSeparate.ts:222-229`),
not longest-path, not sink handling, not a region/containment frame. Separation pushes the DLQ leaf right of
every sibling-unit leaf that precedes its unit, piling it into rank 15. Hard-confirmed: the base floor
(without separation) would place it adjacent.

## Correction to the original framing

"Stranded far right in region-level frames" / "its rank pushes it far right" — directionally right, but:
- It is **rank 15 of 29 (mid-graph)**, "far right" only relative to its own source, not the absolute right
  edge.
- The pin is **rankSeparate column inflation**, a pure **ranking artifact** — not a containment/region-frame
  constraint.

## Candidate lever (A)

Targeted, opt-in counter-stage: detect an over-ranked **degree-1 sink** whose single source sits many
columns to its left, and relocate it toward **`rank(source)+1`**. LR-trivially safe (one source, stays right
of it). Massive edge-length win (chordDx 6944→~496).

## Risk / constraints

- **Height (P5).** Pulling the DLQ back to rank 6/8 re-stacks it in a column that may be occupied at its Y →
  `dropY` grows the band. Must be gated on **height maintained-or-decreased**. There is spare vertical room
  near the queue's own Y (6600–6831) — likely absorbable, but must be checked, not assumed.
- rankSeparate is a proven **−42% height lever** — do **not** modify it; do this as an additive post-pass so
  the ranker is untouched.

## Benefit

Two long edges collapse to short adjacency; removes the two longest near-horizontal chords in the east
block. Small count, high visual salience.
