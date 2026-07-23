/**
 * Integration test for pipeline view v2 on staging-extended-localstack-v2.
 *
 * Gates the v2 correctness invariants (no overlaps, TFD left-to-right order
 * preserved, deterministic) and the headline quality goal (square/flatter — not
 * taller than v1 classic stacked). Reuses diagnosePipelineScene as the scorecard.
 *
 * Run:
 *   VITEST_TERRAFORM_VERBOSE=1 yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineLayoutV2.test.ts
 */
import { describe, expect, it } from "vitest";

import graphlibDot from "@dagrejs/graphlib-dot";
import { getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { DECLARED_DATAFLOW_ORDERED_KEY } from "./terraformDeclaredDataFlow";
import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";
import { buildTerraformPipelineV2ExcalidrawScene } from "./terraformPipelineLayoutV2";
import { preparePipelineLayout } from "./terraformPipelineLayoutShared";
import {
  getTerraformResourceTypeFromNodePath,
  isPrimaryVisibleResourceType,
} from "./terraformPrimaryVisibility";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
} from "./terraformPlanParsing";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const round = (n: number) => Math.round(n * 100) / 100;

async function layout(
  presetId: string,
  options: { compact?: boolean; includeAncillary?: boolean } = {},
) {
  const raw = getTerraformImportPresetSourcesFromDb(presetId);
  const sources = resolveSourcesWithTfdComposition(
    raw! as TerraformImportPresetSources,
  );
  const bundle = sources.planDotBundles[0]!;
  const graph = graphlibDot.read("digraph G {}\n");
  const nodes = buildTerraformLocalImportNodesMap(bundle.plan, graph, [], {});
  applyTfdOverlayToNodes(nodes, sources.tfdTexts, sources.tfdLabels);
  expect(nodes[DECLARED_DATAFLOW_ORDERED_KEY]?.length ?? 0).toBeGreaterThan(0);

  // Drive the V2 builder directly — it is the Strata substrate and no longer
  // reachable through a user-facing view/variant.
  const body = await buildTerraformPipelineV2ExcalidrawScene(
    nodes,
    bundle.plan,
    options,
  );
  const elements = body.elements as ExcalidrawElement[];
  const live = elements.filter((e) => !e.isDeleted);
  const [minX, minY, maxX, maxY] = getCommonBounds(live);
  const width = round(maxX - minX);
  const height = round(maxY - minY);
  return {
    bounds: { width, height },
    aspect: round(width / Math.max(1, height)),
    elementCount: live.length,
    elements: live,
    meta: body.meta as Record<string, unknown>,
    diagnostics: diagnosePipelineScene(elements),
  };
}

/**
 * Ancillary ("Unconnected") primaryCluster frames whose primary address is a
 * primary-visible type, classified by whether they kept their grouping. The bug
 * being guarded: a primary-visible unconnected resource degrading to the bare
 * fallback card (no satellites, not expandable). A properly grouped card is
 * either expandable (compact builder / compact retry) or has nested satellites
 * (full builder).
 */
function classifyAncillaryPrimaries(elements: readonly ExcalidrawElement[]): {
  total: number;
  bare: { address: string; resourceType: string }[];
} {
  const cd = (e: ExcalidrawElement) =>
    (e.customData ?? {}) as Record<string, unknown>;
  const ancillaryFrames = elements.filter(
    (e) =>
      e.type === "frame" &&
      cd(e).terraformPipelineAncillary === true &&
      cd(e).terraformTopologyRole === "primaryCluster",
  );
  const bare: { address: string; resourceType: string }[] = [];
  for (const frame of ancillaryFrames) {
    const address = cd(frame).terraformPrimaryAddress;
    if (typeof address !== "string") {
      continue;
    }
    const resourceType = getTerraformResourceTypeFromNodePath(address);
    if (!isPrimaryVisibleResourceType(resourceType)) {
      continue; // non-primary leftovers may legitimately be bare
    }
    const members = elements.filter((e) => e.frameId === frame.id);
    const primaryCard = members.find((e) => e.id === address);
    const isExpandable =
      cd(primaryCard ?? frame).terraformPipelineExpandable === true;
    const satelliteCount = members.filter(
      (e) => e.type !== "frame" && e.id !== address,
    ).length;
    if (!isExpandable && satelliteCount === 0) {
      bare.push({ address, resourceType });
    }
  }
  return { total: ancillaryFrames.length, bare };
}

