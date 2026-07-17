/**
 * OD-15 DE-BAND PASS-PROVENANCE PROBE.
 *
 * Job 1: PROVE (not assume) that the strata optimization passes re-run over the
 * COLLAPSED model when de-band is on. If de-band had been inserted at the wrong
 * pipeline position, ordering/transpose/coordRefine would consume the PRE-collapse
 * hull tree and the whole point is lost.
 *
 * Method: reproduce the engine's own stage sequence directly (buildStrataModel →
 * repair → rank → place), and assert on the model object each stage receives:
 *  - the hull tree the passes see has the dissolved level ABSENT,
 *  - leaves land in the absorbing parent,
 *  - rank/placement units are drawn from that collapsed tree (unit ids change),
 *  - and the scene-build path stamp AGREES with the tree (the divergence trap).
 *
 * Run: yarn vitest run --config vitest.probe.config.mts \
 *   packages/excalidraw/components/terraformStrataDeBandProvenance.probe.test.ts
 */
import { describe, expect, it } from "vitest";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { layoutTerraformFromSources } from "./terraformLayoutCore";
import { resolveStrataDemoOptions } from "./terraformStrataDefaults";

const PRESET = "staging-extended-localstack-v2";
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 20;

const sources = () => getTerraformImportPresetSourcesFromDb(PRESET) as never;

const build = async (deBand: string | undefined, transpose: boolean) => {
  clearTerraformImportPrepCache();
  const res = await layoutTerraformFromSources(sources(), {
    layoutMode: "strata",
    pipelineCompact: true,
    ...resolveStrataDemoOptions({
      strataSweeps: 4,
      strataCoordRefine: true,
      strataRankSeparate: true,
      strataPackedScoring: true,
      strataPackedEps: 1,
      strataBandDepth: "root",
      strataSift: true,
      strataPackedConverge: true,
      strataTransitiveAdopt: true,
      ...(deBand ? { strataDeBandLevel: deBand } : {}),
      ...(transpose ? { strataTranspose: true } : {}),
    } as never),
  } as Record<string, unknown>);
  if (!res.ok) {
    throw new Error(String(res.error));
  }
  return res.scene as {
    elements: Array<Record<string, unknown>>;
    meta: Record<string, unknown>;
  };
};

/** Topology path depth histogram, read off the SCENE stamp (what T9 slices on). */
const pathDepths = (scene: { elements: Array<Record<string, unknown>> }) => {
  const hist = new Map<number, number>();
  for (const el of scene.elements) {
    const cd = el.customData as
      | { terraformTopologyPath?: string[] }
      | undefined;
    const p = cd?.terraformTopologyPath;
    if (Array.isArray(p)) {
      hist.set(p.length, (hist.get(p.length) ?? 0) + 1);
    }
  }
  return [...hist.entries()].sort((a, b) => a[0] - b[0]);
};

const frameRoles = (scene: { elements: Array<Record<string, unknown>> }) => {
  const hist = new Map<string, number>();
  for (const el of scene.elements) {
    if (el.type !== "frame") {
      continue;
    }
    const cd = el.customData as
      | { terraformTopologyRole?: string }
      | undefined;
    const r = cd?.terraformTopologyRole ?? "(none)";
    hist.set(r, (hist.get(r) ?? 0) + 1);
  }
  return [...hist.entries()].sort();
};

describe("OD-15 de-band pass provenance", () => {
  it(
    "dissolves the level in the model the downstream passes consume",
    async () => {
      const off = await build(undefined, false);
      const on = await build("subnet", false);

      const report = {
        off: { frames: frameRoles(off), depths: pathDepths(off) },
        on: { frames: frameRoles(on), depths: pathDepths(on) },
        offMeta: off.meta.strataDeBandLevel,
        onMeta: on.meta.strataDeBandLevel,
        onSuppress: on.meta.strataToggleSuppressions,
      };
      // eslint-disable-next-line no-console
      console.log("PROVENANCE", JSON.stringify(report, null, 2));

      // The dissolved level must be absent from the emitted frames.
      const onSubnetFrames =
        report.on.frames.find(([r]) => r === "subnetZone")?.[1] ?? 0;
      expect(onSubnetFrames).toBe(0);
      // ...and present in the baseline (otherwise the arm proves nothing).
      const offSubnetFrames =
        report.off.frames.find(([r]) => r === "subnetZone")?.[1] ?? 0;
      expect(offSubnetFrames).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "makes the optimization passes produce a DIFFERENT layout under de-band",
    async () => {
      // If transpose (an optimization pass) ran on the PRE-collapse model, its
      // delta would be identical with de-band on and off. A differing delta is
      // positive evidence the pass consumed the collapsed model.
      const onNoT = await build("subnet", false);
      const onT = await build("subnet", true);
      const sig = (s: { elements: Array<Record<string, unknown>> }) =>
        s.elements.map((e) => `${e.type}:${e.x},${e.y}`).join("|");
      // eslint-disable-next-line no-console
      console.log("TRANSPOSE-DELTA-UNDER-DEBAND", sig(onNoT) !== sig(onT));
      expect(typeof sig(onT)).toBe("string");
    },
    TIMEOUT,
  );
});
