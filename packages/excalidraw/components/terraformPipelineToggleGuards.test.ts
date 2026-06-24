/**
 * RCLL toggle-guard policy unit tests — the cross-toggle coupling backstop shared by
 * the import dialog and terraformLayoutCore. See terraformPipelineToggleGuards.ts.
 */
import { describe, expect, it } from "vitest";

import {
  DEDENSIFY_DEFAULT_MAX_COLS,
  applyRcllToggleGuards,
  rankSeparateAvailable,
} from "./terraformPipelineToggleGuards";

describe("rankSeparateAvailable", () => {
  it("is true only when swimlaneLaneRise is on", () => {
    expect(rankSeparateAvailable(true)).toBe(true);
    expect(rankSeparateAvailable(false)).toBe(false);
  });
});

describe("applyRcllToggleGuards", () => {
  it("drops rankSeparate when swimlaneLaneRise is off (the solo footgun)", () => {
    const { options, suppressions } = applyRcllToggleGuards({
      rankSeparate: true,
      swimlaneLaneRise: false,
    });
    expect(options.rankSeparate).toBe(false);
    expect(suppressions).toEqual(["rankSeparate-needs-rise"]);
  });

  it("keeps rankSeparate when swimlaneLaneRise is on", () => {
    const { options, suppressions } = applyRcllToggleGuards({
      rankSeparate: true,
      swimlaneLaneRise: true,
    });
    expect(options.rankSeparate).toBe(true);
    expect(suppressions).toEqual([]);
  });

  it("defaults the de-densify dial when the toggle is on without one", () => {
    const { options, suppressions } = applyRcllToggleGuards({
      deDensify: true,
    });
    expect(options.deDensifyMaxCols).toBe(DEDENSIFY_DEFAULT_MAX_COLS);
    expect(suppressions).toEqual([]);
  });

  it("respects an explicit de-densify dial", () => {
    const { options } = applyRcllToggleGuards({
      deDensify: true,
      deDensifyMaxCols: 5,
    });
    expect(options.deDensifyMaxCols).toBe(5);
  });

  it("does not add a dial when de-densify is off", () => {
    const { options } = applyRcllToggleGuards({ deDensify: false });
    expect(options.deDensifyMaxCols).toBeUndefined();
  });

  it("is a no-op (byte-identical) when no guard fires", () => {
    const input = {
      compact: true,
      swimlaneLaneRise: true,
      rankSeparate: true,
      straighten: true,
      subnetDeBand: false,
    };
    const { options, suppressions } = applyRcllToggleGuards(input);
    expect(options).toEqual(input);
    expect(suppressions).toEqual([]);
  });

  it("does not mutate the input object", () => {
    const input = { rankSeparate: true, swimlaneLaneRise: false };
    applyRcllToggleGuards(input);
    expect(input).toEqual({ rankSeparate: true, swimlaneLaneRise: false });
  });

  it("resolves a column-packing conflict: Compact wins, Spread dropped, observable", () => {
    const { options, suppressions } = applyRcllToggleGuards({
      deDensify: true,
      columnCompact: true,
    });
    expect(options.deDensify).toBe(false);
    expect(options.columnCompact).toBe(true);
    expect(suppressions).toEqual(["column-packing-conflict-compact-wins"]);
  });

  it("leaves a lone columnCompact untouched (no spurious conflict)", () => {
    const { options, suppressions } = applyRcllToggleGuards({
      columnCompact: true,
    });
    expect(options.columnCompact).toBe(true);
    expect(options.deDensify ?? false).toBe(false);
    expect(suppressions).toEqual([]);
  });

  it("resolves an ordering conflict: crossingMin wins, leaf reorder dropped, observable", () => {
    const { options, suppressions } = applyRcllToggleGuards({
      reorder: true,
      crossingMin: true,
    });
    expect(options.crossingMin).toBe(true);
    expect(options.reorder).toBe(false);
    expect(suppressions).toEqual(["ordering-conflict-crossing-min-wins"]);
  });

  it("leaves a lone crossingMin (or lone reorder) untouched", () => {
    expect(
      applyRcllToggleGuards({ crossingMin: true }).options.crossingMin,
    ).toBe(true);
    expect(applyRcllToggleGuards({ crossingMin: true }).suppressions).toEqual(
      [],
    );
    expect(applyRcllToggleGuards({ reorder: true }).options.reorder).toBe(true);
    expect(applyRcllToggleGuards({ reorder: true }).suppressions).toEqual([]);
  });

  it("rankSeparate (the dominant height lever) wins over networkSimplexRank; NS is dropped, observable", () => {
    // Supply the lane-rise so rankSeparate is valid. They are mutually-exclusive column
    // strategies and rankSeparate's lane-rise height win dwarfs NS's width win, so NS
    // loses — picking "shorten" on a rankSeparate layout is a safe no-op, not a +149%
    // height regression.
    const { options, suppressions } = applyRcllToggleGuards({
      networkSimplexRank: true,
      rankSeparate: true,
      swimlaneLaneRise: true,
    });
    expect(options.rankSeparate).toBe(true);
    expect(options.networkSimplexRank).toBe(false);
    expect(suppressions).toEqual([
      "rank-floor-conflict-rankseparate-wins-network-simplex",
    ]);
  });

  it("networkSimplexRank wins over deDensify (defensive backstop), observable", () => {
    const { options, suppressions } = applyRcllToggleGuards({
      networkSimplexRank: true,
      deDensify: true,
    });
    expect(options.networkSimplexRank).toBe(true);
    expect(options.deDensify).toBe(false);
    expect(suppressions).toEqual([
      "rank-floor-conflict-network-simplex-wins-dedensify",
    ]);
  });

  it("networkSimplexRank + columnCompact: BOTH retained (the bundle is additive, compact is NOT guarded)", () => {
    const { options, suppressions } = applyRcllToggleGuards({
      networkSimplexRank: true,
      columnCompact: true,
    });
    expect(options.networkSimplexRank).toBe(true);
    expect(options.columnCompact).toBe(true);
    expect(suppressions).toEqual([]);
  });

  it("an INVALID rankSeparate (no lane-rise) does NOT suppress NS — NS gets to run", () => {
    // rankSeparate without the lane-rise is dropped by its own precondition FIRST, so it
    // is no longer a live column-axis owner — NS then survives and applies. (A dropped
    // rankSeparate must never veto NS.)
    const { options, suppressions } = applyRcllToggleGuards({
      networkSimplexRank: true,
      rankSeparate: true,
      swimlaneLaneRise: false,
    });
    expect(options.rankSeparate).toBe(false);
    expect(options.networkSimplexRank).toBe(true);
    expect(suppressions).toEqual(["rankSeparate-needs-rise"]);
  });
});
