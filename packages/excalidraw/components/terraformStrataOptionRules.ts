/**
 * Declarative strata option dependency-rule table (Track C, c05 / c09 §4).
 *
 * ONE pure module — no layout imports, plain string keys only (same discipline
 * as `terraformStrataDefaults.ts`) — that captures the option-to-option
 * relations the strata engine and dialog currently encode ad-hoc in scattered
 * pairwise `if` blocks. It is the single source the panel, the demo-URL
 * resolver, the dependency-cruiser-clean proof API, and (eventually) the engine
 * guard block all read, so a relation can never be stated in one place and
 * contradicted in another.
 *
 * This module is intentionally NON-mutating and side-effect free:
 *
 *  - `conflictsWith` / `impliedBy` are hard relations with a declared winner.
 *  - `inertUnless` is an ANNOTATION only — it marks an option read-only-inert
 *    unless its predicate holds. It NEVER rewrites the option's value: the
 *    explicit-OFF share-URL invariant (c05 §4) depends on an inert option still
 *    threading its literal value and still emitting its both-states share key.
 *
 * The engine rewire (making `terraformPipelineStrata.ts` consume this table
 * instead of its inline guards) is a follow-up — this ships the table + its
 * totality/fixpoint guards additively, changing no behavior today.
 */

/** Every strata engine option key the rule table reasons about. Mirrors the
 * option-name domain of `resolveStrataDemoOptions` (not the URL param names). */
export const STRATA_RULE_OPTION_KEYS = [
  "strataNetworkSimplexRank",
  "strataRankSeparate",
  "strataSweeps",
  "strataCoordinateRefine",
  "strataPackedScoring",
  "strataPackedScoringEpsilon",
  "strataEdgeRouting",
  "strataBorderRoute",
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
  "strataJointNsRank",
] as const;

export type StrataRuleOptionKey = (typeof STRATA_RULE_OPTION_KEYS)[number];

/** A read-only snapshot of the option values a rule predicate evaluates against.
 * Booleans/numbers/strings; absent = the caller's opt-out (engine `?? 0` /
 * `=== true` contract), never a view default. */
export type StrataOptionState = Partial<
  Record<StrataRuleOptionKey, boolean | number | string>
>;

const truthy = (v: boolean | number | string | undefined): boolean =>
  v === true || (typeof v === "number" && v !== 0);

// ─── Hard relations coded in the engine today (c09 §4, "move verbatim") ───

/** Mutual-exclusion relations. `winner` is the option that survives when both
 * are set; the loser is suppressed with an echo (never silently). */
export const STRATA_CONFLICTS: ReadonlyArray<{
  a: StrataRuleOptionKey;
  b: StrataRuleOptionKey;
  winner: StrataRuleOptionKey;
  echo: string;
  /** Encodes a KNOWN-uncoded relation (c09 §4) that must WARN, not exclude. */
  warnOnly?: boolean;
}> = [
  {
    a: "strataNetworkSimplexRank",
    b: "strataRankSeparate",
    winner: "strataRankSeparate",
    echo: "rank-floor-conflict",
  },
  {
    // Derivable-by-transitivity once the table exists (c09 §4): jointNsRank is
    // inert unless rankSeparate, and NS-rank conflicts with rankSeparate, so
    // NS-rank and jointNsRank cannot both meaningfully act.
    a: "strataNetworkSimplexRank",
    b: "strataJointNsRank",
    winner: "strataJointNsRank",
    echo: "ns-joint-conflict",
  },
  {
    // W8/SDEC-64: NO coded exclusion exists (grep-confirmed). Encode as a
    // declarative WARN, not an exclusion — the combo improves both p50 medians;
    // only the p90 tail regresses. Winner is UNDECIDED (owner adjudicates).
    a: "strataRankSeparate",
    b: "strataPackedScoring",
    winner: "strataRankSeparate",
    echo: "rankSep-packedScoring-prefer-one",
    warnOnly: true,
  },
];

/** Value-conflict: bandDepth wins over a deBand level that is infeasible under
 * the chosen cut. Predicate deferred to the engine's `strataDeBandFeasible`
 * (not reimplemented here); the table only records the winner + provenance. */
export const STRATA_VALUE_CONFLICTS: ReadonlyArray<{
  a: StrataRuleOptionKey;
  b: StrataRuleOptionKey;
  winner: StrataRuleOptionKey;
  note: string;
}> = [
  {
    a: "strataDeBandLevel",
    b: "strataBandDepth",
    winner: "strataBandDepth",
    note: "bandDepth wins when !strataDeBandFeasible(level, depth)",
  },
];

