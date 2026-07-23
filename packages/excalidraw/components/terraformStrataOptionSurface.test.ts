/**
 * W0-I4 OPTION-SURFACE REGRESSION.
 *
 * Two freezes the existing `terraformDemoUrlParams` / `terraformCanvasShareUrl`
 * suites leave thin:
 *
 *  1. A FULL-surface parse→serialize→parse fixpoint over EVERY user-visible
 *     strata URL param at once (the existing "round-trips strata view + engine
 *     flags" test omits edgeRouting / borderRoute / deBandLevel / sift / penW /
 *     crossW / edgeCap / transpose / heightGate), plus every documented alias.
 *
 *  2. A THREADING TRIPWIRE: each strata layout option must still be forwarded
 *     by `layoutTerraformFromSources` (the sceneContext + builderOptions +
 *     direct-option seams in terraformLayoutCore.ts). A new option silently
 *     dropped there LOOKS wired in the dialog but does nothing on the real app
 *     path (memory: "RCLL option threading boundary"). The per-flag end-to-end
 *     threading tests (terraformLayoutCoreStrataThreading.test.ts) are the
 *     behavioral proof; this is the cheap structural backstop that fires the
 *     instant a forward is removed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildTerraformDemoUrl,
  parseTerraformDemoUrlParams,
  type TerraformDemoUrlParams,
} from "./terraformDemoUrlParams";

const queryOf = (url: string): string => url.slice(url.indexOf("?"));
const roundTrip = (p: TerraformDemoUrlParams) =>
  parseTerraformDemoUrlParams(queryOf(buildTerraformDemoUrl(p)));

describe("strata option-surface regression (W0-I4)", () => {
  it("full strata URL surface round-trips (every param, non-default) as a fixpoint", () => {
    const full: TerraformDemoUrlParams = {
      presetId: "staging-extended-localstack-v2",
      view: "strata",
      compact: false,
      ancillary: true,
      privateApiRegional: true,
      strataNsRank: true,
      strataSweeps: 4,
      strataCoordRefine: true,
      strataRankSeparate: true,
      strataPackedScoring: true,
      strataPackedEps: 2,
      strataBandCompact: true,
      strataBandDepth: "root",
      strataDeBandLevel: "vpc",
      strataSift: true,
      strataPenW: 3,
      strataCrossW: 2,
      strataEdgeCap: 5,
      strataPackedConverge: true,
      strataTransitiveAdopt: true,
      strataBlockClamp: true,
      strataTranspose: true,
      strataHeightGate: true,
      strataLeafShift: true,
      strataBoxEndpoints: true,
      strataChainRelocate: true,
      strataCoordCascade: true,
    };
    expect(roundTrip(full)).toEqual(full);
  });

  it("relative-mode packed epsilon (0<eps<1) survives round-trip", () => {
    const p: TerraformDemoUrlParams = {
      presetId: "demo",
      view: "strata",
      strataSweeps: 4,
      strataPackedEps: 0.25,
    };
    expect(roundTrip(p)).toEqual(p);
  });

  it("every strataBandDepth cut round-trips (incl. mixed-case subnetZone)", () => {
    for (const cut of [
      "root",
      "provider",
      "account",
      "region",
      "vpc",
      "subnetZone",
    ] as const) {
      const p: TerraformDemoUrlParams = {
        presetId: "demo",
        view: "strata",
        strataBandDepth: cut,
      };
      expect(roundTrip(p)).toEqual(p);
    }
  });

  it("every strataDeBand rung round-trips", () => {
    for (const lvl of [
      "none",
      "subnet",
      "vpc",
      "region",
      "account",
      "provider",
    ] as const) {
      const p: TerraformDemoUrlParams = {
        presetId: "demo",
        view: "strata",
        strataDeBandLevel: lvl,
      };
      expect(roundTrip(p)).toEqual(p);
    }
  });

  it("RCLL aliases round-trip to their canonical fields (laneRise/laneSplit/cycleRise)", () => {
    // The builder emits the canonical param name; the parser accepts the alias.
    // Assert the ALIAS URL parses to the same field the canonical URL does.
    const canonical = parseTerraformDemoUrlParams(
      "?preset=demo&swimlaneRise=1&rankSeparate=1&staircaseBandOverlap=0",
    );
    const aliased = parseTerraformDemoUrlParams(
      "?preset=demo&laneRise=1&laneSplit=1&cycleRise=0",
    );
    expect(aliased).toEqual(canonical);
    expect(aliased?.swimlaneRise).toBe(true);
    expect(aliased?.rankSeparate).toBe(true);
    expect(aliased?.staircaseBandOverlap).toBe(false);
  });

  it("S5-6: strataRankSeparate full-name spelling aliases to the abbreviation", () => {
    // The owner's nightly URL uses `strataRankSep`; archived rcll URLs use the
    // full name. Both must resolve to the same field, abbreviation-first.
    const abbrev = parseTerraformDemoUrlParams(
      "?preset=demo&view=strata&strataRankSep=1",
    );
    const full = parseTerraformDemoUrlParams(
      "?preset=demo&view=strata&strataRankSeparate=1",
    );
    expect(full?.strataRankSeparate).toBe(true);
    expect(full).toEqual(abbrev);
    // Abbreviation wins when both present (frozen precedence).
    const both = parseTerraformDemoUrlParams(
      "?preset=demo&view=strata&strataRankSep=0&strataRankSeparate=1",
    );
    expect(both?.strataRankSeparate).toBe(false);
  });

  it("S3-7: strataBandDepth parses case-insensitively and canonicalizes", () => {
    for (const [raw, canonical] of [
      ["subnetzone", "subnetZone"],
      ["SubnetZone", "subnetZone"],
      ["ROOT", "root"],
      ["Vpc", "vpc"],
    ] as const) {
      const parsed = parseTerraformDemoUrlParams(
        `?preset=demo&view=strata&strataBandDepth=${raw}`,
      );
      expect(parsed?.strataBandDepth).toBe(canonical);
    }
    // Genuinely invalid cuts still hard-fail the whole URL.
    expect(
      parseTerraformDemoUrlParams("?preset=demo&strataBandDepth=zone"),
    ).toBeNull();
  });

  it("legacy subnetDeBand=1 aliases to deBandLevel=subnet", () => {
    const parsed = parseTerraformDemoUrlParams("?preset=demo&subnetDeBand=1");
    expect(parsed?.deBandLevel).toBe("subnet");
  });

  it("an invalid value in any strata param hard-fails the whole URL (no silent drop)", () => {
    expect(
      parseTerraformDemoUrlParams("?preset=demo&strataBandDepth=bogus"),
    ).toBeNull();
    expect(
      parseTerraformDemoUrlParams("?preset=demo&strataDeBand=bogus"),
    ).toBeNull();
    expect(
      parseTerraformDemoUrlParams("?preset=demo&strataSweeps=-1"),
    ).toBeNull();
    expect(
      parseTerraformDemoUrlParams("?preset=demo&strataPackedScoring=maybe"),
    ).toBeNull();
    // Absolute-mode epsilon must be integer.
    expect(
      parseTerraformDemoUrlParams("?preset=demo&strataPackedEps=1.5"),
    ).toBeNull();
  });

  it("threading tripwire: every strata layout option survives BOTH forwarding seams of layoutTerraformFromSources", () => {
    // A strata option reaches the engine only if it survives TWO independent
    // silent-drop points in terraformLayoutCore.ts, and checking only one is a
    // false backstop (memory: "RCLL option threading boundary"):
    //
    //  SEAM 1 — the sceneContext literal (`options?.strataXxx`): reads the raw
    //           option off the caller's `options` bag into the ctx.
    //  SEAM 2 — the builderOptions fan-in (`ctx.strataXxx`): passes that ctx
    //           value on to the packed builder. This object is a `const`
    //           precisely to defeat TS's excess-property check, so a key present
    //           in seam 1 but MISSING here compiles green and is silently lost.
    //
    // A key present in only one seam is exactly the failure this must catch, so
    // every REQUIRED option must appear in BOTH match sets.
    const src = readFileSync(join(__dirname, "terraformLayoutCore.ts"), "utf8");
    const seam1 = new Set(
      [...src.matchAll(/options\?\.(strata[A-Za-z0-9]+)/g)].map((m) => m[1]!),
    );
    const seam2 = new Set(
      [...src.matchAll(/ctx\.(strata[A-Za-z0-9]+)/g)].map((m) => m[1]!),
    );
    // The strata layout options that MUST survive the seam. Adding a new strata
    // option? Add it here in the same change that forwards it — that is the
    // point of this tripwire.
    const REQUIRED: readonly string[] = [
      "strataNetworkSimplexRank",
      "strataRankSeparate",
      "strataSweeps",
      "strataCoordinateRefine",
      "strataPackedScoring",
      "strataPackedScoringEpsilon",
      "strataBandCompact",
      "strataBandDepth",
      "strataDeBandLevel",
      "strataSiftRelocate",
      "strataCrossWeightPenetration",
      "strataCrossWeightEdge",
      "strataEdgeCrossCap",
      "strataPackedConverge",
      "strataTransitiveAdopt",
      "strataBlockClamp",
      "strataTranspose",
      "strataHeightGate",
      "strataLeafShift",
      "strataBoxEndpoints",
      "strataChainRelocate",
      "strataCoordCascade",
    ];
    const missingSeam1 = REQUIRED.filter((k) => !seam1.has(k));
    const missingSeam2 = REQUIRED.filter((k) => !seam2.has(k));
    expect(
      missingSeam1,
      `strata options no longer read into the sceneContext (seam 1): ${missingSeam1.join(
        ", ",
      )}`,
    ).toEqual([]);
    expect(
      missingSeam2,
      `strata options no longer forwarded to the builder (seam 2): ${missingSeam2.join(
        ", ",
      )}`,
    ).toEqual([]);
  });
});
