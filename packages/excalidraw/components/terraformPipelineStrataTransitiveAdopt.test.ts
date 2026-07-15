/**
 * P0.2 — ε adoption-gate non-transitivity: characterization + fix tests.
 *
 * Part 1 (BUG, PROVEN at unit level): the packed-scoring adoption GATE
 * (`strataPackedScoreAdoptable`) and the OD-15 relocate gate
 * (`strataRelocateAdoptable`) are NOT comparators — with epsilon > 0 they
 * authorize BOTH A→B and B→A (a 2-cycle / non-antisymmetric relation),
 * exactly the oscillation the scoring module header warns about.
 *
 * Part 2 (FIX): the opt-in `transitiveAdopt` relation
 * (`strataTransitiveLess` over the integer key
 * (weightedC, lengthL1, crossings, penetrations) + `strataTransitiveEligible`
 * crossing-budget feasibility) is a strict total order — irreflexive,
 * antisymmetric, transitive, and total on distinct scores — verified by
 * EXHAUSTIVE enumeration (no sampled/random cases), including fractional
 * weights (the Math.round hazard).
 *
 * Part 3 (ENGINE): on the round-9 blind-spot fixture,
 *  - flag OFF (absent vs explicit false) is placement-identical (byte-identity);
 *  - flag ON adoption is strictly monotone under the transitive key
 *    (every adopted trial strictly precedes the previous adopted one);
 *  - flag ON + packedConverge: convergeRecovered === false (best-seen ≡ final —
 *    the fix makes converge redundant by construction).
 *
 * Run: npx vitest run --config vitest.probe.config.mts \
 *   packages/excalidraw/components/terraformPipelineStrataTransitiveAdopt.test.ts
 */
import { describe, expect, it } from "vitest";

import { buildStrataModel } from "./terraformPipelineStrataModel";
import {
  placeStrataHullsPackedScored,
  strataPackedScoreAdoptable,
  strataRelocateAdoptable,
  strataTransitiveEligible,
  strataTransitiveKeyOf,
  strataTransitiveLess,
  type StrataPackedScore,
  type StrataPackedTrialRecord,
} from "./terraformPipelineStrataPackedScoring";

import type {
  CollapsedPipelineEdge,
  PipelineCluster,
  PipelineLayoutPrep,
  PipelinePlacement,
} from "./terraformPipelineLayoutShared";
import type {
  StrataEngineOptions,
  StrataPlacementResult,
  StrataPrimeEdge,
  StrataRankResult,
} from "./terraformPipelineStrataTypes";

const score = (
  crossings: number,
  penetrations: number,
  lengthL1: number,
): StrataPackedScore => ({ crossings, penetrations, lengthL1 });

// ── Part 1: the gate is non-antisymmetric (the bug, unit-PROVEN) ─────────────

describe("P0.2 bug — the ε adoption gate authorizes 2-cycles", () => {
  it("packed gate: A adoptable over B AND B adoptable over A (delta=1)", () => {
    // The scoring module header's own counterexample, asserted for real:
    // baseline crossings 10, delta 1.
    const A = score(11, 9, 10);
    const B = score(10, 100, 100);
    // A→ over incumbent B: ε-band (11 <= 10+1, (9,10) < (100,100)).
    expect(strataPackedScoreAdoptable(A, B, 10, 1)).toBe("epsilon");
    // B→ over incumbent A: strict (10 < 11).
    expect(strataPackedScoreAdoptable(B, A, 10, 1)).toBe("strict");
    // A 2-cycle: the relation is not antisymmetric, hence not an order at
    // all — the bounded 2-pass descent can hold-then-drop either endpoint.
  });

  it("packed gate: delta=0 collapses to the strict rule (no cycle)", () => {
    const A = score(11, 9, 10);
    const B = score(10, 100, 100);
    expect(strataPackedScoreAdoptable(A, B, 10, 0)).toBe(false);
    expect(strataPackedScoreAdoptable(B, A, 10, 0)).toBe("strict");
  });

  it("relocate gate: same 2-cycle on the weighted objective", () => {
    const cfg = { penW: 1, crossW: 1, epsilon: 1, edgeCrossCap: 1 };
    const baseline = score(10, 0, 100); // weightedC 10
    const A = score(11, 0, 90); // weightedC 11 (<= 10+1), shorter
    const B = score(10, 0, 100); // weightedC 10
    // A over incumbent B: within raw cap (11 <= 11) + ε-band buys length.
    expect(strataRelocateAdoptable(A, baseline, B, cfg)).toBe(true);
    // B over incumbent A: strict weightedC win (10 < 11).
    expect(strataRelocateAdoptable(B, baseline, A, cfg)).toBe(true);
  });
});

