import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  deleteTerraformImportPresetFromDb,
  getTerraformImportCompositionFromDb,
  getTerraformImportPresetDb,
  getTerraformImportPresetFromDb,
  getTerraformImportPresetSourcesFromDb,
  listTerraformImportArtifactsFromDb,
  listTerraformImportPresetsFromDb,
  resolveTerraformImportFilePath,
  saveTerraformImportArtifactToDb,
  saveTerraformImportCompositionToDb,
  saveTerraformImportPresetToDb,
  seedAllBuiltinsFromCatalog,
  syncTerraformImportPresetFromDisk,
  updateTerraformImportPresetInDb,
} from "./terraformImportPresetDb.mjs";

const TERRAFORM_PRESET_FILE_ROUTE = "/__dev/terraform-import/";
const TERRAFORM_PRESET_API_ROUTE = "/api/terraform-import-presets";
const TERRAFORM_ARTIFACT_API_ROUTE = "/api/terraform-import-artifacts";
const TERRAFORM_COMPOSITION_API_ROUTE = "/api/terraform-import-compositions";
const TERRAFORM_LAYOUT_API_ROUTE = "/api/terraform-layout";

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
// The TS layout engine, loaded headlessly via Vite's ssrLoadModule. Its
// `@excalidraw/*` imports resolve through the dev config's resolve.alias.
const LAYOUT_CORE_MODULE = path.resolve(
  PLUGIN_DIR,
  "../../packages/excalidraw/components/terraformLayoutCore.ts",
);
// Rendered-metric + fingerprint + profiler modules, loaded headlessly the same way
// (ssrLoadModule). We surface RENDERED metrics (diagnosePipelineScene /
// computePierceMetrics), never chord proxies (trap #2), and the SHARED geometry
// fingerprint (do NOT invent a second canonicalization).
const COLLISION_DIAGNOSTICS_MODULE = path.resolve(
  PLUGIN_DIR,
  "../../packages/excalidraw/components/terraformPipelineCollisionDiagnostics.ts",
);
const PIERCE_METRICS_MODULE = path.resolve(
  PLUGIN_DIR,
  "../../packages/excalidraw/components/terraformPipelineStrataPierceMetrics.ts",
);
const GEOMETRY_HASH_MODULE = path.resolve(
  PLUGIN_DIR,
  "../../packages/excalidraw/components/terraformStrataGeometryHash.ts",
);
const IMPORT_PROFILER_MODULE = path.resolve(
  PLUGIN_DIR,
  "../../packages/excalidraw/components/terraformImportProfiler.ts",
);
// The SHARED, unit-tested edge-collapse guard. Loaded headlessly (ssrLoadModule)
// so the proof-API plugin seam and the probe seam run the IDENTICAL detector —
// the round-2 defect was a hand-rolled duplicate here that measured over the
// visible+REVEALED set (the revealed skeletons span [[0,0],[dx,dy]] by
// construction), so it read 155/145-healthy on a scene the probe seam correctly
// flagged 0/145-collapsed. There is now ONE detector, invoked over visible-only
// elements, so the two seams can never diverge again.
const EDGE_COLLAPSE_MODULE = path.resolve(
  PLUGIN_DIR,
  "../../packages/excalidraw/components/terraformEdgeCollapse.ts",
);

// RCLL pipeline toggles → `TerraformLayoutOptions` keys. Param names mirror the
// `/demo` URL API (terraformDemoUrlParams.ts); `compact` is endpoint-only.
// Each entry is [paramName, optionKey]. Several params carry a clearer alias that
// matches the menu vocabulary (laneRise/laneSplit/cycleRise) alongside the legacy
// milestone name; both map to the same option key (last one present wins, like the URL).
export const LAYOUT_BOOLEAN_PARAMS = [
  ["compact", "pipelineCompact"],
  ["laneRise", "pipelineSwimlaneLaneRise"],
  ["swimlaneRise", "pipelineSwimlaneLaneRise"],
  ["laneSplit", "pipelineRankSeparate"],
  ["rankSeparate", "pipelineRankSeparate"],
  // Back-compat alias: the core maps `subnetDeBand=1` ⇒ `deBandLevel="subnet"`.
  ["subnetDeBand", "pipelineSubnetDeBand"],
  ["straighten", "pipelineStraighten"],
  // Legacy alias: `deDensify=1` ⇒ the core derives `columnPacking:"spread"`.
  ["deDensify", "pipelineDeDensify"],
  ["reorder", "pipelineReorder"],
  ["crossingMin", "pipelineCrossingMin"],
  ["cycleRise", "pipelineStaircaseBandOverlap"],
  ["staircaseBandOverlap", "pipelineStaircaseBandOverlap"],
  ["ancillary", "pipelineIncludeAncillary"],
  // Strata (S0a scaffold, docs/strata-view-implementation-flow.md §2): passthrough
  // to the rcll v2 substrate until the strata engine lands (see LAYOUT_MODE_ALLOWED
  // below). Both the clear alias and the OD-1/A7 canonical flag name map to the same
  // option key (mirrors the laneRise/swimlaneRise dual-alias pattern above). All
  // default OFF (owner standing rule).
  ["strataNsRank", "strataNetworkSimplexRank"],
  ["strataNetworkSimplexRank", "strataNetworkSimplexRank"],
  ["strataCoordRefine", "strataCoordinateRefine"],
  ["strataCoordinateRefine", "strataCoordinateRefine"],
  // OD-14 height lever — the demo URL parses it as `strataRankSep`
  // (terraformDemoUrlParams.ts) mapping to option key `strataRankSeparate`. Both
  // the URL param name and the canonical option name are accepted here (dual-alias
  // pattern), last-present-wins like the URL.
  ["strataRankSep", "strataRankSeparate"],
  ["strataRankSeparate", "strataRankSeparate"],
  // W5 effect-matrix exposure — the remaining engine toggles, threaded through
  // `layoutTerraformFromSources`'s sceneContext literal (all already forwarded
  // there; this table was the only gap). Param names mirror the /demo URL API
  // (terraformDemoUrlParams.ts) exactly; `strataSift` carries the engine-key
  // alias like the other dual-alias entries. All default OFF.
  ["privateApiRegional", "pipelinePrivateApiRegional"],
  ["strataPackedScoring", "strataPackedScoring"],
  ["strataEdgeRouting", "strataEdgeRouting"],
  ["strataBorderRoute", "strataBorderRoute"],
  ["strataSift", "strataSiftRelocate"],
  ["strataSiftRelocate", "strataSiftRelocate"],
  ["strataPackedConverge", "strataPackedConverge"],
  ["strataTransitiveAdopt", "strataTransitiveAdopt"],
  ["strataBlockClamp", "strataBlockClamp"],
  ["strataTranspose", "strataTranspose"],
  ["strataHeightGate", "strataHeightGate"],
  // Wave-1 edge-routing probe exposure — the remaining strata booleans the
  // /demo URL API (terraformDemoUrlParams.ts) parses that this allowlist was
  // silently dropping (API arms no-op'd, applied.<key>=null). Param names mirror
  // the /demo URL exactly; all default OFF. `strataBandCompact` is the legacy
  // boolean alias for `strataBandDepth:"root"` (the engine folds it in).
  ["strataBandCompact", "strataBandCompact"],
  ["strataChannelRoute", "strataChannelRoute"],
  ["strataChainRelocate", "strataChainRelocate"],
  ["strataCoordCascade", "strataCoordCascade"],
  ["strataLeafShift", "strataLeafShift"],
];

// Enum (non-boolean) layout params: [paramName, optionKey, allowedValues].
export const LAYOUT_ENUM_PARAMS = [
  ["columnPacking", "pipelineColumnPacking", ["spread", "none", "compact"]],
  // De-band depth — dissolve the chosen container level + all deeper levels into one
  // shared column stack. `none` = today's boxed layout (byte-identical).
  [
    "deBandLevel",
    "pipelineDeBandLevel",
    ["none", "subnet", "vpc", "region", "account", "provider"],
  ],
  // Strata de-band ladder (OD-15 port) — dissolve the chosen level + all deeper
  // levels at the strata model build. `none` = byte-identical. Distinct from
  // `deBandLevel` above, which is the RCLL/v1 lever.
  [
    "strataDeBand",
    "strataDeBandLevel",
    ["none", "subnet", "vpc", "region", "account", "provider"],
  ],
  // W10 band-depth cut (SDEC-63) — hulls at/above the cut stay banded, deeper
  // hulls pack. Engine default is "account"; mirrors the /demo URL param. The 4th
  // tuple slot flags CASE-SENSITIVE matching: `subnetZone` is mixed-case, so —
  // exactly like the demo parser (terraformDemoUrlParams.ts:470-479) — the raw
  // value must NOT be lowercased before the membership check, or `subnetZone`
  // would fall through as invalid.
  [
    "strataBandDepth",
    "strataBandDepth",
    ["root", "provider", "account", "region", "vpc", "subnetZone"],
    true,
  ],
  // Outcome-first "Layout" profile — expands into the RCLL flags in the core.
  ["profile", "pipelineLayoutProfile", ["readable", "balanced", "compact"]],
  // Probe P2 edge render style (straight|step|curve). Case-INSENSITIVE like the
  // /demo parser (terraformDemoUrlParams.ts:497-509); default "straight" is
  // byte-identical (the style module never runs). Mirrors the /demo URL param.
  ["strataEdgeStyle", "strataEdgeStyle", ["straight", "step", "curve"]],
];

