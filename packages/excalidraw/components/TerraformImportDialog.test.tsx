/* eslint-disable max-lines */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { BUILTIN_TERRAFORM_IMPORT_PRESETS } from "./terraformImportPresetsTypes";
import { TerraformImportModal } from "./TerraformImportDialog";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import { DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS } from "./terraformModuleLayoutOptions";
import { loadTerraformImportPresetSources } from "./terraformImportPresetLoader";

const hoisted = vi.hoisted(() => ({
  addFiles: vi.fn(),
  replaceAllElements: vi.fn(),
  scrollToContent: vi.fn(),
  setAppState: vi.fn(),
}));

vi.mock("./terraformLayoutWorkerClient", () => ({
  layoutTerraformViaWorkers: vi.fn(),
}));

vi.mock("./terraformImportPresetLoader", () => ({
  chooseTerraformImportPresetRootDirectory: vi.fn(),
  loadTerraformImportPresetSources: vi.fn(),
}));

vi.mock("./terraformImportPresets", () => ({
  BUILTIN_TERRAFORM_IMPORT_PRESETS,
  listTerraformImportPresets: vi.fn(async () =>
    BUILTIN_TERRAFORM_IMPORT_PRESETS.map((preset) => ({
      ...preset,
      hasContent: true,
    })),
  ),
  getTerraformImportPreset: vi.fn(),
  saveTerraformImportPreset: vi.fn(),
  updateTerraformImportPreset: vi.fn(),
  deleteTerraformImportPreset: vi.fn(),
}));

vi.mock("./App", () => ({
  useApp: () => ({
    addFiles: hoisted.addFiles,
    scene: { replaceAllElements: hoisted.replaceAllElements },
    scrollToContent: hoisted.scrollToContent,
    state: { viewBackgroundColor: "#ffffff" },
  }),
  useExcalidrawSetAppState: () => hoisted.setAppState,
  // TerraformStrataSettings reads the live scene for its edge diagnostic
  // (M5). No scene in these dialog tests → the pre-import placeholder.
  useExcalidrawElements: () => [],
}));

function textFileLike(contents: string, name = "file"): File {
  return {
    name,
    text: async () => contents,
  } as File;
}

function fillFirstBundle(planJson = "{}", dot = "digraph {}") {
  const planInputs = screen.getAllByLabelText(/plan file/i);
  const dotInputs = screen.getAllByLabelText(/graph file/i);
  fireEvent.change(planInputs[0], {
    target: {
      files: [textFileLike(planJson, "p.json")],
    },
  });
  fireEvent.change(dotInputs[0], {
    target: {
      files: [textFileLike(dot, "g.dot")],
    },
  });
}

