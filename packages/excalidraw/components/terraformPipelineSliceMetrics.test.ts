/**
 * Unit fixtures for T9 slice-A/B metrics (WP-2d, rcll-v2 spec v3.1 §2).
 *
 * Hand-built frames + arrows, following the same adversarial-fixture
 * convention as terraformPipelineReadabilityMetrics.test.ts: each metric's
 * true value is known by construction. Element shapes mirror what
 * `pipelineFrameCustomData` actually stamps (terraformPipelineLayoutShared.ts:233-259)
 * and what `buildFallbackCluster` stamps on primary-cluster frames — a full
 * `terraformTopologyPath` on every frame, topology AND primary-cluster alike.
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { computeSliceMetrics } from "./terraformPipelineSliceMetrics";

// ── element factories ───────────────────────────────────────────────────────

let idSeq = 0;
const nextId = () => `el-${idSeq++}`;

/** A primary-cluster frame, addressable by TFD relationships, carrying its own
 * full topology path (as buildFallbackCluster stamps it). */
function cluster(
  address: string,
  path: string[],
  x: number,
  y: number,
  width = 40,
  height = 40,
): ExcalidrawElement {
  return {
    id: address,
    type: "frame",
    x,
    y,
    width,
    height,
    angle: 0,
    isDeleted: false,
    customData: {
      terraformTopologyRole: "primaryCluster",
      terraformPrimaryAddress: address,
      terraformTopologyPath: path,
    },
  } as unknown as ExcalidrawElement;
}

/** A topology (hull) frame — provider/account/region/vpc/subnetZone. The
 * optional `policy` mirrors the resolved-policy stamp
 * (`customData.terraformHullPolicy`) that terraformPipelineStrataSceneBuild.ts
 * writes on a hull frame ONLY under a non-default `strataBandDepth` cut; when
 * omitted the key is absent, exactly as at the default "account" cut. */
function topoFrame(
  role: "provider" | "account" | "region" | "vpc" | "subnetZone",
  path: string[],
  x: number,
  y: number,
  width = 400,
  height = 40,
  policy?: "banded" | "packed",
): ExcalidrawElement {
  return {
    id: `frame:${path.join("/")}`,
    type: "frame",
    x,
    y,
    width,
    height,
    angle: 0,
    isDeleted: false,
    customData: {
      terraformTopologyRole: role,
      terraformTopologyKey: path.join("\0"),
      terraformTopologyPath: path,
      ...(policy ? { terraformHullPolicy: policy } : {}),
    },
  } as unknown as ExcalidrawElement;
}

/**
 * A COMPACT-mode compound primary-cluster frame: NO own `terraformTopologyPath`
 * (empirically absent in real compact-mode scenes, 2026-07 WP-2d probe) — only
 * `terraformCompoundParentKey`, referencing a topoFrame's `terraformTopologyKey`.
 */
function compactCluster(
  address: string,
  parentKey: string,
  x: number,
  y: number,
  width = 40,
  height = 40,
): ExcalidrawElement {
  return {
    id: address,
    type: "frame",
    x,
    y,
    width,
    height,
    angle: 0,
    isDeleted: false,
    customData: {
      terraformTopologyRole: "primaryCluster",
      terraformPrimaryAddress: address,
      terraformCompoundParentKey: parentKey,
    },
  } as unknown as ExcalidrawElement;
}

/** A primary-cluster frame with NEITHER its own path NOR a compound-parent
 * key — only geometric nesting inside a topology frame's rect. */
function bareCluster(
  address: string,
  x: number,
  y: number,
  width = 40,
  height = 40,
): ExcalidrawElement {
  return {
    id: address,
    type: "frame",
    x,
    y,
    width,
    height,
    angle: 0,
    isDeleted: false,
    customData: {
      terraformTopologyRole: "primaryCluster",
      terraformPrimaryAddress: address,
    },
  } as unknown as ExcalidrawElement;
}