/** Non-suppressing alias implications: setting the alias implies a value on the
 * canonical option ONLY when the canonical is absent. */
export const STRATA_IMPLICATIONS: ReadonlyArray<{
  when: StrataRuleOptionKey;
  implies: StrataRuleOptionKey;
  value: string;
  note: string;
}> = [
  {
    when: "strataBandCompact",
    implies: "strataBandDepth",
    value: "root",
    note: "legacy strataBandCompact===true ⇒ bandDepth 'root' when bandDepth absent",
  },
];

/**
 * `inertUnless` predicates (c09 §4). An option keyed here has no geometric
 * effect unless its predicate holds — the empirical effect matrix
 * (effect-matrix.md) CONFIRMED every one of these as zero-delta when the
 * predicate is false. A read-only annotation: the value still threads, the
 * share key still emits.
 */
export const STRATA_INERT_UNLESS: Readonly<
  Record<string, (s: StrataOptionState) => boolean>
> = {
  strataJointNsRank: (s) => truthy(s.strataRankSeparate),
  strataPackedScoringEpsilon: (s) =>
    truthy(s.strataPackedScoring) ||
    truthy(s.strataSiftRelocate) ||
    truthy(s.strataBlockClamp) ||
    truthy(s.strataTranspose),
  strataPackedConverge: (s) =>
    truthy(s.strataPackedScoring) &&
    truthy(s.strataPackedScoringEpsilon) &&
    !truthy(s.strataTransitiveAdopt),
  strataCrossWeightPenetration: (s) =>
    truthy(s.strataSiftRelocate) ||
    truthy(s.strataBlockClamp) ||
    truthy(s.strataTranspose),
  strataCrossWeightEdge: (s) =>
    truthy(s.strataSiftRelocate) ||
    truthy(s.strataBlockClamp) ||
    truthy(s.strataTranspose),
  strataEdgeCrossCap: (s) =>
    truthy(s.strataSiftRelocate) ||
    truthy(s.strataBlockClamp) ||
    truthy(s.strataTranspose),
  strataHeightGate: (s) => truthy(s.strataBlockClamp),
  strataTransitiveAdopt: (s) =>
    truthy(s.strataPackedScoring) ||
    truthy(s.strataSiftRelocate) ||
    truthy(s.strataBlockClamp) ||
    truthy(s.strataTranspose),
} as const;

/**
 * Option pairs asserted to be genuinely INDEPENDENT (no relation) — declared
 * explicitly so the totality guard (every pair is classified or explicitly
 * independent) has something to check against. Each entry is an unordered pair.
 */
export const STRATA_INDEPENDENT_PAIRS: ReadonlyArray<
  [StrataRuleOptionKey, StrataRuleOptionKey]
> = [
  ["strataSweeps", "strataCoordinateRefine"],
  ["strataEdgeRouting", "strataBorderRoute"],
  // NOTE: bandDepth × deBandLevel is NOT independent — it is a declared
  // value-conflict (STRATA_VALUE_CONFLICTS), so it is deliberately absent here.
];

/** Is `key` currently inert under `state` per the table? (Read-only.) */
export const strataOptionIsInert = (
  key: StrataRuleOptionKey,
  state: StrataOptionState,
): boolean => {
  const predicate = STRATA_INERT_UNLESS[key];
  return predicate ? !predicate(state) : false;
};

/**
 * Evaluate the hard relations to a fixpoint over a state, returning the set of
 * options the table suppresses (the LOSERS of active conflicts) plus the echo
 * codes. Pure: it does NOT mutate `state`. `warnOnly` conflicts never suppress
 * — they only surface a warning code. Idempotent (running it on its own output
 * changes nothing), which the guard test asserts.
 */
export const evaluateStrataRules = (
  state: StrataOptionState,
): {
  suppressed: ReadonlySet<StrataRuleOptionKey>;
  warnings: readonly string[];
  echoes: readonly string[];
} => {
  const suppressed = new Set<StrataRuleOptionKey>();
  const warnings: string[] = [];
  const echoes: string[] = [];
  for (const c of STRATA_CONFLICTS) {
    if (truthy(state[c.a]) && truthy(state[c.b])) {
      if (c.warnOnly) {
        warnings.push(c.echo);
        continue;
      }
      const loser = c.winner === c.a ? c.b : c.a;
      suppressed.add(loser);
      echoes.push(`${c.echo}:${loser}`);
    }
  }
  return { suppressed, warnings, echoes };
};
