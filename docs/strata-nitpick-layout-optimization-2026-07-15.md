# Strata layout nitpicks — 6-agent optimization audit — 2026-07-15

**Purpose (read me first).** Handoff record of a 6-agent (4 opus + 2 codex) adversarial
investigation of **five layout imperfections** the owner spotted on the strata view, on the
**post-converge** config (`strataPackedConverge=1`). Every agent ran in its own git worktree with
graph-layout-rag (3k+ papers) + web + repo, measured through the **real app path**
(`layoutTerraformFromSources`) with an adapted probe, and was told to **shit-test the owner's claim
AND the "it's a bug" framing** before endorsing either. Future agents can use this to see what each
agent did, what it concluded, and the measured evidence — without re-running the audit.

Exact config under test:
```
preset=staging-extended-localstack-v2 view=strata compact=1 ancillary=0 privateApiRegional=0
strataSweeps=4 strataCoordRefine=1 strataRankSep=1 strataPackedScoring=1 strataPackedEps=2
strataBandDepth=root strataSift=1 strataPackedConverge=1 layers=declared
```

> **TL;DR verdict.** **3 of 5 owner claims are measurably refuted; the 2 real ones (#1, #4) share a
> single root cause that is HORIZONTAL, not ordering.** Strata has **no rank-axis (horizontal)
> edge-length compaction** — every hull/leaf X is pinned to its global dataflow rank, `rankSeparate`
> strands siblings and degree-1 sinks in the far-right column, and the edge-length-minimizing
> network-simplex ranker is **explicitly dropped whenever `rankSep` is on**. This is **not a bug and
> not a missing *ordering* pass** (leaf resources are already first-class, sift-eligible, and
> globally scored). It is a **missing horizontal-compaction pass**, and closing it is a
> **crossings-for-length tradeoff** (owner-objective-gated, same lexicographic tension as ε/converge).

---

## Per-nitpick verdicts (measured)

| # | Owner claim | Verdict | Measured evidence | Agents |
|---|---|---|---|---|
| **1** | Account 000000000004 too far right; narrow + move left → shorter edges | ✅ **Real — `missing-pass`, crossings-for-length tradeoff** | Pure-X translation of the Account-04 subtree by the visible **1,470px** gap: total L1 **−4.79%**, cross-account L1 **−9.19%**, **0 structural violations, 0 effective-X-order violations, but +4 crossings** (226→230), pen −6. rankSep over-push: an **in-deg-0 source alarm shoved rank 0→27**. | opus-1, codex-1 (both measured) |
| **2** | Config recorder pushed back; move forward → shorter | ❌ **Refuted — `expected`** | Topological **sink** (out-deg 0). Rank forced by a direct effective edge from `aws_s3_bucket.audit["audit"]` (rank 28). **Every** earlier integer rank violates that forward edge → rank is the earliest legal one. | opus-1, codex-1 (independent) |
| **3** | Reorder loose col → more compact us-west-2 + shorter | ❌ **Refuted — `config/cosmetic`** | **Brute-forced all 720 column orderings**: region-column **height strictly invariant** (1350px in every order — a single stacked column has fixed height), total L1 moves **≤6px of 317k**, and the owner's own "adjacent to services" order is **+11px worse**. Length is Δx-dominated (column sits ~2000px right of its services). Loose leaves **are already scored**, not fixed-order. | opus-2 (720-perm brute force), codex-2 (code) |
| **4** | DLQ edges too long | ✅ **Real — `missing-pass` (same cause as #1)** | Both DLQs are **pure sinks** (in-deg 1, out-deg 0) at rank 15 (x7440); sources at rank 8/10. Edges **2212px / 3204px, ~100% horizontal**. rankSep-off → longest-path puts each DLQ at **source+1 (adjacent) → ~500px, 4.5–6.5× shorter**. | opus-3 (measured) |
| **5** | DLQ edges cross; reorder → fewer crossings | ❌ **Refuted — swap is a no-op** | Straight-segment: **no mutual crossing in either order** (swap changes length ±2px). Two sources share a Y, two targets share an X = clean funnel; the scorer already picked non-crossing. The one real artifact = the over-long `events` edge **piercing the egress source frame** (1 pierce), gone once #4's length is fixed. | opus-3 (measured) |

## The unifying root cause

**Strata has no horizontal (rank-axis) edge-length compaction.** Mechanism, source-confirmed:

- Every unit's X = its dataflow **rank** in a shared global `columnX[rank]` grid
  (`terraformPipelineStrataPlacement.ts:155-171`); hull bounds are just the bbox of those fixed X
  extents (`:343-360`); the absolute pass only accumulates **Y** (`:369-403`).
- `strataRankSeparate` (the height lever, OD-14) applies an **all-to-all sibling separation** that
  can only push ranks **right** ("col ≥ floor"), stranding whole accounts and degree-1 sinks in the
  far-right column.
- The edge-length-minimizing **network-simplex ranker is explicitly dropped under `rankSep`**
  (`terraformPipelineStrataRank.ts:117-129`) — the two never compose today.
- `compactColumns` (`terraformPipelineColumnCompact.ts:101`) — the repo's only pull-left pass — is
  **RCLL/compound-only, within-axis, refuses cross-hull neighbours, and is never called by strata**.
- A7 coordRefine is **Y-only** (`terraformPipelineStrataCoordRefine.ts:647-672`); it cannot move X.

So #1, #4 and the geometry-waste half of #3 are all the same gap; #2 and #5 are spillover artifacts
of it, not independent issues.

**Refuted framings (do not build):** a leaf-*ordering* pass (leaves are already StrataUnits, sift-
eligible, and globally scored — `liftStrataEdgesToUnits` local-lift blindness is real at `:106/:586`
but recovered under `strataSift=1` via external-incidence sift `:599/:620`, and the **global packed
scorer reads raw `edgesPrime` through `leafBoxes` directly** — `terraformPipelineStrataPackedScoring.ts:485/497/513/516` — so all Param-Store/S3/DynamoDB/DLQ edges ARE seen); a `compactColumns` bug
(never called by strata); a scorer proxy-blindness to singleton edges (refuted, they're counted).

## Fix family (one lever, tiered)

1. **Do-first / cheapest — degree-1 pure-sink pull-in** (opus-3): after `computeStrataSeparatedFloor`,
   relocate any `outDeg=0` leaf whose rank > `maxPredRank+1` down to `source+1`, gated on
   `isDepthFloorValid` re-check + destination column/box collision. Fixes **#4** (~500px, pierce
   gone; DLQs sit beside their sources). Opt-in, default-OFF, byte-identical off. Sinks have no
   forward edges → nothing violated; only risk is destination-column packing → must collision-gate.
2. **General — edge-length-minimizing rank-axis compaction on the separated floor** (opus-1,
   codex-1): network-simplex / min-cost-flow minimizing L1 subject to the separation + forward-rank
   constraints, re-checking R2 + effective-edge order. Fixes **#1**, pulls **#3**'s far-right column
   left. The repo already has `computeNetworkSimplexDepths` but drops it under rankSep → the work is
   composing them. Owner-gated (crossings-for-length tradeoff).
3. **Zero-cost cosmetic** — natural-sort tiebreak on the loose column (`api8,api9,api10,api11`) kills
   the #3 eyesore with no geometry change.

## Owner rulings the fix needs (value calls, not engineering)

- **Crossings-for-length exchange rate.** The horizontal compaction measurably trades a few
  crossings for length (codex-1: +4 crossings for −4.79% total / −9.19% cross-account L1). Same
  lexicographic tension as the ε-frontier / converge work → needs an ε-style budget ruling.
- **Scorer fidelity (pre-existing, separate).** codex-2 flagged that
  `scoreStrataPlacementGeometry` scores **straight center-chords, not the final routed polylines**,
  and **region height is not an objective term at all** (only crossings/pen/L1). A reorder that
  shortens a region is rewarded only indirectly. Worth noting; not the main lever.

## Caveats / honesty

- **codex-2 (loose+DLQ) could not measure** — its worktree ran read-only (git-worktree/clone/vitest
  all denied), so its verdicts are **code-only conjecture**. Where it conflicts with the measured
  opus agents, the measurements win. It labels #3/#4/#5 "objective-mismatch" rather than
  "missing-pass" — the same fix pointed at from the objective side (it agrees leaves are scored and
  the real lever is horizontal); it just couldn't run opus-3's A/B.
- **#5 residual:** nobody measured *rendered-polyline* crossings (only straight center-chord). I
  can't 100% rule out a routed crossing the scorer misses, but the measured story is that #5 is a
  byproduct of #4's length (the frame pierce), not an ordering defect.

## Harness gotchas (for future worktree agents)

- Agent worktrees were created at a **stale base commit (56623eacc, pre-W5)** missing all W5–W15
  strata code. Agents had to `git checkout` branch tip `076549e71` before measurements were valid.
  **Verify the base commit first.**
- Vite fs-strict tripped on the shared symlinked `node_modules`: needed a private
  `vitest.probe.config.mts` with `server.fs.allow` + an absolute `vitest-canvas-mock` path + private
  `cacheDir` (sibling worktrees shadow the bare specifier / share `node_modules/.vite`).
- Base vitest config excludes `**/.claude/**` — but worktrees live under `.claude`, so that exclude
  must be dropped in the worktree-local config.

## Per-agent record

- **opus-1 · Horizontal (Account 04 + Config)** → #1 `config+missing-pass` (rankSep over-push;
  −12.5% edges via NS but +2.6× height tradeoff); #2 **refuted** (sink, tight bound). Probe:
  `terraformStrataHorizontalProbe.probe.test.ts`.
- **opus-2 · Loose ordering** → #3 **refuted** by all-720-permutation brute force (height invariant,
  length ≤6px, owner order +11px worse). Real fix = cosmetic sort + horizontal pull-left, not order.
