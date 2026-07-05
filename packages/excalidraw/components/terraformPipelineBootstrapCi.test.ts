/**
 * Unit fixtures for the pinned paired bootstrap-CI harness (WP-3d, rcll-v2 spec
 * v3.1 §2.5 + §12). Known answers are either hand-derivable (all-equal vector,
 * gate policy) or captured once from the pinned PRNG and frozen as regression
 * anchors — regenerate ONLY if mulberry32 or the CI method changes.
 */
import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_B,
  BOOTSTRAP_SEED,
  bootstrapGatePolicy,
  canonicalEdgeKey,
  mulberry32,
  pairedBootstrapCi,
} from "./terraformPipelineBootstrapCi";

describe("mulberry32 pinned PRNG", () => {
  it("known first three outputs for the frozen seed 20260704", () => {
    const r = mulberry32(BOOTSTRAP_SEED);
    // Hand-recorded 2026-07-05 (node reference run).
    expect(r()).toBeCloseTo(0.12818326242268085, 15);
    expect(r()).toBeCloseTo(0.33862593933008611, 15);
    expect(r()).toBeCloseTo(0.35023983265273273, 15);
  });

  it("is a pure function of the seed (two instances agree)", () => {
    const a = mulberry32(BOOTSTRAP_SEED);
    const b = mulberry32(BOOTSTRAP_SEED);
    for (let i = 0; i < 20; i++) {
      expect(a()).toBe(b());
    }
  });
});

const mapOf = (o: Record<string, number>): Map<string, number> =>
  new Map(Object.entries(o));

describe("pairedBootstrapCi — known answers", () => {
  it("symmetric delta vector [-2,-1,0,1,2] ⇒ point 0, CI [-1.2, 1.2]", () => {
    // deltas = candidate − baseline; baseline all 0.
    const baseline = mapOf({ k0: 0, k1: 0, k2: 0, k3: 0, k4: 0 });
    const candidate = mapOf({ k0: -2, k1: -1, k2: 0, k3: 1, k4: 2 });
    const r = pairedBootstrapCi({ baseline, candidate });
    expect(r.n).toBe(5);
    expect(r.point).toBe(0);
    // Captured from mulberry32(20260704), B=1000, floor-percentile method.
    expect(r.lo).toBe(-1.2);
    expect(r.hi).toBe(1.2);
    expect(r.width).toBeCloseTo(2.4, 10);
    expect(r.degenerate).toBe(false);
    expect(r.voided).toBe(false);
    expect(r.status).toBe("ok");
  });

  it("all-equal delta vector ⇒ collapsed CI, degenerate flag (hi == sample max)", () => {
    const baseline = mapOf({ a: 0, b: 0, c: 0, d: 0 });
    const candidate = mapOf({ a: 3, b: 3, c: 3, d: 3 });
    const r = pairedBootstrapCi({ baseline, candidate });
    expect(r.point).toBe(3);
    expect(r.lo).toBe(3);
    expect(r.hi).toBe(3);
    expect(r.width).toBe(0);
    expect(r.degenerate).toBe(true); // hi === paired-delta sample max (3)
    expect(r.voided).toBe(false);
  });
});

