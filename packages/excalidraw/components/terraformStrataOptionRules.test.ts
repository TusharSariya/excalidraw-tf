/**
 * Guards for the declarative strata dependency-rule table (c05 §5 / c09 §4).
 *
 *  - RELATION TOTALITY: every option referenced in any relation is a known key,
 *    every conflict winner is one of its pair, and independent pairs never
 *    overlap a declared relation (the internal-consistency form of the c05 N×N
 *    totality guard — drift in any relation row fails here).
 *  - BYTE-IDENTITY AT DEFAULTS: no rule fires on the shipped-default state, so
 *    the table changes nothing for a default import.
 *  - FIXPOINT: evaluation is idempotent (re-running on its own resolved output
 *    is stable) — the c05 "re-run to fixpoint" contract.
 *  - inertUnless matches the empirical effect matrix confirmations.
 */
import { describe, expect, it } from "vitest";

import { TERRAFORM_STRATA_LAYOUT_DEFAULTS } from "./terraformStrataDefaults";
import {
  STRATA_CONFLICTS,
  STRATA_IMPLICATIONS,
  STRATA_INDEPENDENT_PAIRS,
  STRATA_INERT_UNLESS,
  STRATA_RULE_OPTION_KEYS,
  STRATA_VALUE_CONFLICTS,
  evaluateStrataRules,
  strataOptionIsInert,
  type StrataOptionState,
  type StrataRuleOptionKey,
} from "./terraformStrataOptionRules";

const KNOWN = new Set<string>(STRATA_RULE_OPTION_KEYS);

