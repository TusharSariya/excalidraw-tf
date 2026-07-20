# Strata layout problems — decision surface

Five ground-truthed problems in the strata Terraform layout (preset `staging-extended-localstack-v2`, frozen config: sweeps=4, coordRefine=1, rankSep=1, packedScoring=1, packedEps=1, bandDepth=root, sift=1, packedConverge=1, transitiveAdopt=1; maxRank=29, colGap=496px). Numbers reconstructed from the real pipeline (throwaway probe, cross-checked vs `scratchpad/h0-baselines.json`). Detail: `scratchpad/strata-problem-crystallization.md`.

One doc per problem — pick which to attack:

| # | Problem | Where | Lever | Root | Benefit | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| [P1](P1-dlq-stranding.md) | SQS→DLQ long horizontal edges | acct02 us-east-1, rank 15 | ranking pull-back | rankSeparate | short edge; degree-1 sink adjacency | height (P5) |
| [P2](P2-ssm-ordering.md) | SSM param column crossings | acct02 us-east-1, rank 15 | within-rank reorder | ordering/sift | −crossings, −length (api6/7) | localized, low |
| [P3](P3-uswest2-region-size.md) | us-west-2 region box inflation + frame pierce | us-west-2 vpc-5b587, rank 26 | coordinated sink relocate (left+up) | rankSeparate + frame-boundary | −region size, −pierce | height (P5), containment |
| [P4](P4-account04-block-shift.md) | Account-04 whole-block stranded far right | acct04 us-east-1, ranks 27–29 | block clamp to max-source-rank | rankSeparate | −22 cr / −20 pierce (synthesis) | height (P5), multi-source fan-in |
| [P5](P5-packed-height-gate.md) | Packed has no height gate; pull-forward grows height | packed placement (all hulls) | height-maintained-or-decreased gate | dropY Y-from-X | **enables P1/P3/P4 safely** | leaves some width on table |

## The one shared root cause

Strata assigns ranks (X columns) by **`rankSeparate` / OD-14 — a longest-path layering over a sibling-separation-augmented DAG** (`terraformPipelineStrataRankSeparate.ts:222-229`), which **replaces** the plain longest-path floor whenever it's on (`terraformPipelineStrataRank.ts:117-124`; NS is never reached). It **maximizes** every leaf's column subject to all-to-all separation and **ignores edge length** (112 leaves ranked by separation this run). rankSeparate exists as a **height-compaction lever** (spread columns → less vertical stacking, −42% height). Its side effect: **degree-1 sinks and whole pure-sink blocks inherit the max rank of everything their unit must follow**, stranding them far right of the node that feeds them → long near-horizontal edges, frame pierces, inflated region/account boxes.

There is **no counter-stage** that pulls an over-ranked low-degree sink back toward its source (in rank/X, or in Y for P2). `refineStrataVerticalSlots` only moves Y within a rank; nothing relocates a cluster's rank post-hoc. **This is NOT the removed X-only column compaction** (that slid all columns uniformly; what's missing is _targeted, guard-gated, source-relative_ relocation).

## The deep tension (why P5 is load-bearing for everything)

rankSeparate spreads sinks into far columns **specifically to reduce height**. So pulling a sink back toward its source **re-stacks it vertically → trades width/edge-length back for height**. This is the same tension the owner spotted at the packed stage (P5), but it lives at the _ranking_ level too. Packed derives Y from X greedily (`dropY`, `terraformPipelineStrataPlacement.ts:80-102`) with **height unscored and ungated anywhere** (`...PackedScoring.ts:90-95`, `chooseStrataRefinedPlacement:700-766`). So **any** sink pull-back (P1/P3/P4) can grow height unless vertical slack absorbs it.

**⇒ The owner's invariant — "packed never increases height, only maintain or decrease" — is the universal referee that makes every other fix safe.** It is sound and achievable **as an acceptance gate** (reject height-increasing pulls), not as an intrinsic property (dropY provably trades width for height when no slack exists; the gate correctly leaves those sinks wide).

## Interlink map — 5 problems collapse to 3 fix families

```
P1 (DLQ)  ─┐
P3-left   ─┼─  same rankSeparate over-columning  ──►  Lever A: targeted sink rank pull-back
P4 (acct) ─┘                                          (opt-in counter-stage; does NOT touch rankSeparate)

P2 (SSM)  ─────  within-rank Y ordering  ───────────►  Lever B: fan-in reorder toward source Y

P3-pierce ─────  region-level sink vs in-VPC source ─►  Lever D: frame-aware placement/route (the "up" move)

P5 (height) ───  packed Y-from-X, no gate  ─────────►  Lever C: height-maintained gate
                                                        (ENABLES A + any coordinated X/Y move)
```

- **P1 ≡ P4 ≡ P3-left** — confirmed the same mechanism (rankSeparate strands sinks/sink-blocks). One ranking-level counter-stage (**Lever A**) addresses all three. This is the highest-leverage single fix.
- **P2 is distinct** — within-rank ordering (**Lever B**); smaller, localized, low-risk; the owner's "shared source" premise was wrong (each param has its own source — it's fan-_in_, not fan-out).
- **P5 (Lever C) is the enabler** — A and any coordinated move need it, because pulling sinks back grows height without a gate. Build C first or alongside A.
- **P3 also has a frame dimension (Lever D)** — its sinks are region-level (outside vpc-5b587) while sources are inside → the pierce. Fixing region-size (Lever A "left") and fixing the pierce (moving "up" around the frame) are related but separable.

## Recommended attack order (for discussion — not started)

1. **Lever C (P5 height gate)** — small, additive, unblocks everything; makes "pull-forward vs packed" a guarded joint move instead of a fight.
2. **Lever A (P1+P4+P3-left) gated by C** — targeted opt-in relocation of over-ranked degree-1 sinks / pure-sink blocks toward max-source-rank, accepted only if height maintained-or-decreased. Biggest visual win, addresses three problems at once.
3. **Lever B (P2)** — independent, cheap, can go anytime.
4. **Lever D (P3 pierce)** — frame-aware; do after A proves the region-size win.

## Framing corrections (owner should confirm)

- **P1/P2 are mid-graph (rank 15 of 29), not the far-right edge.** If you see them at the right edge you may be conflating them with the account-04 block (r27–29) or us-west-2 sinks (r26), which _are_ near the edge.
- **P2 has no shared source** — each `api-N /name` param is fed by its own service/lambda; it's fan-in.
- **P3's gap is a _vertical_ dead quadrant + sparse ranks, not an empty horizontal column.**
- **P4 has no single upstream to co-move** — `sns.ops` (8 sources) / `cloudtrail` (3) are fan-in hubs; the shift is a _block clamp to deepest-source rank_, not a source-coupled slide.
