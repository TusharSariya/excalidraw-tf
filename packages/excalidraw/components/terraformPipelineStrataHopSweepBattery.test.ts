/**
 * W13 hop-depth × direction sweep battery (WP5 of the W13 vertical slice).
 * Pre-registered analysis record: docs/strata-view-w13-hop-sweep.md
 * (commit 0519453b5 + AMENDMENT-1 naming/definition pins) — committed BEFORE
 * this file produced any statistic; this battery implements exactly that
 * record. Any divergence is a defect in THIS file, never a license to edit
 * the record.
 *
 * Report-emitting, W11/W12-style: this file owns NO layout behavior, changes
 * NO product geometry, and NEVER asserts metric values — hard asserts exist
 * ONLY for harness health (report written, presets exist, populations
 * non-empty, zero unmappable anchors on P1/P2, the record §6 SANITY ANCHORS,
 * the forward-truth cross-check vs computeStrataConeMetrics, and run-twice
 * fragment determinism). No gateRegister / V32 manifest interaction.
 *
 * Scene builds: arm I ONLY (strata K=4 sweeps + coordRefine compact — option
 * bundle byte-equal to the W11/W12 batteries' arm I), one build per preset
 * per determinism pass. The sweep is RUNTIME traversal over the built scene;
 * no layout option varies across cells.
 *
 * Grid (record §3): per (preset, direction, anchor) ONE uncapped
 * getTerraformRelationshipFocus call; every K cell is a THRESHOLD of that
 * single traversal's nodeDistance map (nodeDistance ≤ K). K axis = every
 * integer 0..max-observed-finite-distance (per preset, max across the three
 * directions) plus ∞. Direction axis = {both, dependencies, dependents}.
 *
 * Truth builders (record §4, per direction):
 *   dependencies → FORWARD closure (trueReachFrom, the W12 re-inline pattern:
 *                  self-loops skipped, parallel arrows collapsed,
 *                  computeStrataConeMetrics convention; cross-checked against
 *                  rows[].coneNodes);
 *   dependents   → REVERSE closure (same BFS on the transposed arrow set);
 *   both         → judged vs the FORWARD closure (deliberate asymmetry — the
 *                  W11 task-mismatch cell reproduced across the K axis, NOT a
 *                  fair-population comparison).
 *
 * Estimator (record §5): anchor self-included in predicted AND truth sets;
 * per-anchor precision/recall from RAW integer counts; equal anchor
 * weighting (macro mean); rounding presentation-only — the §7 rule compares
 * FULL-PRECISION macros. The 4dp meanPrecision/meanRecall fields additionally
 * mirror the W11/W12 rounding convention (round4 per anchor, then round4 of
 * the mean) so the §6 sanity-anchor cells are comparable EXACTLY.
 *
 * Recommendation (record §7, mechanical, REPORT-only): per direction the
 * smallest integer K with full-precision macro precision ≥ 0.90 AND macro
 * recall ≥ 0.95 on BOTH P1 AND P2; none ⇒ keep the current default 3. P3 is
 * confirmatory-only and never selects or vetoes.
 *
 * Interpretation of every number is BLOCKED-ON-Q7; population-match evidence
 * only (W11 caveat), NOT task evidence; any default flip is an owner decision.
 *
 * Run:
 *   HOPSWEEP_REPORT_DIR=docs/strata-baselines/hopsweep yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataHopSweepBattery.test.ts \
 *     --exclude "**\/.claude/**"
 * Writes FOCUS_HOP_SWEEP.json (+ FOCUS_HOP_SWEEP.normalized.json, wall-clock
 * keys stripped — the run-twice comparand) to $HOPSWEEP_REPORT_DIR (default
 * tmpdir; CI never rewrites committed artifacts).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { BOOTSTRAP_SEED } from "./terraformPipelineBootstrapCi";
import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import { isTerraformLayerEdge } from "./terraformElementMetadata";
import {
  getTerraformRelationshipFocus,
  type TerraformFocusDirection,
} from "./terraformRelationshipFocus";
import {
  computeStrataConeMetrics,
  type StrataConeMetrics,
} from "./terraformPipelineStrataPathMetrics";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const PRESETS = {
  P1: "staging-extended-localstack-v2",
  P2: "staging-localstack",
  P3: "staging-heldout-mesh",
} as const;
type PresetLabel = keyof typeof PRESETS;
/** P1/P2 = selection presets (the §7 rule reads ONLY these); P3 =
 * confirmatory-only (reported alongside, never selects or vetoes). */
const SELECTION_PRESETS: readonly ("P1" | "P2")[] = ["P1", "P2"];

const REPORT_DIR = process.env.HOPSWEEP_REPORT_DIR ?? tmpdir();
/** W11-battery timeout family; ×12 covers the 6 arm-I builds (3 presets × 2
 * determinism passes) + runtime traversals with generous margin. */
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12;