// ── Part 2: the transitive relation is a strict total order (the fix) ────────

describe("P0.2 fix — strataTransitiveLess is a strict total order", () => {
  // Exhaustive integer grid: 3×3×3 = 27 scores; pairs 27² = 729; triples
  // 27³ = 19,683 per weight set. Deterministic — no sampling.
  const GRID: StrataPackedScore[] = [];
  for (let c = 0; c <= 2; c++) {
    for (let p = 0; p <= 2; p++) {
      for (let l = 0; l <= 2; l++) {
        GRID.push(score(c, p, l));
      }
    }
  }
  // Include a fractional weight (owner may set 1.5) — the Math.round in
  // weightedC can collapse distinct (pen, cross) mixes into one composite;
  // the (crossings, penetrations) tiebreak terms must keep the key injective.
  const WEIGHTS = [
    { penW: 1, crossW: 1 },
    { penW: 1.5, crossW: 1 },
    { penW: 2, crossW: 3 },
  ];

  it("irreflexive + antisymmetric + total on distinct scores (exhaustive)", () => {
    for (const w of WEIGHTS) {
      for (const a of GRID) {
        expect(strataTransitiveLess(a, a, w)).toBe(false);
        for (const b of GRID) {
          const ab = strataTransitiveLess(a, b, w);
          const ba = strataTransitiveLess(b, a, w);
          // Antisymmetry: never both.
          expect(ab && ba).toBe(false);
          // Totality: distinct scores always compare (key is injective —
          // crossings/pen/L1 are all IN the key, so equal keys ⇒ equal scores).
          const same =
            a.crossings === b.crossings &&
            a.penetrations === b.penetrations &&
            a.lengthL1 === b.lengthL1;
          if (!same) {
            expect(ab || ba).toBe(true);
          } else {
            expect(ab || ba).toBe(false);
          }
        }
      }
    }
  });

  it("transitive (exhaustive over all triples)", () => {
    for (const w of WEIGHTS) {
      for (const a of GRID) {
        for (const b of GRID) {
          if (!strataTransitiveLess(a, b, w)) {
            continue;
          }
          for (const c of GRID) {
            if (strataTransitiveLess(b, c, w)) {
              expect(strataTransitiveLess(a, c, w)).toBe(true);
            }
          }
        }
      }
    }
  });

  it("every key component is an integer (no float tie hazard)", () => {
    for (const w of WEIGHTS) {
      for (const s of GRID) {
        for (const k of strataTransitiveKeyOf(s, w.penW, w.crossW)) {
          expect(Number.isInteger(k)).toBe(true);
        }
      }
    }
  });

  it("the fixed relation refuses the bug's 2-cycle pair", () => {
    const A = score(11, 9, 10); // key (20, 10, 11, 9) at 1/1
    const B = score(10, 100, 100); // key (110, 100, 10, 100)
    const w = { penW: 1, crossW: 1 };
    expect(strataTransitiveLess(A, B, w)).toBe(true);
    expect(strataTransitiveLess(B, A, w)).toBe(false);
  });

  it("eligibility: crossing budget boundary + negative-cap clamp", () => {
    expect(strataTransitiveEligible(score(11, 0, 0), 10, 1)).toBe(true);
    expect(strataTransitiveEligible(score(12, 0, 0), 10, 1)).toBe(false);
    expect(strataTransitiveEligible(score(10, 0, 0), 10, 0)).toBe(true);
    expect(strataTransitiveEligible(score(10, 0, 0), 10, -5)).toBe(true);
    expect(strataTransitiveEligible(score(11, 0, 0), 10, -5)).toBe(false);
  });
});

// ── Part 3: engine wiring on the round-9 blind-spot fixture ──────────────────

const OPTS_K4: StrataEngineOptions = {
  compact: true,
  includeAncillary: false,
  networkSimplexRank: false,
  sweeps: 4,
  coordinateRefine: false,
};

const COL_GAP = 600;

function placement(
  providerFamily: string,
  accountId: string,
  region: string,
  vpcId: string | null = null,
): PipelinePlacement {
  return { providerFamily, accountId, region, vpcId };
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

function prep(
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
  };
}

function rankStub(ranks: Record<string, number>): StrataRankResult {
  const maxRank = Math.max(0, ...Object.values(ranks));
  const columnX = Array.from(
    { length: maxRank + 1 },
    (_, i) => 50 + i * COL_GAP,
  );
  return {
    rank: new Map(Object.entries(ranks)),
    columnX,
    networkSimplexApplied: false,
  };
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
  }));
}

