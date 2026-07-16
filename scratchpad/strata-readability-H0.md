# H0 — Strata readability shared frozen harness (build report)

**Role:** H0 harness-builder. This is the gate: the ONE frozen experimental substrate all 12 downstream research agents consume. Metrics-only.

## Commit anchors

- **Built ON (branch tip):** `7d34c86e0fe6acb95a54194990edb404ad44da4a` (branch `strata-v3.2-w5-w10b`).
- **Harness commit:** see the final report line (this file is written before the commit; the SHA is in the agent's final message / `git log`).
- Downstream agents: `git checkout <harness-commit> -- .` into your worktree.

## Run command (the ONLY way — base config excludes `*.probe.test.*`)

```
yarn vitest run --config vitest.probe.config.mts \
  packages/excalidraw/components/terraformStrataReadabilityHarness.probe.test.ts
```

~61s, 2 tests. `EXP-H0-0` = fidelity gate + frozen baselines + rubric; `EXP-H0-1` = counterfactual generators (row-order Y + rank/column X) emitting canonical dual-scored records.

## Files (all committed to the branch)

- `packages/excalidraw/components/terraformStrataReadabilityHarness.probe.test.ts` — the harness.
- `vitest.probe.config.mts` — private probe runner (include only `*.probe.test.*`; drops `**/.claude/**` exclude; `server.fs.allow` + absolute `vitest-canvas-mock` + private `cacheDir`).
- `vitest.config.mts` — **one-line addition**: `"**/*.probe.test.*"` added to the base `exclude` so the normal suite / coverage gauntlet never runs the heavy probes. (No layout code touched — freeze/SHA gates stay green, off-path byte-identical.)
- `docs/strata-baselines/h0/baselines.json` — frozen baseline artifact (below).
- `docs/strata-baselines/h0/baseline-polylines.json` — the 145 rendered dataflow polylines of the baseline scene (for geometry diffing).
- `docs/strata-baselines/h0/rubric-template.md` — the shared convergence rubric all agents fill.
- Scratchpad copies: `scratchpad/h0-baselines.json`, `scratchpad/h0-rubric-template.md`, `scratchpad/h0-baseline-polylines.json`.

## Frozen config (verified reproduced on the REAL app path)

preset `staging-extended-localstack-v2`, view=strata, seed 20260704, `compact=1 ancillary=0 privateApiRegional=0 strataSweeps=4 strataCoordRefine=1 strataRankSeparate=1 strataPackedScoring=1 strataPackedEps=1 strataBandDepth=root strataSift=1 strataPackedConverge=1 strataTransitiveAdopt=1`.

Engine-level mapping (used by the reconstruction, mirrors `terraformPipelineStrata.ts:324-366`): `strataSift ⇒ strataSiftRelocate`, `strataPackedConverge ⇒ packedConverge`, `strataTransitiveAdopt ⇒ transitiveAdopt`, `packedScoringEpsilon=1`, relocate weights `penW=crossW=1`, `edgeCrossCap` inherits ε=1.

## Fidelity gate (green)

- determinism: 2 cold builds byte-identical under the strengthened ordering-sensitive signature (1499 elements).
- reconstruction: descent selections + trialCount + **final scene signature** == the real `layoutTerraformFromSources` output → `expect(reconMatchesReal).toBe(true)`.
- Real meta: `fellBack=false trials=5325 eps=1 effDelta=1`, `convergeRecovered=null` (transitiveAdopt makes converge inert, as designed).

## Canonical dual-scoring schema (every record, baseline or counterfactual)

- **chord** (`scoreStrataPlacementGeometry` + in-file X/Y split): `crossings, penetrations, lengthL1, lengthL1X, lengthL1Y, weightedC`.
- **rendered** (`diagnosePipelineScene` + `computeStrataPathMetrics` + `computePierceMetrics`): `crossings, sharpShare, tll, tllX, tllY, pierce, conP50, conMean, gdevMaxDeg, rtHatP50, rtHatMean, pathRows, dataflowArrows, leftwardArrows`. Guarded: on a scene-build failure it emits `{error}` and the chord metrics still stand (chord needs only leafBoxes).
- **lr**: `backwardNonReversed, reversedEdges, feasible`.
- **polylines**: final rendered dataflow polylines (included for baselines).

## FROZEN scene-level baseline (whole layout)

```
chord    { crossings:204, penetrations:66, lengthL1:733742.08,
           lengthL1X:539648, lengthL1Y:194094.08, weightedC:270 }
rendered { crossings:173, sharpShare:0.51, tll:284223, tllX:240450, tllY:86963,
           pierce:66, conP50:104.36, conMean:145.833, gdevMaxDeg:140.09,
           rtHatP50:12.91, rtHatMean:13.069, pathRows:500,
           dataflowArrows:145, leftwardArrows:0 }
lr       { backwardNonReversed:0, reversedEdges:0, feasible:true }
```

**Chord-vs-rendered inversion is present by construction:** chord crossings 204 vs rendered 173, chord L1 is ~66% X / 34% Y while rendered TLL is ~85% X / 15% Y (the L1-X the objective carries but never optimizes dominates rendered length). `sharpShare 0.51` and `gdevMaxDeg 140°` confirm the unscored crossing-angle / continuity defects reproduce at ε=1.

## Per-case FROZEN target baselines (chord geometry, doubled-centre units)

| case | cluster | region / account | rank | far-right? | leafBox (x,y) | incident edge L1 |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | `module.api6.aws_ssm_parameter.api_name` | us-east-1 / 0002 | **15/29** | **no** | 7440,5678 | in←lambda 5568 |
| C2 | `module.ingress_queue…aws_sqs_queue.dlq[0]` | us-east-1 / 0002 | **15/29** | **no** | 7440,6831 | in←queue.this 7175 |
| C2 | `module.egress_queue…aws_sqs_queue.dlq[0]` | us-east-1 / 0002 | **15/29** | **no** | 7440,6600 | in←queue.this 5191 |
| C3-s3 | `module.api8_west_bucket…aws_s3_bucket.this[0]` | us-west-2 / 0002 | 26/29 | no | 12896,3948 | in←ecs.api 5480 |
| C3-ssm8 | `module.api8.aws_ssm_parameter.api_name` | us-west-2 / 0002 | 26/29 | no | 12896,3717 | in←ecs.api 5018 |
| C3-ssm9 | `module.api9.aws_ssm_parameter.api_name` | us-west-2 / 0002 | 26/29 | no | 12896,4179 | in←ecs.api 5480 |

Full per-edge chord Δx/Δy/leftward/reversed detail is in `baselines.json`.

## FIRST-CLASS FINDINGS at the frozen config (ε=1 + transitiveAdopt=1)

These are H0 observations for the case agents — NOT adjudications (that is CASE-C1/C2/C3's job).

1. **"Far-right column" is a framing/measurement artifact, not the geometry.** NONE of the owner-cited targets sit at the max column: C1 and both C2 DLQs are at **rank 15/29**; C3 targets at **26/29**. `isFarRightColumn=false` for all. The owner's visual "far right" ≠ the rank axis. (Candidate failure-class: **measurement**.)
2. **C3's "Account 04" ≠ the us-west-2 targets' account.** The S3-west + api-8/9 ssm params are **account 000000000002, region us-west-2**. Account 04 (`000000000004`) is a _separate_ us-east-1 block (selection 138). C3's "whole Account 04 block moves left" is therefore a DISTINCT sub-move from the us-west-2 node moves — treat them separately (the plan already says so).
3. **The two owner-named C2 queues** `staging-egress-dlq` / `staging-events-dlq` are TAG names; by module the DLQs are `ingress_queue`/`egress_queue` (+ a third `aws_sqs_queue.ingest_fifo_dlq` at rank 11, account 0003, which has a long 19282-L1 outbound edge to `sns_topic.ops`). CASE-C2 must confirm the exact tag→module mapping; H0 captured all three DLQ candidates.
4. **All edges are LR-feasible** (`backwardNonReversed=0, reversedEdges=0`) — no cycle-repair back-edges in this preset at this config. So the LR/TFD rule is NOT currently violated; the F-LR tension ("must LR relax for octilinear hubs?") is a _design_ question here, not a live infeasibility.

## Counterfactual generators — proven working (EXP-H0-1)

Both inject into the REAL search space (recompute placement → A7 → relocate → score), NOT a hand-moved render.

- **(a) Row-order (Y) injection** `injectRowOrder(recon, hullId, idx|'legacy')`: demo forced the us-west-2 region hull to its legacy order → `chord C 270→283` (WORSE) — confirms the engine already picked the better Y order there, and the injector wires through the real placer.
- **(b) Rank/column (X) injection** `injectRankOverride(recon, Map<clusterId,newRank>)`: demo pulled both C2 DLQs one column left of their **actual rank 15** (owner "move left") → `chord L1 −1909` (SHORTER, as the owner expected) but `crossings 0, pen 0, weightedC 0` **unchanged**. **This is the mechanism the Y-order enumeration never reaches, and it previews the C2 objective finding: the length win the owner sees is real, but the frozen adoption objective (weightedC, crossings-first) is INDIFFERENT to X-length — length is effectively zero-weight on the X axis.** CASE-C2 should sweep further-left ranks and check hull-penetration removal with this injector.

### Injector caveat (honest scope for the case agents)

`injectRankOverride` moves _leaf_ clusters between existing columns (keeps `columnX`). It covers the leaf sub-moves (C2 DLQs, C3 S3/ssm). It does **not** yet implement a whole-hull block X-shift ("the entire Account 04 block moves left", C3) — that needs a hull-level column re-pack, which CASE-C3 should build on top of this injector. An X-move can trip a structural check; `emitRecord` guards the scene build and still returns chord metrics, so a scene-build failure is itself a recorded finding rather than a crash.

## Rubric template

`docs/strata-baselines/h0/rubric-template.md` — per-case classification table (failure-class ∈ {config, search-space, measurement, objective}; fixable-by-generic-algorithm ∈ {yes/no/yes-with-tradeoff} + regression cost), per-factor current-vs-prescribed handling with fed-back? column, and the JOINT-SYNTH factorial table. One owning agent per metric/case (authority rule).

## Constraints honored

- NaN import-cycle rule: no module-level const from `terraformPipelineLayoutShared`.
- Freeze/SHA gate tests untouched (`FreezeBaselines` runs skipped as normal; no regen).
- NUL-separated hull ids stored as ` ` escape text — no raw NUL bytes in any committed file (binary gate clean).
- Determinism: same commit + seed + config ⇒ identical records (pure integer engine geometry).
- `yarn test:typecheck` green.
