/* eslint-disable max-lines */
/**
 * W11 task-tracing battery (WP3 of the W11 task-evidence vertical slice;
 * plan decisions 9, 10, 11, 12). Report-emitting, W6/W10b-style: this file
 * owns NO layout behavior, changes NO product geometry, and NEVER asserts
 * metric values — hard asserts exist ONLY for harness health (report written,
 * presets exist, scenes/paths non-empty, run-twice determinism, R2 structural
 * zeros on strata arms, meta consistency between the local reachability and
 * computeStrataConeMetrics).
 *
 * Scene arms (3 real builds × P1/P2; seed 20260704 inside shared helpers):
 *   A_v2  — pipeline v2 compact baseline
 *   I     — strata K=4 sweeps + coordRefine (v3.2 default)
 *   I_RS  — I + strataRankSeparate (NEUTRAL naming: rankSeparate is a
 *           height/angle-vs-tracing trade per v3.2 — never "optimized")
 *
 * Focus arms (A_v2+F, I+F, I_RS+F) are NOT separate scene builds. Focus is a
 * RUNTIME behavior (`getTerraformRelationshipFocus` /
 * `applyTerraformRelationshipFocus`); the scenes are byte-identical with or
 * without it. The report therefore nests focus cells UNDER each scene arm so
 * nothing implies focus changes layout.
 *
 * Cells per scene arm × preset:
 *   1. Path metrics (computeStrataPathMetrics summary; rt̂ p50/p90) +
 *      pairedPathMetricsCi strata-vs-v2 (path-key paired).
 *   2. α-sweep [0,.25,.5,.75,1] via rtHatAttenuated — labeled
 *      "sensitivityAnalysis": true (α is an ASSUMED substitution model, not a
 *      measurement); W6-comparable crossover + symmetric cells.
 *   3. Production-call validation (decision 9): the REAL
 *      getTerraformRelationshipFocus(elements, anchor, undefined,
 *      { direction:"dependencies", maxHops: Infinity }) on the full unfiltered
 *      element array vs true declared-dependency reachability
 *      (computeStrataConeMetrics convention), precision/recall per anchor +
 *      aggregate, mismatch breakdown by edge layer + hint source. No test-only
 *      filtering — any population mismatch is REPORTED, never hidden.
 *   4. Task-mismatch cell: the OLD shipped behavior ({ direction:"both" },
 *      default 3 hops) vs the same true reachability (expected recall<1 from
 *      the hop cap, precision<1 from undirected pollution), same breakdown.
 *   5. Runtime-apply cell (decision 10): applyTerraformRelationshipFocus on
 *      ≤25 seeded anchors — dim/reveal tier counts, reveal-≤1-hop invariant,
 *      wall-clock per apply (report only).
 *   6. coneCrossings (computeStrataConeMetrics) + "branchLoad"
 *      (Σ max(0,degree−2), layout-invariant — NOT a wrong-branch/reader-error
 *      measure).
 *   7. Direction-consistency proxy: share of measured-path edges drawn
 *      source-left-of-target (LOCAL helper — see the TODO(W11-WP4) note).
 *   8. Structure zeros on strata arms, buildMs, run-twice determinism.
 *
 * Run:
 *   Q11_REPORT_DIR=/tmp yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataTaskTracingBattery.test.ts \
 *     --exclude "**\/.claude/**"
 * Writes W11_TASK_TRACING_BATTERY.json to $Q11_REPORT_DIR (default tmpdir).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import {
  BOOTSTRAP_SEED,
  canonicalEdgeKey,
  mulberry32,
  pairedBootstrapCi,
  statisticGateEligible,
  type BootstrapCiResult,
  type BootstrapStatistic,
} from "./terraformPipelineBootstrapCi";
import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { sourceLeftOfTarget } from "./terraformPipelineStrataQ7AxisScore";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import { isTerraformLayerEdge } from "./terraformElementMetadata";
import {
  applyTerraformRelationshipFocus,
  getTerraformRelationshipFocus,
} from "./terraformRelationshipFocus";
import {
  computeStrataConeMetrics,
  computeStrataPathMetrics,
  pairedPathMetricsCi,
  rtHatAttenuated,
  type PathMetricsRow,
  type StrataConeMetrics,
  type StrataPathMetrics,
} from "./terraformPipelineStrataPathMetrics";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const PRESET_1 = "staging-extended-localstack-v2";
const PRESET_2 = "staging-localstack";
const REPORT_DIR = process.env.Q11_REPORT_DIR ?? tmpdir();
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 60;

const ALPHAS = [0, 0.25, 0.5, 0.75, 1] as const;
/** Runtime-apply anchor cap per preset (decision 10; seeded subsample). */
const RUNTIME_APPLY_ANCHOR_MAX = 25;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ── arms — 3 SCENE builds; focus arms are runtime cells, not builds ──────────

