/**
 * Regression: `layoutTerraformFromSources` (the worker/headless path the app
 * actually uses) must FORWARD the RCLL pipeline toggles to the pipeline body.
 *
 * Bug (fixed 2026-06-20): the `sceneContext` literal forwarded swimlaneLaneRise /
 * subnetDeBand / reorder but DROPPED `pipelineRankSeparate` (+ straighten /
 * deDensify / staircaseBandOverlap), so those toggles did nothing from the
 * dialog/URL even though every layer above passed them. The engine-level
 * `terraformPipelineRankSeparate.test.ts` missed it because it calls the builder
 * directly, bypassing this hop. This test exercises the real entry.
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

const sceneWidth = (elements: readonly ExcalidrawElement[]) => {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const el of elements) {
    if (el.isDeleted) {
      continue;
    }
    minX = Math.min(minX, el.x);
    maxX = Math.max(maxX, el.x + el.width);
  }
  return maxX - minX;
};

const sceneHeight = (elements: readonly ExcalidrawElement[]) => {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    if (el.isDeleted) {
      continue;
    }
    minY = Math.min(minY, el.y);
    maxY = Math.max(maxY, el.y + el.height);
  }
  return maxY - minY;
};

/**
 * Element ids/seeds are non-deterministic across builds in the same process: ids
 * come from a global sequential counter (parallel-but-offset between runs),
 * `groupIds` are random nanoids, and `seed`/`versionNonce` are random integers.
 * To assert layout byte-identity we canonicalize: strip the random scalars and
 * remap every id-reference (id, frameId, groupIds, boundElements, bindings) to a
 * first-appearance token. Two structurally identical scenes then deep-equal.
 */
const canonicalize = (elements: readonly ExcalidrawElement[]) => {
  const map = new Map<string, string>();
  let n = 0;
  const tok = (s: string) => {
    if (!map.has(s)) {
      map.set(s, `T${n++}`);
    }
    return map.get(s)!;
  };
  for (const el of elements) {
    const e = el as unknown as Record<string, any>;
    tok(e.id);
    if (e.frameId) {
      tok(e.frameId);
    }
    for (const g of (e.groupIds as string[]) ?? []) {
      tok(g);
    }
    for (const b of (e.boundElements as { id: string }[]) ?? []) {
      tok(b.id);
    }
    if (e.startBinding?.elementId) {
      tok(e.startBinding.elementId);
    }
    if (e.endBinding?.elementId) {
      tok(e.endBinding.elementId);
    }
  }
  return elements.map((el) => {
    const c = JSON.parse(JSON.stringify(el)) as Record<string, any>;
    delete c.seed;
    delete c.versionNonce;
    delete c.version;
    delete c.updated;
    c.id = map.get(c.id) ?? c.id;
    if (c.frameId) {
      c.frameId = map.get(c.frameId) ?? c.frameId;
    }
    if (Array.isArray(c.groupIds)) {
      c.groupIds = c.groupIds.map((g: string) => map.get(g) ?? g);
    }
    if (Array.isArray(c.boundElements)) {
      c.boundElements = c.boundElements.map((b: { id: string }) => ({
        ...b,
        id: map.get(b.id) ?? b.id,
      }));
    }
    if (c.startBinding?.elementId) {
      c.startBinding.elementId =
        map.get(c.startBinding.elementId) ?? c.startBinding.elementId;
    }
    if (c.endBinding?.elementId) {
      c.endBinding.elementId =
        map.get(c.endBinding.elementId) ?? c.endBinding.elementId;
    }
    return c;
  });
};

