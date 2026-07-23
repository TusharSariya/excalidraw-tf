/* eslint-disable max-lines */
/**
 * Strata threading test — pattern: `terraformLayoutCoreRcllThreading.test.ts`.
 *
 * The M1a Strata engine now runs behind the §5 failure contract (WP-2c);
 * `buildTerraformStrataExcalidrawScene` no longer delegates verbatim to v2.
 * This proves the end-to-end wiring through `layoutTerraformFromSources` (the
 * worker/headless path the app actually uses):
 *   - a URL/dialog-set "strata" variant reaches the engine (not a stale mis-route
 *     to "classic" — the `sceneContext` literal is the one seam where an option
 *     not listed there is silently dropped, trap #4)
 *   - scene meta echoes the Strata identity (`pipelineLayoutVariant: "strata"`,
 *     `pipelineVariant: "strata"`), the `strataPassthrough` marker is GONE (the
 *     passthrough was removed with the engine), and on this preset the engine
 *     runs to completion (no `rcllV2Degraded`)
 *   - the three future-engine flags echo end-to-end (accepted-and-threaded),
 *     default off/0 — surfaced on BOTH the success and the degraded meta
 *   - "honest packing meta" (owner decision SDEC-26): `pipelineColumnPackingInert`
 *     fires for Strata exactly like every non-rcll variant, and is absent on rcll
 *   - ancillary is deferred at M1 (extraction-free) and echoed honestly
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";

import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { layoutTerraformFromSources } from "./terraformLayoutCore";

import type { TerraformPlanParsingSources } from "./terraformPlanParsing";

const v2Sources = () =>
  getTerraformImportPresetSourcesFromDb(
    "staging-extended-localstack-v2",
  ) as unknown as TerraformPlanParsingSources;

/** Geometry-only fingerprint (ids/seeds/versions are non-deterministic across
 * builds in the same process — see the canonicalize() comment in the rcll
 * threading test for why). Sorted so element ORDER differences don't matter.
 *
 * Deliberately does NOT filter `isDeleted`: the headless import pins every edge
 * layer OFF, so 161/164 TFD arrows arrive soft-deleted. Filtering them would
 * shrink a byte-identity check to the ~3 visible arrows and let a mutated (but
 * still-hidden) routed polyline slip through. Both sides of every identity
 * comparison carry the same deleted set, so including them is sound. */
const geometryTuples = (elements: readonly ExcalidrawElement[]): string[] =>
  elements.map((el) => `${el.x},${el.y},${el.width},${el.height}`).sort();

/** Arrow polyline fingerprint: origin + every relative point + the routed
 * marker. Stronger than geometryTuples (which sees only the bbox), so a
 * default-off byte-identity check catches a mutated polyline that leaves the
 * bounding box unchanged. Includes soft-deleted arrows for the same reason
 * geometryTuples does — the routed TFD arrows the strata togs reshape arrive
 * `isDeleted` on the headless path, so filtering them out compared only ~3 of
 * 164 arrows (identity-fingerprint vacuity, wave-1 hardening item 2). */
const arrowPolySignatures = (
  elements: readonly ExcalidrawElement[],
): string[] =>
  elements
    .filter((el) => el.type === "arrow")
    .map((el) => {
      const pts =
        (el as unknown as { points?: ReadonlyArray<readonly number[]> })
          .points ?? [];
      const cd = el.customData as Record<string, unknown> | undefined;
      const marker = cd?.terraformRoutedPolyline === true ? "R" : "-";
      return `${el.x},${el.y}|${pts
        .map((p) => p.join(":"))
        .join(";")}|${marker}`;
    })
    .sort();

/** Container-frame count. De-band's whole mechanism is that a dissolved hull is
 * never created, so no frame is ever emitted for it. */
const frameCount = (elements: readonly ExcalidrawElement[]): number =>
  elements.filter((el) => !el.isDeleted && el.type === "frame").length;

type Scene = { elements: ExcalidrawElement[]; meta: Record<string, unknown> };

