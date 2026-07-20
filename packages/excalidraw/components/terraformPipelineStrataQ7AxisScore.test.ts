/**
 * Q7-AXIS scorer unit tests (W11 WP2). Verifies the Wilson 95% interval against
 * a hand-computed known answer, the randomized A/B-frame scoring rule, and the
 * robustness contracts (partial/missing/ambiguous labels, unknown edge ids,
 * duplicate labels), plus the shared source-left-of-target proxy tie case.
 */
import { describe, expect, it } from "vitest";

import {
  normalizeOwnerLabel,
  scoreQ7Axis,
  scoreQ7AxisPreset,
  sourceLeftOfTarget,
  wilsonInterval,
  WILSON_Z_95,
  type Q7AxisKey,
  type Q7AxisKeyEntry,
  type Q7AxisLabelEntry,
} from "./terraformPipelineStrataQ7AxisScore";

/** Build a synthetic key entry. `slot` = which sheet slot holds the declared
 * source (so declared-correct read is "A->B" when "A", else "B->A"). */
function keyEntry(
  index: number,
  slot: "A" | "B",
  extra: Partial<Q7AxisKeyEntry> = {},
): Q7AxisKeyEntry {
  return {
    index,
    edgeId: `edge-${index}`,
    sourceAddress: `aws_thing.src_${index}`,
    targetAddress: `aws_thing.tgt_${index}`,
    canonicalEdgeKey: `aws_thing.src_${index} aws_thing.tgt_${index} `,
    declaredSourceSlot: slot,
    machineSourceLeftOfTarget: slot === "A",
    ...extra,
  };
}

/** The label an owner writes to be CORRECT for a given declared-source slot. */
const correctLabel = (slot: "A" | "B"): string =>
  slot === "A" ? "A→B" : "B→A";
const wrongLabel = (slot: "A" | "B"): string => (slot === "A" ? "B→A" : "A→B");

describe("wilsonInterval", () => {
  it("matches the hand-computed 16/20 known answer (z = 95%)", () => {
    const w = wilsonInterval(16, 20)!;
    expect(w.n).toBe(20);
    expect(w.successes).toBe(16);
    expect(w.pointEstimate).toBeCloseTo(0.8, 12);
    expect(w.z).toBe(WILSON_Z_95);
    // Hand-computed: center 0.7516607, margin 0.1676782.
    expect(w.lo).toBeCloseTo(0.583983, 5);
    expect(w.hi).toBeCloseTo(0.919339, 5);
  });

  it("clamps to [0,1] at the extremes and returns null for n=0", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    const perfect = wilsonInterval(10, 10)!;
    expect(perfect.hi).toBeLessThanOrEqual(1);
    expect(perfect.lo).toBeGreaterThan(0);
    const zero = wilsonInterval(0, 10)!;
    expect(zero.lo).toBe(0);
    expect(zero.hi).toBeLessThan(1);
  });
});

describe("sourceLeftOfTarget proxy", () => {
  it("reports left/right and null on ties", () => {
    expect(sourceLeftOfTarget(10, 100)).toBe(true); // source left of target
    expect(sourceLeftOfTarget(100, 10)).toBe(false); // source right of target
    expect(sourceLeftOfTarget(50, 50)).toBeNull(); // exact tie
    expect(sourceLeftOfTarget(50, 50.4)).toBeNull(); // within default 0.5px band
    expect(sourceLeftOfTarget(50, 51)).toBe(true); // outside band
    expect(sourceLeftOfTarget(Number.NaN, 10)).toBeNull();
  });
});

