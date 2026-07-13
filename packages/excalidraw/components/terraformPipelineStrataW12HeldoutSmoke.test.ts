/**
 * W12 WP1 — smoke tests + FROZEN input-only distinctness profile for the
 * synthetic held-out preset `staging-heldout-mesh` (P3).
 *
 * REPORT-only discipline: this file registers nothing, touches no frozen rows
 * and never asserts battery metrics. Hard asserts cover only:
 *   - the preset loads from the committed test DB and lays out through
 *     `layoutTerraformViaWorkers` in BOTH v2 pipeline mode and strata mode
 *     (K=4 + A7, options copied from the W11 battery `I` arm) without
 *     throwing, with non-empty elements, and without silent strata
 *     degradation (meta.rcllV2Degraded absent);
 *   - P3's own structural targets (hub out-degree >= 12, >= 2 SCCs of size
 *     >= 2 on RESOLVED TFD flow endpoints, module depth >= 4);
 *   - input-only distinctness: P3 differs from BOTH P1 and P2 on >= 3
 *     non-scale axes (scale counts as ONE dimension).
 *
 * The frozen distinctness profile (module-depth distribution, out-degree
 * distribution on resolved TFD flow, SCC size/count, TFD path-length
 * distribution, resource-type mix, resource count) is committed in WP1,
 * BEFORE any W12 battery numbers exist for P3 (codex plan-review P2).
 * A full-detail (pipelineCompact:false) strata + v2 smoke on P3 records
 * wall-clock into the profile JSON to seed the WP3 timeout budgets.
 *
 * SYNTHETIC-P3 DISCLOSURE: `staging-heldout-mesh` is SELF-AUTHORED
 * (scripts/generate-heldout-plan.mjs, mulberry32 seed 20260704) —
 * out-of-tuning-distribution transfer material, NOT an independently sampled
 * held-out plan. R8-F4 stays formally open.
 *
 * Run (writes P3_DISTINCTNESS_PROFILE.{json,md} to $Q12_REPORT_DIR, default
 * tmpdir; the committed copy lives at docs/strata-baselines/q12/):
 *   Q12_REPORT_DIR=docs/strata-baselines/q12 yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataW12HeldoutSmoke.test.ts \
 *     --exclude "**\/.claude/**"
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import {
  loadStagingHeldoutMeshFixture,
  STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS,
} from "../test-fixtures/terraformPresetFixtures";

import {
  DECLARED_DATAFLOW_ORDERED_KEY,
  type DeclaredDataFlowEdge,
} from "./terraformDeclaredDataFlow";
import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
} from "./terraformPlanParsing";

import type { Graph } from "@dagrejs/graphlib";
import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const PRESETS = {
  P1: "staging-extended-localstack-v2",
  P2: "staging-localstack",
  P3: "staging-heldout-mesh",
} as const;

const REPORT_DIR = process.env.Q12_REPORT_DIR ?? tmpdir();
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 60;

// Arm options copied from terraformPipelineStrataTaskTracingBattery.test.ts
// (A_v2 / I) and terraformPipelineStrataExtentGate.test.ts (full-detail
// bundles F_v2_full_ancillary / I2_strata_k4_a7_full).
const ARM_OPTIONS: Record<string, Record<string, unknown>> = {
  A_v2: {
    layoutMode: "pipeline",
    pipelineLayoutVariant: "v2",
    pipelineCompact: true,
  },
  I: {
    layoutMode: "strata",
    pipelineCompact: true,
    strataSweeps: 4,
    strataCoordinateRefine: true,
  },
  F_v2_full_ancillary: {
    layoutMode: "pipeline",
    pipelineLayoutVariant: "v2",
    pipelineCompact: false,
    pipelineIncludeAncillary: true,
  },
  I2_strata_k4_a7_full: {
    layoutMode: "strata",
    pipelineCompact: false,
    strataSweeps: 4,
    strataCoordinateRefine: true,
  },
};

const STRATA_ARMS = new Set(["I", "I2_strata_k4_a7_full"]);

const round2 = (n: number): number => Math.round(n * 100) / 100;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[idx]!;
}

// ── input-only profile machinery ─────────────────────────────────────────────

type Digraph = Map<string, Set<string>>;

function tfdDigraph(edges: readonly DeclaredDataFlowEdge[]): {
  graph: Digraph;
  nodes: Set<string>;
} {
  const graph: Digraph = new Map();
  const nodes = new Set<string>();
  for (const { source, target } of edges) {
    if (source === target) {
      continue;
    }
    nodes.add(source);
    nodes.add(target);
    (graph.get(source) ?? graph.set(source, new Set()).get(source)!).add(
      target,
    );
  }
  return { graph, nodes };
}

/** Tarjan SCC (recursive; TFD graphs here are a few hundred endpoints). */
function stronglyConnectedComponents(
  graph: Digraph,
  nodes: ReadonlySet<string>,
): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  const visit = (v: string): void => {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!indices.has(w)) {
        visit(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }
    if (lowlink.get(v) === indices.get(v)) {
      const component: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
        if (w === v) {
          break;
        }
      }
      components.push(component.sort());
    }
  };

  for (const v of [...nodes].sort()) {
    if (!indices.has(v)) {
      visit(v);
    }
  }
  return components;
}

