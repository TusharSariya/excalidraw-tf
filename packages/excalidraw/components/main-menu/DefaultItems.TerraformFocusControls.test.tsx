import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import DropdownMenu from "../dropdownMenu/DropdownMenu";

import { TerraformFocusControls } from "./DefaultItems";

const hoisted = vi.hoisted(() => ({
  setAppState: vi.fn(),
  appState: {
    terraformFocusDirection: "both",
    terraformFocusMaxHops: null,
  } as {
    terraformFocusDirection: string;
    terraformFocusMaxHops: number | null;
  },
}));

vi.mock("../App", () => ({
  useApp: () => ({
    scene: {
      getElementsIncludingDeleted: () => [],
    },
    state: hoisted.appState,
  }),
  useExcalidrawSetAppState: () => hoisted.setAppState,
  useExcalidrawElements: () => [],
  useEditorInterface: () => ({ formFactor: "desktop" }),
}));

const renderFocusControls = () =>
  render(
    <div className="excalidraw">
      <DropdownMenu open>
        <DropdownMenu.Trigger onToggle={() => {}}>Menu</DropdownMenu.Trigger>
        <DropdownMenu.Content onClickOutside={() => {}}>
          <TerraformFocusControls />
        </DropdownMenu.Content>
      </DropdownMenu>
    </div>,
  );

const hopsRadios = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLInputElement>(
      'input[name="terraform-focus-hops"]',
    ),
  );

const checkedHopsTestId = (container: HTMLElement) => {
  const checked = hopsRadios(container).filter((input) => input.checked);
  expect(checked).toHaveLength(1);
  return checked[0].getAttribute("data-testid");
};

describe("TerraformFocusControls hops radio (W13 WP2)", () => {
  beforeEach(() => {
    hoisted.setAppState.mockReset();
    hoisted.appState.terraformFocusDirection = "both";
    hoisted.appState.terraformFocusMaxHops = null;
  });

  describe("value derivation", () => {
    it("null (legacy default) selects the '3' choice", () => {
      const { container } = renderFocusControls();
      expect(checkedHopsTestId(container)).toBe("terraform-focus-hops-3");
    });

    it("-1 sentinel selects the unlimited choice", () => {
      hoisted.appState.terraformFocusMaxHops = -1;
      const { container } = renderFocusControls();
      expect(checkedHopsTestId(container)).toBe(
        "terraform-focus-hops-unlimited",
      );
    });

    it("Infinity selects the unlimited choice", () => {
      hoisted.appState.terraformFocusMaxHops = Infinity;
      const { container } = renderFocusControls();
      expect(checkedHopsTestId(container)).toBe(
        "terraform-focus-hops-unlimited",
      );
    });

    it.each([0, 1, 2, 3])("curated value %i selects its own choice", (n) => {
      hoisted.appState.terraformFocusMaxHops = n;
      const { container } = renderFocusControls();
      expect(checkedHopsTestId(container)).toBe(`terraform-focus-hops-${n}`);
    });

    it("uncurated value 7 inserts a dynamic choice between '3' and unlimited", () => {
      hoisted.appState.terraformFocusMaxHops = 7;
      const { container } = renderFocusControls();
      const radios = hopsRadios(container);
      expect(radios).toHaveLength(6);
      expect(radios.map((input) => input.getAttribute("data-testid"))).toEqual([
        "terraform-focus-hops-0",
        "terraform-focus-hops-1",
        "terraform-focus-hops-2",
        "terraform-focus-hops-3",
        "terraform-focus-hops-7",
        "terraform-focus-hops-unlimited",
      ]);
      expect(checkedHopsTestId(container)).toBe("terraform-focus-hops-7");
      expect(radios[4].getAttribute("aria-label")).toBe("Focus hops: 7");
    });

    it("dynamic choice is absent for curated values", () => {
      const { container } = renderFocusControls();
      expect(hopsRadios(container)).toHaveLength(5);
    });
  });

  describe("write-back mapping", () => {
    it("selecting '3' writes null, never literal 3", () => {
      hoisted.appState.terraformFocusMaxHops = 0;
      const { getByTestId } = renderFocusControls();
      fireEvent.click(getByTestId("terraform-focus-hops-3"));
      expect(hoisted.setAppState).toHaveBeenCalledWith({
        terraformFocusMaxHops: null,
      });
    });

    it("selecting '0' writes the number 0", () => {
      const { getByTestId } = renderFocusControls();
      fireEvent.click(getByTestId("terraform-focus-hops-0"));
      expect(hoisted.setAppState).toHaveBeenCalledWith({
        terraformFocusMaxHops: 0,
      });
    });

    it("selecting unlimited writes the -1 sentinel", () => {
      const { getByTestId } = renderFocusControls();
      fireEvent.click(getByTestId("terraform-focus-hops-unlimited"));
      expect(hoisted.setAppState).toHaveBeenCalledWith({
        terraformFocusMaxHops: -1,
      });
    });

    it("numeric write works while the dynamic choice is present", () => {
      // The dynamic radio itself is always the checked one (it only exists
      // when selected), so clicking it fires no change event; verify the
      // numeric mapping by moving off it instead.
      hoisted.appState.terraformFocusMaxHops = 7;
      const { getByTestId } = renderFocusControls();
      fireEvent.click(getByTestId("terraform-focus-hops-2"));
      expect(hoisted.setAppState).toHaveBeenCalledWith({
        terraformFocusMaxHops: 2,
      });
    });
  });

  describe("accessibility", () => {
    it("renders 5 native radio inputs with the specified aria-labels", () => {
      const { container } = renderFocusControls();
      const radios = hopsRadios(container);
      expect(radios).toHaveLength(5);
      radios.forEach((input) => {
        expect(input.type).toBe("radio");
      });
      expect(radios.map((input) => input.getAttribute("aria-label"))).toEqual([
        "Focus hops: focused node only",
        "Focus hops: 1",
        "Focus hops: 2",
        "Focus hops: 3 (default)",
        "Focus hops: unlimited",
      ]);
    });
  });
});
