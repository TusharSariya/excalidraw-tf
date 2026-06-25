import { describe, expect, it } from "vitest";

import {
  repackColumns,
  REPACK_BRUTE_FORCE_MAX,
  type RepackLeaf,
} from "./terraformPipelineRepack";

const GAP = 36;
const H = 100;

const leaf = (key: string, col: number, y: number, height = H): RepackLeaf => ({
  key,
  clusterId: key,
  col,
  height,
  y,
});

/** Build fanout/fanin maps from directed edges [source, target]. */
const edges = (es: [string, string][]) => {
  const fanout = new Map<string, string[]>();
  const fanin = new Map<string, string[]>();
  for (const [s, t] of es) {
    (fanout.get(s) ?? fanout.set(s, []).get(s)!).push(t);
    (fanin.get(t) ?? fanin.set(t, []).get(t)!).push(s);
  }
  return { fanout, fanin };
};

/** Total intra-container edge |ΔY| over CENTER-Y for a placement (key → top-Y). */
const totalDeltaY = (
  leaves: readonly RepackLeaf[],
  es: [string, string][],
  tops: ReadonlyMap<string, number>,
): number => {
  const center = (k: string) => {
    const lf = leaves.find((l) => l.key === k)!;
    return (tops.get(k) ?? lf.y) + lf.height / 2;
  };
  let total = 0;
  for (const [s, t] of es) {
    total += Math.abs(center(s) - center(t));
  }
  return total;
};

