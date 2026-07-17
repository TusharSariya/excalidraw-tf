/**
 * Objective-correctness fixes from the 2026-07-17 strata audit.
 *
 * S1-1 — the relative-mode (fractional) ε was inherited RAW as the absolute
 * edge-cross HARD CAP, never routed through `resolveStrataPackedEpsilonDelta`.
 * Because the cap is compared against INTEGER crossings, a fractional ε (0<ε<1)
 * collapsed to an effective cap of 0 and VETOED exactly the crossings-band
 * trades the descent's own ε-band was configured to admit. The fix resolves the
 * inherited cap (`resolveInheritedEdgeCrossCap`) at all three sites and unifies
 * the transitive feasibility cap across the sift/non-sift arms.
 *
 * O4-3 — the post-A7 never-worse guard (`chooseStrataRefinedPlacement`) used a
 * DIFFERENT comparator than the descent it guards: with `transitiveAdopt` on it
 * fell through to the crossings-first default and could discard a
 * transitive-selected arm (better weightedC, more crossings) in favour of
 * legacy. The fix threads the active transitive comparator into the guard so one
 * coherent order decides adoption end-to-end.
 *
 * Both proofs are RED on base 9a58db716: the S1-1 block references the new
 * `resolveInheritedEdgeCrossCap` export (absent at base ⇒ compile-RED); the
 * O4-3 block passes the new `transitive` guard argument and asserts the
 * transitive verdict, which base ignores (extra arg) and answers with the
 * crossings-first fallback ⇒ behavioural-RED.
 */
import { describe, expect, it } from "vitest";

import {
  chooseStrataRefinedPlacement,
  resolveInheritedEdgeCrossCap,
  resolveStrataPackedEpsilonDelta,
  scoreStrataPlacementGeometry,
  strataRelocateAdoptable,
  type StrataPackedScore,
} from "./terraformPipelineStrataPackedScoring";

import type {
  StrataBox,
  StrataHullNode,
  StrataModel,
  StrataPlacementResult,
  StrataPrimeEdge,
} from "./terraformPipelineStrataTypes";

// ── shared synthetic builders (mirrors terraformPipelineStrataPackedScoring.test) ──

const box = (x: number, y: number, w = 10, h = 10): StrataBox => ({
  x,
  y,
  width: w,
  height: h,
});

function leafHull(
  id: string,
  role: StrataHullNode["role"],
  leafClusterIds: string[],
  children: StrataHullNode[] = [],
): StrataHullNode {
  return {
    id,
    role,
    policy: "packed",
    path: [id],
    children,
    leafClusterIds,
  } as StrataHullNode;
}

function syntheticModel(root: StrataHullNode): StrataModel {
  return { hullRoot: root } as unknown as StrataModel;
}

function syntheticPlacement(
  leaves: Record<string, StrataBox>,
  hulls: Record<string, StrataBox>,
): StrataPlacementResult {
  return {
    leafBoxes: new Map(Object.entries(leaves)),
    boxedHulls: new Map(
      Object.entries(hulls).map(([id, b]) => [
        id,
        { hull: leafHull(id, "vpc", []), box: b, placed: [] },
      ]),
    ),
  } as unknown as StrataPlacementResult;
}

function primeEdges(pairs: [string, string][]): StrataPrimeEdge[] {
  return pairs.map(([source, target]) => ({
    edge: {
      key: `${source.length}:${source}→${target.length}:${target}:tfd`,
      source,
      target,
      relKind: "tfd",
      multiplicity: 1,
    },
    reversed: false,
  })) as unknown as StrataPrimeEdge[];
}

const score = (
  crossings: number,
  penetrations: number,
  lengthL1: number,
): StrataPackedScore => ({ crossings, penetrations, lengthL1 });

// ── S1-1: the inherited cap must be RESOLVED, not the raw fraction ───────────

describe("S1-1 — resolveInheritedEdgeCrossCap (blank inherits the RESOLVED δ)", () => {
  it("fractional ε resolves to the integer band, NOT the raw fraction", () => {
    // Pre-fix expression: `strataEdgeCrossCap ?? packedScoringEpsilon ?? 0`
    // ⇒ 0.5 (a fractional absolute cap ≈ 0 against integer crossings).
    // Post-fix: ceil(0.5 × baselineCrossings 4) = 2 — the SAME band the descent
    // uses (`resolveStrataPackedEpsilonDelta`).
    expect(resolveInheritedEdgeCrossCap(undefined, 0.5, 4)).toBe(2);
    expect(resolveInheritedEdgeCrossCap(undefined, 0.5, 4)).toBe(
      resolveStrataPackedEpsilonDelta(0.5, 4),
    );
    // The raw-fraction bug would have yielded 0.5, never a whole crossing.
    expect(resolveInheritedEdgeCrossCap(undefined, 0.5, 4)).not.toBe(0.5);
  });

  it("integer ε is byte-identical to the old raw inherit (resolve(ε)===ε)", () => {
    expect(resolveInheritedEdgeCrossCap(undefined, 1, 10)).toBe(1);
    expect(resolveInheritedEdgeCrossCap(undefined, 2, 10)).toBe(2);
    expect(resolveInheritedEdgeCrossCap(undefined, 0, 10)).toBe(0);
  });

  it("an explicit cap (including a deliberate 0) wins over the inherit", () => {
    expect(resolveInheritedEdgeCrossCap(3, 0.5, 4)).toBe(3);
    expect(resolveInheritedEdgeCrossCap(0, 0.5, 4)).toBe(0);
  });
});

