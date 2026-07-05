import { beforeEach, describe, expect, it, vi } from "vitest";

import { newTextElement } from "@excalidraw/element";

import {
  applyTerraformExcalidrawScene,
  refreshTerraformLayout,
  resetTerraformLayout,
  runTerraformImportFromSources,
} from "./terraformSceneApply";
import {
  clearTerraformImportSession,
  getTerraformImportSession,
  setTerraformImportSession,
} from "./terraformImportSession";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import { fetchPresetLayoutCache } from "./terraformLayoutCacheClient";
import { DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS } from "./terraformModuleLayoutOptions";
import {
  strataVersionNonce,
  STRATA_TOMBSTONE_CUSTOM_DATA_KEY,
} from "./terraformPipelineStrataFinalize";

import type { TerraformImportPreset } from "./terraformImportPresetsTypes";

vi.mock("./terraformLayoutWorkerClient", () => ({
  layoutTerraformViaWorkers: vi.fn(),
}));

vi.mock("./terraformImportPresetLoader", () => ({
  loadTerraformImportPresetSources: vi.fn(),
}));

vi.mock("./terraformLayoutCacheClient", () => ({
  fetchPresetLayoutCache: vi.fn(),
}));

const hoisted = vi.hoisted(() => ({
  addFiles: vi.fn(),
  replaceAllElements: vi.fn(),
  scrollToContent: vi.fn(),
  setAppState: vi.fn(),
  getElementsIncludingDeleted: vi.fn((): unknown[] => []),
}));

const mockApp = () =>
  ({
    addFiles: hoisted.addFiles,
    scene: {
      replaceAllElements: hoisted.replaceAllElements,
      getElementsIncludingDeleted: hoisted.getElementsIncludingDeleted,
    },
    scrollToContent: hoisted.scrollToContent,
    state: { viewBackgroundColor: "#ffffff" },
  } as unknown as Parameters<typeof applyTerraformExcalidrawScene>[0]);