/** BFS hop distances from every in-degree-0 root to every reachable endpoint. */
function pathLengthDistribution(
  graph: Digraph,
  nodes: ReadonlySet<string>,
): number[] {
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    inDegree.set(node, 0);
  }
  for (const targets of graph.values()) {
    for (const t of targets) {
      inDegree.set(t, (inDegree.get(t) ?? 0) + 1);
    }
  }
  let roots = [...nodes].filter((n) => (inDegree.get(n) ?? 0) === 0).sort();
  if (roots.length === 0) {
    roots = [...nodes].sort();
  }
  const lengths: number[] = [];
  for (const root of roots) {
    const dist = new Map<string, number>([[root, 0]]);
    let frontier = [root];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const u of frontier) {
        for (const v of graph.get(u) ?? []) {
          if (!dist.has(v)) {
            dist.set(v, dist.get(u)! + 1);
            next.push(v);
          }
        }
      }
      frontier = next;
    }
    for (const [node, d] of dist) {
      if (node !== root && d > 0) {
        lengths.push(d);
      }
    }
  }
  return lengths.sort((a, b) => a - b);
}

const moduleDepthOf = (address: string): number =>
  (address.match(/\bmodule\./g) ?? []).length;

type PresetProfile = {
  preset: string;
  resourceCount: number;
  moduleDepth: {
    histogram: Record<string, number>;
    max: number;
    meanX100: number;
  };
  resourceTypes: {
    distinct: number;
    top: Array<{ type: string; count: number }>;
  };
  tfdFlow: {
    resolvedEdges: number;
    endpoints: number;
    outDegree: { p50: number; p90: number; max: number };
    scc: { countGe2: number; sizesGe2: number[] };
    pathLengths: { samples: number; p50: number; p90: number; max: number };
  };
};

