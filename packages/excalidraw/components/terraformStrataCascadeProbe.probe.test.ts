/**
 * PROBE 4 measurement harness — strataCoordCascade (A) + strataClusterHeadMedian (B).
 *
 * Runs the exact diagnosed preset+options through the real app path
 * (layoutTerraformFromSources) and prints scene height, total routed edge length,
 * geometryHash, target-node cys, and crossings for OFF / A / B / A+B.
 *
 * yarn vitest run --config vitest.probe.config.mts \
 *   packages/excalidraw/components/terraformStrataCascadeProbe.probe.test.ts
 */
import { describe, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";

import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";
import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { layoutTerraformFromSources } from "./terraformLayoutCore";
import { strataGeometryHash } from "./terraformStrataGeometryHash";

import type { TerraformPlanParsingSources } from "./terraformPlanParsing";

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

const sources = () =>
  getTerraformImportPresetSourcesFromDb(
    PRESET,
  ) as unknown as TerraformPlanParsingSources;

const sceneHeight = (els: readonly ExcalidrawElement[]): number => {
  let min = Infinity;
  let max = -Infinity;
  for (const el of els) {
    if (el.isDeleted) {
      continue;
    }
    min = Math.min(min, el.y);
    max = Math.max(max, el.y + (el.height ?? 0));
  }
  return Math.round(max - min);
};

// Total ROUTED dataflow edge length (L1 approximation via polyline segments).
// Only true dataflow arrows count — those carrying a `customData.relationship`
// with source+target (the SAME predicate diagnosePipelineScene uses). Icon-glyph
// arrows inside cards are excluded (they move rigidly with the card, so summing
// them yields a position-invariant constant that masks real routing changes).
const dataflowLength = (
  els: readonly ExcalidrawElement[],
): { l2: number; l1: number; count: number } => {
  let l2 = 0;
  let l1 = 0;
  let count = 0;
  for (const el of els) {
    // NOTE: dataflow arrows are tombstoned (isDeleted) in the strata scene but
    // carry valid geometry — diagnosePipelineScene measures them regardless, so
    // the length metric must NOT skip isDeleted (matching the crossings metric).
    if (el.type !== "arrow") {
      continue;
    }
    const rel = (el.customData as { relationship?: Record<string, unknown> })
      ?.relationship;
    if (
      !rel ||
      typeof rel.source !== "string" ||
      typeof rel.target !== "string" ||
      rel.aggregated === true
    ) {
      continue;
    }
    const pts = (el as unknown as { points?: number[][] }).points;
    if (!Array.isArray(pts) || pts.length < 2) {
      continue;
    }
    count++;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i]![0]! - pts[i - 1]![0]!;
      const dy = pts[i]![1]! - pts[i - 1]![1]!;
      l2 += Math.hypot(dx, dy);
      l1 += Math.abs(dx) + Math.abs(dy);
    }
  }
  return { l2: Math.round(l2), l1: Math.round(l1), count };
};

const nodeCy = (
  els: readonly ExcalidrawElement[],
  match: (addr: string) => boolean,
): { cy: number; y: number; h: number; addr: string } | undefined => {
  for (const el of els) {
    if (el.isDeleted || el.type !== "rectangle") {
      continue;
    }
    const cd = el.customData as Record<string, unknown> | undefined;
    if (!cd) {
      continue;
    }
    const addr = (cd.terraformVisibilityKey as string) ?? "";
    // Card nodes carry a visibilityKey; frames carry terraformPrimaryAddress but
    // no visibilityKey — so keying on visibilityKey selects the card, not frame.
    if (typeof addr === "string" && addr.length > 0 && match(addr)) {
      return {
        cy: Math.round(el.y + (el.height ?? 0) / 2),
        y: Math.round(el.y),
        h: Math.round(el.height ?? 0),
        addr,
      };
    }
  }
  return undefined;
};

// The api6 primary is a lambda; api7 primary is an ecs_service. Match the PRIMARY
// card (not the tf-topo:sat: satellites, which have a different key prefix).
const isLambda6 = (a: string) =>
  a.includes("api6") &&
  a.includes("aws_lambda_function") &&
  !a.startsWith("tf-topo:");
const isEcs7 = (a: string) =>
  a.includes("api7") &&
  a.includes("aws_ecs_service") &&
  !a.startsWith("tf-topo:");

const run = async (extra: Record<string, unknown>) => {
  clearTerraformImportPrepCache();
  const result = await layoutTerraformFromSources(sources(), {
    ...BASE_OPTIONS,
    ...extra,
  } as never);
  clearTerraformImportPrepCache();
  if (!result.ok) {
    throw new Error(`layout failed: ${result.error}`);
  }
  const els = result.scene.elements as ExcalidrawElement[];
  const live = els.filter((el) => !el.isDeleted);
  const dl = dataflowLength(els);
  return {
    hash: strataGeometryHash(els),
    count: live.length,
    height: sceneHeight(els),
    edgeL1: dl.l1,
    edgeL2: dl.l2,
    edgeCount: dl.count,
    crossings: diagnosePipelineScene(els).dataflow.crossings,
    lambda: nodeCy(els, isLambda6),
    ecs: nodeCy(els, isEcs7),
    els,
  };
};

const summarize = (r: Awaited<ReturnType<typeof run>>) => ({
  hash: r.hash,
  count: r.count,
  height: r.height,
  edgeL1: r.edgeL1,
  edgeL2: r.edgeL2,
  edgeCount: r.edgeCount,
  crossings: r.crossings,
  lambdaCy: r.lambda?.cy,
  ecsCy: r.ecs?.cy,
});

