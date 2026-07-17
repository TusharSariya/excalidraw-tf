import { describe, expect, it } from "vitest";

import {
  buildTerraformDemoUrl,
  buildTerraformDemoUrlFromSettings,
  collectTerraformDemoParams,
  hasTerraformDemoAutoImportQuery,
  isDemoPathname,
  normalizePresetIdParam,
  parseTerraformDemoUrlParams,
  resolveTerraformFocusSettingsFromDemoParams,
  type TerraformDemoSettingsSnapshot,
  type TerraformDemoUrlParams,
} from "./terraformDemoUrlParams";

const queryOf = (url: string): string => url.slice(url.indexOf("?"));

const baseSnapshot: TerraformDemoSettingsSnapshot = {
  presetId: "staging-extended-localstack-v2",
  view: "rcll",
  pipelineCompact: true,
  pipelineLayoutVariant: "classic",
  pipelinePacked: false,
  pipelinePackedPullLeft: false,
  pipelineIncludeAncillary: false,
  pipelinePrivateApiRegional: false,
  pipelineSemanticPlacement: false,
  pipelineSwimlaneLaneRise: false,
  pipelineReorder: false,
  pipelineCrossingMin: false,
  pipelineDeBandLevel: "none",
  pipelineRankSeparate: false,
  pipelineStraighten: false,
  pipelineCoordRepack: false,
  pipelineColumnPacking: "none",
  pipelineLayoutProfile: "balanced",
  pipelineStaircaseBandOverlap: true,
  strataNetworkSimplexRank: false,
  strataSweeps: 0,
  strataCoordinateRefine: false,
  strataRankSeparate: false,
  strataPackedScoring: false,
  strataPackedScoringEpsilon: 0,
  strataEdgeRouting: false,
  strataBorderRoute: false,
  strataBandCompact: false,
  strataSiftRelocate: false,
  strataCrossWeightPenetration: 1,
  strataCrossWeightEdge: 1,
  moduleLayoutMode: "default",
};

