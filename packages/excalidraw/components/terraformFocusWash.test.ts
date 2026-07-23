import { afterEach, describe, expect, it } from "vitest";

import {
  TERRAFORM_FOCUS_WASH_DURATION_MS,
  clearTerraformFocusWashDescriptor,
  getTerraformFocusWashDescriptor,
  isTerraformFocusWashAnimating,
  publishTerraformFocusWashDescriptor,
  subscribeTerraformFocusWash,
  terraformFocusWashAlphaForElement,
  type TerraformFocusWashDescriptor,
} from "./terraformFocusWash";

const makeDescriptor = (
  overrides: Partial<TerraformFocusWashDescriptor> = {},
): TerraformFocusWashDescriptor => ({
  levelByElementId: new Map([
    ["a", 25],
    ["b", 85],
  ]),
  clickCenter: { x: 0, y: 0 },
  startTs: 1000,
  durationMs: TERRAFORM_FOCUS_WASH_DURATION_MS,
  maxRadius: 500,
  viewBackgroundColor: "#ffffff",
  ...overrides,
});

/** A stand-in for `app.canvas` — any distinct object works as an instance key. */
const makeInstanceKey = (): object => ({});

describe("terraform focus wash descriptor store", () => {
  const instanceKey = makeInstanceKey();

  afterEach(() => {
    clearTerraformFocusWashDescriptor(instanceKey);
  });

  it("publishes, reads back, notifies subscribers, and clears", () => {
    expect(getTerraformFocusWashDescriptor(instanceKey)).toBeNull();

    let notifications = 0;
    const unsubscribe = subscribeTerraformFocusWash(instanceKey, () => {
      notifications += 1;
    });

    const descriptor = makeDescriptor();
    publishTerraformFocusWashDescriptor(instanceKey, descriptor);
    expect(getTerraformFocusWashDescriptor(instanceKey)).toBe(descriptor);
    expect(notifications).toBe(1);

    clearTerraformFocusWashDescriptor(instanceKey);
    expect(getTerraformFocusWashDescriptor(instanceKey)).toBeNull();
    expect(notifications).toBe(2);

    // Clearing an already-clear store is a no-op (no extra notification).
    clearTerraformFocusWashDescriptor(instanceKey);
    expect(notifications).toBe(2);

    unsubscribe();
  });

  it("reports the animating window from the sweep clock", () => {
    const descriptor = makeDescriptor({ startTs: 1000 });
    expect(isTerraformFocusWashAnimating(null, 1000)).toBe(false);
    expect(isTerraformFocusWashAnimating(descriptor, 1000)).toBe(true);
    expect(
      isTerraformFocusWashAnimating(
        descriptor,
        1000 + TERRAFORM_FOCUS_WASH_DURATION_MS - 1,
      ),
    ).toBe(true);
    expect(
      isTerraformFocusWashAnimating(
        descriptor,
        1000 + TERRAFORM_FOCUS_WASH_DURATION_MS,
      ),
    ).toBe(false);
    // A static (no-sweep) descriptor never animates.
    expect(
      isTerraformFocusWashAnimating(
        makeDescriptor({ clickCenter: null }),
        1000,
      ),
    ).toBe(false);
  });

  // Regression test for the un-namespaced module-singleton bug: two mounted
  // `<Excalidraw/>` instances (a supported, tested configuration — see
  // `withInternalFallback.test.tsx`) must not see or clobber each other's
  // wash descriptor.
  it("isolates the descriptor per instance key — engage/clear in one instance never touches another", () => {
    const instanceA = makeInstanceKey();
    const instanceB = makeInstanceKey();

    expect(getTerraformFocusWashDescriptor(instanceA)).toBeNull();
    expect(getTerraformFocusWashDescriptor(instanceB)).toBeNull();

    let notificationsA = 0;
    let notificationsB = 0;
    const unsubscribeA = subscribeTerraformFocusWash(instanceA, () => {
      notificationsA += 1;
    });
    const unsubscribeB = subscribeTerraformFocusWash(instanceB, () => {
      notificationsB += 1;
    });

    // Engage focus in instance A only.
    const descriptorA = makeDescriptor({
      levelByElementId: new Map([["only-in-a", 10]]),
    });
    publishTerraformFocusWashDescriptor(instanceA, descriptorA);

    expect(getTerraformFocusWashDescriptor(instanceA)).toBe(descriptorA);
    // Instance B is completely unaffected: no descriptor, no notification.
    expect(getTerraformFocusWashDescriptor(instanceB)).toBeNull();
    expect(notificationsA).toBe(1);
    expect(notificationsB).toBe(0);

    // Engage a DIFFERENT focus in instance B; instance A's descriptor must be
    // untouched by this — the historical bug (module-level singleton) would
    // have had B's publish silently overwrite A's descriptor.
    const descriptorB = makeDescriptor({
      levelByElementId: new Map([["only-in-b", 40]]),
      startTs: 2000,
    });
    publishTerraformFocusWashDescriptor(instanceB, descriptorB);

    expect(getTerraformFocusWashDescriptor(instanceA)).toBe(descriptorA);
    expect(getTerraformFocusWashDescriptor(instanceB)).toBe(descriptorB);
    expect(notificationsA).toBe(1);
    expect(notificationsB).toBe(1);

    // Clearing (simulating instance A's unmount) must not affect instance B.
    clearTerraformFocusWashDescriptor(instanceA);
    expect(getTerraformFocusWashDescriptor(instanceA)).toBeNull();
    expect(getTerraformFocusWashDescriptor(instanceB)).toBe(descriptorB);
    expect(notificationsA).toBe(2);
    expect(notificationsB).toBe(1);

    unsubscribeA();
    unsubscribeB();
    clearTerraformFocusWashDescriptor(instanceB);
  });
});

