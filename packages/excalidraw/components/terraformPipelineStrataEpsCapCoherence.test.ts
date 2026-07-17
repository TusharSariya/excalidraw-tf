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

import { buildStrataModel } from "./terraformPipelineStrataModel";
import {
  chooseStrataRefinedPlacement,
  placeStrataHullsPackedScored,
  resolveInheritedEdgeCrossCap,
  resolveStrataPackedEpsilonDelta,
  scoreStrataPlacementGeometry,
  strataRelocateAdoptable,
  type StrataPackedScore,
} from "./terraformPipelineStrataPackedScoring";
import { placeStrataHulls } from "./terraformPipelineStrataPlacement";
import { transposeStrataColumns } from "./terraformPipelineStrataTranspose";
import { refineStrataVerticalSlots } from "./terraformPipelineStrataVerticalRelocate";

import type {
  CollapsedPipelineEdge,
  PipelineCluster,
  PipelineLayoutPrep,
  PipelinePlacement,
} from "./terraformPipelineLayoutShared";
import type {
  StrataBox,
  StrataEngineOptions,
  StrataHullNode,
  StrataModel,
  StrataPlacementResult,
  StrataPrimeEdge,
  StrataRankResult,
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

describe("S1-1 — the lowered-ε signature: ε=1 REJECTS a +2 trade that ε=0.5 ADMITS", () => {
  // The classic ε-band trade priced to +2 crossings (strictly shorter, worse on
  // weightedCross), baseline/incumbent crossings 4. This +2 fixture is the
  // discriminator the old +1 fixture lacked: a +1 candidate is admitted at ε=1
  // too (cap resolve(1,4)=1 ⇒ `5 > 4+1` is false), so it could not show why
  // LOWERING ε from 1 to 0.5 helps — only a +2 candidate separates the two.
  const baseline = score(4, 0, 1000);
  const incumbent = score(4, 0, 1000);
  const candidate = score(6, 0, 500); // +2 crossings, half the length.

  it("ε=1 (inherited cap 1) REJECTS the +2 candidate — out of the integer budget", () => {
    const capAtEps1 = resolveInheritedEdgeCrossCap(undefined, 1, 4);
    expect(capAtEps1).toBe(1);
    // Guardrail (1) `6 > 4 + 1` vetoes before the ε-band is ever reached.
    expect(
      strataRelocateAdoptable(candidate, baseline, incumbent, {
        penW: 1,
        crossW: 1,
        epsilon: 1,
        edgeCrossCap: capAtEps1,
      }),
    ).toBe(false);
  });

  it("ε=0.5 (inherited cap 2 = ceil(0.5×4)) ADMITS the +2 trade — LOWERING ε relaxes the relative budget", () => {
    const capAtEpsHalf = resolveInheritedEdgeCrossCap(undefined, 0.5, 4);
    expect(capAtEpsHalf).toBe(2);
    expect(capAtEpsHalf).toBe(resolveStrataPackedEpsilonDelta(0.5, 4));
    // Guardrail (1) `6 > 4 + 2` is false; the ε-band (weightedCross 6 <=
    // baseline 4 + resolve(0.5,4)=2, strictly shorter) then ADMITS.
    expect(
      strataRelocateAdoptable(candidate, baseline, incumbent, {
        penW: 1,
        crossW: 1,
        epsilon: 0.5,
        edgeCrossCap: capAtEpsHalf,
      }),
    ).toBe(true);
  });

  it("the PRE-FIX raw inherit (cap 0.5) would have vetoed the SAME ε=0.5 trade", () => {
    // `?? packedScoringEpsilon ?? 0` fed the raw fraction 0.5 as the absolute
    // cap; guardrail (1) `6 > 4 + 0.5` vetoes the +2 trade the resolved cap (2)
    // admits — the exact fractional-ε bug S1-1 fixes. (The internal ε-band delta
    // is resolved correctly either way; the CAP is the sole broken gate.)
    expect(
      strataRelocateAdoptable(candidate, baseline, incumbent, {
        penW: 1,
        crossW: 1,
        epsilon: 0.5,
        edgeCrossCap: 0.5, // raw-inherit bug value
      }),
    ).toBe(false);
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

// ── production wiring — the REAL post-passes / descent, not injected helpers ──
// The injected proofs above pin the helper/comparator SEMANTICS. These drive the
// real `transposeStrataColumns` / `refineStrataVerticalSlots` post-passes and the
// real `placeStrataHullsPackedScored` descent end-to-end, so they go RED if the
// affected post-passes stop routing the blank cap through the resolver (S1-1) or
// if the descent's baseline stops feeding the guard's cap (O4-3) — the failure
// modes the injected tests could not see.

const REAL_OPTS: StrataEngineOptions = {
  compact: true,
  includeAncillary: false,
  networkSimplexRank: false,
  sweeps: 0,
  coordinateRefine: false,
};

const REAL_COL_GAP = 600;

function realPlacementCtx(
  providerFamily: string,
  accountId: string,
  region: string,
  vpcId: string | null = null,
  subnetSignature?: string,
): PipelinePlacement {
  return { providerFamily, accountId, region, vpcId, subnetSignature };
}

function frameCluster(
  id: string,
  p: PipelinePlacement,
  primaryAddress: string,
  frameW: number,
  frameH: number,
): PipelineCluster {
  const frameId = `${id}:frame`;
  const build = {
    skeleton: [
      { type: "frame", id: frameId, x: 0, y: 0, width: frameW, height: frameH },
    ],
    width: frameW,
    height: frameH,
    clusterFrameId: frameId,
  } as unknown as PipelineCluster["build"];
  return {
    id,
    primaryAddress,
    firstSequence: 0,
    depth: 0,
    placement: p,
    build,
  };
}

function realEdge(source: string, target: string): CollapsedPipelineEdge {
  return {
    source,
    target,
    sequence: 0,
    original: { source, target, sequence: 0, origin: "tfd" },
  };
}

function realPrep(
  clusters: PipelineCluster[],
  collapsedEdges: CollapsedPipelineEdge[] = [],
): PipelineLayoutPrep {
  return {
    clusters,
    collapsedEdges,
    maxDepth: 0,
    columnX: [],
    depthResult: { depths: new Map(), hasCycle: false },
    networkSimplexApplied: false,
    satelliteOwners: new Map(),
    placementByAddress: new Map(),
  } as unknown as PipelineLayoutPrep;
}

function rankStub(ranks: Record<string, number>): StrataRankResult {
  const maxRank = Math.max(0, ...Object.values(ranks));
  const columnX = Array.from(
    { length: maxRank + 1 },
    (_, i) => 50 + i * REAL_COL_GAP,
  );
  return {
    rank: new Map(Object.entries(ranks)),
    columnX,
    networkSimplexApplied: false,
  } as unknown as StrataRankResult;
}

/**
 * The transpose driving fixture (identical wiring to
 * terraformPipelineStrataTranspose.test): two same-rank sources stacked in
 * column 0 and two same-rank params in column 1, wired s1→p2 / s2→p1 so the
 * initial stacked order crosses. The transpose untangles it.
 */
function invertedColumnFixture() {
  const p = realPlacementCtx("aws", "1", "us-east-1", "vpc-1", "subA");
  const clusters = [
    frameCluster("s1", p, "aws.s1", 200, 60),
    frameCluster("s2", p, "aws.s2", 200, 60),
    frameCluster("p1", p, "aws.p1", 200, 60),
    frameCluster("p2", p, "aws.p2", 200, 60),
  ];
  const model = buildStrataModel(
    realPrep(clusters, [realEdge("s1", "p2"), realEdge("s2", "p1")]),
    REAL_OPTS,
  );
  const primes = primeEdges([
    ["s1", "p2"],
    ["s2", "p1"],
  ]);
  const rank = rankStub({ s1: 0, s2: 0, p1: 1, p2: 1 });
  const a0 = placeStrataHulls(model, primes, rank, REAL_OPTS);
  return { model, primes, rank, a0 };
}

describe("S1-1 production wiring — the real post-passes run at fractional ε", () => {
  it("transpose flag-off is byte-identical at fractional ε (blank cap)", () => {
    const { model, primes, rank, a0 } = invertedColumnFixture();
    // Flag off ⇒ referential identity, regardless of ε — the resolver is only
    // reached on the flag-on path.
    expect(
      transposeStrataColumns(a0, model, primes, rank, {
        ...REAL_OPTS,
        packedScoringEpsilon: 0.5,
      }),
    ).toBe(a0);
  });

  it("transpose flag-on adopts the untangle at fractional ε — the S1-1 reorder is intact", () => {
    // The fix moved `edgeCrossCap` resolution to AFTER `baselineScore` (a blank
    // cap needs the baseline crossings). A revert that reads `baselineScore`
    // before it exists is a TDZ throw; a run that reaches here proves the
    // reorder holds. The untangle (crossings 1→0) is inside the resolved cap
    // (ceil(0.5×1)=1) so it is still adopted — the pass is not neutered.
    const { model, primes, rank, a0 } = invertedColumnFixture();
    const before = scoreStrataPlacementGeometry(a0, model, primes);
    expect(before.crossings).toBeGreaterThan(0);
    const out = transposeStrataColumns(a0, model, primes, rank, {
      ...REAL_OPTS,
      strataTranspose: true,
      packedScoringEpsilon: 0.5,
    });
    expect(out).not.toBe(a0);
    const after = scoreStrataPlacementGeometry(out, model, primes);
    expect(after.crossings).toBeLessThan(before.crossings);
  });

  it("vertical-relocate flag-off is byte-identical at fractional ε (blank cap)", () => {
    const { model, primes, rank, a0 } = invertedColumnFixture();
    expect(
      refineStrataVerticalSlots(a0, model, primes, rank, {
        ...REAL_OPTS,
        packedScoringEpsilon: 0.5,
      }),
    ).toBe(a0);
  });
});

describe("O4-3 production wiring — the guard cap comes from the REAL descent baseline", () => {
  it("blank cap: the builder-formula guard cap equals the descent's own effectiveDelta", () => {
    // Drive the REAL descent with transitiveAdopt on and a fractional ε. The
    // builder computes the post-A7 guard's transitive cap as
    // resolveInheritedEdgeCrossCap(strataEdgeCrossCap, ε,
    // packedScored.baselineScore.crossings). With no explicit cap that MUST
    // coincide with the descent's own transitive feasibility budget — which the
    // descent resolves through the SAME helper and reports as effectiveDelta. If
    // the guard were fed a different baseline (or a raw ε), these would diverge.
    const { model, primes, rank } = invertedColumnFixture();
    const scored = placeStrataHullsPackedScored(model, primes, rank, {
      ...REAL_OPTS,
      sweeps: 2,
      packedScoring: true,
      transitiveAdopt: true,
      packedScoringEpsilon: 0.5,
    });
    const guardCap = resolveInheritedEdgeCrossCap(
      undefined,
      0.5,
      scored.baselineScore.crossings,
    );
    expect(guardCap).toBe(scored.effectiveDelta);
    expect(guardCap).toBe(
      resolveStrataPackedEpsilonDelta(0.5, scored.baselineScore.crossings),
    );
  });

  it("explicit cap: the guard uses the explicit integer over the real baseline", () => {
    const { model, primes, rank } = invertedColumnFixture();
    const scored = placeStrataHullsPackedScored(model, primes, rank, {
      ...REAL_OPTS,
      sweeps: 2,
      packedScoring: true,
      transitiveAdopt: true,
      packedScoringEpsilon: 0.5,
      strataEdgeCrossCap: 3,
    });
    expect(
      resolveInheritedEdgeCrossCap(3, 0.5, scored.baselineScore.crossings),
    ).toBe(3);
  });
});