describe("terraformDemoUrlParams", () => {
  describe("isDemoPathname", () => {
    it("matches /demo routes", () => {
      expect(isDemoPathname("/demo")).toBe(true);
      expect(isDemoPathname("/demo/")).toBe(true);
      expect(isDemoPathname("/")).toBe(false);
    });
  });

  describe("normalizePresetIdParam", () => {
    it("accepts slug ids", () => {
      expect(normalizePresetIdParam("staging-multi-state-expanded")).toBe(
        "staging-multi-state-expanded",
      );
    });

    it("rejects unsafe ids", () => {
      expect(normalizePresetIdParam("")).toBeNull();
      expect(normalizePresetIdParam("../etc")).toBeNull();
      expect(normalizePresetIdParam("bad id")).toBeNull();
    });

    it("lowercases preset ids", () => {
      expect(normalizePresetIdParam("Staging-Multi-State")).toBe(
        "staging-multi-state",
      );
    });
  });

  describe("parseTerraformDemoUrlParams", () => {
    it("returns null without preset", () => {
      expect(parseTerraformDemoUrlParams("")).toBeNull();
      expect(parseTerraformDemoUrlParams("?view=semantic")).toBeNull();
    });

    it("parses preset only", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=staging-multi-state-expanded"),
      ).toEqual({
        presetId: "staging-multi-state-expanded",
      });
    });

    it("parses view and pack", () => {
      expect(
        parseTerraformDemoUrlParams(
          "?preset=staging-multi-state-expanded&view=module&pack=box",
        ),
      ).toEqual({
        presetId: "staging-multi-state-expanded",
        view: "module",
        pack: "box",
      });
    });

    it("parses pipeline variant and packed", () => {
      expect(
        parseTerraformDemoUrlParams(
          "?preset=staging-extended-localstack-v2&view=pipeline&pipelineVariant=compound&packed=1",
        ),
      ).toEqual({
        presetId: "staging-extended-localstack-v2",
        view: "pipeline",
        pipelineVariant: "compound",
        packed: true,
      });
      expect(parseTerraformDemoUrlParams("?preset=demo&packed=false")).toEqual({
        presetId: "demo",
        packed: false,
      });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&packed=nope"),
      ).toBeNull();
    });

    it("parses compact", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&view=rcll&compact=1"),
      ).toEqual({
        presetId: "demo",
        view: "rcll",
        compact: true,
      });
      expect(parseTerraformDemoUrlParams("?preset=demo&compact=0")).toEqual({
        presetId: "demo",
        compact: false,
      });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&compact=maybe"),
      ).toBeNull();
    });

    it("parses ancillary", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&view=pipeline&ancillary=1"),
      ).toEqual({
        presetId: "demo",
        view: "pipeline",
        ancillary: true,
      });
      expect(parseTerraformDemoUrlParams("?preset=demo&ancillary=0")).toEqual({
        presetId: "demo",
        ancillary: false,
      });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&ancillary=nope"),
      ).toBeNull();
    });

    it("parses swimlaneRise (RCLL M4 A/B)", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&view=rcll&swimlaneRise=1"),
      ).toEqual({
        presetId: "demo",
        view: "rcll",
        swimlaneRise: true,
      });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&swimlaneRise=0"),
      ).toEqual({
        presetId: "demo",
        swimlaneRise: false,
      });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&swimlaneRise=maybe"),
      ).toBeNull();
    });

    it("parses reorder (RCLL M6 A/B)", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&view=rcll&reorder=1"),
      ).toEqual({
        presetId: "demo",
        view: "rcll",
        reorder: true,
      });
      expect(parseTerraformDemoUrlParams("?preset=demo&reorder=0")).toEqual({
        presetId: "demo",
        reorder: false,
      });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&reorder=maybe"),
      ).toBeNull();
    });

    it("parses crossingMin (RCLL M6c container-aware crossing-min)", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&view=rcll&crossingMin=1"),
      ).toEqual({
        presetId: "demo",
        view: "rcll",
        crossingMin: true,
      });
      expect(parseTerraformDemoUrlParams("?preset=demo&crossingMin=0")).toEqual(
        {
          presetId: "demo",
          crossingMin: false,
        },
      );
      expect(
        parseTerraformDemoUrlParams("?preset=demo&crossingMin=maybe"),
      ).toBeNull();
    });

    it("parses subnetDeBand (legacy alias ⇒ deBandLevel=subnet)", () => {
      // The legacy boolean is preserved AND mapped to the generalized de-band enum.
      expect(
        parseTerraformDemoUrlParams("?preset=demo&view=rcll&subnetDeBand=1"),
      ).toEqual({
        presetId: "demo",
        view: "rcll",
        subnetDeBand: true,
        deBandLevel: "subnet",
      });
      // `subnetDeBand=0` does not synthesize a level (stays "none" downstream).
      expect(
        parseTerraformDemoUrlParams("?preset=demo&subnetDeBand=0"),
      ).toEqual({
        presetId: "demo",
        subnetDeBand: false,
      });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&subnetDeBand=maybe"),
      ).toBeNull();
    });

    it("parses deBandLevel (RCLL hierarchy-level de-band depth)", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&view=rcll&deBandLevel=vpc"),
      ).toEqual({
        presetId: "demo",
        view: "rcll",
        deBandLevel: "vpc",
      });
      // Case-insensitive; explicit level wins over a co-present alias.
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&subnetDeBand=1&deBandLevel=Region",
        ),
      ).toEqual({
        presetId: "demo",
        subnetDeBand: true,
        deBandLevel: "region",
      });
      // Invalid level hard-fails (same contract as columnPacking / profile).
      expect(
        parseTerraformDemoUrlParams("?preset=demo&deBandLevel=datacenter"),
      ).toBeNull();
    });

    it("parses rankSeparate (RCLL M8r A/B)", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&view=rcll&rankSeparate=1"),
      ).toEqual({ presetId: "demo", view: "rcll", rankSeparate: true });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&rankSeparate=0"),
      ).toEqual({ presetId: "demo", rankSeparate: false });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&rankSeparate=maybe"),
      ).toBeNull();
    });

    it("parses straighten (RCLL M5 A/B)", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&view=rcll&straighten=1"),
      ).toEqual({ presetId: "demo", view: "rcll", straighten: true });
      expect(parseTerraformDemoUrlParams("?preset=demo&straighten=0")).toEqual({
        presetId: "demo",
        straighten: false,
      });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&straighten=maybe"),
      ).toBeNull();
    });

    it("parses deDensify (RCLL M5b A/B) — legacy alias maps to columnPacking=spread", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&view=rcll&deDensify=1"),
      ).toEqual({
        presetId: "demo",
        view: "rcll",
        deDensify: true,
        columnPacking: "spread",
      });
      expect(parseTerraformDemoUrlParams("?preset=demo&deDensify=0")).toEqual({
        presetId: "demo",
        deDensify: false,
      });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&deDensify=maybe"),
      ).toBeNull();
    });

    it("parses columnPacking (RCLL M5b/M5c tri-state) and rejects invalid", () => {
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=rcll&columnPacking=compact",
        ),
      ).toEqual({ presetId: "demo", view: "rcll", columnPacking: "compact" });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&columnPacking=none"),
      ).toEqual({ presetId: "demo", columnPacking: "none" });
      // explicit columnPacking wins over a legacy deDensify=1
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&deDensify=1&columnPacking=compact",
        ),
      ).toEqual({
        presetId: "demo",
        deDensify: true,
        columnPacking: "compact",
      });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&columnPacking=sideways"),
      ).toBeNull();
    });

    it("parses columnPacking=shorten (X-axis network-simplex bundle)", () => {
      // "shorten" is a valid VALID_COLUMN_PACKING member (case-insensitive).
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=rcll&columnPacking=shorten",
        ),
      ).toEqual({ presetId: "demo", view: "rcll", columnPacking: "shorten" });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&columnPacking=SHORTEN"),
      ).toEqual({ presetId: "demo", columnPacking: "shorten" });
    });

    it("parses profile (RCLL Layout profile) and rejects invalid", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&view=rcll&profile=compact"),
      ).toEqual({ presetId: "demo", view: "rcll", profile: "compact" });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&profile=readable"),
      ).toEqual({ presetId: "demo", profile: "readable" });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&profile=balanced"),
      ).toEqual({ presetId: "demo", profile: "balanced" });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&profile=sideways"),
      ).toBeNull();
    });

    it("accepts clear aliases (laneRise/laneSplit/cycleRise) for the milestone params", () => {
      // laneRise ⇒ swimlaneRise
      expect(parseTerraformDemoUrlParams("?preset=demo&laneRise=1")).toEqual({
        presetId: "demo",
        swimlaneRise: true,
      });
      // laneSplit ⇒ rankSeparate
      expect(parseTerraformDemoUrlParams("?preset=demo&laneSplit=1")).toEqual({
        presetId: "demo",
        rankSeparate: true,
      });
      // cycleRise ⇒ staircaseBandOverlap
      expect(parseTerraformDemoUrlParams("?preset=demo&cycleRise=0")).toEqual({
        presetId: "demo",
        staircaseBandOverlap: false,
      });
      // the legacy milestone name still works
      expect(
        parseTerraformDemoUrlParams("?preset=demo&swimlaneRise=1"),
      ).toEqual({ presetId: "demo", swimlaneRise: true });
      // an invalid alias value hard-fails
      expect(
        parseTerraformDemoUrlParams("?preset=demo&laneSplit=maybe"),
      ).toBeNull();
    });

    it("parses staircaseBandOverlap (RCLL DEC-1, default on — only =0 is meaningful)", () => {
      // Default on: absent ⇒ omitted (engine default true downstream).
      expect(parseTerraformDemoUrlParams("?preset=demo&view=rcll")).toEqual({
        presetId: "demo",
        view: "rcll",
      });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&staircaseBandOverlap=0"),
      ).toEqual({ presetId: "demo", staircaseBandOverlap: false });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&staircaseBandOverlap=maybe"),
      ).toBeNull();
    });

    it("rejects invalid view or pack", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&view=invalid"),
      ).toBeNull();
      expect(
        parseTerraformDemoUrlParams("?preset=demo&pack=invalid"),
      ).toBeNull();
      expect(parseTerraformDemoUrlParams("?preset=bad id")).toBeNull();
    });

    it("parses view=rcll (deep-link)", () => {
      expect(
        parseTerraformDemoUrlParams(
          "?preset=staging-extended-localstack-v2&view=rcll",
        ),
      ).toEqual({
        presetId: "staging-extended-localstack-v2",
        view: "rcll",
      });
    });

    it("parses view=strata (deep-link)", () => {
      expect(
        parseTerraformDemoUrlParams(
          "?preset=staging-extended-localstack-v2&view=strata",
        ),
      ).toEqual({
        presetId: "staging-extended-localstack-v2",
        view: "strata",
      });
    });

    it("parses strata engine flags (strataNsRank/strataSweeps/strataCoordRefine/strataRankSep)", () => {
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=strata&strataNsRank=1&strataSweeps=4&strataCoordRefine=1&strataRankSep=1&strataPackedScoring=1",
        ),
      ).toEqual({
        presetId: "demo",
        view: "strata",
        strataNsRank: true,
        strataSweeps: 4,
        strataCoordRefine: true,
        strataRankSeparate: true,
        strataPackedScoring: true,
      });
    });

    it("omits strataPackedScoring when the URL does not carry it", () => {
      const params = parseTerraformDemoUrlParams("?preset=demo&view=strata");
      expect(params).not.toBeNull();
      expect(params!.strataPackedScoring).toBeUndefined();
    });

    it("parses strataBandCompact and omits it when the URL does not carry it", () => {
      const on = parseTerraformDemoUrlParams(
        "?preset=demo&view=strata&strataBandCompact=1",
      );
      expect(on).not.toBeNull();
      expect(on!.strataBandCompact).toBe(true);
      const bare = parseTerraformDemoUrlParams("?preset=demo&view=strata");
      expect(bare).not.toBeNull();
      expect(bare!.strataBandCompact).toBeUndefined();
    });

    it("rejects junk strataBandCompact", () => {
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=strata&strataBandCompact=maybe",
        ),
      ).toBeNull();
    });

    it("parses strataBandDepth and omits it when the URL does not carry it", () => {
      const on = parseTerraformDemoUrlParams(
        "?preset=demo&view=strata&strataBandDepth=root",
      );
      expect(on).not.toBeNull();
      expect(on!.strataBandDepth).toBe("root");
      const bare = parseTerraformDemoUrlParams("?preset=demo&view=strata");
      expect(bare).not.toBeNull();
      expect(bare!.strataBandDepth).toBeUndefined();
    });

    it("parses every strataBandDepth role (exact-case, incl. mixed-case subnetZone)", () => {
      for (const role of [
        "root",
        "provider",
        "account",
        "region",
        "vpc",
        "subnetZone",
      ] as const) {
        expect(
          parseTerraformDemoUrlParams(
            `?preset=demo&view=strata&strataBandDepth=${role}`,
          )!.strataBandDepth,
        ).toBe(role);
      }
    });

    it("rejects a genuinely-bogus strataBandDepth but canonicalizes case (S3-7)", () => {
      // Disposition c09 §7.3 / S3-7: strataBandDepth is now case-INSENSITIVE
      // like every other enum param — a case slip no longer hard-fails the URL.
      // A bogus role still rejects the whole URL.
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=strata&strataBandDepth=bogus",
        ),
      ).toBeNull();
      // Lowercased "subnetzone" now canonicalizes to "subnetZone" (was: reject).
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=strata&strataBandDepth=subnetzone",
        )?.strataBandDepth,
      ).toBe("subnetZone");
    });

    it("legacy strataBandCompact=1 still parses on its own (alias fold-in happens downstream, not in the parser)", () => {
      const legacy = parseTerraformDemoUrlParams(
        "?preset=demo&view=strata&strataBandCompact=1",
      );
      expect(legacy).not.toBeNull();
      expect(legacy!.strataBandCompact).toBe(true);
      expect(legacy!.strataBandDepth).toBeUndefined();
    });

    it("explicit strataBandDepth and legacy strataBandCompact can both parse from the same URL (precedence is resolved downstream)", () => {
      const both = parseTerraformDemoUrlParams(
        "?preset=demo&view=strata&strataBandDepth=region&strataBandCompact=1",
      );
      expect(both).not.toBeNull();
      expect(both!.strataBandDepth).toBe("region");
      expect(both!.strataBandCompact).toBe(true);
    });

    it("parses strataPackedEps (integer, and fractional relative mode)", () => {
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=strata&strataPackedScoring=1&strataPackedEps=1",
        ),
      ).toEqual({
        presetId: "demo",
        view: "strata",
        strataPackedScoring: true,
        strataPackedEps: 1,
      });
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=strata&strataPackedEps=0.01",
        )!.strataPackedEps,
      ).toBe(0.01);
    });

    it("rejects a negative or non-numeric strataPackedEps", () => {
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=strata&strataPackedEps=-1",
        ),
      ).toBeNull();
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=strata&strataPackedEps=abc",
        ),
      ).toBeNull();
    });

    it("rejects a fractional strataPackedEps >= 1 (absolute mode must be integer)", () => {
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=strata&strataPackedEps=1.5",
        ),
      ).toBeNull();
    });

    it("accepts strataPackedEps=0.5 (relative mode, fractional < 1 is valid)", () => {
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=strata&strataPackedEps=0.5",
        )!.strataPackedEps,
      ).toBe(0.5);
    });

    it("accepts strataPackedEps=2 (absolute mode, integer)", () => {
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=strata&strataPackedEps=2",
        )!.strataPackedEps,
      ).toBe(2);
    });

    it("parses strataEdgeRouting and omits it when the URL does not carry it", () => {
      const on = parseTerraformDemoUrlParams(
        "?preset=demo&view=strata&strataEdgeRouting=1",
      );
      expect(on).toMatchObject({ strataEdgeRouting: true });
      const off = parseTerraformDemoUrlParams(
        "?preset=demo&view=strata&strataEdgeRouting=0",
      );
      expect(off).toMatchObject({ strataEdgeRouting: false });
      const absent = parseTerraformDemoUrlParams("?preset=demo&view=strata");
      expect(absent!.strataEdgeRouting).toBeUndefined();
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=strata&strataEdgeRouting=maybe",
        ),
      ).toBeNull();
    });

    it("omits strataPackedEps when the URL does not carry it", () => {
      const params = parseTerraformDemoUrlParams("?preset=demo&view=strata");
      expect(params).not.toBeNull();
      expect(params!.strataPackedEps).toBeUndefined();
    });

    it("rejects a non-integer or negative strataSweeps", () => {
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=strata&strataSweeps=abc",
        ),
      ).toBeNull();
      expect(
        parseTerraformDemoUrlParams("?preset=demo&view=strata&strataSweeps=-1"),
      ).toBeNull();
    });

    it("rejects the retired view=experimental (graceful, no auto-import)", () => {
      // Experimental was removed at M0; a stale deep-link must degrade to null,
      // not crash or silently import the wrong view.
      expect(
        parseTerraformDemoUrlParams("?preset=demo&view=experimental"),
      ).toBeNull();
    });
  });

  describe("hasTerraformDemoAutoImportQuery", () => {
    it("detects auto-import queries", () => {
      expect(hasTerraformDemoAutoImportQuery("?preset=demo")).toBe(true);
      expect(hasTerraformDemoAutoImportQuery("?view=semantic")).toBe(false);
    });
  });

  describe("buildTerraformDemoUrl", () => {
    it("emits a /demo path with the preset and origin", () => {
      const url = buildTerraformDemoUrl(
        { presetId: "demo", view: "rcll" },
        { origin: "https://tfdraw.dev" },
      );
      expect(url.startsWith("https://tfdraw.dev/demo?")).toBe(true);
      expect(url).toContain("preset=demo");
      expect(url).toContain("view=rcll");
    });

    it("serializes booleans as 1/0 and skips undefined fields", () => {
      const url = buildTerraformDemoUrl({
        presetId: "demo",
        ancillary: true,
        compact: false,
      });
      const params = new URLSearchParams(queryOf(url).slice(1));
      expect(params.get("ancillary")).toBe("1");
      expect(params.get("compact")).toBe("0");
      expect(params.has("reorder")).toBe(false);
    });

    it("round-trips every demo param through the parser", () => {
      const full: TerraformDemoUrlParams = {
        presetId: "staging-extended-localstack-v2",
        view: "rcll",
        compact: false,
        ancillary: true,
        swimlaneRise: true,
        reorder: true,
        crossingMin: true,
        deBandLevel: "region",
        rankSeparate: true,
        straighten: true,
        columnPacking: "compact",
        staircaseBandOverlap: false,
      };
      expect(
        parseTerraformDemoUrlParams(queryOf(buildTerraformDemoUrl(full))),
      ).toEqual(full);
    });

    it("round-trips strata view + engine flags through the parser", () => {
      const full: TerraformDemoUrlParams = {
        presetId: "staging-extended-localstack-v2",
        view: "strata",
        compact: false,
        ancillary: true,
        strataNsRank: true,
        strataSweeps: 4,
        strataCoordRefine: true,
        strataRankSeparate: true,
        strataPackedScoring: true,
        strataPackedEps: 2,
        strataBandCompact: true,
        strataPackedConverge: true,
        strataTransitiveAdopt: true,
        strataBlockClamp: true,
        strataLeafShift: true,
      };
      expect(
        parseTerraformDemoUrlParams(queryOf(buildTerraformDemoUrl(full))),
      ).toEqual(full);
    });

    it("round-trips strataLeafShift on/off through build+parse", () => {
      const on: TerraformDemoUrlParams = {
        presetId: "staging-extended-localstack-v2",
        view: "strata",
        strataLeafShift: true,
      };
      expect(
        parseTerraformDemoUrlParams(queryOf(buildTerraformDemoUrl(on))),
      ).toEqual(on);
      // default-off ⇒ no param emitted (byte-identity).
      const off = buildTerraformDemoUrl({ presetId: "demo", view: "strata" });
      expect(queryOf(off)).not.toContain("strataLeafShift");
    });

    it("round-trips strataBandDepth through build+parse", () => {
      const full: TerraformDemoUrlParams = {
        presetId: "staging-extended-localstack-v2",
        view: "strata",
        strataSweeps: 4,
        strataBandDepth: "root",
      };
      expect(
        parseTerraformDemoUrlParams(queryOf(buildTerraformDemoUrl(full))),
      ).toEqual(full);
    });

    it("emits no strataBandDepth param when the field is absent (byte-identity)", () => {
      const url = buildTerraformDemoUrl({
        presetId: "demo",
        view: "strata",
        strataSweeps: 4,
      });
      expect(queryOf(url)).not.toContain("strataBandDepth");
    });
  });

  describe("collectTerraformDemoParams", () => {
    it("semantic view carries only preset + view", () => {
      expect(
        collectTerraformDemoParams({ ...baseSnapshot, view: "semantic" }),
      ).toEqual({ presetId: baseSnapshot.presetId, view: "semantic" });
    });

    it("module view emits pack only when non-default", () => {
      expect(
        collectTerraformDemoParams({
          ...baseSnapshot,
          view: "module",
          moduleLayoutMode: "default",
        }),
      ).toEqual({ presetId: baseSnapshot.presetId, view: "module" });
      expect(
        collectTerraformDemoParams({
          ...baseSnapshot,
          view: "module",
          moduleLayoutMode: "rectpacking",
        }).pack,
      ).toBe("rectpacking");
    });

    it("pipeline view captures variant, packing, ancillary, placement", () => {
      const params = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "pipeline",
        pipelineLayoutVariant: "compound",
        pipelinePacked: true,
        pipelinePackedPullLeft: true,
        pipelineIncludeAncillary: true,
        pipelineSemanticPlacement: true,
      });
      expect(params).toMatchObject({
        view: "pipeline",
        pipelineVariant: "compound",
        packed: true,
        packedPullLeft: true,
        ancillary: true,
        semanticPlace: true,
      });
    });

    it("rcll view with a named profile emits profile, not raw flags", () => {
      const params = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "rcll",
        pipelineLayoutProfile: "compact",
      });
      expect(params.profile).toBe("compact");
      expect(params.swimlaneRise).toBeUndefined();
      expect(params.straighten).toBeUndefined();
      // Independent toggles are still captured.
      expect(params.compact).toBe(true);
      expect(params.ancillary).toBe(false);
    });

    it("pipeline + rcll views never serialize privateApiRegional (strata-only)", () => {
      // The flag is view-scoped to strata; a non-strata snapshot that happens to
      // carry it true must NOT emit the param, so non-strata share URLs stay
      // byte-identical (and never advertise a placement they won't apply).
      const pipeline = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "pipeline",
        pipelinePrivateApiRegional: true,
      });
      expect("privateApiRegional" in pipeline).toBe(false);
      const rcll = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "rcll",
        pipelinePrivateApiRegional: true,
      });
      expect("privateApiRegional" in rcll).toBe(false);
    });

    it("rcll view with a custom profile spells out the eight flags", () => {
      const params = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "rcll",
        pipelineLayoutProfile: "custom",
        pipelineSwimlaneLaneRise: true,
        pipelineRankSeparate: true,
        pipelineDeBandLevel: "vpc",
        pipelineStaircaseBandOverlap: false,
        pipelineReorder: true,
        pipelineCrossingMin: true,
        pipelineStraighten: true,
        pipelineColumnPacking: "spread",
      });
      expect(params.profile).toBeUndefined();
      expect(params).toMatchObject({
        swimlaneRise: true,
        rankSeparate: true,
        deBandLevel: "vpc",
        staircaseBandOverlap: false,
        reorder: true,
        crossingMin: true,
        straighten: true,
        columnPacking: "spread",
      });
    });

    it("strata view always emits the engine flags explicitly (both states)", () => {
      // Post-W5 default flip: a truthy-only emit would make a turned-OFF share
      // URL silently re-import with the (now ON) dialog defaults.
      const params = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
      });
      expect(params).toEqual({
        presetId: baseSnapshot.presetId,
        view: "strata",
        compact: true,
        ancillary: false,
        // Strata defaults private-API regional placement ON, so it is emitted
        // in both states too (here the baseSnapshot's OFF ⇒ explicit false).
        privateApiRegional: false,
        strataSweeps: 0,
        strataCoordRefine: false,
        strataRankSeparate: false,
        // owner-decisions.md 2026-07-17: packedScoring/sift/transpose flipped to
        // default ON, so they now emit EXPLICITLY (both states) too — here the
        // baseSnapshot's OFF ⇒ explicit false (transpose absent ⇒ false).
        strataPackedScoring: false,
        strataSift: false,
        strataTranspose: false,
        // ε default flipped to 1; the baseSnapshot's ε=0 is non-default ⇒ emitted.
        strataPackedEps: 0,
      });
    });

    it("strata view emits set engine flags (strataNsRank stays truthy-only)", () => {
      const params = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
        pipelineIncludeAncillary: true,
        strataNetworkSimplexRank: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataRankSeparate: true,
      });
      expect(params).toMatchObject({
        view: "strata",
        ancillary: true,
        strataNsRank: true,
        strataSweeps: 4,
        strataCoordRefine: true,
        strataRankSeparate: true,
      });
    });

    it("strataLeafShift emits truthy-only in the strata collect", () => {
      const off = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
      });
      expect("strataLeafShift" in off).toBe(false);
      const on = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
        strataLeafShift: true,
      });
      expect(on.strataLeafShift).toBe(true);
    });

    it("strataPackedScoring emits explicitly in both states (owner default-ON flip 2026-07-17)", () => {
      const off = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
      });
      // Default-ON flag: a turned-OFF share must carry an explicit 0, not omit
      // (else the recipient re-imports with the ON default).
      expect(off.strataPackedScoring).toBe(false);
      const on = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
        strataPackedScoring: true,
      });
      expect(on.strataPackedScoring).toBe(true);
    });

    it("strataSift + strataTranspose emit explicitly in both states (owner default-ON flip 2026-07-17)", () => {
      const off = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
      });
      expect(off.strataSift).toBe(false);
      expect(off.strataTranspose).toBe(false);
      const on = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
        strataSiftRelocate: true,
        strataTranspose: true,
      });
      expect(on.strataSift).toBe(true);
      expect(on.strataTranspose).toBe(true);
    });

    it("strataEdgeRouting emits truthy-only (like strataPackedScoring)", () => {
      const off = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
      });
      expect("strataEdgeRouting" in off).toBe(false);
      const on = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
        strataEdgeRouting: true,
      });
      expect(on.strataEdgeRouting).toBe(true);
    });

    it("strataBandCompact emits truthy-only (like strataPackedScoring)", () => {
      const off = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
      });
      expect("strataBandCompact" in off).toBe(false);
      const on = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
        strataBandCompact: true,
      });
      expect(on.strataBandCompact).toBe(true);
    });

    it("strataBandDepth emits only when != default 'account' (never truthy-gated — a nonempty string is always truthy)", () => {
      const absent = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
      });
      expect("strataBandDepth" in absent).toBe(false);

      const explicitDefault = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
        strataBandDepth: "account",
      });
      expect("strataBandDepth" in explicitDefault).toBe(false);

      const nonDefault = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
        strataBandDepth: "root",
      });
      expect(nonDefault.strataBandDepth).toBe("root");
    });

    it("strataPackedScoringEpsilon emits non-default-only as strataPackedEps (owner default ε=1 2026-07-17)", () => {
      // ε default flipped to 1; emit only when it diverges from 1 (absent
      // resolves to 1). An explicit 0 is non-default ⇒ emitted (round-trips).
      const atDefault = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
        strataPackedScoring: true,
        strataPackedScoringEpsilon: 1,
      });
      expect("strataPackedEps" in atDefault).toBe(false);
      const explicitZero = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
        strataPackedScoring: true,
        strataPackedScoringEpsilon: 0,
      });
      expect(explicitZero.strataPackedEps).toBe(0);
      const on = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
        strataPackedScoring: true,
        strataPackedScoringEpsilon: 2,
      });
      expect(on.strataPackedEps).toBe(2);
    });

    it("strata K=0 snapshot round-trips as an explicit K=0 URL", () => {
      const params = collectTerraformDemoParams({
        ...baseSnapshot,
        view: "strata",
        strataSweeps: 0,
        strataCoordinateRefine: false,
        strataRankSeparate: false,
      });
      const reparsed = parseTerraformDemoUrlParams(
        queryOf(buildTerraformDemoUrl(params)),
      );
      expect(reparsed).toMatchObject({
        view: "strata",
        strataSweeps: 0,
        strataCoordRefine: false,
        strataRankSeparate: false,
      });
    });
  });

  describe("buildTerraformDemoUrlFromSettings", () => {
    it("round-trips a custom rcll snapshot through the parser", () => {
      const snapshot: TerraformDemoSettingsSnapshot = {
        ...baseSnapshot,
        view: "rcll",
        pipelineCompact: false,
        pipelineIncludeAncillary: true,
        pipelineLayoutProfile: "custom",
        pipelineSwimlaneLaneRise: true,
        pipelineRankSeparate: true,
        pipelineDeBandLevel: "account",
        pipelineStaircaseBandOverlap: false,
        pipelineReorder: true,
        pipelineCrossingMin: true,
        pipelineStraighten: true,
        pipelineColumnPacking: "compact",
      };
      const parsed = parseTerraformDemoUrlParams(
        queryOf(buildTerraformDemoUrlFromSettings(snapshot)),
      );
      expect(parsed).toEqual(collectTerraformDemoParams(snapshot));
    });

    it("round-trips a strata snapshot (engine flags on) through the parser", () => {
      const snapshot: TerraformDemoSettingsSnapshot = {
        ...baseSnapshot,
        view: "strata",
        pipelineCompact: false,
        pipelineIncludeAncillary: true,
        strataNetworkSimplexRank: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
        strataRankSeparate: true,
      };
      const parsed = parseTerraformDemoUrlParams(
        queryOf(buildTerraformDemoUrlFromSettings(snapshot)),
      );
      expect(parsed).toEqual(collectTerraformDemoParams(snapshot));
    });

    it("round-trips an explicit private-API-regional OFF in the strata view", () => {
      // Strata defaults the flag ON, so the serialize branch must emit it in
      // both states — an explicit OFF has to survive share→reload rather than
      // being dropped and silently re-defaulting ON.
      const snapshot: TerraformDemoSettingsSnapshot = {
        ...baseSnapshot,
        view: "strata",
        pipelinePrivateApiRegional: false,
      };
      const url = buildTerraformDemoUrlFromSettings(snapshot);
      expect(queryOf(url)).toContain("privateApiRegional=0");
      const parsed = parseTerraformDemoUrlParams(queryOf(url));
      expect(parsed!.privateApiRegional).toBe(false);
      expect(parsed).toEqual(collectTerraformDemoParams(snapshot));
    });
  });

  describe("runtime canvas view settings", () => {
    it("parses lod, minimap, layers, and canvasPerf", () => {
      const parsed = parseTerraformDemoUrlParams(
        "?preset=demo&view=rcll&lodEnabled=0&lodPreset=detailed&minimap=1" +
          "&layers=dep,net&canvasPerf=hideicons,noclip&canvasPerfZoom=0.4",
      );
      expect(parsed).toMatchObject({
        presetId: "demo",
        view: "rcll",
        lodEnabled: false,
        lodPreset: "detailed",
        minimap: true,
        edgeLayerPins: {
          dependency: true,
          networking: true,
          dataFlow: false,
          declaredDataFlow: false,
          topologyFrameFlow: false,
        },
        runtimePerformance: {
          hideAwsIconGlyphsBelowZoom: true,
          suppressFrameClippingBelowZoom: true,
          suppressHoverFocusBelowZoom: false,
          debounceHoverFocus: false,
          skipBindingRepairDuringFocus: false,
          lowZoomThreshold: 0.4,
        },
      });
    });

    it("treats layers=none and canvasPerf=none as all-off", () => {
      const parsed = parseTerraformDemoUrlParams(
        "?preset=demo&layers=none&canvasPerf=none",
      );
      expect(parsed?.edgeLayerPins).toEqual({
        dependency: false,
        dataFlow: false,
        declaredDataFlow: false,
        networking: false,
        topologyFrameFlow: false,
      });
      expect(parsed?.runtimePerformance?.hideAwsIconGlyphsBelowZoom).toBe(
        false,
      );
    });

    it("hard-fails on an unknown layer code or perf threshold", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&layers=dep,bogus"),
      ).toBeNull();
      expect(
        parseTerraformDemoUrlParams("?preset=demo&canvasPerfZoom=0.9"),
      ).toBeNull();
      expect(
        parseTerraformDemoUrlParams("?preset=demo&lodPreset=ultra"),
      ).toBeNull();
    });

    it("parses focusdir (W11 WP1) and omits it when absent", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&view=rcll&focusdir=deps"),
      ).toMatchObject({ focusDirection: "dependencies" });
      expect(
        parseTerraformDemoUrlParams(
          "?preset=demo&view=rcll&focusdir=dependents",
        ),
      ).toMatchObject({ focusDirection: "dependents" });
      const absent = parseTerraformDemoUrlParams("?preset=demo&view=rcll");
      expect(absent).not.toBeNull();
      expect(absent!.focusDirection).toBeUndefined();
    });

    it("rejects an unknown focusdir code (including the default 'both')", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focusdir=both"),
      ).toBeNull();
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focusdir=downstream"),
      ).toBeNull();
    });

    it("parses focushops=all (W11 WP1) as Infinity and omits it when absent", () => {
      const all = parseTerraformDemoUrlParams(
        "?preset=demo&view=rcll&focushops=all",
      );
      expect(all).not.toBeNull();
      expect(all!.focusMaxHops).toBe(Infinity);
      const absent = parseTerraformDemoUrlParams("?preset=demo&view=rcll");
      expect(absent).not.toBeNull();
      expect(absent!.focusMaxHops).toBeUndefined();
    });

    it("parses finite non-negative focushops caps, including 0 and >99 (W13 WP1)", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focushops=2"),
      ).toMatchObject({ focusMaxHops: 2 });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focushops=99"),
      ).toMatchObject({ focusMaxHops: 99 });
      // 0 = focused node only (W13 WP1); previously this rejected the URL.
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focushops=0"),
      ).toMatchObject({ focusMaxHops: 0 });
      // Boundary: 100 was previously a whole-URL reject (the 1..99 cap).
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focushops=100"),
      ).toMatchObject({ focusMaxHops: 100 });
    });

    it("focushops=0 resolves to terraformFocusMaxHops: 0 (W13 WP1)", () => {
      const parsed = parseTerraformDemoUrlParams("?preset=demo&focushops=0");
      expect(parsed).not.toBeNull();
      expect(resolveTerraformFocusSettingsFromDemoParams(parsed!)).toEqual({
        terraformFocusDirection: "both",
        terraformFocusMaxHops: 0,
      });
    });

    it("rejects focushops values outside 'all' / non-negative safe integers", () => {
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focushops=unlimited"),
      ).toBeNull();
      // Negatives (the -1 stored sentinel included) never appear in URLs.
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focushops=-1"),
      ).toBeNull();
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focushops=-2"),
      ).toBeNull();
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focushops=2.5"),
      ).toBeNull();
    });

    it("rejects non-canonical numeric spellings — lexical form first (W13 F4)", () => {
      // Only `all` or /^(0|[1-9][0-9]*)$/ are accepted; every alias that
      // Number() would coerce rejects the whole URL. (Reverses the W13 WP1
      // "accept iff Number() yields an integer" decimal pin.)
      for (const alias of ["-0", "007", "0x10", "%2B1", "1e2", "2.0"]) {
        expect(
          parseTerraformDemoUrlParams(`?preset=demo&focushops=${alias}`),
          `focushops=${alias} must reject`,
        ).toBeNull();
      }
      // Canonical spellings still accept.
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focushops=0"),
      ).toMatchObject({ focusMaxHops: 0 });
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focushops=100"),
      ).toMatchObject({ focusMaxHops: 100 });
      // Canonical digits beyond Number.MAX_SAFE_INTEGER still reject.
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focushops=9007199254740992"),
      ).toBeNull();
    });

    it("round-trips focusdir + focushops=all through build/parse", () => {
      const full: TerraformDemoUrlParams = {
        presetId: "demo",
        view: "rcll",
        focusDirection: "dependents",
        focusMaxHops: Infinity,
      };
      expect(
        parseTerraformDemoUrlParams(queryOf(buildTerraformDemoUrl(full))),
      ).toEqual(full);
    });

    it("round-trips a finite focushops cap through build/parse (W11 F5)", () => {
      const finite: TerraformDemoUrlParams = {
        presetId: "demo",
        view: "rcll",
        focusMaxHops: 2,
      };
      const url = buildTerraformDemoUrl(finite);
      expect(url).toContain("focushops=2");
      expect(parseTerraformDemoUrlParams(queryOf(url))).toEqual(finite);
    });

    it("never emits focusdir=both; finite caps are emitted numerically", () => {
      const url = buildTerraformDemoUrl({
        presetId: "demo",
        focusDirection: "both",
        focusMaxHops: 3,
      });
      expect(url).not.toContain("focusdir");
      expect(url).toContain("focushops=3");
    });

    it("resolveTerraformFocusSettingsFromDemoParams always yields the full pair (W11 F2)", () => {
      // Omitted params = EXPLICIT defaults, so stale persisted settings reset.
      expect(resolveTerraformFocusSettingsFromDemoParams({})).toEqual({
        terraformFocusDirection: "both",
        terraformFocusMaxHops: null,
      });
      // Infinity (focushops=all) maps to the JSON-safe -1 stored sentinel.
      expect(
        resolveTerraformFocusSettingsFromDemoParams({
          focusDirection: "dependents",
          focusMaxHops: Infinity,
        }),
      ).toEqual({
        terraformFocusDirection: "dependents",
        terraformFocusMaxHops: -1,
      });
      // Finite caps (W11 F5) are stored verbatim.
      expect(
        resolveTerraformFocusSettingsFromDemoParams({ focusMaxHops: 2 }),
      ).toEqual({
        terraformFocusDirection: "both",
        terraformFocusMaxHops: 2,
      });
      // Partial URLs must not leave the other field stale either.
      expect(
        resolveTerraformFocusSettingsFromDemoParams({
          focusDirection: "dependencies",
        }),
      ).toEqual({
        terraformFocusDirection: "dependencies",
        terraformFocusMaxHops: null,
      });
    });

    it("round-trips a full runtime-settings params object", () => {
      const full: TerraformDemoUrlParams = {
        presetId: "demo",
        view: "rcll",
        lodEnabled: true,
        lodPreset: "performance",
        minimap: false,
        edgeLayerPins: {
          dependency: true,
          dataFlow: false,
          declaredDataFlow: true,
          networking: false,
          topologyFrameFlow: true,
        },
        runtimePerformance: {
          hideAwsIconGlyphsBelowZoom: true,
          suppressHoverFocusBelowZoom: false,
          debounceHoverFocus: true,
          suppressFrameClippingBelowZoom: false,
          skipBindingRepairDuringFocus: true,
          lowZoomThreshold: 0.2,
        },
      };
      expect(
        parseTerraformDemoUrlParams(queryOf(buildTerraformDemoUrl(full))),
      ).toEqual(full);
    });
  });
});