describe("normalizeOwnerLabel", () => {
  it("accepts arrow/ascii/word variants, blanks, and rejects noise", () => {
    expect(normalizeOwnerLabel("A→B")).toBe("A->B");
    expect(normalizeOwnerLabel(" a -> b ")).toBe("A->B");
    expect(normalizeOwnerLabel("B > A")).toBe("B->A");
    expect(normalizeOwnerLabel("b to a")).toBe("B->A");
    expect(normalizeOwnerLabel("ambiguous")).toBe("ambiguous");
    expect(normalizeOwnerLabel("amb")).toBe("ambiguous");
    expect(normalizeOwnerLabel("")).toBe("missing");
    expect(normalizeOwnerLabel(undefined)).toBe("missing");
    expect(normalizeOwnerLabel("sideways")).toBe("invalid");
  });
});

describe("scoreQ7AxisPreset", () => {
  it("happy path: 16/20 correct → accuracy 0.8 + hand-computed Wilson bounds", () => {
    const entries: Q7AxisKeyEntry[] = [];
    const labels: Q7AxisLabelEntry[] = [];
    for (let i = 1; i <= 20; i++) {
      const slot: "A" | "B" = i % 2 === 0 ? "A" : "B";
      entries.push(keyEntry(i, slot));
      // First 16 correct, last 4 wrong.
      labels.push({
        index: i,
        ownerLabel: i <= 16 ? correctLabel(slot) : wrongLabel(slot),
      });
    }
    const key: Q7AxisKey = { preset: "P1", seed: 20260704, entries };
    const score = scoreQ7AxisPreset(key, labels);

    expect(score.n).toBe(20);
    expect(score.matches).toBe(16);
    expect(score.mismatches).toBe(4);
    expect(score.ambiguous).toBe(0);
    expect(score.missing).toBe(0);
    expect(score.accuracy).toBeCloseTo(0.8, 12);
    expect(score.wilson!.lo).toBeCloseTo(0.583983, 5);
    expect(score.wilson!.hi).toBeCloseTo(0.919339, 5);
  });

  it("randomized A/B frame: a read is scored THROUGH the sheet frame, not by literal letters", () => {
    // Declared source is in slot B for both → declared-correct read is "B->A".
    const key: Q7AxisKey = {
      preset: "P1",
      seed: 20260704,
      entries: [keyEntry(1, "B"), keyEntry(2, "B")],
    };
    const score = scoreQ7AxisPreset(key, [
      { index: 1, ownerLabel: "A→B" }, // mismatch — B is the source
      { index: 2, ownerLabel: "B→A" }, // match
    ]);
    expect(score.matches).toBe(1);
    expect(score.mismatches).toBe(1);
    expect(score.perEdge.find((e) => e.index === 1)!.outcome).toBe("mismatch");
    expect(score.perEdge.find((e) => e.index === 2)!.outcome).toBe("match");
  });

  it("ambiguous is counted but excluded from the accuracy denominator", () => {
    const key: Q7AxisKey = {
      preset: "P1",
      seed: 20260704,
      entries: [keyEntry(1, "A"), keyEntry(2, "A"), keyEntry(3, "A")],
    };
    const score = scoreQ7AxisPreset(key, [
      { index: 1, ownerLabel: "A→B" }, // match
      { index: 2, ownerLabel: "ambiguous" }, // excluded
      { index: 3, ownerLabel: "B→A" }, // mismatch
    ]);
    expect(score.matches).toBe(1);
    expect(score.mismatches).toBe(1);
    expect(score.ambiguous).toBe(1);
    expect(score.n).toBe(2); // denominator excludes the ambiguous row
    expect(score.accuracy).toBeCloseTo(0.5, 12);
  });

  it("partial/missing labels: score what exists, report missing count", () => {
    const key: Q7AxisKey = {
      preset: "P1",
      seed: 20260704,
      entries: [keyEntry(1, "A"), keyEntry(2, "A"), keyEntry(3, "A")],
    };
    // Only index 1 is filled; 2 is blank; 3 has no label row at all.
    const score = scoreQ7AxisPreset(key, [
      { index: 1, ownerLabel: "A→B" },
      { index: 2, ownerLabel: "" },
    ]);
    expect(score.matches).toBe(1);
    expect(score.n).toBe(1);
    expect(score.missing).toBe(2); // blank + absent row
    expect(score.accuracy).toBeCloseTo(1, 12);
  });

  it("invalid non-empty labels are reported and excluded from the denominator", () => {
    const key: Q7AxisKey = {
      preset: "P1",
      seed: 20260704,
      entries: [keyEntry(1, "A"), keyEntry(2, "A")],
    };
    const score = scoreQ7AxisPreset(key, [
      { index: 1, ownerLabel: "A→B" },
      { index: 2, ownerLabel: "diagonal-ish" },
    ]);
    expect(score.matches).toBe(1);
    expect(score.invalid).toBe(1);
    expect(score.n).toBe(1);
  });

  it("unknown edge id becomes an error entry and never crashes", () => {
    const key: Q7AxisKey = {
      preset: "P1",
      seed: 20260704,
      entries: [keyEntry(1, "A")],
    };
    const score = scoreQ7AxisPreset(key, [
      { index: 1, ownerLabel: "A→B" },
      { index: 99, ownerLabel: "A→B", edgeId: "ghost" }, // not in key
    ]);
    expect(score.matches).toBe(1);
    expect(score.unknown).toBe(1);
    const ghost = score.perEdge.find((e) => e.index === 99)!;
    expect(ghost.outcome).toBe("unknown");
    expect(ghost.declaredRead).toBeNull();
    expect(score.warnings.some((w) => w.includes("99"))).toBe(true);
  });

  it("duplicate labels: last wins + a warning count", () => {
    const key: Q7AxisKey = {
      preset: "P1",
      seed: 20260704,
      entries: [keyEntry(1, "A")],
    };
    const score = scoreQ7AxisPreset(key, [
      { index: 1, ownerLabel: "B→A" }, // superseded
      { index: 1, ownerLabel: "A→B" }, // wins → match
    ]);
    expect(score.duplicateWarnings).toBe(1);
    expect(score.matches).toBe(1);
    expect(score.mismatches).toBe(0);
    expect(score.warnings.some((w) => w.includes("duplicate"))).toBe(true);
  });

  it("edgeId mismatch against the key is warned but still scored by index", () => {
    const key: Q7AxisKey = {
      preset: "P1",
      seed: 20260704,
      entries: [keyEntry(1, "A")],
    };
    const score = scoreQ7AxisPreset(key, [
      { index: 1, ownerLabel: "A→B", edgeId: "wrong-id" },
    ]);
    expect(score.matches).toBe(1);
    expect(score.warnings.some((w) => w.includes("edgeId"))).toBe(true);
  });
});

describe("scoreQ7Axis (pooled)", () => {
  it("pools presets into a combined accuracy + Wilson", () => {
    const p1: Q7AxisKey = {
      preset: "P1",
      seed: 20260704,
      entries: [keyEntry(1, "A"), keyEntry(2, "A")],
    };
    const p2: Q7AxisKey = {
      preset: "P2",
      seed: 20260704,
      entries: [keyEntry(1, "A"), keyEntry(2, "A")],
    };
    const result = scoreQ7Axis([
      {
        key: p1,
        labels: [
          { index: 1, ownerLabel: "A→B" }, // match
          { index: 2, ownerLabel: "A→B" }, // match
        ],
      },
      {
        key: p2,
        labels: [
          { index: 1, ownerLabel: "A→B" }, // match
          { index: 2, ownerLabel: "B→A" }, // mismatch
        ],
      },
    ]);
    expect(result.perPreset).toHaveLength(2);
    expect(result.pooled.n).toBe(4);
    expect(result.pooled.matches).toBe(3);
    expect(result.pooled.mismatches).toBe(1);
    expect(result.pooled.accuracy).toBeCloseTo(0.75, 12);
    expect(result.pooled.wilson!.n).toBe(4);
  });
});