const DIRECTIONS: readonly TerraformFocusDirection[] = [
  "both",
  "dependencies",
  "dependents",
];

/** Frozen §7 thresholds (full-precision comparison, no rounding). */
const RULE_PRECISION_MIN = 0.9;
const RULE_RECALL_MIN = 0.95;
/** Current shipped default hop depth (the §7 fallback when no K qualifies). */
const CURRENT_DEFAULT_K = 3;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ── arm I — option bundle byte-equal to the W11/W12 batteries ────────────────

const ARM_I_OPTIONS: Record<string, unknown> = {
  layoutMode: "strata",
  pipelineCompact: true,
  strataSweeps: 4,
  strataCoordinateRefine: true,
};

// ── scene readers (re-inlined W11/W12 conventions; those helpers are
// file-local, not exported) ──────────────────────────────────────────────────

const customDataOf = (el: ExcalidrawElement): Record<string, unknown> =>
  (el.customData as Record<string, unknown> | undefined) ?? {};

const relOf = (el: ExcalidrawElement): Record<string, unknown> | null => {
  const r = customDataOf(el).relationship;
  return r && typeof r === "object" ? (r as Record<string, unknown>) : null;
};

type TfdArrow = { source: string; target: string };

/** Same population as computeStrataConeMetrics (engine-emitted non-aggregated
 * relationship arrows; NOT filtered on isDeleted — TFD arrows are emitted
 * soft-deleted). */
function tfdArrowsOf(elements: readonly ExcalidrawElement[]): TfdArrow[] {
  const out: TfdArrow[] = [];
  for (const el of elements) {
    if (el.type !== "arrow") {
      continue;
    }
    const r = relOf(el);
    if (
      r == null ||
      typeof r.source !== "string" ||
      typeof r.target !== "string" ||
      r.aggregated === true
    ) {
      continue;
    }
    out.push({ source: r.source, target: r.target });
  }
  return out;
}

/** True declared-dependency reachability (computeStrataConeMetrics convention:
 * self-loops skipped, parallel arrows collapsed, source→target =
 * "dependencies") — the W12 re-inline pattern, verbatim. The dependents truth
 * builder calls this with the TRANSPOSED arrow set (record §4). */
function trueReachFrom(
  arrows: readonly TfdArrow[],
  anchor: string,
): Set<string> {
  const out = new Map<string, Set<string>>();
  for (const { source, target } of arrows) {
    if (source === target) {
      continue;
    }
    (out.get(source) ?? out.set(source, new Set()).get(source)!).add(target);
  }
  const reach = new Set<string>([anchor]);
  let frontier = [anchor];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const u of frontier) {
      for (const v of out.get(u) ?? []) {
        if (!reach.has(v)) {
          reach.add(v);
          next.push(v);
        }
      }
    }
    frontier = next;
  }
  return reach;
}

/** Graph addresses of all elements (nodePath, else terraformVisibilityKey) —
 * the focusNodePath identity space (unmappable anchors reported honestly;
 * MUST be zero on P1/P2 per record §5). */
function elementGraphAddresses(
  elements: readonly ExcalidrawElement[],
): Set<string> {
  const out = new Set<string>();
  for (const el of elements) {
    const cd = customDataOf(el);
    if (typeof cd.nodePath === "string" && cd.nodePath.length > 0) {
      out.add(cd.nodePath);
    } else if (
      typeof cd.terraformVisibilityKey === "string" &&
      cd.terraformVisibilityKey.length > 0
    ) {
      out.add(cd.terraformVisibilityKey);
    }
  }
  return out;
}

/** AMENDMENT-1(2): the cone-size-share denominator — the traversal node
 * universe: every distinct graph address appearing as an endpoint of any
 * focus-traversal edge (relationship endpoints + directions[] hints on
 * isTerraformLayerEdge elements) ∪ the anchor set. */
function traversalNodeUniverse(
  elements: readonly ExcalidrawElement[],
  anchors: readonly string[],
): Set<string> {
  const out = new Set<string>(anchors);
  for (const el of elements) {
    if (!isTerraformLayerEdge(el)) {
      continue;
    }
    const r = relOf(el);
    if (typeof r?.source === "string" && typeof r?.target === "string") {
      out.add(r.source);
      out.add(r.target);
    }
    if (Array.isArray(r?.directions)) {
      for (const d of r.directions as unknown[]) {
        if (!d || typeof d !== "object") {
          continue;
        }
        const hint = d as { source?: unknown; target?: unknown };
        if (
          typeof hint.source === "string" &&
          typeof hint.target === "string"
        ) {
          out.add(hint.source);
          out.add(hint.target);
        }
      }
    }
  }
  return out;
}

const mean = (vals: readonly number[]): number =>
  vals.length === 0 ? 0 : vals.reduce((s, v) => s + v, 0) / vals.length;

// ── per-arm build (single seam, W11/W12 convention) ──────────────────────────