// Integer (non-boolean, non-enum) layout params: [paramName, optionKey].
// Strata (S0a scaffold) — sweep count (K) for the coordinate-refinement pass;
// 0 = off (M1a default, 4 planned for M1b). Passthrough-only until the strata
// engine lands; default OFF like the strata booleans above.
export const LAYOUT_INT_PARAMS = [["strataSweeps", "strataSweeps"]];

// W8b ε-constraint crossings budget for the packed scorer. Parsed apart from the
// pure integers above because the demo URL API (terraformDemoUrlParams.ts:492-505)
// accepts a FRACTIONAL value in RELATIVE mode (0 < eps < 1) while ABSOLUTE mode
// (eps >= 1) stays an integer crossings budget. `[paramName, optionKey]`; both the
// /demo name (`strataPackedEps`) and the canonical engine key are accepted.
export const LAYOUT_EPS_PARAMS = [
  ["strataPackedEps", "strataPackedScoringEpsilon"],
  ["strataPackedScoringEpsilon", "strataPackedScoringEpsilon"],
];

// Non-negative FINITE float params (`[paramName, optionKey]`). Distinct from the
// ε params above (which reject fractional values in absolute mode) and the pure
// integers: the relocate objective weights and edge-edge regression cap accept
// any non-negative finite number, fractional included — exactly the /demo URL
// contract (terraformDemoUrlParams.ts:591-617). These were absent from every
// allowlist, so a URL/proof-API relocate arm silently ran the engine defaults
// (weights 1/1, cap inherits ε) no matter what the caller passed.
export const LAYOUT_NUM_PARAMS = [
  ["strataPenW", "strataCrossWeightPenetration"],
  ["strataCrossW", "strataCrossWeightEdge"],
  ["strataEdgeCap", "strataEdgeCrossCap"],
];

// Which engine variant `/api/terraform-layout` runs. Parsed separately from
// LAYOUT_ENUM_PARAMS (below) because it selects `options.layoutMode` itself rather
// than a nested option, and — unlike the enum params — has an explicit default
// ("rcll") so omitting it preserves the pre-strata proof-API behavior byte-for-byte.
const LAYOUT_MODE_ALLOWED = ["rcll", "strata", "pipeline"];