/** A leaf resource node card. */
function resourceCard(
  x: number,
  y: number,
  width = 20,
  height = 10,
  visibilityRoleOnly = false,
): ExcalidrawElement {
  return {
    id: nextId(),
    type: "rectangle",
    x,
    y,
    width,
    height,
    angle: 0,
    isDeleted: false,
    customData: visibilityRoleOnly
      ? { terraformVisibilityRole: "resource" }
      : { terraformNodeKind: "resource" },
  } as unknown as ExcalidrawElement;
}

/** A TFD arrow. `pts` are ABSOLUTE polyline points (mirrors the readability
 * metrics fixtures' convention). */
function arrow(
  source: string,
  target: string,
  pts: Array<[number, number]>,
): ExcalidrawElement {
  const [ox, oy] = pts[0]!;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    id: nextId(),
    type: "arrow",
    x: ox,
    y: oy,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    angle: 0,
    points: pts.map(([px, py]) => [px - ox, py - oy]),
    isDeleted: false,
    customData: { relationship: { source, target, aggregated: false } },
  } as unknown as ExcalidrawElement;
}

// ── slice classification (band-row theorem) ─────────────────────────────────

describe("slice classification", () => {
  it("packed LCA (same VPC, different subnets) ⇒ slice A", () => {
    const els = [
      cluster("a", ["aws", "acct1", "us-east-1", "vpc-1", "subnet-a"], 0, 0),
      cluster("b", ["aws", "acct1", "us-east-1", "vpc-1", "subnet-b"], 300, 0),
      arrow("a", "b", [
        [40, 20],
        [300, 20],
      ]),
    ];
    const m = computeSliceMetrics(els);
    expect(m.populations).toEqual({ nA: 1, nB: 0, unresolvedEdgeCount: 0 });
  });

  it("banded LCA (same account, different regions) ⇒ slice B", () => {
    const els = [
      cluster("a", ["aws", "acct1", "us-east-1"], 0, 0),
      cluster("b", ["aws", "acct1", "us-west-2"], 300, 0),
      arrow("a", "b", [
        [40, 20],
        [300, 20],
      ]),
    ];
    const m = computeSliceMetrics(els);
    expect(m.populations).toEqual({ nA: 0, nB: 1, unresolvedEdgeCount: 0 });
  });

  it("root LCA (cross-provider) ⇒ slice B", () => {
    const els = [
      cluster("a", ["aws", "acct1", "us-east-1"], 0, 0),
      cluster("b", ["gcp", "proj1", "us-central1"], 300, 0),
      arrow("a", "b", [
        [40, 20],
        [300, 20],
      ]),
    ];
    const m = computeSliceMetrics(els);
    expect(m.populations).toEqual({ nA: 0, nB: 1, unresolvedEdgeCount: 0 });
  });

  it("same band (identical subnet path) ⇒ deeper LCA ⇒ slice A", () => {
    const path = ["aws", "acct1", "us-east-1", "vpc-1", "subnet-a"];
    const els = [
      cluster("a", path, 0, 0),
      cluster("b", path, 300, 0),
      arrow("a", "b", [
        [40, 20],
        [300, 20],
      ]),
    ];
    const m = computeSliceMetrics(els);
    expect(m.populations).toEqual({ nA: 1, nB: 0, unresolvedEdgeCount: 0 });
  });

  it("unresolved endpoint (no matching cluster) is excluded, not mis-sliced", () => {
    const els = [
      cluster("a", ["aws", "acct1", "us-east-1"], 0, 0),
      arrow("a", "ghost", [
        [40, 20],
        [300, 20],
      ]),
    ];
    const m = computeSliceMetrics(els);
    expect(m.populations).toEqual({ nA: 0, nB: 0, unresolvedEdgeCount: 1 });
  });
});

// ── cluster path resolution (compound builders, WP-2d verification finding) ─
//
// Real V2-compact compound scenes stamp NO `terraformTopologyPath` on
// primary-cluster frames — only `terraformCompoundParentKey` (verified
// empirically against staging-extended-localstack-v2). Without the
// compound-parent-key fallback, every cluster's path would default to `[]`,
// collapsing EVERY edge's LCA to root (slice B) regardless of true topology —
// these tests pin the fix.

