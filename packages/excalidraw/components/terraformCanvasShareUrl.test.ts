import { describe, expect, it } from "vitest";

import {
  buildTerraformCanvasShareUrl,
  deriveViewFromSession,
  type TerraformCanvasViewSettings,
} from "./terraformCanvasShareUrl";
import {
  parseTerraformDemoUrlParams,
  resolveTerraformFocusSettingsFromDemoParams,
} from "./terraformDemoUrlParams";
import { DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS } from "./terraformModuleLayoutOptions";
import { TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS } from "./terraformRuntimePerformance";

import type { TerraformImportSession } from "./terraformImportSession";

const makeSession = (
  overrides: Partial<TerraformImportSession> = {},
): TerraformImportSession =>
  ({
    sources: {} as TerraformImportSession["sources"],
    semanticLayout: false,
    moduleLayoutOptions: DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS,
    preset: {
      id: "staging-extended-localstack-v2",
    } as TerraformImportSession["preset"],
    importedTfdTexts: [],
    snapshot: {
      elements: [],
      terraformEdgeLayerPins: null,
      enableDeclaredDataFlow: false,
    },
    ...overrides,
  } as TerraformImportSession);

const defaultView: TerraformCanvasViewSettings = {
  terraformLodEnabled: true,
  terraformLodPreset: "balanced",
  terraformMinimapEnabled: false,
  terraformEdgeLayerPins: null,
  runtimePerformance: { ...TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS },
  terraformFocusDirection: "both",
  terraformFocusMaxHops: null,
};

const queryOf = (url: string): string => url.slice(url.indexOf("?"));

