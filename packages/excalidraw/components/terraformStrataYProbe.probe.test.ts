/**
 * SCRATCH read-only probe — api6 lambda / api7 ecs_service vertical stranding
 * (2026-07-17). NOT committed.
 * Run: yarn vitest run --config vitest.probe.config.mts packages/excalidraw/components/terraformStrataYProbe.probe.test.ts
 */
import { describe, it } from "vitest";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";

import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { layoutTerraformFromSources } from "./terraformLayoutCore";

const PRESET = "staging-extended-localstack-v2";

const BASE_OPTIONS: Record<string, unknown> = {
  layoutMode: "strata",
  pipelineCompact: false,
  pipelineIncludeAncillary: false,
  pipelinePrivateApiRegional: true,
  strataSweeps: 4,
  strataCoordinateRefine: true,
  strataRankSeparate: true,
  strataPackedScoring: false,
  strataBandDepth: "root",
  strataDeBandLevel: "vpc",
  strataSiftRelocate: true,
  strataBlockClamp: true,
  strataTranspose: true,
};

type El = any;

const WATCH = [
  "module.api6.module.lambda_service.module.lambda.aws_lambda_function.this[0]",
  "module.api6.aws_ssm_parameter.api_name",
  "module.api6_rds.aws_db_instance.this",
  "module.api7.aws_ecs_service.api",
  "module.api7.aws_ssm_parameter.api_name",
  "module.api7_aurora.aws_rds_cluster.this",
  "module.api6.aws_api_gateway_rest_api.private",
  "module.api7.aws_api_gateway_rest_api.private",
  "module.api8.aws_api_gateway_rest_api.private",
  "module.api9.aws_api_gateway_rest_api.private",
  "module.api12.aws_api_gateway_rest_api.private",
  "module.api15.aws_api_gateway_rest_api.private",
];

const topoKey = (id: string): string | null => {
  const m = id.match(/^tf:(?:icon|label):(.+)$/);
  if (!m) {
    return null;
  }
  return decodeURIComponent(m[1].split(":#")[0]);
};

async function run(label: string, options: Record<string, unknown>) {
  clearTerraformImportPrepCache();
  const sources = getTerraformImportPresetSourcesFromDb(PRESET);
  if (!sources) {
    throw new Error(`preset sources not found: ${PRESET}`);
  }
  const result: any = await layoutTerraformFromSources(
    // Diagnostic probe: the DB helper returns a loosely-typed sources bag that
    // is structurally sufficient at runtime for this preset.
    sources as unknown as Parameters<typeof layoutTerraformFromSources>[0],
    options,
  );
  if (!result.ok) {
    throw new Error(`layout failed: ${result.error}`);
  }
  const all: El[] = result.scene.elements ?? [];
  const live = all.filter((el: El) => !el.isDeleted);

  const boxes = new Map<
    string,
    { x0: number; y0: number; x1: number; y1: number }
  >();
  for (const el of live) {
    const key = topoKey(el.id);
    if (!key) {
      continue;
    }
    const b = boxes.get(key) ?? {
      x0: Infinity,
      y0: Infinity,
      x1: -Infinity,
      y1: -Infinity,
    };
    b.x0 = Math.min(b.x0, el.x);
    b.y0 = Math.min(b.y0, el.y);
    b.x1 = Math.max(b.x1, el.x + el.width);
    b.y1 = Math.max(b.y1, el.y + el.height);
    boxes.set(key, b);
  }
  const edges = all.filter((el: El) => el.customData?.relationship);
  let totalEuclid = 0;
  let totalL1 = 0;
  const edgeList: { s: string; t: string; len: number; dy: number }[] = [];
  for (const e of edges) {
    const pts = e.points ?? [[0, 0]];
    const last = pts[pts.length - 1];
    const dx = last[0];
    const dy = last[1];
    const len = Math.hypot(dx, dy);
    totalEuclid += len;
    totalL1 += Math.abs(dx) + Math.abs(dy);
    edgeList.push({
      s: e.customData.relationship.source,
      t: e.customData.relationship.target,
      len,
      dy: Math.round(e.y + dy) - Math.round(e.y),
    });
  }
  // suppressions + meta
  const meta =
    result.scene.appState?.pipelineLayoutMeta ?? result.scene.meta ?? {};
  // eslint-disable-next-line no-console
  console.log(
    `\n#### RUN ${label} totalEuclid=${Math.round(
      totalEuclid,
    )} totalL1=${Math.round(totalL1)} edges=${edges.length}`,
  );
  const sup = JSON.stringify(meta.strataToggleSuppressions ?? []);
  // eslint-disable-next-line no-console
  console.log(`#### ${label} suppressions=${sup}`);
  for (const k of WATCH) {
    const b = boxes.get(k);
    // eslint-disable-next-line no-console
    console.log(
      `#### ${label} NODE ${k} ${
        b
          ? `y=${Math.round(b.y0)} cy=${Math.round(
              (b.y0 + b.y1) / 2,
            )} x=${Math.round(b.x0)}`
          : "MISSING"
      }`,
    );
  }
  // key edge dys
  for (const e of edgeList) {
    if (/api6|api7/.test(e.s + e.t) && !/api16|api17/.test(e.s + e.t)) {
      // eslint-disable-next-line no-console
      console.log(
        `#### ${label} EDGE ${e.s} -> ${e.t} len=${Math.round(e.len)}`,
      );
    }
  }
  return { boxes, edges: edgeList };
}

describe("strata Y probe matrix", () => {
  it("runs matrix", async () => {
    await run("A_base", BASE_OPTIONS);
    await run("B_packedScoring", {
      ...BASE_OPTIONS,
      strataPackedScoring: true,
    });
    await run("C_packedScoring_eps4", {
      ...BASE_OPTIONS,
      strataPackedScoring: true,
      strataPackedScoringEpsilon: 4,
    });
    await run("D_leafShift", { ...BASE_OPTIONS, strataLeafShift: true });
  }, 1800000);
});
