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

  it("byte-identity at defaults: no rule fires on the shipped default state", () => {
    const defaultState: StrataOptionState = {
      ...(TERRAFORM_STRATA_LAYOUT_DEFAULTS as unknown as StrataOptionState),
    };
    const { suppressed, warnings, echoes } = evaluateStrataRules(defaultState);
    expect([...suppressed]).toEqual([]);
    expect(warnings).toEqual([]);
    expect(echoes).toEqual([]);
    // Every default-off consumer means every inertUnless option reads inert.
    for (const key of Object.keys(
      STRATA_INERT_UNLESS,
    ) as StrataRuleOptionKey[]) {
      expect(strataOptionIsInert(key, defaultState)).toBe(true);
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

  it("rankSeparate × packedScoring is WARN-only, never suppressed (W8/SDEC-64 undecided)", () => {
    const { suppressed, warnings } = evaluateStrataRules({
      strataRankSeparate: true,
      strataPackedScoring: true,
    });
    expect(suppressed.has("strataPackedScoring")).toBe(false);
    expect(suppressed.has("strataRankSeparate")).toBe(false);
    expect(warnings).toContain("rankSep-packedScoring-prefer-one");
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