describe("strata dependency-rule table (c05)", () => {
  it("relation totality: every referenced option is a known key and winners are valid", () => {
    for (const c of STRATA_CONFLICTS) {
      expect(KNOWN.has(c.a), `unknown conflict key ${c.a}`).toBe(true);
      expect(KNOWN.has(c.b), `unknown conflict key ${c.b}`).toBe(true);
      expect([c.a, c.b]).toContain(c.winner);
    }
    for (const c of STRATA_VALUE_CONFLICTS) {
      expect(KNOWN.has(c.a) && KNOWN.has(c.b)).toBe(true);
      expect([c.a, c.b]).toContain(c.winner);
    }
    for (const im of STRATA_IMPLICATIONS) {
      expect(KNOWN.has(im.when) && KNOWN.has(im.implies)).toBe(true);
    }
    for (const key of Object.keys(STRATA_INERT_UNLESS)) {
      expect(KNOWN.has(key), `unknown inertUnless key ${key}`).toBe(true);
    }
  });

  it("independent pairs are known keys and never overlap a declared hard relation", () => {
    const hardPairs = new Set(
      [...STRATA_CONFLICTS, ...STRATA_VALUE_CONFLICTS].map((c) =>
        [c.a, c.b].sort().join("|"),
      ),
    );
    for (const [a, b] of STRATA_INDEPENDENT_PAIRS) {
      expect(KNOWN.has(a) && KNOWN.has(b)).toBe(true);
      expect(a).not.toBe(b);
      expect(hardPairs.has([a, b].sort().join("|"))).toBe(false);
    }
  });

  it("no CONFLICT rule fires on the shipped default state (rankSeparate OFF)", () => {
    // owner-decisions.md 2026-07-17: the new default enables packedScoring+sift+
    // transpose and keeps rankSeparate OFF, so the rankSeparate × packedScoring
    // mutual exclusion (and the NS × rankSeparate one) never fire — the table
    // suppresses nothing and emits no echo/warning for a default import.
    const defaultState: StrataOptionState = {
      ...(TERRAFORM_STRATA_LAYOUT_DEFAULTS as unknown as StrataOptionState),
    };
    const { suppressed, warnings, echoes } = evaluateStrataRules(defaultState);
    expect([...suppressed]).toEqual([]);
    expect(warnings).toEqual([]);
    expect(echoes).toEqual([]);
    // Under the new default, the relocate-family consumers (packedScoring, sift,
    // transpose) are ON, so ε / crossing-weights / edge-cap / converge read
    // ACTIVE, while the flags whose consumers stay off read inert.
    for (const key of [
      "strataPackedScoringEpsilon",
      "strataCrossWeightPenetration",
      "strataCrossWeightEdge",
      "strataEdgeCrossCap",
      "strataPackedConverge",
      "strataTransitiveAdopt",
    ] as StrataRuleOptionKey[]) {
      expect(
        strataOptionIsInert(key, defaultState),
        `${key} should be ACTIVE under the new default`,
      ).toBe(false);
    }
    for (const key of [
      "strataJointNsRank",
      "strataHeightGate",
    ] as StrataRuleOptionKey[]) {
      expect(
        strataOptionIsInert(key, defaultState),
        `${key} should be inert under the new default`,
      ).toBe(true);
    }
  });

  it("NS-rank × rankSeparate: rankSeparate wins, echo emitted (coded engine rule)", () => {
    const { suppressed, echoes } = evaluateStrataRules({
      strataNetworkSimplexRank: true,
      strataRankSeparate: true,
    });
    expect(suppressed.has("strataNetworkSimplexRank")).toBe(true);
    expect(echoes.some((e) => e.startsWith("rank-floor-conflict"))).toBe(true);
  });

  it("NS-rank × jointNsRank WITHOUT rankSeparate: NS stays ACTIVE (no phantom conflict)", () => {
    // C19 regression pin (invalid-ns-joint-conflict): the engine
    // (terraformPipelineStrata.ts:339-343) suppresses NS ONLY when rankSeparate
    // is also set. jointNsRank is an inert probe here and must NOT suppress the
    // live NS ranker — the removed derived conflict would have wrongly done so.
    const { suppressed, echoes } = evaluateStrataRules({
      strataNetworkSimplexRank: true,
      strataJointNsRank: true,
      strataRankSeparate: false,
    });
    expect(suppressed.has("strataNetworkSimplexRank")).toBe(false);
    expect(echoes.some((e) => e.startsWith("ns-joint-conflict"))).toBe(false);
    // And jointNsRank itself is inert without rankSeparate.
    expect(
      strataOptionIsInert("strataJointNsRank", {
        strataNetworkSimplexRank: true,
        strataJointNsRank: true,
      }),
    ).toBe(true);
  });

  it("inertUnless mirrors the engine gates for leaf-shift and transitive-adopt (c19 divergence fix)", () => {
    // ε rides under leafShift (terraformPipelineStrata.ts:532-536).
    expect(
      strataOptionIsInert("strataPackedScoringEpsilon", {
        strataLeafShift: true,
      }),
    ).toBe(false);
    // penW / crossW / edgeCrossCap ride under leafShift AND under transitiveAdopt
    // (terraformPipelineStrata.ts:570-580).
    for (const key of [
      "strataCrossWeightPenetration",
      "strataCrossWeightEdge",
      "strataEdgeCrossCap",
    ] as StrataRuleOptionKey[]) {
      expect(
        strataOptionIsInert(key, { strataLeafShift: true }),
        `${key} must be active under leafShift`,
      ).toBe(false);
      expect(
        strataOptionIsInert(key, { strataTransitiveAdopt: true }),
        `${key} must be active under transitiveAdopt`,
      ).toBe(false);
    }
    // ε is NOT gated on transitiveAdopt (transitiveAdopt is absent from the ε
    // engine gate) — guards against over-broadening the predicate.
    expect(
      strataOptionIsInert("strataPackedScoringEpsilon", {
        strataTransitiveAdopt: true,
      }),
    ).toBe(true);
  });

  it("rankSeparate × packedScoring is a HARD exclusion: packedScoring wins, rankSeparate suppressed (owner 2026-07-17)", () => {
    const { suppressed, warnings, echoes } = evaluateStrataRules({
      strataRankSeparate: true,
      strataPackedScoring: true,
    });
    expect(suppressed.has("strataRankSeparate")).toBe(true);
    expect(suppressed.has("strataPackedScoring")).toBe(false);
    expect(warnings).toEqual([]);
    expect(
      echoes.some((e) =>
        e.startsWith(
          "rankseparate-packedscoring-conflict-packedscoring-wins-rankseparate",
        ),
      ),
    ).toBe(true);
  });

  it("evaluation is idempotent (fixpoint): resolving the losers and re-running is stable", () => {
    const state: StrataOptionState = {
      strataNetworkSimplexRank: true,
      strataRankSeparate: true,
      strataJointNsRank: true,
    };
    const first = evaluateStrataRules(state);
    const resolved: StrataOptionState = { ...state };
    for (const loser of first.suppressed) {
      resolved[loser] = false;
    }
    const second = evaluateStrataRules(resolved);
    // No NEW suppressions appear once the first round's losers are off.
    for (const k of second.suppressed) {
      expect(first.suppressed.has(k)).toBe(true);
    }
  });

  it("inertUnless matches the effect matrix: converge inert at ε=0 even with packedScoring on", () => {
    // effect-matrix.md: strataPackedConverge is byte-identical (NO-EFFECT) at
    // ε=0, and even at ε=1 with packedScoring on (audit config). The predicate
    // requires packedScoring AND ε≠0 AND ¬transitiveAdopt.
    expect(
      strataOptionIsInert("strataPackedConverge", {
        strataPackedScoring: true,
        strataPackedScoringEpsilon: 0,
      }),
    ).toBe(true);
    expect(
      strataOptionIsInert("strataPackedConverge", {
        strataPackedScoring: true,
        strataPackedScoringEpsilon: 1,
        strataTransitiveAdopt: true,
      }),
    ).toBe(true);
    // Active only under the full predicate.
    expect(
      strataOptionIsInert("strataPackedConverge", {
        strataPackedScoring: true,
        strataPackedScoringEpsilon: 1,
        strataTransitiveAdopt: false,
      }),
    ).toBe(false);
  });

  it("inertUnless matches the effect matrix: heightGate inert unless blockClamp on", () => {
    // effect-matrix.md: heightGate NO-EFFECT alone AND inside the audit config
    // (its only consumer is blockClamp).
    expect(strataOptionIsInert("strataHeightGate", {})).toBe(true);
    expect(
      strataOptionIsInert("strataHeightGate", { strataBlockClamp: true }),
    ).toBe(false);
  });
});