describe("terraformSceneApply", () => {
  beforeEach(() => {
    clearTerraformImportSession();
    vi.mocked(layoutTerraformViaWorkers).mockReset();
    vi.mocked(fetchPresetLayoutCache).mockReset();
    hoisted.addFiles.mockReset();
    hoisted.replaceAllElements.mockReset();
    hoisted.scrollToContent.mockReset();
    hoisted.setAppState.mockReset();
    hoisted.getElementsIncludingDeleted.mockReset();
    hoisted.getElementsIncludingDeleted.mockReturnValue([]);
  });

  it("applyTerraformExcalidrawScene replaces elements and sets edge pins", () => {
    const el = newTextElement({ text: "r", x: 0, y: 0 });
    applyTerraformExcalidrawScene(
      mockApp(),
      hoisted.setAppState,
      { elements: [el] },
      { enableDeclaredDataFlow: true },
    );
    expect(hoisted.replaceAllElements).toHaveBeenCalled();
    expect(hoisted.setAppState).toHaveBeenCalledWith(
      expect.objectContaining({
        terraformEdgeLayerPins: expect.objectContaining({
          declaredDataFlow: true,
        }),
      }),
    );
  });

  describe("Strata A6 tombstones at replaceAllElements time (STRATA-SCOPED)", () => {
    /** A minimal finalized-strata-scene element: canonical id is all the
     * tombstone pass reads. */
    const canonicalEl = (address: string, version = 1) => ({
      ...newTextElement({ text: address, x: 0, y: 0 }),
      id: `tf:node:${address}`,
      version,
    });
    const lastReplaced = () =>
      hoisted.replaceAllElements.mock.calls.at(-1)![0] as {
        id: string;
        isDeleted: boolean;
        version: number;
        versionNonce: number;
        customData?: Record<string, unknown>;
      }[];

    it("(e) scene A (X∪Y) then regenerated scene B (X): the payload carries per-Y-address a canonical-id tombstone with isDeleted true and version = G_B", () => {
      // apply scene A — addresses {x.a, y.gone}; prev scene empty ⇒ no tombstones
      hoisted.replaceAllElements.mockImplementation((els) => {
        hoisted.getElementsIncludingDeleted.mockReturnValue(els);
      });
      applyTerraformExcalidrawScene(mockApp(), hoisted.setAppState, {
        elements: [canonicalEl("x.a"), canonicalEl("y.gone")],
        meta: { strataGeneration: 1 },
      });
      expect(
        lastReplaced()
          .map((el) => el.id)
          .sort(),
      ).toEqual(["tf:node:x.a", "tf:node:y.gone"]);

      // apply regenerated scene B — addresses {x.a} at G_B = 7
      applyTerraformExcalidrawScene(mockApp(), hoisted.setAppState, {
        elements: [canonicalEl("x.a", 7)],
        meta: { strataGeneration: 7 },
      });
      const payload = lastReplaced();
      const tomb = payload.find((el) => el.id === "tf:node:y.gone");
      expect(tomb).toBeTruthy();
      expect(tomb!.isDeleted).toBe(true);
      expect(tomb!.version).toBe(7);
      expect(tomb!.versionNonce).toBe(strataVersionNonce("tf:node:y.gone", 7));
      expect(tomb!.customData?.[STRATA_TOMBSTONE_CUSTOM_DATA_KEY]).toBe(true);

      // apply scene C (still {x.a}) at G = 8 — the tombstone persisted exactly
      // ONE generation window and is GC'd from the payload.
      applyTerraformExcalidrawScene(mockApp(), hoisted.setAppState, {
        elements: [canonicalEl("x.a", 8)],
        meta: { strataGeneration: 8 },
      });
      expect(lastReplaced().some((el) => el.id === "tf:node:y.gone")).toBe(
        false,
      );
    });

    it("(e) non-strata scenes are byte-unchanged through the same apply path (D2′)", () => {
      const plainScene = {
        elements: [newTextElement({ text: "plain", x: 0, y: 0 })],
      };
      // The shared restore/focus/reconcile pipeline randomizes versionNonce on
      // every apply (pre-existing behavior for ALL scenes, strata or not) —
      // normalize it so the comparison isolates the tombstone step.
      const normalized = () =>
        lastReplaced().map((el) => ({ ...el, versionNonce: 0 }));

      // baseline: empty previous scene
      applyTerraformExcalidrawScene(mockApp(), hoisted.setAppState, plainScene);
      const baseline = normalized();

      // same non-strata scene over a NON-EMPTY previous scene (strata AND
      // non-strata prev elements) — the payload must be unchanged (and in
      // particular carry NO tombstones).
      hoisted.getElementsIncludingDeleted.mockReturnValue([
        canonicalEl("x.a"),
        newTextElement({ text: "user-drawing", x: 5, y: 5 }),
      ]);
      applyTerraformExcalidrawScene(mockApp(), hoisted.setAppState, plainScene);
      expect(normalized()).toEqual(baseline);
    });

    it("(e) a strata scene over a non-strata previous scene appends no tombstones", () => {
      hoisted.getElementsIncludingDeleted.mockReturnValue([
        newTextElement({ text: "user-drawing", x: 5, y: 5 }),
      ]);
      applyTerraformExcalidrawScene(mockApp(), hoisted.setAppState, {
        elements: [canonicalEl("x.a")],
        meta: { strataGeneration: 1 },
      });
      expect(lastReplaced().map((el) => el.id)).toEqual(["tf:node:x.a"]);
    });
  });

  it("runTerraformImportFromSources parses, applies, and stores session", async () => {
    const parsedEl = newTextElement({
      text: "from-parse",
      x: 0,
      y: 0,
      customData: { terraformVisibilityRole: "resource" },
    });
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [parsedEl],
    });
    hoisted.replaceAllElements.mockImplementation((els) => {
      hoisted.getElementsIncludingDeleted.mockReturnValue(els);
    });

    await runTerraformImportFromSources(
      mockApp(),
      hoisted.setAppState,
      { planDotBundles: [], states: [], tfdTexts: [] },
      { semanticLayout: true },
    );

    expect(layoutTerraformViaWorkers).toHaveBeenCalledWith(
      expect.anything(),
      {
        semanticLayout: true,
        moduleLayoutOptions: undefined,
        colorMode: "category",
      },
      expect.anything(),
    );
    const session = getTerraformImportSession();
    expect(session).not.toBeNull();
    expect(session?.semanticLayout).toBe(true);
  });

  it("resetTerraformLayout restores snapshot without re-parsing", () => {
    const snapshotEl = newTextElement({ text: "snapshot", x: 10, y: 20 });
    setTerraformImportSession({
      sources: { planDotBundles: [], states: [], tfdTexts: [] },
      semanticLayout: true,
      moduleLayoutOptions: DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS,
      preset: null,
      importedTfdTexts: [],
      snapshot: {
        elements: [snapshotEl],
        terraformEdgeLayerPins: {
          dependency: false,
          dataFlow: false,
          declaredDataFlow: true,
          networking: false,
          topologyFrameFlow: false,
        },
        enableDeclaredDataFlow: true,
      },
    });

    const ok = resetTerraformLayout(mockApp(), hoisted.setAppState);
    expect(ok).toBe(true);
    expect(layoutTerraformViaWorkers).not.toHaveBeenCalled();
    expect(hoisted.replaceAllElements).toHaveBeenCalled();
  });

  it("refreshTerraformLayout re-parses from session sources", async () => {
    setTerraformImportSession({
      sources: {
        planDotBundles: [{ plan: {}, dotText: "digraph {}", label: "s" }],
        states: [],
        tfdTexts: [],
      },
      semanticLayout: false,
      moduleLayoutOptions: DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS,
      preset: null,
      importedTfdTexts: [],
      snapshot: {
        elements: [],
        terraformEdgeLayerPins: null,
        enableDeclaredDataFlow: false,
      },
    });

    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({ elements: [] });

    await refreshTerraformLayout(mockApp(), hoisted.setAppState);
    expect(layoutTerraformViaWorkers).toHaveBeenCalledWith(
      expect.anything(),
      {
        semanticLayout: false,
        moduleLayoutOptions: DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS,
        colorMode: "category",
      },
      expect.anything(),
    );
  });

  it("refreshTerraformLayout preserves custom module packing options from session", async () => {
    const rectpackingOptions = {
      ...DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS,
      mode: "rectpacking" as const,
    };
    setTerraformImportSession({
      sources: {
        planDotBundles: [{ plan: {}, dotText: "digraph {}", label: "s" }],
        states: [],
        tfdTexts: [],
      },
      semanticLayout: false,
      moduleLayoutOptions: rectpackingOptions,
      preset: null,
      importedTfdTexts: [],
      snapshot: {
        elements: [],
        terraformEdgeLayerPins: null,
        enableDeclaredDataFlow: false,
      },
    });

    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({ elements: [] });

    await refreshTerraformLayout(mockApp(), hoisted.setAppState);
    expect(layoutTerraformViaWorkers).toHaveBeenCalledWith(
      expect.anything(),
      {
        semanticLayout: false,
        moduleLayoutOptions: rectpackingOptions,
        colorMode: "category",
      },
      expect.anything(),
    );
  });

  it("refreshTerraformLayout preserves semantic layout and tfd overlay from session", async () => {
    setTerraformImportSession({
      sources: {
        planDotBundles: [{ plan: {}, dotText: "digraph {}", label: "s" }],
        states: [],
        tfdTexts: ["a -> b"],
      },
      semanticLayout: true,
      moduleLayoutOptions: DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS,
      preset: null,
      importedTfdTexts: ["a -> b"],
      snapshot: {
        elements: [],
        terraformEdgeLayerPins: null,
        enableDeclaredDataFlow: true,
      },
    });

    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({ elements: [] });

    await refreshTerraformLayout(mockApp(), hoisted.setAppState);
    expect(layoutTerraformViaWorkers).toHaveBeenCalledWith(
      expect.anything(),
      {
        semanticLayout: true,
        moduleLayoutOptions: undefined,
        colorMode: "category",
      },
      expect.anything(),
    );
  });

  it("refreshTerraformLayout preserves all RCLL pipeline options from session", async () => {
    setTerraformImportSession({
      sources: {
        planDotBundles: [{ plan: {}, dotText: "digraph {}", label: "s" }],
        states: [],
        tfdTexts: [],
      },
      semanticLayout: false,
      layoutMode: "rcll",
      moduleLayoutOptions: DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS,
      pipelineCompact: false,
      pipelinePacked: false,
      pipelinePackedPullLeft: false,
      pipelineIncludeAncillary: true,
      pipelineSemanticPlacement: false,
      pipelineSwimlaneLaneRise: true,
      pipelineReorder: true,
      pipelineCrossingMin: true,
      pipelineDeBandLevel: "none",
      pipelineRankSeparate: true,
      pipelineStraighten: true,
      pipelineDeDensify: false,
      pipelineColumnPacking: "compact",
      pipelineLayoutProfile: "compact",
      pipelineStaircaseBandOverlap: true,
      preset: null,
      importedTfdTexts: [],
      snapshot: {
        elements: [],
        terraformEdgeLayerPins: null,
        enableDeclaredDataFlow: false,
      },
    });

    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({ elements: [] });

    await refreshTerraformLayout(mockApp(), hoisted.setAppState);
    expect(layoutTerraformViaWorkers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        layoutMode: "rcll",
        pipelineCompact: false,
        pipelineLayoutVariant: "rcll",
        pipelineIncludeAncillary: true,
        pipelineSwimlaneLaneRise: true,
        pipelineReorder: true,
        pipelineCrossingMin: true,
        pipelineDeBandLevel: "none",
        pipelineRankSeparate: true,
        pipelineStraighten: true,
        pipelineDeDensify: false,
        pipelineColumnPacking: "compact",
        pipelineLayoutProfile: "compact",
        pipelineStaircaseBandOverlap: true,
      }),
      expect.anything(),
    );
  });

  it("refreshTerraformLayout preserves Strata options from session (variant clobber wins over a stale pipelineLayoutVariant)", async () => {
    setTerraformImportSession({
      sources: {
        planDotBundles: [{ plan: {}, dotText: "digraph {}", label: "s" }],
        states: [],
        tfdTexts: [],
      },
      semanticLayout: false,
      layoutMode: "strata",
      moduleLayoutOptions: DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS,
      pipelineCompact: false,
      pipelineIncludeAncillary: true,
      // A stale non-strata variant (e.g. left over from a prior "pipeline" view
      // session) must NOT mis-route the Strata import — the clobber forces
      // "strata" unconditionally.
      pipelineLayoutVariant: "classic",
      strataNetworkSimplexRank: true,
      strataSweeps: 4,
      strataCoordinateRefine: true,
      preset: null,
      importedTfdTexts: [],
      snapshot: {
        elements: [],
        terraformEdgeLayerPins: null,
        enableDeclaredDataFlow: false,
      },
    });

    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({ elements: [] });

    await refreshTerraformLayout(mockApp(), hoisted.setAppState);
    expect(layoutTerraformViaWorkers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        layoutMode: "strata",
        pipelineCompact: false,
        pipelineLayoutVariant: "strata",
        pipelineIncludeAncillary: true,
        strataNetworkSimplexRank: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
      }),
      expect.anything(),
    );
  });

  it("relayouts when switching layout mode for identical sources", async () => {
    const semanticEl = newTextElement({
      text: "semantic",
      x: 0,
      y: 0,
      customData: { terraformVisibilityRole: "resource" },
    });
    const pipelineEl = newTextElement({
      text: "pipeline",
      x: 1,
      y: 1,
      customData: { terraformVisibilityRole: "resource" },
    });
    const sources = {
      planDotBundles: [
        { plan: { resource_changes: [] }, dotText: "digraph {}", label: "s" },
      ],
      states: [],
      tfdTexts: ["a -> b"],
      tfdLabels: ["pipeline.tfd"],
    };
    vi.mocked(layoutTerraformViaWorkers)
      .mockResolvedValueOnce({ elements: [semanticEl] })
      .mockResolvedValueOnce({ elements: [pipelineEl] })
      .mockResolvedValueOnce({ elements: [semanticEl] });
    hoisted.replaceAllElements.mockImplementation((els) => {
      hoisted.getElementsIncludingDeleted.mockReturnValue(els);
    });

    await runTerraformImportFromSources(
      mockApp(),
      hoisted.setAppState,
      sources,
      { semanticLayout: true, layoutMode: "semantic" },
    );
    await runTerraformImportFromSources(
      mockApp(),
      hoisted.setAppState,
      sources,
      { semanticLayout: false, layoutMode: "pipeline" },
    );
    await runTerraformImportFromSources(
      mockApp(),
      hoisted.setAppState,
      sources,
      { semanticLayout: true, layoutMode: "semantic" },
    );

    expect(layoutTerraformViaWorkers).toHaveBeenCalledTimes(3);
  });

  it("rcll skips the KV layout cache; module consults it (§31)", async () => {
    // RCLL's dials aren't part of the cache key yet, so an rcll import must
    // never return a stale cached compound layout. Guard: rcll skips the cache,
    // module (a cached view) consults it — the contrast proves the assertion.
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [
        newTextElement({
          text: "x",
          x: 0,
          y: 0,
          customData: { terraformVisibilityRole: "resource" },
        }),
      ],
    });
    vi.mocked(fetchPresetLayoutCache).mockResolvedValue(null); // cache miss → proceed to worker
    hoisted.replaceAllElements.mockImplementation((els) => {
      hoisted.getElementsIncludingDeleted.mockReturnValue(els);
    });

    const preset = { id: "demo-preset" } as unknown as TerraformImportPreset;
    const sources = { planDotBundles: [], states: [], tfdTexts: [] };

    // module → cache IS consulted (vacuity guard).
    await runTerraformImportFromSources(
      mockApp(),
      hoisted.setAppState,
      sources,
      {
        semanticLayout: false,
        layoutMode: "module",
        preset,
      },
    );
    expect(fetchPresetLayoutCache).toHaveBeenCalledTimes(1);

    vi.mocked(fetchPresetLayoutCache).mockClear();

    // rcll → cache is SKIPPED; the worker still runs.
    await runTerraformImportFromSources(
      mockApp(),
      hoisted.setAppState,
      sources,
      {
        semanticLayout: false,
        layoutMode: "rcll",
        preset,
      },
    );
    expect(fetchPresetLayoutCache).not.toHaveBeenCalled();
    expect(layoutTerraformViaWorkers).toHaveBeenCalled();
  });

  it("strata skips the KV layout cache; options forward for layoutMode strata", async () => {
    // Strata (S0a passthrough) has no cache key for its dials yet either — same
    // guard as rcll: cache is SKIPPED, and the strata-specific option set (plus
    // the forced "strata" variant) still reaches the worker call.
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [
        newTextElement({
          text: "x",
          x: 0,
          y: 0,
          customData: { terraformVisibilityRole: "resource" },
        }),
      ],
    });
    vi.mocked(fetchPresetLayoutCache).mockResolvedValue(null);
    hoisted.replaceAllElements.mockImplementation((els) => {
      hoisted.getElementsIncludingDeleted.mockReturnValue(els);
    });

    const preset = { id: "demo-preset" } as unknown as TerraformImportPreset;
    const sources = { planDotBundles: [], states: [], tfdTexts: [] };

    await runTerraformImportFromSources(
      mockApp(),
      hoisted.setAppState,
      sources,
      {
        semanticLayout: false,
        layoutMode: "strata",
        pipelineIncludeAncillary: true,
        strataNetworkSimplexRank: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
        preset,
      },
    );
    expect(fetchPresetLayoutCache).not.toHaveBeenCalled();
    expect(layoutTerraformViaWorkers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        layoutMode: "strata",
        pipelineLayoutVariant: "strata",
        pipelineIncludeAncillary: true,
        strataNetworkSimplexRank: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
      }),
      expect.anything(),
    );
  });
});