/**
 * Collisions where either side is an ancillary ("Unconnected") element — the only
 * collisions this feature could introduce. Pre-existing collisions inside the
 * dataflow regions (untouched by the grouping/strip wiring) are excluded.
 */
function ancillaryCollisions(
  scene: Awaited<ReturnType<typeof layout>>,
): { category: string; a: string; b: string }[] {
  const ancillaryIds = new Set(
    scene.elements
      .filter(
        (e) =>
          (e.customData as Record<string, unknown> | undefined)
            ?.terraformPipelineAncillary === true,
      )
      .map((e) => e.id),
  );
  return scene.diagnostics.collisions
    .filter((c) => ancillaryIds.has(c.a.id) || ancillaryIds.has(c.b.id))
    .map((c) => ({ category: c.category, a: c.a.id, b: c.b.id }));
}

describe("pipeline view v2", () => {
  it(
    "staging-extended-localstack-v2 — square, overlap-free, TFD-ordered, deterministic",
    async () => {
      const v2 = await layout("staging-extended-localstack-v2", {
        compact: true,
      });

      // eslint-disable-next-line no-console -- intentional diagnostic output
      console.log(
        `\n[pipeline:v2]\n${JSON.stringify(
          {
            v2: {
              bounds: v2.bounds,
              aspect: v2.aspect,
              sideBySideRows: v2.meta.pipelineV2SideBySideRows,
              crossings: v2.diagnostics.dataflow.crossings,
              edgeViolations: v2.diagnostics.semanticEdgeViolations.length,
              collisions: v2.diagnostics.collisionCount,
              fractionNearStraight:
                v2.diagnostics.dataflow.fractionNearStraight,
            },
          },
          null,
          2,
        )}`,
      );

      expect(v2.elementCount).toBeGreaterThan(0);

      // Correctness: no overlaps / broken hierarchies.
      expect(v2.diagnostics.collisionCount, "v2 collisions").toBe(0);

      // STRICT TFD order: the column-aware packer pins every cluster to its
      // global depth column, so no edge runs backwards — by construction.
      expect(
        v2.diagnostics.semanticEdgeViolations,
        "v2 backward TFD edges (must be zero)",
      ).toEqual([]);

      // Pure-sink fan-out bundles spill *beside* their source (elastic depth)
      // instead of stacking under it, so the drawing reads near-square.
      // (Compact lands ≈ 1:1 aspect on this preset.)
      expect(v2.aspect, "v2 reads near-square").toBeGreaterThan(0.8);

      // Determinism: a second build is byte-identical in geometry + crossings.
      const v2b = await layout("staging-extended-localstack-v2", {
        compact: true,
      });
      expect(v2b.bounds, "v2 determinism (bounds)").toEqual(v2.bounds);
      expect(
        v2b.diagnostics.dataflow.crossings,
        "v2 determinism (crossings)",
      ).toBe(v2.diagnostics.dataflow.crossings);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 4,
  );
});

describe("pipeline all-resources respects primary grouping", () => {
  it(
    "every layout keeps unconnected primaries grouped; v2 nests the strips overlap-free",
    async () => {
      const variants = ["v2"] as const;
      const scenes = {} as Record<
        typeof variants[number],
        Awaited<ReturnType<typeof layout>>
      >;
      for (const variant of variants) {
        scenes[variant] = await layout("staging-extended-localstack-v2", {
          compact: false, // Full mode — exercises the full builder + fallback path
          includeAncillary: true,
        });
      }

      const summary = Object.fromEntries(
        variants.map((variant) => {
          const scene = scenes[variant];
          const ancillary = classifyAncillaryPrimaries(scene.elements);
          return [
            variant,
            {
              ancillaryPrimaries: ancillary.total,
              barePrimaries: ancillary.bare,
              stripCount: scene.meta.pipelineAncillaryStripCount ?? 0,
              collisions: scene.diagnostics.collisionCount,
              ancillaryCollisions: ancillaryCollisions(scene),
              edgeViolations: scene.diagnostics.semanticEdgeViolations.length,
            },
          ];
        }),
      );
      // eslint-disable-next-line no-console -- intentional diagnostic output
      console.log(
        `\n[pipeline:all-resources]\n${JSON.stringify(summary, null, 2)}`,
      );

      // The preset must actually contain unconnected primary-visible resources,
      // otherwise this test proves nothing.
      expect(
        classifyAncillaryPrimaries(scenes.v2.elements).total,
        "preset has unconnected primary resources to group",
      ).toBeGreaterThan(0);

      for (const variant of variants) {
        const scene = scenes[variant];
        const ancillary = classifyAncillaryPrimaries(scene.elements);
        // The core invariant: no primary-visible unconnected resource degrades
        // to a bare fallback card — each keeps its cluster grouping.
        expect(
          ancillary.bare,
          `${variant}: primary-visible ancillary resources on the bare-fallback path`,
        ).toEqual([]);
        // Grouping/placement must not introduce overlaps involving the new
        // ancillary strips/cards (pre-existing dataflow-region collisions are
        // untouched by this feature and excluded).
        expect(
          ancillaryCollisions(scene),
          `${variant}: collisions involving ancillary elements`,
        ).toEqual([]);
        expect(
          scene.diagnostics.semanticEdgeViolations,
          `${variant}: backward TFD edges with all-resources`,
        ).toEqual([]);
      }

      // v2 must actually render the strips (the new wiring) and report them.
      expect(
        scenes.v2.meta.pipelineAncillaryStripCount,
        "v2 emitted ancillary strips",
      ).toBeGreaterThan(0);

      // D10-5 regression: v2 full (non-compact) + ancillary used to measure a
      // real "frame-title-primary-cluster" collision — a subnetZone frame's
      // title overlapping a *sibling* subnetZone's primary-cluster card, both
      // non-ancillary. `ancillaryCollisions` above doesn't catch it (neither
      // side is ancillary-flagged), so assert the full collision count for v2
      // directly. Root cause: `buildTopologyPrimaryClusterSkeletonForPipeline`
      // (the Full builder) can position its frame at a nonzero local (x, y)
      // within its own skeleton (extra satellite rows grow the frame away from
      // the (0,0) build anchor); the v2 skyline packer + frame-envelope math
      // assumed every cluster's footprint was `[0,0]→[width,height]`, silently
      // under-reserving space by exactly that offset. Fixed in
      // `terraformPipelineV2Pack.ts` (`clusterFrameLocalRect`). classic/compound
      // still show pre-existing collisions here — unrelated to this bug (they
      // don't use the v2 packer at all) and out of scope for this fix.
      expect(
        scenes.v2.diagnostics.collisionCount,
        "v2 full + ancillary: zero collisions (D10-5)",
      ).toBe(0);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 6,
  );
});

/**
 * D2′ (v3.1 §5): the optional `prep` param must not change default behavior.
 * The Strata engine's failure path passes the prep it already computed to the v2
 * substrate builder so a fallback never re-pays the ~20s skeleton build; passing
 * that prep must yield a scene byte-identical to one where v2 builds its own.
 */
describe("buildTerraformPipelineV2ExcalidrawScene — optional prep param (D2′)", () => {
  const geom = (elements: readonly ExcalidrawElement[]): string[] =>
    elements
      .filter((el) => !el.isDeleted)
      .map((el) => `${el.type}|${el.x},${el.y},${el.width},${el.height}`)
      .sort();

  it(
    "scene built with a passed-in prep === scene built without (geometry + meta)",
    async () => {
      const raw = getTerraformImportPresetSourcesFromDb(
        "staging-extended-localstack-v2",
      );
      const sources = resolveSourcesWithTfdComposition(
        raw! as TerraformImportPresetSources,
      );
      const bundle = sources.planDotBundles[0]!;
      const graph = graphlibDot.read("digraph G {}\n");
      const nodes = buildTerraformLocalImportNodesMap(
        bundle.plan,
        graph,
        [],
        {},
      );
      applyTfdOverlayToNodes(nodes, sources.tfdTexts, sources.tfdLabels);

      // adjacent builds — same process state; the only difference is prep origin
      const withoutPrep = await buildTerraformPipelineV2ExcalidrawScene(
        nodes,
        bundle.plan,
        { compact: true },
      );
      const prep = preparePipelineLayout(nodes, bundle.plan, true);
      const withPrep = await buildTerraformPipelineV2ExcalidrawScene(
        nodes,
        bundle.plan,
        { compact: true, prep },
      );

      expect(withPrep.elements.length).toBe(withoutPrep.elements.length);
      expect(geom(withPrep.elements)).toEqual(geom(withoutPrep.elements));
      expect(withPrep.meta).toEqual(withoutPrep.meta);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );
});