type ArmData = {
  elements: ExcalidrawElement[];
  cones: StrataConeMetrics;
  buildMs: number;
  elementCount: number;
  rcllV2Degraded: unknown;
  strataStructural: unknown;
};

async function buildArmI(
  sources: TerraformImportPresetSources,
): Promise<ArmData> {
  clearTerraformImportPrepCache();
  const t0 = performance.now();
  const body = await layoutTerraformViaWorkers(
    {
      planDotBundles: [...sources.planDotBundles],
      states: [],
      stateLabels: [],
      tfdTexts: [...sources.tfdTexts],
      tfdLabels: [...sources.tfdLabels],
    },
    { semanticLayout: false, ...ARM_I_OPTIONS },
  );
  const buildMs = performance.now() - t0;
  const elements = (body.elements ?? []) as ExcalidrawElement[];
  const meta = (body.meta ?? {}) as Record<string, unknown>;
  return {
    elements,
    cones: computeStrataConeMetrics(elements),
    buildMs: round2(buildMs),
    elementCount: elements.filter((e) => !e.isDeleted).length,
    rcllV2Degraded: meta.rcllV2Degraded,
    strataStructural: meta.strataStructural ?? null,
  };
}

// ── sweep cells ──────────────────────────────────────────────────────────────

type SweepCell = {
  /** Integer K, or "inf" for the uncapped cell. */
  k: number | "inf";
  status: "SUPPORT" | "INCONCLUSIVE" | "VOID";
  anchors: number;
  /** Raw integer aggregation (record §5) — ratios derive from these + the
   * per-anchor full-precision macro below. */
  sumMatched: number;
  sumPredicted: number;
  sumTruth: number;
  /** FULL-PRECISION macro means (equal anchor weighting) — the §7 rule inputs.
   * Unrounded doubles; presentation fields below are the rounded views. */
  macroPrecisionFull: number;
  macroRecallFull: number;
  /** W11/W12 rounding convention (round4 per anchor, then round4 mean) — the
   * §6 sanity-anchor comparands. */
  meanPrecision: number;
  meanRecall: number;
  minPrecision: number;
  minRecall: number;
  perfectPrecisionShare: number;
  perfectRecallShare: number;
  /** mean |predicted| / traversal-node-universe size (AMENDMENT-1(2)). */
  coneSizeShare: number;
  /** AMENDMENT-1(3): share of anchors with |slice(K−2)| == |slice(∞)|;
   * 0 for K<2; null for the ∞ cell (not applicable). */
  washSaturationShare: number | null;
};

type DirectionFragment = {
  direction: TerraformFocusDirection;
  truthBuilder: string;
  maxObservedFiniteDistance: number;
  /** Count of (anchor, node) pairs at each finite nodeDistance, aggregated
   * over anchors (tier 0 = the anchors themselves). */
  distanceHistogram: Record<string, number>;
  cells: Record<string, SweepCell>;
};

type PresetFragment = {
  preset: string;
  options: Record<string, unknown>;
  buildMs: number;
  elementCount: number;
  rcllV2Degraded: unknown;
  strataStructural: unknown;
  anchorsRequested: number;
  anchorsMappable: number;
  unmappableAnchors: string[];
  traversalNodeUniverseSize: number;
  /** Grid upper bound: max finite distance across the three directions. */
  gridMaxK: number;
  directions: Record<TerraformFocusDirection, DirectionFragment>;
};

/** Full-precision macros per (direction, K) retained for the §7 rule —
 * "inf" keyed as Infinity. */
type RuleInputs = Map<
  TerraformFocusDirection,
  Map<number, { precision: number; recall: number; coneShare: number }>
>;