// Self-describing catalog returned by `?describe=1` so a caller can discover the
// vocabulary without reading source. Kept beside the param tables it documents.
const LAYOUT_PARAM_CATALOG = {
  route: TERRAFORM_LAYOUT_API_ROUTE,
  method: "GET",
  required: { preset: "preset id (slug)" },
  layoutMode: {
    param: "layoutMode",
    values: LAYOUT_MODE_ALLOWED,
    default: "rcll",
    note: 'Which layout engine runs. `strata` is the S0a scaffold — passthrough to the rcll v2 substrate (identical geometry); scene meta echoes pipelineLayoutVariant:"strata" + strataPassthrough:true once the engine-side wiring lands. Omitting the param preserves pre-strata behavior byte-for-byte.',
  },
  profiles: {
    param: "profile",
    values: ["readable", "balanced", "compact"],
    note: "Outcome-first preset that expands into the flags below. `balanced` = today's defaults (byte-identical). An explicit flag overrides the profile.",
  },
  enums: {
    columnPacking: ["spread", "none", "compact"],
    deBandLevel: ["none", "subnet", "vpc", "region", "account", "provider"],
    strataDeBand: ["none", "subnet", "vpc", "region", "account", "provider"],
    strataBandDepth: [
      "root",
      "provider",
      "account",
      "region",
      "vpc",
      "subnetZone",
    ],
    strataEdgeStyle: ["straight", "step", "curve"],
  },
  enumNotes: {
    deBandLevel:
      "Dissolve the chosen container level AND every deeper level into one shared column stack (cascades downward). `none` = today's boxed layout (byte-identical).",
    strataDeBand:
      "layoutMode=strata only. Dissolve the chosen level + every deeper one at the model build (structure phase), so ordering/transpose/A7 re-run over the collapsed model. `none` = byte-identical. SUPPRESSED (scene meta strataToggleSuppressions, and strataDeBandLevel absent from meta) when the absorbing parent is still banded under strataBandDepth — `provider` absorbs into the root, pinned banded, so it is never applied.",
    strataBandDepth:
      "CASE-SENSITIVE (unlike the other enums here): `subnetZone` is mixed-case, so the raw value is matched exact-case, NOT lowercased — `subnetzone` is rejected. Mirrors the /demo URL parser.",
  },
  booleans: {
    compact: "detail: collapse clusters to a representative",
    laneRise: "alias of swimlaneRise (M4) — X-disjoint lanes share Y rows",
    laneSplit:
      "alias of rankSeparate (M8r) — split dependent lanes (needs laneRise)",
    cycleRise:
      "alias of staircaseBandOverlap (DEC-1) — cycle groups share Y (default on)",
    subnetDeBand: "legacy alias ⇒ deBandLevel=subnet",
    straighten: "Brandes–Köpf leaf straightening",
    reorder: "barycenter crossing-min reorder (leaf, per-container)",
    crossingMin:
      "container-aware crossing minimization (M6c) — reorders whole groups + leaves; supersedes reorder",
    deDensify: "legacy alias ⇒ columnPacking=spread",
    ancillary:
      "pipelineIncludeAncillary — include ancillary (non-primary) resources.",
    strataNsRank:
      "alias of strataNetworkSimplexRank (OD-1) — Strata NS rank refinement; scaffold-only (passthrough to rcll v2) until the strata engine lands",
    strataNetworkSimplexRank:
      "OD-1 flag — Strata network-simplex rank refinement; scaffold-only (passthrough to rcll v2) until the strata engine lands",
    strataCoordRefine:
      "alias of strataCoordinateRefine (A7) — Strata coordinate refinement; scaffold-only (passthrough to rcll v2) until the strata engine lands",
    strataCoordinateRefine:
      "A7 flag — Strata coordinate refinement; scaffold-only (passthrough to rcll v2) until the strata engine lands",
    strataRankSep:
      "alias of strataRankSeparate (OD-14) — whole-model sibling-separation ranking (the height lever). Threaded to the engine (sceneContext), active under layoutMode=strata.",
    strataRankSeparate:
      "OD-14 flag — Strata whole-model sibling-separation ranking (the height lever). Threaded to the engine (sceneContext), active under layoutMode=strata.",
    privateApiRegional:
      "pipelinePrivateApiRegional — private REST APIs bind by account+region (strata-only; forced false on other layoutModes).",
    strataPackedScoring:
      "W8 packed-scorer edge scoring (strataPackedScoring). layoutMode=strata only.",
    strataEdgeRouting: "Strata edge routing (opt-in).",
    strataBorderRoute: "Strata P3 clean container-exit routing (opt-in).",
    strataSift:
      "alias of strataSiftRelocate (OD-15) — crossings-≻-length relocate lever.",
    strataSiftRelocate: "OD-15 flag — crossings-≻-length relocate lever.",
    strataPackedConverge:
      "Adopt the best-seen packed-scorer snapshot instead of the rolling incumbent.",
    strataTransitiveAdopt: "Transitive ε adoption gate for the packed scorer.",
    strataBlockClamp: "P4 pure-sink account block clamp.",
    strataTranspose: "P2 within-column adjacent Y-exchange crossing reduction.",
    strataHeightGate: "P5/Lever-C height gate after the block-clamp pass.",
    strataBandCompact:
      "W10 banded row-share compaction — legacy boolean alias for strataBandDepth=root (the engine folds it in). layoutMode=strata.",
    strataChannelRoute:
      "Probe P1 inter-rank channel routing (owner's dummy-column idea) — orthogonal per-channel track routing of inter-rank TFD arrows. layoutMode=strata.",
    strataChainRelocate:
      "Exclusive-downstream chain relocate — post-A7 rigid Y co-translation of a unit and its exclusive downstream group. layoutMode=strata.",
    strataCoordCascade:
      "A7 tie-cascade — a net-zero fixed-point column escapes to its two-sided median and chases chord-connected downstreams. layoutMode=strata.",
    strataLeafShift:
      "A01 leaf X-shift — pull degree-1 pure-sink leaves left toward their source (carries the right-edge column guard). layoutMode=strata.",
  },
  ints: {
    strataSweeps:
      "Strata sweep count K for coordinate refinement (0 = off / M1a default, 4 planned for M1b); scaffold-only (passthrough to rcll v2) until the strata engine lands",
  },
  numbers: {
    strataPackedEps:
      "alias of strataPackedScoringEpsilon (W8b) — ε-constraint crossings budget for the packed scorer. ABSOLUTE mode (eps >= 1) is a whole-integer budget; RELATIVE mode (0 < eps < 1) is a fractional ratio and accepted (mirrors the /demo URL parser).",
    strataPackedScoringEpsilon:
      "W8b ε-constraint crossings budget for the packed scorer. Integer for eps >= 1; fractional allowed for 0 < eps < 1.",
    strataPenW:
      "alias of strataCrossWeightPenetration — relocate objective weight on hull penetrations (non-negative finite, fractional allowed). Default 1.",
    strataCrossW:
      "alias of strataCrossWeightEdge — relocate objective weight on edge-edge crossings (non-negative finite, fractional allowed). Default 1.",
    strataEdgeCap:
      "alias of strataEdgeCrossCap — edge-edge regression cap (non-negative finite, fractional allowed). Absent ⇒ inherits strataPackedScoringEpsilon.",
  },
  enumNotesEdgeStyle:
    "Probe P2 edge render style (React-Flow smoothstep/bezier transplant). `straight` (default) is byte-identical; `step`/`curve` reshape un-routed TFD arrow chords. Case-insensitive (mirrors the /demo URL parser).",
  metrics: {
    note: "Always present (additive). Rendered metrics, NOT chord proxies (trap #2). The dataflow crossings/pierce metrics measure VISIBLE + REVEALED edges: the headless import pins every edge layer OFF (TERRAFORM_IMPORT_EDGE_LAYER_PINS all-false) so TFD arrows arrive soft-deleted, and computePierceMetrics/diagnosePipelineScene read customData.relationship ENDPOINTS — so on a visible-only set those scalars go quiet even though visible ROUTED geometry may still be present (the healthy branch's visible-only geometryHash carries the ~1.18M-char edge-connector points). geometryHash stays visible-only for baseline comparability; edgeGeometryHash is the edge-inclusive fingerprint; the edge-collapse fields below measure the visible spanning geometry directly.",
    renderedCrossings:
      "diagnosePipelineScene(visible+revealed edges).dataflow.crossings — polyline-aware rendered dataflow crossings.",
    pierce:
      "computePierceMetrics(visible+revealed edges).pierce.total — chord pierces through non-ancestor hulls.",
    arrowCount:
      "Non-deleted arrows in the measured (visible+revealed) set — the guard that renderedCrossings=0 means 'no crossings', not 'no arrows measured'.",
    tfdArrowCount:
      "Subset of arrowCount carrying a declared dataflow relationship (customData.relationship source/target strings, aggregated !== true) — the crossings-visibility guard.",
    declaredEdgeCount:
      "The declared-edge population = pierce.edgeCount — the denominator of the edge-collapse invariant.",
    spanningVisibleLinearCount:
      "Count of spanning (>= 64px, above the 53px icon-stroke ceiling) linear elements (arrow OR line) in the VISIBLE-ONLY set — NOT the visible+revealed set the crossings/pierce scalars use. This distinction is load-bearing: the revealed edges carry isDeleted:false and span [[0,0],[dx,dy]] BY CONSTRUCTION, so counting them read 155/145-healthy on a collapsed scene (round-2 defect). Computed by the SHARED detectEdgeCollapse helper (same as the arm-eval probe). NOT keyed off customData.relationship — the declared skeletons span by construction and arrive soft-deleted on the headless path, so a relationship-keyed span check is a no-op on a genuinely collapsed scene (deband-hash-anomaly.md fix #1).",
    edgeSpanningFraction:
      "spanningVisibleLinearCount / declaredEdgeCount, rounded to 3dp. Near 0 means the declared edges left no spanning VISIBLE connector geometry even though crossings/pierce (endpoint-based) look valid.",
    edgeCollapseDetected:
      "true when declaredEdgeCount >= 8 AND fewer than 10% of the declared population has spanning visible geometry — a catastrophic edge collapse the scalar metrics are blind to (the engine's once-per-process nondeterminism). The >= 8 population floor gates out the sparse-scene false-positive (a single valid short-connector edge). A true here means the scene is BROKEN, not a valid layout.",
    revealedEdgeCount:
      "Count of soft-deleted relationship edges revealed (un-deleted) for the rendered dataflow metrics — the edge geometry the strata toggles optimize.",
    edgeGeometryHash:
      "strataGeometryHash(visible + revealed edges) — the edge-inclusive fingerprint so edge-only toggles (edgeRouting/borderRoute) can't hide behind the box-only geometryHash.",
    topoFrames:
      "Count of topology hull frames (customData.terraformTopologyRole in provider/account/region/vpc/subnetZone — the exact hull set computePierceMetrics's numerator uses) — the pierce denominator (trap #3). NOT a raw terraformTopologyKey count: that key is also on primaryCluster card / ancillaryStrip / satellite frames, which are not pierce hulls.",
    piercePerTopoFrame:
      "pierce / max(1, topoFrames) — normalizes pierce so a deband that removes hulls can't fake a win (trap #3).",
    height: "Scene bounds height (px).",
    width: "Scene bounds width (px).",
    elementCount: "Non-deleted element count.",
    geometryHash:
      "strataGeometryHash(elements) from the shared terraformStrataGeometryHash helper — `<count>:<length>:<fnv1a64hex>` of the canonical rounded geometry (sorted multiset of `type|x|y|w|h|angle|pts` lines). Deterministic across runs: the fingerprint OMITS element id, so the proof-API path's per-run id regeneration (nanoid via convertToExcalidrawElements regenerateIds) can't flip it — same request ⇒ same hash.",
  },
  timings: {
    param: "timings",
    note: 'Set `?timings=1` (alias `?profileTimings=1`) to include a `timings` array (terraformImportProfiler spans, sorted by selfMs). NOTE: the profiler toggle is `timings`, NOT `profile` — `profile` is the layout-profile enum (readable|balanced|compact). All layout requests are serialized through a single queue so the module-global profiler never interleaves spans across concurrent requests.',
  },
  responseShape: [
    "requested",
    "resolved",
    "applied",
    "suppressions",
    "bounds",
    "metrics",
    "geometryHash",
    "timings (only when ?timings=1)",
    "rcll",
    "regions",
  ],
};

