# P2 — SSM parameter column crossings (account02 us-east-1)

**Status:** confirmed as within-rank ordering (but "shared source" premise refuted). Lever B candidate.
**Independent** of P1/P3/P4 — distinct mechanism (ordering, not ranking).

## Ground truth — all 7 params share one column (rank 15, x=7440)

| param | y | source | source rank / y |
|---|---|---|---|
| api1 | 3830 | api1 lambda | r11 / 3886 |
| api2 | 4292 | api2 ecs service | r11 / 4117 |
| api3 | 4523 | api3 ecs service | r11 / 4348 |
| api4 | 4754 | api4 lambda | r11 / 4810 |
| api5 | 5216 | api5 ecs service | r11 / 5041 |
| api6 | 5678 | api6 lambda | **r13 / 3886** |
| api7 | 5909 | api7 ecs service | **r13 / 4117** |

## The problem

All 7 `api-N /name` params sit in one column; their Y-order is set by
`orderStrataUnits`→`refineStrataVerticalSlots`. **api1–api5 and their sources are both top-to-bottom
monotonic (r11, y 3886→5041) → no crossings.** The offenders are **api6/api7**: their sources sit **one rank
deeper (r13) and high-Y (3886/4117)** while their params are dumped at the **bottom** of the column (y
5678/5909). So the api6/api7 edges rise diagonally across the api2–5 edges → crossings + extra length.

## Correction to the original framing

**"Fed by a shared Lambda (api-6) + Service (api-7)" — refuted.** Each param is a degree-1 sink of **its
own** module's compute (api1←api1-lambda, …). No shared source. It is a **fan-IN of independent
single-source sinks into one column**, not a shared-source fan-out. (Confirm you weren't describing a
different column.)

## Candidate lever (B)

Improve within-rank ordering so a fan-in column's sinks sit near their **sources' Y** even when the sources
are at heterogeneous ranks — specifically lift api6/api7 params toward the top (near their r13 high-Y
sources) instead of the bottom. All same rank, same account, no frame pierce → LR- and containment-trivial.
`strataSift` already touches this column but did not resolve the api6/api7 inversion at the frozen config.

## Risk / constraints

Low. Pure Y-reorder within one rank, no X change, no ranking change, no packed height effect (same column
occupancy). Localized win.

## Benefit

Removes the api6/api7 diagonal crossings and shortens those two edges. Smaller than P1/P3/P4 but cheap and
isolated — good "anytime" fix.

## Interlink note

Weakly linked to P3/P5: a better within-rank order can let `dropY` pack a column slightly tighter. But P2's
fix stands alone and needs neither the height gate nor the ranking counter-stage.