describe("terraformFocusWashAlphaForElement", () => {
  it("returns 1 (no wash) for unmanaged / full-level elements", () => {
    const descriptor = makeDescriptor({ clickCenter: null });
    // Not in the level map ⇒ no wash.
    expect(
      terraformFocusWashAlphaForElement(descriptor, "zzz", 0, 0, 2000),
    ).toBe(1);
    // Level 100 ⇒ no wash.
    const full = makeDescriptor({
      clickCenter: null,
      levelByElementId: new Map([["a", 100]]),
    });
    expect(terraformFocusWashAlphaForElement(full, "a", 0, 0, 2000)).toBe(1);
  });

  it("applies the full target factor immediately for a static descriptor", () => {
    const descriptor = makeDescriptor({ clickCenter: null });
    // level 25 ⇒ washFactor 0.75 ⇒ alpha 0.25.
    expect(
      terraformFocusWashAlphaForElement(descriptor, "a", 999, 999, 2000),
    ).toBeCloseTo(0.25, 5);
    // level 85 ⇒ washFactor 0.15 ⇒ alpha 0.85.
    expect(
      terraformFocusWashAlphaForElement(descriptor, "b", 999, 999, 2000),
    ).toBeCloseTo(0.85, 5);
  });

  it("staggers the wash radially: at t=0 nothing is washed, at t=end all reach target", () => {
    const descriptor = makeDescriptor({
      startTs: 1000,
      maxRadius: 500,
      clickCenter: { x: 0, y: 0 },
    });
    // At the very start the sweep front has not reached the element ⇒ alpha 1.
    const far = terraformFocusWashAlphaForElement(
      descriptor,
      "a",
      500,
      0,
      1000,
    );
    expect(far).toBe(1);

    // After the sweep completes, a within-radius element reaches its full
    // target wash (level 25 ⇒ alpha 0.25), independent of distance.
    const settled = terraformFocusWashAlphaForElement(
      descriptor,
      "a",
      500,
      0,
      1000 + TERRAFORM_FOCUS_WASH_DURATION_MS,
    );
    expect(settled).toBeCloseTo(0.25, 5);

    // An element AT the click origin washes earlier than a far one: partway
    // through the sweep the near element is already more washed (lower alpha).
    const midTs = 1000 + TERRAFORM_FOCUS_WASH_DURATION_MS * 0.4;
    const nearMid = terraformFocusWashAlphaForElement(
      descriptor,
      "a",
      0,
      0,
      midTs,
    );
    const farMid = terraformFocusWashAlphaForElement(
      descriptor,
      "a",
      500,
      0,
      midTs,
    );
    expect(nearMid).toBeLessThan(farMid);
  });
});