function buildPresetFragment(
  preset: string,
  arm: ArmData,
  softFailures: string[],
  reportFindings: string[],
  context: string,
): { fragment: PresetFragment; ruleInputs: RuleInputs } {
  const elements = arm.elements;
  const tfdArrows = tfdArrowsOf(elements);
  const transposed: TfdArrow[] = tfdArrows.map(({ source, target }) => ({
    source: target,
    target: source,
  }));
  // Anchors: the W11 tracing-cell construction rule — the cone-metrics anchor
  // population, unchanged (record §2).
  const anchors = arm.cones.rows.map((r) => r.anchor);
  const coneNodesByAnchor = new Map(
    arm.cones.rows.map((r) => [r.anchor, r.coneNodes]),
  );
  const mappableSet = elementGraphAddresses(elements);
  const mappable: string[] = [];
  const unmappable: string[] = [];
  for (const anchor of anchors) {
    (mappableSet.has(anchor) ? mappable : unmappable).push(anchor);
  }
  const universe = traversalNodeUniverse(elements, anchors);

  // ONE uncapped traversal per (direction, anchor) — every K cell is a
  // threshold of the same map (record §3; per-K BFS would be a defect).
  const distanceByDirection = new Map<
    TerraformFocusDirection,
    Map<string, ReadonlyMap<string, number>>
  >();
  for (const direction of DIRECTIONS) {
    const perAnchor = new Map<string, ReadonlyMap<string, number>>();
    for (const anchor of mappable) {
      perAnchor.set(
        anchor,
        getTerraformRelationshipFocus(elements, anchor, undefined, {
          direction,
          maxHops: Infinity,
        }).nodeDistance,
      );
    }
    distanceByDirection.set(direction, perAnchor);
  }

  // Truth sets (record §4). Forward truth cross-checked vs the exported
  // computeStrataConeMetrics rows[].coneNodes (hard via softFailures).
  const forwardTruth = new Map<string, Set<string>>();
  const reverseTruth = new Map<string, Set<string>>();
  for (const anchor of mappable) {
    const fwd = trueReachFrom(tfdArrows, anchor);
    forwardTruth.set(anchor, fwd);
    reverseTruth.set(anchor, trueReachFrom(transposed, anchor));
    const expected = coneNodesByAnchor.get(anchor);
    if (expected !== undefined && fwd.size !== expected) {
      softFailures.push(
        `${context}: forward truth for ${anchor} (${fwd.size}) != ` +
          `computeStrataConeMetrics coneNodes (${expected})`,
      );
    }
  }

  // Grid upper bound: max finite distance per direction, max across directions.
  const maxFiniteByDirection = new Map<TerraformFocusDirection, number>();
  for (const direction of DIRECTIONS) {
    let maxFinite = 0;
    for (const dist of distanceByDirection.get(direction)!.values()) {
      for (const d of dist.values()) {
        if (Number.isFinite(d) && d > maxFinite) {
          maxFinite = d;
        }
      }
    }
    maxFiniteByDirection.set(direction, maxFinite);
  }
  const gridMaxK = Math.max(...DIRECTIONS.map((d) => maxFiniteByDirection.get(d)!));

  const directions = {} as Record<TerraformFocusDirection, DirectionFragment>;
  const ruleInputs: RuleInputs = new Map();

  for (const direction of DIRECTIONS) {
    const perAnchorDist = distanceByDirection.get(direction)!;
    const truthOf = (anchor: string): Set<string> =>
      direction === "dependents"
        ? reverseTruth.get(anchor)!
        : forwardTruth.get(anchor)!;

    // Distance histogram (reported alongside; tier 0 = anchors themselves).
    const histogram: Record<string, number> = {};
    for (const dist of perAnchorDist.values()) {
      for (const d of dist.values()) {
        const key = String(d);
        histogram[key] = (histogram[key] ?? 0) + 1;
      }
    }

    // Per-anchor slice sizes by K (nesting is by construction; sizes feed the
    // wash-saturation share and the monotonicity health check).
    const sliceSizeOf = (
      dist: ReadonlyMap<string, number>,
      k: number,
    ): number => {
      let n = 0;
      for (const d of dist.values()) {
        if (d <= k) {
          n += 1;
        }
      }
      return n;
    };

    const cells: Record<string, SweepCell> = {};
    const ruleByK = new Map<
      number,
      { precision: number; recall: number; coneShare: number }
    >();

    const kValues: Array<number | "inf"> = [
      ...Array.from({ length: gridMaxK + 1 }, (_, i) => i),
      "inf" as const,
    ];
    let prevRecallFull = -1;
    for (const k of kValues) {
      const kNum = k === "inf" ? Infinity : k;
      const precisionsFull: number[] = [];
      const recallsFull: number[] = [];
      const precisions4: number[] = [];
      const recalls4: number[] = [];
      let sumMatched = 0;
      let sumPredicted = 0;
      let sumTruth = 0;
      let predictedTotal = 0;
      let saturated = 0;
      for (const anchor of mappable) {
        const dist = perAnchorDist.get(anchor)!;
        const truth = truthOf(anchor);
        let predicted = 0;
        let matched = 0;
        for (const [node, d] of dist) {
          if (d <= kNum) {
            predicted += 1;
            if (truth.has(node)) {
              matched += 1;
            }
          }
        }
        sumMatched += matched;
        sumPredicted += predicted;
        sumTruth += truth.size;
        predictedTotal += predicted;
        const p = predicted > 0 ? matched / predicted : 0;
        const r = truth.size > 0 ? matched / truth.size : 0;
        precisionsFull.push(p);
        recallsFull.push(r);
        precisions4.push(round4(p));
        recalls4.push(round4(r));
        if (
          k !== "inf" &&
          k >= 2 &&
          sliceSizeOf(dist, k - 2) === dist.size
        ) {
          saturated += 1;
        }
      }
      const macroPrecisionFull = mean(precisionsFull);
      const macroRecallFull = mean(recallsFull);
      // Internal-consistency health (record §8): recall monotone
      // non-decreasing in K (nesting holds by construction of thresholding).
      // Monotonicity violations are REPORT-only findings (record §8:
      // INCONCLUSIVE, "reported as a harness finding, not adjudicated away")
      // — never a hard failure (task hard-assert list).
      let status: SweepCell["status"] = "SUPPORT";
      if (k !== "inf" && macroRecallFull < prevRecallFull - 1e-12) {
        status = "INCONCLUSIVE";
        reportFindingNote(
          reportFindings,
          `${context}/${direction}: macro recall NOT monotone at K=${k} ` +
            `(${macroRecallFull} < ${prevRecallFull}) — nodeDistance map defect?`,
        );
      }
      if (k !== "inf") {
        prevRecallFull = Math.max(prevRecallFull, macroRecallFull);
      }
      const coneShare =
        universe.size > 0 ? predictedTotal / mappable.length / universe.size : 0;
      const cell: SweepCell = {
        k,
        status,
        anchors: mappable.length,
        sumMatched,
        sumPredicted,
        sumTruth,
        macroPrecisionFull,
        macroRecallFull,
        meanPrecision: round4(mean(precisions4)),
        meanRecall: round4(mean(recalls4)),
        minPrecision: round4(Math.min(...precisions4, 1)),
        minRecall: round4(Math.min(...recalls4, 1)),
        perfectPrecisionShare: round4(
          precisions4.length > 0
            ? precisions4.filter((p) => p === 1).length / precisions4.length
            : 0,
        ),
        perfectRecallShare: round4(
          recalls4.length > 0
            ? recalls4.filter((r) => r === 1).length / recalls4.length
            : 0,
        ),
        coneSizeShare: round4(coneShare),
        washSaturationShare:
          k === "inf"
            ? null
            : k < 2
            ? 0
            : round4(mappable.length > 0 ? saturated / mappable.length : 0),
      };
      cells[k === "inf" ? "inf" : `K${k}`] = cell;
      ruleByK.set(kNum, {
        precision: macroPrecisionFull,
        recall: macroRecallFull,
        coneShare,
      });
    }

    directions[direction] = {
      direction,
      truthBuilder:
        direction === "dependencies"
          ? "forward closure (trueReachFrom; computeStrataConeMetrics convention)"
          : direction === "dependents"
          ? "REVERSE closure (trueReachFrom on the transposed arrow set)"
          : "judged vs FORWARD closure (deliberate asymmetry — W11 task-mismatch cell across the K axis)",
      maxObservedFiniteDistance: maxFiniteByDirection.get(direction)!,
      distanceHistogram: histogram,
      cells,
    };
    ruleInputs.set(direction, ruleByK);
  }

  return {
    fragment: {
      preset,
      options: ARM_I_OPTIONS,
      buildMs: arm.buildMs,
      elementCount: arm.elementCount,
      rcllV2Degraded: arm.rcllV2Degraded ?? null,
      strataStructural: arm.strataStructural,
      anchorsRequested: anchors.length,
      anchorsMappable: mappable.length,
      unmappableAnchors: unmappable,
      traversalNodeUniverseSize: universe.size,
      gridMaxK,
      directions,
    },
    ruleInputs,
  };
}