describe("layoutTerraformFromSources — RCLL toggle threading (regression)", () => {
  const build = async (opts: Record<string, unknown>) => {
    const result = await layoutTerraformFromSources(v2Sources(), {
      layoutMode: "rcll",
      pipelineCompact: true,
      ...opts,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    return result.scene as {
      elements: ExcalidrawElement[];
      meta: Record<string, unknown>;
    };
  };

  it(
    "de-band depth threads through (none ≡ off; vpc reaches engine; subnetDeBand alias)",
    async () => {
      const off = await build({});
      const none = await build({ pipelineDeBandLevel: "none" });
      const subnetViaAlias = await build({ pipelineSubnetDeBand: true });
      const subnetViaEnum = await build({ pipelineDeBandLevel: "subnet" });
      const vpc = await build({ pipelineDeBandLevel: "vpc" });

      // "none" is the identity ⇒ byte-identical to no options, and omitted from meta.
      expect(canonicalize(none.elements)).toEqual(canonicalize(off.elements));
      expect(none.meta.pipelineDeBandLevel).toBeUndefined();
      expect(off.meta.pipelineSubnetDeBand ?? false).toBe(false);

      // The legacy boolean alias resolves to deBandLevel="subnet" and is geometrically
      // equivalent to the explicit enum (same element count + bounds); the legacy boolean
      // meta echo is preserved (true). (We compare bounds, not canonicalized ids — the
      // helper doesn't tokenize a text element's `containerId`, and absolute id numbering
      // can differ between two builds even when the geometry is identical.)
      expect(subnetViaAlias.meta.pipelineDeBandLevel).toBe("subnet");
      expect(subnetViaAlias.meta.pipelineSubnetDeBand).toBe(true);
      expect(subnetViaAlias.elements.length).toBe(
        subnetViaEnum.elements.length,
      );
      expect(sceneHeight(subnetViaAlias.elements)).toBe(
        sceneHeight(subnetViaEnum.elements),
      );
      expect(sceneWidth(subnetViaAlias.elements)).toBe(
        sceneWidth(subnetViaEnum.elements),
      );

      // A deeper level reaches the engine (echoed) and is NOT the legacy boolean.
      expect(vpc.meta.pipelineDeBandLevel).toBe("vpc");
      expect(vpc.meta.pipelineSubnetDeBand ?? false).toBe(false);
      // De-band shortens the diagram (the merged column stack vs Σ(bands)).
      expect(sceneHeight(subnetViaEnum.elements)).toBeLessThan(
        sceneHeight(off.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );

  it(
    "forwards pipelineRankSeparate (+ rise) to the engine — wider & shorter than OFF",
    async () => {
      const off = await build({});
      const both = await build({
        pipelineSwimlaneLaneRise: true,
        pipelineRankSeparate: true,
      });

      // 1. The toggle actually reaches the engine (was dropped pre-fix).
      expect(off.meta.pipelineRankSeparate ?? false).toBe(false);
      expect(both.meta.pipelineRankSeparate).toBe(true);
      expect(both.meta.pipelineSwimlaneLaneRise).toBe(true);

      // 2. It does real work: rankSeparate composed with the lane-rise trades
      //    height for width (the documented ~+28% / -42% on v2).
      expect(sceneWidth(both.elements)).toBeGreaterThan(
        sceneWidth(off.elements),
      );
      expect(sceneHeight(both.elements)).toBeLessThan(
        sceneHeight(off.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 6,
  );

  it(
    "suppresses pipelineRankSeparate without lane-rise (footgun stays observable)",
    async () => {
      const footgun = await build({ pipelineRankSeparate: true });
      expect(footgun.meta.pipelineRankSeparate ?? false).toBe(false);
      expect(footgun.meta.pipelineRankSeparateSuppressed).toBe(true);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 4,
  );

  it(
    "forwards pipelineCrossingMin (M6c) to the engine — OFF byte-identical, ON echoed, gates clean",
    async () => {
      const off = await build({});
      const on = await build({
        pipelineSwimlaneLaneRise: true,
        pipelineRankSeparate: true,
        pipelineCrossingMin: true,
      });

      // 1. OFF: the flag is absent ⇒ not advertised in meta.
      expect(off.meta.pipelineCrossingMin ?? false).toBe(false);

      // 2. ON reaches the engine: echoed + the M6c placement meta surfaces.
      expect(on.meta.pipelineCrossingMin).toBe(true);
      const placement = (
        on.meta.rcllStageMeta as { placement?: Record<string, number> }
      ).placement;
      expect(placement?.crossingMinApplied).toBeDefined();
      expect(placement?.crossingMinAfter).toBeLessThanOrEqual(
        placement?.crossingMinBefore ?? Infinity,
      );

      // 3. Structural gates stay clean (X never moves ⇒ CON-12 holds).
      const gates = on.meta.gates as
        | { acyclicBackwardEdges?: number; acyclicSameColumnEdges?: number }
        | undefined;
      expect(gates?.acyclicBackwardEdges ?? 0).toBe(0);
      expect(gates?.acyclicSameColumnEdges ?? 0).toBe(0);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 10,
  );

  it(
    "crossingMin supersedes the leaf reorder when both are set (guard, observable)",
    async () => {
      const both = await build({
        pipelineReorder: true,
        pipelineCrossingMin: true,
      });
      // The guard drops the leaf reorder (superset wins) and surfaces the conflict.
      expect(both.meta.pipelineCrossingMin).toBe(true);
      expect(both.meta.pipelineReorder ?? false).toBe(false);
      expect(both.meta.pipelineOrderingConflict).toBe(true);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 6,
  );

  it(
    "forwards pipelineColumnPacking=compact (M5c) to the engine — observable on v2",
    async () => {
      const off = await build({});
      const none = await build({ pipelineColumnPacking: "none" });
      const compact = await build({ pipelineColumnPacking: "compact" });

      // 1. `none` is the literal default — OFF byte-identical (canonicalized
      //    elements deep-equal; raw ids/seeds are non-deterministic per run),
      //    and it must not advertise the packing meta.
      expect(canonicalize(none.elements)).toEqual(canonicalize(off.elements));
      expect(none.meta.pipelineColumnPacking).toBeUndefined();
      expect(off.meta.rcllColumnCompact ?? false).toBe(false);

      // 2. `compact` reaches the engine: enum echoed, M5c milestone, stats surfaced.
      expect(compact.meta.pipelineColumnPacking).toBe("compact");
      expect(compact.meta.rcllColumnCompact).toBe(true);
      expect(compact.meta.rcllMilestone).toBe("M5c");
      const placement = (
        compact.meta.rcllStageMeta as {
          placement?: Record<string, number>;
        }
      ).placement;
      expect(placement?.columnCompactApplied).toBeDefined();

      // 3. The measure-gated pass never makes the diagram worse: width is
      //    non-increasing and CON-12 holds (no backward / same-column leaf edge).
      //    On v2 the swimlanes are already dense ⇒ a measured no-op (moved 0),
      //    which must be OFF byte-identical (the safe-fallback path).
      expect(sceneWidth(compact.elements)).toBeLessThanOrEqual(
        sceneWidth(off.elements),
      );
      const gates = compact.meta.gates as
        | { acyclicBackwardEdges?: number; acyclicSameColumnEdges?: number }
        | undefined;
      expect(gates?.acyclicBackwardEdges ?? 0).toBe(0);
      expect(gates?.acyclicSameColumnEdges ?? 0).toBe(0);
      if ((placement?.columnCompactMovedCount ?? 0) === 0) {
        expect(canonicalize(compact.elements)).toEqual(
          canonicalize(off.elements),
        );
      }
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "pipelineColumnPacking=compact is deterministic (CON-8)",
    async () => {
      const a = await build({ pipelineColumnPacking: "compact" });
      const b = await build({ pipelineColumnPacking: "compact" });
      expect(canonicalize(a.elements)).toEqual(canonicalize(b.elements));
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  // --- "shorten" = X-axis network-simplex bundle (rendered A/B on v2) ----------

  it(
    "forwards pipelineColumnPacking=shorten (NS bundle) to the engine — strictly NARROWER than compact, gates clean (the proven −8.4% lever)",
    async () => {
      // Apples-to-apples with the probe config ("other toggles ON"): run the ordering
      // pass (crossingMin) in BOTH arms so crossings are minimized either way and the
      // only difference under test is the NS depth-floor re-ranking. Without it, NS
      // legitimately shuffles raw crossings (the ordering pass is what flattens them).
      const baseOpts = { pipelineCrossingMin: true };
      const compact = await build({
        ...baseOpts,
        pipelineColumnPacking: "compact",
      });
      const shorten = await build({
        ...baseOpts,
        pipelineColumnPacking: "shorten",
      });

      // 1. `shorten` reaches the engine: the enum echoes, the NS-applied flag flips
      //    true (verify-or-abort passed), the bundle keeps columnCompact, milestone M2-NS.
      expect(shorten.meta.pipelineColumnPacking).toBe("shorten");
      expect(shorten.meta.rcllNetworkSimplexApplied).toBe(true);
      expect(shorten.meta.rcllNetworkSimplexSkipReason).toBeUndefined();
      expect(shorten.meta.rcllColumnCompact).toBe(true); // bundle keeps compact
      expect(shorten.meta.rcllMilestone).toBe("M2-NS");

      // 2. It does real work over compact alone (isolating the NS depth-floor lever,
      //    since both arms run column compaction): the diagram gets strictly NARROWER.
      //    The throwaway probe measured −8.4% vs compact on this preset; assert a
      //    conservative ≥3% so the test survives preset churn / minor reflow.
      const compactW = sceneWidth(compact.elements);
      const shortenW = sceneWidth(shorten.elements);
      expect(shortenW).toBeLessThan(compactW);
      expect((compactW - shortenW) / compactW).toBeGreaterThanOrEqual(0.03);

      // 3. The structural gates stay clean — this is the hard correctness bar. NS
      //    only re-ranks columns; CON-12 X-disjointness, collisions, and semantic
      //    edge direction all hold (the width win never comes at a structural cost).
      const gates = shorten.meta.gates as
        | {
            collisions?: number;
            acyclicBackwardEdges?: number;
            acyclicSameColumnEdges?: number;
            semanticEdgeViolations?: number;
          }
        | undefined;
      expect(gates?.collisions ?? 0).toBe(0);
      expect(gates?.acyclicBackwardEdges ?? 0).toBe(0);
      expect(gates?.acyclicSameColumnEdges ?? 0).toBe(0);
      expect(gates?.semanticEdgeViolations ?? 0).toBe(0);

      // NOTE on crossings: NOT asserted as a gate. The throwaway probe saw crossings
      // "flat" only against its FULL-toggle baseline; in an isolated NS-vs-compact A/B
      // the depth-floor re-ranking trades a small crossings increase for the width win
      // (measured ~230 vs ~198 here, even with crossingMin on). Asserting "crossings ≤
      // compact" would be a false property of NS in isolation — the robust,
      // NS-attributable wins are WIDTH + clean structural gates, gated above.
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 10,
  );

  it(
    "rankSeparate (dominant height lever) wins over shorten/NS at the engine; NS suppressed observably, no height regression",
    async () => {
      // rankSeparate + lane-rise is the −60% height composition; NS would destroy the
      // lanes' X-disjointness and balloon height (+149% measured). So with both on,
      // rankSeparate WINS and NS is suppressed — "shorten" degrades to its additive
      // half (columnCompact), i.e. it becomes byte-identical to picking "compact".
      const compact = await build({
        pipelineColumnPacking: "compact",
        pipelineSwimlaneLaneRise: true,
        pipelineRankSeparate: true,
      });
      const shorten = await build({
        pipelineColumnPacking: "shorten",
        pipelineSwimlaneLaneRise: true,
        pipelineRankSeparate: true,
      });
      // rankSeparate stays ON; NS is suppressed and surfaced (not silently applied).
      expect(shorten.meta.pipelineRankSeparate).toBe(true);
      expect(shorten.meta.rcllNetworkSimplexApplied ?? false).toBe(false);
      expect(shorten.meta.pipelineNetworkSimplexRankSuppressed).toBe(true);
      expect(shorten.meta.rcllMilestone).toBe("M8r"); // rankSeparate layout, not M2-NS
      // The critical regression guard: with NS suppressed, "shorten" === "compact"
      // under rankSeparate — the height is the rankSeparate layout's, NOT blown up.
      expect(canonicalize(shorten.elements)).toEqual(
        canonicalize(compact.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "pipelineColumnPacking=shorten is deterministic (CON-8)",
    async () => {
      const a = await build({ pipelineColumnPacking: "shorten" });
      const b = await build({ pipelineColumnPacking: "shorten" });
      expect(canonicalize(a.elements)).toEqual(canonicalize(b.elements));
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  // --- coordRepack (M5b coordinated per-column re-pack) ------------------------

  it(
    "forwards pipelineCoordRepack (M5b) to the engine — OFF byte-identical, ON echoed (with straighten), gates clean",
    async () => {
      const off = await build({});
      const straightenOnly = await build({ pipelineStraighten: true });
      const repack = await build({
        pipelineStraighten: true,
        pipelineCoordRepack: true,
      });

      // 1. OFF: the flag is absent ⇒ not advertised in meta, and byte-identical.
      expect(off.meta.pipelineCoordRepack ?? false).toBe(false);
      expect(off.meta.rcllCoordRepack ?? false).toBe(false);

      // 2. ON (with straighten) reaches the engine: both echoes flip true.
      expect(repack.meta.pipelineCoordRepack).toBe(true);
      expect(repack.meta.rcllCoordRepack).toBe(true);
      // straighten alone never advertises the re-pack.
      expect(straightenOnly.meta.pipelineCoordRepack ?? false).toBe(false);
      expect(straightenOnly.meta.rcllCoordRepack ?? false).toBe(false);

      // 3. Structural gates stay clean — the re-pack is Y+order only, X never moves
      //    (CON-12) and it is non-overlap + crossing-preserving by construction.
      const gates = repack.meta.gates as
        | {
            collisions?: number;
            acyclicBackwardEdges?: number;
            acyclicSameColumnEdges?: number;
            semanticEdgeViolations?: number;
          }
        | undefined;
      expect(gates?.collisions ?? 0).toBe(0);
      expect(gates?.acyclicBackwardEdges ?? 0).toBe(0);
      expect(gates?.acyclicSameColumnEdges ?? 0).toBe(0);
      expect(gates?.semanticEdgeViolations ?? 0).toBe(0);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 10,
  );

  it(
    "suppresses pipelineCoordRepack without straighten (footgun stays observable, byte-identical to OFF)",
    async () => {
      const off = await build({});
      const footgun = await build({ pipelineCoordRepack: true });
      // The guard drops it (no straightened result to refine) and surfaces the reason;
      // the layout is byte-identical to the plain default (a safe no-op).
      expect(footgun.meta.pipelineCoordRepack ?? false).toBe(false);
      expect(footgun.meta.rcllCoordRepack ?? false).toBe(false);
      expect(footgun.meta.pipelineCoordRepackSuppressed).toBe(true);
      expect(canonicalize(footgun.elements)).toEqual(
        canonicalize(off.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 6,
  );

  it(
    "pipelineCoordRepack is deterministic (CON-8)",
    async () => {
      const a = await build({
        pipelineStraighten: true,
        pipelineCoordRepack: true,
      });
      const b = await build({
        pipelineStraighten: true,
        pipelineCoordRepack: true,
      });
      expect(canonicalize(a.elements)).toEqual(canonicalize(b.elements));
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  // --- "Layout" profile (terraformPipelineLayoutProfiles) ---------------------

  it(
    "pipelineLayoutProfile=balanced is the identity — OFF byte-identical, no meta",
    async () => {
      const off = await build({});
      const balanced = await build({ pipelineLayoutProfile: "balanced" });
      // balanced expands to today's exact defaults ⇒ canonicalized geometry equal
      // AND the profile is omitted from meta (like columnPacking:"none").
      expect(canonicalize(balanced.elements)).toEqual(
        canonicalize(off.elements),
      );
      expect(balanced.meta.pipelineLayoutProfile).toBeUndefined();
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "pipelineLayoutProfile=compact reaches the engine and expands into the flags",
    async () => {
      const compact = await build({ pipelineLayoutProfile: "compact" });
      // The profile is echoed (non-balanced) and its bundle is expanded: lane-rise
      // + lane-split + subnet de-band + column compaction all show up in meta.
      expect(compact.meta.pipelineLayoutProfile).toBe("compact");
      expect(compact.meta.pipelineSwimlaneLaneRise).toBe(true);
      expect(compact.meta.pipelineRankSeparate).toBe(true);
      expect(compact.meta.pipelineSubnetDeBand).toBe(true);
      expect(compact.meta.pipelineColumnPacking).toBe("compact");
      // compact is shorter than the balanced default (height-shrinking composition).
      const balanced = await build({});
      expect(sceneHeight(compact.elements)).toBeLessThanOrEqual(
        sceneHeight(balanced.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 10,
  );

  it(
    "an explicit individual flag overrides the profile",
    async () => {
      // compact would set rankSeparate=true; explicitly forcing the lane-split off
      // (and the rise off) must win over the profile.
      const overridden = await build({
        pipelineLayoutProfile: "compact",
        pipelineSwimlaneLaneRise: false,
        pipelineRankSeparate: false,
      });
      expect(overridden.meta.pipelineRankSeparate ?? false).toBe(false);
      expect(overridden.meta.pipelineSwimlaneLaneRise ?? false).toBe(false);
      // The profile is still echoed (the caller asked for it); only the one flag changed.
      expect(overridden.meta.pipelineLayoutProfile).toBe("compact");
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );
});