describe("cluster path resolution (compound builders)", () => {
  it("no own path, only terraformCompoundParentKey ⇒ resolves via the parent hull's path", () => {
    const regionA = topoFrame(
      "region",
      ["aws", "acct1", "us-east-1"],
      0,
      0,
      400,
      40,
    );
    const regionB = topoFrame(
      "region",
      ["aws", "acct1", "us-west-2"],
      0,
      100,
      400,
      40,
    );
    const els = [
      regionA,
      regionB,
      compactCluster(
        "a",
        regionA.customData!.terraformTopologyKey as string,
        10,
        10,
      ),
      compactCluster(
        "b",
        regionB.customData!.terraformTopologyKey as string,
        10,
        110,
      ),
      arrow("a", "b", [
        [40, 30],
        [40, 130],
      ]),
    ];
    const m = computeSliceMetrics(els);
    // LCA of ["aws","acct1","us-east-1"] and ["aws","acct1","us-west-2"] is
    // ["aws","acct1"] (account, banded) ⇒ slice B — proves the parent-key
    // fallback recovered each cluster's real path, not the `[]` default.
    expect(m.populations).toEqual({ nA: 0, nB: 1, unresolvedEdgeCount: 0 });
  });

  it("no path and no parent key ⇒ falls back to geometric containment", () => {
    const vpcA = topoFrame(
      "vpc",
      ["aws", "acct1", "us-east-1", "vpc-1"],
      0,
      0,
      200,
      200,
    );
    const vpcB = topoFrame(
      "vpc",
      ["aws", "acct1", "us-east-1", "vpc-2"],
      300,
      0,
      200,
      200,
    );
    const els = [
      vpcA,
      vpcB,
      bareCluster("a", 20, 20), // geometrically inside vpcA's rect
      bareCluster("b", 320, 20), // geometrically inside vpcB's rect
      arrow("a", "b", [
        [40, 40],
        [340, 40],
      ]),
    ];
    const m = computeSliceMetrics(els);
    // LCA of the two VPC paths is ["aws","acct1","us-east-1"] (region,
    // packed) ⇒ slice A — proves geometric containment recovered the paths.
    expect(m.populations).toEqual({ nA: 1, nB: 0, unresolvedEdgeCount: 0 });
  });

  it("own path (when present) wins over a stale/mismatched parent key", () => {
    const els = [
      // Deliberately wrong parentKey pointing nowhere — own path must win.
      {
        ...compactCluster("a", "no-such-frame", 0, 0),
        customData: {
          ...(compactCluster("a", "no-such-frame", 0, 0).customData as Record<
            string,
            unknown
          >),
          terraformTopologyPath: ["aws", "acct1", "us-east-1", "vpc-1", "s1"],
        },
      } as ExcalidrawElement,
      cluster("b", ["aws", "acct1", "us-east-1", "vpc-1", "s1"], 300, 0),
      arrow("a", "b", [
        [40, 20],
        [300, 20],
      ]),
    ];
    const m = computeSliceMetrics(els);
    expect(m.populations).toEqual({ nA: 1, nB: 0, unresolvedEdgeCount: 0 });
  });
});

// ── resolved hull-policy frame stamp (band-depth cut, WP3) ──────────────────
//
// Both policy reads (A/B classification at the LCA hull frame, and the
// stacked-band-height banded-level set) prefer the resolved policy stamped on
// the hull frame as `customData.terraformHullPolicy` — present only under a
// non-default `strataBandDepth` cut — and fall back to the static
// `STRATA_HULL_POLICY` role→policy map when it is absent. The whole rest of
// this suite exercises the default (unstamped) fallback path; these tests pin
// the stamped round-trip and the root-pinned exception.

