# Strata P1–P4 problem crystallization — ground truth

Preset `staging-extended-localstack-v2`, view=strata, frozen config (compact=1, ancillary=0, privateApiRegional=0, sweeps=4, coordRefine=1, rankSep=1, packedScoring=1, packedEps=1, bandDepth=root, sift=1, packedConverge=1, transitiveAdopt=1). Numbers below are from the real pipeline (`rankStrataClusters` + `placeStrataHullsPackedScored` + A7 coordRefine + `refineStrataVerticalSlots`) reconstructed via a throwaway `.probe.test.ts` (now deleted), cross-checked against the committed H0 baseline (`scratchpad/h0-baselines.json`). maxRank = 29, colGap 496px.

## The rank rule strata actually uses (load-bearing for all four)

`rankStrataClusters` (terraformPipelineStrataRank.ts): floor = **longest-path** (Kahn, `longestPathFloor` L233) over effective E′ leaf edges. In THIS config `rankSeparate` is ON, so the floor is **REPLACED** by `computeStrataSeparatedFloor` (terraformPipelineStrataRankSeparate.ts) BEFORE NS is ever attempted (rank.ts L117-124). That function (OD-14, Sander base-node layering) runs ONE global longest-path over `leafEdges ∪ sepEdges`, where `sepEdges` are **all-to-all sibling-separation** edges: for every one-way sibling-unit quotient pair A→B under any hull it adds `a→b ∀ a∈leaves(A), b∈leaves(B)` (rankSeparate.ts L222-229). Measured effect this run: **pairCount=80, changedRankCount=112** — i.e. 112 leaf clusters have a rank set by separation, not by their own edges. It is a longest-path layering that **maximizes** every leaf's column subject to separation; it does **not** minimize edge length. This is the single mechanism behind P1, P3, and P4.

---

## P1 — account02 us-east-1 SQS → DLQ long horizontal edges

**Real ranks/positions (base = longest-path floor WITHOUT separation):**

| resource                            | rank   | base  | x        | y    |
| ----------------------------------- | ------ | ----- | -------- | ---- |
| ingress_queue …sqs_queue.this[0]    | 8      | 5     | 3968     | 6715 |
| ingress_queue …sqs_queue.**dlq[0]** | **15** | **6** | **7440** | 6831 |
| egress_queue …sqs_queue.this[0]     | 10     | 7     | 4960     | 6715 |
| egress_queue …sqs_queue.**dlq[0]**  | **15** | **8** | **7440** | 6600 |

- **DLQ is degree-1: CONFIRMED.** Each `dlq[0]` has exactly one incident E′ edge, `in ← its own sqs_queue.this[0]`. No other edges.
- **Could sit adjacent: CONFIRMED.** Pure longest-path floor puts the DLQ one column past its source (ingress base 5→6, egress base 7→8). Instead both DLQs land at rank 15 — ingress +9 columns, egress +7 columns past their floor.
- **What pins it far right = rankSeparate, NOT longest-path / sink handling / region frame.** rankSeparate's all-to-all separation pushes the DLQ leaf right of every sibling-unit leaf that precedes its unit, piling it into rank 15 (x=7440), the fattest column in the graph (13 clusters). The near-horizontal edge follows: chordDx ≈ 6944 (ingress) / 4960 (egress), chordDy ≈ ±231.
- **CORRECTION to your framing:** "stranded far right in region-level frames" and "its rank pushes it far right" are directionally right but mis-attributed. (a) It is NOT the far-right column — rank 15 of 29, mid-graph (the "far right" is only relative to its own source). (b) The pin is **OD-14 rankSeparate column inflation**, not a containment/region-frame constraint and not longest- path sink placement. The far-right position is a **RANKING artifact**, hard- confirmed: base floor would place it adjacent.

**VERDICT P1: CONFIRMED-with-correction.** Real problem, degree-1 sink, adjacency possible; but the culprit is rankSeparate all-to-all separation, and it is mid-graph not absolute-far-right.

---

## P2 — SSM parameter column mis-ordering (account02 us-east-1)

**All api-N params in the east block land at ONE rank (rank 15, x=7440):**

