/**
 * Strata option registry (Track C, c01 principle 7 / c04 / c09 §2).
 *
 * ONE declarative catalog of every strata-surface option — its URL param name,
 * legacy aliases, resolved option key, default, value kind, UI surface
 * (basic / advanced / hidden / engine-only), and share-URL emission class. It
 * is the single table the panel IA, the parser/alias map, the share-URL
 * emitter, the proof-API `?describe` catalog, and the dependency-rule module
 * all read, so the disposition of an option is stated exactly once.
 *
 * Pure data — no layout imports, plain string literals only (same discipline as
 * `terraformStrataDefaults.ts`). This module ships the catalog + its coverage
 * guards additively; wiring the parser/panel/emitter to CONSUME it (replacing
 * their hand-maintained lists) is the incremental follow-up. It changes no
 * behavior today: the registry only DESCRIBES the surviving surface.
 *
 * Emission class (c03 taxonomy):
 *   C1 = both-states (explicit 1/0 always emitted — default-ON flags)
 *   C2 = truthy-only (emitted only when set — default-OFF flags)
 *   C3 = non-default-only (enum/number emitted only when ≠ default)
 *   C4 = parse-only legacy alias (parser accepts forever; emitter never writes)
 *
 * Surface:
 *   basic       = visible on the primary strata panel
 *   advanced    = behind `advanced=1` disclosure
 *   hidden      = URL/session-threaded, no UI control (parser keeps it forever)
 *   engine-only = never a URL/UI option (harness/internal)
 */

export type StrataOptionSurface =
  | "basic"
  | "advanced"
  | "hidden"
  | "engine-only";
export type StrataOptionEmitClass = "C1" | "C2" | "C3" | "C4";
export type StrataOptionKind = "boolean" | "number" | "enum";

export type StrataOptionRegistryEntry = {
  /** Canonical URL param name the emitter writes (undefined for engine-only). */
  urlParam?: string;
  /** Legacy/alt URL spellings the parser also accepts (never emitted). */
  aliases?: readonly string[];
  /** Resolved engine option key (the `resolveStrataDemoOptions` output name). */
  optionKey: string;
  kind: StrataOptionKind;
  /** Default value (byte-identical baseline). */
  default: boolean | number | string;
  /** Enum domain, when kind === "enum". */
  domain?: readonly string[];
  surface: StrataOptionSurface;
  emitClass: StrataOptionEmitClass;
  /** True when the disposition is decidable now (no effect-matrix / owner gate). */
  decidedNow: boolean;
  note: string;
};

/**
 * The registry. Ordered by the c09 §2 table. `decidedNow: false` marks a row
 * whose FINAL surface awaits the effect matrix or owner sign-off — the entry
 * still records today's shipped default and emission class (which never change
 * without the W5 five-site process), only its `surface` may still move.
 */