// The layout engine's import graph (appState, element rendering) reads browser
// globals at module-eval time. ssrLoadModule runs in Node, so bootstrap a jsdom
// DOM once — the SAME environment vitest uses, so layout numbers stay faithful.
let domBootstrap = null;
const ensureLayoutDomGlobals = () => {
  if (!domBootstrap) {
    domBootstrap = (async () => {
      const { JSDOM } = await import("jsdom");
      const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
        pretendToBeVisual: true,
        url: "http://localhost/",
      });
      const { window } = dom;

      // jsdom has no 2d canvas context, but the layout measures text widths via
      // `ctx.font` + `measureText`. Provide a deterministic metrics-only stub
      // (font-size × 0.5 per char) — enough to size cards; the proof is the
      // OFF-vs-ON delta, which is driven by column ranks, not glyph widths.
      const makeTextMetricsContext = () => {
        let font = "10px sans-serif";
        const noop = () => {};
        return {
          get font() {
            return font;
          },
          set font(value) {
            font = value;
          },
          measureText: (text) => {
            const px = /(\d+(?:\.\d+)?)px/.exec(font);
            const size = px ? parseFloat(px[1]) : 10;
            return { width: String(text).length * size * 0.5 };
          },
          save: noop,
          restore: noop,
          fillText: noop,
          strokeText: noop,
          setTransform: noop,
          scale: noop,
          translate: noop,
          beginPath: noop,
          closePath: noop,
          moveTo: noop,
          lineTo: noop,
          stroke: noop,
          fill: noop,
          fillRect: noop,
          clearRect: noop,
          arc: noop,
        };
      };
      window.HTMLCanvasElement.prototype.getContext = function getContext(
        type,
      ) {
        return type === "2d" ? makeTextMetricsContext() : null;
      };

      const assign = (key, value) => {
        try {
          Object.defineProperty(globalThis, key, {
            value,
            configurable: true,
            writable: true,
          });
        } catch {
          /* keep any existing (read-only) global in place */
        }
      };
      assign("window", window);
      assign("document", window.document);
      assign("navigator", window.navigator);
      assign("location", window.location);
      assign("HTMLElement", window.HTMLElement);
      assign("Element", window.Element);
      assign("Node", window.Node);
      // The scene finalize step fetches the AWS icon library by `file://` URL
      // (icons are decorative — geometry-neutral). undici's fetch rejects the
      // file scheme, so serve file:// from disk; defer other URLs to real fetch.
      const realFetch = globalThis.fetch;
      assign("fetch", async (input, init) => {
        const href =
          input instanceof URL
            ? input.href
            : typeof input === "string"
            ? input
            : String(input?.url ?? input);
        if (href.startsWith("file://")) {
          const { readFile } = await import("node:fs/promises");
          const text = await readFile(fileURLToPath(href), "utf-8");
          return {
            ok: true,
            status: 200,
            text: async () => text,
            json: async () => JSON.parse(text),
          };
        }
        if (realFetch) {
          return realFetch(input, init);
        }
        throw new Error(`fetch unavailable for ${href}`);
      });
      assign("getComputedStyle", window.getComputedStyle.bind(window));
      assign("localStorage", window.localStorage);
      assign("sessionStorage", window.sessionStorage);
      assign("matchMedia", window.matchMedia?.bind(window));
      assign(
        "requestAnimationFrame",
        window.requestAnimationFrame?.bind(window),
      );
      assign("cancelAnimationFrame", window.cancelAnimationFrame?.bind(window));
      assign("devicePixelRatio", 1);
    })();
  }
  return domBootstrap;
};

/** "1"/"true" → true, "0"/"false" → false, absent → undefined, else null (invalid). */
const parseLayoutBooleanParam = (raw) => {
  if (raw == null || raw.trim() === "") {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }
  if (normalized === "0" || normalized === "false") {
    return false;
  }
  return null;
};

/**
 * undefined when absent, null when invalid, else the matched enum value.
 * `caseSensitive` mirrors the demo parser: most enums are lowercased before the
 * membership check, but `strataBandDepth` carries a mixed-case member
 * (`subnetZone`) and MUST match exact-case or that value reads as invalid.
 */
const parseLayoutEnumParam = (raw, allowed, caseSensitive = false) => {
  if (raw == null || raw.trim() === "") {
    return undefined;
  }
  const trimmed = raw.trim();
  const normalized = caseSensitive ? trimmed : trimmed.toLowerCase();
  return allowed.includes(normalized) ? normalized : null;
};

/** undefined when absent, null when invalid (not a non-negative whole number), else the parsed integer. */
const parseLayoutIntParam = (raw) => {
  if (raw == null || raw.trim() === "") {
    return undefined;
  }
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  const value = Number.parseInt(normalized, 10);
  // A hundreds-of-digits input passes the regex but parses to Infinity (or an
  // unrepresentable integer) — outside the documented contract, so reject.
  return Number.isSafeInteger(value) ? value : null;
};

/**
 * ε-constraint budget parser (`strataPackedEps`). undefined when absent, null when
 * invalid, else the parsed number. Mirrors the demo URL semantics exactly
 * (terraformDemoUrlParams.ts:492-505): reject NaN / negative / non-finite; ABSOLUTE
 * mode (eps >= 1) must be a whole integer crossings budget, but RELATIVE mode
 * (0 < eps < 1) is legitimately fractional and accepted.
 */
const parseLayoutEpsParam = (raw) => {
  if (raw == null || raw.trim() === "") {
    return undefined;
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  // A fractional value in absolute mode (e.g. 1.5) violates the crossings-budget
  // contract; a fractional value in relative mode (0 < eps < 1) is valid.
  if (parsed >= 1 && !Number.isInteger(parsed)) {
    return null;
  }
  return parsed;
};

/**
 * Non-negative finite float parser (relocate weights / edge-cap). undefined when
 * absent, null when invalid (NaN / negative / non-finite), else the parsed
 * number. Unlike `parseLayoutEpsParam` there is NO integer constraint —
 * fractional values are legal at every magnitude (mirrors the /demo URL parser
 * for strataPenW/strataCrossW/strataEdgeCap).
 */
const parseLayoutNumParam = (raw) => {
  if (raw == null || raw.trim() === "") {
    return undefined;
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

/** Overall bounds (min/max) over the non-deleted elements, or null when empty. */
const computeSceneBounds = (elements) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + (el.width ?? 0));
    maxY = Math.max(maxY, el.y + (el.height ?? 0));
  }
  if (!Number.isFinite(minX)) {
    return null;
  }
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.round(maxX - minX),
    height: Math.round(maxY - minY),
  };
};

// The exact hull role set computePierceMetrics uses (TOPOLOGY_ROLES in
// terraformPipelineStrataPierceMetrics.ts). The pierce denominator MUST mirror
// the numerator's hull definition or the normalization lies.
const TOPO_HULL_ROLES = new Set([
  "provider",
  "account",
  "region",
  "vpc",
  "subnetZone",
]);

// Count topology hull frames — the honest pierce denominator (trap #3). A hull is
// a frame whose `customData.terraformTopologyRole` is one of the five roles
// computePierceMetrics treats as a hull (provider/account/region/vpc/subnetZone).
// The `terraformTopologyKey` presence test is WRONG here: that key is also stamped
// on primary-cluster resource-card frames, ancillary-strip frames, and satellite
// frames (hundreds per scene), which are NOT pierce hulls. Counting them inflates
// the denominator so a deband that dissolves real hulls barely moves it — exactly
// the trap-#3 gaming this metric is meant to expose. Match the role set instead.
const countTopoFrames = (elements) => {
  let count = 0;
  for (const el of elements) {
    if (
      el.type === "frame" &&
      !el.isDeleted &&
      TOPO_HULL_ROLES.has(String(el.customData?.terraformTopologyRole ?? ""))
    ) {
      count += 1;
    }
  }
  return count;
};

/**
 * Rendered metrics + shared geometry fingerprint. Uses RENDERED signals only
 * (diagnosePipelineScene / computePierceMetrics), never chord proxies (trap #2).
 * `helpers` carries the ssr-loaded functions so this stays pure/testable.
 */
