import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { TerraformStrataSettings } from "./TerraformStrataSettings";

import type { DeBandLevel } from "./terraformPipelineLayoutProfiles";
import type { StrataHullRole } from "./terraformPipelineStrataTypes";
import type { StrataEdgeStyle } from "./terraformPipelineStrataEdgeStyle";

// The live edge diagnostic reads the current scene via `useExcalidrawElements`
// (the ONLY thing this component tree imports from ./App). Override it to serve
// a per-test element list from a hoisted holder so the provenance-breakdown test
// can inject clip-stamped arrows; the default [] leaves every other test in its
// pre-import (declared 0 → placeholder) state, byte-identical to before.
const hoistedScene = vi.hoisted(() => ({
  elements: [] as NonDeletedExcalidrawElement[],
}));
vi.mock("./App", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./App")>()),
  useExcalidrawElements: () => hoistedScene.elements,
}));

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
  strataBlockClamp: false,
  strataTranspose: false,
  strataBoxEndpoints: false,
  strataHeightGate: false,
  strataEdgeStyle: "straight" as const,
  strataBandDepth: "account" as StrataHullRole,
  strataDeBandLevel: "none" as DeBandLevel,
  pipelineCompact: true,
  pipelineIncludeAncillary: false,
  strataSiftRelocate: false,
  strataChainRelocate: false,
  strataCoordCascade: false,
  strataCrossWeightPenetration: 1,
  strataCrossWeightEdge: 1,
  strataEdgeCrossCap: undefined,
  strataColumnGap: undefined,
  strataRowGap: undefined,
  setStrataSweeps: vi.fn(),
  setStrataCoordinateRefine: vi.fn(),
  setStrataRankSeparate: vi.fn(),
  setStrataPackedScoring: vi.fn(),
  setStrataPackedScoringEpsilon: vi.fn(),
  setStrataBlockClamp: vi.fn(),
  setStrataTranspose: vi.fn(),
  setStrataBoxEndpoints: vi.fn(),
  setStrataHeightGate: vi.fn(),
  setStrataEdgeStyle: vi.fn(),
  setStrataBandDepth: vi.fn(),
  setStrataDeBandLevel: vi.fn(),
  setPipelineCompact: vi.fn(),
  setPipelineIncludeAncillary: vi.fn(),
  setStrataSiftRelocate: vi.fn(),
  setStrataChainRelocate: vi.fn(),
  setStrataCoordCascade: vi.fn(),
  setStrataCrossWeightPenetration: vi.fn(),
  setStrataCrossWeightEdge: vi.fn(),
  setStrataEdgeCrossCap: vi.fn(),
  setStrataColumnGap: vi.fn(),
  setStrataRowGap: vi.fn(),
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
    // packedScoring on reveals the epsilon crossing-budget control. The former
    // 'Keep best order found' (packedConverge) and 'Stable adoption rule'
    // (transitiveAdopt) sub-controls were REMOVED from the panel
    // (owner-decisions.md 2026-07-17 — byte-identical no-ops); see the explicit
    // absence guard below.
    const { container } = renderPanel({
      strataPackedScoring: true,
      strataPackedScoringEpsilon: 0,
    });
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("does NOT render the removed no-op controls even with packed scoring on", () => {
    // owner-decisions.md 2026-07-17: 'Keep best order found' (strataPackedConverge)
    // and 'Stable adoption rule' (strataTransitiveAdopt) are byte-identical no-ops
    // and were deleted from the panel. Their packedScoring render-gate is now
    // default-ON, so their absence must hold in the packedScoring-on state.
    renderPanel({ strataPackedScoring: true, strataPackedScoringEpsilon: 1 });
    expect(screen.queryByText(/Keep best order found/i)).toBeNull();
    expect(screen.queryByText(/Stable adoption rule/i)).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Strata keep best order found" }),
    ).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Strata stable adoption order" }),
    ).toBeNull();
  });

  it("keeps chain relocate + coordinate cascade off the Standard surface (advanced disclosure)", () => {
    // Both are default-OFF experimental edge-shortening passes: they must render
    // (so their URL params round-trip) but inside a collapsed advanced <details>,
    // not the always-visible Standard flow — mirroring the edge-routing passes.
    renderPanel();
    for (const name of ["Strata chain relocate", "Strata coordinate cascade"]) {
      const group = screen.getByRole("group", { name });
      const disclosure = group.closest("details");
      expect(disclosure, `${name} must live in a <details>`).not.toBeNull();
      expect(
        within(disclosure as HTMLElement).getByText(
          /Advanced: extra crossing-reduction passes/i,
        ),
      ).toBeTruthy();
    }
  });

  it("toggles chain relocate and coordinate cascade through their setters", () => {
    const setChain = vi.fn();
    const setCascade = vi.fn();
    renderPanel({
      setStrataChainRelocate: setChain,
      setStrataCoordCascade: setCascade,
    });
    const chain = screen.getByRole("group", { name: "Strata chain relocate" });
    fireEvent.click(within(chain).getByRole("button", { name: "On" }));
    expect(setChain).toHaveBeenCalledWith(true);

    const cascade = screen.getByRole("group", {
      name: "Strata coordinate cascade",
    });
    fireEvent.click(within(cascade).getByRole("button", { name: "On" }));
    expect(setCascade).toHaveBeenCalledWith(true);
  });

  it("hints to enable Straighten edges when coordinate cascade is on without it", () => {
    // strataCoordCascade extends strataCoordinateRefine and is inert without it —
    // the dependency hint mirrors the transpose→Layer-ordering hint. Its "Turn
    // on" action flips Straighten edges on.
    const setRefine = vi.fn();
    renderPanel({
      strataCoordCascade: true,
      strataCoordinateRefine: false,
      setStrataCoordinateRefine: setRefine,
    });
    const cascade = screen.getByRole("group", {
      name: "Strata coordinate cascade",
    });
    const hint = within(cascade).getByRole("status");
    expect(hint.textContent).toMatch(/Straighten edges/i);
    fireEvent.click(within(hint).getByRole("button", { name: "Turn on" }));
    expect(setRefine).toHaveBeenCalledWith(true);
  });

  it("does NOT show the cascade dependency hint once Straighten edges is on", () => {
    renderPanel({ strataCoordCascade: true, strataCoordinateRefine: true });
    const cascade = screen.getByRole("group", {
      name: "Strata coordinate cascade",
    });
    expect(within(cascade).queryByRole("status")).toBeNull();
  });

  it("renders a custom epsilon option carried in from a URL", () => {
    const { container } = renderPanel({
      strataPackedScoring: true,
      strataPackedScoringEpsilon: 0.01,
    });
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("renders rank separate + packed scoring both-on WITHOUT the retired W8 conflict note", () => {
    // The panel renders whatever state it is given (a legacy
    // rankSep=1&packedScoring=1 URL can still seed both-on); the rankSeparate ×
    // packedScoring hard exclusion is enforced at the toggle handlers, not here.
    // The retired W8 "measured to conflict … prefer one or the other" advisory
    // must NOT reappear — it described an undecided preference the hard rule
    // (owner-decisions.md 2026-07-17 line 12) replaced.
    renderPanel({
      strataRankSeparate: true,
      strataPackedScoring: true,
    });
    expect(screen.queryByText(/measured to conflict \(w8\)/i)).toBeNull();
    expect(screen.queryByText(/prefer one or the other/i)).toBeNull();
  });

  it("renders every toggle in its on state", () => {
    const { container } = renderPanel({
      strataRankSeparate: true,
      strataPackedScoring: true,
      strataPackedScoringEpsilon: 2,
      strataBlockClamp: true,
      strataTranspose: true,
      strataHeightGate: true,
      strataSiftRelocate: true,
      strataChainRelocate: true,
      strataCoordCascade: true,
      pipelineCompact: false,
      strataEdgeCrossCap: 4,
    });
    expect(container.innerHTML).toMatchSnapshot();
  });

  it("does NOT render the removed Private API placement control (owner Q9: always-on)", () => {
    // owner-decisions.md 2026-07-17 (Q9): "remove that button, default is ON,
    // private apis are regional." The Off/On 'Private API placement' segmented
    // control is DELETED from the panel — strata always places private REST APIs
    // regionally (the engine clamps pipelinePrivateApiRegional true), so there is
    // nothing to toggle. Its role="group" and label must be gone, and there is no
    // way for the panel to turn the flag off.
    renderPanel();
    expect(
      screen.queryByRole("group", { name: "Strata private API placement" }),
    ).toBeNull();
    expect(screen.queryByText(/Private API placement/i)).toBeNull();
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

// A stateful harness so keyboard/one-hot interactions can be observed through the
// component's OWN re-render (controlled setters actually update the value), not
// just the mock call log.
const StatefulPanel = (initial: Partial<Props> = {}) => {
  const Harness = () => {
    const [edgeStyle, setEdgeStyle] = React.useState<StrataEdgeStyle>(
      (initial.strataEdgeStyle as StrataEdgeStyle) ?? "straight",
    );
    return (
      <TerraformStrataSettings
        {...baseProps()}
        {...initial}
        strataEdgeStyle={edgeStyle}
        setStrataEdgeStyle={setEdgeStyle}
      />
    );
  };
  return render(<Harness />);
};

describe("TerraformStrataSettings — M5 edge routing & style", () => {
  // (a) Mutual-exclusion click surfaces the hint at the CLICKED control.
  it("surfaces a coupling hint when Compact height auto-disables Packed edge scoring", () => {
    const setPacked = vi.fn();
    renderPanel({
      strataPackedScoring: true,
      setStrataPackedScoring: setPacked,
    });
    const compact = screen.getByRole("group", {
      name: "Strata compact height",
    });
    // No hint before the click.
    expect(within(compact).queryByRole("status")).toBeNull();

    fireEvent.click(within(compact).getByRole("button", { name: "On" }));

    expect(setPacked).toHaveBeenCalledWith(false); // the silent flip, now explained
    expect(within(compact).getByRole("status").textContent).toMatch(
      /Packed edge scoring/i,
    );
  });

  it("surfaces a coupling hint when Packed edge scoring auto-disables Compact height", () => {
    const setRank = vi.fn();
    renderPanel({ strataRankSeparate: true, setStrataRankSeparate: setRank });
    const packed = screen.getByRole("group", {
      name: "Strata packed edge scoring",
    });
    expect(within(packed).queryByRole("status")).toBeNull();

    fireEvent.click(within(packed).getByRole("button", { name: "On" }));

    expect(setRank).toHaveBeenCalledWith(false);
    expect(within(packed).getByRole("status").textContent).toMatch(
      /Compact height/i,
    );
  });

  // (b) Radiogroup keyboard nav — arrow keys move aria-checked AND focus.
  it("moves radiogroup selection and aria-checked with Arrow keys", () => {
    StatefulPanel({ strataEdgeStyle: "straight" });
    const styleGroup = screen.getByRole("radiogroup", {
      name: "Strata edge style",
    });
    const straight = within(styleGroup).getByRole("radio", {
      name: "Straight",
    });
    const curve = within(styleGroup).getByRole("radio", { name: "Curve" });
    expect(straight.getAttribute("aria-checked")).toBe("true");
    expect(curve.getAttribute("aria-checked")).toBe("false");

    // Focus + arrow move both selection and focus; the programmatic focus()
    // inside the handler drives an onFocus state update, so wrap in act().
    act(() => straight.focus());
    act(() => {
      fireEvent.keyDown(straight, { key: "ArrowRight" });
    });
    expect(curve.getAttribute("aria-checked")).toBe("true");
    expect(straight.getAttribute("aria-checked")).toBe("false");
    expect(document.activeElement).toBe(
      within(styleGroup).getByRole("radio", { name: "Curve" }),
    );

    act(() => {
      fireEvent.keyDown(curve, { key: "ArrowLeft" });
    });
    expect(
      within(styleGroup)
        .getByRole("radio", { name: "Straight" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    // Wraps: ArrowLeft from the first radio selects the last (Curve).
    act(() => {
      fireEvent.keyDown(
        within(styleGroup).getByRole("radio", { name: "Straight" }),
        { key: "ArrowLeft" },
      );
    });
    expect(
      within(styleGroup)
        .getByRole("radio", { name: "Curve" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(curve).toBeTruthy();
  });

  it("uses roving tabindex so only the checked radio is tab-reachable", () => {
    renderPanel({ strataEdgeStyle: "curve" });
    const styleGroup = screen.getByRole("radiogroup", {
      name: "Strata edge style",
    });
    expect(
      within(styleGroup)
        .getByRole("radio", { name: "Curve" })
        .getAttribute("tabindex"),
    ).toBe("0");
    expect(
      within(styleGroup)
        .getByRole("radio", { name: "Straight" })
        .getAttribute("tabindex"),
    ).toBe("-1");
  });

  // (d) M5 box-endpoint anchoring — a one-hot boolean segmented control mirroring
  // the Style row: "Resource" writes false, "Box" writes true.
  it("Endpoints row writes strataBoxEndpoints per segment (Resource=false / Box=true)", () => {
    const setBoxEndpoints = vi.fn();
    renderPanel({ setStrataBoxEndpoints: setBoxEndpoints });
    const group = screen.getByRole("radiogroup", {
      name: "Strata edge endpoints",
    });

    fireEvent.click(within(group).getByRole("radio", { name: "Box" }));
    expect(setBoxEndpoints).toHaveBeenLastCalledWith(true);

    fireEvent.click(within(group).getByRole("radio", { name: "Resource" }));
    expect(setBoxEndpoints).toHaveBeenLastCalledWith(false);
  });

  it("Endpoints row reflects the current value as the checked segment (default OFF ⇒ Resource)", () => {
    renderPanel();
    const group = screen.getByRole("radiogroup", {
      name: "Strata edge endpoints",
    });
    expect(
      within(group)
        .getByRole("radio", { name: "Resource" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    // Help copy is wired: hovering the Box segment drives the shared help panel.
    fireEvent.mouseEnter(within(group).getByRole("radio", { name: "Box" }));
    expect(screen.getByLabelText("Option explanation").textContent).toContain(
      "labeled box",
    );
  });

  it("Endpoints row shows Box as the checked segment when strataBoxEndpoints is on", () => {
    renderPanel({ strataBoxEndpoints: true });
    const group = screen.getByRole("radiogroup", {
      name: "Strata edge endpoints",
    });
    expect(
      within(group)
        .getByRole("radio", { name: "Box" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("shows the pre-import diagnostic placeholder with no scene elements", () => {
    // The mocked useExcalidrawElements serves hoistedScene.elements (default []),
    // matching the real pre-import context default → declared 0.
    renderPanel();
    expect(screen.getByText("Edge stats appear after import")).toBeTruthy();
  });

  it("surfaces clip provenance in the live scene diagnostic breakdown", () => {
    // Inject two declared dataflow arrows: one clip-stamped multi-point polyline
    // (counts as reshaped under 'clip') and one plain straight chord (declared
    // but not reshaped) — the breakdown must attribute the reshaped one to the
    // clip stamper's plain word ('clipped') and count the other as straight.
    const clipArrow = {
      id: "clip-1",
      type: "arrow",
      isDeleted: false,
      points: [
        [0, 0],
        [10, 5],
        [20, 0],
      ],
      customData: {
        terraformEdgeLayer: "declaredDataFlow",
        terraformRoutedPolyline: true,
        terraformRoutedBy: "clip",
      },
    } as unknown as NonDeletedExcalidrawElement;
    const straightArrow = {
      id: "straight-1",
      type: "arrow",
      isDeleted: false,
      points: [
        [0, 0],
        [30, 0],
      ],
      customData: { terraformEdgeLayer: "declaredDataFlow" },
    } as unknown as NonDeletedExcalidrawElement;
    hoistedScene.elements = [clipArrow, straightArrow];
    try {
      renderPanel();
      const diagnostic = screen.getByText(/Current scene:/i);
      expect(diagnostic.textContent).toMatch(/1 of 2 edges reshaped/);
      expect(diagnostic.textContent).toMatch(/1 clipped/);
      expect(diagnostic.textContent).toMatch(/1 straight/);
    } finally {
      hoistedScene.elements = [];
    }
  });
});

describe("TerraformStrataSettings — E3.3 spacing controls", () => {
  // (a) Column gap one-hot: each segment writes its NUMERIC param; Default clears
  // to undefined (absent). This is the "URL wiring" — the value written is exactly
  // what the demo-URL layer serializes as strataColumnGap=<n> (or omits at 150).
  it("Column gap writes the numeric param per segment; Default clears to undefined (one-hot)", () => {
    const setColumnGap = vi.fn();
    renderPanel({ setStrataColumnGap: setColumnGap });
    const group = screen.getByRole("radiogroup", { name: "Strata column gap" });

    fireEvent.click(within(group).getByRole("radio", { name: "Wide 200" }));
    expect(setColumnGap).toHaveBeenLastCalledWith(200);

    fireEvent.click(within(group).getByRole("radio", { name: "Extra 250" }));
    expect(setColumnGap).toHaveBeenLastCalledWith(250);

    fireEvent.click(within(group).getByRole("radio", { name: "Default 150" }));
    expect(setColumnGap).toHaveBeenLastCalledWith(undefined);
  });

  it("Row gap writes the numeric factor per segment; Default clears to undefined (one-hot)", () => {
    const setRowGap = vi.fn();
    renderPanel({ setStrataRowGap: setRowGap });
    const group = screen.getByRole("radiogroup", { name: "Strata row gap" });

    fireEvent.click(within(group).getByRole("radio", { name: "1.25×" }));
    expect(setRowGap).toHaveBeenLastCalledWith(1.25);

    fireEvent.click(within(group).getByRole("radio", { name: "1.5×" }));
    expect(setRowGap).toHaveBeenLastCalledWith(1.5);

    fireEvent.click(within(group).getByRole("radio", { name: "Default" }));
    expect(setRowGap).toHaveBeenLastCalledWith(undefined);
  });

  // (b) The active segment is derived from the current value (undefined ⇒ Default).
  it("reflects the current value as the checked segment (undefined ⇒ Default; 200 ⇒ Wide; 1.5 ⇒ 1.5×)", () => {
    renderPanel();
    const colGroupDefault = screen.getByRole("radiogroup", {
      name: "Strata column gap",
    });
    expect(
      within(colGroupDefault)
        .getByRole("radio", { name: "Default 150" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    renderPanel({ strataColumnGap: 200, strataRowGap: 1.5 });
    const colGroup = screen.getAllByRole("radiogroup", {
      name: "Strata column gap",
    })[1]!;
    expect(
      within(colGroup)
        .getByRole("radio", { name: "Wide 200" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    const rowGroup = screen.getAllByRole("radiogroup", {
      name: "Strata row gap",
    })[1]!;
    expect(
      within(rowGroup)
        .getByRole("radio", { name: "1.5×" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  // (c) Both controls are independent radiogroups rendered below the Style row.
  it("renders Column gap and Row gap as separate radiogroups", () => {
    renderPanel();
    expect(
      screen.getByRole("radiogroup", { name: "Strata column gap" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radiogroup", { name: "Strata row gap" }),
    ).toBeTruthy();
    // Help copy is wired: hovering a segment drives the shared help panel.
    const rowGroup = screen.getByRole("radiogroup", { name: "Strata row gap" });
    fireEvent.mouseEnter(
      within(rowGroup).getByRole("radio", { name: "1.25×" }),
    );
    expect(screen.getByLabelText("Option explanation").textContent).toContain(
      "vertical space",
    );
  });
});