const buildStrata = async (opts: Record<string, unknown> = {}) => {
  const result = await layoutTerraformFromSources(v2Sources(), {
    layoutMode: "strata",
    pipelineCompact: true,
    ...opts,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.scene as Scene;
};

const buildV2 = async (opts: Record<string, unknown> = {}) => {
  const result = await layoutTerraformFromSources(v2Sources(), {
    layoutMode: "pipeline",
    pipelineLayoutVariant: "v2",
    pipelineCompact: true,
    ...opts,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.scene as Scene;
};

const buildRcll = async (opts: Record<string, unknown> = {}) => {
  const result = await layoutTerraformFromSources(v2Sources(), {
    layoutMode: "rcll",
    pipelineCompact: true,
    ...opts,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.scene as Scene;
};

describe("layoutTerraformFromSources — Strata (S0a) threading", () => {
  // Hermetic isolation: the import prep cache (terraformImportPrepCache.ts) is
  // session-global and keyed on preset/flag, so a sibling test running in the
  // same vitest worker can leave a stale enriched-placement/prep entry that
  // this file's `layoutTerraformFromSources` calls would reuse — surfacing here
  // as a spurious `rcllV2Degraded` (a foreign stage's finalize object). Clear it
  // before AND after every test so each build re-derives from its own sources
  // and no cross-test placement can leak in (also leaves the cache clean for
  // whoever runs next in the worker).
  beforeEach(() => {
    clearTerraformImportPrepCache();
  });
  afterEach(() => {
    clearTerraformImportPrepCache();
  });

  it(
    "a strata-set variant reaches the engine (dispatch, not a stale mis-route to classic)",
    async () => {
      const strata = await buildStrata();
      expect(strata.meta.pipelineLayoutVariant).toBe("strata");
      // The passthrough is gone: the Strata engine now emits its OWN identity.
      expect(strata.meta.strataPassthrough).toBeUndefined();
      expect(strata.meta.pipelineVariant).toBe("strata");
      // On this preset the engine runs to completion — no degraded fallback.
      expect(strata.meta.rcllV2Degraded).toBeUndefined();
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 6,
  );

  it(
    "echoes the three future-engine flags end-to-end (URL/dialog → sceneContext → builder → meta), default off/0",
    async () => {
      const off = await buildStrata();
      expect(off.meta.strataNetworkSimplexRank).toBe(false);
      expect(off.meta.strataSweeps).toBe(0);
      expect(off.meta.strataCoordinateRefine).toBe(false);

      const on = await buildStrata({
        strataNetworkSimplexRank: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(on.meta.strataNetworkSimplexRank).toBe(true);
      expect(on.meta.strataSweeps).toBe(4);
      expect(on.meta.strataCoordinateRefine).toBe(true);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 6,
  );

  it(
    "threads strataPackedScoringEpsilon end-to-end (sceneContext literal -> engine -> meta echo + effective delta)",
    async () => {
      // Epsilon rides only with the scorer; the URL/dialog path sends both.
      const on = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataPackedScoring: true,
        strataPackedScoringEpsilon: 1,
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();
      expect(on.meta.strataPackedScoring).toBe(true);
      // Both the flag echo and the packed-scoring block carry the epsilon.
      expect(on.meta.strataPackedScoringEpsilon).toBe(1);
      expect(on.meta.strataPackedScoringEffectiveDelta).toBe(1);

      // Epsilon 0 (or absent) keeps the strict rule: the pre-W8b engine
      // emitted neither echo key, so the ε=0 path must stay bit-identical
      // at the meta level — both keys are ABSENT, not present-with-0.
      const strict = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataPackedScoring: true,
      });
      expect(strict.meta.strataPackedScoringEpsilon).toBeUndefined();
      expect(strict.meta.strataPackedScoringEffectiveDelta).toBeUndefined();
      expect(strict.meta.strataPackedScoringFrontierTrials).toBeUndefined();

      // The W8b frontier dev seam echoes per-trial records when requested.
      const frontier = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataPackedScoring: true,
        strataPackedFrontierMeta: true,
      });
      const trials = frontier.meta.strataPackedScoringFrontierTrials as Array<{
        hullId: string;
        candidateIndex: number;
        pass: number;
        score: { crossings: number; penetrations: number; lengthL1: number };
        adopted: boolean;
      }>;
      expect(Array.isArray(trials)).toBe(true);
      expect(trials.length).toBe(frontier.meta.strataPackedScoringTrials);
      expect(trials[0]!.hullId).toBe("__baseline__");
      expect(trials[0]!.adopted).toBe(true);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );

  it(
    "threads strataEdgeRouting end-to-end (sceneContext literal -> scene build -> meta echo + routed counts)",
    async () => {
      const on = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataEdgeRouting: true,
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();
      expect(on.meta.strataEdgeRouting).toBe(true);
      // The scene-build pass ran and reported its counters (numbers, and on
      // this preset the W7 penetration counts guarantee eligible edges exist).
      expect(typeof on.meta.strataEdgeRoutingRouted).toBe("number");
      expect(typeof on.meta.strataEdgeRoutingUnroutable).toBe("number");
      expect(typeof on.meta.strataEdgeRoutingWaypoints).toBe("number");
      expect(
        (on.meta.strataEdgeRoutingRouted as number) +
          (on.meta.strataEdgeRoutingUnroutable as number),
      ).toBeGreaterThan(0);
      // Routed arrows carry interior waypoints (>2 points) in the final scene.
      if ((on.meta.strataEdgeRoutingRouted as number) > 0) {
        expect(on.meta.strataEdgeRoutingWaypoints).toBeGreaterThan(0);
        const multiPoint = on.elements.filter((el) => {
          if (el.type !== "arrow") {
            return false;
          }
          const cd = el.customData as Record<string, unknown> | undefined;
          const rel = cd?.relationship as Record<string, unknown> | undefined;
          return (
            typeof rel?.source === "string" &&
            rel?.aggregated !== true &&
            cd?.terraformRoutedPolyline === true &&
            ((el as unknown as { points?: unknown[] }).points?.length ?? 0) > 2
          );
        });
        expect(multiPoint.length).toBe(on.meta.strataEdgeRoutingRouted);
      }

      // Flag off (default): no routing meta keys, and geometry of the frames
      // is unchanged by threading the option surface (byte-identity of the
      // flag-off scene is separately pinned by the W5/W7/W8/W8b regenerations).
      const off = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(off.meta.strataEdgeRouting).toBeUndefined();
      expect(off.meta.strataEdgeRoutingRouted).toBeUndefined();
      expect(off.meta.strataEdgeRoutingUnroutable).toBeUndefined();
      expect(off.meta.strataEdgeRoutingWaypoints).toBeUndefined();
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );

  it(
    "threads strataBorderRoute end-to-end (sceneContext literal -> scene build -> meta echo + P3 exit counts)",
    async () => {
      const on = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBorderRoute: true,
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();
      expect(on.meta.strataBorderRoute).toBe(true);
      // The scene-build pass ran and reported its counters.
      expect(typeof on.meta.strataBorderRouteRouted).toBe("number");
      expect(typeof on.meta.strataBorderRouteUnclean).toBe("number");
      expect(typeof on.meta.strataBorderRouteNoGain).toBe("number");
      expect(typeof on.meta.strataBorderRouteWaypoints).toBe("number");
      expect(typeof on.meta.strataBorderRouteInteriorLenSavedL1).toBe("number");
      expect(typeof on.meta.strataBorderRouteMaxWaypointPerpDev).toBe("number");
      // Some TFD arrow leaves its own container on this preset (region-level
      // sinks fed from inside a VPC), so at least one edge is a candidate.
      expect(
        (on.meta.strataBorderRouteRouted as number) +
          (on.meta.strataBorderRouteUnclean as number) +
          (on.meta.strataBorderRouteNoGain as number),
      ).toBeGreaterThan(0);
      // Routed exits carry interior waypoints (>2 points), a positive saving,
      // and the polyline marker — one multi-point arrow per routed edge.
      if ((on.meta.strataBorderRouteRouted as number) > 0) {
        expect(on.meta.strataBorderRouteWaypoints).toBeGreaterThan(0);
        expect(
          on.meta.strataBorderRouteInteriorLenSavedL1 as number,
        ).toBeGreaterThan(0);
        const routedPolys = on.elements.filter((el) => {
          if (el.type !== "arrow") {
            return false;
          }
          const cd = el.customData as Record<string, unknown> | undefined;
          const rel = cd?.relationship as Record<string, unknown> | undefined;
          return (
            typeof rel?.source === "string" &&
            rel?.aggregated !== true &&
            cd?.terraformRoutedPolyline === true &&
            ((el as unknown as { points?: unknown[] }).points?.length ?? 0) > 2
          );
        });
        expect(routedPolys.length).toBeGreaterThanOrEqual(
          on.meta.strataBorderRouteRouted as number,
        );
      }

      // Flag off (default): no border-route meta keys.
      const off = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(off.meta.strataBorderRoute).toBeUndefined();
      expect(off.meta.strataBorderRouteRouted).toBeUndefined();
      expect(off.meta.strataBorderRouteUnclean).toBeUndefined();
      expect(off.meta.strataBorderRouteNoGain).toBeUndefined();
      expect(off.meta.strataBorderRouteWaypoints).toBeUndefined();
      expect(off.meta.strataBorderRouteInteriorLenSavedL1).toBeUndefined();
      expect(off.meta.strataBorderRouteMaxWaypointPerpDev).toBeUndefined();

      // Default-off byte-identity: flag ABSENT and flag explicit-false produce
      // geometry identical to today's baseline (the module never runs). Checked
      // at the bbox AND the polyline level so a mutated waypoint that preserved
      // the bounding box could not slip through.
      const explicitFalse = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBorderRoute: false,
      });
      expect(geometryTuples(explicitFalse.elements)).toEqual(
        geometryTuples(off.elements),
      );
      expect(arrowPolySignatures(explicitFalse.elements)).toEqual(
        arrowPolySignatures(off.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );

  it(
    "threads strataEdgeStyle end-to-end (sceneContext + builderOptions literals -> scene build -> meta echo + styled counts; default byte-identical)",
    async () => {
      const off = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(off.meta.rcllV2Degraded).toBeUndefined();
      // Default "straight": no style meta keys emitted (byte-identical off).
      expect(off.meta.strataEdgeStyle).toBeUndefined();
      expect(off.meta.strataEdgeStyleStyled).toBeUndefined();
      // M3 curve-flatten telemetry: the routed keep/flatten keys are ABSENT on
      // the default/"straight" scene (nothing stamped ⇒ routedSeen 0 ⇒ meta
      // byte-identical to pre-M3), including the by-provenance breakdowns.
      expect(off.meta.strataRoutedPolylinesKept).toBeUndefined();
      expect(off.meta.strataRoutedPolylinesFlattened).toBeUndefined();
      expect(off.meta.strataRoutedPolylinesKeptBy).toBeUndefined();
      expect(off.meta.strataRoutedPolylinesFlattenedBy).toBeUndefined();
      expect(off.meta.strataRoutedPolylinesUnresolved).toBeUndefined();

      const step = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataEdgeStyle: "step",
      });
      expect(step.meta.rcllV2Degraded).toBeUndefined();
      // Survived BOTH literals (sceneContext + builderOptions) → engine echo.
      expect(step.meta.strataEdgeStyle).toBe("step");
      expect(typeof step.meta.strataEdgeStyleStyled).toBe("number");
      expect(step.meta.strataEdgeStyleStyled as number).toBeGreaterThan(0);
      // Styled arrows carry a multi-point routed polyline in the final scene.
      const styledArrows = step.elements.filter((el) => {
        if (el.type !== "arrow") {
          return false;
        }
        const cd = el.customData as Record<string, unknown> | undefined;
        const rel = cd?.relationship as Record<string, unknown> | undefined;
        return (
          typeof rel?.source === "string" &&
          rel?.aggregated !== true &&
          cd?.terraformRoutedPolyline === true &&
          ((el as unknown as { points?: unknown[] }).points?.length ?? 0) > 2
        );
      });
      expect(styledArrows.length).toBeGreaterThan(0);

      const curve = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataEdgeStyle: "curve",
      });
      expect(curve.meta.strataEdgeStyle).toBe("curve");
      expect(curve.meta.strataEdgeStyleStyled as number).toBeGreaterThan(0);

      // M3 curve-flatten telemetry: under "curve" the scene meta carries both
      // numeric routed keys, and repair KEEPS every styled polyline (M2 fix) —
      // kept === styled, flattened === 0. This is the permanent, app-observable
      // proof of the styled-vs-survived gap the M2 bug shipped blind. The clean
      // scene also carries the by-provenance breakdown, all under "style".
      expect(typeof curve.meta.strataRoutedPolylinesKept).toBe("number");
      expect(typeof curve.meta.strataRoutedPolylinesFlattened).toBe("number");
      expect(curve.meta.strataRoutedPolylinesKept).toBe(
        curve.meta.strataEdgeStyleStyled,
      );
      expect(curve.meta.strataRoutedPolylinesFlattened).toBe(0);
      expect(curve.meta.strataRoutedPolylinesKeptBy).toEqual({
        style: curve.meta.strataEdgeStyleStyled,
      });
      expect(curve.meta.strataRoutedPolylinesFlattenedBy).toEqual({});
      // Unresolved is packed only when nonzero — a clean import has none.
      expect(curve.meta.strataRoutedPolylinesUnresolved).toBeUndefined();

      // Explicit "straight" is byte-identical to the flag-off scene (the module
      // never runs), checked at bbox AND polyline level.
      const explicitStraight = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataEdgeStyle: "straight",
      });
      expect(geometryTuples(explicitStraight.elements)).toEqual(
        geometryTuples(off.elements),
      );
      expect(arrowPolySignatures(explicitStraight.elements)).toEqual(
        arrowPolySignatures(off.elements),
      );
      // Explicit "straight" also emits none of the M3 routed keys (byte-identical
      // meta): the pass never runs, so routedSeen stays 0.
      expect(explicitStraight.meta.strataRoutedPolylinesKept).toBeUndefined();
      expect(
        explicitStraight.meta.strataRoutedPolylinesFlattened,
      ).toBeUndefined();
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );

  it(
    "threads strataChannelRoute end-to-end (both silent-drop literals -> scene build -> meta echo + routed counts; default-off byte-identical)",
    async () => {
      const off = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(off.meta.rcllV2Degraded).toBeUndefined();
      // Default off: no channel-route meta keys emitted (byte-identical off).
      expect(off.meta.strataChannelRoute).toBeUndefined();
      expect(off.meta.strataChannelRouteRouted).toBeUndefined();

      const on = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataChannelRoute: true,
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();
      // Survived BOTH silent-drop literals (sceneContext + builderOptions) →
      // engine echo, and the pass actually rewrote inter-rank edges.
      expect(on.meta.strataChannelRoute).toBe(true);
      expect(typeof on.meta.strataChannelRouteRouted).toBe("number");
      expect(on.meta.strataChannelRouteRouted as number).toBeGreaterThan(0);
      expect(typeof on.meta.strataChannelRouteColumns).toBe("number");
      expect(on.meta.strataChannelRouteColumns as number).toBeGreaterThan(1);
      // Routed arrows carry a multi-point stamped polyline in the final scene.
      const routedArrows = on.elements.filter((el) => {
        if (el.type !== "arrow") {
          return false;
        }
        const cd = el.customData as Record<string, unknown> | undefined;
        const rel = cd?.relationship as Record<string, unknown> | undefined;
        return (
          typeof rel?.source === "string" &&
          rel?.aggregated !== true &&
          cd?.terraformRoutedPolyline === true &&
          ((el as unknown as { points?: unknown[] }).points?.length ?? 0) > 2
        );
      });
      expect(routedArrows.length).toBeGreaterThan(0);

      // Explicit false is byte-identical to the flag-off scene (the module never
      // runs), checked at bbox AND polyline level.
      const explicitFalse = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataChannelRoute: false,
      });
      expect(geometryTuples(explicitFalse.elements)).toEqual(
        geometryTuples(off.elements),
      );
      expect(arrowPolySignatures(explicitFalse.elements)).toEqual(
        arrowPolySignatures(off.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );

  it(
    'threads strataEdgeClip end-to-end (both silent-drop literals -> scene build -> meta echo + clipped counts + terraformRoutedBy:"clip" stamps; default-off byte-identical)',
    async () => {
      const off = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(off.meta.rcllV2Degraded).toBeUndefined();
      // Default off: no clip meta keys emitted (byte-identical off).
      expect(off.meta.strataEdgeClip).toBeUndefined();
      expect(off.meta.strataEdgeClipClipped).toBeUndefined();
      expect(off.meta.strataEdgeClipPortFaces).toBeUndefined();

      const on = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataEdgeClip: true,
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();
      // Survived BOTH silent-drop literals (sceneContext + builderOptions) →
      // engine echo, and the pass actually clipped eligible net-forward edges.
      expect(on.meta.strataEdgeClip).toBe(true);
      expect(typeof on.meta.strataEdgeClipClipped).toBe("number");
      expect(on.meta.strataEdgeClipClipped as number).toBeGreaterThan(0);
      expect(typeof on.meta.strataEdgeClipPortFaces).toBe("number");
      // Clipped arrows carry the clip provenance stamp in the final scene.
      const clippedArrows = on.elements.filter((el) => {
        if (el.type !== "arrow") {
          return false;
        }
        const cd = el.customData as Record<string, unknown> | undefined;
        const rel = cd?.relationship as Record<string, unknown> | undefined;
        return (
          typeof rel?.source === "string" &&
          rel?.aggregated !== true &&
          cd?.terraformRoutedPolyline === true &&
          cd?.terraformRoutedBy === "clip"
        );
      });
      expect(clippedArrows.length).toBeGreaterThan(0);

      // Explicit false is byte-identical to the flag-off scene (the module never
      // runs), checked at bbox AND polyline level.
      const explicitFalse = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataEdgeClip: false,
      });
      expect(geometryTuples(explicitFalse.elements)).toEqual(
        geometryTuples(off.elements),
      );
      expect(arrowPolySignatures(explicitFalse.elements)).toEqual(
        arrowPolySignatures(off.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );

  it(
    "COMPOSED strataEdgeClip + strataEdgeRouting: edgeRouting yields to the clip first-stamper (keptBy.clip===145, no route re-stamp) — loop-2 P0",
    async () => {
      // Loop-2 P0 protocol at the E2E seam. Clip runs FIRST and owns its
      // eligible edges; when strataEdgeRouting is ALSO on, edgeRouting must SKIP
      // every clip-stamped edge (the `terraformRoutedPolyline` first-stamper
      // guard added in the loop-2 fix round). Without that guard, edgeRouting
      // silently RE-ROUTED 46/145 clip edges — repair then attributed them to
      // "route" (keptBy.clip drops to ~99, keptBy.route appears), overwriting the
      // clip provenance and stranding stale clip anchors.
      // compact:false = the owner-full arm where the whole 145-edge declared
      // population is clip-owned (compact packs to 135; the P0 invariant below
      // holds under both, but 145 is the owner arm the loop-2 measurement used).
      const clipAlone = await buildStrata({
        pipelineCompact: false,
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataEdgeClip: true,
      });
      const composed = await buildStrata({
        pipelineCompact: false,
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataEdgeClip: true,
        strataEdgeRouting: true,
      });
      expect(clipAlone.meta.rcllV2Degraded).toBeUndefined();
      expect(composed.meta.rcllV2Degraded).toBeUndefined();
      // Both flags survived their silent-drop literals.
      expect(composed.meta.strataEdgeClip).toBe(true);
      expect(composed.meta.strataEdgeRouting).toBe(true);

      const clipAloneKeptBy = clipAlone.meta
        .strataRoutedPolylinesKeptBy as Record<string, number>;
      const composedKeptBy = composed.meta
        .strataRoutedPolylinesKeptBy as Record<string, number>;
      const composedFlattenedBy = (composed.meta
        .strataRoutedPolylinesFlattenedBy ?? {}) as Record<string, number>;

      // The whole declared-dataflow population (145) is owned by clip, and
      // composing edgeRouting does NOT reduce that — edgeRouting re-stamps none
      // of them (the P0 pin).
      expect(clipAloneKeptBy.clip).toBe(145);
      expect(composedKeptBy.clip).toBe(145);
      expect(composedKeptBy.clip).toBe(clipAloneKeptBy.clip);
      // edgeRouting stamped nothing (it skipped every clip edge): no "route"
      // provenance survives repair, and its own routed count is 0.
      expect(composedKeptBy.route ?? 0).toBe(0);
      expect(composed.meta.strataEdgeRoutingRouted).toBe(0);
      // Clip polylines are never flattened by repair (typed frame-face gate).
      expect(composedFlattenedBy.clip ?? 0).toBe(0);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );

  it(
    "threads strataEdgeSmooth end-to-end (both silent-drop literals -> scene build -> meta echo + smoothing counters + roundness:null; default-off byte-identical) — loop-3 E3.1",
    async () => {
      // Smoothing only has stamped polylines to work on when a stamper ran, so
      // both arms ride the clip pass; the off/on delta isolates the smoother.
      const off = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataEdgeClip: true,
      });
      expect(off.meta.rcllV2Degraded).toBeUndefined();
      // Default off: no smoothing meta keys emitted (byte-identical off).
      expect(off.meta.strataEdgeSmooth).toBeUndefined();
      expect(off.meta.strataEdgeSmoothSmoothed).toBeUndefined();

      const on = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataEdgeClip: true,
        strataEdgeSmooth: true,
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();
      // Survived BOTH silent-drop literals (sceneContext + builderOptions) →
      // engine echo, and the pass actually processed stamped routed polylines.
      expect(on.meta.strataEdgeSmooth).toBe(true);
      expect(typeof on.meta.strataEdgeSmoothSmoothed).toBe("number");
      expect(on.meta.strataEdgeSmoothSmoothed as number).toBeGreaterThan(0);
      expect(typeof on.meta.strataEdgeSmoothPointsBefore).toBe("number");
      expect(typeof on.meta.strataEdgeSmoothPointsAfter).toBe("number");

      // HARD CONSTRAINTS at the E2E seam: provenance is never restamped and
      // endpoints never move, so repair's keep/flatten verdict on the clip
      // population is IDENTICAL with and without smoothing. (This COMPACT
      // preset has a pre-existing flattened clip subset — the smoother must
      // not grow OR shrink it; the flattenedBy === {} absolute gate lives on
      // the owner-full scoreboard arm, where the clip gate keeps all 145.)
      const offKeptBy = off.meta.strataRoutedPolylinesKeptBy as Record<
        string,
        number
      >;
      const onKeptBy = on.meta.strataRoutedPolylinesKeptBy as Record<
        string,
        number
      >;
      const offFlattenedBy = (off.meta.strataRoutedPolylinesFlattenedBy ??
        {}) as Record<string, number>;
      const onFlattenedBy = (on.meta.strataRoutedPolylinesFlattenedBy ??
        {}) as Record<string, number>;
      expect(onKeptBy.clip).toBe(offKeptBy.clip);
      expect(onFlattenedBy.clip ?? 0).toBe(offFlattenedBy.clip ?? 0);

      // E3.1 render-fidelity contract: smoothed records draw EXACTLY the
      // computed polyline — roundness null on every clip-provenance arrow.
      const clipArrows = on.elements.filter((el) => {
        const cd = el.customData as Record<string, unknown> | undefined;
        return el.type === "arrow" && cd?.terraformRoutedBy === "clip";
      });
      expect(clipArrows.length).toBeGreaterThan(0);
      for (const arrow of clipArrows) {
        expect((arrow as { roundness?: unknown }).roundness).toBeNull();
      }

      // Explicit false is byte-identical to the flag-off scene (the module
      // never runs), checked at bbox AND polyline level.
      const explicitFalse = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataEdgeClip: true,
        strataEdgeSmooth: false,
      });
      expect(geometryTuples(explicitFalse.elements)).toEqual(
        geometryTuples(off.elements),
      );
      expect(arrowPolySignatures(explicitFalse.elements)).toEqual(
        arrowPolySignatures(off.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );

  it(
    "threads strataBandCompact through the sceneContext literal (WP2 — threading-only; engine consumption + meta echo is WP1's parallel build)",
    async () => {
      // Both literals in terraformLayoutCore.ts (LayoutSceneContext +
      // buildPipelineLayoutSceneBody's builderOptions, and the
      // layoutTerraformFromSources resolution literal) are exercised by
      // this end-to-end call — an option missing from either is silently
      // dropped on the real app path, so a crash-free, non-degraded build
      // with the flag on proves both seams forward it.
      const off = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(off.meta.rcllV2Degraded).toBeUndefined();

      const on = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBandCompact: true,
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();
      expect(on.elements.length).toBeGreaterThan(0);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 6,
  );

  it(
    "threads strataBandDepth through the sceneContext + builderOptions literals to a frame customData echo (silent-drop guard)",
    async () => {
      // Both literals in terraformLayoutCore.ts (LayoutSceneContext +
      // buildPipelineLayoutSceneBody's builderOptions) are exercised by this
      // end-to-end call — an option missing from either is silently dropped
      // on the real app path (engine-level unit tests bypass this seam
      // entirely). The engine itself does NOT echo the resolved cut in
      // `meta` (deliberately — see terraformPipelineStrata.ts's comment next
      // to `strataBandCompactRequested`), so the only app-observable proof
      // of survival is the conditional `terraformHullPolicy` frame stamp
      // (terraformPipelineStrataSceneBuild.ts): it fires ONLY when a hull's
      // resolved policy diverges from the static role→policy map, which only
      // happens under a non-default cut.
      const hasPolicyStamp = (scene: Scene) =>
        scene.elements.some(
          (el) =>
            el.type === "frame" &&
            (el.customData as Record<string, unknown> | undefined)
              ?.terraformHullPolicy !== undefined,
        );

      const off = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(off.meta.rcllV2Degraded).toBeUndefined();
      // Default cut ("account", absent ⇒ same thing): every hull matches the
      // static map, so the stamp never fires — byte-identical to pre-change.
      expect(hasPolicyStamp(off)).toBe(false);

      const explicitAccount = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBandDepth: "account",
      });
      expect(explicitAccount.meta.rcllV2Degraded).toBeUndefined();
      expect(hasPolicyStamp(explicitAccount)).toBe(false);

      const on = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBandDepth: "root",
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();
      // "root" packs every deeper role — provider/account hulls (banded under
      // the static map) now resolve "packed" and get stamped, proving the
      // option reached the engine through both literals.
      expect(hasPolicyStamp(on)).toBe(true);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 6,
  );

  it(
    "default-cut e2e: no frame customData carries an OWN terraformHullPolicy key; non-default cut proves the check isn't vacuous (codex WP3-P3)",
    async () => {
      // Regression for codex WP3-P3: WP3's slice-metrics tests exercised the
      // stamp condition (terraformPipelineStrataSceneBuild.ts) only against
      // synthetic frames, so an "always-stamp" regression there — the stamp
      // firing unconditionally instead of only when a hull's resolved policy
      // diverges from the static role→policy map — would go undetected. This
      // builds a REAL strata scene end-to-end through the same app path as
      // the threading tests above (`layoutTerraformFromSources`, multi-
      // provider preset) and checks `hasOwnProperty` directly (not just
      // `!== undefined`) across every emitted frame, so a stamp present with
      // an `undefined` value would also be caught.
      const framesOf = (scene: Scene) =>
        scene.elements.filter((el) => el.type === "frame");
      const hasOwnStamp = (frame: ExcalidrawElement) =>
        Object.prototype.hasOwnProperty.call(
          (frame.customData ?? {}) as Record<string, unknown>,
          "terraformHullPolicy",
        );

      // Default cut, option absent: no frame carries the own key.
      const defaultAbsent = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(defaultAbsent.meta.rcllV2Degraded).toBeUndefined();
      const defaultAbsentFrames = framesOf(defaultAbsent);
      expect(defaultAbsentFrames.length).toBeGreaterThan(0);
      expect(defaultAbsentFrames.every((f) => !hasOwnStamp(f))).toBe(true);

      // Default cut, explicit "account": same guarantee.
      const defaultExplicit = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBandDepth: "account",
      });
      expect(defaultExplicit.meta.rcllV2Degraded).toBeUndefined();
      const defaultExplicitFrames = framesOf(defaultExplicit);
      expect(defaultExplicitFrames.length).toBeGreaterThan(0);
      expect(defaultExplicitFrames.every((f) => !hasOwnStamp(f))).toBe(true);

      // Non-default cut: prove the absence checks above aren't vacuous — at
      // least one frame DOES carry the own key once the cut actually moves a
      // hull's resolved policy off the static map.
      const nonDefault = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBandDepth: "root",
      });
      expect(nonDefault.meta.rcllV2Degraded).toBeUndefined();
      expect(framesOf(nonDefault).some((f) => hasOwnStamp(f))).toBe(true);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "bandCompact alias on the direct-options path resolves the 'root' cut (WP4 P1) — identical to an explicit strataBandDepth:'root'",
    async () => {
      // Regression for codex WP4 P1: before the raw-forward fix, the
      // sceneContext + builderOptions literals materialized
      // strataBandDepth:"account", so a bare `strataBandCompact:true` (no
      // enum) arriving via direct options had its "account" win the engine's
      // `?? (strataBandCompact ? "root" : "account")` resolver — the alias was
      // DEFEATED and the layout stayed the default cut. The old
      // `threads strataBandCompact` test only asserted a crash-free build, so
      // this escaped. Prove the alias now fires via the policy-stamp (the only
      // app-observable proof: it fires ONLY when a hull's resolved policy
      // diverges from the static map, i.e. under a non-default cut).
      const hasPolicyStamp = (scene: Scene) =>
        scene.elements.some(
          (el) =>
            el.type === "frame" &&
            (el.customData as Record<string, unknown> | undefined)
              ?.terraformHullPolicy !== undefined,
        );

      const compact = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBandCompact: true,
      });
      expect(compact.meta.rcllV2Degraded).toBeUndefined();
      // provider/account hulls (banded under the static map) now resolve
      // "packed" via the alias → stamped.
      expect(hasPolicyStamp(compact)).toBe(true);

      // Byte-identical to the explicit "root" cut: the alias is exactly
      // `strataBandDepth:"root"`.
      const root = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBandDepth: "root",
      });
      expect(geometryTuples(compact.elements)).toEqual(
        geometryTuples(root.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 6,
  );

  it(
    "threads strataBlockClamp end-to-end (sceneContext + builderOptions literals -> engine -> meta echo, default-off byte-identical)",
    async () => {
      // Silent-drop guard for the RCLL boundary (memory 'RCLL option threading
      // boundary'): the flag must survive the sceneContext literal AND the
      // builderOptions fan-in in terraformLayoutCore.ts, or it is dropped on the
      // real `layoutTerraformFromSources` app path while looking wired in the
      // dialog. The engine echoes `strataBlockClamp: true` in flagMeta only when
      // on, so the meta echo is the app-observable end-to-end proof.
      const off = await buildStrata({
        strataRankSeparate: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(off.meta.rcllV2Degraded).toBeUndefined();
      // Default-off: the echo key is ABSENT (not present-with-false), so the
      // flag-off meta is byte-identical to pre-change.
      expect(off.meta.strataBlockClamp).toBeUndefined();

      const on = await buildStrata({
        strataRankSeparate: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBlockClamp: true,
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();
      expect(on.meta.strataBlockClamp).toBe(true);
      expect(on.elements.length).toBeGreaterThan(0);
      // Structural invariant still holds after the post-A7 block-clamp pass.
      expect(on.meta.strataStructural).toEqual({
        nonAncestorOverlaps: 0,
        titleCollisions: 0,
        contiguityViolations: 0,
      });

      // Default-off byte-identity: a build with the flag ABSENT and one with it
      // explicit-false produce geometry identical to today's baseline.
      const explicitFalse = await buildStrata({
        strataRankSeparate: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBlockClamp: false,
      });
      expect(geometryTuples(explicitFalse.elements)).toEqual(
        geometryTuples(off.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "threads strataHeightGate end-to-end (sceneContext + builderOptions literals -> engine -> meta echo, default-off byte-identical)",
    async () => {
      // Silent-drop guard for the RCLL boundary (memory 'RCLL option threading
      // boundary'): the flag must survive the sceneContext literal AND the
      // builderOptions fan-in in terraformLayoutCore.ts, or it is dropped on the
      // real `layoutTerraformFromSources` app path while looking wired in the
      // dialog. The engine echoes `strataHeightGate: true` in flagMeta only when
      // on, so the meta echo is the app-observable end-to-end proof.
      const off = await buildStrata({
        strataRankSeparate: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBlockClamp: true,
      });
      expect(off.meta.rcllV2Degraded).toBeUndefined();
      // Default-off: the echo key is ABSENT (not present-with-false), so the
      // flag-off meta is byte-identical to pre-change.
      expect(off.meta.strataHeightGate).toBeUndefined();

      const on = await buildStrata({
        strataRankSeparate: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBlockClamp: true,
        strataHeightGate: true,
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();
      expect(on.meta.strataHeightGate).toBe(true);
      expect(on.elements.length).toBeGreaterThan(0);
      expect(on.meta.strataStructural).toEqual({
        nonAncestorOverlaps: 0,
        titleCollisions: 0,
        contiguityViolations: 0,
      });

      // Inert under phase 1: the block clamp is a rigid X-only translate, so
      // no implied height can change and the gate has nothing to referee. This
      // assertion is a TRIPWIRE, not a theorem: if it fails, the gate has
      // started refereeing real moves here and the change must be measured and
      // justified deliberately — not deleted to make it green.
      expect(geometryTuples(on.elements)).toEqual(geometryTuples(off.elements));

      const explicitFalse = await buildStrata({
        strataRankSeparate: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBlockClamp: true,
        strataHeightGate: false,
      });
      expect(geometryTuples(explicitFalse.elements)).toEqual(
        geometryTuples(off.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "threads strataTranspose end-to-end (sceneContext + builderOptions literals -> engine -> meta echo, default-off byte-identical)",
    async () => {
      // Silent-drop guard for the RCLL boundary (memory 'RCLL option threading
      // boundary'): the flag must survive the sceneContext literal AND the
      // builderOptions fan-in in terraformLayoutCore.ts, or it is dropped on the
      // real `layoutTerraformFromSources` app path while looking wired in the
      // dialog. The engine echoes `strataTranspose: true` in flagMeta only when
      // on, so the meta echo is the app-observable end-to-end proof.
      const off = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(off.meta.rcllV2Degraded).toBeUndefined();
      // Default-off: the echo key is ABSENT (not present-with-false), so the
      // flag-off meta is byte-identical to pre-change.
      expect(off.meta.strataTranspose).toBeUndefined();

      const on = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataTranspose: true,
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();
      expect(on.meta.strataTranspose).toBe(true);
      expect(on.elements.length).toBeGreaterThan(0);
      // Structural invariant still holds after the post-A7 transpose pass — the
      // envelope-preserving adjacent exchange keeps a clean structure.
      expect(on.meta.strataStructural).toEqual({
        nonAncestorOverlaps: 0,
        titleCollisions: 0,
        contiguityViolations: 0,
      });

      // Default-off byte-identity: a build with the flag ABSENT and one with it
      // explicit-false produce geometry identical to today's baseline.
      const explicitFalse = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataTranspose: false,
      });
      expect(geometryTuples(explicitFalse.elements)).toEqual(
        geometryTuples(off.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "threads strataLeafShift end-to-end (sceneContext + builderOptions literals -> engine -> meta echo, default-off byte-identical)",
    async () => {
      // Silent-drop guard for the RCLL boundary (memory 'RCLL option threading
      // boundary'): the flag must survive the sceneContext literal AND the
      // builderOptions fan-in in terraformLayoutCore.ts, or it is dropped on the
      // real `layoutTerraformFromSources` app path while looking wired in the
      // dialog. The engine echoes `strataLeafShift: true` in flagMeta only when
      // on, so the meta echo is the app-observable end-to-end proof.
      const off = await buildStrata({
        strataRankSeparate: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(off.meta.rcllV2Degraded).toBeUndefined();
      // Default-off: the echo key is ABSENT (not present-with-false).
      expect(off.meta.strataLeafShift).toBeUndefined();

      const on = await buildStrata({
        strataRankSeparate: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataLeafShift: true,
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();
      expect(on.meta.strataLeafShift).toBe(true);
      expect(on.elements.length).toBeGreaterThan(0);
      // Structural invariant still holds after the post-A7 leaf-shift pass (its
      // ancestor-hull grow is re-validated by the final structural check).
      expect(on.meta.strataStructural).toEqual({
        nonAncestorOverlaps: 0,
        titleCollisions: 0,
        contiguityViolations: 0,
      });

      // Default-off byte-identity: flag ABSENT vs explicit-false ⇒ identical.
      const explicitFalse = await buildStrata({
        strataRankSeparate: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataLeafShift: false,
      });
      expect(geometryTuples(explicitFalse.elements)).toEqual(
        geometryTuples(off.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "forwards ε / crossing weights / edge-cap when strataLeafShift is the SOLE relocate operator (scorer-option gate fix)",
    async () => {
      // Regression for the A2 finding: leaf-shift consumes penW/crossW/ε/cap through
      // `strataRelocateAdoptable`, but it was omitted from BOTH engineOptions gates
      // (packedScoringEpsilon and the weights/cap block) AND their honest-meta
      // counterparts — so with leaf-shift as the ONLY enabled operator, non-default
      // ε/weights/cap were silently dropped (engine ran ε=0, weights=1, no cap). The
      // meta echo now rides when leaf-shift is on, so it is the app-observable proof
      // the values reached the engine's option bag. No other relocate operator is
      // enabled here, so a passing echo isolates the leaf-shift branch specifically.
      const on = await buildStrata({
        strataRankSeparate: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataLeafShift: true,
        strataPackedScoringEpsilon: 2,
        strataCrossWeightPenetration: 3,
        strataCrossWeightEdge: 2,
        strataEdgeCrossCap: 5,
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();
      expect(on.meta.strataLeafShift).toBe(true);
      // All four scorer knobs are echoed (they were ABSENT before the gate fix).
      expect(on.meta.strataPackedScoringEpsilon).toBe(2);
      expect(on.meta.strataCrossWeightPenetration).toBe(3);
      expect(on.meta.strataCrossWeightEdge).toBe(2);
      expect(on.meta.strataEdgeCrossCap).toBe(5);
      expect(on.meta.strataStructural).toEqual({
        nonAncestorOverlaps: 0,
        titleCollisions: 0,
        contiguityViolations: 0,
      });

      // Sanity: with leaf-shift OFF and no other relocate operator, the same
      // non-default knobs are NOT echoed (nothing consumes them) — the fix rides
      // the echo ON the operator, it does not materialize the keys unconditionally.
      const off = await buildStrata({
        strataRankSeparate: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataPackedScoringEpsilon: 2,
        strataCrossWeightPenetration: 3,
        strataCrossWeightEdge: 2,
        strataEdgeCrossCap: 5,
      });
      expect(off.meta.strataPackedScoringEpsilon).toBeUndefined();
      expect(off.meta.strataCrossWeightPenetration).toBeUndefined();
      expect(off.meta.strataCrossWeightEdge).toBeUndefined();
      expect(off.meta.strataEdgeCrossCap).toBeUndefined();
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 10,
  );

  it(
    "threads strataDeBandLevel end-to-end (sceneContext + builderOptions literals -> engine -> meta echo, default-off byte-identical)",
    async () => {
      // Same silent-drop guard as the transpose case above, with the enum trap
      // on top: `"none"` is a TRUTHY string, so a truthy-gated spread at ANY of
      // the five guarded sites would materialize the key on every default run.
      const off = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(off.meta.rcllV2Degraded).toBeUndefined();
      // Default "none": the echo key is ABSENT (not present-with-"none").
      expect(off.meta.strataDeBandLevel).toBeUndefined();
      expect(off.meta.strataToggleSuppressions).toBeUndefined();

      // `subnet` is legal at the default cut ("account"): the absorbing parent
      // is the vpc hull, which resolves packed.
      const on = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataDeBandLevel: "subnet",
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();
      expect(on.meta.strataDeBandLevel).toBe("subnet");
      expect(on.meta.strataToggleSuppressions).toBeUndefined();
      expect(on.elements.length).toBeGreaterThan(0);
      expect(on.meta.strataStructural).toEqual({
        nonAncestorOverlaps: 0,
        titleCollisions: 0,
        contiguityViolations: 0,
      });
      // The lever's actual mechanism: the dissolved level's frames are never
      // emitted, because the hull never enters the model tree.
      expect(frameCount(on.elements)).toBeLessThan(frameCount(off.elements));

      // Default-off byte-identity, on BOTH fingerprints: geometryTuples alone
      // cannot see a mutated polyline inside an unchanged bbox.
      const explicitNone = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataDeBandLevel: "none",
      });
      expect(geometryTuples(explicitNone.elements)).toEqual(
        geometryTuples(off.elements),
      );
      expect(arrowPolySignatures(explicitNone.elements)).toEqual(
        arrowPolySignatures(off.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "suppresses an infeasible strataDeBandLevel instead of stacking every lifted leaf on its own band-row",
    async () => {
      // `region` de-band absorbs into the account hull, which is BANDED at the
      // default cut — every lifted leaf would become its own band-row (one tall
      // stack). The engine drops the level and says so; band depth wins.
      const suppressed = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataDeBandLevel: "region",
      });
      expect(suppressed.meta.rcllV2Degraded).toBeUndefined();
      expect(suppressed.meta.strataDeBandLevel).toBeUndefined();
      expect(suppressed.meta.strataToggleSuppressions).toEqual([
        "band-axis-conflict-banddepth-wins-deband-absorbing-parent-banded",
      ]);

      // Suppressed ⇒ the layout is the plain baseline, byte-for-byte.
      const baseline = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(geometryTuples(suppressed.elements)).toEqual(
        geometryTuples(baseline.elements),
      );

      // `provider` absorbs into the root, which is PINNED banded at every cut —
      // so it is suppressed even at the shallowest cut. No cut rescues it.
      const providerAtRootCut = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBandDepth: "root",
        strataDeBandLevel: "provider",
      });
      expect(providerAtRootCut.meta.strataDeBandLevel).toBeUndefined();
      expect(providerAtRootCut.meta.strataToggleSuppressions).toEqual([
        "band-axis-conflict-banddepth-wins-deband-absorbing-parent-banded",
      ]);

      // ...and the same `region` level DOES apply once the cut is shallow enough
      // that its absorbing parent (account) packs — proving the gate is the
      // feasibility predicate, not a blanket rejection.
      const feasible = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataBandDepth: "provider",
        strataDeBandLevel: "region",
      });
      expect(feasible.meta.strataDeBandLevel).toBe("region");
      expect(feasible.meta.strataToggleSuppressions).toBeUndefined();
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "rankSeparate × packedScoring mutual exclusion: packedScoring WINS, rankSeparate suppressed (owner 2026-07-17)",
    async () => {
      // owner-decisions.md 2026-07-17: the two whole-layout scorers cannot
      // compose. When both arrive true packedScoring wins and rankSeparate is
      // dropped — surfaced in meta as strataToggleSuppressions, never silently.
      const bothOn = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataRankSeparate: true,
        strataPackedScoring: true,
      });
      expect(bothOn.meta.rcllV2Degraded).toBeUndefined();
      // packedScoring survives; rankSeparate is suppressed (effective echo false).
      expect(bothOn.meta.strataPackedScoring).toBe(true);
      expect(bothOn.meta.strataRankSeparate).toBe(false);
      expect(bothOn.meta.strataToggleSuppressions).toContain(
        "rankseparate-packedscoring-conflict-packedscoring-wins-rankseparate",
      );

      // The both-on geometry is byte-identical to packedScoring-alone (the
      // rankSeparate request was fully dropped, not partially applied).
      const packedOnly = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataPackedScoring: true,
      });
      expect(geometryTuples(bothOn.elements)).toEqual(
        geometryTuples(packedOnly.elements),
      );
      expect(packedOnly.meta.strataToggleSuppressions).toBeUndefined();

      // rankSeparate ALONE (packedScoring off) is NOT suppressed — the exclusion
      // only fires when packedScoring is also requested.
      const rankOnly = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataRankSeparate: true,
      });
      expect(rankOnly.meta.strataRankSeparate).toBe(true);
      expect(rankOnly.meta.strataToggleSuppressions).toBeUndefined();
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "stamps terraformTopologyPath at the SAME de-band level the hull tree was built with",
    async () => {
      // The two `topologyPathForCluster` call sites — the model tree
      // (terraformPipelineStrataModel) and the customData stamp
      // (terraformPipelineStrataSceneBuild) — must never diverge. Threading only
      // the first leaves the layout and frames correct while T9 slice
      // classification (which reconstructs the tree read-only FROM this stamp)
      // is silently wrong forever. Tests would otherwise pass.
      const on = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataDeBandLevel: "subnet",
      });
      const stamped = on.elements
        .map(
          (el) =>
            (el.customData as { terraformTopologyPath?: string[] } | undefined)
              ?.terraformTopologyPath,
        )
        .filter((p): p is string[] => Array.isArray(p));
      expect(stamped.length).toBeGreaterThan(0);
      // subnet de-band ⇒ DEBAND_PATH_KEEP 4 ⇒ no stamped path keeps a subnet
      // segment. The un-truncated baseline HAS 5-segment paths, so this
      // assertion is falsifiable (it fails if the scene-build site is missed).
      expect(Math.max(...stamped.map((p) => p.length))).toBeLessThanOrEqual(4);

      const off = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      const offStamped = off.elements
        .map(
          (el) =>
            (el.customData as { terraformTopologyPath?: string[] } | undefined)
              ?.terraformTopologyPath,
        )
        .filter((p): p is string[] => Array.isArray(p));
      expect(Math.max(...offStamped.map((p) => p.length))).toBe(5);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "honors pipelineCompact=false on the strata engine path (the Detail -> Full control is pure UI exposure)",
    async () => {
      // Ask B: the engine already reads `options?.compact !== false` and threads
      // it into preparePipelineLayout; every layer between the dialog and the
      // engine already forwards it. This pins that claim so the new Detail
      // control in TerraformStrataSettings cannot be the thing that breaks.
      const compact = await buildStrata({ strataSweeps: 4 });
      expect(compact.meta.pipelineCompact).toBe(true);

      const full = await buildStrata({
        strataSweeps: 4,
        pipelineCompact: false,
      });
      expect(full.meta.rcllV2Degraded).toBeUndefined();
      expect(full.meta.pipelineCompact).toBe(false);
      // Full mode expands every cluster's contents. Assert the INEQUALITY, not a
      // literal count — the exact number is a snapshot of cluster contents.
      expect(full.elements.length).toBeGreaterThan(compact.elements.length);
      // A passing structural check is a correctness proof here: the engine
      // THROWS on any nonzero (terraformPipelineStrata.ts).
      expect(full.meta.strataStructural).toEqual({
        nonAncestorOverlaps: 0,
        titleCollisions: 0,
        contiguityViolations: 0,
      });
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "pipelineColumnPackingInert fires for strata when columnPacking is requested (SDEC-26) — present on v2, ABSENT on rcll",
    async () => {
      const strataOff = await buildStrata();
      expect(strataOff.meta.pipelineColumnPackingInert).toBeUndefined();

      const strataCompact = await buildStrata({
        pipelineColumnPacking: "compact",
      });
      expect(strataCompact.meta.pipelineColumnPacking).toBe("compact");
      expect(strataCompact.meta.pipelineColumnPackingInert).toBe(true);

      const v2Compact = await buildV2({ pipelineColumnPacking: "compact" });
      expect(v2Compact.meta.pipelineColumnPacking).toBe("compact");
      expect(v2Compact.meta.pipelineColumnPackingInert).toBe(true);

      const rcllCompact = await buildRcll({
        pipelineColumnPacking: "compact",
      });
      expect(rcllCompact.meta.pipelineColumnPacking).toBe("compact");
      expect(rcllCompact.meta.pipelineColumnPackingInert).toBeUndefined();
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );

  it(
    "the Strata engine produces its OWN scene (not a v2 passthrough) and honors ancillary",
    async () => {
      const strata = await buildStrata({ pipelineIncludeAncillary: true });
      // engine ran end-to-end and emitted geometry
      expect(strata.meta.rcllV2Degraded).toBeUndefined();
      expect(strata.meta.pipelineVariant).toBe("strata");
      expect(strata.elements.length).toBeGreaterThan(0);
      // Ancillary is no longer deferred: the flag reaches the ENGINE (it used to
      // reach only the builder, which hardcoded `includeAncillary: false`), and
      // the engine injects real bands post-layout.
      expect(strata.meta.strataAncillaryDeferred).toBeUndefined();
      expect(strata.meta.pipelineIncludeAncillary).toBe(true);
      expect(strata.meta.pipelineAncillaryCount).toBeGreaterThan(0);
      expect(strata.meta.strataAncillaryBandCount).toBeGreaterThan(0);
      expect(strata.meta.strataAncillaryDegraded).toBeUndefined();
      // it is NOT a byte-for-byte v2 passthrough anymore: the Strata engine owns
      // placement, so its geometry differs from the v2 packer's.
      const v2 = await buildV2({ pipelineIncludeAncillary: true });
      expect(geometryTuples(strata.elements)).not.toEqual(
        geometryTuples(v2.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "engine-core clamp: pipelinePrivateApiRegional is ALWAYS-ON for strata (owner Q9) and inert (forced false) for non-strata",
    async () => {
      // Load-bearing regression for the engine-core clamp (terraformLayoutCore.ts
      // sceneContext literal: `pipelinePrivateApiRegional: layoutMode === "strata"`).
      // owner-decisions.md 2026-07-17 (Q9): private REST APIs are ALWAYS regional
      // in strata, and the ability to turn it off is removed. This exercises the
      // DIRECT engine path (`layoutTerraformFromSources`) — the one a URL/worker
      // caller hits — on the real multi-account private-API fixture.
      //
      // Non-strata forces the flag false at the engine core ⇒ geometry is
      // byte-identical regardless of what the caller passes (unchanged).
      const v2Off = await buildV2();
      const v2On = await buildV2({ pipelinePrivateApiRegional: true });
      expect(geometryTuples(v2On.elements)).toEqual(
        geometryTuples(v2Off.elements),
      );

      const rcllOff = await buildRcll();
      const rcllOn = await buildRcll({ pipelinePrivateApiRegional: true });
      expect(geometryTuples(rcllOn.elements)).toEqual(
        geometryTuples(rcllOff.elements),
      );

      // Strata CLAMPS the flag on: the caller's value is ignored. A strata build
      // that explicitly passes `pipelinePrivateApiRegional: false` (the exact
      // shape a legacy `privateApiRegional=0` URL produces) must yield the SAME
      // geometry as one that passes `true` — the review bug was that `=0` could
      // still flip it off; it can't anymore.
      const strataFalse = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        pipelinePrivateApiRegional: false,
      });
      const strataTrue = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
        pipelinePrivateApiRegional: true,
      });
      // The no-key default path lands on the SAME clamped-on layout. This is the
      // decisive anti-revert guard: under the pre-clamp engine contract ("absent
      // ⇒ opted out") a strata build with no privateApi key ran with the flag
      // OFF, so this default build would DIFFER from the explicit-true build on
      // this multi-account fixture. The clamp makes them identical — restore the
      // old `options?.pipelinePrivateApiRegional` pass-through and this fails.
      const strataDefault = await buildStrata({
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(strataFalse.meta.rcllV2Degraded).toBeUndefined();
      expect(strataTrue.meta.rcllV2Degraded).toBeUndefined();
      expect(strataDefault.meta.rcllV2Degraded).toBeUndefined();
      expect(geometryTuples(strataFalse.elements)).toEqual(
        geometryTuples(strataTrue.elements),
      );
      expect(geometryTuples(strataDefault.elements)).toEqual(
        geometryTuples(strataTrue.elements),
      );
      // Regional PLACEMENT semantics (true ⇒ private REST API hoisted to an
      // account/region hull, not VPC-nested) are owned by the dedicated
      // topology suites (terraformPrivateApiRegionalPlacement.test.ts,
      // terraformApiPlacementDebug.test.ts); this test owns the strata CLAMP.
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );
});