/** Dedup helper so a finding repeated across determinism passes doesn't double. */
function reportFindingNote(findings: string[], msg: string): void {
  if (!findings.includes(msg)) {
    findings.push(msg);
  }
}

// ── §6 sanity anchors (hard-asserted BEFORE P3 is built or the §7 rule read) ─

const SANITY_ANCHORS: Record<
  "P1" | "P2",
  {
    anchorsRequested: number;
    both3MeanPrecision: number;
    both3MeanRecall: number;
  }
> = {
  P1: { anchorsRequested: 50, both3MeanPrecision: 0.4641, both3MeanRecall: 0.6824 },
  P2: { anchorsRequested: 36, both3MeanPrecision: 0.4832, both3MeanRecall: 0.7389 },
};

function checkSanityAnchors(
  presetLabel: "P1" | "P2",
  fragment: PresetFragment,
  anchorFailures: string[],
): void {
  const preset = PRESETS[presetLabel];
  const pin = SANITY_ANCHORS[presetLabel];
  const fail = (msg: string) =>
    anchorFailures.push(`${preset}: SANITY ANCHOR FAILED — ${msg}`);

  // Anchor populations: requested == mappable, zero unmappable (record §6).
  if (fragment.anchorsRequested !== pin.anchorsRequested) {
    fail(
      `anchorsRequested ${fragment.anchorsRequested} != ${pin.anchorsRequested}`,
    );
  }
  if (fragment.anchorsMappable !== pin.anchorsRequested) {
    fail(
      `anchorsMappable ${fragment.anchorsMappable} != ${pin.anchorsRequested}`,
    );
  }
  if (fragment.unmappableAnchors.length !== 0) {
    fail(
      `unmappableAnchors not empty: ${JSON.stringify(
        fragment.unmappableAnchors,
      )}`,
    );
  }
  // (both, K=3) must equal the committed W12 shipped-3hop mismatch cell.
  const both3 = fragment.directions.both.cells.K3;
  if (!both3) {
    fail("grid has no (both, K=3) cell");
  } else {
    if (both3.meanPrecision !== pin.both3MeanPrecision) {
      fail(
        `(both,K=3) meanPrecision ${both3.meanPrecision} != ${pin.both3MeanPrecision}`,
      );
    }
    if (both3.meanRecall !== pin.both3MeanRecall) {
      fail(
        `(both,K=3) meanRecall ${both3.meanRecall} != ${pin.both3MeanRecall}`,
      );
    }
  }
  // (dependencies, ∞) must equal the directed production call: per-anchor
  // minima 1/1 (hence mean 1/1, perfect shares 1).
  const depsInf = fragment.directions.dependencies.cells.inf;
  if (!depsInf) {
    fail("grid has no (dependencies, ∞) cell");
  } else if (
    depsInf.minPrecision !== 1 ||
    depsInf.minRecall !== 1 ||
    depsInf.meanPrecision !== 1 ||
    depsInf.meanRecall !== 1 ||
    depsInf.perfectPrecisionShare !== 1 ||
    depsInf.perfectRecallShare !== 1
  ) {
    fail(
      `(dependencies,∞) not 1/1 on every anchor: ${JSON.stringify({
        minPrecision: depsInf.minPrecision,
        minRecall: depsInf.minRecall,
        meanPrecision: depsInf.meanPrecision,
        meanRecall: depsInf.meanRecall,
      })}`,
    );
  }
}

