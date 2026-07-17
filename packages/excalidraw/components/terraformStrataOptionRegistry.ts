/**
 * Strata option registry (Track C, c01 principle 7 / c04 / c09 §2).
 *
 * ONE declarative catalog of every strata-surface option — its URL param name,
 * legacy aliases, resolved option key, default, value kind, UI surface
 * (basic / advanced / hidden / engine-only), and share-URL emission class.
 *
 * SCOPE (C19 + owner-decisions.md 2026-07-17): this is a REVIEWED DESCRIPTION
 * of today's surface, still NOT a wired consumer. Nothing reads this table yet —
 * the parser, the panel IA, the share-URL emitter, the proof-API `?describe`
 * catalog, and the dependency-rule module all still maintain their own hand-kept
 * lists. The panel now DOES implement a basic/advanced disclosure split (the
 * 2026-07-17 declutter: edgeRouting, borderRoute, blockClamp, and heightGate
 * moved into collapsed advanced `<details>` disclosures; packedConverge and
 * transitiveAdopt controls removed entirely), but that split is HAND-CODED in
 * `TerraformStrataSettings.tsx` / `TerraformStrataSettingsHeight.tsx` — it merely
 * AGREES with the `surface` column below, it is not driven by it. So the
 * `surface` column remains METADATA that this table does not itself enforce. The
 * intent is that these sites eventually read this table so an option's
 * disposition is stated exactly once; wiring the panel to consume this column
 * (replacing the hand-maintained static split) is the incremental follow-up.
 *
 * Because it must survive that rewire byte-identically, every row's `default`
 * and `emitClass` are pinned to the LIVE resolver/serializer (the anti-drift
 * test enforces both, and inherited-default rows are represented as such rather
 * than with a fabricated concrete value — see `defaultInherits`).
 *
 * Pure data — no layout imports, plain string literals only (same discipline as
 * `terraformStrataDefaults.ts`). It changes no behavior today: the registry
 * only DESCRIBES the surviving surface.
 *
 * Emission class (c03 taxonomy):
 *   C1 = both-states (explicit 1/0 always emitted — default-ON flags)
 *   C2 = truthy-only (emitted only when set — default-OFF flags)
 *   C3 = non-default-only (enum/number emitted only when ≠ default)
 *   C4 = parse-only legacy alias (parser accepts forever; emitter never writes)
 *
 * Surface:
 *   basic       = visible on the primary (Standard) strata panel surface
 *   advanced    = behind a collapsed advanced `<details>` disclosure in the panel
 *                 (a hand-coded static split today; there is no `advanced=1` URL
 *                 flag — the disclosure is always present, just collapsed)
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
  /**
   * Default value (byte-identical baseline). OMITTED when the option has no
   * materialized default because it INHERITS one at resolve time — see
   * `defaultInherits`. An absent value then differs semantically from an
   * explicit one (e.g. an explicit `0` cap is NOT the same as omission when the
   * inherited ε is nonzero), so a fabricated concrete default would let a
   * registry-driven emitter erase an explicit value. Exactly one of `default`
   * or `defaultInherits` is present on every row.
   */
  default?: boolean | number | string;
  /**
   * Set when this option has NO fixed default: at resolve time it inherits the
   * value of the named option (the engine's absence contract). Mutually
   * exclusive with `default`. The anti-drift test requires such a row to be
   * ABSENT from `TERRAFORM_STRATA_LAYOUT_DEFAULTS` (the resolver must not seed
   * it), so the inheritance is enforced, not merely documented.
   */
  defaultInherits?: string;
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
    surface: "hidden",
    emitClass: "C1",
    decidedNow: true,
    note: "owner-decisions.md 2026-07-17 TARGET: always-ON for strata with the UI toggle removed (private APIs are always regional) → hidden surface. SHIPPED NOW: default true; the legacy privateApiRegional param is still HONORED at resolve (privateApiRegional=0 resolves to false — NOT yet inert-clamped) and the 'Private API placement' control still renders in the panel. Non-strata views force false at the import boundary. The always-on inert clamp + UI-control removal are the deferred UI-wiring follow-up",
  },
  {
    urlParam: "strataRankSep",
    aliases: ["strataRankSeparate"],
    optionKey: "strataRankSeparate",
    kind: "boolean",
    default: false,
    surface: "basic",
    emitClass: "C1",
    decidedNow: true,
    note: "S5-6 full-name alias; 'Compact height' honest-trade axis. owner-decisions.md 2026-07-17: default OFF, MUTUALLY EXCLUSIVE with strataPackedScoring (packedScoring wins) — see terraformStrataOptionRules conflict table",
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
    default: true,
    surface: "advanced",
    emitClass: "C1",
    decidedNow: true,
    note: "owner-decisions.md 2026-07-17: default ON (B1 removed the cost objection); emitted both-states (C1) like the other default-ON flags; MUTUALLY EXCLUSIVE with strataRankSeparate (packedScoring WINS)",
  },
  {
    urlParam: "strataPackedEps",
    optionKey: "strataPackedScoringEpsilon",
    kind: "number",
    default: 1,
    surface: "advanced",
    emitClass: "C3",
    decidedNow: true,
    note: "owner-decisions.md 2026-07-17: default ε=1 (S1-1 fix makes ε=1 correct); non-default-only emit (absent resolves to 1)",
  },
  {
    urlParam: "strataEdgeRouting",
    optionKey: "strataEdgeRouting",
    kind: "boolean",
    default: false,
    surface: "advanced",
    emitClass: "C2",
    decidedNow: true,
    note: "M2 'Route edges' with borderRoute; owner-decisions.md 2026-07-17: ADVANCED-ONLY (SDEC-61 closed-adverse +192cr/−140pierce). SHIPPED: the 'Route edges around boxes' control now renders inside the panel's collapsed 'Advanced: edge routing' <details> disclosure (with borderRoute) — off the always-visible Standard surface",
  },
  {
    urlParam: "strataBorderRoute",
    optionKey: "strataBorderRoute",
    kind: "boolean",
    default: false,
    surface: "advanced",
    emitClass: "C2",
    decidedNow: false,
    note: "M2 'Route edges'; composes with edgeRouting; owner-decisions.md 2026-07-17 declutter: SHIPPED into the same collapsed 'Advanced: edge routing' <details> disclosure as edgeRouting; parses independently forever",
  },
  {
    urlParam: "strataBandCompact",
    optionKey: "strataBandCompact",
    kind: "boolean",
    default: false,
    surface: "hidden",
    // C19 fix (surface-and-emission-registry-not-applied): C2, not C4. Although
    // strataBandCompact is a legacy alias for strataBandDepth='root', the live
    // serializer STILL emits it truthy-only (collectTerraformDemoParams:1068,
    // buildTerraformDemoUrl setBool:824) — it is NOT parse-only. Cataloguing it
    // C4 disagreed with the emitter; a registry-driven serializer would then
    // wrongly drop it. Its true class today is C2 (default-OFF, emitted when set).
    emitClass: "C2",
    decidedNow: true,
    note: "legacy alias → strataBandDepth='root'; STILL emitted truthy-only today (C2); parser + build round-trip kept forever",
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
    default: true,
    surface: "basic",
    emitClass: "C1",
    decidedNow: true,
    note: "OD-15 relocate; owner-decisions.md 2026-07-17: default ON (−35% global crossings); part of the new default stack; emitted both-states (C1)",
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
    // C19 fix (edge-cap-default-drift): NO fixed default — absence inherits the
    // resolved ε (strataPackedScoringEpsilon). Cataloguing this as `default: 0`
    // was a fabrication: with ε nonzero, an explicit cap 0 differs semantically
    // from omission, so a registry-driven emitter keyed on `default: 0` would
    // erase an explicit zero. Represented as inherited so every emitter/test
    // treats absence correctly.
    defaultInherits: "strataPackedScoringEpsilon",
    surface: "advanced",
    emitClass: "C3",
    decidedNow: false,
    note: "edge-edge regression cap; no default materialized (inherits ε, NOT 0); BLOCKED on S1-1 before any merge",
  },
  {
    urlParam: "strataPackedConverge",
    optionKey: "strataPackedConverge",
    kind: "boolean",
    default: false,
    surface: "hidden",
    emitClass: "C2",
    decidedNow: true,
    note: "owner-decisions.md 2026-07-17: REMOVED/LEGACY — byte-identical no-op (matrix-inert). SHIPPED: the 'Keep best order found' control is deleted from TerraformStrataSettingsHeight.tsx; the state still round-trips (useTerraformImportDialog) and the parser keeps accepting the legacy param as an inert no-op for old URLs (never errors)",
  },
  {
    urlParam: "strataTransitiveAdopt",
    optionKey: "strataTransitiveAdopt",
    kind: "boolean",
    default: false,
    surface: "hidden",
    emitClass: "C2",
    decidedNow: true,
    note: "owner-decisions.md 2026-07-17: REMOVED/LEGACY — byte-identical no-op (wasted ~8.6s/layout). SHIPPED: the 'Stable adoption rule' control is deleted from TerraformStrataSettingsHeight.tsx; the state still round-trips (useTerraformImportDialog) and the parser keeps accepting the legacy param as an inert no-op for old URLs (never errors)",
  },
  {
    urlParam: "strataBlockClamp",
    optionKey: "strataBlockClamp",
    kind: "boolean",
    default: false,
    surface: "advanced",
    emitClass: "C2",
    decidedNow: true,
    note: "advanced: A1 changed its behavior post-matrix (snap fix, honest-null on P2); delete-from-UI slot no longer decidable. owner-decisions.md 2026-07-17 declutter: SHIPPED — 'Compact pure-sink accounts' moved out of the always-visible Readability surface into a collapsed 'Advanced: pure-sink packing' <details> disclosure",
  },
  {
    urlParam: "strataTranspose",
    optionKey: "strataTranspose",
    kind: "boolean",
    default: true,
    surface: "basic",
    emitClass: "C1",
    decidedNow: true,
    note: "owner-decisions.md 2026-07-17: default ON (matrix: -24% crossings, envelope-preserving); part of the new default stack; joined C1 (emitted both-states) on the flip",
  },
  {
    urlParam: "strataHeightGate",
    optionKey: "strataHeightGate",
    kind: "boolean",
    default: false,
    surface: "advanced",
    emitClass: "C2",
    decidedNow: true,
    note: "single consumer = blockClamp; measured inert; delete-from-UI is matrix cell M3a. owner-decisions.md 2026-07-17 declutter: SHIPPED — 'Keep containers from growing taller' moved out of the always-visible Height & packing surface into a collapsed 'Advanced: height gate' <details> disclosure",
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
