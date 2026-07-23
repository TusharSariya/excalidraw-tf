/**
 * CANONICAL-URL PIN + ARCHIVED-URL CORPUS (Track C, c08 guard checklist 1–3).
 *
 * The reversibility contract for the whole option-surface simplification is:
 * every historical `/demo?…` URL — the owner's nightly audit query and every
 * archived alias/enum spelling — must resolve to the SAME engine options after
 * any rename / hide / merge / alias-fold as before it. These pins anchor that
 * contract at the parse + resolve layer (the exact blast radius of the Track C
 * parser/registry/defaults changes).
 *
 * Geometry-hash pinning of the same URLs lives in the separate (slow) strata
 * geometry-regression harness — running the layout engine here would make this
 * a multi-second integration test.
 *
 * COVERING ARGUMENT (scoped 2026-07-17). For PARSER changes (Track C:
 * rename/hide/merge/alias-fold) a resolution-level pin fully covers geometry: if
 * the resolved option bag is byte-identical, the engine sees the same input and
 * the geometry is too. That implication holds ONLY while no ENGINE-level
 * disposition reinterprets the bag. The owner's 2026-07-17 rankSeparate ×
 * packedScoring HARD mutual exclusion (owner-decisions.md line 12; packedScoring
 * wins) is exactly such an engine-level reinterpretation: the canonical audit
 * query sets BOTH strataRankSep=1 and strataPackedScoring=1, so its resolved bag
 * stays byte-identical (resolve does NOT apply the exclusion) but its GEOMETRY
 * now differs — the engine suppresses rankSeparate. That is an intended,
 * owner-adjudicated change (line 12 exclusion + line 14 "re-freeze the
 * measurement config at the new default"). The audit query is kept verbatim as a
 * historical parse/resolve fixture.
 *
 * WHAT IS AND IS NOT PINNED (honest status, 2026-07-17). The RESOLVE BAG for this
 * audit query IS pinned byte-identical here (the parse/resolve test below). The
 * audit-config GEOMETRY is NOT hash-pinned in any running harness: the only cell
 * the quick geometry-regression harness pins is the cheap `strata-default` cell;
 * the audit-config cells (audit-minus-deband / audit-with-deband-vpc) live in the
 * EXCLUDED slow `*.probe.test.ts` and are deliberately left un-hashed. This audit
 * config collapses NONDETERMINISTICALLY headless (the edge-collapse finding —
 * scratchpad/overnight-20260717/logs/collapse-rootcause.md), so a geometry hash
 * for it would be flaky; we do NOT force one. The `evaluateStrataRules`
 * adjudication test below instead makes the rankSeparate suppression explicit and
 * testable here WITHOUT running the engine — that is the load-bearing pin for the
 * owner-adjudicated behavior change, not a geometry hash.
 */
import { describe, expect, it } from "vitest";

import { resolveStrataDemoOptions } from "./terraformStrataDefaults";
import { parseTerraformDemoUrlParams } from "./terraformDemoUrlParams";
import { evaluateStrataRules } from "./terraformStrataOptionRules";

/** The owner's nightly audit query (the effect-matrix P2-audit config), verbatim. */
const CANONICAL_AUDIT_QUERY =
  "?preset=staging-extended-localstack-v2&view=strata&compact=0&ancillary=1" +
  "&privateApiRegional=1&strataSweeps=4&strataCoordRefine=1&strataRankSep=1" +
  "&strataPackedScoring=1&strataPackedEps=1&strataBandDepth=root&strataDeBand=vpc" +
  "&strataSift=1&strataPackedConverge=1&strataTransitiveAdopt=1&strataBlockClamp=1" +
  "&strataTranspose=1&strataHeightGate=1&lodEnabled=1&lodPreset=balanced&minimap=0" +
  "&layers=declared";

describe("canonical audit URL pin (c08 guard 1)", () => {
  const parsed = parseTerraformDemoUrlParams(CANONICAL_AUDIT_QUERY);

  it("parses non-null with the owner's full audit param set", () => {
    expect(parsed).not.toBeNull();
    expect(parsed?.presetId).toBe("staging-extended-localstack-v2");
    expect(parsed?.view).toBe("strata");
  });

  it("resolves to the EXACT engine option bag (frozen — update only with a disposition cite)", () => {
    // If a Track C rename/hide/merge/alias change alters ANY value here, this
    // fails loudly: that is the canonical-URL reversibility trap the plan
    // forbids (c08 §0). Adding a genuinely-new engine option is the only
    // legitimate reason to touch this literal.
    expect(resolveStrataDemoOptions(parsed!)).toEqual({
      strataNetworkSimplexRank: false,
      strataSweeps: 4,
      strataCoordinateRefine: true,
      strataRankSeparate: true,
      strataPackedScoring: true,
      strataPackedScoringEpsilon: 1,
      strataBandCompact: false,
      strataBandDepth: "root",
      strataSiftRelocate: true,
      strataPackedConverge: true,
      strataTransitiveAdopt: true,
      strataBlockClamp: true,
      strataTranspose: true,
      strataChainRelocate: false,
      // A7 tie-cascade — genuinely-new engine option (default off; not set by the
      // audit URL, so it resolves false). PROBE-4 addition.
      strataCoordCascade: false,
      strataHeightGate: true,
      strataLeafShift: false,
      // M5 box-endpoint anchoring — genuinely-new engine option (default off;
      // not set by the audit URL, so it resolves false, emitted like every strata
      // boolean). M5 addition.
      strataBoxEndpoints: false,
      strataDeBandLevel: "vpc",
      strataCrossWeightPenetration: 1,
      strataCrossWeightEdge: 1,
    });
  });

  it("adjudicates the engine-level rankSeparate × packedScoring exclusion on the frozen audit config (owner-decisions.md 2026-07-17 line 12; packedScoring wins)", () => {
    // The audit query sets BOTH strataRankSep=1 and strataPackedScoring=1. The
    // resolve bag above keeps both true (parser reversibility is intact — resolve
    // does not apply the exclusion), but the engine now applies the HARD
    // exclusion: packedScoring wins and rankSeparate is suppressed. This is the
    // INTENDED geometry change on the owner's frozen measurement config (line 14
    // "re-freeze at the new default"), pinned to the engine via the
    // dependency-rule table (STRATA_CONFLICTS → terraformPipelineStrata.ts). It
    // is the substance behind the header's scoped covering argument: byte-identical
    // resolve, changed geometry, owner-adjudicated.
    const resolved = resolveStrataDemoOptions(parsed!);
    expect(resolved.strataRankSeparate).toBe(true);
    expect(resolved.strataPackedScoring).toBe(true);
    const { suppressed, echoes } = evaluateStrataRules(resolved);
    expect(suppressed.has("strataRankSeparate")).toBe(true);
    expect(suppressed.has("strataPackedScoring")).toBe(false);
    expect(echoes).toContain(
      "rankseparate-packedscoring-conflict-packedscoring-wins-rankseparate:strataRankSeparate",
    );
  });

  it("carries the strata-only private-API + runtime view settings through parse", () => {
    expect(parsed?.privateApiRegional).toBe(true);
    expect(parsed?.compact).toBe(false);
    expect(parsed?.ancillary).toBe(true);
    expect(parsed?.lodEnabled).toBe(true);
    expect(parsed?.lodPreset).toBe("balanced");
    expect(parsed?.minimap).toBe(false);
    expect(parsed?.edgeLayerPins).toEqual({
      dependency: false,
      dataFlow: false,
      declaredDataFlow: true,
      networking: false,
      topologyFrameFlow: false,
    });
  });
});