export const STRATA_OPTION_REGISTRY: readonly StrataOptionRegistryEntry[] = [
  {
    urlParam: "privateApiRegional",
    optionKey: "pipelinePrivateApiRegional",
    kind: "boolean",
    default: true,
    surface: "advanced",
    emitClass: "C1",
    decidedNow: true,
    note: "S3-1: default-ON, sourced from TERRAFORM_STRATA_LAYOUT_DEFAULTS; non-strata views force false at the import boundary",
  },
  {
    urlParam: "strataRankSep",
    aliases: ["strataRankSeparate"],
    optionKey: "strataRankSeparate",
    kind: "boolean",
    default: false,
    surface: "basic",
    emitClass: "C1",
    decidedNow: false,
    note: "S5-6 full-name alias; 'Compact height' honest-trade axis; default posture is an owner question",
  },
  {
    urlParam: "strataSweeps",
    optionKey: "strataSweeps",
    kind: "number",
    default: 4,
    surface: "hidden",
    emitClass: "C1",
    decidedNow: true,
    note: "M4 Refinement floor; K=0 worst arm; merged with coordRefine, no independent control",
  },
  {
    urlParam: "strataCoordRefine",
    optionKey: "strataCoordinateRefine",
    kind: "boolean",
    default: true,
    surface: "hidden",
    emitClass: "C1",
    decidedNow: true,
    note: "M4 Refinement; validated always-on (A7)",
  },
  {
    urlParam: "strataPackedScoring",
    optionKey: "strataPackedScoring",
    kind: "boolean",
    default: false,
    surface: "advanced",
    emitClass: "C2",
    decidedNow: false,
    note: "M5 packed cluster → advanced; default posture is an owner candidate (W7 waiver)",
  },
  {
    urlParam: "strataPackedEps",
    optionKey: "strataPackedScoringEpsilon",
    kind: "number",
    default: 0,
    surface: "advanced",
    emitClass: "C3",
    decidedNow: false,
    note: "ε stays 0 in every rung until S1-1 lands; nonzero default is an owner adjudication",
  },
  {
    urlParam: "strataEdgeRouting",
    optionKey: "strataEdgeRouting",
    kind: "boolean",
    default: false,
    surface: "advanced",
    emitClass: "C2",
    decidedNow: false,
    note: "M2 'Route edges' with borderRoute; advanced (SDEC-61/62 closed-adverse); flip gated on M2a",
  },
  {
    urlParam: "strataBorderRoute",
    optionKey: "strataBorderRoute",
    kind: "boolean",
    default: false,
    surface: "advanced",
    emitClass: "C2",
    decidedNow: false,
    note: "M2 'Route edges'; composes with edgeRouting; parses independently forever",
  },
  {
    urlParam: "strataBandCompact",
    optionKey: "strataBandCompact",
    kind: "boolean",
    default: false,
    surface: "hidden",
    emitClass: "C4",
    decidedNow: true,
    note: "legacy alias → strataBandDepth='root'; parser + build round-trip kept forever",
  },
  {
    urlParam: "strataBandDepth",
    optionKey: "strataBandDepth",
    kind: "enum",
    default: "account",
    domain: ["root", "provider", "account", "region", "vpc", "subnetZone"],
    surface: "basic",
    emitClass: "C3",
    decidedNow: true,
    note: "W15 band-depth slider; S3-7 case-insensitive parse; default 'account' omitted (never materialized)",
  },
  {
    urlParam: "strataDeBand",
    optionKey: "strataDeBandLevel",
    kind: "enum",
    default: "none",
    domain: ["none", "subnet", "vpc", "region", "account", "provider"],
    surface: "advanced",
    emitClass: "C3",
    decidedNow: false,
    note: "'Dissolve containers'; per-rung help pending matrix; default 'none' omitted",
  },
  {
    urlParam: "strataSift",
    optionKey: "strataSiftRelocate",
    kind: "boolean",
    default: false,
    surface: "hidden",
    emitClass: "C2",
    decidedNow: false,
    note: "OD-15 relocate; Max/Best-rung candidate; ship-vs-tune OPEN (owner)",
  },
  {
    urlParam: "strataPenW",
    optionKey: "strataCrossWeightPenetration",
    kind: "number",
    default: 1,
    surface: "advanced",
    emitClass: "C3",
    decidedNow: false,
    note: "relocate objective weight; inert without a consumer (sift/blockClamp/transpose)",
  },
  {
    urlParam: "strataCrossW",
    optionKey: "strataCrossWeightEdge",
    kind: "number",
    default: 1,
    surface: "advanced",
    emitClass: "C3",
    decidedNow: false,
    note: "relocate objective weight; inert without a consumer",
  },
  {
    urlParam: "strataEdgeCap",
    optionKey: "strataEdgeCrossCap",
    kind: "number",
    default: 0,
    surface: "advanced",
    emitClass: "C3",
    decidedNow: false,
    note: "edge-edge regression cap; no default materialized (inherits ε); BLOCKED on S1-1 before any merge",
  },
  {
    urlParam: "strataPackedConverge",
    optionKey: "strataPackedConverge",
    kind: "boolean",
    default: false,
    surface: "advanced",
    emitClass: "C2",
    decidedNow: false,
    note: "M1 Adoption rule (with transitiveAdopt); matrix confirms inert; removal gated M1a/b/c",
  },
  {
    urlParam: "strataTransitiveAdopt",
    optionKey: "strataTransitiveAdopt",
    kind: "boolean",
    default: false,
    surface: "advanced",
    emitClass: "C2",
    decidedNow: false,
    note: "M1 Adoption rule; always-on gated on M1a/M1b; legacy =0 path deprecation is an owner question",
  },
  {
    urlParam: "strataBlockClamp",
    optionKey: "strataBlockClamp",
    kind: "boolean",
    default: false,
    surface: "advanced",
    emitClass: "C2",
    decidedNow: true,
    note: "KEPT in advanced: A1 changed its behavior post-matrix (snap fix, honest-null on P2); delete-from-UI slot no longer decidable",
  },
  {
    urlParam: "strataTranspose",
    optionKey: "strataTranspose",
    kind: "boolean",
    default: false,
    surface: "advanced",
    emitClass: "C2",
    decidedNow: false,
    note: "THE strong flip candidate (matrix: -24% crossings, envelope-preserving); flip gated T-FLIP + owner; must join C1 on flip",
  },
  {
    urlParam: "strataHeightGate",
    optionKey: "strataHeightGate",
    kind: "boolean",
    default: false,
    surface: "advanced",
    emitClass: "C2",
    decidedNow: true,
    note: "single consumer = blockClamp; measured inert; hidden to advanced (delete-from-UI is matrix cell M3a)",
  },
  {
    urlParam: "strataLeafShift",
    optionKey: "strataLeafShift",
    kind: "boolean",
    default: false,
    surface: "hidden",
    emitClass: "C2",
    decidedNow: false,
    note: "A01 leaf X-shift; research lever, no promotion battery",
  },
  {
    urlParam: "strataNsRank",
    optionKey: "strataNetworkSimplexRank",
    kind: "boolean",
    default: false,
    surface: "advanced",
    emitClass: "C2",
    decidedNow: true,
    note: "NS-rank all forms NO-GO (W5b); mutual exclusion with rankSeparate engine-suppressed with echo",
  },
];

/** Map from any accepted URL param spelling (canonical or alias) → its entry. */
export const strataRegistryByUrlParam = (): ReadonlyMap<
  string,
  StrataOptionRegistryEntry
> => {
  const map = new Map<string, StrataOptionRegistryEntry>();
  for (const entry of STRATA_OPTION_REGISTRY) {
    if (entry.urlParam) {
      map.set(entry.urlParam, entry);
    }
    for (const alias of entry.aliases ?? []) {
      map.set(alias, entry);
    }
  }
  return map;
};