describe("terraformPipelineRepack", () => {
  it("empty input → null (no-op)", () => {
    const { fanout, fanin } = edges([]);
    expect(repackColumns([], fanout, fanin, 0, 100, GAP)).toBeNull();
  });

  it("reduces total |ΔY| when a permutation flattens a stretched edge (brute force)", () => {
    // col 0: A (center 50). col 1: X (center 50), Y (center 186). Edge A→Y stretches.
    // Permuting col 1 to [Y, X] aligns Y's center with A → |ΔY| 136 → 0.
    const leaves = [leaf("A", 0, 0), leaf("X", 1, 0), leaf("Y", 1, H + GAP)];
    const es: [string, string][] = [["A", "Y"]];
    const { fanout, fanin } = edges(es);
    const bandTop = 0;
    const bandBottom = H + GAP + H; // 236 — the span the straightened leaves occupy

    const before = totalDeltaY(
      leaves,
      es,
      new Map(leaves.map((l) => [l.key, l.y])),
    );
    expect(before).toBeGreaterThan(0);

    const result = repackColumns(
      leaves,
      fanout,
      fanin,
      bandTop,
      bandBottom,
      GAP,
    );
    expect(result).not.toBeNull();
    const tops = new Map([...result!].map(([k, r]) => [k, r.y]));
    const after = totalDeltaY(leaves, es, tops);
    expect(after).toBeLessThan(before);
  });

  it("never exceeds the band (CON-3 containment)", () => {
    const leaves = [leaf("A", 0, 0), leaf("X", 1, 0), leaf("Y", 1, H + GAP)];
    const { fanout, fanin } = edges([["A", "Y"]]);
    const bandTop = 0;
    const bandBottom = H + GAP + H;
    const result = repackColumns(
      leaves,
      fanout,
      fanin,
      bandTop,
      bandBottom,
      GAP,
    )!;
    for (const leafItem of leaves) {
      const r = result.get(leafItem.key)!;
      expect(r.y).toBeGreaterThanOrEqual(bandTop - 1e-6);
      expect(r.y + leafItem.height).toBeLessThanOrEqual(bandBottom + 1e-6);
    }
  });

  it("keeps siblings non-overlapping (height+gap separation)", () => {
    const leaves = [
      leaf("A", 0, 0),
      leaf("X", 1, 0),
      leaf("Y", 1, H + GAP),
      leaf("Z", 1, 2 * (H + GAP)),
    ];
    const { fanout, fanin } = edges([
      ["A", "Z"],
      ["A", "X"],
    ]);
    const bandBottom = 3 * H + 2 * GAP;
    const result = repackColumns(leaves, fanout, fanin, 0, bandBottom, GAP)!;
    // group col-1 leaves by their assigned top-Y; assert pairwise separation.
    const col1 = ["X", "Y", "Z"]
      .map((k) => ({
        k,
        top: result.get(k)!.y,
        h: leaves.find((l) => l.key === k)!.height,
      }))
      .sort((a, b) => a.top - b.top);
    for (let i = 1; i < col1.length; i++) {
      expect(col1[i]!.top).toBeGreaterThanOrEqual(
        col1[i - 1]!.top + col1[i - 1]!.h + GAP - 1e-6,
      );
    }
  });

  it("does not increase crossings (crossing-preserving)", () => {
    // Two parallel edges A→X and B→Y already uncrossed; the re-pack must not
    // introduce a crossing while chasing |ΔY|.
    const leaves = [
      leaf("A", 0, 0),
      leaf("B", 0, H + GAP),
      leaf("X", 1, 0),
      leaf("Y", 1, H + GAP),
    ];
    const es: [string, string][] = [
      ["A", "X"],
      ["B", "Y"],
    ];
    const { fanout, fanin } = edges(es);
    const bandBottom = 2 * H + GAP;
    const result = repackColumns(leaves, fanout, fanin, 0, bandBottom, GAP);
    // Already optimal & uncrossed ⇒ no improving move ⇒ null (never-worse no-op).
    expect(result).toBeNull();
  });

  it("is a no-op (null) when no permutation helps", () => {
    // single edge already perfectly flat — nothing to reclaim.
    const leaves = [leaf("A", 0, 0), leaf("X", 1, 0)];
    const { fanout, fanin } = edges([["A", "X"]]);
    const result = repackColumns(leaves, fanout, fanin, 0, 2 * H, GAP);
    expect(result).toBeNull();
  });

  it("is deterministic — 3 runs identical (brute-force path)", () => {
    const build = () => [
      leaf("A", 0, 0),
      leaf("X", 1, 0),
      leaf("Y", 1, H + GAP),
    ];
    const es: [string, string][] = [["A", "Y"]];
    const run = () => {
      const { fanout, fanin } = edges(es);
      const r = repackColumns(build(), fanout, fanin, 0, H + GAP + H, GAP)!;
      return JSON.stringify([...r.entries()].sort());
    };
    const a = run();
    const b = run();
    const c = run();
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("uses the brute-force path at the threshold and the deterministic path above", () => {
    // Build a column of N leaves in col 1, each fed by a distinct col-0 source whose
    // center is the REVERSE of the col-1 source-order — so re-permuting col 1 flattens
    // every edge. Exercise both N = MAX (brute) and N = MAX + 2 (deterministic).
    const buildCase = (n: number) => {
      const leaves: RepackLeaf[] = [];
      const es: [string, string][] = [];
      for (let i = 0; i < n; i++) {
        // col-0 sources placed so source i sits at band position (n-1-i) — reversed.
        leaves.push(leaf(`S${i}`, 0, (n - 1 - i) * (H + GAP)));
        leaves.push(leaf(`T${i}`, 1, i * (H + GAP)));
        es.push([`S${i}`, `T${i}`]);
      }
      return { leaves, es };
    };
    const bandBottomFor = (n: number) => n * H + (n - 1) * GAP;

    for (const n of [REPACK_BRUTE_FORCE_MAX, REPACK_BRUTE_FORCE_MAX + 2]) {
      const { leaves, es } = buildCase(n);
      const { fanout, fanin } = edges(es);
      const before = totalDeltaY(
        leaves,
        es,
        new Map(leaves.map((l) => [l.key, l.y])),
      );
      const run = () => {
        const fresh = buildCase(n);
        const fm = edges(fresh.es);
        const r = repackColumns(
          fresh.leaves,
          fm.fanout,
          fm.fanin,
          0,
          bandBottomFor(n),
          GAP,
        )!;
        return r;
      };
      const r1 = run();
      const r2 = run();
      expect(r1).not.toBeNull();
      // reproducible
      expect(JSON.stringify([...r1.entries()].sort())).toBe(
        JSON.stringify([...r2.entries()].sort()),
      );
      const tops = new Map([...r1].map(([k, v]) => [k, v.y]));
      const after = totalDeltaY(leaves, es, tops);
      expect(after).toBeLessThan(before);
    }
  });

  it("never grows the band even when a growing permutation would lower |ΔY| more", () => {
    // tight band that exactly fits the 2 col-1 leaves; the re-pack may reorder but can
    // never push a leaf outside [bandTop, bandBottom].
    const leaves = [leaf("A", 0, 0), leaf("X", 1, 0), leaf("Y", 1, H + GAP)];
    const { fanout, fanin } = edges([["A", "Y"]]);
    const bandTop = 0;
    const bandBottom = H + GAP + H;
    const result = repackColumns(
      leaves,
      fanout,
      fanin,
      bandTop,
      bandBottom,
      GAP,
    );
    if (result) {
      for (const lf of leaves) {
        const r = result.get(lf.key)!;
        expect(r.y).toBeGreaterThanOrEqual(bandTop - 1e-6);
        expect(r.y + lf.height).toBeLessThanOrEqual(bandBottom + 1e-6);
      }
    }
  });
});
