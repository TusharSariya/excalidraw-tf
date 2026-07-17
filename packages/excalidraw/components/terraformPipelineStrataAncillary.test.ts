/**
 * Unit tests for the Strata ancillary ("All resources") band injector
 * (terraformPipelineStrataAncillary.ts; plan §3a-§3n). Synthetic, fast, no preset.
 *
 * Fixture note — the X-OVERLAP TRAP. Every pre-existing strata placement fixture
 * uses `COL_GAP = 600 > any leaf width`, which makes all sibling hulls X-DISJOINT.
 * The growth propagation (§3e) only fires for X-OVERLAPPING lower siblings, so a
 * fixture inherited from that template would exercise the interesting path ZERO
 * times and pass vacuously. `twoVpcFixture` below therefore puts both VPCs' leaves
 * in the SAME column (rank 0) so the two vpc hulls genuinely X-overlap and the
 * region hull's dropY skyline stacks them — which is what makes
 * "band on vpc-a pushes vpc-b down" a real assertion.
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataAncillary.test.ts
 */
import { describe, expect, it } from "vitest";

import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";
import {
  checkStrataAncillaryContainment,
  injectStrataAncillaryBands,
} from "./terraformPipelineStrataAncillary";
import { buildStrataModel } from "./terraformPipelineStrataModel";
import {
  checkStrataStructure,
  placeStrataHulls,
} from "./terraformPipelineStrataPlacement";
import { strataDeBandFeasible } from "./terraformPipelineStrataTypes";
import { topologyRoleAndKeyFromPath } from "./terraformPipelineTopologyFrames";

import type { DeBandLevel } from "./terraformPipelineLayoutProfiles";
import type {
  AncillaryStrip,
  CollapsedPipelineEdge,
  PipelineCluster,
  PipelineLayoutPrep,
  PipelinePlacement,
} from "./terraformPipelineLayoutShared";
import type {
  StrataEngineOptions,
  StrataHullRole,
  StrataPlacementResult,
  StrataPrimeEdge,
  StrataRankResult,
} from "./terraformPipelineStrataTypes";

const OPTS: StrataEngineOptions = {
  compact: true,
  includeAncillary: true,
  networkSimplexRank: false,
  sweeps: 0,
  coordinateRefine: false,
};

const place = (
  providerFamily: string,
  accountId: string,
  region: string,
  vpcId: string | null = null,
): PipelinePlacement => ({ providerFamily, accountId, region, vpcId });

const keyOf = (path: string[]): string => topologyRoleAndKeyFromPath(path)!.key;

function frameCluster(
  id: string,
  p: PipelinePlacement,
  w: number,
  h: number,
): PipelineCluster {
  const frameId = `${id}:frame`;
  return {
    id,
    primaryAddress: id,
    firstSequence: 0,
    depth: 0,
    placement: p,
    build: {
      skeleton: [
        { type: "frame", id: frameId, x: 0, y: 0, width: w, height: h },
      ],
      width: w,
      height: h,
      clusterFrameId: frameId,
    } as unknown as PipelineCluster["build"],
  };
}

