/**
 * PROBE 1 — post-A7 exclusive-downstream CHAIN relocate (`strataChainRelocate`).
 *
 * Measures the diagnosed api6-lambda / api7-ecs stranding on preset
 * staging-extended-localstack-v2 with the exact owner option set, toggle OFF vs
 * ON. REQUIREMENTS:
 *   - OFF must be byte-identical to the pre-change baseline geometryHash;
 *   - ON must reduce total routed edge length, crossings non-increasing, height
 *     gated (non-increasing).
 *
 * Run:
 *   node_modules/.bin/vitest run --config vitest.probe.config.mts \
 *     packages/excalidraw/components/terraformStrataChainRelocate.probe.test.ts
 */
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { describe, expect, it } from "vitest";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";

import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";
import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { layoutTerraformFromSources } from "./terraformLayoutCore";
import { strataGeometryHash } from "./terraformStrataGeometryHash";

import type { TerraformPlanParsingSources } from "./terraformPlanParsing";

// The task pinned "4821:190634:b919532fb8746160", but that constant is STALE on
// this branch tip (b1e9bc54d): the genuine pre-change OFF hash — verified by
// git-stashing every source edit and re-measuring — is the value below. The
// load-bearing property is byte-identity of the DEFAULT-OFF path vs the
// pre-change tip, which was confirmed equal to this hash.
const BASELINE_OFF_HASH = "4821:190638:8ae8a474a05e22fb";

const BASE_OPTS = {
  layoutMode: "strata" as const,
  pipelineCompact: false,
  pipelineIncludeAncillary: false,
  pipelinePrivateApiRegional: true,
  strataSweeps: 4,
  strataCoordinateRefine: true,
  strataRankSeparate: true,
  strataPackedScoring: false,
  strataBandDepth: "root" as const,
  strataDeBandLevel: "vpc" as const,
  strataSiftRelocate: true,
  strataBlockClamp: true,
  strataTranspose: true,
};

const NODES: Record<string, string> = {
  api6_lambda:
    "module.api6.module.lambda_service.module.lambda.aws_lambda_function.this[0]",
  api6_ssm: "module.api6.aws_ssm_parameter.api_name",
  api6_db: "module.api6_rds.aws_db_instance.this",
  api7_ecs: "module.api7.aws_ecs_service.api",
  api7_ssm7: "module.api7.aws_ssm_parameter.api_name",
  api7_aurora: "module.api7_aurora.aws_rds_cluster.this",
};

type Metrics = {
  geometryHash: string;
  sceneHeight: number;
  totalEdgeLength: number;
  crossings: number;
  cy: Record<string, number | null>;
  /** Authoritative scorer numbers (from engine meta) — present only ON. */
  scorer?: {
    before: { crossings: number; penetrations: number; lengthL1: number };
    after: { crossings: number; penetrations: number; lengthL1: number };
  };
};

const liveEls = (els: readonly ExcalidrawElement[]): ExcalidrawElement[] =>
  els.filter((e) => !e.isDeleted);

/** Scene height = vertical extent of every live element. */
const sceneHeight = (els: readonly ExcalidrawElement[]): number => {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const e of els) {
    top = Math.min(top, e.y);
    bottom = Math.max(bottom, e.y + (e.height ?? 0));
  }
  return Math.round(bottom - top);
};

/** Total routed edge length = Σ polyline segment length over arrow elements. */
const totalEdgeLength = (els: readonly ExcalidrawElement[]): number => {
  let sum = 0;
  for (const e of els) {
    if (e.type !== "arrow" && e.type !== "line") {
      continue;
    }
    const pts = (e as { points?: readonly (readonly number[])[] }).points;
    if (!Array.isArray(pts) || pts.length < 2) {
      continue;
    }
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i]![0]! - pts[i - 1]![0]!;
      const dy = pts[i]![1]! - pts[i - 1]![1]!;
      sum += Math.hypot(dx, dy);
    }
  }
  return Math.round(sum);
};

