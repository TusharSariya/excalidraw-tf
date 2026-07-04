import { describe, expect, it, vi } from "vitest";

import { Random } from "roughjs/bin/math";

import { randomInteger } from "./random";

describe("randomInteger", () => {
  it("never returns 0 when the underlying generator draws exactly 0", () => {
    // RoughJS treats a `seed` of exactly 0 as "unseeded" and falls back to
    // `Math.random()` per render, breaking determinism for any element whose
    // seed (or versionNonce) landed on 0 — one value among 2^31. `next()` is a
    // regular prototype method (roughjs/bin/math), so spying on the prototype
    // intercepts the module-level singleton's calls too.
    const spy = vi.spyOn(Random.prototype, "next").mockReturnValue(0);
    try {
      expect(randomInteger()).not.toBe(0);
      expect(randomInteger()).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("never returns 0 for a draw just under the 1-in-2^31 floor threshold", () => {
    const spy = vi.spyOn(Random.prototype, "next").mockReturnValue(1 / 2 ** 32); // Math.floor(x * 2**31) === 0 here too.
    try {
      expect(randomInteger()).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns the raw drawn integer unchanged when it is already nonzero", () => {
    const spy = vi.spyOn(Random.prototype, "next").mockReturnValue(0.5);
    try {
      expect(randomInteger()).toBe(Math.floor(0.5 * 2 ** 31));
    } finally {
      spy.mockRestore();
    }
  });
});