describe("TerraformImportModal", () => {
  beforeEach(() => {
    vi.mocked(layoutTerraformViaWorkers).mockReset();
    vi.mocked(loadTerraformImportPresetSources).mockReset();
    hoisted.addFiles.mockReset();
    hoisted.replaceAllElements.mockReset();
    hoisted.scrollToContent.mockReset();
    hoisted.setAppState.mockReset();
  });

  it("disables import when only one of plan or dot is selected", () => {
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    const planInputs = screen.getAllByLabelText(/plan file/i);
    fireEvent.change(planInputs[0], {
      target: {
        files: [textFileLike("{}", "p.json")],
      },
    });
    expect(
      screen.getByRole("button", { name: /import & open/i }),
    ).toBeDisabled();
  });

  it("disables semantic view radio until plan and dot are present", () => {
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    const semantic = screen.getByRole("radio", { name: /semantic view/i });
    expect(semantic).toBeDisabled();
    fillFirstBundle();
    expect(semantic).not.toBeDisabled();
  });

  it("calls layoutTerraformViaWorkers with semanticLayout when semantic view is active", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    const onClose = vi.fn();
    render(<TerraformImportModal onCloseRequest={onClose} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    expect(vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1]).toEqual({
      semanticLayout: true,
      moduleLayoutOptions: undefined,
      colorMode: "category",
    });
    expect(hoisted.replaceAllElements).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // The strata twin of the RCLL case above. The engine seam is already proven
  // (terraformLayoutCoreStrataThreading.test.ts: layoutMode "strata" +
  // pipelineIncludeAncillary → pipelineAncillaryCount > 0); what was missing is
  // the UI seam, and it was BROKEN: the control was gated to pipeline/rcll and
  // never passed to TerraformStrataSettings, so under strata the flag was
  // reachable only via sticky state carried from another view or a ?ancillary=1
  // URL — and could never be turned back off. This is the regression guard.
  it("strata view: 'All resources' is clickable and included in import", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    const resources = screen.getByRole("group", {
      name: /strata resource scope/i,
    });
    const allResources = within(resources).getByRole("button", {
      name: /^all resources$/i,
    });
    const dataflowOnly = within(resources).getByRole("button", {
      name: /^dataflow only$/i,
    });
    // Default is the cheap arm — the +66% height is opt-in, never seeded.
    expect(dataflowOnly).toHaveAttribute("aria-pressed", "true");
    expect(allResources).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(allResources);
    expect(allResources).toHaveAttribute("aria-pressed", "true");
    // …and it turns back OFF from this panel, which was impossible before.
    fireEvent.click(dataflowOnly);
    expect(dataflowOnly).toHaveAttribute("aria-pressed", "true");
    expect(allResources).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(allResources);
    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    expect(vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1]).toEqual(
      expect.objectContaining({
        layoutMode: "strata",
        pipelineIncludeAncillary: true,
      }),
    );
  });

  it("passes semanticLayout false for module view", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /module view/i }));
    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    expect(vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1]).toEqual({
      semanticLayout: false,
      moduleLayoutOptions: DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS,
      colorMode: "category",
    });
  });

  it("shows module packing settings when module view is selected", () => {
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    expect(
      screen.queryByTestId("terraform-module-packing-settings"),
    ).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /module view/i }));
    expect(
      screen.getByTestId("terraform-module-packing-settings"),
    ).toBeTruthy();
    expect(screen.getByRole("radio", { name: /default grid/i })).toBeChecked();
  });

  it("passes selected rectpacking mode on module import", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /module view/i }));
    fireEvent.click(screen.getByRole("radio", { name: /elk rectpacking/i }));
    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    const options = vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1];
    expect(options?.semanticLayout).toBe(false);
    expect(options?.moduleLayoutOptions?.mode).toBe("rectpacking");
  });

  it("passes semanticLayout false for module view with active preset manifest", async () => {
    vi.mocked(loadTerraformImportPresetSources).mockResolvedValue({
      planDotBundles: [
        {
          plan: { resource_changes: [] },
          dotText: "digraph {}",
          label: "00-east-network",
        },
      ],
      states: [],
      stateLabels: [],
      tfdTexts: [],
      tfdLabels: [],
      warnings: [],
    });
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /edit before import/i }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /edit before import/i }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /module view/i }));
    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    expect(vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1]).toEqual({
      semanticLayout: false,
      moduleLayoutOptions: DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS,
      colorMode: "category",
    });
  });

  it("enables import with state file only", () => {
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/state \(/i), {
      target: {
        files: [textFileLike(JSON.stringify({ resources: [] }), "state.json")],
      },
    });
    expect(
      screen.getByRole("button", { name: /import & open/i }),
    ).not.toBeDisabled();
  });

  it("calls layoutTerraformViaWorkers with multiple states", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/state \(/i), {
      target: {
        files: [
          textFileLike(JSON.stringify({ resources: [] }), "a.json"),
          textFileLike(JSON.stringify({ resources: [] }), "b.json"),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    const sources = vi.mocked(layoutTerraformViaWorkers).mock.calls[0][0];
    expect(sources.states).toHaveLength(2);
    expect(sources.stateLabels).toEqual(["a.json", "b.json"]);
  });

  it("passes multiple tfd files to layoutTerraformViaWorkers", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.change(document.getElementById("terraform-import-links")!, {
      target: {
        files: [
          textFileLike("a -> b", "a.tfd"),
          textFileLike("b -> c", "b.tfd"),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    const sources = vi.mocked(layoutTerraformViaWorkers).mock.calls[0][0];
    expect(sources.tfdTexts).toHaveLength(2);
    expect(sources.tfdLabels).toEqual(["a.tfd", "b.tfd"]);
    expect(hoisted.setAppState).toHaveBeenCalledWith(
      expect.objectContaining({
        terraformEdgeLayerPins: expect.objectContaining({
          declaredDataFlow: true,
        }),
      }),
    );
  });

  it("imports with tfd overlay on semantic view", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.change(document.getElementById("terraform-import-links")!, {
      target: {
        files: [textFileLike("a -> b", "pipeline.tfd")],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    expect(vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1]).toEqual({
      semanticLayout: true,
      moduleLayoutOptions: undefined,
      colorMode: "category",
    });
  });

  it("shows Done and warnings when import succeeds with warnings", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      meta: {
        importWarnings: [
          {
            code: "duplicate_address",
            message: 'Address "x" overwritten.',
          },
        ],
      },
    });
    const onClose = vi.fn();
    render(<TerraformImportModal onCloseRequest={onClose} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() =>
      expect(screen.getByText(/overwritten/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows preset manifest table when Edit before import is clicked", async () => {
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /edit before import/i }),
    );
    expect(
      screen.getByText(
        /packages\/backend\/terraform\/staging-multi-state\/00-east-network\/plan\.json/i,
      ),
    ).toBeInTheDocument();
  });

  it("loads selected preset and imports parsed sources", async () => {
    vi.mocked(loadTerraformImportPresetSources).mockResolvedValue({
      planDotBundles: [
        {
          plan: { resource_changes: [] },
          dotText: "digraph {}",
          label: "00-east-network",
        },
      ],
      states: [],
      stateLabels: [],
      tfdTexts: ["a -> b"],
      tfdLabels: ["pipeline.tfd"],
      warnings: [],
    });
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });

    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /import preset/i }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /import preset/i }));

    await waitFor(() =>
      expect(loadTerraformImportPresetSources).toHaveBeenCalled(),
    );
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    const sources = vi.mocked(layoutTerraformViaWorkers).mock.calls[0][0];
    expect(sources.planDotBundles).toHaveLength(1);
    expect(sources.tfdLabels).toEqual(["pipeline.tfd"]);
  });

  it("keeps preset management and developer tools collapsed by default", () => {
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);

    expect(
      screen.getByText("Manage presets").closest("details"),
    ).not.toHaveAttribute("open");
    expect(
      screen.getByText("Developer tools").closest("details"),
    ).not.toHaveAttribute("open");
  });

  it("shows selected state file names", () => {
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/state \(/i), {
      target: {
        files: [
          textFileLike(JSON.stringify({ resources: [] }), "prod.tfstate"),
        ],
      },
    });

    expect(screen.getByText("prod.tfstate")).toBeInTheDocument();
  });

  it("shows strata settings only when Strata view is selected", () => {
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();

    expect(screen.queryByText("Strata settings")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));
    expect(screen.getByText("Strata settings")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: /strata layer ordering/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: /strata straighten/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: /strata compact height/i }),
    ).toBeInTheDocument();
  });

  it("Strata view: untouched dialog threads the W5 defaults (sweeps 4, refine true, rankSeparate false)", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    // Wiring-checklist #15: selecting view=strata and touching NOTHING must
    // reach the worker layout call with the validated W5 defaults.
    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    expect(vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1]).toEqual(
      expect.objectContaining({
        layoutMode: "strata",
        strataSweeps: 4,
        strataCoordinateRefine: true,
        // Owner default flip (owner-decisions.md 2026-07-17): the untouched
        // dialog seeds packedScoring ON (ε=1) — mutually exclusive with
        // rankSeparate, which stays OFF (the app default sits at packed ON /
        // rankSeparate OFF).
        strataRankSeparate: false,
        strataPackedScoring: true,
        strataPackedScoringEpsilon: 1,
        strataBandCompact: false,
        // Private-API regional placement defaults ON in the strata view (the
        // only view wired for it; every other view forces it false — see the
        // pipeline/compound assertions above).
        pipelinePrivateApiRegional: true,
      }),
    );
  });

  it("Strata view: Layer ordering defaults On (W5 flip) and Off flips aria-pressed + threads strataSweeps 0", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    const ordering = screen.getByRole("group", {
      name: /strata layer ordering/i,
    });
    const offBtn = within(ordering).getByRole("button", { name: /^off$/i });
    const onBtn = within(ordering).getByRole("button", { name: /^on$/i });

    // W5 default flip: On starts pressed.
    expect(onBtn).toHaveAttribute("aria-pressed", "true");
    expect(offBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(offBtn);
    expect(offBtn).toHaveAttribute("aria-pressed", "true");
    expect(onBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    expect(vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1]).toEqual(
      expect.objectContaining({ strataSweeps: 0 }),
    );
  });

  it("Strata view: Layer ordering Off then back to On threads strataSweeps 4", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    const ordering = screen.getByRole("group", {
      name: /strata layer ordering/i,
    });
    const offBtn = within(ordering).getByRole("button", { name: /^off$/i });
    const onBtn = within(ordering).getByRole("button", { name: /^on$/i });

    fireEvent.click(offBtn);
    fireEvent.click(onBtn);
    expect(onBtn).toHaveAttribute("aria-pressed", "true");
    expect(offBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    expect(vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1]).toEqual(
      expect.objectContaining({ strataSweeps: 4 }),
    );
  });

  it("Strata view: Straighten (A7) defaults On (W5 flip) and Off flips aria-pressed + threads strataCoordinateRefine false", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    const straighten = screen.getByRole("group", {
      name: /strata straighten/i,
    });
    const offBtn = within(straighten).getByRole("button", { name: /^off$/i });
    const onBtn = within(straighten).getByRole("button", { name: /^on$/i });

    // W5 default flip: On starts pressed.
    expect(onBtn).toHaveAttribute("aria-pressed", "true");
    expect(offBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(offBtn);
    expect(offBtn).toHaveAttribute("aria-pressed", "true");
    expect(onBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    expect(vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1]).toEqual(
      expect.objectContaining({ strataCoordinateRefine: false }),
    );
  });

  it("Strata view: Straighten (A7) Off then back to On threads strataCoordinateRefine true", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    const straighten = screen.getByRole("group", {
      name: /strata straighten/i,
    });
    const offBtn = within(straighten).getByRole("button", { name: /^off$/i });
    const onBtn = within(straighten).getByRole("button", { name: /^on$/i });

    fireEvent.click(offBtn);
    fireEvent.click(onBtn);
    expect(onBtn).toHaveAttribute("aria-pressed", "true");
    expect(offBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    expect(vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1]).toEqual(
      expect.objectContaining({ strataCoordinateRefine: true }),
    );
  });

  it("Strata view: Endpoints · Box threads strataBoxEndpoints true (M5)", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    // Default OFF: Resource is the checked segment.
    const endpoints = screen.getByRole("radiogroup", {
      name: "Strata edge endpoints",
    });
    expect(
      within(endpoints)
        .getByRole("radio", { name: "Resource" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(within(endpoints).getByRole("radio", { name: "Box" }));

    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    expect(vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1]).toEqual(
      expect.objectContaining({ strataBoxEndpoints: true }),
    );
  });

  it("Strata view: Compact height defaults Off and On flips aria-pressed + threads strataRankSeparate true", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    const compactHeight = screen.getByRole("group", {
      name: /strata compact height/i,
    });
    const offBtn = within(compactHeight).getByRole("button", {
      name: /^off$/i,
    });
    const onBtn = within(compactHeight).getByRole("button", {
      name: /^on$/i,
    });

    // Opt-in default-OFF: Off starts pressed.
    expect(offBtn).toHaveAttribute("aria-pressed", "true");
    expect(onBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(onBtn);
    expect(onBtn).toHaveAttribute("aria-pressed", "true");
    expect(offBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    expect(vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1]).toEqual(
      expect.objectContaining({ strataRankSeparate: true }),
    );
  });

  it("Strata view: Compact height On then back to Off threads strataRankSeparate false", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    const compactHeight = screen.getByRole("group", {
      name: /strata compact height/i,
    });
    const offBtn = within(compactHeight).getByRole("button", {
      name: /^off$/i,
    });
    const onBtn = within(compactHeight).getByRole("button", {
      name: /^on$/i,
    });

    fireEvent.click(onBtn);
    fireEvent.click(offBtn);
    expect(offBtn).toHaveAttribute("aria-pressed", "true");
    expect(onBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    expect(vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1]).toEqual(
      expect.objectContaining({ strataRankSeparate: false }),
    );
  });

  it("Strata view: Band depth slider defaults to Account (index 2) and moving it to Root threads strataBandDepth root", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    const bandDepthSlider = screen.getByRole("slider", {
      name: /strata band depth/i,
    });

    // Default cut is "account" — index 2 in the root/provider/account/region/vpc/subnetZone order.
    expect(bandDepthSlider).toHaveValue("2");
    expect(bandDepthSlider).toHaveAttribute("aria-valuetext", "Account");

    fireEvent.change(bandDepthSlider, { target: { value: "0" } });
    expect(bandDepthSlider).toHaveValue("0");
    expect(bandDepthSlider).toHaveAttribute("aria-valuetext", "Root");

    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    expect(vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1]).toEqual(
      expect.objectContaining({ strataBandDepth: "root" }),
    );
  });

  it("Strata view: Band depth slider moved to Root then back to Account omits strataBandDepth (default cut)", async () => {
    vi.mocked(layoutTerraformViaWorkers).mockResolvedValue({
      elements: [],
      files: {},
    });
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    const bandDepthSlider = screen.getByRole("slider", {
      name: /strata band depth/i,
    });

    fireEvent.change(bandDepthSlider, { target: { value: "0" } });
    fireEvent.change(bandDepthSlider, { target: { value: "2" } });
    expect(bandDepthSlider).toHaveValue("2");
    expect(bandDepthSlider).toHaveAttribute("aria-valuetext", "Account");

    fireEvent.click(screen.getByRole("button", { name: /import & open/i }));
    await waitFor(() => expect(layoutTerraformViaWorkers).toHaveBeenCalled());
    // Default cut ("account") never materializes a `strataBandDepth` own key
    // downstream — same byte-identity contract as every other default value.
    expect(
      vi.mocked(layoutTerraformViaWorkers).mock.calls[0][1],
    ).not.toHaveProperty("strataBandDepth");
  });

  it("Strata view: enabling Compact height auto-disables Packed edge scoring (hard exclusion, UI enforces)", () => {
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    const compactHeight = screen.getByRole("group", {
      name: /strata compact height/i,
    });
    const packedScoring = screen.getByRole("group", {
      name: /strata packed edge scoring/i,
    });

    // Owner default flip (owner-decisions.md 2026-07-17): the app default sits
    // at Packed edge scoring ON / Compact height OFF.
    expect(
      within(packedScoring).getByRole("button", { name: /^on$/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(compactHeight).getByRole("button", { name: /^off$/i }),
    ).toHaveAttribute("aria-pressed", "true");

    // rankSeparate × packedScoring is a HARD exclusion (line 12): enabling
    // Compact height auto-disables Packed edge scoring, so the on/on state the
    // engine would silently resolve can never be reached from the UI. Without
    // this, the default-ON packedScoring made Compact height a silent no-op.
    fireEvent.click(
      within(compactHeight).getByRole("button", { name: /^on$/i }),
    );
    expect(
      within(compactHeight).getByRole("button", { name: /^on$/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(packedScoring).getByRole("button", { name: /^off$/i }),
    ).toHaveAttribute("aria-pressed", "true");

    // The retired W8 "measured to conflict … prefer one or the other" advisory
    // is gone (it described an undecided preference the hard rule replaced).
    expect(screen.queryByText(/measured to conflict \(w8\)/i)).toBeNull();
  });

  it("Strata view: Packed edge scoring × Compact height are mutually exclusive in both directions", () => {
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    const compactHeight = screen.getByRole("group", {
      name: /strata compact height/i,
    });
    const packedScoring = screen.getByRole("group", {
      name: /strata packed edge scoring/i,
    });

    // Compact height ON → Packed edge scoring OFF.
    fireEvent.click(
      within(compactHeight).getByRole("button", { name: /^on$/i }),
    );
    expect(
      within(compactHeight).getByRole("button", { name: /^on$/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(packedScoring).getByRole("button", { name: /^off$/i }),
    ).toHaveAttribute("aria-pressed", "true");

    // Packed edge scoring ON → Compact height OFF (the other direction).
    fireEvent.click(
      within(packedScoring).getByRole("button", { name: /^on$/i }),
    );
    expect(
      within(packedScoring).getByRole("button", { name: /^on$/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(compactHeight).getByRole("button", { name: /^off$/i }),
    ).toHaveAttribute("aria-pressed", "true");

    // The UI never produces the both-on state, so the retired W8 advisory
    // never appears.
    expect(screen.queryByText(/measured to conflict \(w8\)/i)).toBeNull();
  });

  it("Strata view: Band depth readout updates per role and the Root copy is corrected", () => {
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    // Default (Account) readout.
    expect(
      screen.getByText(
        /providers and accounts stay full-width bands; regions and below pack/i,
      ),
    ).toBeInTheDocument();

    const bandDepthSlider = screen.getByRole("slider", {
      name: /strata band depth/i,
    });

    // Root — the corrected copy (the old note wrongly said deeper cuts reclaim).
    fireEvent.change(bandDepthSlider, { target: { value: "0" } });
    expect(
      screen.getByText(/only root stays banded; providers and below pack/i),
    ).toBeInTheDocument();

    // Region.
    fireEvent.change(bandDepthSlider, { target: { value: "3" } });
    expect(
      screen.getByText(/down to regions stay full-width; vpcs and below pack/i),
    ).toBeInTheDocument();
  });

  it("Strata view: experimental caption shows exactly once for Region+ and never for Account-or-shallower", () => {
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    const bandDepthSlider = screen.getByRole("slider", {
      name: /strata band depth/i,
    });

    // Account (default) — no experimental caption.
    expect(screen.queryByText(/experimental — usually wider/i)).toBeNull();

    // Region — exactly one caption (not one per Region/VPC/Zone tick, the old bug).
    fireEvent.change(bandDepthSlider, { target: { value: "3" } });
    expect(screen.getAllByText(/experimental — usually wider/i)).toHaveLength(
      1,
    );

    // Back to Provider — caption gone.
    fireEvent.change(bandDepthSlider, { target: { value: "1" } });
    expect(screen.queryByText(/experimental — usually wider/i)).toBeNull();
  });

  it("Strata view: coupling hint shows only for Root/Provider cuts while Compact height is off", () => {
    render(<TerraformImportModal onCloseRequest={vi.fn()} />);
    fillFirstBundle();
    fireEvent.click(screen.getByRole("radio", { name: /strata/i }));

    const hint = /packing provider and account only reclaims height when/i;
    const bandDepthSlider = screen.getByRole("slider", {
      name: /strata band depth/i,
    });

    // Default cut (Account) + Compact height off — no hint.
    expect(screen.queryByText(hint)).toBeNull();

    // Provider — hint appears.
    fireEvent.change(bandDepthSlider, { target: { value: "1" } });
    expect(screen.getByText(hint)).toBeInTheDocument();

    // Root — still present.
    fireEvent.change(bandDepthSlider, { target: { value: "0" } });
    expect(screen.getByText(hint)).toBeInTheDocument();

    // Turning Compact height (rankSeparate) on removes the hint even at Root.
    const compactHeight = screen.getByRole("group", {
      name: /strata compact height/i,
    });
    fireEvent.click(
      within(compactHeight).getByRole("button", { name: /^on$/i }),
    );
    expect(screen.queryByText(hint)).toBeNull();

    // Turn Compact height back off — hint returns at Root.
    fireEvent.click(
      within(compactHeight).getByRole("button", { name: /^off$/i }),
    );
    expect(screen.getByText(hint)).toBeInTheDocument();

    // Move to Account — hint gone regardless of Compact height.
    fireEvent.change(bandDepthSlider, { target: { value: "2" } });
    expect(screen.queryByText(hint)).toBeNull();
  });
});