// ── §7 frozen recommendation rule (mechanical; P1/P2 only) ───────────────────

function computeRecommendation(
  ruleInputsByPreset: ReadonlyMap<"P1" | "P2", RuleInputs>,
  gridMaxKByPreset: ReadonlyMap<"P1" | "P2", number>,
): Record<string, unknown> {
  const perDirection: Record<string, unknown> = {};
  const unionMaxK = Math.max(
    ...SELECTION_PRESETS.map((p) => gridMaxKByPreset.get(p)!),
  );
  for (const direction of DIRECTIONS) {
    const evaluations: Array<Record<string, unknown>> = [];
    let recommendedK: number | null = null;
    for (let k = 0; k <= unionMaxK; k++) {
      const per: Record<string, unknown> = {};
      let qualifies = true;
      for (const presetLabel of SELECTION_PRESETS) {
        // A K beyond a preset's own grid max equals its uncapped cell.
        const inputs = ruleInputsByPreset.get(presetLabel)!.get(direction)!;
        const eff =
          inputs.get(k) ?? inputs.get(Infinity)!; // beyond-grid ⇒ ∞ values
        const ok =
          eff.precision >= RULE_PRECISION_MIN && eff.recall >= RULE_RECALL_MIN;
        per[presetLabel] = {
          macroPrecisionFull: eff.precision,
          macroRecallFull: eff.recall,
          qualifies: ok,
        };
        if (!ok) {
          qualifies = false;
        }
      }
      evaluations.push({ k, ...per, qualifiesBothPresets: qualifies });
      if (qualifies && recommendedK === null) {
        recommendedK = k;
      }
    }
    perDirection[direction] = {
      recommendedK: recommendedK ?? CURRENT_DEFAULT_K,
      qualified: recommendedK !== null,
      note:
        recommendedK !== null
          ? `smallest K with full-precision macro precision >= ${RULE_PRECISION_MIN} AND ` +
            `macro recall >= ${RULE_RECALL_MIN} on BOTH P1 and P2 (record §7)`
          : `NO K qualifies — keep current default ${CURRENT_DEFAULT_K} (record §7); ` +
            "the failure to qualify is itself the reported finding",
      tieBreak:
        "not applicable — the smallest qualifying K is unique by construction " +
        "(cone-size share reported per cell for the owner)",
      evaluations,
    };
  }
  return {
    rule:
      `per direction: smallest K with macro precision >= ${RULE_PRECISION_MIN} AND macro ` +
      `recall >= ${RULE_RECALL_MIN} on BOTH P1 AND P2 (full-precision raw-count macros, ` +
      `record §5/§7); none => keep ${CURRENT_DEFAULT_K}; P3 confirmatory-only, never selects`,
    selectionPresets: SELECTION_PRESETS.map((p) => PRESETS[p]),
    perDirection,
  };
}

// ── determinism normalization ────────────────────────────────────────────────

const TIMING_KEYS = new Set(["buildMs"]);

function stripTimings(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripTimings);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (TIMING_KEYS.has(k)) {
        continue;
      }
      out[k] = stripTimings(v);
    }
    return out;
  }
  return value;
}

// ── harness ──────────────────────────────────────────────────────────────────

