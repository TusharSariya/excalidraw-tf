# P3 — us-west-2 region box inflation + frame pierce (vpc-5b587bc4a0510e356)

**Status:** confirmed (with corrections). Lever A (left) + Lever D (up/pierce), gated by [P5](P5-packed-height-gate.md). Shares the rankSeparate root with [P1](P1-dlq-stranding.md) / [P4](P4-account04-block-shift.md).

## Ground truth — region us-west-2 spans ranks 21–26

| resource | rank | base | x | y | vpc |
| --- | --- | --- | --- | --- | --- |
| api8/9 ecs **service** | 22 | 12 | 10912 | 3192/3423 | 5b587 |
| api10 lambda / api11 service | 24 | 14 | 11904 | 3192/3423 | 5b587 |
| api9_west **rds** / api11 **aurora** | 25 | 13/15 | 12400 | 3423/3192 | 5b587 |
| api8 **ssm** / api8 **s3** / api9 **ssm** | 26 | 13 | 12896 | 3717/3948/4179 | **none (region-level)** |
| api10 **ssm** / api10 **dynamo** / api11 **ssm** | 26 | 15 | 12896 | 3024/3255/3486 | **none (region-level)** |

## The problem (two coupled issues)

1. **Region-size inflation.** The api8–11 SSM params, S3 bucket, and DynamoDB table are **degree-1 sinks stranded at rank 26** (base 13/15 → 26). Ranks 23–25 are a **sparse band** (n=2 each) vs dense service ranks (r20 n=10, r21 n=9). The region box's **top-right quadrant is empty dead space**: at ranks 24–26 content lives only at y≈3000–4200; the y≈900–2500 rows exist only at ranks 21–22. So the box is inflated in **both** width and height.
2. **Frame pierce.** The stranded sinks are **region-level (vpc=none)** while their ECS/lambda sources are **inside vpc-5b587**. So the long edges **cross the VPC frame boundary** (source inside → sink outside) — that is the pierce source. (P3's "removes hull penetration" intuition was right.)

## Correction to the original framing

- The gap is a **vertical dead quadrant + sparse ranks**, not "a large empty horizontal column between two occupied ones."
- The critical, previously-unstated fact: **the sinks are outside the VPC, their sources inside** — the pierce is a frame-membership mismatch, not just a long edge.

## Candidate levers

- **Lever A (left).** Relocate the rank-26 degree-1 sinks toward their sources (r22/r24). LR-feasible (they stay right of their sources). Shrinks region width, shortens edges.
- **Lever D (up).** The sinks cannot be pulled **straight** left — at their current Y (≈3024–4179) they collide with the r24/r25 aurora/rds/lambda (all ≈y3200), so `dropY` would push them down and grow height. They **can** be pulled left **and up** into the y≈957–1900 dead rows of r23–25 (the region already reaches y≈4374 at r26, so filling the upper gap doesn't raise the tallest band). Moving them **up and around** the VPC frame (not through it) is also what removes the pierce.

## Risk / constraints

- **Height (P5) is the gate.** A pure-left move grows height; only a **joint left+up** move into the upper dead quadrant is height-neutral. `dropY` will route a unit into that upper gap _for free_ IF the ordering places it early enough and its pulled X lands X-disjoint from the y≈3200 occupants — i.e. the win is latent in `dropY` but only fires when X-pull and ordering cooperate under the height gate.
- **Containment.** The sinks are region-level; moving them up must not push them _into_ the VPC frame (would create a different containment problem) — they need to sit in region-level space above/beside the VPC box.

## Benefit

Shrinks the us-west-2 region box in width **and** height, shortens 6 sink edges, removes the VPC-frame pierces. Highest structural payoff of the five, but also the most constrained (needs left+up+height-gate+ frame-awareness together).
