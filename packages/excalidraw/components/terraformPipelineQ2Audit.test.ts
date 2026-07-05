/**
 * THROWAWAY Q2 audit — quantifies how much the EXISTING rcll engine's
 * built-but-default-OFF readability passes improve legibility, vs the v2
 * baseline and rcll-everything-off. Round 5 ran this on
 * staging-extended-localstack-v2 only; round 6 extends it to a second,
 * structurally different preset (multi-state, 25 plan bundles) plus a cyclic
 * 2-cycle fixture, and adds the round-5 caveat fixes: crossings normalized per
 * eligible pair (arrow pairs sharing no endpoint address) and diagnose timing.
 *
 * Run:
 *   yarn vitest run packages/excalidraw/components/terraformPipelineQ2Audit.test.ts
 *
 * Committed as the standing round-5/6 measurement probe (reports in
 * docs/rcll-v2-shit-test-round5.md §4 / round6.md §3); promotion to T9
 * fixtures is an S2/T9 decision (spec v3 §2). Writes report JSONs to
 * $Q2_REPORT_DIR (default: os tmpdir).
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import graphlibDot from "@dagrejs/graphlib-dot";
import { getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { DECLARED_DATAFLOW_ORDERED_KEY } from "./terraformDeclaredDataFlow";
import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";
import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
} from "./terraformPlanParsing";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const PRESET_1 = "staging-extended-localstack-v2";
const PRESET_2 = "staging-localstack"; // single-bundle, sparser, different infra shape
const PRESET_3 = "staging-multi-state-expanded"; // 25 plan bundles — declared dataflow
// resolves via tfd COMPOSITION, so the naive bundle[0] overlay pre-check does
// not apply; tfdArrowCount in the report tells us whether metrics are vacuous.
const REPORT_DIR = process.env.Q2_REPORT_DIR ?? tmpdir();
const round = (n: number) => Math.round(n * 100) / 100;

function emitReport(name: string, payload: unknown) {
  const json = JSON.stringify(payload, null, 2);
  writeFileSync(`${REPORT_DIR}/${name}.json`, json);
  // eslint-disable-next-line no-console -- probe output IS the deliverable
  console.log(`${name} written (${json.length} bytes)`);
}

function loadSources(preset: string) {
  const raw = getTerraformImportPresetSourcesFromDb(preset);
  expect(raw, `preset ${preset} exists`).toBeTruthy();
  return resolveSourcesWithTfdComposition(raw! as TerraformImportPresetSources);
}

/**
 * Eligible pairs per spec T9: rendered, non-aggregated TFD arrows sharing no
 * endpoint ADDRESS. Numerator (diagnose crossings) is over all tfd-arrow
 * pairs, but geometric endpoint-sharing is already excluded by segmentsCross,
 * so the ratio is a close upper bound on crossings-per-eligible-pair.
 */
function eligiblePairCount(elements: readonly ExcalidrawElement[]): number {
  const rels: Array<{ s: string; t: string }> = [];
  for (const el of elements) {
    // match diagnosePipelineScene's arrow population exactly: NO isDeleted
    // filter — declared-dataflow arrows are emitted isDeleted (visibility is
    // toggled at view time), so filtering live-only finds zero TFD arrows
    // (the v1 RFC's documented isDeleted false-0 diagnostics trap).
    if (el.type !== "arrow") {
      continue;
    }
    const r = (el.customData as { relationship?: Record<string, unknown> })
      ?.relationship;
    if (
      r &&
      typeof r.source === "string" &&
      typeof r.target === "string" &&
      r.aggregated !== true
    ) {
      rels.push({ s: r.source, t: r.target });
    }
  }
  let eligible = 0;
  for (let i = 0; i < rels.length; i++) {
    for (let j = i + 1; j < rels.length; j++) {
      const a = rels[i]!;
      const b = rels[j]!;
      if (a.s !== b.s && a.s !== b.t && a.t !== b.s && a.t !== b.t) {
        eligible += 1;
      }
    }
  }
  return eligible;
}