| param | y    | source           | source rank / y |
| ----- | ---- | ---------------- | --------------- |
| api1  | 3830 | api1 lambda      | r11 / 3886      |
| api2  | 4292 | api2 ecs service | r11 / 4117      |
| api3  | 4523 | api3 ecs service | r11 / 4348      |
| api4  | 4754 | api4 lambda      | r11 / 4810      |
| api5  | 5216 | api5 ecs service | r11 / 5041      |
| api6  | 5678 | api6 lambda      | **r13 / 3886**  |
| api7  | 5909 | api7 ecs service | **r13 / 4117**  |

- **Same rank / one column: CONFIRMED** — all 7 at rank 15, x=7440 (13-member column). Their Y-order is set by ordering/sift (`orderStrataUnits` → `refineStrataVerticalSlots`), so this IS a within-rank Y problem, as you claim.
- **"fed by a shared Lambda (api-6) + Service (api-7)": REFUTED.** Each param is a degree-1 sink of **its own** module's compute (api1←api1-lambda, api2←api2-service, …). There is no shared source. It is a **fan-IN of many independent single-source sinks into one column**, not a shared-source fan-out.
- **The crossing mechanism (real, but localized):** api1–api5 params AND their sources are both top-to-bottom monotonic (r11, y 3886→5041) — those produce no crossings. api6/api7 are the offenders: their sources sit at **rank 13, high Y (3886/4117)** while their params are dumped at the **bottom** of the rank-15 column (y 5678/5909). So the api6/api7 edges rise diagonally across the api2–5 edges → crossings. Reordering the column so api6/api7 params sit near their sources' Y (top) would cut those crossings, and length, LR- and containment- feasibly (all same rank, same account, no frame pierce).
- **Is strataSift acting on them?** Yes — sift/relocate operates on this column (it is the fattest, most-constrained rank), but it did not resolve the api6/api7 inversion at the frozen config.

**VERDICT P2: CONFIRMED-as-within-rank-ordering, but the "shared source" premise is REFUTED** (each param has its own source). The residual crossings are driven specifically by api6/api7 sources being one rank deeper (r13) and high-Y while their sinks are forced low in the column.

---

## P3 — us-west-2 vpc-5b587bc4a0510e356: right-stranded sinks + dead band

**Region us-west-2 spans ranks 21–26. Key rows:**

| resource | rank | base | x | y | vpc |
| --- | --- | --- | --- | --- | --- |
| api8/9 ecs **service** | 22 | 12 | 10912 | 3192/3423 | 5b587 |
| api10 lambda / api11 service | 24 | 14 | 11904 | 3192/3423 | 5b587 |
| api9_west **rds** / api11 **aurora** | 25 | 13/15 | 12400 | 3423/3192 | 5b587 |
| api8 **ssm** / api8 **s3** / api9 **ssm** | 26 | 13 | 12896 | 3717/3948/4179 | (region-level, vpc=none) |
| api10 **ssm** / api10 **dynamo** / api11 **ssm** | 26 | 15 | 12896 | 3024/3255/3486 | (region-level) |