describe("archived-URL corpus (c08 guards 2–3): every historical shape still parses", () => {
  // Each row: [label, query, assertions on the parsed result]. Alias spellings,
  // legacy booleans, enum cuts, and case variants that appear in docs/handoffs.
  const CORPUS: ReadonlyArray<{
    label: string;
    query: string;
    check: (
      p: NonNullable<ReturnType<typeof parseTerraformDemoUrlParams>>,
    ) => void;
  }> = [
    {
      label: "rcll aliases laneRise/laneSplit/cycleRise",
      query: "?preset=demo&view=rcll&laneRise=1&laneSplit=1&cycleRise=0",
      check: (p) => {
        expect(p.swimlaneRise).toBe(true);
        expect(p.rankSeparate).toBe(true);
        expect(p.staircaseBandOverlap).toBe(false);
      },
    },
    {
      label: "legacy subnetDeBand → deBandLevel=subnet",
      query: "?preset=demo&view=rcll&subnetDeBand=1",
      check: (p) => expect(p.deBandLevel).toBe("subnet"),
    },
    {
      label: "legacy deDensify → columnPacking=spread",
      query: "?preset=demo&view=rcll&deDensify=1",
      check: (p) => expect(p.columnPacking).toBe("spread"),
    },
    {
      label: "strataRankSep abbreviation (owner nightly)",
      query: "?preset=demo&view=strata&strataRankSep=1",
      check: (p) => expect(p.strataRankSeparate).toBe(true),
    },
    {
      label: "strataRankSeparate full spelling (S5-6, archived rcll)",
      query: "?preset=demo&view=strata&strataRankSeparate=1",
      check: (p) => expect(p.strataRankSeparate).toBe(true),
    },
    {
      label:
        "strataBandCompact legacy boolean (parses; folds to root downstream)",
      query: "?preset=demo&view=strata&strataBandCompact=1",
      check: (p) => expect(p.strataBandCompact).toBe(true),
    },
    {
      label: "strataBandDepth mixed-case subnetZone",
      query: "?preset=demo&view=strata&strataBandDepth=subnetZone",
      check: (p) => expect(p.strataBandDepth).toBe("subnetZone"),
    },
    {
      label: "strataBandDepth case-slip subnetzone (S3-7 canonicalizes)",
      query: "?preset=demo&view=strata&strataBandDepth=subnetzone",
      check: (p) => expect(p.strataBandDepth).toBe("subnetZone"),
    },
    {
      label: "columnPacking=shorten (NS packing bundle)",
      query: "?preset=demo&view=rcll&columnPacking=shorten",
      check: (p) => expect(p.columnPacking).toBe("shorten"),
    },
    {
      label: "rcll named profile",
      query: "?preset=demo&view=rcll&profile=compact",
      check: (p) => expect(p.profile).toBe("compact"),
    },
    {
      label: "relative-mode packed epsilon 0<ε<1",
      query: "?preset=demo&view=strata&strataSweeps=4&strataPackedEps=0.25",
      check: (p) => expect(p.strataPackedEps).toBe(0.25),
    },
  ];

  for (const { label, query, check } of CORPUS) {
    it(`parses: ${label}`, () => {
      const parsed = parseTerraformDemoUrlParams(query);
      expect(parsed, `archived URL failed to parse: ${label}`).not.toBeNull();
      check(parsed!);
    });
  }

  it("legacy strataRankSep and full strataRankSeparate resolve identically", () => {
    const a = parseTerraformDemoUrlParams(
      "?preset=demo&view=strata&strataRankSep=1",
    );
    const b = parseTerraformDemoUrlParams(
      "?preset=demo&view=strata&strataRankSeparate=1",
    );
    expect(resolveStrataDemoOptions(a!)).toEqual(resolveStrataDemoOptions(b!));
  });
});
