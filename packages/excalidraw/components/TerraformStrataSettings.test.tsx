import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { TerraformStrataSettings } from "./TerraformStrataSettings";

import type { DeBandLevel } from "./terraformPipelineLayoutProfiles";
import type { StrataHullRole } from "./terraformPipelineStrataTypes";
import type { StrataEdgeStyle } from "./terraformPipelineStrataEdgeStyle";

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
  strataHeightGate: false,
  strataEdgeRouting: false,
  strataBorderRoute: false,
  strataChannelRoute: false,
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
  setStrataSweeps: vi.fn(),
  setStrataCoordinateRefine: vi.fn(),
  setStrataRankSeparate: vi.fn(),
  setStrataPackedScoring: vi.fn(),
  setStrataPackedScoringEpsilon: vi.fn(),
  setStrataBlockClamp: vi.fn(),
  setStrataTranspose: vi.fn(),
  setStrataHeightGate: vi.fn(),
  setStrataEdgeRouting: vi.fn(),
  setStrataBorderRoute: vi.fn(),
  setStrataChannelRoute: vi.fn(),
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

  it("keeps the raw router toggles in the DEV composition drawer, off the standard surface", () => {
    // M5 redesign: the three raw router toggles (Route edges / Exit containers /
    // channels) moved into a DEV-only "Developer: routing passes" drawer. The
    // always-visible surface exposes them via the one-hot Routing segmented
    // control instead, so their URL params still round-trip. (import.meta.env.DEV
    // is true under vitest, so the drawer renders here.)
    renderPanel();
    const edgeGroup = screen.getByRole("group", {
      name: "Strata edge routing",
    });
    const disclosure = edgeGroup.closest("details");
    expect(disclosure).not.toBeNull();
    expect(
      within(disclosure as HTMLElement).getByText(/Developer: routing passes/i),
    ).toBeTruthy();
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
      strataEdgeRouting: true,
      strataBorderRoute: true,
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
    const [edgeRouting, setEdgeRouting] = React.useState<boolean>(
      initial.strataEdgeRouting ?? false,
    );
    const [channelRoute, setChannelRoute] = React.useState<boolean>(
      initial.strataChannelRoute ?? false,
    );
    const [borderRoute, setBorderRoute] = React.useState<boolean>(
      initial.strataBorderRoute ?? false,
    );
    return (
      <TerraformStrataSettings
        {...baseProps()}
        {...initial}
        strataEdgeStyle={edgeStyle}
        strataEdgeRouting={edgeRouting}
        strataChannelRoute={channelRoute}
        strataBorderRoute={borderRoute}
        setStrataEdgeStyle={setEdgeStyle}
        setStrataEdgeRouting={setEdgeRouting}
        setStrataChannelRoute={setChannelRoute}
        setStrataBorderRoute={setBorderRoute}
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
    const step = within(styleGroup).getByRole("radio", { name: "Step" });
    const curve = within(styleGroup).getByRole("radio", { name: "Curve" });
    expect(straight.getAttribute("aria-checked")).toBe("true");
    expect(step.getAttribute("aria-checked")).toBe("false");

    // Focus + arrow move both selection and focus; the programmatic focus()
    // inside the handler drives an onFocus state update, so wrap in act().
    act(() => straight.focus());
    act(() => {
      fireEvent.keyDown(straight, { key: "ArrowRight" });
    });
    expect(step.getAttribute("aria-checked")).toBe("true");
    expect(straight.getAttribute("aria-checked")).toBe("false");
    expect(document.activeElement).toBe(
      within(styleGroup).getByRole("radio", { name: "Step" }),
    );

    act(() => {
      fireEvent.keyDown(step, { key: "ArrowLeft" });
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
    renderPanel({ strataEdgeStyle: "step" });
    const styleGroup = screen.getByRole("radiogroup", {
      name: "Strata edge style",
    });
    expect(
      within(styleGroup)
        .getByRole("radio", { name: "Step" })
        .getAttribute("tabindex"),
    ).toBe("0");
    expect(
      within(styleGroup)
        .getByRole("radio", { name: "Straight" })
        .getAttribute("tabindex"),
    ).toBe("-1");
  });

  // (c) One-hot mapping: exactly one router boolean true per preset.
  it("writes exactly one router boolean true per Routing preset (one-hot)", () => {
    const setEdge = vi.fn();
    const setChannel = vi.fn();
    const setBorder = vi.fn();
    renderPanel({
      setStrataEdgeRouting: setEdge,
      setStrataChannelRoute: setChannel,
      setStrataBorderRoute: setBorder,
    });
    const routing = screen.getByRole("radiogroup", {
      name: "Strata edge routing preset",
    });

    const expectOneHot = (edge: boolean, channel: boolean, border: boolean) => {
      expect(setEdge).toHaveBeenLastCalledWith(edge);
      expect(setChannel).toHaveBeenLastCalledWith(channel);
      expect(setBorder).toHaveBeenLastCalledWith(border);
    };

    fireEvent.click(
      within(routing).getByRole("radio", { name: "Around boxes" }),
    );
    expectOneHot(true, false, false);

    fireEvent.click(
      within(routing).getByRole("radio", { name: "Through channels" }),
    );
    expectOneHot(false, true, false);

    fireEvent.click(
      within(routing).getByRole("radio", { name: "Border exits" }),
    );
    expectOneHot(false, false, true);

    fireEvent.click(within(routing).getByRole("radio", { name: "Off" }));
    expectOneHot(false, false, false);
  });

  it("shows the transient Custom segment only for a composed (2+) router state", () => {
    // A single router is a plain one-hot preset — no Custom, no banner.
    const single = renderPanel({ strataEdgeRouting: true });
    const routingSingle = screen.getByRole("radiogroup", {
      name: "Strata edge routing preset",
    });
    expect(
      within(routingSingle).queryByRole("radio", { name: "Custom" }),
    ).toBeNull();
    expect(
      within(routingSingle)
        .getByRole("radio", { name: "Around boxes" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.queryByText(/custom routing combination/i)).toBeNull();
    single.unmount();

    // 2+ routers (only reachable from a URL) → transient Custom segment + banner.
    renderPanel({ strataEdgeRouting: true, strataChannelRoute: true });
    const routingCustom = screen.getByRole("radiogroup", {
      name: "Strata edge routing preset",
    });
    expect(
      within(routingCustom)
        .getByRole("radio", { name: "Custom" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText(/custom routing combination/i)).toBeTruthy();
  });

  it("replaces a composed router state with a one-hot write when picking a preset", () => {
    // From Custom, StatefulPanel lets the pick actually flip the booleans so the
    // Custom segment disappears (not just a mock call).
    StatefulPanel({ strataEdgeRouting: true, strataChannelRoute: true });
    const routing = () =>
      screen.getByRole("radiogroup", { name: "Strata edge routing preset" });
    expect(
      within(routing()).getByRole("radio", { name: "Custom" }),
    ).toBeTruthy();

    fireEvent.click(
      within(routing()).getByRole("radio", { name: "Through channels" }),
    );

    // Custom gone; Through channels now the sole active preset (one-hot).
    expect(
      within(routing()).queryByRole("radio", { name: "Custom" }),
    ).toBeNull();
    expect(
      within(routing())
        .getByRole("radio", { name: "Through channels" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("resets a composed router state to Off from the banner (one-hot all-false)", () => {
    const setEdge = vi.fn();
    const setChannel = vi.fn();
    const setBorder = vi.fn();
    renderPanel({
      strataEdgeRouting: true,
      strataChannelRoute: true,
      setStrataEdgeRouting: setEdge,
      setStrataChannelRoute: setChannel,
      setStrataBorderRoute: setBorder,
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset to Off" }));
    expect(setEdge).toHaveBeenCalledWith(false);
    expect(setChannel).toHaveBeenCalledWith(false);
    expect(setBorder).toHaveBeenCalledWith(false);
  });

  it("dismisses the custom banner on Keep it while leaving the combination intact", () => {
    renderPanel({ strataEdgeRouting: true, strataChannelRoute: true });
    expect(screen.getByText(/custom routing combination/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));

    expect(screen.queryByText(/custom routing combination/i)).toBeNull();
    // The Custom segment stays — Keep dismisses the banner, not the combination.
    const routing = screen.getByRole("radiogroup", {
      name: "Strata edge routing preset",
    });
    expect(within(routing).getByRole("radio", { name: "Custom" })).toBeTruthy();
  });

  it("shows the pre-import diagnostic placeholder with no scene elements", () => {
    // In isolation the ExcalidrawElementsContext default is [] → declared 0.
    renderPanel();
    expect(screen.getByText("Edge stats appear after import")).toBeTruthy();
  });
});