function placementFingerprint(p: StrataPlacementResult): string {
  const leaves = [...p.leafBoxes.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const hulls = [...p.boxedHulls.entries()]
    .map(([id, bh]) => [id, bh.box] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify({ leaves, hulls });
}

const REGION = placement("aws", "acct", "us-west-2");
const IN_VPCA = placement("aws", "acct", "us-west-2", "vpcA");
const IN_VPCB = placement("aws", "acct", "us-west-2", "vpcB");

function blindSpotFixture() {
  const clusters = [
    frameCluster("src", REGION, "a.a_src", 200, 100),
    frameCluster("sqs", REGION, "a.q_sqs", 200, 100),
    frameCluster("a1", IN_VPCA, "m.a1", 200, 100),
    frameCluster("a2", IN_VPCA, "m.a2", 200, 100),
    frameCluster("rds", IN_VPCB, "z.rds", 200, 100),
  ];
  const model = buildStrataModel(prep(clusters), OPTS_K4);
  const rank = rankStub({ src: 0, sqs: 1, a1: 0, a2: 2, rds: 1 });
  const edges = primeEdges([
    ["sqs", "rds"],
    ["a1", "a2"],
    ["src", "a1"],
  ]);
  return { model, rank, edges };
}

describe("P0.2 engine wiring — transitiveAdopt on the blind-spot fixture", () => {
  it("flag-off byte-identity: absent === explicit false (with ε=1)", () => {
    const { model, rank, edges } = blindSpotFixture();
    const opts = { ...OPTS_K4, packedScoring: true, packedScoringEpsilon: 1 };
    const absent = placeStrataHullsPackedScored(model, edges, rank, opts);
    const explicit = placeStrataHullsPackedScored(model, edges, rank, {
      ...opts,
      transitiveAdopt: false,
    });
    expect(placementFingerprint(explicit.placement)).toEqual(
      placementFingerprint(absent.placement),
    );
    expect(explicit.score).toEqual(absent.score);
    expect([...explicit.selections.entries()]).toEqual([
      ...absent.selections.entries(),
    ]);
  });

  it("flag-on adoption is strictly monotone under the transitive key", () => {
    const { model, rank, edges } = blindSpotFixture();
    const trials: StrataPackedTrialRecord[] = [];
    const result = placeStrataHullsPackedScored(
      model,
      edges,
      rank,
      {
        ...OPTS_K4,
        packedScoring: true,
        packedScoringEpsilon: 1,
        transitiveAdopt: true,
      },
      (r) => trials.push(r),
    );
    const w = { penW: 1, crossW: 1 };
    const adopted = trials.filter(
      (t) => t.adopted && t.hullId !== "__baseline__",
    );
    // Every adoption strictly precedes the last adopted state (the incumbent
    // at adoption time IS the previous adopted score / the baseline).
    let incumbent = trials.find((t) => t.hullId === "__baseline__")!.score;
    for (const t of adopted) {
      expect(t.adoptedVia).toBe("transitive");
      expect(strataTransitiveLess(t.score, incumbent, w)).toBe(true);
      incumbent = t.score;
    }
    // The returned score is the last adopted (or baseline) — the relation
    // cannot wander, so rolling incumbent === best ever adopted.
    expect(result.score).toEqual(incumbent);
    // Feasibility: never exceeded the baseline crossing budget.
    for (const t of adopted) {
      expect(t.score.crossings).toBeLessThanOrEqual(
        result.baselineScore.crossings + result.effectiveDelta,
      );
    }
  });

  it("flag-on + packedConverge: converge is redundant (never recovers)", () => {
    const { model, rank, edges } = blindSpotFixture();
    const result = placeStrataHullsPackedScored(model, edges, rank, {
      ...OPTS_K4,
      packedScoring: true,
      packedScoringEpsilon: 1,
      transitiveAdopt: true,
      packedConverge: true,
    });
    expect(result.convergeRecovered).toBe(false);
  });

  it("flag-on determinism: two runs are placement-identical", () => {
    const { model, rank, edges } = blindSpotFixture();
    const opts = {
      ...OPTS_K4,
      packedScoring: true,
      packedScoringEpsilon: 1,
      transitiveAdopt: true,
    };
    const a = placeStrataHullsPackedScored(model, edges, rank, opts);
    const b = placeStrataHullsPackedScored(model, edges, rank, opts);
    expect(placementFingerprint(b.placement)).toEqual(
      placementFingerprint(a.placement),
    );
  });
});