const BASE_STRATA: Record<string, unknown> = {
  layoutMode: "strata",
  pipelineCompact: true,
  strataSweeps: 4,
  strataCoordinateRefine: true,
};

const ARM_OPTIONS: Record<string, Record<string, unknown>> = {
  A_v2: {
    layoutMode: "pipeline",
    pipelineLayoutVariant: "v2",
    pipelineCompact: true,
  },
  I: { ...BASE_STRATA },
  // Neutral naming (decision 11): rankSeparate is a height/angle-vs-tracing
  // trade per v3.2 — never "optimized".
  I_RS: { ...BASE_STRATA, strataRankSeparate: true },
};

const ARM_LABELS = Object.keys(ARM_OPTIONS);
const STRATA_ARMS = new Set(["I", "I_RS"]);

// ── scene readers (local, mirroring the path-metrics conventions) ────────────

const customDataOf = (el: ExcalidrawElement): Record<string, unknown> =>
  (el.customData as Record<string, unknown> | undefined) ?? {};

const relOf = (el: ExcalidrawElement): Record<string, unknown> | null => {
  const r = customDataOf(el).relationship;
  return r && typeof r === "object" ? (r as Record<string, unknown>) : null;
};

type TfdArrow = { source: string; target: string; layer: string };

/**
 * Same population as computeStrataPathMetrics/computeStrataConeMetrics:
 * engine-emitted non-aggregated relationship arrows (deliberately NOT filtered
 * on isDeleted — TFD arrows are emitted soft-deleted).
 */
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
    const layer = customDataOf(el).terraformEdgeLayer;
    out.push({
      source: r.source,
      target: r.target,
      layer: typeof layer === "string" ? layer : "none",
    });
  }
  return out;
}

/**
 * True declared-dependency reachability from `anchor` over the tfd-arrow
 * digraph — the exact convention computeStrataConeMetrics uses (self-loops
 * skipped, parallel arrows collapsed, relationship.source→target =
 * "dependencies" direction). Cross-checked against row.coneNodes below.
 */
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

/** Focus-population edge annotated with its layer + hint source — the two
 * axes of the decision-9 mismatch breakdown. */
type AnnotatedFocusEdge = {
  from: string;
  to: string;
  layer: string;
  hintSource: "relationship" | "directions";
};

/** Every directed (source→target) link the focus traversal would build, with
 * provenance — mirrors getTerraformRelationshipFocus's adjacency population
 * (isTerraformLayerEdge elements; relationship endpoints + directions[] hints). */
function focusAnnotatedEdges(
  elements: readonly ExcalidrawElement[],
): AnnotatedFocusEdge[] {
  const edges: AnnotatedFocusEdge[] = [];
  for (const el of elements) {
    if (!isTerraformLayerEdge(el)) {
      continue;
    }
    const layerRaw = customDataOf(el).terraformEdgeLayer;
    const layer = typeof layerRaw === "string" ? layerRaw : "none";
    const r = relOf(el);
    if (typeof r?.source === "string" && typeof r?.target === "string") {
      edges.push({
        from: r.source,
        to: r.target,
        layer,
        hintSource: "relationship",
      });
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
          edges.push({
            from: hint.source,
            to: hint.target,
            layer,
            hintSource: "directions",
          });
        }
      }
    }
  }
  return edges;
}

/** Graph addresses of all elements (nodePath, else terraformVisibilityKey) —
 * the focusNodePath identity space. Cone anchors key by relationship address;
 * an anchor absent here is UNMAPPABLE to a hoverable element and is reported
 * honestly (decision 9). */
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

/** Deterministic seeded subsample (partial Fisher–Yates over indices, then
 * re-sorted ascending) — same convention as the path-metrics sampler. */
function seededSample<T>(sorted: readonly T[], max: number, seed: number): T[] {
  if (sorted.length <= max) {
    return [...sorted];
  }
  const idx = sorted.map((_, i) => i);
  const rng = mulberry32(seed);
  for (let i = 0; i < max; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    const t = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = t;
  }
  return idx
    .slice(0, max)
    .sort((a, b) => a - b)
    .map((i) => sorted[i]!);
}

function percentile<T>(
  rows: readonly T[],
  pick: (r: T) => number,
  q: number,
): number {
  if (rows.length === 0) {
    return 0;
  }
  const vals = rows.map(pick).sort((a, b) => a - b);
  return vals[Math.min(vals.length - 1, Math.floor(vals.length * q))]!;
}

const mean = (vals: readonly number[]): number =>
  vals.length === 0 ? 0 : vals.reduce((s, v) => s + v, 0) / vals.length;

// ── direction-consistency proxy (cell 7) ─────────────────────────────────────
// Uses the shared source-left-of-target proxy from the Q7-AXIS scorer module
// (single implementation, W11 plan decision 13); ties use its 0.5px band.