describe("W13 hop-sweep battery (report-emitting; REPORT-only cells; never asserts metrics)", () => {
  it(
    "P1 + P2 (selection) + P3 (confirmatory) — arm I × {both,dependencies,dependents} × K grid",
    async () => {
      const softFailures: string[] = [];
      /** REPORT-only findings (e.g. §8 monotonicity ⇒ INCONCLUSIVE) — written
       * into the report, never hard-asserted. */
      const reportFindings: string[] = [];
      const report: Record<string, unknown> = {
        meta: {
          reportOnly: true,
          seed: BOOTSTRAP_SEED,
          presets: PRESETS,
          arm: { I: ARM_I_OPTIONS },
          preRegistration:
            "docs/strata-view-w13-hop-sweep.md (commit 0519453b5 + AMENDMENT-1) — committed BEFORE " +
            "this battery produced any statistic; the §7 output below is its mechanical application",
          evidenceClass:
            "population-match evidence ONLY (api-seam-validation family) — NOT task evidence; " +
            "every number inherits the W11 caveat verbatim",
          interpretationNote:
            "interpretation is BLOCKED-ON-Q7 (open W11 exit criterion); any default flip " +
            "(hop depth or direction) is an owner decision, minted nowhere here",
          sliceDerivation:
            "ONE uncapped getTerraformRelationshipFocus call per (preset, direction, anchor); " +
            "every K cell thresholds that single traversal's nodeDistance map (<= K) — record §3",
          truthBuilders:
            "dependencies=forward closure; dependents=REVERSE closure (transposed arrows); " +
            "both=judged vs FORWARD closure (deliberate task-mismatch asymmetry) — record §4",
          estimatorNote:
            "anchor self-included in predicted AND truth; equal anchor weighting; raw integer " +
            "counts aggregated; macroPrecisionFull/macroRecallFull are UNROUNDED (the §7 rule " +
            "inputs); meanPrecision/meanRecall mirror the W11/W12 round4 convention for the §6 " +
            "sanity-anchor comparability — record §5",
          coneSizeShareDenominator:
            "traversal node universe: distinct graph addresses appearing as an endpoint of any " +
            "focus-traversal edge (relationship endpoints + directions[] hints on layer edges) " +
            "∪ the anchor set — AMENDMENT-1(2)",
          washSaturationDefinition:
            "share of mappable anchors whose (K−2)-slice already equals their full uncapped " +
            "reach for the direction (saturated >= 2 tiers by K); 0 for K<2; null at ∞ — " +
            "AMENDMENT-1(3); REPORT-only, never selects",
          determinismNote:
            "each preset's full fragment is built twice (2 scene builds + 2 sweep computations) " +
            `and deep-equaled after stripping wall-clock keys (${[...TIMING_KEYS].join(", ")}); ` +
            "additionally FOCUS_HOP_SWEEP.normalized.json is the external run-twice byte comparand",
          registersNote:
            "REPORT-only: no gateRegister.json interaction, no V32 manifest pin, no frozen row",
        },
      };

      const fragmentsByPreset = new Map<PresetLabel, PresetFragment>();
      const ruleInputsByPreset = new Map<"P1" | "P2", RuleInputs>();
      const gridMaxKByPreset = new Map<"P1" | "P2", number>();

      const processPreset = async (
        presetLabel: PresetLabel,
      ): Promise<void> => {
        const preset = PRESETS[presetLabel];
        const raw = getTerraformImportPresetSourcesFromDb(preset);
        expect(raw, `preset ${preset} exists`).toBeTruthy();
        const sources = resolveSourcesWithTfdComposition(
          raw! as TerraformImportPresetSources,
        );

        const buildFragment = async (
          pass: string,
          failures: string[],
        ): Promise<ReturnType<typeof buildPresetFragment>> => {
          const arm = await buildArmI(sources);
          const context = `${preset}/${pass}`;
          if (arm.elements.length === 0) {
            failures.push(`${context}: scene EMPTY`);
          }
          if (arm.cones.sampled === 0) {
            failures.push(`${context}: cone anchor population EMPTY`);
          }
          if (arm.rcllV2Degraded !== undefined && arm.rcllV2Degraded !== false) {
            failures.push(
              `${context}: rcllV2Degraded=${JSON.stringify(arm.rcllV2Degraded)}`,
            );
          }
          const st = arm.strataStructural as {
            nonAncestorOverlaps?: number;
            titleCollisions?: number;
            contiguityViolations?: number;
          } | null;
          if (
            st &&
            ((st.nonAncestorOverlaps ?? 0) > 0 ||
              (st.titleCollisions ?? 0) > 0 ||
              (st.contiguityViolations ?? 0) > 0)
          ) {
            failures.push(
              `${context}: R2 structural nonzero ${JSON.stringify(st)}`,
            );
          }
          return buildPresetFragment(
            preset,
            arm,
            failures,
            reportFindings,
            context,
          );
        };

        const passA = await buildFragment("passA", softFailures);
        // Run-twice determinism (record §8): rebuild the scene, recompute the
        // FULL fragment, deep-equal after stripping wall-clock keys.
        const passBFailures: string[] = [];
        const passB = await buildFragment("passB", passBFailures);
        softFailures.push(...passBFailures);
        const normA = JSON.stringify(stripTimings(passA.fragment));
        const normB = JSON.stringify(stripTimings(passB.fragment));
        const deterministic = normA === normB;
        if (!deterministic) {
          softFailures.push(
            `${preset}: run-twice fragment NOT deterministic (normalized sans timings)`,
          );
        }

        // Zero-unmappable is a HARD precondition on the selection presets
        // (record §5); on P3 a nonzero count is reported + flagged and voids
        // affected cells (stamped below).
        if (
          presetLabel !== "P3" &&
          passA.fragment.unmappableAnchors.length > 0
        ) {
          softFailures.push(
            `${preset}: unmappable anchors on a SELECTION preset: ${JSON.stringify(
              passA.fragment.unmappableAnchors,
            )}`,
          );
        }
        if (
          presetLabel === "P3" &&
          passA.fragment.unmappableAnchors.length > 0
        ) {
          for (const dir of DIRECTIONS) {
            for (const cell of Object.values(
              passA.fragment.directions[dir].cells,
            )) {
              cell.status = "VOID";
            }
          }
        }

        fragmentsByPreset.set(presetLabel, passA.fragment);
        if (presetLabel !== "P3") {
          ruleInputsByPreset.set(presetLabel, passA.ruleInputs);
          gridMaxKByPreset.set(presetLabel, passA.fragment.gridMaxK);
        }
        report[presetLabel] = {
          ...passA.fragment,
          ...(presetLabel === "P3"
            ? {
                confirmatoryOnly:
                  "P3 cells are reported alongside and CANNOT select or veto the §7 " +
                  "recommendation (record §1); self-authored out-of-tuning-distribution " +
                  "material — W12 claim scoping, R8-F4 stays open",
                ...(passA.fragment.unmappableAnchors.length > 0
                  ? {
                      unmappableFlag:
                        "nonzero unmappable anchors on P3 — reported + flagged; affected " +
                        "cells stamped VOID (record §5)",
                    }
                  : {}),
              }
            : {}),
          determinism: {
            passes: 2,
            strippedKeys: [...TIMING_KEYS],
            deterministic,
          },
        };
      };

      // Selection presets FIRST; sanity anchors asserted BEFORE P3 is built
      // and BEFORE the §7 rule output is computed/read (record §6 ordering —
      // the W12 F3 discipline).
      for (const presetLabel of SELECTION_PRESETS) {
        await processPreset(presetLabel);
      }

      const anchorFailures: string[] = [];
      for (const presetLabel of SELECTION_PRESETS) {
        checkSanityAnchors(
          presetLabel,
          fragmentsByPreset.get(presetLabel)!,
          anchorFailures,
        );
      }
      report.sanityAnchor = {
        source:
          "docs/strata-baselines/q12/W12_HELDOUT_SCALE_BATTERY.normalized.json tracing cells " +
          "(record §6): (both,K=3) == shipped 3-hop mismatch cell; (dependencies,∞) == directed " +
          "production call; anchor populations exact",
        pins: SANITY_ANCHORS,
        green: anchorFailures.length === 0,
      };
      expect(
        anchorFailures,
        `SANITY ANCHOR failures (P3 NOT built, rule NOT read):\n${anchorFailures.join(
          "\n",
        )}`,
      ).toEqual([]);

      // P3 — confirmatory-only, built only under a green anchor. A P3
      // load/layout throw is stamped and the report still written (record §8
      // VOID clause / the W12 F2 discipline).
      try {
        await processPreset("P3");
      } catch (err) {
        report.P3 = {
          preset: PRESETS.P3,
          status: "VOID",
          error: String(err instanceof Error ? err.message : err),
          note:
            "P3 load/layout THROW — confirmatory cells not computable; stamped per the " +
            "pre-registered VOID clause (record §8), never patched/retuned; the report " +
            "is still written (P3 cannot veto the P1/P2 selection)",
        };
      }

      // §7 rule — mechanical, computed from P1/P2 full-precision macros ONLY,
      // after the anchors are green.
      report.recommendation = computeRecommendation(
        ruleInputsByPreset,
        gridMaxKByPreset,
      );

      // ── write report (+ normalized comparand) ─────────────────────────────
      const json = JSON.stringify(
        { ...report, reportFindings, softFailures },
        null,
        2,
      );
      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(`${REPORT_DIR}/FOCUS_HOP_SWEEP.json`, json);
      writeFileSync(
        `${REPORT_DIR}/FOCUS_HOP_SWEEP.normalized.json`,
        JSON.stringify(stripTimings(JSON.parse(json)), null, 2),
      );
      // eslint-disable-next-line no-console -- probe output IS the deliverable
      console.log(
        `FOCUS_HOP_SWEEP.json written to ${REPORT_DIR} (${json.length} bytes)`,
      );

      expect(
        softFailures,
        `harness health failures:\n${softFailures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );
});
