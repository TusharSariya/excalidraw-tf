# Strata readability — shared rubric table (H0 template)

Every downstream agent fills its owned rows. ONE owning agent per metric/case is
canonical (authority rule); others cite, never recompute. Failure-class ∈
{config, search-space, measurement, objective}. Fixable-by-generic-algorithm ∈
{yes, no, yes-with-tradeoff}. All numbers come from the H0 canonical dual-scoring
record (chord AND rendered) at the frozen config — never a hand-moved render.

## Per-case classification

| case | factor moved | baseline (chord / rendered) | owner-better Δ | failure-class | fixable-by-generic-algorithm | regression-cost-elsewhere | prescription fixes case? (y/n) | owning agent |
|------|--------------|-----------------------------|----------------|---------------|------------------------------|---------------------------|--------------------------------|--------------|
| C1 |  |  |  |  |  |  |  |  |
| C2 |  |  |  |  |  |  |  |  |
| C3-s3 |  |  |  |  |  |  |  |  |
| C3-ssm8 |  |  |  |  |  |  |  |  |
| C3-ssm9 |  |  |  |  |  |  |  |  |
| C3-acct04 |  |  |  |  |  |  |  |  |

## Per-factor handling (current vs prescribed)

| factor | current handling in pipeline | prescribed handling (SOTA-derived) | fed back into selection? | owning agent |
|--------|------------------------------|------------------------------------|--------------------------|--------------|
| crossings (chord) |  |  |  | F-CROSS |
| crossings (rendered) |  |  |  | F-CROSS |
| penetration |  |  |  | F-PEN |
| edge length (X) |  |  |  | F-LEN |
| edge length (Y) |  |  |  | F-LEN |
| crossing angle / sharp-share |  |  |  | F-ANG |
| continuity / through-hub straightness |  |  |  | F-ANG / F-HUB |
| hubs / interchange |  |  |  | F-HUB |
| LR / TFD feasibility |  |  |  | F-LR |
| two-worlds measurement gap |  |  |  | M-MEAS |
| objective architecture (weighted-C / ε / lex) |  |  |  | M-OBJ |

## Joint-balance factorial (JOINT-SYNTH)

| case | baseline | +crossings term | +penetration | +length | +angle | all-four jointly (under LR) | best |
|------|----------|-----------------|--------------|---------|--------|-----------------------------|------|
| C1 |  |  |  |  |  |  |  |
| C2 |  |  |  |  |  |  |  |
| C3 |  |  |  |  |  |  |  |

_Convergence = agents agree on case-classifications + fix-verdicts. Disagreement
IS the finding — surface it, do not average it away._