describe("resolved hull-policy frame stamp (band-depth cut)", () => {
  it("no stamp (default cut) ⇒ static-map fallback: account LCA is slice B, banded set = root/provider/account", () => {
    const els = [
      topoFrame("provider", ["aws"], 0, 0, 800, 600),
      topoFrame("account", ["aws", "acct1"], 0, 0, 800, 300),
      cluster("a", ["aws", "acct1", "us-east-1"], 10, 10),
      cluster("b", ["aws", "acct1", "us-west-2"], 300, 10),
      arrow("a", "b", [
        [40, 20],
        [300, 20],
      ]),
    ];
    const m = computeSliceMetrics(els);
    // account LCA, banded by the static map ⇒ slice B (unchanged legacy path).
    expect(m.populations).toEqual({ nA: 0, nB: 1, unresolvedEdgeCount: 0 });
    // stacked band height spans exactly root/provider/account (depths 0–2).
    expect(m.stackedBandHeight.perHull.map((h) => h.role)).toEqual([
      "root",
      "provider",
      "account",
    ]);
  });

  it("provider+account stamped packed (root cut) ⇒ account LCA reclassifies to slice A; banded set collapses to root only", () => {
    const els = [
      topoFrame("provider", ["aws"], 0, 0, 800, 600, "packed"),
      topoFrame("account", ["aws", "acct1"], 0, 0, 800, 300, "packed"),
      cluster("a", ["aws", "acct1", "us-east-1"], 10, 10),
      cluster("b", ["aws", "acct1", "us-west-2"], 300, 10),
      arrow("a", "b", [
        [40, 20],
        [300, 20],
      ]),
    ];
    const m = computeSliceMetrics(els);
    // Site 1: the account LCA frame stamped "packed" ⇒ slice A (was B by the
    // static map) — the stamp wins over the fallback.
    expect(m.populations).toEqual({ nA: 1, nB: 0, unresolvedEdgeCount: 0 });
    // Site 2: provider & account excluded from the banded set ⇒ only root.
    expect(m.stackedBandHeight.perHull.map((h) => h.role)).toEqual(["root"]);
  });

  it("region stamped banded (region cut) ⇒ region LCA reclassifies to slice B; banded set extends to region depth", () => {
    const els = [
      topoFrame(
        "region",
        ["aws", "acct1", "us-east-1"],
        0,
        0,
        800,
        600,
        "banded",
      ),
      cluster("a", ["aws", "acct1", "us-east-1", "vpc-1"], 10, 10),
      cluster("b", ["aws", "acct1", "us-east-1", "vpc-2"], 300, 10),
      arrow("a", "b", [
        [40, 20],
        [300, 20],
      ]),
    ];
    const m = computeSliceMetrics(els);
    // Site 1: the region LCA frame stamped "banded" ⇒ slice B (was A by the
    // static map, region=packed).
    expect(m.populations).toEqual({ nA: 0, nB: 1, unresolvedEdgeCount: 0 });
    // Site 2: provider/account (no frame ⇒ static banded) + region (stamped
    // banded) ⇒ banded set now reaches region depth.
    expect(m.stackedBandHeight.perHull.map((h) => h.role)).toEqual([
      "root",
      "provider",
      "account",
      "region",
    ]);
  });

  it("root stays pinned banded: cross-provider (root LCA) is slice B even with providers stamped packed", () => {
    const els = [
      topoFrame("provider", ["aws"], 0, 0, 400, 600, "packed"),
      topoFrame("provider", ["gcp"], 500, 0, 400, 600, "packed"),
      cluster("a", ["aws", "acct1", "us-east-1"], 10, 10),
      cluster("b", ["gcp", "proj1", "us-central1"], 510, 10),
      arrow("a", "b", [
        [40, 20],
        [510, 20],
      ]),
    ];
    const m = computeSliceMetrics(els);
    // LCA length 0 (root) ⇒ pinned slice B regardless of any stamp — root has
    // no frame, so the length-0 guard fires before any lookup.
    expect(m.populations).toEqual({ nA: 0, nB: 1, unresolvedEdgeCount: 0 });
  });
});

// ── bands-skipped projection ─────────────────────────────────────────────────