- **Are the right-column sinks region-level or inside the VPC? MIXED — a key finding.** The SSM params, the S3 bucket, and the DynamoDB table at rank 26 have **vpc=none: they are region-level, OUTSIDE vpc-5b587**. The services / lambda / aurora / rds that feed them ARE inside vpc-5b587. So the long edges cross the VPC frame boundary (service inside → param/bucket outside), which is exactly why they pierce (P3's "removes hull penetration" intuition is right).
- **What pins the sinks at rank 26:** longest-path over the separated floor. ssm8/9 base 13, actual 26; ssm10/dynamo base 15, actual 26. rankSeparate + the service→sink chain push them to the region's deepest column.
- **Low-degree sinks: CONFIRMED.** api8/9/10/11 ssm, s3, dynamo are all degree-1 (single `in ← ecs_service`/`lambda`, no out).
- **Dead band: PARTIALLY CONFIRMED.** Ranks 23–25 are SPARSE (n=2 each) vs the dense service ranks (r20 n=10, r21 n=9). But they are not empty — occupied by the api10/api11 gateway→lambda→aurora chain. The real dead space is a **vertical** band: at ranks 24–26 content lives only in y≈3000–4200; the y≈900–2500 rows (top of the region: sqs writer, dynamo, s3 replicas) exist only at ranks 21–22. So the region box's top-right quadrant is empty → inflated box width AND height.
- **Leftward/upward move feasibility:** pulling the rank-26 sinks left toward the r24–25 services is LR-feasible (they'd stay right of their rank-22/24 sources) and would REMOVE the VPC-frame pierce only if they move ABOVE/around the frame, not through it — so "up" matters as much as "left." Moving them into the y900–2500 dead rows is where the box-shrink win is.

**VERDICT P3: CONFIRMED-with-corrections.** Sinks are low-degree and stranded right by rankSeparate; the empty gap is real but it's a _vertical_ dead quadrant, not a horizontal empty column; and critically the stranded sinks are **region-level (outside the VPC)** while their sources are inside it — that frame-crossing is the pierce source.

---

## P4 — Account-04 whole-block left shift

**Account 000000000004 = 9 leaves, ALL us-east-1, ranks 27–29 (the deepest, at the far-right edge x=13392–14384):**

| resource | rank | base | in-degree (cross-account fan-in) |
| --- | --- | --- | --- |
| cloudtrail.organization | 27 | 13 | ← s3.lake raw, s3.lake curated, org.security |
| cloudwatch alarm.states_failures | 27 | 0 | (source) |
| s3.audit["audit"] | 28 | 14 | ← cloudtrail, org.security |
| **sns_topic.ops** | 28 | 12 | ← glue.curate, sqs.ingest_fifo_dlq, kinesis, eks, org.security, lambda.stream_processor, alarm, firehose (**8 sources**) |
| config recorder / audit access-log / 2×log-group / cw dashboard | 29 | 13-15 | ← s3.audit / sns.ops |

- **Pure-sink block pushed to a high rank: CONFIRMED.** Account-04 is the org security/audit account. Base floor ≈ r12–15; rankSeparate pushes the whole block to r27–29 (+14 columns). It is dominated by inbound cross-account edges.
- **What pins its X:** cross-account edges into it (accounts 02/03 → 04) PLUS rankSeparate all-to-all separation forcing account-04 leaves after account-02/03 leaves. Same OD-14 mechanism as P1/P3.
- **"single dominating upstream that moves with it": REFUTED.** The block's two anchor sinks are fan-in hubs: `sns.ops` has **8 sources across multiple accounts/services**; `cloudtrail` has 3. There is no single upstream that co-moves. A naive "block + its source" shift has no single source to grab.
- **Is a coordinated block shift LR-feasible?** A _bounded_ left shift is: the block's deepest real source is around r22 (services) / r15 (dlq, glue), so the block could move left to ~r23–25 (into the same sparse band P3 identified) and still stay right of all its sources — feasible. Moving past r22 would invert the service→sns/cloudtrail edges. So the synthesis's "coordinated left shift" is feasible **as a clamp to max-source-rank**, not an arbitrary slide.
- **The −22 cr / −20 pierce premise:** I did not re-run the synthesis counterfactual here, but its PREMISE holds: account-04 is a genuine pure-sink block, over-ranked by +14 columns, sitting past a sparse band it can legally occupy. The claim is _plausible and premise-valid_; the "one dominating source moves with it" story is the wrong reason — it's a fan-in block whose win comes from clamping the block toward its max-source rank, decoupled from any one source.

**VERDICT P4: CONFIRMED block is over-ranked sink; premise of a coordinated left-shift win is sound; but "single dominating upstream co-moves" is REFUTED — it is a multi-source fan-in block, shift must be clamped to its deepest source.**

---

## P5 — packed vs pull-forward height coupling (the crux the owner raised)

The owner's realization: "pull S3/SSM forward (left in X)" fights the **packed** stage, because packed derives each unit's Y from its X arrangement. Ground truth below (file:line).

### 1. How packed assigns Y from X (`dropY` skyline)

`terraformPipelineStrataPlacement.ts` L325-333: for a **packed** hull (region/vpc/subnetZone), units are placed in a fixed `ordered` sequence; each unit calls `dropY(rects, info.x0, info.x1, topInset, isHull)` (L80-102):

```
y = topInset; while any placed rect overlaps [x0,x1] in X and sits below y:
    y = rect.y1 + gap   // drop below the tallest X-overlapping neighbor
```

So **a unit whose X-extent is disjoint from every already-placed rect lands at the top row (y = topInset); a unit whose X-extent overlaps an occupant is forced to drop below it.** The hull's height is then purely emergent — `boxHeight = maxBottom + PAD`, `maxBottom = max(localYTop + height)` (L350, L360). There is **no height minimization**: dropY is a single greedy top-down pass for a GIVEN ordering and GIVEN X. It does not search Y to minimize the tallest band; height falls out of whatever the X-extents + ordering produce.

### 2. The opposing-forces mechanism — CONFIRMED at code level

A far-right sink (e.g. us-west-2 api8 SSM at rank 26, x=12896, or the east DLQ at rank 15) currently sits in a column whose X-extent is **disjoint** from the center-left cluster, so dropY can place it high (share a Y-row) — cheap height. **Pull it left into an earlier column and its X-extent now overlaps the units already there, so dropY MUST drop it below them → the band (and the region/ account box) grows taller.** That is exactly the two opposing forces: X-pull shortens the edge and narrows the box, but unless there is vertical slack at the sink's landing Y, the same pull raises the skyline. The conflict is real and structural, not incidental.

### 3. Vertical slack in us-west-2 vpc-5b587bc4a0510e356 — there IS dead space, but only ABOVE

From the harness dump, the region us-west-2 spans y≈957→4374. Occupancy by column band:

| column | ranks | occupied Y-range | dead space |
| --- | --- | --- | --- |
| x10416–10912 (r21–22, left) | services/rds/dynamo/writer | y≈957–3618 | mostly full |
| x11408–12400 (r23–25, center-right) | api10/11 gateway→lambda→aurora/rds | y≈1931–3618 | **empty above y≈1900 AND the region's tall extent (→4374) is set elsewhere** |
| x12896 (r26, sink column) | 6 sinks (ssm/s3/dynamo) | y≈3024–4374 | — |

The r23–25 columns are the sparse band (n=2 each). Their content lives at y≈1900–3600; the **upper rows y≈957–1900 in r23–25 are dead**, and the region already reaches y≈4374 at r26 regardless. So a rank-26 sink (currently y≈3024– 4179) **cannot be pulled straight left** — at its current Y it collides with the r24/r25 aurora/rds/lambda (all ≈y3200) and dropY would push it down, growing height. But it **can be pulled left AND up** into the y≈957–1900 dead rows of r23–25 without raising the tallest band (which r26 already fixes at ≈4374). Conclusion: the gap exists, but absorbing the pull requires a **joint X+Y (left+up) move**, not a pure-left move. dropY will actually route a unit into that upper gap for free IF the ordering places it early enough and its pulled X lands disjoint from the y≈3200 occupants — i.e. the coupling is latent in dropY but only fires when X-pull and ordering cooperate.

### 4. Height-monotonicity today — NONE

There is **no height gate anywhere** in the packed stage or the acceptance machinery:

- The packed scorer's objective is `StrataPackedScore = {crossings, penetrations, lengthL1}` (terraformPipelineStrataPackedScoring.ts L90-95) with an ε-band on crossings. **Height is not a term.**
- `chooseStrataRefinedPlacement` (L700-766) gates on `edgeCrossCap`, `strataRelocateScoreLess` (weightedCross, lengthL1), and the ε-band on weightedCross. **No height/box-extent comparison.** `fellBack` is decided purely on crossings/penetration/length.
- `refineStrataVerticalSlots` moves a leaf's Y within its rank toward its edge targets' median, clamped to sibling boundaries — it does not track or bound the hull's total height either.

So packed today can and does pick an ordering that is _taller_ if that ordering scores better on crossings/pen/length. The owner's "packed never increases height" invariant is **NOT currently enforced** — nothing observes height.

### 5. Is a height-non-increasing gate the right coupling?

**Assessment (not a build): yes, as a GATE, and it is sound but not free.**

- A gate "accept an X-pull only if dropY re-lays the affected hull with tallest-band height maintained-or-decreased" would convert the two opposing forces into a **cooperating coupled X+Y move**: the pull-forward becomes conditional on the skyline having vertical slack to absorb it (exactly the P3 us-west-2 upper-gap case). This is coherent with the existing acceptance pattern — it adds a height guardrail alongside the crossings/length ones.
- **But "packed never increases height" cannot hold as a universal property, only as a gate.** dropY provably trades width for height: two units with overlapping X-extents cannot share a row (they would collide), so shrinking width by forcing them into the same columns _requires_ stacking them = strictly more height, UNLESS vertical slack exists elsewhere to absorb it. So there exist width-shrinking moves that provably need more height; a monotone-height packer must simply REJECT those (keep them wide), which is fine for a gate but means the invariant is "reject height-increasing pulls," not "packing is intrinsically height-monotone."
- Net: the invariant is the **right framing of the coupling** — it turns "pull-forward vs packed" from a fight into a guarded joint move — and it is achievable as an acceptance gate. It is NOT achievable as a free property of the packer, because some of the sinks the owner wants pulled (those whose target Y is already occupied, with no upper slack) genuinely cannot move left without growing height, and the gate correctly leaves those alone.

**VERDICT P5: CONFIRMED.** Packed assigns Y by greedy top-down dropY for a fixed X+ordering, with height as an unscored by-product; pulling a sink left overlaps occupied X and forces a downward drop (more height) unless there is vertical slack at its landing Y; us-west-2 vpc-5b587 HAS such slack but only in the upper rows, so absorbing a pull needs a joint left+up move; there is no height term or gate anywhere today; and a height-maintained-or-decreased gate is the sound, achievable coupling — as a gate, not as an intrinsic property (width-shrink can provably require height when no slack exists).

---

## Shared-cause verdict

Your hypothesis — **ranking + ordering + coordinated-compaction**, none of it the removed X-only column compaction — is **CONFIRMED, with the ranking leg sharpened**:

1. **(a) Ranking is the dominant cause (P1, P3, P4).** The rank rule is **longest-path layering over a separation-augmented DAG** (`rankSeparate` / OD-14, ON in this config), NOT plain longest-path, NOT network-simplex (NS is skipped whenever rankSeparate applies), NOT sink-pull. It **maximizes** columns subject to all-to-all sibling separation and **does not minimize edge length**. 112/… leaves are ranked by separation this run. Degree-1 sinks (DLQs, param stores, S3, DynamoDB, the whole account-04 audit block) inherit the max rank of everything their unit must follow, stranding them far right of their actual source with long near-horizontal edges and wide region/account boxes. This is the common root of P1, P3, P4.

2. **(b) Within-rank ordering (P2)** is a genuine but _smaller_ and _localized_ second cause: `orderStrataUnits`/sift do not place a fan-in column's sinks near their sources' Y when the sources sit at heterogeneous ranks (api6/api7 at r13 vs api1–5 at r11), leaving residual crossings. Your "shared-source fan-out" description is the wrong shape — it's independent single-source sinks fanning IN to one column.

3. **(c) No coordinated block-shift / Y-band compaction (P3, P4).** Confirmed: there is no stage that reclaims the sparse rank band (r23–25) or the vertical dead quadrants by moving a low-degree sink or a whole sink-block left/up as a unit. `refineStrataVerticalSlots` moves Y within a rank; nothing moves a cluster's rank post-hoc toward its source. And this is **independent of** the removed X-only column compaction — that operated on all columns uniformly; what's missing is _targeted, guard-gated, source-relative_ relocation of over-ranked low-degree sinks.

4. **(d) Packed Y-from-X coupling with no height gate (P5) is the reason (a)+(c) cannot be fixed by a naive X-pull.** Packed placement derives Y greedily from X via dropY, height is unscored, and pulling a sink left grows height unless vertical slack absorbs it. So the missing counter-stage in (c) must be a _coupled X+Y move gated on height maintained-or-decreased_, not a pure X-pull. The two forces (shorten/narrow via pull-forward vs taller skyline) only cooperate under such a gate.

**One-line root cause:** strata ranks by _separation-augmented longest-path_ (rankSeparate/OD-14), which is a height-compaction lever that over-columns degree-1 sinks and whole sink-blocks — and there is no counter-stage that pulls those sinks back toward their sources (in rank/X or Y), so they strand far right, draw long near-horizontal edges, pierce frames they sit outside of, and inflate region/account boxes.

---

## Ground-truthed restatement to bring back to the owner

> In the strata layout, resource **ranks (X columns) are assigned by a longest-path pass over a graph that has been augmented with sibling-separation constraints (the `rankSeparate` height lever)**. That pass _maximizes_ each node's column and _ignores edge length_, so it strands low-degree sinks far to the right of the node that feeds them:
>
> - **DLQs (P1):** each `staging-*-dlq` is a degree-1 sink of one SQS queue. Plain layering would place it one column right of its queue (rank 6/8); separation inflates it to rank 15, giving a long near-horizontal edge. It is _mid-graph_ (rank 15 of 29), "far right" only relative to its source — not the absolute far-right column.
> - **SSM param column (P2):** the api-N `/name` params share one column (rank 15). Each is fed by _its own_ service/lambda (not a shared one). The crossings come specifically from api6/api7, whose sources sit one rank deeper and high up while their params are dumped at the bottom of the column — a within-rank Y-ordering miss.
> - **us-west-2 sinks (P3):** the api8–11 SSM params, S3 bucket, and DynamoDB table are degree-1 sinks stranded at rank 26. Crucially they are **region-level (outside vpc-5b587)** while their ECS/lambda sources are _inside_ the VPC — so the long edges pierce the VPC frame. Ranks 23–25 are a sparse band and the region box's top-right quadrant is empty dead space; pulling the sinks left+up shrinks the box and removes the pierce.
> - **Account-04 (P4):** the whole 9-node org-audit account is a pure sink block over-ranked to the far-right columns 27–29 (base ~12–15). Its anchor sinks (`sns.ops`, `cloudtrail`) are _multi-source fan-in hubs_, so there is no single upstream to co-move; the coordinated left-shift win comes from clamping the whole block toward its deepest source rank, which is LR-feasible.
>
> - **Packed vs pull-forward (P5):** the fix is not free. Packed placement assigns each unit's Y greedily from its X (dropY skyline), and height is not scored or gated anywhere. Pulling a sink left overlaps the units already in that column and forces it to drop below them — growing the box height — UNLESS there is vertical slack at its landing Y. us-west-2 has such slack but only in its upper rows, so a sink must be pulled left _and up_ together. The owner's invariant — **packed should never increase height (only maintain or decrease)** — is sound and is the right way to couple the two forces, but only as an _acceptance gate_ (reject height-increasing pulls), not as an intrinsic property: some width-shrinking moves provably require more height when no slack exists, and the gate correctly leaves those sinks wide.
>
> The shared cause is **rank assignment (separation-augmented longest-path that over-columns sinks) plus a missing counter-stage that pulls over-ranked low-degree sinks/sink-blocks back toward their sources** (in rank/X, and in Y for the P2 column) — where that counter-stage must be a **height-gated joint X+Y move** because packed derives Y from X and has no height guard today. This is _not_ the X-only column compaction that was removed.

## Flags — where the framing may mis-state what the owner sees

- **P1/P2 "far right":** the east DLQs and params are at rank 15 of 29 (middle), not the far-right column. If the owner literally sees them at the right EDGE, they may be conflating them with the account-04 block (r27–29) or the us-west-2 sinks (r26), which ARE near the right edge.
- **P2 "shared Lambda + Service":** no shared source exists — each param has its own. Worth confirming the owner isn't describing a different column.
- **P3 "large empty horizontal gap":** the gap is better described as a _vertical dead quadrant_ + sparse ranks, not an empty horizontal column between two occupied ones.
- **P4 "block + its source move together":** there is no single source; confirm the owner is picturing a block clamp, not a source-coupled slide.