async function layout(
  preset: string,
  options: Record<string, unknown>,
  tfdTextsOverride?: readonly string[],
) {
  const sources = loadSources(preset);
  const tfdTexts = tfdTextsOverride ? [...tfdTextsOverride] : sources.tfdTexts;
  if (tfdTextsOverride) {
    // prep-cache fingerprint is `tfd:${length}:${slice(0,40)}` — never trust
    // it across text mutations (F14)
    clearTerraformImportPrepCache();
  }
  // single-bundle presets: sanity-check the tfd overlay bites via bundle[0];
  // multi-bundle presets resolve declared dataflow via composition, so the
  // naive overlay check does not apply — the post-layout tfdArrowCount in the
  // report is the vacuity guard there.
  if (sources.planDotBundles.length === 1) {
    const bundle = sources.planDotBundles[0]!;
    const graph = graphlibDot.read("digraph G {}\n");
    const nodes = buildTerraformLocalImportNodesMap(bundle.plan, graph, [], {});
    applyTfdOverlayToNodes(nodes, tfdTexts, sources.tfdLabels);
    expect(nodes[DECLARED_DATAFLOW_ORDERED_KEY]?.length ?? 0).toBeGreaterThan(
      0,
    );
  }

  const t0 = performance.now();
  const body = await layoutTerraformViaWorkers(
    {
      planDotBundles: sources.planDotBundles,
      states: [],
      stateLabels: [],
      tfdTexts,
      tfdLabels: sources.tfdLabels,
    },
    { semanticLayout: false, ...options },
  );
  const wallMs = Math.round(performance.now() - t0);

  const elements = body.elements as ExcalidrawElement[];
  const live = elements.filter((e) => !e.isDeleted);
  const [minX, minY, maxX, maxY] = getCommonBounds(live);
  const tDiag = performance.now();
  const d = diagnosePipelineScene(elements);
  const diagMs = Math.round(performance.now() - tDiag);
  const eligiblePairs = eligiblePairCount(elements);
  const meta = (body.meta ?? {}) as Record<string, unknown>;

  // echo only the pipeline*/rcll*/strata* meta keys (resolved flags +
  // suppressions + degraded)
  const metaEcho: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (/^(pipeline|rcll|strata)/i.test(k) && typeof v !== "object") {
      metaEcho[k] = v;
    }
  }
  if (meta.rcllDegraded !== undefined) {
    metaEcho.rcllDegraded = meta.rcllDegraded;
  }
  if (meta.rcllModules !== undefined) {
    metaEcho.rcllModules = meta.rcllModules;
  }
  // Object-shaped strata meta: explicit exception lines per v3.1 §2.6 (the
  // harness never picks these up mechanically). `rcllV2Degraded` MUST be
  // absent on healthy strata arms — T9 reads its presence off this echo.
  if (meta.rcllV2Degraded !== undefined) {
    metaEcho.rcllV2Degraded = meta.rcllV2Degraded;
  }
  if (meta.strataStructural !== undefined) {
    metaEcho.strataStructural = meta.strataStructural;
  }

  return {
    wallMs,
    diagMs,
    requestedOptions: options,
    resolvedMeta: metaEcho,
    elementCount: live.length,
    bounds: {
      width: round(maxX - minX),
      height: round(maxY - minY),
      aspect: round((maxX - minX) / Math.max(1, maxY - minY)),
    },
    metrics: {
      crossings: d.dataflow.crossings,
      eligiblePairs,
      crossingsPerEligiblePair: round(
        d.dataflow.crossings / Math.max(1, eligiblePairs),
      ),
      medianVerticalDeviationPx: d.dataflow.medianVerticalDeviationPx,
      meanVerticalDeviationPx: d.dataflow.meanVerticalDeviationPx,
      fractionNearStraight: d.dataflow.fractionNearStraight,
      fanoutColumnRate: d.dataflow.fanoutColumnRate,
      fanoutSetCount: d.dataflow.fanoutSetCount,
      hubCenteringRate: d.dataflow.hubCenteringRate,
      hubCount: d.dataflow.hubCount,
      tfdArrowCount: d.dataflow.tfdArrowCount,
      collisionCount: d.collisionCount,
      dataflowAspect: d.dataflow.aspect,
      // T9 (WP-2d, spec v3.1 §2): slice-A/B split + companion metrics, echoed
      // verbatim from diagnosePipelineScene's additive `slices` field so the
      // baseline-derivation run (v3.1 §8 / C11 precondition) can read
      // per-preset/per-arm slice populations + stats straight off this report.
      slices: d.slices,
    },
  };
}

