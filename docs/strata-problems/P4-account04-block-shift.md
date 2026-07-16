# P4 — Account-04 whole-block stranded far right (us-east-1)

**Status:** confirmed over-ranked sink block ("single upstream" premise refuted). Lever A (block clamp),
gated by [P5](P5-packed-height-gate.md). Same rankSeparate root as [P1](P1-dlq-stranding.md) /
[P3](P3-uswest2-region-size.md).

## Ground truth — account 000000000004 = 9 leaves, all us-east-1, ranks 27–29 (deepest, x=13392–14384)

| resource | rank | base | in-degree (cross-account fan-in) |
|---|---|---|---|
| `cloudtrail.organization` | 27 | 13 | ← s3.lake raw, s3.lake curated, org.security (3) |
| `cloudwatch alarm.states_failures` | 27 | 0 | (a source) |
| `s3.audit["audit"]` | 28 | 14 | ← cloudtrail, org.security |
| `sns_topic.ops` | 28 | 12 | ← glue.curate, sqs.ingest_fifo_dlq, kinesis, eks, org.security, lambda.stream_processor, alarm, firehose (**8**) |
| config recorder / audit access-log / 2× log-group / cw dashboard | 29 | 13–15 | ← s3.audit / sns.ops |

## The problem

Account-04 is the org **security/audit account** — a genuine **pure-sink block** (base floor ≈ r12–15).
`rankSeparate` pushes the whole block to **r27–29 (+14 columns)**, the absolute far-right edge, dominated by
inbound cross-account edges. Long cross-account chords, wide overall diagram.

## What pins its X

Cross-account edges into it (accounts 02/03 → 04) **plus rankSeparate all-to-all separation** forcing
account-04 leaves after account-02/03 leaves. Same OD-14 mechanism as P1/P3.

## Correction to the original framing

**"A single dominating upstream that moves with it" — refuted.** The block's anchor sinks are **multi-source
fan-in hubs**: `sns.ops` has **8 sources across multiple accounts/services**, `cloudtrail` has 3. There is
**no single upstream to co-move**. The coordinated shift is a **block clamp**, not a source-coupled slide.

## Candidate lever (A — block clamp)

Shift the **whole 9-node block left as a unit**, clamped so it stays right of its **deepest real source**:
services ≈ r22, dlq/glue ≈ r15 → the block can legally move to ~**r23–25** (into the same sparse band P3
identified) and still keep every source→sink edge left-to-right. Moving past r22 would invert the
service→sns/cloudtrail edges, so the clamp is **max-source-rank + 1**, not an arbitrary slide.

## Benefit

Synthesis (`docs/strata-readability-synthesis-2026-07-15.md`) named this the **biggest single win: −22
crossings / −20 pierce**. Premise re-validated here: account-04 is a real pure-sink block, over-ranked +14,
sitting past a sparse band it can legally occupy. (The −22/−20 counterfactual itself was not re-run; the
*premise* holds — but the win comes from clamping the block toward max-source rank, decoupled from any one
source, **not** the "one dominating source moves with it" story.)

## Risk / constraints

- **Height (P5).** Compressing the block from 3 columns (r27–29) into a tighter left position re-stacks its 9
  nodes; must be gated on **height maintained-or-decreased**. The target band (r23–25) is sparse, so slack
  likely exists — verify.
- **Block cohesion.** Must move all 9 as a rigid unit (or re-rank the block coherently) so internal
  edges/containment stay intact; the multi-source fan-in means many external chords shorten simultaneously.
