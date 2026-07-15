# Strata layout — session handoff (2026-07-15)

**For the next agent.** This picks up a long research + build session on the Terraform **strata**
layout view. Read this first, then the linked docs. Everything is on branch
`strata-v3.2-w5-w10b` (NOT master — master is branch-protected). Nothing here is pushed.

---

## TL;DR — where things stand

A multi-phase investigation established, with cross-validation and two independent convergence
analysts, that **strata's Sugiyama SKELETON is sound but its OBJECTIVE and MEASUREMENT layer is the
accreted mistake.** The diagnosis is converged and solid; the *prescription* is **staged** and
**blocked on one thing that hasn't happened: human preference labels.**

> **The single highest-leverage next action is NOT another code fix — it is labeling the calibration
> pairs.** Every open decision (ε default, the rank-compact/Account-04 trade, rankSeparate keep/kill,
> promoting `strataTransitiveAdopt`, patch-vs-rebuild) routes through **one unlabeled blinded
> preference set** that was built this session and never run. Until it's labeled, all exchange-rate
> decisions are guesses, and the *evidence we do have* mildly favors incremental patching over a
> ground-up objective rebuild.

---

## The diagnosis (converged, cross-validated)

Read `docs/strata-pipeline-objective-audit-2026-07-15.md` (the 10-agent audit) and
`docs/graph-layout-aesthetic-balancing-research-2026-07-15.md` (the literature) for full detail.
Headline findings, several reproduced in code:

1. **Two premise corrections everyone must internalize:**
   - The owner's config (`strataSift=1`) runs the **weighted** adoption comparator (`C=pen+cross`,
     1:1), **NOT** lexicographic `crossings≻pen≻length`. They disagree on **43.8%** of decisions.
   - **Edge length has ZERO weight on the X axis** (X is pinned to dataflow rank; the L1 tiebreak is
     horizontally blind). The owner's real complaints (long DLQ / Account-04 edges) are ~100%
     *horizontal* → length isn't demoted, it's **unrepresented**.
2. **The skeleton (rank→order→packed) is canonical** and correct. Two structural gaps: **no routing
   phase** (the scorer measures straight center-chords, not the rendered arrows) and the
   **A7→guard→relocate refinement tail is accreted thrash** (three comparators, no fixpoint).
3. **Crossings-first-lexicographic has ZERO literature support** — the code itself admits it (cites
   Ware's *finite* crossing price); Klammler *measured* human weights: **edge-length ≈ crossings**
   (equal); metro-map methods make crossings ~0 by construction. `rt̂` (the honest readability metric)
   **never drives candidate selection** — it can veto whole *features* but never rescue a *candidate*.
4. **Penetration should not be a scored middle tier** — in the literature it's *hard feasibility*
   (routing obstacles / containment), never traded 1:1 against crossings. Strata's `pen≻length` (and
   the weighted `pen+cross`) have no analog.
5. **Measurement is directionally circular** — the gates can *block* a technical win that hurts
   readability but can *never approve* a human-preferred layout that costs crossings (the owner's
   `cand13` can never be chosen). n=1 Q7, chord-vs-rendered proxy-blindness.
6. **`ε=2` is a provably inherited magic number** (introduced as a report-only arm that saturated at
   1; sift+relocate inherited 2 without ablation; evidence-supported value is 0).
7. **The "silly layouts" are NOT the objective ordering per se** — a 5,325-trial dual-scoring probe
   found the objective picks the min-length geometry in **21/28 hulls**; the visible ugliness is four
   downstream defects: **chord-proxy sign-inversion** (rejects a candidate for "+3 chord crossings"
   that *renders* with fewer), the **X search-space gap**, **descent non-convergence**, and
   **unscored crossing-angle**.

**The forward thesis both convergence analysts + the controller agreed on (staged, not either/or):**
> (1) **Now:** ship individually-verified, collision-gated X moves + finish the scoring/adoption
> *correctness* repairs. (2) **Then:** replace the comparator architecture with **hard geometric
> feasibility (penetration=0 via routing obstacles) + ONE finite rendered-geometry objective
> calibrated on held-out human preferences**. Superiority of (2) is UNPROVEN until labels +
> cross-preset batteries + an end-to-end prototype exist.