describe("bands-skipped projection", () => {
  it("LCA = root, cross-provider: dissolved bands (no provider frames) — adjacent vs skip-1", () => {
    // Three providers, each with a single bare-leaf cluster anchored directly
    // at the provider level (path length 1) — no provider-role topology frame
    // exists, so band Y-order must fall back to the member's own center-Y
    // (v3.1 §2 item 4, dissolved-band recovery).
    const els = [
      cluster("p-aws", ["aws"], 0, 0), // centerY 20
      cluster("p-gcp", ["gcp"], 0, 100), // centerY 120
      cluster("p-azure", ["azure"], 0, 200), // centerY 220
      arrow("p-aws", "p-gcp", [
        [40, 20],
        [40, 120],
      ]),
      arrow("p-aws", "p-azure", [
        [40, 20],
        [40, 220],
      ]),
    ];
    const m = computeSliceMetrics(els);
    expect(m.sliceBEmpty).toBe(false);
    expect(m.bandsSkipped).not.toBeNull();
    expect(m.bandsSkipped!.n).toBe(2);
    // aws→gcp adjacent (0 skipped), aws→azure skips over gcp (1 skipped).
    expect(m.bandsSkipped!.distribution.sort((a, b) => a - b)).toEqual([0, 1]);
    expect(m.bandsSkipped!.mean).toBe(0.5);
  });

  it("nested account bands: an EXISTING region frame's Y governs order over member median (regression guard)", () => {
    // Region frames placed in one Y order; each region's sole member cluster
    // placed in the OPPOSITE Y order. If band ordering incorrectly fell back
    // to member-Y (instead of preferring the existing frame), this would flip
    // the expected skip count.
    const els = [
      topoFrame("region", ["aws", "acct1", "us-west-2"], 0, 0), // frame centerY 20
      topoFrame("region", ["aws", "acct1", "eu-west-1"], 0, 250), // frame centerY 270
      topoFrame("region", ["aws", "acct1", "us-east-1"], 0, 500), // frame centerY 520
      cluster("c-east", ["aws", "acct1", "us-east-1", "vpc-1"], 500, 10), // member centerY 30 (LOWEST)
      cluster("c-west", ["aws", "acct1", "us-west-2", "vpc-1"], 500, 20), // member centerY 40
      cluster("c-eu", ["aws", "acct1", "eu-west-1", "vpc-1"], 500, 30), // member centerY 50 (HIGHEST)
      arrow("c-west", "c-east", [
        [540, 40],
        [540, 30],
      ]),
      arrow("c-west", "c-eu", [
        [540, 40],
        [540, 50],
      ]),
    ];
    const m = computeSliceMetrics(els);
    expect(m.bandsSkipped).not.toBeNull();
    // Frame order by Y: us-west-2 (20) < eu-west-1 (270) < us-east-1 (520).
    // c-west → c-east spans the full range, skipping eu-west-1 ⇒ 1.
    // c-west → c-eu is adjacent ⇒ 0.
    // A member-Y-based (buggy) ordering would give 0 and 0/negative instead.
    expect(m.bandsSkipped!.distribution.sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it("adjacent bands ⇒ 0 (two-band account, no skip possible)", () => {
    const els = [
      cluster("a", ["aws", "acct1", "us-east-1"], 0, 0),
      cluster("b", ["aws", "acct1", "us-west-2"], 300, 100),
      arrow("a", "b", [
        [40, 20],
        [300, 120],
      ]),
    ];
    const m = computeSliceMetrics(els);
    expect(m.bandsSkipped).toEqual({ n: 1, mean: 0, distribution: [0] });
  });

  it("empty slice B ⇒ bandsSkipped null, sliceBEmpty true (vacuous, stated)", () => {
    const els = [
      cluster("a", ["aws", "acct1", "us-east-1", "vpc-1", "subnet-a"], 0, 0),
      cluster("b", ["aws", "acct1", "us-east-1", "vpc-1", "subnet-b"], 300, 0),
      arrow("a", "b", [
        [40, 20],
        [300, 20],
      ]),
    ];
    const m = computeSliceMetrics(els);
    expect(m.sliceBEmpty).toBe(true);
    expect(m.bandsSkipped).toBeNull();
  });
});

// ── rank-span-normalized deviation (floor at |Δx|=0) ────────────────────────

describe("normalized deviation floor", () => {
  it("same-rank (Δx=0) floors the denominator to COLUMN_GAP (150); cross-rank uses |Δx|", () => {
    const els = [
      cluster("s1", ["aws", "acct1", "us-east-1"], 0, 0),
      cluster("t1", ["aws", "acct1", "us-east-1"], 0, 200),
      // same X ⇒ Δx=0 ⇒ denom=max(150,0)=150; extent=50 ⇒ 50/150=0.333⇒0.33
      arrow("s1", "t1", [
        [10, 0],
        [10, 50],
      ]),
      cluster("s2", ["aws", "acct1", "us-west-2"], 500, 0),
      cluster("t2", ["aws", "acct1", "us-west-2"], 800, 0),
      // Δx=300 ⇒ denom=300; extent=80 ⇒ 80/300=0.2667⇒0.27
      arrow("s2", "t2", [
        [500, 0],
        [800, 80],
      ]),
    ];
    const m = computeSliceMetrics(els);
    expect(m.normalizedDeviation.sameRank).toEqual({
      n: 1,
      p50: 0.33,
      p90: 0.33,
      mean: 0.33,
    });
    expect(m.normalizedDeviation.crossRank).toEqual({
      n: 1,
      p50: 0.27,
      p90: 0.27,
      mean: 0.27,
    });
  });
});

// ── area utilization ─────────────────────────────────────────────────────────

describe("area utilization", () => {
  it("is bounded in [0,1] and counts a nested leaf exactly once (no frame double-count)", () => {
    const els = [
      topoFrame("provider", ["aws"], 0, 0, 100, 100),
      cluster("c1", ["aws", "acct1", "us-east-1"], 20, 20, 60, 60),
      resourceCard(30, 30, 50, 20),
    ];
    const m = computeSliceMetrics(els);
    expect(m.areaUtilization.leafElementCount).toBe(1);
    expect(m.areaUtilization.leafAreaPx2).toBe(1000); // 50*20
    expect(m.areaUtilization.contentBBoxAreaPx2).toBe(10_000); // outer provider frame wins
    expect(m.areaUtilization.utilization).toBeGreaterThanOrEqual(0);
    expect(m.areaUtilization.utilization).toBeLessThanOrEqual(1);
    expect(m.areaUtilization.utilization).toBe(0.1);
  });

  it("also recognizes terraformVisibilityRole:'resource' as a leaf (fallback marker)", () => {
    const els = [
      topoFrame("provider", ["aws"], 0, 0, 100, 100),
      resourceCard(10, 10, 10, 10, /* visibilityRoleOnly */ true),
    ];
    const m = computeSliceMetrics(els);
    expect(m.areaUtilization.leafElementCount).toBe(1);
    expect(m.areaUtilization.leafAreaPx2).toBe(100);
  });

  it("no content frames ⇒ 0 (no divide-by-zero)", () => {
    const m = computeSliceMetrics([resourceCard(0, 0, 10, 10)]);
    expect(m.areaUtilization.contentBBoxAreaPx2).toBe(0);
    expect(m.areaUtilization.utilization).toBe(0);
  });
});

// ── determinism ──────────────────────────────────────────────────────────────

describe("determinism", () => {
  it("same elements → identical slice metrics on repeat", () => {
    const build = () => [
      cluster("a", ["aws", "acct1", "us-east-1", "vpc-1", "subnet-a"], 0, 0),
      cluster("b", ["aws", "acct1", "us-east-1", "vpc-1", "subnet-b"], 300, 0),
      cluster("c", ["aws", "acct1", "us-west-2"], 600, 0),
      arrow("a", "b", [
        [40, 20],
        [300, 20],
      ]),
      arrow("a", "c", [
        [40, 20],
        [600, 20],
      ]),
    ];
    expect(computeSliceMetrics(build())).toEqual(computeSliceMetrics(build()));
  });
});