type DirectionConsistency = {
  note: string;
  distinctMeasuredPathEdges: number;
  resolvedEdges: number;
  unresolvedCenterEdges: number;
  sourceLeftCount: number;
  tieCount: number;
  /** sourceLeftCount / resolvedEdges (ties excluded from the numerator). */
  sourceLeftShare: number;
};

function directionConsistencyProxy(
  elements: readonly ExcalidrawElement[],
  pathRows: readonly PathMetricsRow[],
): DirectionConsistency {
  const centerX = new Map<string, number>();
  for (const el of elements) {
    if (el.type !== "frame" || el.isDeleted) {
      continue;
    }
    const cd = customDataOf(el);
    if (cd.terraformTopologyRole !== "primaryCluster") {
      continue;
    }
    const addr = cd.terraformPrimaryAddress;
    if (typeof addr === "string" && !centerX.has(addr)) {
      centerX.set(addr, el.x + el.width / 2);
    }
  }
  const seen = new Set<string>();
  const edges: Array<{ source: string; target: string }> = [];
  for (const row of pathRows) {
    for (let i = 0; i + 1 < row.addresses.length; i++) {
      const source = row.addresses[i]!;
      const target = row.addresses[i + 1]!;
      const key = canonicalEdgeKey(source, target, "measuredPathEdge");
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      edges.push({ source, target });
    }
  }
  let resolvedEdges = 0;
  let unresolvedCenterEdges = 0;
  let sourceLeftCount = 0;
  let tieCount = 0;
  for (const { source, target } of edges) {
    const sx = centerX.get(source);
    const tx = centerX.get(target);
    if (sx === undefined || tx === undefined) {
      unresolvedCenterEdges += 1;
      continue;
    }
    resolvedEdges += 1;
    const left = sourceLeftOfTarget(sx, tx);
    if (left === true) {
      sourceLeftCount += 1;
    } else if (left === null) {
      tieCount += 1;
    }
  }
  return {
    note:
      "share of measured-path edges drawn source-left-of-target " +
      "(relationship.source→target = declared dependency; whether the axis " +
      "READS as flow is owned by Q7-AXIS — no flow claim here)",
    distinctMeasuredPathEdges: edges.length,
    resolvedEdges,
    unresolvedCenterEdges,
    sourceLeftCount,
    tieCount,
    sourceLeftShare:
      resolvedEdges > 0 ? round4(sourceLeftCount / resolvedEdges) : 0,
  };
}

// ── focus traversal cells (decisions 9 + 10) ─────────────────────────────────

type FocusComparisonRow = {
  anchor: string;
  focusReached: number;
  trueReach: number;
  matched: number;
  precision: number;
  recall: number;
};

type MismatchBreakdown = Record<string, number>;

type FocusComparisonCell = {
  mode: Record<string, unknown>;
  anchorsRequested: number;
  anchorsMappable: number;
  unmappableAnchors: string[];
  perAnchor: FocusComparisonRow[];
  aggregate: {
    meanPrecision: number;
    meanRecall: number;
    minPrecision: number;
    minRecall: number;
    perfectPrecisionShare: number;
    perfectRecallShare: number;
    totalFocusOnlyNodes: number;
    totalConeOnlyNodes: number;
  };
  /** Nodes the FOCUS reached but the true cone did not, tallied by the
   * layer:hintSource provenance of the focus edges that pulled them in. */
  focusOnlyByCause: MismatchBreakdown;
  /** Nodes the true cone reached but the focus did not, tallied by the tfd
   * arrow layer that carries them (plus "hopCap" when the undirected
   * traversal WOULD reach them uncapped — both-mode cell only). */
  coneOnlyByCause: MismatchBreakdown;
  focusOnlyExamples: string[];
  coneOnlyExamples: string[];
};

const EXAMPLE_CAP = 12;

