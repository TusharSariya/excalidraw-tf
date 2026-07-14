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
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";

import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { layoutTerraformFromSources } from "./terraformLayoutCore";

import type { TerraformPlanParsingSources } from "./terraformPlanParsing";

const v2Sources = () =>
  getTerraformImportPresetSourcesFromDb(
    "staging-extended-localstack-v2",
  ) as unknown as TerraformPlanParsingSources;

/** Geometry-only fingerprint (ids/seeds/versions are non-deterministic across
 * builds in the same process — see the canonicalize() comment in the rcll
 * threading test for why). Sorted so element ORDER differences don't matter. */
const geometryTuples = (elements: readonly ExcalidrawElement[]): string[] =>
  elements
    .filter((el) => !el.isDeleted)
    .map((el) => `${el.x},${el.y},${el.width},${el.height}`)
    .sort();

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
    "the Strata engine produces its OWN scene (not a v2 passthrough) and defers ancillary honestly",
    async () => {
      const strata = await buildStrata({ pipelineIncludeAncillary: true });
      // engine ran end-to-end and emitted geometry
      expect(strata.meta.rcllV2Degraded).toBeUndefined();
      expect(strata.meta.pipelineVariant).toBe("strata");
      expect(strata.elements.length).toBeGreaterThan(0);
      // ancillary is deferred at M1 (extraction-free) — echoed, never silently ignored
      expect(strata.meta.strataAncillaryDeferred).toBe(true);
      // it is NOT a byte-for-byte v2 passthrough anymore: the Strata engine owns
      // placement, so its geometry differs from the v2 packer's.
      const v2 = await buildV2({ pipelineIncludeAncillary: true });
      expect(geometryTuples(strata.elements)).not.toEqual(
        geometryTuples(v2.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );
});