function computePresetProfile(
  presetId: string,
  sources: TerraformImportPresetSources,
): PresetProfile {
  const resourceChanges: Array<{ address?: string; type?: string }> = [];
  for (const bundle of sources.planDotBundles) {
    const rc = (bundle.plan as { resource_changes?: unknown })
      .resource_changes;
    if (Array.isArray(rc)) {
      resourceChanges.push(...(rc as Array<{ address?: string }>));
    }
  }

  const depthHistogram: Record<string, number> = {};
  let depthMax = 0;
  let depthSum = 0;
  const typeCounts = new Map<string, number>();
  for (const rc of resourceChanges) {
    const depth = moduleDepthOf(rc.address ?? "");
    depthHistogram[String(depth)] = (depthHistogram[String(depth)] ?? 0) + 1;
    depthMax = Math.max(depthMax, depth);
    depthSum += depth;
    const type = typeof rc.type === "string" ? rc.type : "unknown";
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }

  // Resolved TFD flow endpoints: build the SAME nodes map the import path
  // builds (dot adjacency irrelevant for declared flow — pass an empty
  // adjacency), then apply the tfd overlay and read the ordered declared
  // edges (the layout substrate).
  const nodes = buildTerraformLocalImportNodesMap(
    sources.planDotBundles[0]!.plan,
    undefined as unknown as Graph,
    [],
    { adjacency: {} },
  );
  applyTfdOverlayToNodes(nodes, [...sources.tfdTexts], sources.tfdLabels);
  const edges = nodes[DECLARED_DATAFLOW_ORDERED_KEY] ?? [];
  const { graph, nodes: endpointSet } = tfdDigraph(edges);
  const outDegrees = [...endpointSet]
    .map((n) => graph.get(n)?.size ?? 0)
    .sort((a, b) => a - b);
  const sccSizesGe2 = stronglyConnectedComponents(graph, endpointSet)
    .map((c) => c.length)
    .filter((size) => size >= 2)
    .sort((a, b) => a - b);
  const pathLengths = pathLengthDistribution(graph, endpointSet);

  return {
    preset: presetId,
    resourceCount: resourceChanges.length,
    moduleDepth: {
      histogram: depthHistogram,
      max: depthMax,
      meanX100: Math.round(
        (depthSum / Math.max(1, resourceChanges.length)) * 100,
      ),
    },
    resourceTypes: {
      distinct: typeCounts.size,
      top: [...typeCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 10)
        .map(([type, count]) => ({ type, count })),
    },
    tfdFlow: {
      resolvedEdges: edges.length,
      endpoints: endpointSet.size,
      outDegree: {
        p50: percentile(outDegrees, 0.5),
        p90: percentile(outDegrees, 0.9),
        max: percentile(outDegrees, 1),
      },
      scc: { countGe2: sccSizesGe2.length, sizesGe2: sccSizesGe2 },
      pathLengths: {
        samples: pathLengths.length,
        p50: percentile(pathLengths, 0.5),
        p90: percentile(pathLengths, 0.9),
        max: percentile(pathLengths, 1),
      },
    },
  };
}

function typeJaccard(a: PresetProfile, b: PresetProfile): number {
  // top-list Jaccard is too lossy; recompute over ALL types is not available
  // here, so use the committed top-10 lists' type sets — stable, input-only.
  const setA = new Set(a.resourceTypes.top.map((t) => t.type));
  const setB = new Set(b.resourceTypes.top.map((t) => t.type));
  const intersection = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
}

// ── smokes ───────────────────────────────────────────────────────────────────

async function buildSmokeArm(
  sources: TerraformImportPresetSources,
  armLabel: string,
): Promise<{
  buildMs: number;
  elementCount: number;
  rcllV2Degraded: unknown;
}> {
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
    { semanticLayout: false, ...ARM_OPTIONS[armLabel]! },
  );
  const buildMs = performance.now() - t0;
  const elements = (body.elements ?? []) as ExcalidrawElement[];
  const meta = (body.meta ?? {}) as Record<string, unknown>;
  return {
    buildMs: round2(buildMs),
    elementCount: elements.filter((e) => !e.isDeleted).length,
    rcllV2Degraded: meta.rcllV2Degraded,
  };
}