function runFocusComparisonCell(
  elements: readonly ExcalidrawElement[],
  anchors: readonly string[],
  tfdArrows: readonly TfdArrow[],
  annotated: readonly AnnotatedFocusEdge[],
  cones: StrataConeMetrics,
  softFailures: string[],
  context: string,
  variant: "productionDirected" | "shippedBoth",
): FocusComparisonCell {
  const mappableSet = elementGraphAddresses(elements);
  const mappable: string[] = [];
  const unmappable: string[] = [];
  for (const anchor of anchors) {
    (mappableSet.has(anchor) ? mappable : unmappable).push(anchor);
  }

  const coneNodesByAnchor = new Map(
    cones.rows.map((r) => [r.anchor, r.coneNodes]),
  );

  const perAnchor: FocusComparisonRow[] = [];
  const focusOnlyByCause: MismatchBreakdown = {};
  const coneOnlyByCause: MismatchBreakdown = {};
  const focusOnlyExamples: string[] = [];
  const coneOnlyExamples: string[] = [];
  let totalFocusOnly = 0;
  let totalConeOnly = 0;

  const tally = (b: MismatchBreakdown, key: string) => {
    b[key] = (b[key] ?? 0) + 1;
  };

  for (const anchor of mappable) {
    const truth = trueReachFrom(tfdArrows, anchor);
    const expectedConeNodes = coneNodesByAnchor.get(anchor);
    if (expectedConeNodes !== undefined && truth.size !== expectedConeNodes) {
      softFailures.push(
        `${context}: local reachability for ${anchor} (${truth.size}) != ` +
          `computeStrataConeMetrics coneNodes (${expectedConeNodes})`,
      );
    }

    // The PRODUCTION call, on the full unfiltered element array (decision 9)
    // — or the OLD shipped default (task-mismatch cell).
    const focus =
      variant === "productionDirected"
        ? getTerraformRelationshipFocus(elements, anchor, undefined, {
            direction: "dependencies",
            maxHops: Infinity,
          })
        : getTerraformRelationshipFocus(elements, anchor);
    const reached = new Set(focus.nodeDistance.keys());

    let matched = 0;
    for (const node of reached) {
      if (truth.has(node)) {
        matched += 1;
      }
    }
    perAnchor.push({
      anchor,
      focusReached: reached.size,
      trueReach: truth.size,
      matched,
      precision: reached.size > 0 ? round4(matched / reached.size) : 0,
      recall: truth.size > 0 ? round4(matched / truth.size) : 0,
    });

    // Uncapped undirected traversal — used ONLY to attribute both-mode
    // cone-only misses to the hop cap vs the edge population.
    const uncappedBoth =
      variant === "shippedBoth"
        ? new Set(
            getTerraformRelationshipFocus(elements, anchor, undefined, {
              direction: "both",
              maxHops: Infinity,
            }).nodeDistance.keys(),
          )
        : null;

    for (const node of reached) {
      if (truth.has(node)) {
        continue;
      }
      totalFocusOnly += 1;
      if (focusOnlyExamples.length < EXAMPLE_CAP) {
        focusOnlyExamples.push(`${anchor} -> ${node}`);
      }
      // Which focus edges pulled this node in? (layer + hint-source provenance)
      let classified = false;
      for (const e of annotated) {
        const pulledIn =
          variant === "productionDirected"
            ? e.to === node && reached.has(e.from)
            : (e.to === node && reached.has(e.from)) ||
              (e.from === node && reached.has(e.to));
        if (pulledIn) {
          tally(focusOnlyByCause, `${e.layer}:${e.hintSource}`);
          classified = true;
        }
      }
      if (!classified) {
        tally(focusOnlyByCause, "unclassified");
      }
    }

    for (const node of truth) {
      if (reached.has(node)) {
        continue;
      }
      totalConeOnly += 1;
      if (coneOnlyExamples.length < EXAMPLE_CAP) {
        coneOnlyExamples.push(`${anchor} -> ${node}`);
      }
      if (uncappedBoth?.has(node)) {
        tally(coneOnlyByCause, "hopCap");
        continue;
      }
      let classified = false;
      for (const a of tfdArrows) {
        if (a.target === node && truth.has(a.source)) {
          tally(coneOnlyByCause, `${a.layer}:relationship`);
          classified = true;
        }
      }
      if (!classified) {
        tally(coneOnlyByCause, "unclassified");
      }
    }
  }

  const precisions = perAnchor.map((r) => r.precision);
  const recalls = perAnchor.map((r) => r.recall);
  return {
    mode:
      variant === "productionDirected"
        ? {
            call:
              "getTerraformRelationshipFocus(elements, anchor, undefined, " +
              '{ direction: "dependencies", maxHops: Infinity })',
            direction: "dependencies",
            maxHops: "all",
            note: "the REAL production call on the full unfiltered element array (decision 9)",
          }
        : {
            call: "getTerraformRelationshipFocus(elements, anchor)",
            direction: "both",
            maxHops: 3,
            note: "OLD shipped default — expected recall<1 (hop cap) and precision<1 (undirected pollution)",
          },
    anchorsRequested: anchors.length,
    anchorsMappable: mappable.length,
    unmappableAnchors: unmappable,
    perAnchor,
    aggregate: {
      meanPrecision: round4(mean(precisions)),
      meanRecall: round4(mean(recalls)),
      minPrecision: round4(Math.min(...precisions, 1)),
      minRecall: round4(Math.min(...recalls, 1)),
      perfectPrecisionShare: round4(
        precisions.length > 0
          ? precisions.filter((p) => p === 1).length / precisions.length
          : 0,
      ),
      perfectRecallShare: round4(
        recalls.length > 0
          ? recalls.filter((r) => r === 1).length / recalls.length
          : 0,
      ),
      totalFocusOnlyNodes: totalFocusOnly,
      totalConeOnlyNodes: totalConeOnly,
    },
    focusOnlyByCause,
    coneOnlyByCause,
    focusOnlyExamples,
    coneOnlyExamples,
  };
}

// ── runtime-apply cell (decision 10) ─────────────────────────────────────────

