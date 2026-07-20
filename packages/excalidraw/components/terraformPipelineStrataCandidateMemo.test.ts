/**
 * O1 per-descent candidate-sequence memo (import-speed, pure cost removal).
 *
 * These tests pin the memo added to `placeStrataHulls` /
 * `placeStrataHullsPackedScored`:
 *  - the memo is a HIT when a hull's child-unit extents are unchanged across
 *    trials (candidate generation runs once), and a MISS when the extents differ
 *    (regeneration), keyed on `hull.id` + per-unit `(unitId, x0, x1, height)`;
 *  - the descent's `onPackedTrial` event stream is byte-identical whether or not
 *    the recompute-and-assert debug tripwire is armed — proving the memo is
 *    trajectory-transparent — and arming the tripwire on a REAL descent's cache
 *    hits recomputes every hit and asserts equality (no stale hit throws);
 *  - the adversarial b09 obligation: mutating a keyed input (a child leaf's
 *    height / a column x) forces a cache MISS (the key is load-bearing), while a
 *    non-keyed change (this hull's own selection index) is a HIT.
 *
 * Run: yarn vitest run \
 *   packages/excalidraw/components/terraformPipelineStrataCandidateMemo.test.ts
 */
import { describe, expect, it, vi } from "vitest";

import { buildStrataModel } from "./terraformPipelineStrataModel";
import * as ordering from "./terraformPipelineStrataOrdering";
import {
  __setStrataCandidateMemoDebug,
  placeStrataHulls,
  type StrataCandidateCache,
} from "./terraformPipelineStrataPlacement";
import {
  placeStrataHullsPackedScored,
  type StrataPackedTrialRecord,
} from "./terraformPipelineStrataPackedScoring";

import type {
  PipelineCluster,
  PipelineLayoutPrep,
  PipelinePlacement,
  CollapsedPipelineEdge,
} from "./terraformPipelineLayoutShared";
import type {
  StrataEngineOptions,
  StrataHullNode,
  StrataPrimeEdge,
  StrataRankResult,
} from "./terraformPipelineStrataTypes";

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

const REGION = placement("aws", "acct", "us-west-2");
const IN_VPCA = placement("aws", "acct", "us-west-2", "vpcA");
const IN_VPCB = placement("aws", "acct", "us-west-2", "vpcB");

/** The round-9 blind-spot fixture: a packed region hull over loose leaves + two
 * vpc hulls, with enough units that A2 emits multiple packed candidates. */