describe("pairedBootstrapCi — matching / void", () => {
  it("counts unmatched keys and VOIDs when unmatched > 20% of min(nB,nC)", () => {
    const baseline = mapOf({ a: 1, b: 1, c: 1, d: 1, e: 1 });
    // f,g exist only in candidate ⇒ 2 unmatched; min arm = 5; 0.2*5 = 1; 2 > 1.
    const candidate = mapOf({ a: 2, b: 2, c: 2, d: 2, e: 2, f: 9, g: 9 });
    const r = pairedBootstrapCi({ baseline, candidate });
    expect(r.n).toBe(5);
    expect(r.nBaseline).toBe(5);
    expect(r.nCandidate).toBe(7);
    expect(r.nUnmatched).toBe(2);
    expect(r.voided).toBe(true);
    expect(r.status).toBe("void");
  });

  it("does NOT void exactly at the 20% boundary (unmatched == threshold)", () => {
    const baseline = mapOf({ a: 1, b: 1, c: 1, d: 1, e: 1 });
    // 1 unmatched; 0.2*5 = 1; 1 > 1 is false ⇒ not voided.
    const candidate = mapOf({ a: 2, b: 2, c: 2, d: 2, e: 2, f: 9 });
    const r = pairedBootstrapCi({ baseline, candidate });
    expect(r.nUnmatched).toBe(1);
    expect(r.voided).toBe(false);
    expect(r.status).toBe("ok");
  });

  it("no matched pairs ⇒ voided, degenerate, zeroed", () => {
    const r = pairedBootstrapCi({
      baseline: mapOf({ a: 1 }),
      candidate: mapOf({ b: 2 }),
    });
    expect(r.n).toBe(0);
    expect(r.voided).toBe(true);
    expect(r.status).toBe("void");
    expect(r.degenerate).toBe(true);
  });
});

describe("pairedBootstrapCi — determinism", () => {
  it("running twice on the same input yields identical output", () => {
    const baseline = mapOf({ a: 1, b: 3, c: -2, d: 5, e: 0, f: 4 });
    const candidate = mapOf({ a: 2, b: 1, c: -5, d: 9, e: 1, f: 2 });
    const r1 = pairedBootstrapCi({ baseline, candidate });
    const r2 = pairedBootstrapCi({ baseline, candidate });
    expect(r1).toEqual(r2);
  });

  it("key-iteration order does not affect the result (sorted internally)", () => {
    const r1 = pairedBootstrapCi({
      baseline: mapOf({ a: 1, b: 3, c: -2 }),
      candidate: mapOf({ a: 2, b: 1, c: -5 }),
    });
    const r2 = pairedBootstrapCi({
      baseline: mapOf({ c: -2, a: 1, b: 3 }),
      candidate: mapOf({ b: 1, c: -5, a: 2 }),
    });
    expect(r1).toEqual(r2);
  });

  it("respects B and seed overrides", () => {
    const baseline = mapOf({ a: 0, b: 0, c: 0 });
    const candidate = mapOf({ a: 1, b: 2, c: 3 });
    const def = pairedBootstrapCi({ baseline, candidate });
    const same = pairedBootstrapCi(
      { baseline, candidate },
      { seed: BOOTSTRAP_SEED, B: BOOTSTRAP_B },
    );
    expect(same).toEqual(def);
    const other = pairedBootstrapCi({ baseline, candidate }, { seed: 1 });
    expect(other.point).toBe(def.point); // point estimate is seed-free
  });
});

describe("bootstrapGatePolicy (v3.1 §12)", () => {
  it("nB < 10 ⇒ report-only, no gate", () => {
    expect(bootstrapGatePolicy(9, false)).toEqual({
      gate: "none",
      reportP90: true,
      reportOnly: true,
    });
  });

  it("10 ≤ nB < 30 ⇒ gate p50, report p90", () => {
    expect(bootstrapGatePolicy(10, false).gate).toBe("p50");
    expect(bootstrapGatePolicy(29, false).gate).toBe("p50");
  });

  it("nB ≥ 30 ⇒ gate p90 …", () => {
    expect(bootstrapGatePolicy(30, false).gate).toBe("p90");
  });

  it("… unless the CI is degenerate, which voids the p90 gate even at n ≥ 30", () => {
    expect(bootstrapGatePolicy(50, true).gate).toBe("p50");
  });
});

describe("canonicalEdgeKey", () => {
  it("keys by true direction + relKind (never pre-swapped)", () => {
    expect(canonicalEdgeKey("a", "b", "ref")).toBe("a\u0000b\u0000ref");
    // reversed direction is a DIFFERENT edge (true direction preserved).
    expect(canonicalEdgeKey("b", "a", "ref")).not.toBe(
      canonicalEdgeKey("a", "b", "ref"),
    );
    expect(canonicalEdgeKey("a", "b")).toBe("a\u0000b\u0000");
  });
});