function prepOf(clusters: PipelineCluster[]): PipelineLayoutPrep {
  return {
    clusters,
    collapsedEdges: [] as CollapsedPipelineEdge[],
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
  // Deliberately NOT the 600px COL_GAP of the sibling fixtures — see header.
  const columnX = Array.from({ length: maxRank + 1 }, (_, i) => 50 + i * 600);
  return {
    rank: new Map(Object.entries(ranks)),
    columnX,
    networkSimplexApplied: false,
  };
}

const NO_EDGES: StrataPrimeEdge[] = [];

/** An ancillary card of a given size. */
function card(address: string, w = 200, h = 80) {
  const frameId = `${address}:card`;
  return {
    address,
    placement: place("aws", "1", "us-east-1", null),
    build: {
      skeleton: [
        { type: "frame", id: frameId, x: 0, y: 0, width: w, height: h },
      ],
      width: w,
      height: h,
      clusterFrameId: frameId,
    },
  } as unknown as AncillaryStrip["cards"][number];
}

/**
 * A strip whose `scopeKey` is `path.join("\0")` — exactly what the real
 * `providerScopeKey`/`accountScopeKey`/`regionScopeKey`/`vpcScopeKey` builders
 * produce, and the same encoding `topologyRoleAndKeyFromPath` uses.
 */
function strip(
  scopeRole: AncillaryStrip["scopeRole"],
  path: string[],
  cards: AncillaryStrip["cards"],
): AncillaryStrip {
  const scopeKey = path.join("\0");
  return {
    scopeRole,
    scopeKey,
    placement: place(
      path[0] ?? "aws",
      path[1] ?? "unknown-account",
      path[2] ?? "unknown-region",
      path[3] ?? null,
    ),
    stripFrameId: `tf-pipeline:ancillaryStrip:${encodeURIComponent(scopeKey)}`,
    cards,
  };
}

/**
 * Two VPCs under one region, both with a leaf in column 0 ⇒ the vpc hulls
 * X-OVERLAP and the packed region stacks them with dropY. See the header.
 */
function twoVpcFixture(deBandLevel: DeBandLevel = "none") {
  const clusters = [
    frameCluster("c-a", place("aws", "1", "us-east-1", "vpc-a"), 300, 100),
    frameCluster("c-b", place("aws", "1", "us-east-1", "vpc-b"), 300, 100),
  ];
  const model = buildStrataModel(prepOf(clusters), {
    ...OPTS,
    ...(deBandLevel !== "none" ? { strataDeBandLevel: deBandLevel } : {}),
  });
  const rank = rankStub({ "c-a": 0, "c-b": 0 });
  const placement = placeStrataHulls(model, NO_EDGES, rank, OPTS);
  return { model, placement, rank };
}

const PATHS = {
  provider: ["aws"],
  account: ["aws", "1"],
  region: ["aws", "1", "us-east-1"],
  vpcA: ["aws", "1", "us-east-1", "vpc-a"],
  vpcB: ["aws", "1", "us-east-1", "vpc-b"],
};

// ── 1. host walk (§3a) ────────────────────────────────────────────────────────

describe("host resolution — the longest existing prefix", () => {
  it("a vpc strip lands on its OWN vpc hull when that hull exists", () => {
    const { model, placement } = twoVpcFixture();
    const { bands } = injectStrataAncillaryBands({
      model,
      placement,
      strips: [strip("vpc", PATHS.vpcA, [card("s3.a")])],
    });
    expect([...bands.keys()]).toEqual([keyOf(PATHS.vpcA)]);
    expect(bands.get(keyOf(PATHS.vpcA))!.nestDepth).toBe(0);
  });

  it("a vpc strip falls back to the REGION hull when vpc hulls are de-banded", () => {
    // de-band=vpc dissolves the vpc hulls entirely — the exact live nesting case.
    const { model, placement } = twoVpcFixture("vpc");
    expect(placement.boxedHulls.has(keyOf(PATHS.vpcA))).toBe(false);
    const { bands, relocatedStripCount } = injectStrataAncillaryBands({
      model,
      placement,
      strips: [strip("vpc", PATHS.vpcA, [card("s3.a")])],
    });
    expect([...bands.keys()]).toEqual([keyOf(PATHS.region)]);
    expect(relocatedStripCount).toBe(1);
  });

  it("falls back through region → account → provider → root as hulls vanish", () => {
    // A model with ONLY a provider-level hull: no account/region/vpc for "9".
    const clusters = [
      frameCluster("c-a", place("aws", "1", "us-east-1", "vpc-a"), 300, 100),
    ];
    const model = buildStrataModel(prepOf(clusters), OPTS);
    const placement = placeStrataHulls(
      model,
      NO_EDGES,
      rankStub({ "c-a": 0 }),
      OPTS,
    );
    // Scope under a DIFFERENT account ⇒ only the provider prefix ("aws") exists.
    const s = strip("vpc", ["aws", "9", "eu-west-1", "vpc-z"], [card("s3.z")]);
    const { bands } = injectStrataAncillaryBands({
      model,
      placement,
      strips: [s],
    });
    expect([...bands.keys()]).toEqual([keyOf(PATHS.provider)]);
  });

  it("falls all the way back to the ROOT hull when no prefix exists", () => {
    const clusters = [
      frameCluster("c-a", place("aws", "1", "us-east-1", "vpc-a"), 300, 100),
    ];
    const model = buildStrataModel(prepOf(clusters), OPTS);
    const placement = placeStrataHulls(
      model,
      NO_EDGES,
      rankStub({ "c-a": 0 }),
      OPTS,
    );
    const s = strip("provider", ["gcp"], [card("gcs.z")]);
    const { bands } = injectStrataAncillaryBands({
      model,
      placement,
      strips: [s],
    });
    expect([...bands.keys()]).toEqual([model.hullRoot.id]);
  });
});

// ── 2. nesting trie (§3c) ─────────────────────────────────────────────────────

describe("nesting — one band per host, groups per de-banded level", () => {
  it("2 vpc strips + 1 region strip co-hosted ⇒ ONE band, 2 labelled groups, own cards loose and FIRST", () => {
    const { model, placement } = twoVpcFixture("vpc");
    const strips = [
      strip("vpc", PATHS.vpcA, [card("s3.a")]),
      strip("vpc", PATHS.vpcB, [card("s3.b")]),
      strip("region", PATHS.region, [card("sns.r")]),
    ];
    const { bands, maxNestDepth } = injectStrataAncillaryBands({
      model,
      placement,
      strips,
    });

    // ONE band (the region hull), not three.
    expect(bands.size).toBe(1);
    const band = bands.get(keyOf(PATHS.region))!;
    expect(band.stripCount).toBe(3);
    expect(band.cardCount).toBe(3);
    expect(maxNestDepth).toBe(1);

    const frames = band.skeleton.filter((el: any) => el.type === "frame");
    const names = frames.map((f: any) => f.name);
    expect(names).toContain("Unconnected");
    // Groups are labelled with strata's OWN hull phrasing (§3n), not a new
    // vocabulary.
    expect(names).toContain("VPC vpc-a");
    expect(names).toContain("VPC vpc-b");

    // The region's own card sits LOOSE (its frame parent is the band itself,
    // not a group) and FIRST — above both vpc groups. Owner's explicit choice.
    const bandFrame = frames.find((f: any) => f.name === "Unconnected") as any;
    expect(bandFrame.children).toContain("sns.r:card");
    const looseCard = band.skeleton.find(
      (el: any) => el.id === "sns.r:card",
    ) as any;
    const groupA = frames.find((f: any) => f.name === "VPC vpc-a") as any;
    expect(looseCard.y).toBeLessThan(groupA.y);
  });

  it("nests 3 levels deep at bandDepth=root + deBand=account (the owner's config)", () => {
    const clusters = [
      frameCluster("c-a", place("aws", "1", "us-east-1", "vpc-a"), 300, 100),
    ];
    const model = buildStrataModel(prepOf(clusters), {
      ...OPTS,
      strataBandDepth: "root",
      strataDeBandLevel: "account",
    });
    const placement = placeStrataHulls(
      model,
      NO_EDGES,
      rankStub({ "c-a": 0 }),
      OPTS,
    );
    // account de-band ⇒ only the provider hull survives ⇒ a vpc strip nests
    // account → region → vpc inside the provider's band.
    const { bands, maxNestDepth } = injectStrataAncillaryBands({
      model,
      placement,
      strips: [strip("vpc", PATHS.vpcA, [card("s3.a")])],
    });
    expect([...bands.keys()]).toEqual([keyOf(PATHS.provider)]);
    expect(maxNestDepth).toBe(3);
  });
});

// ── 3. the no-movement contract (§4) ──────────────────────────────────────────

describe("no-movement contract — X/width frozen, Y only grows downward", () => {
  it("leaves keep x/width/height; leaf y is monotone non-decreasing; hull x/width identical; root width unchanged", () => {
    const { model, placement } = twoVpcFixture();
    const before = placement;
    const { placement: after } = injectStrataAncillaryBands({
      model,
      placement,
      strips: [
        strip("vpc", PATHS.vpcA, [card("s3.a"), card("s3.a2"), card("s3.a3")]),
      ],
    });

    for (const [id, box] of before.leafBoxes) {
      const now = after.leafBoxes.get(id)!;
      expect(now.x).toBeCloseTo(box.x, 5);
      expect(now.width).toBeCloseTo(box.width, 5);
      expect(now.height).toBeCloseTo(box.height, 5);
      // Y may only grow downward.
      expect(now.y).toBeGreaterThanOrEqual(box.y - 0.5);
    }
    for (const [id, bh] of before.boxedHulls) {
      const now = after.boxedHulls.get(id)!;
      expect(now.box.x).toBeCloseTo(bh.box.x, 5);
      expect(now.box.width).toBeCloseTo(bh.box.width, 5);
      expect(now.box.y).toBeGreaterThanOrEqual(bh.box.y - 0.5);
    }
    // The headline: strata's root width is a function of rank.columnX and cannot
    // legitimately move at all.
    expect(after.boxedHulls.get(model.hullRoot.id)!.box.width).toBeCloseTo(
      before.boxedHulls.get(model.hullRoot.id)!.box.width,
      5,
    );
  });

  it("§3e: a band on vpc-a pushes the X-OVERLAPPING lower sibling vpc-b DOWN (the 90-collision step)", () => {
    const { model, placement } = twoVpcFixture();
    const aKey = keyOf(PATHS.vpcA);
    const bKey = keyOf(PATHS.vpcB);
    const beforeA = placement.boxedHulls.get(aKey)!.box;
    const beforeB = placement.boxedHulls.get(bKey)!.box;
    // Precondition — without this the test would pass vacuously (see header).
    expect(beforeA.x).toBeLessThan(beforeB.x + beforeB.width);
    expect(beforeB.x).toBeLessThan(beforeA.x + beforeA.width);
    expect(beforeB.y).toBeGreaterThanOrEqual(beforeA.y + beforeA.height - 0.5);

    const { placement: after, bands } = injectStrataAncillaryBands({
      model,
      placement,
      strips: [strip("vpc", PATHS.vpcA, [card("s3.a")])],
    });
    const grow = bands.get(aKey)!.box.height;
    const afterB = after.boxedHulls.get(bKey)!.box;
    // vpc-b moved down by at least the band's height — it did not stay put and
    // let the band grow vpc-a straight through it (the unreserved-space failure).
    expect(afterB.y - beforeB.y).toBeGreaterThanOrEqual(grow);
    // ...and the whole model is still structurally sound afterward.
    const structure = checkStrataStructure(after, model);
    expect(structure.nonAncestorOverlaps).toBe(0);
    expect(structure.titleCollisions).toBe(0);
    expect(structure.contiguityViolations).toBe(0);
  });

  it("§3e.2: the INPUT placement is never mutated (prep is cached across builds)", () => {
    const { model, placement } = twoVpcFixture();
    const snapshot = JSON.stringify([
      [...placement.boxedHulls].map(([id, bh]) => [id, bh.box, bh.placed]),
      [...placement.leafBoxes],
    ]);
    injectStrataAncillaryBands({
      model,
      placement,
      strips: [strip("vpc", PATHS.vpcA, [card("s3.a"), card("s3.a2")])],
    });
    expect(
      JSON.stringify([
        [...placement.boxedHulls].map(([id, bh]) => [id, bh.box, bh.placed]),
        [...placement.leafBoxes],
      ]),
    ).toBe(snapshot);
  });

  it("§3e.4: `placed` stays in lockstep with boxedHulls/leafBoxes (a desync is silent + green)", () => {
    const { model, placement } = twoVpcFixture();
    const { placement: after } = injectStrataAncillaryBands({
      model,
      placement,
      strips: [strip("vpc", PATHS.vpcA, [card("s3.a")])],
    });
    for (const bh of after.boxedHulls.values()) {
      for (const pu of bh.placed) {
        if (pu.unit.kind === "leaf") {
          const leaf = after.leafBoxes.get(pu.unit.clusterId)!;
          expect(pu.box.y).toBeCloseTo(leaf.y, 5);
          expect(pu.box.x).toBeCloseTo(leaf.x, 5);
        } else {
          const child = after.boxedHulls.get(pu.unit.hullId)!;
          expect(pu.box.y).toBeCloseTo(child.box.y, 5);
          expect(pu.box.height).toBeCloseTo(child.box.height, 5);
        }
      }
    }
  });
});

// ── 4. containment (§3g) ──────────────────────────────────────────────────────

describe("containment — the check `checkStrataStructure` structurally cannot do", () => {
  it("every band ⊆ its host, overlaps no leaf/foreign hull, and clears every title strip", () => {
    const { model, placement } = twoVpcFixture("vpc");
    const injected = injectStrataAncillaryBands({
      model,
      placement,
      strips: [
        strip("vpc", PATHS.vpcA, [card("s3.a")]),
        strip("vpc", PATHS.vpcB, [card("s3.b")]),
        strip("region", PATHS.region, [card("sns.r")]),
      ],
    });
    expect(
      checkStrataAncillaryContainment(
        injected.bands,
        injected.placement,
        model,
      ),
    ).toEqual({
      bandEscapesHost: 0,
      bandOverlaps: 0,
      bandTitleCollisions: 0,
    });
  });

  it("CATCHES a band that escapes its host (the check is not vacuous)", () => {
    const { model, placement } = twoVpcFixture();
    const injected = injectStrataAncillaryBands({
      model,
      placement,
      strips: [strip("vpc", PATHS.vpcA, [card("s3.a")])],
    });
    const band = injected.bands.get(keyOf(PATHS.vpcA))!;
    const escaped = new Map([
      [band.hullId, { ...band, box: { ...band.box, y: band.box.y + 5000 } }],
    ]);
    const result = checkStrataAncillaryContainment(
      escaped,
      injected.placement,
      model,
    );
    expect(result.bandEscapesHost).toBe(1);
  });

  it("CATCHES a band overlapping a leaf", () => {
    const { model, placement } = twoVpcFixture();
    const injected = injectStrataAncillaryBands({
      model,
      placement,
      strips: [strip("vpc", PATHS.vpcA, [card("s3.a")])],
    });
    const band = injected.bands.get(keyOf(PATHS.vpcA))!;
    const leafBox = injected.placement.leafBoxes.get("c-a")!;
    const overlapping = new Map([
      [band.hullId, { ...band, box: { ...leafBox } }],
    ]);
    expect(
      checkStrataAncillaryContainment(overlapping, injected.placement, model)
        .bandOverlaps,
    ).toBeGreaterThan(0);
  });
});

// ── 5. the role firewall (§3j) ────────────────────────────────────────────────

/**
 * The four duplicated copies of the topology-role set (StrataPierceMetrics:38,
 * CollisionDiagnostics:111, SliceMetrics:170, StrataChurnMetrics:63), each
 * filtering on a bare `terraformTopologyRole` read with NO ancillary exclusion.
 */
const TOPOLOGY_ROLES = new Set([
  "provider",
  "account",
  "region",
  "vpc",
  "subnetZone",
]);

describe("role firewall — a band must never look like a topology frame", () => {
  it("no band/group frame carries a role in TOPOLOGY_ROLES", () => {
    const { model, placement } = twoVpcFixture("vpc");
    const { bands } = injectStrataAncillaryBands({
      model,
      placement,
      strips: [
        strip("vpc", PATHS.vpcA, [card("s3.a")]),
        strip("region", PATHS.region, [card("sns.r")]),
      ],
    });
    const band = bands.get(keyOf(PATHS.region))!;
    const frames = band.skeleton.filter(
      (el: any) => el.type === "frame",
    ) as any[];
    expect(frames.length).toBeGreaterThan(0);

    // NOTHING the band emits — container or card — may carry a topology role.
    for (const f of frames) {
      expect(TOPOLOGY_ROLES.has(f.customData?.terraformTopologyRole)).toBe(
        false,
      );
    }

    // The containers this module emits carry a role that is DELIBERATELY
    // present and deliberately not a TOPOLOGY_ROLE. The firewall is NOT "have no
    // role" — it is "have a role that is not a TOPOLOGY_ROLE", exactly what the
    // shipped strip does with "ancillaryStrip". (The plan's Verification §5 still
    // says "no role at all"; that predates its own §3j correction and would
    // forbid the very mechanism §3j mandates — see the report.)
    const containers = frames.filter(
      (f) =>
        f.id === band.frameId ||
        String(f.id).startsWith("tf-pipeline:ancillaryGroup:"),
    );
    expect(containers.length).toBe(2); // the band + the one vpc group
    for (const f of containers) {
      expect(["ancillaryStrip", "ancillaryGroup"]).toContain(
        f.customData?.terraformTopologyRole,
      );
      expect(f.customData?.terraformPipelineAncillary).toBe(true);
      // §3n — grey + hollow, never `spreadContextFrameColors`: a group labelled
      // `VPC vpc-a` must not read as a REAL VPC hull.
      expect(f.backgroundColor).toBe("transparent");
      expect(f.strokeColor).toBe("#94a3b8");
    }
  });

  it("a group's topology path is the TRIE path, not `pipelineFrameCustomData`'s role-derived fallback", () => {
    const { model, placement } = twoVpcFixture("vpc");
    const { bands } = injectStrataAncillaryBands({
      model,
      placement,
      strips: [strip("vpc", PATHS.vpcA, [card("s3.a")])],
    });
    const band = bands.get(keyOf(PATHS.region))!;
    const group = band.skeleton.find(
      (el: any) => el.customData?.terraformTopologyRole === "ancillaryGroup",
    ) as any;
    expect(group.customData.terraformTopologyPath).toEqual(PATHS.vpcA);
    const bandFrame = band.skeleton.find(
      (el: any) => el.customData?.terraformTopologyRole === "ancillaryStrip",
    ) as any;
    expect(bandFrame.customData.terraformTopologyPath).toEqual(PATHS.region);
  });
});

// ── 6. anti-landmine (§3h) ────────────────────────────────────────────────────

describe("anti-landmine — a band always DRAWS something", () => {
  it("band.skeleton is non-empty and carries a real `Unconnected` frame", () => {
    // This is the test that would have caught `ancillaryStripAsPseudoCluster`'s
    // `skeleton: []` — which reserves a box, inflates geometry, stamps nothing
    // and draws nothing: silent, green, invisible.
    const { model, placement } = twoVpcFixture();
    const { bands } = injectStrataAncillaryBands({
      model,
      placement,
      strips: [strip("vpc", PATHS.vpcA, [card("s3.a")])],
    });
    const band = bands.get(keyOf(PATHS.vpcA))!;
    expect(band.skeleton.length).toBeGreaterThan(0);
    expect(band.skeleton.some((el: any) => el.name === "Unconnected")).toBe(
      true,
    );
    // ...and the card itself is really in there, not just the container.
    expect(band.skeleton.some((el: any) => el.id === "s3.a:card")).toBe(true);
    expect(band.box.width).toBeGreaterThan(0);
    expect(band.box.height).toBeGreaterThan(0);
  });

  it("emits NO band for a host with zero ancillary cards (not an empty box)", () => {
    const { model, placement } = twoVpcFixture();
    const { bands } = injectStrataAncillaryBands({
      model,
      placement,
      strips: [],
    });
    expect(bands.size).toBe(0);
  });
});

// ── 7. strips never leak into the model ───────────────────────────────────────

describe("strips never enter the model", () => {
  it("the model's cluster set is untouched by injection", () => {
    const { model, placement } = twoVpcFixture();
    const before = model.clusters.size;
    const hullCountBefore = placement.boxedHulls.size;
    const { placement: after } = injectStrataAncillaryBands({
      model,
      placement,
      strips: [strip("vpc", PATHS.vpcA, [card("s3.a")])],
    });
    expect(model.clusters.size).toBe(before);
    // A band is a SIDE MAP — it is never a hull and never a placed unit, so the
    // closed 2-kind `StrataUnit` union is untouched.
    expect(after.boxedHulls.size).toBe(hullCountBefore);
    for (const bh of after.boxedHulls.values()) {
      for (const pu of bh.placed) {
        expect(["hull", "leaf"]).toContain(pu.unit.kind);
      }
    }
  });
});

// ── 8. de-band feasibility ────────────────────────────────────────────────────

describe("deBand=provider is structurally unreachable", () => {
  it("is infeasible at EVERY band depth (pinned by a test, not a runtime guard)", () => {
    // The exhaustive `StrataHullRole` domain, inlined deliberately: the shipped
    // `STRATA_BAND_DEPTH_ORDER` lives in a UI module, and an engine test must not
    // depend on one. `provider` de-band absorbs into the root, which is pinned
    // banded at every cut (v3.1 §1.4) ⇒ the top rung is structurally dead, so
    // there is no empty-path branch in the injector to guard.
    const allDepths: StrataHullRole[] = [
      "root",
      "provider",
      "account",
      "region",
      "vpc",
      "subnetZone",
    ];
    for (const depth of allDepths) {
      expect(strataDeBandFeasible("provider", depth)).toBe(false);
    }
  });
});

// ── 9. determinism (§3b) ──────────────────────────────────────────────────────

describe("determinism", () => {
  it("two injections are byte-identical (guards the inherited localeCompare order)", () => {
    const run = (): StrataPlacementResult & { json: string } => {
      const { model, placement } = twoVpcFixture("vpc");
      const injected = injectStrataAncillaryBands({
        model,
        placement,
        // Deliberately fed in an order the pinned comparator must re-sort.
        strips: [
          strip("region", PATHS.region, [card("sns.r")]),
          strip("vpc", PATHS.vpcB, [card("s3.b")]),
          strip("vpc", PATHS.vpcA, [card("s3.a")]),
        ],
      });
      return {
        ...injected.placement,
        json: JSON.stringify([...injected.bands]),
      };
    };
    expect(run().json).toBe(run().json);
  });

  it("band element order does not depend on the input strip order", () => {
    const build = (strips: AncillaryStrip[]) => {
      const { model, placement } = twoVpcFixture("vpc");
      return JSON.stringify([
        ...injectStrataAncillaryBands({ model, placement, strips }).bands,
      ]);
    };
    const a = build([
      strip("vpc", PATHS.vpcA, [card("s3.a")]),
      strip("vpc", PATHS.vpcB, [card("s3.b")]),
    ]);
    const b = build([
      strip("vpc", PATHS.vpcB, [card("s3.b")]),
      strip("vpc", PATHS.vpcA, [card("s3.a")]),
    ]);
    expect(a).toBe(b);
  });
});

// ── §3f — wrap to the host's interior ─────────────────────────────────────────

describe("§3f — wrap width comes from the HOST'S INTERIOR, never the 1268px constant", () => {
  it("a band never exceeds its host's interior when cards fit", () => {
    const { model, placement } = twoVpcFixture();
    const host = placement.boxedHulls.get(keyOf(PATHS.vpcA))!;
    const interior = host.box.width - 2 * PIPELINE_FRAME_PAD;
    const { bands, hostWidenedCount } = injectStrataAncillaryBands({
      model,
      placement,
      strips: [
        strip("vpc", PATHS.vpcA, [
          card("s3.a", 100),
          card("s3.b", 100),
          card("s3.c", 100),
          card("s3.d", 100),
          card("s3.e", 100),
          card("s3.f", 100),
        ]),
      ],
    });
    expect(bands.get(keyOf(PATHS.vpcA))!.box.width).toBeLessThanOrEqual(
      interior + 0.5,
    );
    expect(hostWidenedCount).toBe(0);
  });

  it("counts the one irreducible case: a single card wider than the host interior", () => {
    const { model, placement } = twoVpcFixture();
    const host = placement.boxedHulls.get(keyOf(PATHS.vpcA))!;
    const tooWide = host.box.width + 500;
    const { hostWidenedCount, bands } = injectStrataAncillaryBands({
      model,
      placement,
      strips: [strip("vpc", PATHS.vpcA, [card("s3.huge", tooWide)])],
    });
    expect(hostWidenedCount).toBe(1);
    expect(bands.get(keyOf(PATHS.vpcA))!.box.width).toBeGreaterThan(tooWide);
  });
});