type RuntimeApplyRow = {
  anchor: string;
  /** wall-clock (report only) — stripped for the determinism comparison. */
  applyMs: number;
  changedElements: number;
  revealedElements: number;
  dimStashedElements: number;
  previewFlaggedElements: number;
  focusTierNodes: number;
  relatedTierNodes: number;
  relatedFarTierNodes: number;
  focusedEdges: number;
  nearEdges: number;
  revealedParentGroups: number;
  revealWithinOneHop: boolean;
};

function runRuntimeApplyCell(
  elements: readonly ExcalidrawElement[],
  anchors: readonly string[],
  softFailures: string[],
  context: string,
): {
  mode: Record<string, unknown>;
  anchorsSampled: number;
  perAnchor: RuntimeApplyRow[];
  aggregate: {
    applyMsP50: number;
    applyMsMax: number;
    meanRevealed: number;
    allRevealsWithinOneHop: boolean;
  };
} {
  const options = {
    direction: "dependencies" as const,
    maxHops: Infinity,
  };
  const perAnchor: RuntimeApplyRow[] = [];
  for (const anchor of anchors) {
    const focus = getTerraformRelationshipFocus(
      elements,
      anchor,
      undefined,
      options,
    );
    const t0 = performance.now();
    const { elements: applied } = applyTerraformRelationshipFocus(
      elements,
      anchor,
      "#ffffff",
      options,
    );
    const applyMs = performance.now() - t0;

    let changedElements = 0;
    let revealedElements = 0;
    let dimStashedElements = 0;
    let previewFlaggedElements = 0;
    let revealedParentGroups = 0;
    let revealWithinOneHop = true;
    for (let i = 0; i < elements.length; i++) {
      const before = elements[i]!;
      const after = applied[i]!;
      if (after !== before) {
        changedElements += 1;
      }
      const cd = customDataOf(after);
      if (cd.terraformDimmedOriginals !== undefined) {
        dimStashedElements += 1;
      }
      if (cd.terraformFocusPreview === true) {
        previewFlaggedElements += 1;
      }
      if (before.isDeleted && !after.isDeleted) {
        revealedElements += 1;
        // Reveal invariant (decision 10): only ≤1-hop nodes/edges may be
        // revealed; parent GROUP frames are keyed to the whole focused
        // neighborhood by design and are reported separately.
        const addr =
          typeof cd.nodePath === "string" && cd.nodePath.length > 0
            ? cd.nodePath
            : typeof cd.terraformVisibilityKey === "string" &&
              cd.terraformVisibilityKey.length > 0
            ? cd.terraformVisibilityKey
            : null;
        if (isTerraformLayerEdge(after)) {
          if (!focus.nearEdgeIds.has(after.id)) {
            revealWithinOneHop = false;
            softFailures.push(
              `${context}: revealed edge ${after.id} not in nearEdgeIds (anchor ${anchor})`,
            );
          }
        } else if (addr != null && focus.nodeDistance.has(addr)) {
          if ((focus.nodeDistance.get(addr) ?? 99) > 1) {
            revealWithinOneHop = false;
            softFailures.push(
              `${context}: revealed node ${addr} at hop ` +
                `${focus.nodeDistance.get(addr)} > 1 (anchor ${anchor})`,
            );
          }
        } else {
          revealedParentGroups += 1;
        }
      }
    }

    let relatedTierNodes = 0;
    let relatedFarTierNodes = 0;
    for (const [, hop] of focus.nodeDistance) {
      if (hop === 1) {
        relatedTierNodes += 1;
      } else if (hop >= 2) {
        relatedFarTierNodes += 1;
      }
    }
    perAnchor.push({
      anchor,
      applyMs: round2(applyMs),
      changedElements,
      revealedElements,
      dimStashedElements,
      previewFlaggedElements,
      focusTierNodes: 1,
      relatedTierNodes,
      relatedFarTierNodes,
      focusedEdges: focus.focusedEdgeIds.size,
      nearEdges: focus.nearEdgeIds.size,
      revealedParentGroups,
      revealWithinOneHop,
    });
  }
  return {
    mode: {
      call:
        'applyTerraformRelationshipFocus(elements, anchorPath, "#ffffff", ' +
        '{ direction: "dependencies", maxHops: Infinity })',
      note:
        "the real element-patching seam (decision 10) — dim tiers are a " +
        "color WASH (terraformDimmedOriginals stash), not literal opacity; " +
        "reveal is hardcoded ≤1 hop, only the dim cone extends",
    },
    anchorsSampled: anchors.length,
    perAnchor,
    aggregate: {
      applyMsP50: round2(percentile(perAnchor, (r) => r.applyMs, 0.5)),
      applyMsMax: round2(percentile(perAnchor, (r) => r.applyMs, 1)),
      meanRevealed: round2(mean(perAnchor.map((r) => r.revealedElements))),
      allRevealsWithinOneHop: perAnchor.every((r) => r.revealWithinOneHop),
    },
  };
}

