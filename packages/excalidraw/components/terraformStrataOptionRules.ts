/**
 * Declarative strata option dependency-rule table (Track C, c05 / c09 §4).
 *
 * ONE pure module — no layout imports, plain string keys only (same discipline
 * as `terraformStrataDefaults.ts`) — that captures the option-to-option
 * relations the strata engine and dialog currently encode ad-hoc in scattered
 * pairwise `if` blocks.
 *
 * SCOPE (C19): this is a REVIEWED DESCRIPTION, not yet a wired consumer. No
 * parser, panel, resolver, proof API, or engine guard reads this table today —
 * they still maintain their own inline logic. The module ships additively so the
 * relations can be audited against the engine in one place BEFORE anything is
 * rewired; the intent is that it becomes the single source those sites read, so
 * a relation can never be stated in one place and contradicted in another. Every
 * predicate here is pinned to a specific engine line (cited inline) precisely so
 * the eventual rewire is byte-identical.
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
  "strataEdgeStyle",
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
  // M5 box-endpoint anchoring — no conflict/implication/inertness relations
  // (opt-in, inert until M6); listed here only to keep the key domain in sync
  // with the resolver + registry (the anti-drift guard asserts referenced keys
  // exist).
  "strataBoxEndpoints",
  // E3.3 spacing knobs — always-active (no conflict/implication/inertness), so
  // they carry no relation rows; listed here to keep the key domain in sync with
  // the resolver + registry (the anti-drift guard asserts referenced keys exist).
  "strataColumnGap",
  "strataRowGap",
] as const;

export type StrataRuleOptionKey = typeof STRATA_RULE_OPTION_KEYS[number];

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
    // The ONLY hard NS mutual-exclusion the engine codes
    // (terraformPipelineStrata.ts:339-343): NS is suppressed IFF rankSeparate
    // is also requested. rankSeparate is the dominant height lever and wins.
    a: "strataNetworkSimplexRank",
    b: "strataRankSeparate",
    winner: "strataRankSeparate",
    echo: "rank-floor-conflict",
  },
  // C19 fix (invalid-ns-joint-conflict): there is NO NS ↔ jointNsRank exclusion
  // in the engine. `strataJointNsRank` is a W5b probe that is INERT unless
  // rankSeparate (STRATA_INERT_UNLESS below) and never suppresses the NS ranker.
  // For {NS:true, joint:true, rankSep:false} the engine keeps NS ACTIVE; the
  // old derived-by-transitivity conflict here would instead suppress the live NS
  // ranker in favor of an inert probe — wiring it would change geometry. The
  // real relation (NS × rankSeparate) is the entry above; joint's rankSeparate
  // dependence is captured as inertness, not a pairwise conflict.
  {
    // owner-decisions.md 2026-07-17: the W8/SDEC-64 combo is now a HARD mutual
    // exclusion. The two whole-layout scorers cannot compose; valid states are
    // off/off, on/off, off/on — never on/on. packedScoring is the chosen default
    // and WINS, so rankSeparate is the suppressed loser (echoed, never silent).
    // Engine-pinned to terraformPipelineStrata.ts (the rankSeparate ×
    // packedScoring exclusion block).
    a: "strataRankSeparate",
    b: "strataPackedScoring",
    winner: "strataPackedScoring",
    echo: "rankseparate-packedscoring-conflict-packedscoring-wins-rankseparate",
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
  // ε rides when the packed scorer OR any relocate-family operator that reads
  // ε/cap is on. C19 fix (dependency-table-diverges-from-engine): the A01 leaf
  // X-shift is one such consumer — terraformPipelineStrata.ts:532-536 gates ε on
  // `packedScoring || siftRelocate || blockClamp || transpose || leafShift`.
  strataPackedScoringEpsilon: (s) =>
    truthy(s.strataPackedScoring) ||
    truthy(s.strataSiftRelocate) ||
    truthy(s.strataBlockClamp) ||
    truthy(s.strataTranspose) ||
    truthy(s.strataLeafShift),
  strataPackedConverge: (s) =>
    truthy(s.strataPackedScoring) &&
    truthy(s.strataPackedScoringEpsilon) &&
    !truthy(s.strataTransitiveAdopt),
  // Relocate objective weights + edge-cross cap ride when ANY relocate-family
  // operator is on. C19 fix: the engine gate (terraformPipelineStrata.ts:570-580)
  // is `siftRelocate || blockClamp || transpose || leafShift || transitiveAdopt`
  // — the leaf X-shift AND the transitive-adoption descent both read penW/crossW/
  // cap, so both were missing consumers here.
  strataCrossWeightPenetration: (s) =>
    truthy(s.strataSiftRelocate) ||
    truthy(s.strataBlockClamp) ||
    truthy(s.strataTranspose) ||
    truthy(s.strataLeafShift) ||
    truthy(s.strataTransitiveAdopt),
  strataCrossWeightEdge: (s) =>
    truthy(s.strataSiftRelocate) ||
    truthy(s.strataBlockClamp) ||
    truthy(s.strataTranspose) ||
    truthy(s.strataLeafShift) ||
    truthy(s.strataTransitiveAdopt),
  strataEdgeCrossCap: (s) =>
    truthy(s.strataSiftRelocate) ||
    truthy(s.strataBlockClamp) ||
    truthy(s.strataTranspose) ||
    truthy(s.strataLeafShift) ||
    truthy(s.strataTransitiveAdopt),
  // heightGate's OPTION flag is read at exactly one site
  // (terraformPipelineStrataBlockClamp.ts:714, `options.strataHeightGate ===
  // true`) — inside the block-clamp operator. leafShift uses a height-gate
  // HELPER function unconditionally but never reads the flag, so blockClamp is
  // the sole gate (verified: no other `.strataHeightGate` flag consumer exists).
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