const buildSceneMetrics = (elements, revealedEdges, bounds, helpers) => {
  const {
    diagnosePipelineScene,
    computePierceMetrics,
    strataGeometryHash,
    detectEdgeCollapse,
  } =
    helpers;
  // W5 finding: headless import pins every edge layer OFF
  // (TERRAFORM_IMPORT_EDGE_LAYER_PINS all-false), so the TFD arrows arrive
  // soft-deleted and a metrics pass over visible elements alone is
  // structurally blind (crossings/pierce identically 0 for every request).
  // Measure over visible + revealed edges — the state the app shows once the
  // dataflow layer pin (or hover) reveals them, i.e. the geometry the strata
  // toggles actually optimize. Bounds / elementCount / geometryHash stay
  // visible-only for baseline comparability; edgeGeometryHash adds an
  // edge-inclusive fingerprint so edge-only togs (edgeRouting/borderRoute)
  // cannot hide behind a box-only hash.
  const metricsElements = elements.concat(revealedEdges);
  let renderedCrossings = null;
  try {
    renderedCrossings =
      diagnosePipelineScene(metricsElements)?.dataflow?.crossings ?? null;
  } catch {
    renderedCrossings = null;
  }
  let pierceTotal = null;
  let pierceEdgeCount = 0;
  try {
    const pm = computePierceMetrics(metricsElements);
    pierceTotal = pm?.pierce?.total ?? null;
    pierceEdgeCount = pm?.pierce?.edgeCount ?? 0;
  } catch {
    pierceTotal = null;
    pierceEdgeCount = 0;
  }
  const topoFrames = countTopoFrames(elements);
  const piercePerTopoFrame =
    pierceTotal == null
      ? null
      : Math.round((pierceTotal / Math.max(1, topoFrames)) * 1000) / 1000;
  // Arrow visibility guard: renderedCrossings=0 is only meaningful when the
  // measured set actually CONTAINS dataflow arrows. tfdArrowCount mirrors the
  // exact diagnosePipelineScene predicate (customData.relationship
  // source/target, aggregated !== true).
  let arrowCount = 0;
  let tfdArrowCount = 0;
  for (const el of metricsElements) {
    if (el.type === "arrow" && !el.isDeleted) {
      arrowCount += 1;
      const rel = el.customData?.relationship;
      if (
        rel &&
        typeof rel === "object" &&
        typeof rel.source === "string" &&
        typeof rel.target === "string" &&
        rel.aggregated !== true
      ) {
        tfdArrowCount += 1;
      }
    }
  }
  // Edge-collapse invariant (deband-hash-anomaly.md fix #1) — delegated to the
  // SHARED, unit-tested `detectEdgeCollapse` so this proof-API seam and the
  // arm-eval probe seam run byte-identical detection. CRITICAL: it is measured
  // over the visible-only `elements` (which already excludes soft-deleted
  // elements — line ~1218), NOT `metricsElements`. The revealed skeletons in
  // `revealedEdges` carry `isDeleted:false` and span [[0,0],[dx,dy]] BY
  // CONSTRUCTION, so measuring the numerator over the revealed set read
  // 155/145-healthy on a genuinely collapsed scene (round-2 defect) — the
  // revealed edges exist ONLY to make the endpoint-based crossings/pierce
  // metrics non-trivial, they are NOT evidence of routed VISIBLE geometry. The
  // declared-edge denominator is still `pierceEdgeCount` (computed over
  // metricsElements above), matching the probe's `pm.pierce.edgeCount`.
  const {
    declaredEdgeCount,
    spanningVisibleLinearCount,
    edgeSpanningFraction,
    edgeCollapseDetected,
  } = detectEdgeCollapse(elements, pierceEdgeCount);
  return {
    renderedCrossings,
    pierce: pierceTotal,
    topoFrames,
    piercePerTopoFrame,
    arrowCount,
    tfdArrowCount,
    declaredEdgeCount,
    spanningVisibleLinearCount,
    edgeSpanningFraction,
    edgeCollapseDetected,
    revealedEdgeCount: revealedEdges.length,
    height: bounds?.height ?? null,
    width: bounds?.width ?? null,
    elementCount: elements.length,
    geometryHash: strataGeometryHash(elements),
    edgeGeometryHash: strataGeometryHash(metricsElements),
  };
};

const REGION_KEY_PATTERN = /^tf-pipeline:region:aws%00(\d+)%00(.+)$/;

/** Region frames keyed by `customData.terraformTopologyKey`, sorted account→x. */
const collectRegionFrames = (elements) => {
  const regions = [];
  for (const el of elements) {
    if (el.type !== "frame") {
      continue;
    }
    const key = String(el.customData?.terraformTopologyKey ?? "");
    const match = key.match(REGION_KEY_PATTERN);
    if (!match) {
      continue;
    }
    regions.push({
      account: match[1],
      region: match[2],
      x: Math.round(el.x),
      y: Math.round(el.y),
      width: Math.round(el.width),
      height: Math.round(el.height),
    });
  }
  regions.sort((a, b) =>
    a.account === b.account ? a.x - b.x : a.account.localeCompare(b.account),
  );
  return regions;
};

// M-ANC / M-ANC-3 — summarize the reserved "Unconnected" (ancillary) frames so the
// dev API exposes whether the bands are wide/tall and how many there are. The widen
// metrics (rcll.bandWiden*) say whether M-ANC-2 actually flattened them.
const summarizeAncillaryFrames = (elements) => {
  const widths = [];
  const heights = [];
  for (const el of elements) {
    if (el.type === "frame" && el.name === "Unconnected") {
      widths.push(Math.round(el.width));
      heights.push(Math.round(el.height));
    }
  }
  return {
    count: widths.length,
    maxWidthPx: widths.length ? Math.max(...widths) : 0,
    maxHeightPx: heights.length ? Math.max(...heights) : 0,
  };
};

// DI-ANC-6 — pass through the allocator's read-only diagnostic from scene.meta
// (`rcllAncillaryAllocator`). We do NOT recompute anything here; the allocator
// already evaluated each candidate-final-rectangle and labelled every scope.
const BLOCKED_BAND_STATUSES = new Set([
  "gap-exists-current-algo-missed",
  "all-candidates-fail-validation",
  "root-capped",
  "ancestor-capped",
  "shared-slack-consumed",
]);

const summarizeAncillaryAllocator = (allocator) => {
  const diagnostics = Array.isArray(allocator.diagnostics)
    ? allocator.diagnostics
    : [];
  const statusCounts = {};
  for (const d of diagnostics) {
    statusCounts[d.bandBlockStatus] =
      (statusCounts[d.bandBlockStatus] ?? 0) + 1;
  }
  return {
    widenedHullCount: allocator.widenedHullCount ?? 0,
    allocatedWidthPx: allocator.allocatedWidthPx ?? 0,
    rowSavings: allocator.rowSavings ?? 0,
    fallbackDropCount: allocator.fallbackDropCount ?? 0,
    allocationCount: allocator.allocationCount ?? 0,
    statusCounts,
    diagnostics,
    // The actionable subset: bands still tall because a gap was missed or they
    // are genuinely boxed in. `gap-exists-current-algo-missed` here proves PR2
    // is worth building on this preset.
    blocked: diagnostics.filter((d) =>
      BLOCKED_BAND_STATUSES.has(d.bandBlockStatus),
    ),
  };
};

/**
 * Self-describing proof payload — the "what happened and why" answer in API form:
 *  - `requested`: the raw caller params (echoes the URL the caller sent).
 *  - `resolved`: the effective profile + the seven RCLL flags the engine actually ran,
 *     after profile expansion AND the toggle guards (so a profile or an alias is visible
 *     as its concrete flags, not just the param name).
 *  - `applied`: what the engine did + the rcll.* metrics (legacy shape, kept).
 *  - `suppressions`: an array of `{ option, reason, detail }` — the guard drops
 *     (rankSeparate-needs-rise, column-packing-conflict) AND measured no-ops (a compaction
 *     that moved zero columns on this preset). The honest "why it didn't change" list.
 */