// ── per-arm build + summary ──────────────────────────────────────────────────

type ArmData = {
  elements: ExcalidrawElement[];
  paths: StrataPathMetrics;
  cones: StrataConeMetrics;
  buildMs: number;
  elementCount: number;
  rcllV2Degraded: unknown;
  strataStructural: unknown;
};

async function buildArm(
  sources: TerraformImportPresetSources,
  options: Record<string, unknown>,
): Promise<ArmData> {
  clearTerraformImportPrepCache();
  const t0 = performance.now();
  const body = await layoutTerraformViaWorkers(
    {
      planDotBundles: sources.planDotBundles,
      states: [],
      stateLabels: [],
      tfdTexts: [...sources.tfdTexts],
      tfdLabels: sources.tfdLabels,
    },
    { semanticLayout: false, ...options },
  );
  const buildMs = performance.now() - t0;
  const elements = (body.elements ?? []) as ExcalidrawElement[];
  const meta = (body.meta ?? {}) as Record<string, unknown>;
  return {
    elements,
    paths: computeStrataPathMetrics(elements),
    cones: computeStrataConeMetrics(elements),
    buildMs: round2(buildMs),
    elementCount: elements.filter((e) => !e.isDeleted).length,
    rcllV2Degraded: meta.rcllV2Degraded,
    strataStructural: meta.strataStructural ?? null,
  };
}

function armReport(
  armLabel: string,
  arm: ArmData,
  softFailures: string[],
  presetContext: string,
): Record<string, unknown> {
  const context = `${presetContext}/${armLabel}`;
  const tfdArrows = tfdArrowsOf(arm.elements);
  const annotated = focusAnnotatedEdges(arm.elements);
  const anchors = arm.cones.rows.map((r) => r.anchor);
  const runtimeAnchors = seededSample(
    anchors,
    RUNTIME_APPLY_ANCHOR_MAX,
    BOOTSTRAP_SEED,
  );

  return {
    options: ARM_OPTIONS[armLabel],
    buildMs: arm.buildMs,
    elementCount: arm.elementCount,
    rcllV2Degraded: arm.rcllV2Degraded ?? null,
    strataStructural: arm.strataStructural,
    paths: {
      populationTotal: arm.paths.populationTotal,
      sampled: arm.paths.sampled,
      hopHistogram: arm.paths.hopHistogram,
      edgeCoverage: arm.paths.edgeCoverage,
      unresolvedPathCount: arm.paths.unresolvedPathCount,
      rtHatP50: round2(percentile(arm.paths.rows, (r) => r.rtHat, 0.5)),
      rtHatP90: round2(percentile(arm.paths.rows, (r) => r.rtHat, 0.9)),
      conP90: round2(percentile(arm.paths.rows, (r) => r.con, 0.9)),
      crP90: percentile(arm.paths.rows, (r) => r.cr, 0.9),
      tllP50: round2(percentile(arm.paths.rows, (r) => r.tll, 0.5)),
    },
    cones: {
      anchorsEligible: arm.cones.anchorsEligible,
      sampled: arm.cones.sampled,
      coneCrossingsP50: percentile(arm.cones.rows, (r) => r.coneCrossings, 0.5),
      coneCrossingsP90: percentile(arm.cones.rows, (r) => r.coneCrossings, 0.9),
      coneCrossingsMax: percentile(arm.cones.rows, (r) => r.coneCrossings, 1),
    },
    // Σ max(0,degree−2), layout-invariant — NOT a wrong-branch/reader-error
    // measure (decision 12; reader-error would need interaction telemetry).
    branchLoad: {
      note: "Σ max(0,degree−2), layout-invariant — NOT a wrong-branch/reader-error measure",
      p50: round2(percentile(arm.paths.rows, (r) => r.br, 0.5)),
      p90: round2(percentile(arm.paths.rows, (r) => r.br, 0.9)),
      mean: round4(mean(arm.paths.rows.map((r) => r.br))),
    },
    directionConsistencyProxy: directionConsistencyProxy(
      arm.elements,
      arm.paths.rows,
    ),
    // Focus cells: RUNTIME behavior computed ON this built scene — the scene
    // itself is identical with or without focus (focus arms ≠ scene builds).
    focusCells: {
      note: "focus arms (…+F) are runtime cells on this scene, NOT separate scene builds — focus never changes layout",
      productionCallValidation: runFocusComparisonCell(
        arm.elements,
        anchors,
        tfdArrows,
        annotated,
        arm.cones,
        softFailures,
        context,
        "productionDirected",
      ),
      taskMismatchShippedDefault: runFocusComparisonCell(
        arm.elements,
        anchors,
        tfdArrows,
        annotated,
        arm.cones,
        softFailures,
        context,
        "shippedBoth",
      ),
      runtimeApply: runRuntimeApplyCell(
        arm.elements,
        runtimeAnchors,
        softFailures,
        context,
      ),
    },
  };
}

