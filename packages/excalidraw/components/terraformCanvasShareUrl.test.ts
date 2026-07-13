import { describe, expect, it } from "vitest";

import {
  buildTerraformCanvasShareUrl,
  deriveViewFromSession,
  type TerraformCanvasViewSettings,
} from "./terraformCanvasShareUrl";
import { parseTerraformDemoUrlParams } from "./terraformDemoUrlParams";
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
  });
});