const ARMS: Array<[string, Record<string, unknown>]> = [
  [
    "A_v2_baseline",
    {
      layoutMode: "pipeline",
      pipelineLayoutVariant: "v2",
      pipelineCompact: true,
    },
  ],
  ["B_rcll_everything_off", { layoutMode: "rcll", pipelineCompact: true }],
  [
    "C_rcll_readable_profile",
    {
      layoutMode: "rcll",
      pipelineCompact: true,
      // resolveRcllLayoutProfile("readable") = reorder+straighten on,
      // everything else off, columnPacking none, staircase OFF
      pipelineLayoutProfile: "readable",
    },
  ],
  [
    "D_rcll_max_readability_compact_packing",
    {
      layoutMode: "rcll",
      pipelineCompact: true,
      pipelineCrossingMin: true, // supersedes reorder (guard drops reorder)
      pipelineStraighten: true, // required companion of coordRepack
      pipelineCoordRepack: true,
      pipelineColumnPacking: "compact",
    },
  ],
  [
    "D2_rcll_max_readability_shorten_packing",
    {
      layoutMode: "rcll",
      pipelineCompact: true,
      pipelineCrossingMin: true,
      pipelineStraighten: true,
      pipelineCoordRepack: true,
      pipelineColumnPacking: "shorten", // NS ranker + compact bundle
    },
  ],
  [
    // Owner's actual preferred view — demo URL params mapped to engine
    // options per terraformDemoUrlParams.ts (LOD/minimap/layers are
    // view-time only, ignored here).
    "E_owner_preferred_view",
    {
      layoutMode: "rcll",
      pipelineCompact: false, // compact=0 (full view)
      pipelineIncludeAncillary: true, // ancillary=1
      pipelineSwimlaneLaneRise: true, // swimlaneRise=1
      pipelineReorder: true, // reorder=1 (crossingMin wins per guard)
      pipelineCrossingMin: true, // crossingMin=1
      pipelineDeBandLevel: "none", // deBandLevel=none
      pipelineRankSeparate: true, // rankSeparate=1 (laneRise satisfied)
      pipelineStraighten: true, // straighten=1
      pipelineCoordRepack: true, // coordRepack=1
      pipelineColumnPacking: "shorten", // shorten's NS loses to rankSeparate per guard
      pipelineStaircaseBandOverlap: true, // staircaseBandOverlap=1
    },
  ],
  [
    // Comparable v2 full view: compact off + ancillary on.
    "F_v2_full_ancillary",
    {
      layoutMode: "pipeline",
      pipelineLayoutVariant: "v2",
      pipelineCompact: false,
      pipelineIncludeAncillary: true,
    },
  ],
  [
    // Strata M1a @ K=0 ("model-order bands") — engine defaults, compact cards.
    // Extraction-free by design (ancillary ports at M3, honest meta SDEC-29).
    "G_strata_k0",
    {
      layoutMode: "strata",
      pipelineCompact: true,
    },
  ],
  [
    // Strata M1a @ K=0, full card mode (SDEC-29: battery in BOTH card modes).
    "G2_strata_k0_full",
    {
      layoutMode: "strata",
      pipelineCompact: false,
    },
  ],
];

async function runArms(preset: string) {
  const out: Record<string, Awaited<ReturnType<typeof layout>>> = {};
  for (const [label, opts] of ARMS) {
    out[label] = await layout(preset, opts);
  }
  return out;
}