function profileMarkdown(
  profiles: Record<string, PresetProfile>,
  distinctness: Record<string, unknown>,
): string {
  const cols = ["P1", "P2", "P3"] as const;
  const row = (label: string, fn: (p: PresetProfile) => string | number) =>
    `| ${label} | ${cols.map((c) => fn(profiles[c]!)).join(" | ")} |`;
  return [
    "# P3 distinctness profile (input-only, frozen in W12 WP1)",
    "",
    "REPORT-only, unregistered. P3 (`staging-heldout-mesh`) is SELF-AUTHORED",
    "(scripts/generate-heldout-plan.mjs, seed 20260704): out-of-tuning-distribution",
    "transfer material, NOT an independently sampled held-out plan — R8-F4 stays open.",
    "Scale counts as ONE dimension. Cycles/degrees/paths are measured on RESOLVED",
    "TFD flow endpoints (the layout substrate), not raw tfd text.",
    "",
    `| axis | ${cols.map((c) => `${c} (${profiles[c]!.preset})`).join(" | ")} |`,
    "|---|---|---|---|",
    row("resource_changes (scale — ONE dimension)", (p) => p.resourceCount),
    row("module depth max", (p) => p.moduleDepth.max),
    row("module depth histogram", (p) =>
      JSON.stringify(p.moduleDepth.histogram),
    ),
    row("TFD resolved edges", (p) => p.tfdFlow.resolvedEdges),
    row("TFD endpoints", (p) => p.tfdFlow.endpoints),
    row(
      "out-degree p50/p90/max",
      (p) =>
        `${p.tfdFlow.outDegree.p50}/${p.tfdFlow.outDegree.p90}/${p.tfdFlow.outDegree.max}`,
    ),
    row("SCCs (size >= 2)", (p) => JSON.stringify(p.tfdFlow.scc.sizesGe2)),
    row(
      "path length p50/p90/max",
      (p) =>
        `${p.tfdFlow.pathLengths.p50}/${p.tfdFlow.pathLengths.p90}/${p.tfdFlow.pathLengths.max}`,
    ),
    row("distinct resource types", (p) => p.resourceTypes.distinct),
    row("top types", (p) =>
      p.resourceTypes.top
        .slice(0, 5)
        .map((t) => `${t.type}(${t.count})`)
        .join(", "),
    ),
    "",
    "## Distinctness verdict",
    "",
    "```json",
    JSON.stringify(distinctness, null, 2),
    "```",
    "",
  ].join("\n");
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("W12 WP1 — staging-heldout-mesh smoke + frozen distinctness profile", () => {
  it("P3 loads from the committed preset DB via the standard seam", () => {
    const raw = getTerraformImportPresetSourcesFromDb(PRESETS.P3);
    expect(raw).toBeTruthy();
    const fixture = loadStagingHeldoutMeshFixture();
    expect(fixture.planDotBundles).toHaveLength(1);
    const plan = fixture.planDotBundles[0]!.plan as {
      resource_changes: unknown[];
    };
    expect(plan.resource_changes.length).toBeGreaterThanOrEqual(350);
    expect(fixture.tfdTexts).toHaveLength(1);
    expect(fixture.planDotBundles[0]!.dotText).toContain("digraph");
  });

  it(
    "input-only distinctness profile (P1/P2/P3) + P3 v2/strata smokes incl. full detail",
    async () => {
      const profiles: Record<string, PresetProfile> = {};
      const sourcesByLabel: Record<string, TerraformImportPresetSources> = {};
      for (const [label, presetId] of Object.entries(PRESETS)) {
        const raw = getTerraformImportPresetSourcesFromDb(presetId);
        expect(raw, `preset ${presetId} exists`).toBeTruthy();
        const sources = resolveSourcesWithTfdComposition(
          raw! as TerraformImportPresetSources,
        );
        sourcesByLabel[label] = sources;
        profiles[label] = computePresetProfile(presetId, sources);
      }

      const p1 = profiles.P1!;
      const p2 = profiles.P2!;
      const p3 = profiles.P3!;

      // P3 structural targets (input-only, deterministic).
      expect(p3.tfdFlow.outDegree.max, "hub out-degree").toBeGreaterThanOrEqual(
        12,
      );
      expect(
        p3.tfdFlow.scc.countGe2,
        "reference cycles on resolved TFD flow",
      ).toBeGreaterThanOrEqual(2);
      expect(p3.moduleDepth.max, "module depth").toBeGreaterThanOrEqual(4);

      // Non-scale distinctness axes: P3 must differ from BOTH P1 and P2.
      const axes: Record<
        string,
        { p1: unknown; p2: unknown; p3: unknown; distinctFromBoth: boolean }
      > = {
        moduleDepthMax: {
          p1: p1.moduleDepth.max,
          p2: p2.moduleDepth.max,
          p3: p3.moduleDepth.max,
          distinctFromBoth:
            p3.moduleDepth.max !== p1.moduleDepth.max &&
            p3.moduleDepth.max !== p2.moduleDepth.max,
        },
        sccCountGe2: {
          p1: p1.tfdFlow.scc.countGe2,
          p2: p2.tfdFlow.scc.countGe2,
          p3: p3.tfdFlow.scc.countGe2,
          distinctFromBoth:
            p3.tfdFlow.scc.countGe2 !== p1.tfdFlow.scc.countGe2 &&
            p3.tfdFlow.scc.countGe2 !== p2.tfdFlow.scc.countGe2,
        },
        maxOutDegree: {
          p1: p1.tfdFlow.outDegree.max,
          p2: p2.tfdFlow.outDegree.max,
          p3: p3.tfdFlow.outDegree.max,
          distinctFromBoth:
            p3.tfdFlow.outDegree.max !== p1.tfdFlow.outDegree.max &&
            p3.tfdFlow.outDegree.max !== p2.tfdFlow.outDegree.max,
        },
        pathLengthP90: {
          p1: p1.tfdFlow.pathLengths.p90,
          p2: p2.tfdFlow.pathLengths.p90,
          p3: p3.tfdFlow.pathLengths.p90,
          distinctFromBoth:
            p3.tfdFlow.pathLengths.p90 !== p1.tfdFlow.pathLengths.p90 &&
            p3.tfdFlow.pathLengths.p90 !== p2.tfdFlow.pathLengths.p90,
        },
        topTypeMixJaccard: {
          p1: round2(typeJaccard(p3, p1)),
          p2: round2(typeJaccard(p3, p2)),
          p3: "reference",
          distinctFromBoth:
            typeJaccard(p3, p1) < 0.6 && typeJaccard(p3, p2) < 0.6,
        },
      };
      const distinctAxes = Object.entries(axes)
        .filter(([, v]) => v.distinctFromBoth)
        .map(([k]) => k);
      expect(
        distinctAxes.length,
        `P3 must be non-redundantly distinct from BOTH P1 and P2 on >= 3 non-scale axes; got ${JSON.stringify(
          axes,
        )}`,
      ).toBeGreaterThanOrEqual(3);

      // ── P3 smokes: v2 + strata (compact), then full-detail wall-clocks ────
      const p3Sources = sourcesByLabel.P3!;
      const smokes: Record<
        string,
        { buildMs: number; elementCount: number; rcllV2Degraded: unknown }
      > = {};
      for (const armLabel of Object.keys(ARM_OPTIONS)) {
        const arm = await buildSmokeArm(p3Sources, armLabel);
        smokes[armLabel] = arm;
        expect(
          arm.elementCount,
          `${armLabel}: non-empty elements`,
        ).toBeGreaterThan(0);
        if (STRATA_ARMS.has(armLabel)) {
          expect(
            arm.rcllV2Degraded === undefined || arm.rcllV2Degraded === false,
            `${armLabel}: strata silently degraded (rcllV2Degraded=${JSON.stringify(
              arm.rcllV2Degraded,
            )})`,
          ).toBe(true);
        }
      }

      const report = {
        meta: {
          reportOnly: true,
          unregistered: true,
          scope:
            "W12 WP1 frozen INPUT-ONLY distinctness profile + P3 smoke wall-clocks (WP3 budget seed)",
          syntheticP3Disclosure:
            "staging-heldout-mesh is SELF-AUTHORED (scripts/generate-heldout-plan.mjs, " +
            "mulberry32 seed 20260704): out-of-tuning-distribution transfer material, " +
            "NOT an independently sampled held-out plan — R8-F4 stays formally open.",
          scaleNote: "resourceCount is ONE distinctness dimension (scale)",
          resolvedFlowNote:
            "degree/SCC/path metrics measured on RESOLVED TFD flow endpoints " +
            "(DECLARED_DATAFLOW_ORDERED_KEY after applyTfdOverlayToNodes)",
          presets: PRESETS,
        },
        profiles,
        distinctness: {
          nonScaleAxesDistinctFromBoth: distinctAxes,
          required: 3,
          axes,
        },
        p3Smokes: {
          note:
            "buildMs are single-run wall-clocks (informational; WP3 budget " +
            "seed for full-detail cells). Arms copied from W11 battery (A_v2/I) " +
            "and ExtentGate full-detail bundles.",
          arms: Object.fromEntries(
            Object.entries(smokes).map(([label, s]) => [
              label,
              { options: ARM_OPTIONS[label], ...s },
            ]),
          ),
        },
      };

      mkdirSync(REPORT_DIR, { recursive: true });
      const json = JSON.stringify(report, null, 2);
      writeFileSync(`${REPORT_DIR}/P3_DISTINCTNESS_PROFILE.json`, `${json}\n`);
      writeFileSync(
        `${REPORT_DIR}/P3_DISTINCTNESS_PROFILE.md`,
        profileMarkdown(profiles, report.distinctness),
      );
      // eslint-disable-next-line no-console -- probe output IS the deliverable
      console.log(
        `P3_DISTINCTNESS_PROFILE.{json,md} written to ${REPORT_DIR} (${json.length} bytes)`,
      );
    },
    TIMEOUT,
  );
});