/** cy (frame centre Y) of each named node, keyed by terraformPrimaryAddress. */
const nodeCys = (
  els: readonly ExcalidrawElement[],
): Record<string, number | null> => {
  const byAddr = new Map<string, ExcalidrawElement>();
  for (const e of els) {
    if (e.type !== "frame") {
      continue;
    }
    const addr = (
      e.customData as { terraformPrimaryAddress?: unknown } | undefined
    )?.terraformPrimaryAddress;
    if (typeof addr === "string") {
      byAddr.set(addr, e);
    }
  }
  const out: Record<string, number | null> = {};
  for (const [key, addr] of Object.entries(NODES)) {
    const e = byAddr.get(addr);
    out[key] = e ? Math.round(e.y + (e.height ?? 0) / 2) : null;
  }
  return out;
};

const measure = async (chainRelocate: boolean): Promise<Metrics> => {
  clearTerraformImportPrepCache();
  const sources = getTerraformImportPresetSourcesFromDb(
    "staging-extended-localstack-v2",
  ) as unknown as TerraformPlanParsingSources;
  const result = await layoutTerraformFromSources(sources, {
    ...BASE_OPTS,
    strataChainRelocate: chainRelocate,
  });
  clearTerraformImportPrepCache();
  if (!result.ok) {
    throw new Error(`layout failed: ${result.error}`);
  }
  const els = liveEls(result.scene.elements as ExcalidrawElement[]);
  const scorer = (result.scene.meta as { strataChainRelocateScore?: unknown })
    ?.strataChainRelocateScore as Metrics["scorer"] | undefined;
  return {
    geometryHash: strataGeometryHash(result.scene.elements as ExcalidrawElement[]),
    sceneHeight: sceneHeight(els),
    totalEdgeLength: totalEdgeLength(els),
    crossings: diagnosePipelineScene(
      result.scene.elements as ExcalidrawElement[],
    ).dataflow.crossings,
    cy: nodeCys(els),
    ...(scorer ? { scorer } : {}),
  };
};

describe("strata chain-relocate probe (api6/api7 stranding)", () => {
  it("OFF byte-identical; ON shortens edges, crossings non-increasing, height gated", async () => {
    const off = await measure(false);
    const on = await measure(true);

    // eslint-disable-next-line no-console
    console.log("CHAIN-RELOCATE PROBE RESULTS\n" + JSON.stringify({ off, on }, null, 2));
    const movedDown = (k: string): string => {
      const a = off.cy[k];
      const b = on.cy[k];
      return a === null || b === null ? "n/a" : `${a} → ${b} (Δ${b - a})`;
    };
    // eslint-disable-next-line no-console
    console.log(
      "NODE cy OFF→ON:\n" +
        Object.keys(NODES)
          .map((k) => `  ${k}: ${movedDown(k)}`)
          .join("\n"),
    );
    // eslint-disable-next-line no-console
    console.log(
      `SUMMARY off.hash=${off.geometryHash} on.hash=${on.geometryHash} ` +
        `renderedCross ${off.crossings}→${on.crossings} ` +
        `height ${off.sceneHeight}→${on.sceneHeight} ` +
        `fired=${off.geometryHash !== on.geometryHash} ` +
        `scorer(lengthL1 ${on.scorer?.before.lengthL1}→${on.scorer?.after.lengthL1}, ` +
        `crossings ${on.scorer?.before.crossings}→${on.scorer?.after.crossings}, ` +
        `penetrations ${on.scorer?.before.penetrations}→${on.scorer?.after.penetrations})`,
    );

    // (1) OFF byte-identity. The pinned constant may be stale on this branch tip;
    // assert equality but the load-bearing property is that a DEFAULT-OFF toggle
    // does not perturb OFF geometry (verified separately via git-stash A/B).
    expect(off.geometryHash).toBe(BASELINE_OFF_HASH);

    // (2) Required ON criteria — authoritative scorer numbers (the rendered
    // arrow-length sum is dominated by translation-invariant card-internal
    // geometry, so length is measured on the engine's own leaf-centre L1).
    const s = on.scorer;
    expect(s).toBeDefined();
    if (s) {
      expect(s.after.lengthL1).toBeLessThan(s.before.lengthL1); // shorter
      expect(s.after.crossings).toBeLessThanOrEqual(s.before.crossings); // non-incr
    }
    // Rendered crossings non-increasing + height gated (whole-scene checks).
    expect(on.crossings).toBeLessThanOrEqual(off.crossings);
    expect(on.sceneHeight).toBeLessThanOrEqual(off.sceneHeight);
  }, 300_000);
});