- **opus-3 · DLQ length + crossings** → #4 `gap/missing-pass` (sinks stranded far-right, 2212/3204→
  ~500px under rank fix); #5 **refuted** (no-op swap; the artifact is a frame pierce). Proposed the
  degree-1 sink pull-in pass.
- **opus-4 · Literature synthesis** → all five reduce to two capabilities: (a) horizontal rank-axis
  compaction/balance, (b) leaf-scoped ordering refinement; ranked #5 first (later refuted by
  measurement), correctly flagged none are the Y-axis NO-GO in disguise. (Its #3/#5 "ordering-gap"
  conjectures were overturned by the measurement agents — a good caution on lit-only inference.)
- **codex-1 · Adversarial horizontal** → confirmed opus-1 with sharper A/B: pure-X translation
  −4.79%/−9.19% at 0 violations but **+4 crossings** (the tradeoff); #2 `expected` (0.99). Fix =
  new strata-level X-compaction pass; `compactColumns` reuse is wrong (within-axis contract).
- **codex-2 · Adversarial loose+DLQ** → read-only (no measurement); code-traced that leaves **are**
  globally scored (refutes the missing-ordering-pass framing), flagged center-chord-vs-rendered and
  height-not-scored proxy gaps; verdict "objective-mismatch."

## Key literature (doc_ids)