describe("S1-1 — the raw cap VETOES a band trade the resolved cap ADMITS", () => {
  it("relocate guardrail (1): fractional-ε raw cap rejects +1 crossing; resolved admits", () => {
    // A length-halving candidate that costs exactly one crossing — the classic
    // ε-band trade (worse on weightedCross, strictly shorter).
    const baseline = score(4, 0, 1000);
    const incumbent = score(4, 0, 1000);
    const candidate = score(5, 0, 500);
    const weights = { penW: 1, crossW: 1, epsilon: 0.5 };

    // PRE-FIX inheritance (raw ε): cap 0.5. Guardrail (1) `5 > 4 + 0.5` vetoes
    // the candidate before the ε-band clause is ever reached.
    const rawCap = 0.5;
    expect(
      strataRelocateAdoptable(candidate, baseline, incumbent, {
        ...weights,
        edgeCrossCap: rawCap,
      }),
    ).toBe(false);

    // POST-FIX inheritance (resolved δ = ceil(0.5 × 4) = 2): guardrail (1)
    // `5 > 4 + 2` is false, so the ε-band admits the strictly-shorter trade.
    const resolvedCap = resolveInheritedEdgeCrossCap(undefined, 0.5, 4);
    expect(resolvedCap).toBe(2);
    expect(
      strataRelocateAdoptable(candidate, baseline, incumbent, {
        ...weights,
        edgeCrossCap: resolvedCap,
      }),
    ).toBe(true);
  });
});

// ── O4-3: the post-A7 guard must use the descent's comparator ────────────────

describe("O4-3 — the guard ranks the two arms under the ACTIVE (transitive) order", () => {
  // Model: four root leaves (a,b,c,d) + a foreign hull h1 (leaf `inside`).
  const h1 = leafHull("h1", "vpc", ["inside"]);
  const root = leafHull("root", "root", ["a", "b", "c", "d"], [h1]);
  const model = syntheticModel(root);
  const edges = primeEdges([
    ["a", "b"],
    ["c", "d"],
  ]);

  // Scored arm: a→b and c→d cross (1 crossing); h1 parked far away (0 pen).
  const scoredFinal = syntheticPlacement(
    {
      a: box(0, 0),
      b: box(200, 200),
      c: box(0, 200),
      d: box(200, 0),
      inside: box(510, 510),
    },
    { h1: box(500, 500, 60, 100) },
  );
  // Legacy arm: a→b and c→d parallel (0 crossings) but a→b pierces h1 (1 pen).
  const legacyFinal = syntheticPlacement(
    {
      a: box(0, 45),
      b: box(200, 45),
      c: box(0, 145),
      d: box(200, 145),
      inside: box(100, 40),
    },
    { h1: box(80, 0, 60, 100) },
  );

  it("the fixture realises the crossing↔penetration divergence", () => {
    const s = scoreStrataPlacementGeometry(scoredFinal, model, edges);
    const l = scoreStrataPlacementGeometry(legacyFinal, model, edges);
    expect([s.crossings, s.penetrations]).toEqual([1, 0]);
    expect([l.crossings, l.penetrations]).toEqual([0, 1]);
  });

  it("default (crossings-first) guard FALLS BACK to legacy — the incoherence", () => {
    // No transitive/relocate arg ⇒ the crossings-first default: legacy (0
    // crossings) beats scored (1 crossing), so a weightedC-better scored arm is
    // discarded. This is exactly the base behaviour the fix corrects.
    const chosen = chooseStrataRefinedPlacement(
      scoredFinal,
      legacyFinal,
      model,
      edges,
    );
    expect(chosen.fellBack).toBe(true);
  });

  it("transitive guard KEEPS scored — coherent with a transitive descent (penW=3)", () => {
    // Under the transitive key with penW 3 / crossW 1: weightedC(scored)=1 <
    // weightedC(legacy)=3, so scored is no-worse and within the crossing cap ⇒
    // KEEP scored. Base ignores the 7th arg and answers `fellBack=true`
    // (behavioural-RED); the fix answers `false`.
    const chosen = chooseStrataRefinedPlacement(
      scoredFinal,
      legacyFinal,
      model,
      edges,
      0,
      undefined,
      { penW: 3, crossW: 1, cap: 2 },
    );
    expect(chosen.fellBack).toBe(false);
    expect(chosen.placement).toBe(scoredFinal);
  });

  it("transitive guard still HONOURS the raw-crossing feasibility cap", () => {
    // cap 0 ⇒ scored (1 crossing) exceeds legacy+0 ⇒ infeasible ⇒ fall back,
    // even though its weightedC is better. The cap is a hard constraint, the
    // key only orders within it.
    const chosen = chooseStrataRefinedPlacement(
      scoredFinal,
      legacyFinal,
      model,
      edges,
      0,
      undefined,
      { penW: 3, crossW: 1, cap: 0 },
    );
    expect(chosen.fellBack).toBe(true);
  });
});
