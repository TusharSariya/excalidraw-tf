import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { TerraformStrataSettings } from "./TerraformStrataSettings";

import type { DeBandLevel } from "./terraformPipelineLayoutProfiles";
import type { StrataHullRole } from "./terraformPipelineStrataTypes";

/**
 * DOM-identity harness for the TerraformStrataSettings panel.
 *
 * These snapshots exist to pin the panel's rendered DOM byte-for-byte across
 * the "Height & packing" section extraction (Commit A) — the split is meant to
 * be purely mechanical, so every snapshot here MUST be unchanged by it. They
 * also cover the conditional hints/notes in the extracted section, which are
 * the only places a mis-threaded prop could hide.
 *
 * If a snapshot in this file changes, the split was NOT behavior-neutral.
 */

type Props = React.ComponentProps<typeof TerraformStrataSettings>;

const baseProps = (): Props => ({
  strataSweeps: 4,
  strataCoordinateRefine: true,
  strataRankSeparate: false,
  strataPackedScoring: false,
  strataPackedScoringEpsilon: 0,
  strataPackedConverge: false,
  strataTransitiveAdopt: false,
  strataBlockClamp: false,
  strataTranspose: false,
  strataHeightGate: false,
  strataEdgeRouting: false,
  strataBorderRoute: false,
  strataBandDepth: "account" as StrataHullRole,
  strataDeBandLevel: "none" as DeBandLevel,
  pipelineCompact: true,
  strataSiftRelocate: false,
  strataCrossWeightPenetration: 1,
  strataCrossWeightEdge: 1,
  strataEdgeCrossCap: undefined,
  pipelinePrivateApiRegional: false,
  setPipelinePrivateApiRegional: vi.fn(),
  setStrataSweeps: vi.fn(),
  setStrataCoordinateRefine: vi.fn(),
  setStrataRankSeparate: vi.fn(),
  setStrataPackedScoring: vi.fn(),
  setStrataPackedScoringEpsilon: vi.fn(),
  setStrataPackedConverge: vi.fn(),
  setStrataTransitiveAdopt: vi.fn(),
  setStrataBlockClamp: vi.fn(),
  setStrataTranspose: vi.fn(),
  setStrataHeightGate: vi.fn(),
  setStrataEdgeRouting: vi.fn(),
  setStrataBorderRoute: vi.fn(),
  setStrataBandDepth: vi.fn(),
  setStrataDeBandLevel: vi.fn(),
  setPipelineCompact: vi.fn(),
  setStrataSiftRelocate: vi.fn(),
  setStrataCrossWeightPenetration: vi.fn(),
  setStrataCrossWeightEdge: vi.fn(),
  setStrataEdgeCrossCap: vi.fn(),
});

const renderPanel = (overrides: Partial<Props> = {}) =>
  render(<TerraformStrataSettings {...baseProps()} {...overrides} />);

describe("TerraformStrataSettings DOM identity", () => {
  it("renders the default panel", () => {
    const { container } = renderPanel();
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders the height gate hint when its refereed pass is off", () => {
    // strataHeightGate on + strataBlockClamp off => "Does nothing on its own"
    const { container } = renderPanel({
      strataHeightGate: true,
      strataBlockClamp: false,
    });
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders the height gate hint when its refereed pass is on", () => {
    // strataHeightGate on + strataBlockClamp on => "Usually no visible change"
    const { container } = renderPanel({
      strataHeightGate: true,
      strataBlockClamp: true,
    });
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders the shallow band depth coupling hint", () => {
    // currentDepthIndex < 2 + rankSeparate off => "only reclaims height when"
    const { container } = renderPanel({
      strataBandDepth: "root" as StrataHullRole,
      strataRankSeparate: false,
    });
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders the experimental deep band depth readout", () => {
    const { container } = renderPanel({
      strataBandDepth: "vpc" as StrataHullRole,
    });
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders the de-band suppression hint for an infeasible pairing", () => {
    const { container } = renderPanel({
      strataBandDepth: "vpc" as StrataHullRole,
      strataDeBandLevel: "vpc" as DeBandLevel,
    });
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders a feasible de-band selection without the hint", () => {
    const { container } = renderPanel({
      strataBandDepth: "account" as StrataHullRole,
      strataDeBandLevel: "region" as DeBandLevel,
    });
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders the packed scoring sub-controls and the epsilon dependency hint", () => {
    // packedScoring on reveals epsilon + converge + transitive; converge on with
    // epsilon 0 adds the "Set ε to 1" dependency hint.
    const { container } = renderPanel({
      strataPackedScoring: true,
      strataPackedScoringEpsilon: 0,
      strataPackedConverge: true,
      strataTransitiveAdopt: true,
    });
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders a custom epsilon option carried in from a URL", () => {
    const { container } = renderPanel({
      strataPackedScoring: true,
      strataPackedScoringEpsilon: 0.01,
    });
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders the rank separate + packed scoring conflict note", () => {
    const { container } = renderPanel({
      strataRankSeparate: true,
      strataPackedScoring: true,
    });
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders every toggle in its on state", () => {
    const { container } = renderPanel({
      strataRankSeparate: true,
      strataPackedScoring: true,
      strataPackedScoringEpsilon: 2,
      strataPackedConverge: true,
      strataTransitiveAdopt: true,
      strataBlockClamp: true,
      strataTranspose: true,
      strataHeightGate: true,
      strataEdgeRouting: true,
      strataBorderRoute: true,
      strataSiftRelocate: true,
      pipelineCompact: false,
      pipelinePrivateApiRegional: true,
      strataEdgeCrossCap: 4,
    });
    expect(container.innerHTML).toMatchSnapshot();
  });
});

describe("TerraformStrataSettings hover help", () => {
  // The hover/sticky help state stays owned by the parent across the split —
  // these assert the extracted section's controls still drive it.
  it("shows help on hover over an extracted (Height & packing) control", () => {
    renderPanel();
    const group = screen.getByRole("group", { name: "Strata compact height" });
    const onButton = within(group).getByRole("button", { name: "On" });

    fireEvent.mouseEnter(onButton);
    expect(screen.getByLabelText("Option explanation").textContent).toContain(
      "Compact height",
    );
  });

  it("sticks help on click of an extracted control and survives mouse leave", () => {
    renderPanel();
    const group = screen.getByRole("group", { name: "Strata compact height" });
    const onButton = within(group).getByRole("button", { name: "On" });

    fireEvent.click(onButton);
    fireEvent.mouseLeave(onButton);
    const help = screen.getByLabelText("Option explanation").textContent;
    expect(help).toContain("Compact height");
  });

  it("drives the shared help panel from the band depth slider", () => {
    renderPanel();
    // The group and its <input type="range"> share the aria-label, so select
    // the slider by role rather than by label text.
    const slider = screen.getByRole("slider", { name: "Strata band depth" });

    fireEvent.mouseEnter(slider);
    expect(screen.getByLabelText("Option explanation").textContent).toContain(
      "Band depth",
    );
  });
});