// ---------------------------------------------------------------------------
// cyclic fixture: append a reverse edge for a mid-file single-target edge line
// → a genuine 2-cycle in the declared dataflow (the module-collapse shape the
// spec's A3 targets; today's engines hit the cyclic clamp / DEC-8 path).
// ---------------------------------------------------------------------------

function mutateAddTwoCycle(texts: readonly string[]): {
  texts: string[];
  note: string;
} {
  const isEdgeLine = (line: string): { src: string; tgt: string } | null => {
    const t = line.trim();
    if (!t || t.startsWith("#") || /^bind\s/i.test(t) || t.includes("-->")) {
      return null;
    }
    const m = t.match(/^([^\s#]+)\s*->\s*(.+)$/);
    if (!m) {
      return null;
    }
    const targets = m[2]!.split(",").map((s) => s.trim());
    return targets.length === 1 ? { src: m[1]!, tgt: targets[0]! } : null;
  };
  let bestFile = -1;
  let bestCount = -1;
  texts.forEach((t, i) => {
    const n = (t ?? "").split(/\r?\n/).filter((l) => isEdgeLine(l)).length;
    if (n > bestCount) {
      bestCount = n;
      bestFile = i;
    }
  });
  expect(bestCount).toBeGreaterThan(10);
  const lines = texts[bestFile]!.split(/\r?\n/);
  const edgeIdx = lines
    .map((l, i) => (isEdgeLine(l) ? i : -1))
    .filter((i) => i >= 0);
  const mid = edgeIdx[Math.floor(edgeIdx.length / 2)]!;
  const e = isEdgeLine(lines[mid]!)!;
  const reverseLine = `${e.tgt} -> ${e.src}`;
  const out = [...texts];
  out[bestFile] = [...lines, reverseLine].join("\n");
  return {
    texts: out,
    note: `appended "${reverseLine}" to tfd[${bestFile}] reversing mid-file edge "${lines[
      mid
    ]!.trim()}" → 2-cycle`,
  };
}

describe("Q2 audit — rcll readability passes vs v2 baseline (throwaway)", () => {
  it(
    `${PRESET_1} — 7 arms (round-5 battery + normalization columns)`,
    async () => {
      const out = await runArms(PRESET_1);
      emitReport("Q2_AUDIT_REPORT_P1", out);
      expect(Object.keys(out).length).toBe(ARMS.length);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    `${PRESET_2} — 7 arms (generalization battery, structurally different preset)`,
    async () => {
      const out = await runArms(PRESET_2);
      emitReport("Q2_AUDIT_REPORT_P2", out);
      expect(Object.keys(out).length).toBe(ARMS.length);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    `${PRESET_3} — 7 arms (multi-root composition battery; tfdArrowCount guards vacuity)`,
    async () => {
      const out = await runArms(PRESET_3);
      emitReport("Q2_AUDIT_REPORT_P3_MULTISTATE", out);
      expect(Object.keys(out).length).toBe(ARMS.length);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    `${PRESET_1} + injected 2-cycle — cyclic robustness (v2 / rcll / owner view)`,
    async () => {
      const sources = loadSources(PRESET_1);
      const cyc = mutateAddTwoCycle(sources.tfdTexts);
      const cyclicArms: Array<[string, Record<string, unknown>]> = [
        ["A_v2_baseline", ARMS[0]![1]],
        ["B_rcll_everything_off", ARMS[1]![1]],
        ["E_owner_preferred_view", ARMS[5]![1]],
        // Strata @ K=0 on the injected 2-cycle: A3 GreedyFAS must repair it
        // end-to-end with NO rcllV2Degraded (W2 battery, cyclic robustness).
        ["G_strata_k0", ARMS[7]![1]],
      ];
      const out: Record<string, unknown> = { mutation: cyc.note };
      for (const [label, opts] of cyclicArms) {
        out[label] = await layout(PRESET_1, opts, cyc.texts);
      }
      emitReport("Q2_AUDIT_REPORT_CYCLIC", out);
      expect(Object.keys(out).length).toBe(cyclicArms.length + 1);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );
});