// ── α-sweep + paired cells ───────────────────────────────────────────────────

function ciView(ci: BootstrapCiResult) {
  return {
    statistic: ci.statistic,
    n: ci.n,
    nUnmatched: ci.nUnmatched,
    point: round4(ci.point),
    lo: round4(ci.lo),
    hi: round4(ci.hi),
    degenerate: ci.degenerate,
    voided: ci.voided,
    /** Δ = candidate − baseline; candidate strictly better ⇒ hi < 0. */
    ciExcludesZeroImproving: !ci.voided && ci.hi < 0,
    /** Parity-or-better: CI not entirely on the worse side. */
    parityOrBetter: !ci.voided && ci.lo <= 0,
    gateEligible: statisticGateEligible(
      ci.statistic as Exclude<BootstrapStatistic, never>,
      ci.n,
    ),
  };
}

function pairedCi(
  baseline: ReadonlyMap<string, number>,
  candidate: ReadonlyMap<string, number>,
  statistic: BootstrapStatistic,
) {
  return ciView(pairedBootstrapCi({ baseline, candidate }, { statistic }));
}

const rtMapOf = (
  rows: readonly PathMetricsRow[],
  alpha: number,
): Map<string, number> => {
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.pathKey, round4(rtHatAttenuated(r, alpha)));
  }
  return m;
};

/** W6-comparable α-sweep of `candRows`(α) vs unaided `baseUnaided` (α is an
 * assumed substitution model — every cell carries sensitivityAnalysis: true). */
function alphaSweepCell(
  baseUnaided: ReadonlyMap<string, number>,
  candRows: readonly PathMetricsRow[],
): { sweep: Record<string, unknown>; maxAlphaParityOrBetter: number | null } {
  const sweep: Record<string, unknown> = {};
  for (const alpha of ALPHAS) {
    sweep[`alpha_${alpha}`] = {
      sensitivityAnalysis: true,
      p50: pairedCi(baseUnaided, rtMapOf(candRows, alpha), "p50"),
      p90: pairedCi(baseUnaided, rtMapOf(candRows, alpha), "p90"),
    };
  }
  const maxAlphaParityOrBetter = [...ALPHAS]
    .reverse()
    .find(
      (alpha) =>
        (sweep[`alpha_${alpha}`] as { p50: { parityOrBetter: boolean } }).p50
          .parityOrBetter,
    );
  return { sweep, maxAlphaParityOrBetter: maxAlphaParityOrBetter ?? null };
}

function pathsCellView(
  baseRows: readonly PathMetricsRow[],
  candRows: readonly PathMetricsRow[],
) {
  const ci = pairedPathMetricsCi(baseRows, candRows);
  return {
    rtHatP50: ciView(ci.rtHatP50),
    rtHatP90: ciView(ci.rtHatP90),
    conP90: ciView(ci.conP90),
    crP90: ciView(ci.crP90),
    tllP50: ciView(ci.tllP50),
  };
}

// ── determinism normalization ────────────────────────────────────────────────

/** Wall-clock keys stripped before the run-twice deep-equal. */
const TIMING_KEYS = new Set(["buildMs", "applyMs", "applyMsP50", "applyMsMax"]);

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

// ── per-preset assembly (shared by both determinism passes) ──────────────────