---

## What shipped this session (all on `strata-v3.2-w5-w10b`, unpushed)

| Commit | What |
|---|---|
| `e22e5c657` (prior) | `strataPackedConverge` — best-seen convergence + its settings toggle |
| `3f668ce3d` | rankCompact investigation + design spec + M0-passed impl plan |
| `4d1fec1df` | **10-agent pipeline objective/ranking/measurement audit** (the core diagnosis) |
| `1d8282012` | **P1 blinded pairwise preference CALIBRATION HARNESS** (the linchpin — labels pending) |
| `68f34bdce` | **`strataTransitiveAdopt`** — transitive adoption relation, opt-in default-off (Lane B) |
| `4de5f4d2a` | Settings toggle for `strataTransitiveAdopt` (10-file thread incl. session/share) |
| `7b344d72c` | Graph-layout aesthetic-balancing research + **missing-literature.md** backlog |

Also relevant docs: `docs/strata-methodology-audit-2026-07-15.md` (an earlier 9-agent audit that
rated things "SOUND" — **treat with caution: it audited the wrong comparator and its "already fixed
via converge" claim was falsified by Lane B**), `docs/strata-nitpick-layout-optimization-2026-07-15.md`,
`docs/superpowers/specs/2026-07-15-strata-rank-compact-design.md` (⚠️ **stale — says "M0 PASS" but
M0.5 refuted it**, see below).

Progress ledger with every task/verdict: `.superpowers/sdd/progress.md` (gitignored scratch).
Per-agent reports: `<scratchpad>/strata-*.md` (session-scoped `/private/tmp/...`).

---

## THE NEXT ACTION: label the calibration pairs (owner-run)

`docs/strata-baselines/prefpairs/` — 13 blinded pairs, sealed key, browser viewer, Bradley-Terry fit.
```bash
cd docs/strata-baselines/prefpairs && python3 -m http.server 8000   # open index.html
# label A/B/tie + confidence per pair, Download labels JSON into labels/
node scripts/strata-pref-fit.mjs --dir docs/strata-baselines/prefpairs --out docs/strata-baselines/prefpairs/FIT_REPORT.md
```
Needs **owner + ≥2 raters**. Held-out invariant: never optimize against these pairs; only the fitted
exchange rate is decision-facing. This unblocks ε, Account-04, rankSeparate, and the patch/rebuild call.

---

## Open decisions (owner rulings) & queued follow-ups

**Owner value calls (need the calibration or a ruling):**
- **F1 (master): patch vs rebuild** — evidence mildly favors patch; literature favors rebuild.
- **F2: `rankSeparate`** — keep (taller) or drop (recovers a task-metric win, regresses height). It
  was accepted on a superseded metric and its W8 guardrail was never shipped. On in owner's config.
- **F3: ε default** — evidence says 0 (saturates at 1); shipped 2, inherited without ablation.
- **F4: penetration** — keep-and-tune the scored tier, or abolish it via a routing phase
  (which would also fix the chord-vs-rendered inversion, C6).
- **F5: promote `strataTransitiveAdopt`** off default-off — needs the items below.

**Code follow-ups (build-actionable):**
1. **Lane B is descent-scoped only** — the post-A7 **vertical-relocate** stage
   (`terraformPipelineStrataVerticalRelocate.ts`, runs in the owner's config) still uses the
   **untouched non-transitive gate**, so the 5.3 bug survives downstream. Complete the transitive fix
   there before any promotion.
2. **Lane B promotion gates:** both-preset × ε × siftRelocate battery + paired rt̂/cr-on-path (W7 bar);
   re-measure the W8b SQS/Dynamo case (Lane B removes the ε-arm's "L1-buys-crossings" power);
   head-to-head vs `GATE+converge` (Lane B is +4 crossings/−4 pen — a frontier point, not a strict win).
3. **Fix the stale rank-compact design doc** — `docs/superpowers/specs/2026-07-15-strata-rank-compact-design.md`
   header still says "M0 PASS"; **M0.5 refuted it** (the generic X-length solver *degenerates* to
   rankSeparate's width once cross-hull separation is added to make it collision-clean — only the
   surgical **degree-1 sink pull-in** survives, and even that is **verify-or-keep per move**: Task 0
   found only 5/27 sink pull-ins collision-clean).
4. **R1 rendered-rescore is deferred, not dead** — the chord-proxy sign-inversion is real (C6), but a
   viable repair needs a *budgeted geometry-only* rescorer (finalizing every candidate to rank on the
   final surface costs ~minutes, not the 16s first estimated) + a rendered-pierce non-regression cap +
   a tested transitive arg-min. Its pierce trade is judgeable only with the calibration.
5. **Harvest the missing literature** — `docs/graph-layout-rag-missing-literature.md` lists 16
   confirmed-missing + 17 metadata-only papers (incl. Ware 2002 primary PDF). Ingest into
   graph-layout-rag **on the desktop** (RAG SSH is blocked in codex/worktree sandboxes; Fable/`bin/rag`
   from the Mac works).

---

## Invariants & gotchas (do not violate)

- **Branch, not master:** commit on `strata-v3.2-w5-w10b`. Pushing needs `--no-verify` (doc/baseline
  prettier drift trips the ~10-min pre-push gauntlet) — see memory `push-and-prepush-gotchas`.
- **Every strata toggle is opt-in, default-off, byte-identical when off**, and byte-identical for
  non-strata views. Freeze/SHA baselines (`docs/strata-baselines/*`, seed 20260704) must stay green
  with **no regen** — automatic iff off is byte-identical. Do NOT edit the freeze/gate tests.
- **Option-threading boundary** (memory `rcll-option-threading-boundary`): a new option must be
  forwarded at EVERY layer or it's silently dropped on the real app path. The full converge/transitive
  footprint is **10 files** (defaults, demoUrlParams, useTerraformImportDialog, TerraformImportDialog,
  TerraformStrataSettings, TerraformImportPipelineSettings, **terraformPresetImport, terraformSceneApply
  [session/Regenerate], terraformImportSession, terraformCanvasShareUrl [share URL]**) + the engine
  side (terraformPlanParsing → terraformLayoutCore sceneContext → terraformPipelineStrata → engine).
- **NaN import-cycle rule:** no module-level consts imported from `terraformPipelineLayoutShared`.
- **Worktree agents fork at STALE `56623eacce`** (pre-W5) — always `git checkout <branch-tip> -- .`
  first; use a private `vitest.probe.config.mts` (server.fs.allow + absolute `vitest-canvas-mock` +
  private cacheDir; drop the `**/.claude/**` exclude). **NUL-separated hull ids** trip the pre-push
  binary gate — escape them in any source file.
- **`graphify query` before reading source** (a hook enforces this).
- **codex** rejects `--model gpt-5.6` on this ChatGPT account (use default med); its sandbox is
  read-only (can't write scratchpad — harvest from the job JSON `.result.rawOutput`).

## Key source files (the engine)
`terraformPipelineStrataRank.ts` (X/rank, rankSeparate NS-drop guard :117-129) ·
`terraformPipelineStrataRankSeparate.ts` · `terraformPipelineStrataOrdering.ts` (orderStrataUnits,
weightedBandsSkippedCost) · `terraformPipelineStrataPackedScoring.ts` (strataPackedScoreLess,
strataRelocateAdoptable, ε, the new `strataTransitiveAdopt`) · `terraformPipelineStrataVerticalRelocate.ts`
(the un-fixed relocate stage) · `terraformPipelineStrataCoordRefine.ts` (A7) · `terraformPipelineStrata.ts`
(chooseStrataRefinedPlacement guard) · `terraformPipelineStrataPathMetrics.ts` (rt̂) ·
`terraformPipelineStrataPlacement.ts` (placeStrataHulls).

## Memories (auto-loaded index at MEMORY.md)
`strata-pipeline-objective-audit`, `strata-horizontal-compaction`, `strata-row-order-nonconvergence`,
`strata-view-build`, `rcll-option-threading-boundary`, `push-and-prepush-gotchas`, `codex-review-cadence`.