const buildLayoutProofPayload = (
  presetId,
  requested,
  scene,
  layoutMode,
  extras = {},
) => {
  const elements = (scene.elements ?? []).filter((el) => !el.isDeleted);
  const meta = scene.meta ?? {};
  const placement = meta.rcllStageMeta?.placement ?? {};
  const gates = meta.gates ?? {};

  // The effective flags the engine ran (meta omits defaults, so coalesce to them).
  const resolvedFlags = {
    swimlaneLaneRise: meta.pipelineSwimlaneLaneRise ?? false,
    rankSeparate: meta.pipelineRankSeparate ?? false,
    deBandLevel: meta.pipelineDeBandLevel ?? "none",
    // Legacy boolean view (true iff deBandLevel === "subnet"), kept for back-compat.
    subnetDeBand: meta.pipelineSubnetDeBand ?? false,
    staircaseBandOverlap: meta.pipelineStaircaseBandOverlap ?? true,
    reorder: meta.pipelineReorder ?? false,
    crossingMin: meta.pipelineCrossingMin ?? false,
    straighten: meta.pipelineStraighten ?? false,
    columnPacking: meta.pipelineColumnPacking ?? "none",
  };

  // Honest "why it didn't fully apply" list, derived from the observable meta backstops
  // + measured no-ops. Each entry names the option, the reason, and a human detail.
  const suppressions = [];
  if (meta.pipelineRankSeparateSuppressed) {
    suppressions.push({
      option: "rankSeparate",
      reason: "needs-lane-rise",
      detail:
        "Lane split was dropped because Lane height = Risen was off (solo split is taller + wider).",
    });
  }
  if (meta.pipelineColumnPackingConflict) {
    suppressions.push({
      option: "columnPacking",
      reason: "conflict-compact-wins",
      detail:
        "Both spread and compact were set; compact (measure-verified) won.",
    });
  }
  if (meta.pipelineOrderingConflict) {
    suppressions.push({
      option: "reorder",
      reason: "conflict-crossing-min-wins",
      detail:
        "Both reorder and crossingMin were set; the container-aware crossingMin (superset) won and the leaf reorder was dropped.",
    });
  }
  if (resolvedFlags.crossingMin && placement.crossingMinApplied === 0) {
    suppressions.push({
      option: "crossingMin",
      reason: "no-op",
      detail:
        "Crossing-min found no strictly-improving reorder on this preset (order already crossing-minimal).",
    });
  }
  if (
    resolvedFlags.columnPacking === "compact" &&
    placement.columnCompactMovedCount === 0
  ) {
    suppressions.push({
      option: "columnPacking",
      reason: "no-op",
      detail:
        "Compaction moved 0 columns on this preset (dataflow already dense).",
    });
  }

  return {
    preset: presetId,
    // Reflects the *requested* layoutMode (defaulted to "rcll" when absent) — was
    // hardcoded "rcll" pre-strata (docs/strata-view-implementation-flow.md trap #5).
    view: layoutMode ?? "rcll",
    requested,
    resolved: {
      profile: meta.pipelineLayoutProfile ?? requested.profile ?? "balanced",
      flags: resolvedFlags,
      // Strata engine flags the layout actually ran (from the strata flagMeta echo).
      // All default off/0 on non-strata runs (meta omits them). Additive.
      strata: {
        networkSimplexRank: meta.strataNetworkSimplexRank ?? false,
        rankSeparate: meta.strataRankSeparate ?? false,
        coordinateRefine: meta.strataCoordinateRefine ?? false,
        sweeps: meta.strataSweeps ?? 0,
      },
    },
    applied: {
      pipelineRankSeparate: meta.pipelineRankSeparate ?? false,
      pipelineRankSeparateSuppressed:
        meta.pipelineRankSeparateSuppressed ?? false,
      pipelineSwimlaneLaneRise: meta.pipelineSwimlaneLaneRise ?? false,
      pipelineDeBandLevel: meta.pipelineDeBandLevel ?? "none",
      pipelineSubnetDeBand: meta.pipelineSubnetDeBand ?? false,
      pipelineStraighten: meta.pipelineStraighten ?? false,
      pipelineColumnPacking: meta.pipelineColumnPacking ?? "none",
      pipelineColumnPackingConflict:
        meta.pipelineColumnPackingConflict ?? false,
      pipelineReorder: meta.pipelineReorder ?? false,
      pipelineCrossingMin: meta.pipelineCrossingMin ?? false,
      pipelineOrderingConflict: meta.pipelineOrderingConflict ?? false,
      pipelineLayoutProfile: meta.pipelineLayoutProfile ?? null,
      rcllMilestone: meta.rcllMilestone ?? null,
      // Strata (S0a): once the engine-side wiring lands, `layoutMode=strata` should
      // echo pipelineLayoutVariant:"strata" + strataPassthrough:true here — the
      // proof-API side of the "resolved flags echoed in meta must match the
      // request" (C6′) discipline. `null`/`false` until that wiring lands.
      pipelineLayoutVariant: meta.pipelineLayoutVariant ?? null,
      strataPassthrough: meta.strataPassthrough ?? false,
      // Strata engine flag echoes (from scene.meta flagMeta) — additive; default
      // off/0 on non-strata runs. Proves a requested strata param was applied.
      strataNetworkSimplexRank: meta.strataNetworkSimplexRank ?? false,
      strataRankSeparate: meta.strataRankSeparate ?? false,
      strataCoordinateRefine: meta.strataCoordinateRefine ?? false,
      strataSweeps: meta.strataSweeps ?? 0,
      // W5 toggle echoes — the remaining engine flags exposed as URL params in
      // 17bd203f3. flagMeta writes each key present-only-when-active (flag-off
      // meta byte-identical), so `?? default` here reads the applied state
      // honestly: a value proves the engine actually ran the toggle.
      strataPackedScoring: meta.strataPackedScoring ?? false,
      strataPackedScoringEpsilon: meta.strataPackedScoringEpsilon ?? 0,
      strataEdgeRouting: meta.strataEdgeRouting ?? false,
      strataBorderRoute: meta.strataBorderRoute ?? false,
      // Wave-1 edge-routing probe echoes — flagMeta writes each present-only-
      // when-active, so `?? default` reads the applied state honestly (a value
      // proves the engine ran the toggle; the routed/styled counts prove
      // engagement). These arms silently no-op'd before the allowlist fix.
      strataChannelRoute: meta.strataChannelRoute ?? false,
      strataChannelRouteRouted: meta.strataChannelRouteRouted ?? null,
      strataEdgeStyle: meta.strataEdgeStyle ?? "straight",
      strataEdgeStyleStyled: meta.strataEdgeStyleStyled ?? null,
      // M3 curve-flatten telemetry — repair's keep/flatten verdict on the styled
      // routed polylines. The engine packs these into scene.meta only when a
      // routing/style pass stamped a polyline (routedSeen>0), so `?? null` reads
      // the applied state honestly: a NON-NULL kept/flattened pair proves
      // repair's downstream survival count reached scene.meta end-to-end (the M2
      // curve-flatten bug shipped invisibly BECAUSE this number did not exist).
      strataRoutedPolylinesKept: meta.strataRoutedPolylinesKept ?? null,
      strataRoutedPolylinesFlattened:
        meta.strataRoutedPolylinesFlattened ?? null,
      strataRoutedPolylinesKeptBy: meta.strataRoutedPolylinesKeptBy ?? null,
      strataRoutedPolylinesFlattenedBy:
        meta.strataRoutedPolylinesFlattenedBy ?? null,
      strataRoutedPolylinesUnresolved:
        meta.strataRoutedPolylinesUnresolved ?? null,
      strataSiftRelocate: meta.strataSiftRelocate ?? false,
      strataPackedConverge: meta.strataPackedConverge ?? false,
      strataTransitiveAdopt: meta.strataTransitiveAdopt ?? false,
      strataBlockClamp: meta.strataBlockClamp ?? false,
      strataTranspose: meta.strataTranspose ?? false,
      strataHeightGate: meta.strataHeightGate ?? false,
      strataChainRelocate: meta.strataChainRelocate ?? false,
      strataCoordCascade: meta.strataCoordCascade ?? false,
      strataLeafShift: meta.strataLeafShift ?? false,
      // Relocate-objective knobs — echoed by the engine only when a relocate
      // operator (sift/leaf-shift/…) actually consumes them, so `?? null` reads
      // honestly (a number proves the knob reached the engine's option bag).
      strataCrossWeightPenetration: meta.strataCrossWeightPenetration ?? null,
      strataCrossWeightEdge: meta.strataCrossWeightEdge ?? null,
      strataEdgeCrossCap: meta.strataEdgeCrossCap ?? null,
      strataDeBandLevel: meta.strataDeBandLevel ?? "none",
      // privateApiRegional and strataBandDepth are NOT echoed to scene.meta by
      // the engine, so `applied` must REPLICATE core's mode-scoping instead of
      // parroting the request. `terraformLayoutCore.ts:1176-1177` forces
      // pipelinePrivateApiRegional false for every non-strata layoutMode (it is
      // only wired for strata; it gate-fails on v2/rcll/compound/pipeline/
      // semantic), and strataBandDepth is a Strata-only cut the pipeline body
      // ignores off-strata — so reporting either as applied on a non-strata mode
      // (e.g. layoutMode=rcll&privateApiRegional=1) is a lie. Gate both on
      // strata; the caller's raw ask stays visible under `requested`.
      pipelinePrivateApiRegional:
        layoutMode === "strata" ? requested.privateApiRegional ?? false : false,
      strataBandDepth:
        layoutMode === "strata"
          ? requested.strataBandDepth ?? "account"
          : "account",
    },
    suppressions,
    bounds: computeSceneBounds(elements),
    elementCount: elements.length,
    // Rendered metrics + shared geometry fingerprint (additive; always present).
    ...(extras.metrics
      ? { metrics: extras.metrics, geometryHash: extras.metrics.geometryHash }
      : {}),
    // Profiler spans, only when ?timings=1 (additive; absent otherwise).
    ...(extras.timings ? { timings: extras.timings } : {}),
    rcll: {
      rankSeparateApplied: placement.rankSeparateApplied ?? null,
      rankSeparatePairCount: placement.rankSeparatePairCount ?? null,
      rankSeparateChangedRankCount:
        placement.rankSeparateChangedRankCount ?? null,
      rankSeparateFallback: placement.rankSeparateFallback ?? null,
      maxDepthPx: placement.maxDepthPx ?? null,
      columnCompactApplied: placement.columnCompactApplied ?? null,
      columnCompactMovedCount: placement.columnCompactMovedCount ?? null,
      columnCompactReclaimedCols: placement.columnCompactReclaimedCols ?? null,
      columnCompactEvalCapReached:
        placement.columnCompactEvalCapReached ?? null,
      crossingMinApplied: placement.crossingMinApplied ?? null,
      crossingMinBefore: placement.crossingMinBefore ?? null,
      crossingMinAfter: placement.crossingMinAfter ?? null,
      crossingMinMoves: placement.crossingMinMoves ?? null,
      crossingMinHeightDeltaPx: placement.crossingMinHeightDeltaPx ?? null,
      crossingMinWidthDeltaPx: placement.crossingMinWidthDeltaPx ?? null,
      crossingMinEvalCapReached: placement.crossingMinEvalCapReached ?? null,
      acyclicBackwardEdges: gates.acyclicBackwardEdges ?? null,
      acyclicSameColumnEdges: gates.acyclicSameColumnEdges ?? null,
      // M-ANC-2 widen: candidates>0 with applied=0 ⇒ whitespace exists but the
      // no-sideways-shift rule de-granted it (bands stay tall — the dormancy case).
      bandWidenCandidates: placement.bandWidenCandidates ?? null,
      bandWidenApplied: placement.bandWidenApplied ?? null,
      bandWidenTotalGrantPx: placement.bandWidenTotalGrantPx ?? null,
      bandWidenHeightSavedPx: placement.bandWidenHeightSavedPx ?? null,
    },
    ancillary: summarizeAncillaryFrames(elements),
    // DI-ANC-6 — surface (do not recompute) the allocator's read-only per-scope
    // diagnostic. The dev API can't run `recursiveRightSlackCeiling` or measure
    // the pre-ancillary bbox itself, so the allocator emits it into scene.meta
    // and we just pass it through. `bandBlockStatus` per scope says WHY a tall
    // band did/didn't widen — `gap-exists-current-algo-missed` is the bug PR2
    // targets. `blocked` is the convenience subset where a movement-free gap was
    // missed or the band is genuinely boxed in.
    ancillaryAllocator: summarizeAncillaryAllocator(
      meta.rcllAncillaryAllocator ?? {},
    ),
    regions: collectRegionFrames(elements),
  };
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.end(JSON.stringify(payload));
};