describe("terraformCanvasShareUrl", () => {
  describe("deriveViewFromSession", () => {
    it("recovers pipeline-family views from layoutMode", () => {
      expect(deriveViewFromSession(makeSession({ layoutMode: "rcll" }))).toBe(
        "rcll",
      );
      expect(
        deriveViewFromSession(makeSession({ layoutMode: "pipeline" })),
      ).toBe("pipeline");
      expect(deriveViewFromSession(makeSession({ layoutMode: "strata" }))).toBe(
        "strata",
      );
    });

    it("falls back to semantic vs module via semanticLayout", () => {
      expect(deriveViewFromSession(makeSession({ semanticLayout: true }))).toBe(
        "semantic",
      );
      expect(
        deriveViewFromSession(makeSession({ semanticLayout: false })),
      ).toBe("module");
    });
  });

  it("returns null without a preset-backed session", () => {
    expect(buildTerraformCanvasShareUrl(null, defaultView)).toBeNull();
    expect(
      buildTerraformCanvasShareUrl(makeSession({ preset: null }), defaultView),
    ).toBeNull();
  });

  it("encodes preset + layout + runtime settings into a /demo URL", () => {
    const session = makeSession({
      layoutMode: "rcll",
      pipelineCompact: false,
      pipelineIncludeAncillary: true,
      pipelineLayoutProfile: "compact",
    });
    const view: TerraformCanvasViewSettings = {
      terraformLodEnabled: false,
      terraformLodPreset: "detailed",
      terraformMinimapEnabled: true,
      terraformEdgeLayerPins: {
        dependency: true,
        dataFlow: false,
        declaredDataFlow: false,
        networking: true,
        topologyFrameFlow: false,
      },
      runtimePerformance: {
        ...TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS,
        hideAwsIconGlyphsBelowZoom: true,
        lowZoomThreshold: 0.4,
      },
      terraformFocusDirection: "both",
      terraformFocusMaxHops: null,
    };
    const url = buildTerraformCanvasShareUrl(session, view, {
      origin: "https://tfdraw.dev",
    });
    expect(url?.startsWith("https://tfdraw.dev/demo?")).toBe(true);
    const parsed = parseTerraformDemoUrlParams(queryOf(url!));
    expect(parsed).toMatchObject({
      presetId: "staging-extended-localstack-v2",
      view: "rcll",
      compact: false,
      ancillary: true,
      profile: "compact",
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
        lowZoomThreshold: 0.4,
      },
    });
  });

  it("encodes a strata session into a /demo URL (view=strata round-trips)", () => {
    const session = makeSession({
      layoutMode: "strata",
      pipelineCompact: false,
      pipelineIncludeAncillary: true,
      strataNetworkSimplexRank: true,
      strataSweeps: 4,
      strataCoordinateRefine: true,
    });
    const url = buildTerraformCanvasShareUrl(session, defaultView, {
      origin: "https://tfdraw.dev",
    });
    expect(url).toContain("view=strata");
    const parsed = parseTerraformDemoUrlParams(queryOf(url!));
    expect(parsed).toMatchObject({
      presetId: "staging-extended-localstack-v2",
      view: "strata",
      compact: false,
      ancillary: true,
      strataNsRank: true,
      strataSweeps: 4,
      strataCoordRefine: true,
    });
  });

  it("strataPackedConverge: default off is omitted from the /demo URL, an ON session round-trips", () => {
    // Default off and absent are byte-identical — the snapshot → URL path must
    // not materialize a default `strataPackedConverge` param.
    const defaultUrl = buildTerraformCanvasShareUrl(
      makeSession({ layoutMode: "strata" }),
      defaultView,
    );
    expect(defaultUrl).toContain("view=strata");
    expect(defaultUrl).not.toContain("strataPackedConverge");

    // An ON session round-trips through the snapshot into the URL.
    const onUrl = buildTerraformCanvasShareUrl(
      makeSession({ layoutMode: "strata", strataPackedConverge: true }),
      defaultView,
    );
    expect(onUrl).toContain("strataPackedConverge=1");
    expect(
      parseTerraformDemoUrlParams(queryOf(onUrl!))?.strataPackedConverge,
    ).toBe(true);
  });

  it("strataTransitiveAdopt: default off is omitted from the /demo URL, an ON session round-trips", () => {
    // Default off and absent are byte-identical — the snapshot → URL path must
    // not materialize a default `strataTransitiveAdopt` param.
    const defaultUrl = buildTerraformCanvasShareUrl(
      makeSession({ layoutMode: "strata" }),
      defaultView,
    );
    expect(defaultUrl).toContain("view=strata");
    expect(defaultUrl).not.toContain("strataTransitiveAdopt");

    // An ON session round-trips through the snapshot into the URL.
    const onUrl = buildTerraformCanvasShareUrl(
      makeSession({ layoutMode: "strata", strataTransitiveAdopt: true }),
      defaultView,
    );
    expect(onUrl).toContain("strataTransitiveAdopt=1");
    expect(
      parseTerraformDemoUrlParams(queryOf(onUrl!))?.strataTransitiveAdopt,
    ).toBe(true);
  });

  it("strataLeafShift: default off is omitted, an ON session round-trips through the share URL (c19 leaf-shift bridge)", () => {
    // C19 fix (share-url-drops-leaf-shift): the session→snapshot bridge dropped
    // strataLeafShift entirely, so a canvas imported with the flag reopened with
    // default-off geometry. Default-off stays byte-identical (never emitted).
    const defaultUrl = buildTerraformCanvasShareUrl(
      makeSession({ layoutMode: "strata" }),
      defaultView,
    );
    expect(defaultUrl).toContain("view=strata");
    expect(defaultUrl).not.toContain("strataLeafShift");

    // An ON session round-trips through the snapshot into the URL.
    const onUrl = buildTerraformCanvasShareUrl(
      makeSession({ layoutMode: "strata", strataLeafShift: true }),
      defaultView,
    );
    expect(onUrl).toContain("strataLeafShift=1");
    expect(parseTerraformDemoUrlParams(queryOf(onUrl!))?.strataLeafShift).toBe(
      true,
    );
  });

  it("strataBandDepth: default cut is omitted from the /demo URL, a non-default cut round-trips (WP4 P2 byte-identity)", () => {
    // Default cut ("account") and absent are byte-identical — the snapshot →
    // URL path must not materialize a default `strataBandDepth` param, matching
    // legacy share links that predate the slider.
    for (const session of [
      makeSession({ layoutMode: "strata" }),
      makeSession({ layoutMode: "strata", strataBandDepth: "account" }),
    ]) {
      const url = buildTerraformCanvasShareUrl(session, defaultView);
      expect(url).toContain("view=strata");
      expect(url).not.toContain("strataBandDepth");
    }

    // A non-default cut round-trips through the snapshot into the URL.
    const nonDefault = buildTerraformCanvasShareUrl(
      makeSession({ layoutMode: "strata", strataBandDepth: "root" }),
      defaultView,
    );
    expect(nonDefault).toContain("strataBandDepth=root");
    expect(
      parseTerraformDemoUrlParams(queryOf(nonDefault!))?.strataBandDepth,
    ).toBe("root");
  });

  it("omits dev perf params when settings are at defaults", () => {
    const url = buildTerraformCanvasShareUrl(
      makeSession({ layoutMode: "rcll" }),
      defaultView,
    );
    expect(url).not.toContain("canvasPerf");
    // LOD + minimap are always emitted so the URL is self-describing.
    expect(url).toContain("lodEnabled=1");
    expect(url).toContain("minimap=0");
  });

  describe("W11 WP1 — relationship-focus view settings", () => {
    it("omits focusdir/focushops at defaults, mirroring edgeLayerPins omission", () => {
      const url = buildTerraformCanvasShareUrl(
        makeSession({ layoutMode: "rcll" }),
        defaultView,
      );
      expect(url).not.toContain("focusdir");
      expect(url).not.toContain("focushops");
    });

    it("emits focusdir + focushops=all from the stored -1 sentinel (real AppState value)", () => {
      const view: TerraformCanvasViewSettings = {
        ...defaultView,
        terraformFocusDirection: "dependents",
        // AppState persists -1 for "unlimited" (never Infinity — JSON-unsafe).
        terraformFocusMaxHops: -1,
      };
      const url = buildTerraformCanvasShareUrl(
        makeSession({ layoutMode: "rcll" }),
        view,
        { origin: "https://tfdraw.dev" },
      );
      const parsed = parseTerraformDemoUrlParams(queryOf(url!));
      expect(parsed).toMatchObject({
        focusDirection: "dependents",
        focusMaxHops: Infinity,
      });
    });

    it("tolerates a runtime Infinity (API misuse) identically to the -1 sentinel", () => {
      const view: TerraformCanvasViewSettings = {
        ...defaultView,
        terraformFocusMaxHops: Infinity,
      };
      const url = buildTerraformCanvasShareUrl(
        makeSession({ layoutMode: "rcll" }),
        view,
      );
      expect(url).toContain("focushops=all");
    });

    it("emits a finite non-null hop cap numerically (W11 F5)", () => {
      const view: TerraformCanvasViewSettings = {
        ...defaultView,
        terraformFocusMaxHops: 2,
      };
      const url = buildTerraformCanvasShareUrl(
        makeSession({ layoutMode: "rcll" }),
        view,
      );
      expect(url).toContain("focushops=2");
      const parsed = parseTerraformDemoUrlParams(queryOf(url!));
      expect(parsed).toMatchObject({ focusMaxHops: 2 });
    });

    it("round-trips a 0 hop cap — focused node only (W13 WP1)", () => {
      const view: TerraformCanvasViewSettings = {
        ...defaultView,
        terraformFocusMaxHops: 0,
      };
      const url = buildTerraformCanvasShareUrl(
        makeSession({ layoutMode: "rcll" }),
        view,
      );
      // 0 must survive the emit (null-check, not truthiness) and the parse.
      expect(url).toContain("focushops=0");
      const parsed = parseTerraformDemoUrlParams(queryOf(url!));
      expect(parsed).toMatchObject({ focusMaxHops: 0 });
      expect(resolveTerraformFocusSettingsFromDemoParams(parsed!)).toEqual({
        terraformFocusDirection: "both",
        terraformFocusMaxHops: 0,
      });
    });

    it("round-trips a >99 hop cap (previously a whole-URL reject — W13 WP1)", () => {
      const view: TerraformCanvasViewSettings = {
        ...defaultView,
        terraformFocusMaxHops: 100,
      };
      const url = buildTerraformCanvasShareUrl(
        makeSession({ layoutMode: "rcll" }),
        view,
      );
      expect(url).toContain("focushops=100");
      const parsed = parseTerraformDemoUrlParams(queryOf(url!));
      expect(parsed).toMatchObject({ focusMaxHops: 100 });
      expect(resolveTerraformFocusSettingsFromDemoParams(parsed!)).toEqual({
        terraformFocusDirection: "both",
        terraformFocusMaxHops: 100,
      });
    });

    it("rejects hand-edited decimal spellings — canonical lexical form only (W13 F4)", () => {
      // REVERSAL of the W13 WP1 pin ("accept iff Number() yields an
      // integer"): per codex F4, the parser validates the LEXICAL form first
      // (`all` or /^(0|[1-9][0-9]*)$/), so `0.0` / `2.0` now reject the whole
      // URL alongside every other non-canonical alias. One spelling per
      // value keeps URLs canonical and round-trip byte-stable.
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focushops=0.0"),
      ).toBeNull();
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focushops=2.0"),
      ).toBeNull();
      expect(
        parseTerraformDemoUrlParams("?preset=demo&focushops=0.5"),
      ).toBeNull();
    });

    it("omits validator-failing hop caps from the share URL (W13 F3)", () => {
      // 1e21 passes Number.isInteger but not Number.isSafeInteger; junk
      // AppState values must never be emitted — the URL omits focushops
      // (omission = the default 3), matching the ingress guard's fallback.
      for (const junk of [1e21, 2.5, NaN, -2]) {
        const view: TerraformCanvasViewSettings = {
          ...defaultView,
          terraformFocusMaxHops: junk,
        };
        const url = buildTerraformCanvasShareUrl(
          makeSession({ layoutMode: "rcll" }),
          view,
        );
        expect(url).not.toContain("focushops");
      }
    });

    it("S5-9: a strata session with field-absent strata options shares its ACTUAL layout (defaults ON, not the inverted false/0)", () => {
      // A strata session that never retained strataSweeps / strataCoordinateRefine
      // / pipelinePrivateApiRegional must round-trip to the strata VIEW defaults
      // (K=4 + A7 + private-API ON), not the old inverted `0`/`false` fallbacks
      // that emitted a worst-arm K=0 / private-API-off geometry. (c09 §6 guard 4.)
      const url = buildTerraformCanvasShareUrl(
        makeSession({ layoutMode: "strata" }),
        defaultView,
      );
      expect(url).not.toBeNull();
      const parsed = parseTerraformDemoUrlParams(queryOf(url!));
      expect(parsed?.view).toBe("strata");
      expect(parsed?.strataSweeps).toBe(4);
      expect(parsed?.strataCoordRefine).toBe(true);
      expect(parsed?.privateApiRegional).toBe(true);
      // owner-decisions.md 2026-07-17: the new default stack (packedScoring +
      // sift + transpose ON, ε=1) must also round-trip ON for a field-absent
      // strata session — a `false`/`0` fallback would emit an explicit OFF that
      // silently flips the shared geometry back to the pre-flip layout.
      expect(parsed?.strataPackedScoring).toBe(true);
      expect(parsed?.strataSift).toBe(true);
      expect(parsed?.strataTranspose).toBe(true);
      // Never the inverted worst-arm values.
      expect(parsed?.strataSweeps).not.toBe(0);
    });
  });
});