- `crossref-10-7155-jgaa-00500` / `forward-10-1007-978-3-030-04414-5-13` — **Jünger/Mutzel/Spisla**,
  flow formulation for horizontal coordinate assignment with prescribed width (min edge length under
  a width bound — the exact bicriteria for fix #2).
- `gansner-tse93` / `openalex-10-1109-32-221135` — network simplex (the dropped ranker) + `transpose`
  + `balance`.
- `doi-10-1007-978-3-319-42333-3-16` — Rüegg 2016 1D compaction (what ColumnCompact cites).
- `elk-10-1007-3-540-45848-4-3` — Brandes-Köpf horizontal alignment (lighter heuristic).
- `forward-10-1007-3-540-46648-7-22` — sifting to fixed point. `arxiv-2510-00331v3` — one-sided local
  crossing min. `dwyer-ipsep-cola` — IPSep-CoLa (the only true 2D fix, scoped out).

## Provenance

- Audit 2026-07-15, branch `strata-v3.2-w5-w10b` @ `076549e71`. 6 agents (4 opus Agent-tool
  worktrees + 2 codex-sol). Read-only; no production code changed by the audit.
- Screenshots: owner-supplied, 5 crops of the demo URL above.
- Related: `docs/strata-methodology-audit-2026-07-15.md` (the prior 9-agent methodology audit),
  memory `strata-row-order-nonconvergence` (the converge fix), `docs/rcll-y-axis-hull-coord-nogo.md`.
- Scratch reports: `scratchpad/strata-nit-{horizontal,loose-order,dlq-crossings,literature}-opus.md`,
  `scratchpad/strata-nit-horizontal-codex.md` (loose+DLQ codex was read-only — output in this doc).