describe("PROBE4 cascade/head-median measurement", () => {
  it("dumps OFF baseline + node addresses", async () => {
    const off = await run({});
    // eslint-disable-next-line no-console
    console.log("OFF", JSON.stringify(summarize(off)));

    // Arrow representation diagnostic: how many arrows, how many carry >=2
    // points, distribution of point counts.
    let arrows = 0;
    let withPts = 0;
    let ptSum = 0;
    const ptCounts: Record<number, number> = {};
    for (const el of off.els) {
      if (el.isDeleted || (el.type !== "arrow" && el.type !== "line")) {
        continue;
      }
      arrows++;
      const pts = (el as unknown as { points?: number[][] }).points;
      const n = Array.isArray(pts) ? pts.length : 0;
      ptCounts[n] = (ptCounts[n] ?? 0) + 1;
      if (n >= 2) {
        withPts++;
        ptSum += n;
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      "ARROWDIAG",
      JSON.stringify({
        arrows,
        withPts,
        avgPts: withPts ? ptSum / withPts : 0,
        ptCounts,
      }),
    );
    let withRel = 0;
    let glyphs = 0;
    let noCd = 0;
    const relKeySets = new Set<string>();
    for (const el of off.els) {
      if (el.isDeleted || el.type !== "arrow") {
        continue;
      }
      const cd = el.customData as Record<string, unknown> | undefined;
      if (!cd) {
        noCd++;
        continue;
      }
      if ("terraformAwsIconGlyph" in cd) {
        glyphs++;
        continue;
      }
      if ("relationship" in cd) {
        withRel++;
        if (relKeySets.size < 3) {
          relKeySets.add(JSON.stringify(cd.relationship));
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      "ARROWCLASS",
      JSON.stringify({ withRel, glyphs, noCd, sampleRel: [...relKeySets] }),
    );
    const typeHist: Record<string, number> = {};
    for (const el of off.els) {
      if (el.isDeleted) {
        continue;
      }
      typeHist[el.type] = (typeHist[el.type] ?? 0) + 1;
    }
    const diag = diagnosePipelineScene(off.els as ExcalidrawElement[]);
    // eslint-disable-next-line no-console
    console.log(
      "SCENEDIAG",
      JSON.stringify({
        typeHist,
        tfdArrowCount: diag.dataflow.tfdArrowCount,
        crossings: diag.dataflow.crossings,
        meanVDev: Math.round(diag.dataflow.meanVerticalDeviationPx),
        medianVDev: Math.round(diag.dataflow.medianVerticalDeviationPx),
        nearStraight: diag.dataflow.fractionNearStraight,
      }),
    );

    // ── Fix B feasibility: dump the api7 ecs cluster frame + its member cards
    // (head + satellites) with y positions, to gauge slack for a head shift.
    for (const fr of off.els) {
      if (fr.isDeleted || fr.type !== "frame") {
        continue;
      }
      const fcd = fr.customData as Record<string, unknown> | undefined;
      const pa = fcd?.terraformPrimaryAddress as string | undefined;
      if (!pa || !(pa.includes("api7") && pa.includes("ecs_service"))) {
        continue;
      }
      // eslint-disable-next-line no-console
      console.log(
        "B_FRAME",
        JSON.stringify({
          primary: pa,
          frameY: Math.round(fr.y),
          frameH: Math.round(fr.height ?? 0),
          frameBottom: Math.round(fr.y + (fr.height ?? 0)),
        }),
      );
      const members: Array<{ t: string; y: number; h: number; k: string }> = [];
      for (const m of off.els) {
        if (m.isDeleted || m.frameId !== fr.id) {
          continue;
        }
        const mcd = m.customData as Record<string, unknown> | undefined;
        members.push({
          t: m.type,
          y: Math.round(m.y),
          h: Math.round(m.height ?? 0),
          k: String(
            mcd?.terraformVisibilityKey ?? mcd?.terraformAwsIconGlyph ?? "",
          ).slice(0, 30),
        });
      }
      members.sort((a, b) => a.y - b.y);
      // eslint-disable-next-line no-console
      console.log(
        "B_MEMBERS",
        JSON.stringify(members.filter((m) => m.t === "rectangle")),
      );
      break;
    }

    const seen = new Set<string>();
    for (const el of off.els) {
      if (el.isDeleted || el.type !== "rectangle") {
        continue;
      }
      const cd = el.customData as Record<string, unknown> | undefined;
      const addr =
        (cd?.terraformVisibilityKey as string) ??
        (cd?.terraformPrimaryAddress as string) ??
        "";
      if (
        typeof addr === "string" &&
        /api6|api7|lambda|ecs_service|ssm_parameter|aurora|api8|api15|api9/.test(
          addr,
        )
      ) {
        if (!seen.has(addr)) {
          seen.add(addr);
          // eslint-disable-next-line no-console
          console.log("NODE", Math.round(el.y + (el.height ?? 0) / 2), addr);
        }
      }
    }
  }, 600_000);

  it("A/B/AB comparison", async () => {
    const off = await run({});
    const a = await run({ strataCoordCascade: true });
    const b = await run({ strataClusterHeadMedian: true });
    const ab = await run({
      strataCoordCascade: true,
      strataClusterHeadMedian: true,
    });
    // eslint-disable-next-line no-console
    console.log("OFF", JSON.stringify(summarize(off)));
    // eslint-disable-next-line no-console
    console.log("A  ", JSON.stringify(summarize(a)));
    // eslint-disable-next-line no-console
    console.log("B  ", JSON.stringify(summarize(b)));
    // eslint-disable-next-line no-console
    console.log("AB ", JSON.stringify(summarize(ab)));
  }, 600_000);
});
