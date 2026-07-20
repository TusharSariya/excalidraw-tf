# Strata blinded pairwise preference set (P1 calibration instrument)

**What this is.** The held-out human-preference instrument called for by `docs/strata-pipeline-objective-audit-2026-07-15.md` §P1: the engine currently both optimizes AND evaluates on the same technical rank (crossings ≻ penetrations ≻ length), so it can block technical wins but can never approve a human-preferred layout that costs crossings (the owner's `cand13` loses to `cand33` by +1 crossing and can never be chosen). This instrument lets the owner + ≥2 raters produce blinded forced-choice preferences over pairs of REAL layouts of the same regions, from which `scripts/strata-pref-fit.mjs` estimates a finite crossings ↔ penetration ↔ length **exchange rate** with CIs. It mirrors the Q7-AXIS pattern (`docs/strata-baselines/q7axis/`): blinded sheet + sealed key + seeded randomization + frozen proposition.

## THE HELD-OUT INVARIANT (read first)

1. **Never optimize against this set.** No engine change may be tuned, gated, accepted, or rejected by re-scoring these specific pairs. The ONLY decision-facing output is the FITTED exchange rate (coefficients + CIs) from `scripts/strata-pref-fit.mjs`, used the way the audit prescribes (ε default, the Account-04 ruling, rank-compact go/no-go).
2. **The key stays sealed until labeling is complete.** Raters must not open `PREF_PAIRS_KEY.json`, any score output, or this repo's layout-metric docs for these regions while labeling. The sheet and viewer show NO scores, NO candidate ids, NO engine-pick markers; left/right slots are seeded-random (`seed 20260715`, frozen).
3. **Freeze after labeling.** Once labels exist, the pair set, sheet, proposition, and key are immutable (like the v3.1 §12 freeze baselines). New questions ⇒ a NEW instrument with a NEW seed, never an edit here.
4. Agents: treat the sealed key + labels as data for the fit script only.

## What the pairs are

Each pair = two renderings of the SAME preset (`staging-extended-localstack-v2`, strata) that differ in one documented layout decision — candidate orderings the descent rejected/missed (region-04 alt#142/alt#146, the chord-inversion cases), the Account-04 pull-in and DLQ sink pull-in (X search-space gap cases), the us-west-2 cand33-class vs cand13-class owner-tension orders (eps=1) and the cand9-class S3-lift (eps=0), plus cross-hull samples and two expected-dominated **attention checks**. The set deliberately varies crossings independently of edge length (a pure-length pair with Δcrossings=0, and large-Δcrossings pairs at near-constant length), so the exchange rate is identifiable — the generator asserts this diversity plus blinding, fidelity to the real app path (recon selections == production meta), and determinism.

## Workflow

### 1. Generate the artifacts (any machine, ~10-20 min)

```bash
STRATA_PREF_REPORT_DIR=docs/strata-baselines/prefpairs yarn vitest run \
  packages/excalidraw/components/terraformStrataPrefPairs.test.ts
```

Emits into this directory:

- `PREF_PAIRS_SHEET.md` / `.json` — the BLINDED sheet (what raters see)
- `pairs/P??/A.svg` + `B.svg` — the two renderings per pair (not committed; regenerated deterministically — same seed ⇒ same slots)
- `index.html` — self-contained labeling viewer
- `PREF_PAIRS_KEY.json` — SEALED key (candidate identity + chord AND rendered technical scores + deltas + attention-check marks). Do not open.
- `labels/` — drop rater label files here

The generation test is env-gated: without `STRATA_PREF_REPORT_DIR` it is skipped, so `yarn test` cost is unchanged.

### 2. Label (owner + ≥2 raters, independently)

Open `index.html` in a browser (from this directory, e.g. `python3 -m http.server` here and browse to it — `file://` also works in most browsers). For each pair: study the hinted area, pick **A / B / tie**, set confidence (1=slight, 2=clear, 3=strong), optionally add notes. Enter your rater name, click **Download labels JSON**, save the file into `labels/`. Raters must not discuss pairs before all labels are in. (Paper option: fill `PREF_PAIRS_SHEET.md` and transcribe to the JSON shape documented in `scripts/strata-pref-fit.mjs`.)

### 3. Fit the exchange rate

```bash
node scripts/strata-pref-fit.mjs --dir docs/strata-baselines/prefpairs \
  --out docs/strata-baselines/prefpairs/FIT_REPORT.md
```

Bradley-Terry/logistic over rendered-score deltas (use `--chord` for a sensitivity check on the optimizer's own chord scores), pair-cluster bootstrap CIs, inter-rater agreement (percent + Cohen's κ), attention-check audit. The script refuses politely while labels are pending.

### 4. Commit

After labeling: commit `PREF_PAIRS_SHEET.*`, `PREF_PAIRS_KEY.json`, `labels/*.json`, `FIT_REPORT.md`. The SVGs stay uncommitted (large, deterministic). From then on the set is FROZEN (invariant #3).

## Provenance

- Generator: `packages/excalidraw/components/terraformStrataPrefPairs.test.ts` (seed `20260715`; structure-only assertions — fidelity, blinding, determinism, diversity; never a metric value).
- Fit: `scripts/strata-pref-fit.mjs`.
- Candidate ledger sources: `docs/strata-pipeline-objective-audit-2026-07-15.md` (§1.4 Account-04, §1.5 DLQ, §1.6 region-04 trio), the row-order investigation (memory `strata-row-order-nonconvergence`, cand9/cand13/cand33), silly-layout probe report (`strata-pipeline-audit-silly-layouts.md`).
- Status: **labels pending** (owner action). n=1 owner-only labels give a provisional rate; the calibration claim requires owner + ≥2 raters.