function blindSpotFixture(a1Height = 100) {
  const clusters = [
    frameCluster("src", REGION, "a.a_src", 200, 100),
    frameCluster("sqs", REGION, "a.q_sqs", 200, 100),
    frameCluster("a1", IN_VPCA, "m.a1", 200, a1Height),
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

function findHull(
  root: StrataHullNode,
  pred: (h: StrataHullNode) => boolean,
): StrataHullNode | undefined {
  if (pred(root)) {
    return root;
  }
  for (const child of root.children) {
    const hit = findHull(child, pred);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

describe("O1 candidate-sequence memo — hit/miss on child extents", () => {
  it("identical child extents reuse the cached list; differing extents miss", () => {
    const { model, rank, edges } = blindSpotFixture();
    const region = findHull(model.hullRoot, (h) => h.role === "region")!;
    expect(region.policy).toBe("packed");
    const regionId = region.id;

    const cache: StrataCandidateCache = new Map();
    const genSpy = vi.spyOn(ordering, "strataPackedCandidateSequences");

    // Trial A: region selects candidate 0 with a fresh shared cache — the region
    // hull's candidate list is generated once and cached.
    genSpy.mockClear();
    placeStrataHulls(
      model,
      edges,
      rank,
      OPTS_K4,
      new Map([[regionId, 0]]),
      undefined,
      cache,
    );
    const genA = genSpy.mock.calls.length;
    expect(genA).toBeGreaterThanOrEqual(1); // region generated
    expect(cache.size).toBe(1);

    // Trial B: same model + SAME cache, region selects candidate 1. Changing a
    // hull's OWN selection index does NOT change its `infos` extents (those come
    // from its already-laid-out children), so the key is identical ⇒ a full cache
    // HIT ⇒ zero regeneration.
    genSpy.mockClear();
    placeStrataHulls(
      model,
      edges,
      rank,
      OPTS_K4,
      new Map([[regionId, 1]]),
      undefined,
      cache,
    );
    expect(genSpy.mock.calls.length).toBe(0); // fully served from cache
    expect(cache.size).toBe(1); // no new entry — reused

    // Trial C: a model whose vpcA leaf `a1` is taller ⇒ vpcA's box height differs
    // ⇒ the region hull's `infos` extents differ ⇒ a DIFFERENT key on the SAME
    // shared cache ⇒ a MISS ⇒ regeneration (new cache entry). This is the
    // adversarial b09 obligation: a keyed input (a child extent) is load-bearing.
    const tall = blindSpotFixture(300);
    const tallRegion = findHull(
      tall.model.hullRoot,
      (h) => h.role === "region",
    )!;
    expect(tallRegion.id).toBe(regionId); // same hull id, different geometry
    genSpy.mockClear();
    placeStrataHulls(
      tall.model,
      tall.edges,
      tall.rank,
      OPTS_K4,
      new Map([[regionId, 0]]),
      undefined,
      cache,
    );
    expect(genSpy.mock.calls.length).toBeGreaterThanOrEqual(1); // miss ⇒ regen
    expect(cache.size).toBe(2); // new entry for the differing extents

    genSpy.mockRestore();
  });

  it("a non-keyed change (rank column x) also forces a MISS via changed extents", () => {
    const { model, rank, edges } = blindSpotFixture();
    const region = findHull(model.hullRoot, (h) => h.role === "region")!;
    const regionId = region.id;
    const cache: StrataCandidateCache = new Map();

    placeStrataHulls(
      model,
      edges,
      rank,
      OPTS_K4,
      new Map([[regionId, 0]]),
      undefined,
      cache,
    );
    expect(cache.size).toBe(1);

    // Shift the whole column grid — leaf x0/x1 (hence hull box x-extents) move ⇒
    // the region key changes ⇒ MISS on the shared cache.
    const shifted: StrataRankResult = {
      ...rank,
      columnX: rank.columnX.map((x) => x + 111),
    };
    placeStrataHulls(
      model,
      edges,
      shifted,
      OPTS_K4,
      new Map([[regionId, 0]]),
      undefined,
      cache,
    );
    expect(cache.size).toBe(2);
  });
});

describe("O1 candidate-sequence memo — descent transparency", () => {
  const captureStream = (): {
    stream: StrataPackedTrialRecord[];
    trialCount: number;
    selectionsSize: number;
  } => {
    const { model, rank, edges } = blindSpotFixture();
    const stream: StrataPackedTrialRecord[] = [];
    const res = placeStrataHullsPackedScored(model, edges, rank, OPTS_K4, (r) =>
      stream.push(r),
    );
    return {
      stream,
      trialCount: res.trialCount,
      selectionsSize: res.selections.size,
    };
  };

  it("the onPackedTrial stream is identical with and without the debug tripwire", () => {
    // Baseline stream (tripwire off — the production default).
    const off = captureStream();
    expect(off.trialCount).toBeGreaterThan(1); // a real multi-trial descent ran

    // Arm the recompute-and-assert tripwire and re-run: every cache HIT during
    // the descent now recomputes the candidate list from scratch and asserts
    // byte-equality with the cached value. A stale hit would throw here; a clean
    // pass proves the memo returned exactly what a cache-free path would.
    const prev = __setStrataCandidateMemoDebug(true);
    let on: ReturnType<typeof captureStream>;
    try {
      on = captureStream();
    } finally {
      __setStrataCandidateMemoDebug(prev);
    }

    // Trajectory identity: the debug tripwire (and therefore the memo) does not
    // perturb the descent — same trial count, same adopted selection size, same
    // per-trial event stream byte-for-byte.
    expect(on.trialCount).toBe(off.trialCount);
    expect(on.selectionsSize).toBe(off.selectionsSize);
    expect(on.stream).toEqual(off.stream);
  });
});