const parsePresetRoute = (url) => {
  const match = url.match(
    /^\/api\/terraform-import-presets\/([^/?]+)(\/[^?]*)?(?:\?.*)?$/,
  );
  if (!match) {
    return null;
  }
  return {
    presetId: decodeURIComponent(match[1]),
    suffix: match[2] ?? "",
  };
};

const parseCompositionRoute = (url) => {
  const match = url.match(
    /^\/api\/terraform-import-compositions\/([^/?]+)(\/[^?]*)?(?:\?.*)?$/,
  );
  if (!match) {
    return null;
  }
  return {
    compositionId: decodeURIComponent(match[1]),
    suffix: match[2] ?? "",
  };
};

// The terraformImportProfiler is MODULE-GLOBAL (one span stack, one totals map).
// Two concurrent `/api/terraform-layout` requests would interleave their spans and
// corrupt every timing. Serialize ALL layout work through a single promise chain so
// each request runs to completion before the next begins. Applied unconditionally
// (also stabilizes the numbers even when ?timings is off). A rejection never breaks
// the chain — the tail always resolves.
let layoutRequestQueue = Promise.resolve();
const enqueueLayout = (task) => {
  const run = layoutRequestQueue.then(task, task);
  layoutRequestQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};

export const terraformImportPresetDevPlugin = () => ({
  name: "terraform-import-preset-dev",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = req.url || "";

      // Headless RCLL layout — curl this to prove a toggle changed the geometry.
      // GET /api/terraform-layout?preset=<id>&rankSeparate=1&swimlaneRise=1 → JSON
      // metrics (bounds, applied/suppressed flags, per-region x/y). Read-only.
      if (url.startsWith(TERRAFORM_LAYOUT_API_ROUTE)) {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "Method not allowed." });
          return;
        }
        const queryString = url.includes("?")
          ? url.slice(url.indexOf("?") + 1)
          : "";
        const params = new URLSearchParams(queryString);

        // Self-documenting: `?describe=1` returns the param/profile catalog so a caller
        // can discover the vocabulary without a preset (or reading source).
        if (parseLayoutBooleanParam(params.get("describe")) === true) {
          sendJson(res, 200, LAYOUT_PARAM_CATALOG);
          return;
        }

        const presetId = (params.get("preset") ?? "").trim().toLowerCase();
        if (!presetId) {
          sendJson(res, 400, { error: "Missing required ?preset=<id>." });
          return;
        }

        // layoutMode: which engine variant runs. Default "rcll" preserves the
        // pre-strata proof-API behavior byte-for-byte when the param is absent.
        const layoutModeValue = parseLayoutEnumParam(
          params.get("layoutMode"),
          LAYOUT_MODE_ALLOWED,
        );
        if (layoutModeValue === null) {
          sendJson(res, 400, {
            error: `Invalid value for ?layoutMode (use ${LAYOUT_MODE_ALLOWED.join(
              "/",
            )}).`,
          });
          return;
        }
        const layoutMode = layoutModeValue ?? "rcll";

        const options = { layoutMode };
        const requested = {};
        if (layoutModeValue !== undefined) {
          requested.layoutMode = layoutModeValue;
        }
        for (const [param, optionKey] of LAYOUT_BOOLEAN_PARAMS) {
          const value = parseLayoutBooleanParam(params.get(param));
          if (value === null) {
            sendJson(res, 400, {
              error: `Invalid boolean for ?${param} (use 1/0/true/false).`,
            });
            return;
          }
          if (value !== undefined) {
            options[optionKey] = value;
            requested[param] = value;
          }
        }
        for (const [
          param,
          optionKey,
          allowed,
          caseSensitive,
        ] of LAYOUT_ENUM_PARAMS) {
          const value = parseLayoutEnumParam(
            params.get(param),
            allowed,
            caseSensitive === true,
          );
          if (value === null) {
            sendJson(res, 400, {
              error: `Invalid value for ?${param} (use ${allowed.join("/")}).`,
            });
            return;
          }
          if (value !== undefined) {
            options[optionKey] = value;
            requested[param] = value;
          }
        }
        for (const [param, optionKey] of LAYOUT_INT_PARAMS) {
          const value = parseLayoutIntParam(params.get(param));
          if (value === null) {
            sendJson(res, 400, {
              error: `Invalid integer for ?${param} (use a non-negative whole number).`,
            });
            return;
          }
          if (value !== undefined) {
            options[optionKey] = value;
            requested[param] = value;
          }
        }
        for (const [param, optionKey] of LAYOUT_EPS_PARAMS) {
          const value = parseLayoutEpsParam(params.get(param));
          if (value === null) {
            sendJson(res, 400, {
              error: `Invalid value for ?${param} (use a non-negative number; fractional only in relative mode 0<eps<1, integer for eps>=1).`,
            });
            return;
          }
          if (value !== undefined) {
            options[optionKey] = value;
            requested[param] = value;
          }
        }
        for (const [param, optionKey] of LAYOUT_NUM_PARAMS) {
          const value = parseLayoutNumParam(params.get(param));
          if (value === null) {
            sendJson(res, 400, {
              error: `Invalid value for ?${param} (use a non-negative finite number).`,
            });
            return;
          }
          if (value !== undefined) {
            options[optionKey] = value;
            requested[param] = value;
          }
        }

        // Profiler toggle. NOTE: the param is `timings` (alias `profileTimings`),
        // NOT `profile` — `profile` is the layout-profile enum (readable/balanced/
        // compact) parsed above. `?timings=1` adds the profiler-span array.
        const timingsParsed =
          parseLayoutBooleanParam(params.get("timings")) ??
          parseLayoutBooleanParam(params.get("profileTimings"));
        if (timingsParsed === null) {
          sendJson(res, 400, {
            error: "Invalid boolean for ?timings (use 1/0/true/false).",
          });
          return;
        }
        const timingsRequested = timingsParsed === true;

        try {
          // All layout work is serialized through a single queue: the profiler is
          // module-global, so concurrent requests must never interleave spans.
          const outcome = await enqueueLayout(async () => {
            const sources = getTerraformImportPresetSourcesFromDb(presetId);
            if (!sources) {
              return {
                status: 404,
                body: { error: `Preset "${presetId}" not found.` },
              };
            }
            await ensureLayoutDomGlobals();
            const [
              core,
              diagnosticsMod,
              pierceMod,
              hashMod,
              profilerMod,
              edgeCollapseMod,
            ] = await Promise.all([
              server.ssrLoadModule(LAYOUT_CORE_MODULE),
              server.ssrLoadModule(COLLISION_DIAGNOSTICS_MODULE),
              server.ssrLoadModule(PIERCE_METRICS_MODULE),
              server.ssrLoadModule(GEOMETRY_HASH_MODULE),
              server.ssrLoadModule(IMPORT_PROFILER_MODULE),
              server.ssrLoadModule(EDGE_COLLAPSE_MODULE),
            ]);

            // reset → enable → layout → summary → restore prior enabled-state.
            // Safe because we hold the queue lock (no interleaving possible).
            const priorEnabled =
              profilerMod.isTerraformImportProfilerEnabled();
            let timingsSummary = null;
            if (timingsRequested) {
              profilerMod.terraformImportProfilerReset();
              profilerMod.setTerraformImportProfilerEnabled(true);
            }
            let result;
            try {
              result = await core.layoutTerraformFromSources(sources, options);
            } finally {
              if (timingsRequested) {
                timingsSummary =
                  profilerMod.terraformImportProfilerSummary();
                profilerMod.setTerraformImportProfilerEnabled(priorEnabled);
              }
            }
            if (!result.ok) {
              return {
                status: result.status ?? 422,
                body: { error: result.error },
              };
            }
            const elements = (result.scene.elements ?? []).filter(
              (el) => !el.isDeleted,
            );
            // Soft-deleted edge-layer elements (customData.relationship),
            // revealed (isDeleted stripped) for the rendered metrics only —
            // see the W5 note on buildSceneMetrics.
            const revealedEdges = (result.scene.elements ?? [])
              .filter((el) => {
                if (!el.isDeleted) {
                  return false;
                }
                const rel = el.customData?.relationship;
                return rel != null && typeof rel === "object";
              })
              .map((el) => ({ ...el, isDeleted: false }));
            const bounds = computeSceneBounds(elements);
            const metrics = buildSceneMetrics(elements, revealedEdges, bounds, {
              diagnosePipelineScene: diagnosticsMod.diagnosePipelineScene,
              computePierceMetrics: pierceMod.computePierceMetrics,
              strataGeometryHash: hashMod.strataGeometryHash,
              detectEdgeCollapse: edgeCollapseMod.detectEdgeCollapse,
            });
            return {
              status: 200,
              body: buildLayoutProofPayload(
                presetId,
                requested,
                result.scene,
                layoutMode,
                { metrics, timings: timingsSummary },
              ),
            };
          });
          sendJson(res, outcome.status, outcome.body);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error("[terraform-layout] failed:", error);
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Layout failed.",
            ...(error instanceof Error && error.stack
              ? { stack: error.stack }
              : {}),
            ...(error instanceof Error && error.cause
              ? { cause: String(error.cause?.stack ?? error.cause) }
              : {}),
          });
        }
        return;
      }

      if (url.startsWith(TERRAFORM_PRESET_FILE_ROUTE)) {
        const encodedPath = url.slice(TERRAFORM_PRESET_FILE_ROUTE.length);
        let relativePath = "";
        try {
          relativePath = decodeURIComponent(encodedPath).replace(/\\/g, "/");
        } catch {
          res.statusCode = 400;
          res.end("Invalid encoded path");
          return;
        }
        const absolutePath = resolveTerraformImportFilePath(relativePath);
        if (!absolutePath) {
          res.statusCode = 403;
          res.end("Forbidden path");
          return;
        }
        try {
          const text = fs.readFileSync(absolutePath, "utf8");
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(text);
        } catch {
          res.statusCode = 404;
          res.end("File not found");
        }
        return;
      }

      if (url.startsWith(TERRAFORM_ARTIFACT_API_ROUTE)) {
        if (req.method === "GET" && url === TERRAFORM_ARTIFACT_API_ROUTE) {
          sendJson(res, 200, {
            artifacts: listTerraformImportArtifactsFromDb(),
          });
          return;
        }
        if (req.method === "POST" && url === TERRAFORM_ARTIFACT_API_ROUTE) {
          try {
            const body = await readJsonBody(req);
            const artifact = saveTerraformImportArtifactToDb(
              body.artifact ?? body,
            );
            sendJson(res, 201, { artifact });
          } catch (error) {
            sendJson(res, 400, {
              error:
                error instanceof Error ? error.message : "Invalid artifact.",
            });
          }
          return;
        }
        sendJson(res, 405, { error: "Method not allowed." });
        return;
      }

      const compositionRoute = parseCompositionRoute(url);
      if (compositionRoute && url.startsWith(TERRAFORM_COMPOSITION_API_ROUTE)) {
        const { compositionId, suffix } = compositionRoute;
        if (req.method === "GET" && suffix === "/sources") {
          try {
            const composition =
              getTerraformImportCompositionFromDb(compositionId);
            if (!composition) {
              sendJson(res, 404, { error: "Composition not found." });
              return;
            }
            const presetId = compositionId.replace(/-composition$/, "");
            const sources = getTerraformImportPresetSourcesFromDb(presetId);
            if (!sources) {
              sendJson(res, 404, { error: "Composition sources unavailable." });
              return;
            }
            sources.tfdTexts = [composition.tfdContent];
            sources.tfdLabels = ["composition.tfd"];
            sendJson(res, 200, { sources, composition });
          } catch (error) {
            sendJson(res, 400, {
              error:
                error instanceof Error
                  ? error.message
                  : "Composition sources unavailable.",
            });
          }
          return;
        }
        if (req.method === "POST" && url === TERRAFORM_COMPOSITION_API_ROUTE) {
          try {
            const body = await readJsonBody(req);
            const composition = saveTerraformImportCompositionToDb(
              body.composition ?? body,
            );
            sendJson(res, 201, { composition });
          } catch (error) {
            sendJson(res, 400, {
              error:
                error instanceof Error ? error.message : "Invalid composition.",
            });
          }
          return;
        }
        if (req.method === "GET" && compositionId && !suffix) {
          const composition =
            getTerraformImportCompositionFromDb(compositionId);
          if (!composition) {
            sendJson(res, 404, { error: "Composition not found." });
            return;
          }
          sendJson(res, 200, { composition });
          return;
        }
        sendJson(res, 405, { error: "Method not allowed." });
        return;
      }

      if (!url.startsWith(TERRAFORM_PRESET_API_ROUTE)) {
        next();
        return;
      }

      if (req.method === "GET" && url === TERRAFORM_PRESET_API_ROUTE) {
        sendJson(res, 200, { presets: listTerraformImportPresetsFromDb() });
        return;
      }

      if (
        req.method === "POST" &&
        url === `${TERRAFORM_PRESET_API_ROUTE}/seed-all`
      ) {
        try {
          const db = getTerraformImportPresetDb();
          const seedResult = seedAllBuiltinsFromCatalog(db);
          sendJson(res, 200, {
            presets: listTerraformImportPresetsFromDb(),
            ...seedResult,
          });
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Seed failed.",
          });
        }
        return;
      }

      const route = parsePresetRoute(url);
      const presetId = route?.presetId ?? null;
      const suffix = route?.suffix ?? "";

      if (req.method === "GET" && presetId && suffix === "/sources") {
        try {
          const sources = getTerraformImportPresetSourcesFromDb(presetId);
          if (!sources) {
            sendJson(res, 404, { error: "Preset not found." });
            return;
          }
          sendJson(res, 200, { sources });
        } catch (error) {
          sendJson(res, 400, {
            error:
              error instanceof Error ? error.message : "Sources unavailable.",
          });
        }
        return;
      }

      if (req.method === "GET" && presetId && !suffix) {
        const includeContent = url.includes("includeContent=1");
        const preset = getTerraformImportPresetFromDb(presetId, {
          includeContent,
        });
        if (!preset) {
          sendJson(res, 404, { error: "Preset not found." });
          return;
        }
        sendJson(res, 200, { preset });
        return;
      }

      if (req.method === "POST" && presetId && suffix === "/sync-from-disk") {
        try {
          const result = syncTerraformImportPresetFromDisk(presetId);
          const preset = getTerraformImportPresetFromDb(presetId);
          sendJson(res, 200, { preset, ...result });
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Sync failed.",
          });
        }
        return;
      }

      if (req.method === "POST" && url === TERRAFORM_PRESET_API_ROUTE) {
        try {
          const body = await readJsonBody(req);
          const preset = saveTerraformImportPresetToDb(body.preset);
          sendJson(res, 201, { preset });
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Invalid preset.",
          });
        }
        return;
      }

      if (req.method === "PUT" && presetId && !suffix) {
        try {
          const body = await readJsonBody(req);
          const preset = updateTerraformImportPresetInDb(presetId, body.preset);
          sendJson(res, 200, { preset });
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Update failed.",
          });
        }
        return;
      }

      if (req.method === "DELETE" && presetId && !suffix) {
        try {
          deleteTerraformImportPresetFromDb(presetId);
          sendJson(res, 200, { ok: true });
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Delete failed.",
          });
        }
        return;
      }

      sendJson(res, 405, { error: "Method not allowed." });
    });
  },
});