async function buildPresetFragment(
  sources: TerraformImportPresetSources,
  softFailures: string[],
  presetContext: string,
): Promise<{
  fragment: Record<string, unknown>;
  arms: Map<string, ArmData>;
}> {
  const arms = new Map<string, ArmData>();
  const sceneArms: Record<string, unknown> = {};
  for (const armLabel of ARM_LABELS) {
    const arm = await buildArm(sources, ARM_OPTIONS[armLabel]!);
    arms.set(armLabel, arm);
    if (arm.elements.length === 0) {
      softFailures.push(`${presetContext}/${armLabel}: scene EMPTY`);
    }
    if (arm.paths.sampled === 0) {
      softFailures.push(`${presetContext}/${armLabel}: path population EMPTY`);
    }
    if (arm.cones.sampled === 0) {
      softFailures.push(`${presetContext}/${armLabel}: cone population EMPTY`);
    }
    if (
      STRATA_ARMS.has(armLabel) &&
      arm.rcllV2Degraded !== undefined &&
      arm.rcllV2Degraded !== false
    ) {
      softFailures.push(
        `${presetContext}/${armLabel}: rcllV2Degraded=${JSON.stringify(
          arm.rcllV2Degraded,
        )}`,
      );
    }
    // R2 structural counts must be all-zero on strata arms (engine health).
    if (STRATA_ARMS.has(armLabel)) {
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
        softFailures.push(
          `${presetContext}/${armLabel}: R2 structural nonzero ${JSON.stringify(
            st,
          )}`,
        );
      }
    }
    sceneArms[armLabel] = armReport(armLabel, arm, softFailures, presetContext);
  }

  const v2 = arms.get("A_v2")!;
  const strataI = arms.get("I")!;
  const strataRs = arms.get("I_RS")!;

  // Cell 1 (paired): strata-vs-v2, path-key paired (baseline = A_v2).
  const pairedPathCells = {
    A_v2__vs__I: pathsCellView(v2.paths.rows, strataI.paths.rows),
    A_v2__vs__I_RS: pathsCellView(v2.paths.rows, strataRs.paths.rows),
  };

  // Cell 2 (α-sweep, W6-comparable): baseline = unaided I (α=1).
  const strataUnaided = rtMapOf(strataI.paths.rows, 1);
  const crossover = alphaSweepCell(strataUnaided, v2.paths.rows);
  const symmetric = alphaSweepCell(strataUnaided, strataI.paths.rows);
  const rsSweep = alphaSweepCell(strataUnaided, strataRs.paths.rows);
  const alphaSweep = {
    sensitivityAnalysis: true,
    note:
      "α is an ASSUMED substitution model (rtHatAttenuated scales the cr/con " +
      "visual-search terms), not a measurement — REPORT-only sensitivity " +
      "analysis, W6-comparable shape",
    crossoverSweep_v2F_vs_I_unaided: crossover.sweep,
    maxAlphaParityOrBetter_v2F: crossover.maxAlphaParityOrBetter,
    symmetric_IF_vs_I_unaided: symmetric.sweep,
    maxAlphaParityOrBetter_IF: symmetric.maxAlphaParityOrBetter,
    sweep_I_RS_F_vs_I_unaided: rsSweep.sweep,
    maxAlphaParityOrBetter_I_RS_F: rsSweep.maxAlphaParityOrBetter,
  };

  return {
    fragment: { sceneArms, pairedPathCells, alphaSweep },
    arms,
  };
}

// ── harness ──────────────────────────────────────────────────────────────────

describe("W11 task-tracing battery (report-emitting; REPORT-only cells; never asserts metrics)", () => {
  it(
    "P1 + P2 compact — {A_v2, I, I_RS} scenes × focus runtime cells",
    async () => {
      const softFailures: string[] = [];
      const report: Record<string, unknown> = {
        meta: {
          reportOnly: true,
          seed: BOOTSTRAP_SEED,
          presets: { P1: PRESET_1, P2: PRESET_2 },
          arms: ARM_OPTIONS,
          focusArmsNote:
            "focus arms (A_v2+F, I+F, I_RS+F) are RUNTIME cells computed on " +
            "the three built scenes — focus never changes layout, so they " +
            "are not separate scene builds; see sceneArms.*.focusCells",
          alphaNote:
            "α-sweep cells are sensitivity analysis under an assumed " +
            "substitution model (rtHatAttenuated), not measurements",
          determinismNote:
            "each preset's full fragment is built twice (3 arms × 2 passes) " +
            "and deep-equaled after stripping wall-clock keys " +
            `(${[...TIMING_KEYS].join(", ")})`,
        },
      };

      for (const [presetLabel, preset] of [
        ["P1", PRESET_1],
        ["P2", PRESET_2],
      ] as const) {
        const raw = getTerraformImportPresetSourcesFromDb(preset);
        expect(raw, `preset ${preset} exists`).toBeTruthy();
        const sources = resolveSourcesWithTfdComposition(
          raw! as TerraformImportPresetSources,
        );

        const passA = await buildPresetFragment(
          sources,
          softFailures,
          `${preset}/passA`,
        );
        // Run-twice determinism: rebuild every arm and recompute the FULL
        // fragment; deep-equal after stripping wall-clock timings.
        const passBFailures: string[] = [];
        const passB = await buildPresetFragment(
          sources,
          passBFailures,
          `${preset}/passB`,
        );
        softFailures.push(...passBFailures);
        const normA = JSON.stringify(stripTimings(passA.fragment));
        const normB = JSON.stringify(stripTimings(passB.fragment));
        const deterministic = normA === normB;
        if (!deterministic) {
          softFailures.push(
            `${preset}: run-twice fragment NOT deterministic (normalized sans timings)`,
          );
        }

        report[presetLabel] = {
          preset,
          ...passA.fragment,
          determinism: {
            passes: 2,
            buildsPerPass: ARM_LABELS.length,
            strippedKeys: [...TIMING_KEYS],
            deterministic,
          },
        };
      }

      const json = JSON.stringify({ ...report, softFailures }, null, 2);
      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(`${REPORT_DIR}/W11_TASK_TRACING_BATTERY.json`, json);
      // eslint-disable-next-line no-console -- probe output IS the deliverable
      console.log(
        `W11_TASK_TRACING_BATTERY.json written to ${REPORT_DIR} (${json.length} bytes)`,
      );

      expect(
        softFailures,
        `harness health failures:\n${softFailures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );
});
