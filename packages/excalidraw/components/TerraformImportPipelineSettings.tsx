/* eslint-disable max-lines */
import React from "react";

import { renderOptionFigure } from "./terraformPipelineSettingsFigures";

import {
  DEBAND_LEVELS,
  type DeBandLevel,
  type PipelineLayoutVariant,
  type RcllLayoutProfile,
  type RcllLayoutProfileSelection,
} from "./terraformImportDialogUtils";

/** Per-option explanation shown in the side panel — the detail a user needs to
 * understand what each choice actually does to the diagram. `dev` names the
 * actual algorithm/papers the option implements (this is a developer menu);
 * custom heuristics are flagged as such rather than attributed to a paper. */
type OptionHelpEntry = {
  title: string;
  body: string;
  dev: { implements: string; refs?: string[] };
};

/** Exported so the strata-only settings block (`TerraformStrataSettings.tsx`,
 * a dedicated component — strata's option set is small and unrelated to the
 * rcll/pipeline levers this component owns) can reuse the same explanation
 * shape/content instead of duplicating it. */
export const OPTION_HELP: Record<string, OptionHelpEntry> = {
  "detail.compact": {
    title: "Detail · Compact",
    body: "Each resource group is drawn as one representative card (the primary resource, e.g. an ECS service standing in for its task definition, target group, etc.). Click a card to expand the resources inside it. Smaller, faster, and easier to scan — you drill in only where you care.",
    dev: {
      implements:
        "Cluster collapse to a primary representative (interactive expand). A detail filter — no layout algorithm.",
    },
  },
  "detail.full": {
    title: "Detail · Full",
    body: "Every resource is drawn as its own card up front — nothing hidden. You see the complete picture immediately, but the diagram is much denser and taller and takes longer to lay out. Use it when you need to see everything at once rather than explore.",
    dev: {
      implements:
        "Fully-expanded clusters. A detail filter — no layout algorithm.",
    },
  },
  "layout.classic": {
    title: "Layout · Classic",
    body: "The original grid engine. Resources sit in left-to-right depth columns (by dataflow distance) and stack into vertical lanes. Predictable, and the only mode you fine-tune with the Height / Resources / Placement controls below.",
    dev: {
      implements:
        "Longest-path (ASAP) layered rank assignment + model-order lane stacking (computeDepths).",
      refs: ["Sugiyama, Tagawa & Toda 1981 — layered framework"],
    },
  },
  "layout.compound": {
    title: "Layout · Compound",
    body: "Same placement as Classic, but each geographic group is wrapped in a labelled, nested frame (provider → account → region → VPC → subnet). Dragging a frame moves everything inside it and reroutes its arrows. Pick this when the nesting matters visually.",
    dev: {
      implements:
        "Compound (clustered) layered layout — Classic ranks drawn inside the topology hull hierarchy, with TFD edges lifted onto hulls.",
      refs: ["Sander 1996 — Layout of Compound Directed Graphs"],
    },
  },
  "layout.v2": {
    title: "Layout · V2 (newest)",
    body: "Packs each geographic group into a compact, near-square block and spills fan-out targets beside their source instead of stacking them below (e.g. us-east-1 → us-west-1/2 + us-east-2 sit next to us-east-1, not in a tall column). It manages height and placement automatically, so those controls don't apply here.",
    dev: {
      implements:
        'Longest-path depth columns + geometric skyline (left-edge) strip packing; pure-sink fan-out bundles spilled rightward to fill the source\'s span — "elastic depth" (custom heuristic, order-safe by construction). Compound hull tree + edge lifting.',
      refs: [
        "Sander 1996 (compound + edge lifting)",
        "Hashimoto & Stevens 1971 (left-edge packing)",
        "Domrös & von Hanxleden 2022 (model-order ties)",
      ],
    },
  },
  "height.stacked": {
    title: "Height · Stacked",
    body: "One box per row. The tallest result, but the easiest to read straight down — nothing shares a row, so vertical position alone tells the story.",
    dev: {
      implements:
        "ASAP longest-path ranks, one lane per vertical band (no packing).",
      refs: ["Sugiyama, Tagawa & Toda 1981"],
    },
  },
  "height.packed": {
    title: "Height · Packed",
    body: "Boxes that don't conflict are slid side by side into the same row (skyline packing), cutting the diagram's height substantially at the cost of a busier layout.",
    dev: {
      implements:
        "Skyline / left-edge track assignment of column-disjoint boxes (placeClustersPackedGrid).",
      refs: [
        "Hashimoto & Stevens 1971 (left-edge)",
        "Baker, Coffman & Rivest 1980 (strip packing)",
      ],
    },
  },
  "height.pullLeft": {
    title: "Height · Packed + pull-left",
    body: "Packing, plus each box is pulled to its leftmost legal column — as early in the dataflow as its dependencies allow. Tightens the diagram horizontally and groups related work, but can lengthen some arrows.",
    dev: {
      implements:
        "1-D leftward compaction — leftmost feasible column via constraint-graph longest path (computePackedPullLeftShifts).",
      refs: ["Liao & Wong 1983 — 1-D compaction"],
    },
  },
  "resources.dataflow": {
    title: "Resources · Dataflow only",
    body: "Draw only resources connected by a .tfd dataflow edge. Keeps the diagram focused on the actual flow; standalone resources (IAM roles, log groups, …) are omitted.",
    dev: {
      implements: "Edge-connectivity content filter — no layout algorithm.",
    },
  },
  "resources.all": {
    title: "Resources · All resources",
    body: "Also draw the unconnected resources, collected into an 'Unconnected' strip per VPC/region so they don't clutter the flow. Primary resources (Lambda, S3, ECS, …) keep their full cluster grouping there — category color, nested satellites, expandable — so the strip is an inventory, not a pile of bare boxes. Works in all three layouts.",
    dev: {
      implements:
        "Ancillary resources grouped into per-region/VPC strips, each card built by the same primary-cluster builder as connected primaries (never the bare fallback). A content filter — no new layout algorithm.",
    },
  },
  "placement.default": {
    title: "Placement · Default",
    body: "Plain packing with no extra adjustment. Boxes in the same account/region may share vertical bands.",
    dev: { implements: "No post-pass on top of the chosen Height packing." },
  },
  "laneheight.stacked": {
    title: "Lane height · Stacked",
    body: "Inside a dependency lane (mutually-dependent accounts that share a left-to-right axis), nested groups stack straight down. Clearest vertically, but taller.",
    dev: {
      implements:
        "Swimlane interiors laid as pure Y-stacked lanes on the shared denseRank(LB) column axis (M3b arrangeSubtreeOnAxis).",
      refs: ["Sander 1996 — compound layout"],
    },
  },
  "laneheight.risen": {
    title: "Lane height · Risen",
    body: "Inside a dependency lane, groups whose columns don't overlap slide up to share a row instead of stacking, reclaiming vertical space. The shared left-to-right axis is kept, so the dataflow still reads forward. On its own the gain is small on dependency-dense presets — its big win is paired with Lane split, which makes more lanes column-disjoint.",
    dev: {
      implements:
        "DEC-1 Y-rise extended to swimlane lanes (M4): each lane's frame is tightened to its content shared-column range while leaf X is preserved (CON-12-safe); X-disjoint lanes share rows via riseStackY.",
      refs: ["Brandes & Köpf 2001 (coordinate assignment)"],
    },
  },
  "ordering.off": {
    title: "Ordering · Off",
    body: "Nodes inside each group stack in declaration order. Simplest, but arrows may cross more than necessary.",
    dev: {
      implements:
        "Within-column leaf order = model order (minDescendantSequence, key). No crossing-reduction pass.",
      refs: ["Sugiyama et al. 1981 (layered drawing)"],
    },
  },
  "ordering.on": {
    title: "Ordering · On",
    body: "Inside each group, nodes are reordered to reduce crossing arrows — a node moves next to the ones it connects to. Only applied when it actually cuts crossings, so it never makes a group worse. On presets whose order is already crossing-optimal (e.g. the staging v2) it finds nothing to change.",
    dev: {
      implements:
        "M6 per-container barycenter reorder with a strict-improve gate (terraformPipelineOrdering.ts): leaves are permuted within their column to minimize a geometric crossing count; accepted only if strictly fewer crossings, else model order. X (columns) untouched — iron rule unaffected.",
      refs: [
        "Sugiyama et al. 1981 (barycenter)",
        "Forster 2005 (crossing reduction)",
      ],
    },
  },
  "crossingmin.off": {
    title: "Cross-container · Off",
    body: "Crossing reduction stays within each group (see Ordering above). Arrows that run between groups keep whatever order the layering produced.",
    dev: {
      implements:
        "crossingMin=false: no global pass. Sibling order = the leaf reorder (if on) or model order. Cross-container long edges are unaddressed (DI-M6-3).",
    },
  },
  "crossingmin.on": {
    title: "Cross-container · On (supersedes Ordering)",
    body: "Reorders whole groups within their parent AND leaves within columns to cut arrows that cross BETWEEN groups — the thing the per-group Ordering pass can't reach. Each candidate order is re-placed and kept only if the actual drawn crossings strictly drop, so it never makes a diagram worse. Pays back the extra crossings that Lane split trades for height (measured −28% on the compact staging preset). Supersedes Ordering when both are on.",
    dev: {
      implements:
        "crossingMin (M6c): container-aware crossing minimization (terraformPipelineRcllCrossingMin.ts). A Sander/Forster hierarchical barycenter PROPOSES a sibling order (lanes within parents + leaves within columns); the candidate is re-placed on a clone and ACCEPTED only if the RENDERED crossing count (box.x/box.y, same kernel as diagnosePipelineScene) strictly drops AND containment/overlap gates don't regress. X never moves ⇒ CON-12 holds by construction; height/width unbounded but reported. Bounded sweeps + eval budget. Supersedes the leaf reorder (terraformPipelineToggleGuards.ts: ordering-conflict-crossing-min-wins).",
      refs: [
        "Sander 1996 (compound crossing reduction)",
        "Forster 2005 (crossing reduction)",
        "Brandes & Köpf 2001 (coordinate assignment)",
      ],
    },
  },
  "deband.depth": {
    title: "De-band depth",
    body: "How deep to dissolve the topology boxes. None keeps every level boxed (tallest, clearest ownership). Pick a level — subnet, VPC, region, account, or provider — and that level AND everything inside it collapse into one shared column stack. De-banding cascades downward: de-banding VPC also de-bands its subnets; provider merges everything. Dissolved membership reads from per-card colored rails + a legend instead of boxes. Subnet and VPC are the clean wins (much shorter, columns intact). Going deeper (region+) merges resources across containers that never shared a column axis, so it reshapes — and usually widens — the diagram; provider on a dense graph overflows into one giant stack. Use the deep levels deliberately.",
    dev: {
      implements:
        "De-band depth: collapseTreeForDeBand collapses at the absorbing parent (subnet→vpc, vpc→region, …, provider→root), lifting ALL descendant leaf clusters to direct children (one shared colCursor stack; X / colByCluster untouched → CON-12-safe at any level). collectClusterLeaves already recurses, so the cascade is automatic. Dissolved frames suppressed (emitTopologyContextFrames skips roles with rank ≥ target); topology paths truncated to the surviving level so edges/connectors reparent cleanly. Membership re-encoded as per-card rails (one per dissolved level) + a legend (terraformPipelineSubnetAnnotation.ts), gate/diagnostic-invisible.",
      refs: [
        "MapSets / BubbleSets (set-membership without overlapping regions)",
      ],
    },
  },
  "lanesplit.off": {
    title: "Lane split · Off",
    body: "Dependent sibling lanes keep their natural columns. Combined with risen lane height they may still overlap and stack. Leave off unless you also want the lane-separation win.",
    dev: {
      implements:
        "rankSeparate=false: denseClusterColumns uses the base longest-path floor; sibling lanes are not pushed into disjoint column ranges.",
    },
  },
  "lanesplit.on": {
    title: "Lane split · On (needs Lane height = Risen)",
    body: "One-way-dependent lanes (regions in an account, VPCs in a region) are pushed into separate columns so risen lanes can pack their height — much shorter (≈ −42% on the staging preset) at the cost of more width and a few more crossings. Only has an effect with Lane height = Risen, so it is disabled until you turn that on.",
    dev: {
      implements:
        "rankSeparate (M8r / DEC-13 / RFC §9.6): whole-model-global Sander base-node layering — one longestPath over the whole-model leaf DAG ∪ all-to-all separation edges per one-way quotient pair (mutual cycles stay co-axial). CON-12 forward by construction. Gated to swimlaneLaneRise (terraformPipelineToggleGuards.ts): alone it is taller + ~+28% width + ~+45% crossings; the height win is only realized once the M4 lane-rise shares the now-disjoint lanes' Y rows.",
      refs: ["Sander 1996 — Layout of Compound Directed Graphs"],
    },
  },
  "straighten.off": {
    title: "Straighten · Off",
    body: "Each group's nodes keep a plain top-down stack.",
    dev: {
      implements: "straighten=false: leaf Y is the naive within-column stack.",
    },
  },
  "straighten.on": {
    title: "Straighten · On",
    body: "Aligns fan-out spines and lifts direct resources into open Y space beside topology lanes where their columns do not overlap, keeping boxes collision-free.",
    dev: {
      implements:
        "straighten (M5): mixed lane/leaf occupancy plus two-sided size-aware Brandes–Köpf coordinate assignment rewrites leaf box.y to align with adjacent-column dataflow neighbours; Y-only, columns + within-column order untouched (CON-12-safe).",
      refs: ["Brandes & Köpf 2001 (coordinate assignment)"],
    },
  },
  "coordrepack.off": {
    title: "Coordinated re-pack · Off",
    body: "Leaf Y is whatever the straightener produced.",
    dev: {
      implements:
        "coordRepack=false: the Brandes–Köpf straightened placement is used as-is.",
    },
  },
  "coordrepack.on": {
    title: "Coordinated re-pack · On",
    body: "Refines the straightened result: within each group it re-orders and re-stacks a column's resources together so connected resources line up, never moving anything outside the band it already occupies and never making the picture worse.",
    dev: {
      implements:
        "coordRepack (M5b): per container, per column, a coordinated permutation re-pack on TOP of straighten (requires it). Brute-forces all permutations ≤8 leaves / deterministic barycenter + adjacent-swap coordinate-descent above; re-stacks each column pulled toward its intra-container dataflow barycenter, CLAMPED inside the fixed [bandTop, bandBottom] band (CON-3 — the band never grows). Adopted per-container only when total intra-container |ΔY| strictly decreases AND containment holds AND no overlap AND crossings do not increase (never-worse). Y + within-column order only; column X untouched (CON-12). Deterministic, no RNG (CON-8). Measured −27.2% intra-container edge |ΔY| on staging-extended-localstack-v2; ~0% on single-large-column presets.",
      refs: ["Brandes & Köpf 2001 (coordinate assignment)"],
    },
  },
  "columnpacking.spread": {
    title: "Column packing · Spread",
    body: "Spreads a crowded column by moving independent cards (no dependency edges) one column to the right, making vertical room. Has no effect where every crowded card has a dependency edge — e.g. the staging v2 — because the rule conservatively leaves connected cards alone.",
    dev: {
      implements:
        "deDensify (M5b, Axis-2 B): promotes a SAFE subset of same-floor independent leaves one column right (forward-only, column-preserving ⇒ CON-12-safe). The width dial deDensifyMaxCols defaults to 2 when enabled (terraformPipelineToggleGuards.ts). Measured no-op on v2 (dataflow too dense).",
    },
  },
  "columnpacking.none": {
    title: "Column packing · None (default)",
    body: "Columns keep every card where the dense-rank layering placed it — no spread, no compaction.",
    dev: {
      implements:
        "columnPacking=none: neither deDensify nor columnCompact runs; the dense-rank axis is untouched (OFF byte-identical).",
    },
  },
  "columnpacking.compact": {
    title: "Column packing · Compact",
    body: "Pulls independent cards LEFT into an earlier column's vertical whitespace to shrink the diagram's width, spending vertical room the group already has. A move is kept only when the re-measured group does not grow wider OR taller. Forward-only — never crosses a dependency edge (CON-12-safe).",
    dev: {
      implements:
        "columnCompact (M5c, Axis-2 A): measure-driven greedy leftward column reassignment in arrangeSwimlaneGroup; accepts a move only if re-placing a clone for the trial column map grows neither the hull width nor any inner frame height; empties + re-dense-ranks columns to realize the width win. CON-12 re-verified. Mutually exclusive with Spread.",
      refs: [
        "Rüegg et al. 2016 (1D compaction for smaller graph drawings)",
        "Liao & Wong 1983 (constraint-graph longest path)",
      ],
    },
  },
  "columnpacking.shorten": {
    title: "Column packing · Shorten",
    body: "Re-ranks the left→right columns to make the connecting arrows as short as possible, then pulls cards left to close the gap (Compact's win on top). The diagram reads narrower and the dataflow stays straighter (−8.4% width on the staging v2 preset). Note: this is mutually exclusive with Lane split (rankSeparate) — they rewrite the same column axis in opposite ways, and Lane split's height win is larger, so when Lane split is on, Shorten yields to it (a safe no-op) rather than ballooning the height.",
    dev: {
      implements:
        "Bundle: networkSimplexRank + columnCompact. networkSimplexRank replaces the longest-path depth floor with the Gansner TSE93 minimum-weighted-span ranking (computeNetworkSimplexDepths), applied via applyDepthFloorIfValid (verify-or-abort, dual-write cluster.depth + depthResult). LOSES to a live rankSeparate (mutually-exclusive column axis; rankSeparate+laneRise is the dominant height lever — NS destroys lane X-disjointness, +149% height); WINS over deDensify; compact is additive. networkSimplexApplied / nsSkipReason / pipelineNetworkSimplexRankSuppressed surfaced in scene meta. Probe (rankSeparate OFF): span 262→190 (−27.5%, the known optimum), width −8.4%, all CON gates 0.",
      refs: [
        "Gansner, Koutsofios, North & Vo 1993 (TSE — a technique for drawing directed graphs / the network-simplex ranker)",
        "Rüegg et al. 2016 (1D compaction)",
      ],
    },
  },
  "profile.readable": {
    title: "Layout · Readable",
    body: "The clearest, most spread-out arrangement. Mutually-dependent groups stack on their own rows, arrows are ordered to cross less, and fan-out spines are aligned. Tallest of the three — best when you want to follow the dataflow without anything sharing space.",
    dev: {
      implements:
        "Profile bundle: staircaseBandOverlap=false (cycles stack), reorder=on, straighten=on; no width-shrinking passes (laneRise/laneSplit off, deBandLevel=none, columnPacking=none).",
    },
  },
  "profile.balanced": {
    title: "Layout · Balanced (default)",
    body: "Today's default arrangement — a middle ground that keeps cycles compact (sharing rows where columns don't overlap) but applies no other reflow. Selecting it is identical to importing with no layout tuning at all.",
    dev: {
      implements:
        "Profile bundle = the shipped defaults: staircaseBandOverlap=on, everything else off (columnPacking=none). Byte-identical to no profile.",
    },
  },
  "profile.compact": {
    title: "Layout · Compact",
    body: "The smallest overall footprint. Turns on every space-saving pass at once: dependent lanes rise to share rows and split into separate columns, subnet boxes collapse into colored rails, and independent cards are pulled left. It is much shorter — and a bit wider, since splitting lanes trades some width for a lot of height (measured on the staging v2: roughly a third the area, but ~65% shorter and ~30% wider). Densest to read, best when vertical space is tight.",
    dev: {
      implements:
        "Profile bundle: laneRise + laneSplit (the −42% height / +28% width composition) + deBandLevel=subnet (≈ −28% height) + cycle-rise + columnPacking=compact (pull-left), plus reorder + straighten for legibility under the denser packing. Net area on v2 ≈ −55%.",
      refs: [
        "Sander 1996 (compound layout)",
        "Rüegg et al. 2016 (1D compaction)",
      ],
    },
  },
  "profile.custom": {
    title: "Layout · Custom",
    body: "You've adjusted one or more individual passes in Fine-tune below, so the layout no longer matches a named profile. Pick Readable, Balanced, or Compact above to snap back to a preset bundle.",
    dev: {
      implements:
        "Sentinel state: the seven RCLL flags no longer equal any profile's expansion. Re-selecting a profile re-applies its bundle.",
    },
  },
  "cycleheight.risen": {
    title: "Cycle height · Risen (default)",
    body: "Inside a mutually-dependent group, sub-groups whose columns don't overlap share a row instead of stacking — shorter. This is the default.",
    dev: {
      implements:
        "staircaseBandOverlap=true (M3b / DEC-1): X-disjoint cyclic SCC groups rise to share Y via riseStackY on the condensation staircase.",
    },
  },
  "cycleheight.stacked": {
    title: "Cycle height · Stacked",
    body: "Mutually-dependent sub-groups stack vertically in sequence instead of sharing rows — taller, but each group sits on its own row. Turns off a height-saving default.",
    dev: {
      implements:
        "staircaseBandOverlap=false: cyclic SCC groups are placed in sequential disjoint Y bands (no rise). Taller than the default.",
    },
  },
  "placement.semantic": {
    title: "Placement · Semantic",
    body: "Two clean-up passes on top of packing: (1) force each account and region into its own distinct horizontal band so regions never interleave vertically (clearer, but taller), and (2) straighten single-occupant lanes by nudging them toward the one resource that feeds them. It never reorders or overlaps boxes.",
    dev: {
      implements:
        "Forced topology bands + barycenter lane-order crossing reduction (experimental) + scoped lane straightening toward the predecessor centroid (cf. Gansner balance()).",
      refs: [
        "Sugiyama 1981 (barycenter)",
        "Gansner, Koutsofios, North & Vo 1993 (TSE93 balance())",
      ],
    },
  },
  // Strata (rcll-v2) opt-in engine passes — OD-2 (A2 K=4 ordering) / OD-5 (A7
  // refinement) dialog toggles, rendered by the dedicated
  // TerraformStrataSettings.tsx (imports this map).
  "strata.ordering.off": {
    title: "Layer ordering · Off",
    body: "Bands keep the initial model order — arrows between adjacent layers may cross more than necessary.",
    dev: {
      implements:
        "strataSweeps=0 (K=0): orderStrataUnits returns the initial content-key model order, byte-identical to the M1a checkpoint.",
    },
  },
  "strata.ordering.on": {
    title: "Layer ordering · On (K=4) — default",
    body: "Runs 4 barycenter sweeps per hull to reorder bands and cut crossing arrows between adjacent layers, keeping only the best-scoring order found. Validated default: the W5 battery measured K=4 (+A7) as the first Strata arm to beat the v2 view on predicted dependency-tracing cost.",
    dev: {
      implements:
        "strataSweeps=4 (A2, K=4, WP-3a): 4 barycenter sweeps per hull; the banded/packed selector scores {initial, sweep 1..4, height-aware greedy seed} and keeps the best (banded: weightedBandsSkippedCost + crossings tiebreak; packed: strict-crossings-decrease chain). Default ON since the W5 default flip.",
      refs: [
        "Sugiyama, Tagawa & Toda 1981 (barycenter ordering)",
        "docs/strata-view-w5-repaired-stats-report.md",
      ],
    },
  },
  "strata.straighten.off": {
    title: "Straighten (A7) · Off",
    body: "Containers keep the Y position the placement pass (A0) assigned.",
    dev: {
      implements:
        "strataCoordinateRefine=false: refineStrataCoordinates never runs; placement is A0 output, byte-identical.",
    },
  },
  "strata.straighten.on": {
    title: "Straighten (A7) · On — default",
    body: "Nudges each container's Y toward the median of the containers it connects to, straightening edges — kept only where it doesn't worsen order, bands, or overlap. Validated default: part of the K=4+A7 arm the W5 battery measured as the first task-metric win over v2.",
    dev: {
      implements:
        "strataCoordinateRefine=true (A7): refineStrataCoordinates runs a fixed 2-down/2-up sweep median/PAV nudge per hull, accepting a column only if total Σ|Δy| over its chords strictly decreases and stays order-preserving/non-overlapping.",
      refs: ["Brandes & Köpf 2001 (coordinate assignment)"],
    },
  },
  "strata.rankseparate.off": {
    title: "Compact height · Off",
    body: "Sibling stacks keep the rank the base longest-path pass assigned — one-way-dependent sibling containers stay stacked down the page instead of sharing a row.",
    dev: {
      implements:
        "strataRankSeparate=false: computeStrataSeparatedFloor never runs; rankStrataClusters uses the A1 base floor, byte-identical.",
    },
  },
  "strata.rankseparate.on": {
    title: "Compact height · On — trade-off",
    body: "Re-ranks one-way-dependent sibling stacks into disjoint column ranges so the packed skyline can place them side-by-side — a measured TRADE (W5): shorter canvas and better crossing angles, at the cost of more crossings on dependency paths (it undoes the K=4+A7 tracing win). Wins over network-simplex rank when both are requested (network-simplex is dropped, surfaced in scene meta).",
    dev: {
      implements:
        "strataRankSeparate=true (OD-14): computeStrataSeparatedFloor — whole-model-global Sander base-node layering (SCC-quotient + one-way-pair condensation, all-to-all leaf precedence per quotient pair; mutual cycles stay co-axial) REPLACES the A1 rank in rankStrataClusters. Mutually exclusive with strataNetworkSimplexRank — both rewrite the same column axis, so when both are requested rankSeparate wins and NS is suppressed (strataToggleSuppressions: rank-floor-conflict-rankseparate-wins-network-simplex).",
      refs: ["Sander 1996 — Layout of Compound Directed Graphs"],
    },
  },
  "strata.packedscoring.off": {
    title: "Packed edge scoring · Off",
    body: "Region/VPC sibling order keeps the legacy per-sweep acceptance: a reorder is accepted only when the LOCAL sibling-chord crossing count strictly decreases. Round 9 proved that counter blind to crossings against a sibling container's internal edges, so edge-shortening moves are often rejected.",
    dev: {
      implements:
        "strataPackedScoring=false: packed hulls keep the v2.0 strict-crossings-decrease acceptance chain in orderStrataUnits; byte-identical to the pre-round-9 engine.",
    },
  },
  "strata.packedscoring.on": {
    title: "Packed edge scoring · On — round-9 probe",
    body: "Every packed ordering candidate (initial + each sweep) is trial-placed on the real skyline and the WHOLE layout is scored: global edge crossings, then edges tunneling through unrelated containers, then total edge length. Fixes the round-9 blind spot (e.g. a regional SQS parked above a VPC it never talks to). Probe lever pending its gate battery.",
    dev: {
      implements:
        "strataPackedScoring=true (SDEC-57): placeStrataHullsPackedScored trial-places every packed sweep snapshot (chained unconditionally, no per-sweep gate) and selects the lexicographic (crossings, penetrations, L1 length) winner on real leaf-level geometry; banded hulls unchanged.",
      refs: [
        "Förster 2002 — Crossings in Clustered Level Graphs (properness precondition)",
      ],
    },
  },
  "strata.converge.off": {
    title: "Keep best order found · Off",
    body: "The packed scorer returns the LAST hull order its bounded-greedy descent was holding when it stopped — even when an earlier candidate it visited scored strictly better. Non-convergence measured on the owner's real config: the dominant candidate was held then dropped between passes.",
    dev: {
      implements:
        "strataPackedConverge=false: orderStrataUnits keeps the rolling incumbent as-is; byte-identical to the pre-converge engine.",
    },
  },
  "strata.converge.on": {
    title: "Keep best order found · On — G-DESCENT remedy",
    body: "Returns the best hull order the packed scorer found across the whole descent instead of the last one it tried — recovers a strictly-better order the descent visited then dropped (measured 174→169 crossings on the staging-extended-localstack-v2 preset). Inert unless the Crossing budget (ε) is 1 or more: with ε at 0 (strict) the incumbent can never regress, so best-seen and last-tried coincide.",
    dev: {
      implements:
        "strataPackedConverge / packedConverge — best-seen adopted snapshot under the active comparator (G-DESCENT remedy).",
      refs: ["strata-methodology-audit-2026-07-15"],
    },
  },
  "strata.transitive.off": {
    title: "Stable adoption rule · Off",
    body: "The packed scorer keeps the legacy ε adoption gate. That gate can be non-transitive: the descent may adopt a layout and later drop it for one that scores strictly worse (adopt-then-drop; audit 5.3).",
    dev: {
      implements:
        "strataTransitiveAdopt=false: legacy ε adoption gate (can be non-transitive — adopt-then-drop; audit 5.3). Byte-identical to the pre-fix engine.",
    },
  },
  "strata.transitive.on": {
    title: "Stable adoption rule · On — experimental",
    body: "Candidate layouts are compared with one strict total order for the whole descent, so an adopted layout can only ever be replaced by a strictly better one (fixes rare oscillation). ε is kept only as a feasibility crossing-cap. Experimental; small crossings tradeoff vs Keep best order found.",
    dev: {
      implements:
        "strataTransitiveAdopt / transitiveAdopt — replace the ε adoption gate with a strict total order (weightedC, lengthL1, crossings, penetrations); ε kept as a feasibility crossing-cap. Opt-in; descent-scoped; gated on the preference-calibration work. Small crossings tradeoff vs converge.",
    },
  },
  "strata.edgerouting.off": {
    title: "Route edges around containers · Off",
    body: "Every dependency arrow stays a straight centre-to-centre segment, even when it passes through a container box (hull frame or resource card) that is unrelated to both endpoints — W7/W8 measured 65–123 such penetrations per preset.",
    dev: {
      implements:
        "strataEdgeRouting=false: the scene build emits the legacy straight chords; the routing module never runs (byte-identical scenes).",
    },
  },
  "strata.edgerouting.on": {
    title: "Route edges around containers · On — W9 spike",
    body: "Arrows whose straight line would tunnel through an unrelated card are re-drawn as short forward detours around it (container outlines may be crossed — that reads better than a backward loop; endpoint ancestors stay permeable; everything else keeps its straight line). Bounded bends: an edge that cannot be routed cleanly within the cap, or only via an overlong detour, falls back to its straight chord.",
    dev: {
      implements:
        "strataEdgeRouting=true (Package C / W9 + E1.3 soft router): routeStrataSkeletonEdges detours card-penetrating TFD arrows around clearance-inflated foreign cards; hulls are soft (crossed at γ=40 cost), backtrack penalized (λ=1.5, net-forward edges), detours >1.8× chord capped back to the chord (≤6 waypoints, deterministic right/below-first ties).",
      refs: [
        "Wybrow/Marriott/Stuckey 2006 — Incremental Connector Routing",
        "Bouts & Speckmann 2015 — Clustered Edge Routing",
      ],
    },
  },
  "strata.borderroute.off": {
    title: "Exit containers through the nearest side · Off",
    body: "An arrow from a resource inside a container to a target outside it keeps its straight centre-to-centre line — a long diagonal slashing across the container interior on its way out (the P3-pierce look). Byte-identical scenes.",
    dev: {
      implements:
        "strataBorderRoute=false: the border-exit module never runs; the scene build emits the legacy straight chords (byte-identical).",
    },
  },
  "strata.borderroute.on": {
    title: "Exit containers through the nearest side · On — P3-pierce",
    body: "An arrow leaving its own container is re-drawn to exit cleanly at the side facing its target (a single boundary waypoint), so the interior diagonal becomes a short perpendicular exit. The boundary crossing itself cannot be removed (Jordan curve) — only made clean. Endpoints never move; an exit that would not shorten the interior span, or would re-enter a box, keeps its straight line. This is a purely visual win: it changes no scored metric (crossings, penetrations, edge length, and pierce.total all EXCLUDE own-container exits by design).",
    dev: {
      implements:
        "strataBorderRoute=true: routeStrataBorderExits re-emits each TFD arrow whose ancestor exit set is non-empty with an inner→outer facing-side boundary waypoint per exited hull (≤6, clamped to the side inset by PIPELINE_FRAME_PAD/2, strict interior-span decrease + no-re-penetration + no-new-foreign guards, deterministic ties). Post-geometry realization of Sander border-node insertion; disjoint from strataEdgeRouting.",
      refs: [
        "Sander 1996 — Layout of Compound Directed Graphs",
        "Bouts & Speckmann 2015 — Clustered Edge Routing",
      ],
    },
  },
  "strata.channelroute.off": {
    title: "Route edges through inter-rank channels · Off",
    body: "Cross-rank arrows keep their straight centre-to-centre chord — a diagonal that may cut across cards at a shallow angle. Byte-identical scenes (the channel-routing module never runs).",
    dev: {
      implements:
        "strataChannelRoute=false: routeStrataChannelEdges never runs; TFD arrows keep their two-point chords (byte-identical).",
    },
  },
  "strata.channelroute.on": {
    title: "Route edges through inter-rank channels · On — P1",
    body: "The owner's dummy-column idea. Each inter-rank arrow is re-drawn as Manhattan geometry: a perpendicular exit stub off the source card, one vertical run per traversed inter-column gap at an assigned track (tracks are interval-coloured and ordered by target-Y to reduce in-channel crossings), then a perpendicular entry stub into the target. All cross-axis displacement happens in the channels at 90°, so shallow near-flat diagonals across cards disappear. Zero-width channels in v1 — NO geometry moves. Endpoints never move; an edge whose channel path would pierce MORE cards than its chord keeps the chord (acceptance guard). Same-rank edges stay chords in v1. Runs first among the edge passes and owns the polyline topology.",
    dev: {
      implements:
        "strataChannelRoute=true: routeStrataChannelEdges derives columns by X-interval merging leafBoxes, routes each inter-rank TFD arrow to exit-stub → per-channel vertical run at a track X (left-edge interval colouring + Sander mean-target-Y ordering, trackGap clamped to channel width, 2px stacking on overflow) → entry-stub, stamps terraformRoutedPolyline, guards on pierce (never emit worse); emits per-channel occupancy. Composes UNDER edgeStyle (softens channel corners with roundness, no double-route).",
      refs: [
        "Hashimoto & Stevens 1971 — Wire Routing by Optimizing Channel Assignment",
        "Sander 1996 — Layout of Compound Directed Graphs",
        "Raykov 2021 — Orthogonal Edge Routing for Layered Graphs",
      ],
    },
  },
  "strata.edgeclip.off": {
    title: "Clip edges to container borders · Off",
    body: "Cross-container arrows keep their straight centre-to-centre chord and pass through container walls wherever the diagonal happens to cross them. Byte-identical scenes (the clip module never runs).",
    dev: {
      implements:
        "strataEdgeClip=false: routeStrataEdgeClip never runs; TFD arrows keep their two-point chords (byte-identical).",
    },
  },
  "strata.edgeclip.on": {
    title: "Clip edges to container borders · On — E2",
    body: "The Graphviz lhead/ltail idea. Each eligible cross-container dataflow arrow is clipped so it starts on the right edge of the source's box and ends on the left edge of the target's box, crossing every container border straight-on (perpendicular) rather than slashing across the interior at an angle. Ports are spread along each face so several arrows sharing a wall don't stack. Runs FIRST among all the edge passes and owns its eligible net-forward edges — the routers only see what it leaves.",
    dev: {
      implements:
        'strataEdgeClip=true: routeStrataEdgeClip clips each eligible net-forward cross-cluster declared arrow to LR frame-border ports (leaf-cluster frames + hull port chains), stamps terraformRoutedPolyline + terraformRoutedBy:"clip" + terraformClipAnchor, and repair validates them through the typed "clip" gate. Runs before channelRoute/edgeRouting/borderRoute/edgeStyle (first-stamper-wins), so they skip its edges; net-backward / same-column edges are left for them.',
      refs: [
        "Gansner et al. 1993 — A Technique for Drawing Directed Graphs (dot; lhead/ltail cluster clipping)",
      ],
    },
  },
  "strata.edgesmooth.off": {
    title: "Smooth routed edges · Off",
    body: "Routed and clipped arrows keep their raw waypoint geometry, rendered through Excalidraw's default through-point spline — orthogonal runs can read wavy and long lanes can bow into arcs. Byte-identical scenes (the smoothing module never runs).",
    dev: {
      implements:
        "strataEdgeSmooth=false: smoothStrataRoutedEdges never runs; stamped routed polylines keep their points and inherited roundness:{type:2} (byte-identical).",
    },
  },
  "strata.edgesmooth.on": {
    title: "Smooth routed edges · On — E3.1",
    body: "Smooths routed edges: rounds corners, straightens kinks, and draws exactly the computed path. A final finishing pass over every routed/clipped arrow — S-kinks are shortcut where the corridor is clear of cards, collinear points are deduped, remaining corners get a chamfer that escalates until it clears every card by 12px, and the rendered stroke follows the computed polyline exactly (no spline overshoot). Endpoints never move.",
    dev: {
      implements:
        'strataEdgeSmooth=true: smoothStrataRoutedEdges (GLEE refine-straighten-smooth) runs LAST among the edge passes over terraformRoutedBy channel/route/border/clip records ("style" skipped — already exact-path): inflection shortcut to fixpoint (triangle-vs-card-rect clearance), collinear dedupe with the ≥3-point floor, chamfer rounding with k∈{1/2,3/4,7/8} escalation against 12px-inflated card rects, ≤16 points/edge, roundness:null write-back. Endpoints/provenance/clip anchors untouched, so repair keeps every smoothed polyline.',
      refs: [
        "Nachmanson, Robertson & Lee 2007 — Drawing Graphs with GLEE (refine-straighten-smooth)",
      ],
    },
  },
  "strata.edgestyle.straight": {
    title: "Edge style · Straight",
    body: "No reshaping — edges are direct lines (default).",
    dev: {
      implements:
        'strataEdgeStyle="straight" (default): the terraformPipelineStrataEdgeStyle module never runs; TFD arrows keep their two-point chords (byte-identical).',
    },
  },
  "strata.edgestyle.step": {
    title: "Edge style · Step",
    body: "Right-angle connectors with rounded corners.",
    dev: {
      implements:
        'strataEdgeStyle="step": applyStrataEdgeStyle rewrites each un-routed TFD chord to a smoothstep polyline (20px stubs clamped to PIPELINE_FRAME_PAD, Z-bend at stepPosition 0.5, roundness type 2), stamping terraformRoutedPolyline; skips arrows already stamped by edgeRouting/borderRoute.',
      refs: ["React Flow (xyflow) — getSmoothStepPath (MIT)"],
    },
  },
  "strata.edgestyle.curve": {
    title: "Edge style · Curve",
    body: "Draws each data-flow edge as a smooth curve that keeps its direction easy to follow. Edges that would cut through a card stay straight.",
    dev: {
      implements:
        'strataEdgeStyle="curve": applyStrataEdgeStyle samples a cubic bezier (control offset 0.5·distance forward / 0.25·25·√|distance| backward) to a 14-point polyline per un-routed TFD chord, stamping terraformRoutedPolyline; skips already-routed arrows.',
      refs: ["React Flow (xyflow) — getBezierPath (MIT)"],
    },
  },
  // Routing PRESETS — the user-facing segmented control's five one-hot choices
  // (Off / Flow / Around boxes / Through channels / Border exits) plus the
  // transient "Custom" segment. Each preset maps ONE-HOT onto the four raw
  // router booleans (strataEdgeClip / strataEdgeRouting / strataChannelRoute /
  // strataBorderRoute) whose own per-toggle jargon lives in strata.edgeclip.* /
  // strata.edgerouting.* / strata.channelroute.* / strata.borderroute.* above
  // (surfaced only in the DEV composition drawer). Bodies are deliberately
  // plain — the technical detail stays in `dev`.
  "strata.routing.off": {
    title: "Routing · Off",
    body: "Edges connect directly.",
    dev: {
      implements:
        "All four routers off (strataEdgeClip = strataEdgeRouting = strataChannelRoute = strataBorderRoute = false): straight chords, byte-identical scenes.",
    },
  },
  "strata.routing.flow": {
    title: "Routing · Flow",
    body: "Flow — edges leave a resource's box on the right and enter the target's box on the left, crossing container borders straight-on. The arrow stops at the box border.",
    dev: {
      implements:
        'One-hot: strataEdgeClip=true only (routeStrataEdgeClip — Graphviz lhead/ltail container-boundary clipping; LR frame-border ports, hull port chains, terraformRoutedBy:"clip"). Runs first among all the edge passes and owns eligible net-forward edges.',
      refs: [
        "Gansner et al. 1993 — A Technique for Drawing Directed Graphs (dot; lhead/ltail cluster clipping)",
      ],
    },
  },
  "strata.routing.around": {
    title: "Routing · Around boxes",
    body: "Edges detour around cards in their path.",
    dev: {
      implements:
        "One-hot: strataEdgeRouting=true only (routeStrataSkeletonEdges detours card-penetrating arrows around foreign cards; hulls soft, direction-aware — E1.3).",
    },
  },
  "strata.routing.channels": {
    title: "Routing · Through channels",
    body: "Edges travel in shared lanes between columns.",
    dev: {
      implements:
        "One-hot: strataChannelRoute=true only (routeStrataChannelEdges — Manhattan geometry through inter-rank channels).",
    },
  },
  "strata.routing.border": {
    title: "Routing · Border exits",
    body: "Edges leave containers through the nearest side.",
    dev: {
      implements:
        "One-hot: strataBorderRoute=true only (routeStrataBorderExits — inner→outer facing-side boundary waypoint per exited hull).",
    },
  },
  "strata.routing.custom": {
    title: "Routing · Custom",
    body: "Two or more routing passes are combined (set by this link). Pick any preset to replace it, or keep it as-is.",
    dev: {
      implements:
        "A composed router combination (2+ of strataEdgeClip / strataEdgeRouting / strataChannelRoute / strataBorderRoute true) that no single preset represents. Reachable only from a URL; picking any preset writes the one-hot booleans.",
    },
  },
  "strata.banddepth": {
    title: "Band depth",
    body: "Choose the deepest role that still lays out as a full-width band — Root, Provider, Account, Region, VPC, or Zone. Every role below the cut packs X-disjoint siblings into shared rows instead of stacking one-per-row. Shallower cuts toward Root pack provider and account, which reclaims vertical height when Compact height (rankSeparate) is on. Region, VPC, and Zone cuts are experimental and usually make the canvas wider. Root is always banded — packing it would collapse the top-level providers side-by-side.",
    dev: {
      implements:
        'strataBandDepth (v3.2, default "account" — today\'s fixed role→policy map, byte-identical): resolveStrataHullPolicy(role, bandDepth) resolves every hull\'s policy generically from one monotone cut (STRATA_ROLE_DEPTH[role] <= STRATA_ROLE_DEPTH[bandDepth] ? "banded" : "packed"), consumed uniformly by A0 placement, A7 coordRefine, A2 ordering, and packed-scoring eligibility. LEGACY ALIAS: strataBandCompact=true resolves to strataBandDepth="root" when the enum is absent.',
    },
  },
  "strata.deband.none": {
    title: "Dissolve containers · Off",
    body: "Every level of the hierarchy — provider, account, region, VPC, subnet zone — is drawn as its own labelled box. You can see exactly which subnet or VPC a resource lives in, at the cost of one nested frame (and its title bar) per level.",
    dev: {
      implements:
        'strataDeBandLevel="none" (default): topologyPathForCluster returns the full path unchanged, so the hull tree, the emitted frames and the stamped customData.terraformTopologyPath are byte-identical to today. Off by construction, not by guard.',
    },
  },
  // De-band help is keyed PER RUNG, not shared. The rungs do not agree: at the
  // measured cut `subnet` wins on every axis while `vpc` REGRESSES height and
  // pierce-per-frame, and `region`/`account` were never measured at all. One
  // shared key made those per-level costs structurally unstatable (review round 1).
  "strata.deband.subnet": {
    title:
      "Dissolve containers \u00b7 Zones \u2014 measured win (root cut only)",
    body: "Dissolves the subnet-zone boxes and packs their resources straight into the VPC. Removes a level of nested frame chrome and lets resources from different subnets share a row \u2014 at the cost of no longer being able to see which subnet a resource sits in. MEASURED at the Root band depth: 40.5% shorter canvas (8,692 \u2192 5,170), 24% fewer crossings (173 \u2192 132), 13% less edge length, pierce-per-frame slightly better (1.737 \u2192 1.682) \u2014 at the cost of a 2.1\u00d7 slower build (14.3s \u2192 29.4s). Composes with Transpose (132 \u2192 116 crossings). CAVEAT: every one of those numbers was measured at Band depth = Root; at the shipped default (Account) this rung has ZERO measurement. Ignored (with a note in the scene meta) when the VPC that would absorb the resources is still a full-width band \u2014 see Band depth.",
    dev: {
      implements:
        'strataDeBandLevel="subnet" \u2014 keeps [provider,account,region,vpc]. strataDeBandLevel (OD-15 port, default "none"): dissolving level L is expressed ENTIRELY as topology-path truncation at the STRUCTURE phase (buildStrataModel \u2192 buildStrataHullTree \u2192 topologyPathForCluster(cluster, level), DEBAND_PATH_KEEP), so the dissolved hulls are never created, no frame is ever emitted for them (strata emits frames off the model tree \u2014 no v1-style suppression pass needed), and each leaf lands directly in the absorbing parent\'s leafClusterIds. Because it runs before A3/A1/A0+A2, rank, ordering, transpose and A7 all re-run over the collapsed model. SUPPRESSED (strataToggleSuppressions: "band-axis-conflict-banddepth-wins-deband-absorbing-parent-banded") when resolveStrataHullPolicy(absorbingParent, strataBandDepth) === "banded" \u2014 a lifted leaf under a banded parent becomes its own band-row; "provider" absorbs into the root, pinned banded, so it is never legal. SCOPE: OD-15\'s height claim was measured against v1\'s vpc="mixed" forced-subnet-band policy; strata\'s vpc is already "packed", so that collapse is already paid for. MEASUREMENT PROVENANCE: frozen preset staging-extended-localstack-v2, seed 20260704, real app path, rendered metrics, strataBandDepth="root" on EVERY arm (scratchpad/deband/focused.json, SDEC-71). Pierce is reported as piercePerTopoFrame \u2014 raw pierce is a denominator artifact here because de-band removes the very frames pierce counts.',
      refs: ["v1: collapseTreeForDeBand (terraformPipelineRcllPlacement.ts)"],
    },
  },
  "strata.deband.vpc": {
    title:
      "Dissolve containers \u00b7 VPCs \u2014 measured TRADE, regresses height",
    body: "Dissolves the VPC boxes AND the subnet zones inside them, packing every resource straight into the region. MEASURED at the Root band depth as a genuine TRADE, not a win: it buys 26% fewer crossings (173 \u2192 128), 31% less edge length and a 17% narrower canvas \u2014 but the canvas gets TALLER, not shorter (8,692 \u2192 8,937, +2.8%), arrows tunnel through the surviving frames MORE often (pierce-per-frame 1.737 \u2192 1.857, +6.9%), and the build takes 7.5\u00d7 longer (14.3s \u2192 107.8s, nearly two minutes). Pick this only if you want the narrower, shorter-edged canvas and can pay that height, pierce and build cost. CAVEAT: measured at Band depth = Root only; ZERO measurement at the shipped default (Account).",
    dev: {
      implements:
        'strataDeBandLevel="vpc" \u2014 keeps [provider,account,region]. strataDeBandLevel (OD-15 port, default "none"): dissolving level L is expressed ENTIRELY as topology-path truncation at the STRUCTURE phase (buildStrataModel \u2192 buildStrataHullTree \u2192 topologyPathForCluster(cluster, level), DEBAND_PATH_KEEP), so the dissolved hulls are never created, no frame is ever emitted for them (strata emits frames off the model tree \u2014 no v1-style suppression pass needed), and each leaf lands directly in the absorbing parent\'s leafClusterIds. Because it runs before A3/A1/A0+A2, rank, ordering, transpose and A7 all re-run over the collapsed model. SUPPRESSED (strataToggleSuppressions: "band-axis-conflict-banddepth-wins-deband-absorbing-parent-banded") when resolveStrataHullPolicy(absorbingParent, strataBandDepth) === "banded" \u2014 a lifted leaf under a banded parent becomes its own band-row; "provider" absorbs into the root, pinned banded, so it is never legal. SCOPE: OD-15\'s height claim was measured against v1\'s vpc="mixed" forced-subnet-band policy; strata\'s vpc is already "packed", so that collapse is already paid for. MEASUREMENT PROVENANCE: frozen preset staging-extended-localstack-v2, seed 20260704, real app path, rendered metrics, strataBandDepth="root" on EVERY arm (scratchpad/deband/focused.json, SDEC-71). Pierce is reported as piercePerTopoFrame \u2014 raw pierce is a denominator artifact here because de-band removes the very frames pierce counts. The vpc arm is the one measured REGRESSION in the changeset: normalizing pierce by surviving topology frames INVERTS its raw pierce "win" (66 \u2192 26 raw, but 38 \u2192 14 frames) into a regression \u2014 that inversion is why the normalization exists.',
      refs: ["v1: collapseTreeForDeBand (terraformPipelineRcllPlacement.ts)"],
    },
  },
  "strata.deband.region": {
    title: "Dissolve containers \u00b7 Regions \u2014 UNMEASURED",
    body: "Dissolves the region boxes and everything below them (VPCs, subnet zones), packing every resource straight into the account. NOT MEASURED: no A/B arm exists for this rung \u2014 the battery covered Zones and VPCs only, so no claim is made here about height, crossings, pierce or build time. Given that the VPCs rung already regresses height and costs 7.5\u00d7 the build, treat this deeper rung as exploratory. At the shipped default Band depth (Account) it is also SUPPRESSED \u2014 the account that would absorb the resources is still a full-width band, so every resource would land on its own row. Move Band depth shallower to make it legal.",
    dev: {
      implements:
        'strataDeBandLevel="region" \u2014 keeps [provider,account]. UNMEASURED: no arm in scratchpad/deband/focused.json. Suppressed at the default strataBandDepth="account" (absorbing parent is banded). strataDeBandLevel (OD-15 port, default "none"): dissolving level L is expressed ENTIRELY as topology-path truncation at the STRUCTURE phase (buildStrataModel \u2192 buildStrataHullTree \u2192 topologyPathForCluster(cluster, level), DEBAND_PATH_KEEP), so the dissolved hulls are never created, no frame is ever emitted for them (strata emits frames off the model tree \u2014 no v1-style suppression pass needed), and each leaf lands directly in the absorbing parent\'s leafClusterIds. Because it runs before A3/A1/A0+A2, rank, ordering, transpose and A7 all re-run over the collapsed model. SUPPRESSED (strataToggleSuppressions: "band-axis-conflict-banddepth-wins-deband-absorbing-parent-banded") when resolveStrataHullPolicy(absorbingParent, strataBandDepth) === "banded" \u2014 a lifted leaf under a banded parent becomes its own band-row; "provider" absorbs into the root, pinned banded, so it is never legal. SCOPE: OD-15\'s height claim was measured against v1\'s vpc="mixed" forced-subnet-band policy; strata\'s vpc is already "packed", so that collapse is already paid for.',
      refs: ["v1: collapseTreeForDeBand (terraformPipelineRcllPlacement.ts)"],
    },
  },
  "strata.deband.account": {
    title: "Dissolve containers \u00b7 Accounts \u2014 UNMEASURED",
    body: "Dissolves the account boxes and everything below them, packing every resource straight into the provider \u2014 the deepest legal rung, and the largest change to the picture. NOT MEASURED: no A/B arm exists for this rung, so no claim is made about height, crossings, pierce or build time. At the shipped default Band depth (Account) it is SUPPRESSED \u2014 the provider that would absorb the resources is still a full-width band, so every resource would land on its own row (one tall stack). Move Band depth shallower to make it legal.",
    dev: {
      implements:
        'strataDeBandLevel="account" \u2014 keeps [provider]. UNMEASURED: no arm in scratchpad/deband/focused.json. Suppressed at the default strataBandDepth="account" (absorbing parent is banded). strataDeBandLevel (OD-15 port, default "none"): dissolving level L is expressed ENTIRELY as topology-path truncation at the STRUCTURE phase (buildStrataModel \u2192 buildStrataHullTree \u2192 topologyPathForCluster(cluster, level), DEBAND_PATH_KEEP), so the dissolved hulls are never created, no frame is ever emitted for them (strata emits frames off the model tree \u2014 no v1-style suppression pass needed), and each leaf lands directly in the absorbing parent\'s leafClusterIds. Because it runs before A3/A1/A0+A2, rank, ordering, transpose and A7 all re-run over the collapsed model. SUPPRESSED (strataToggleSuppressions: "band-axis-conflict-banddepth-wins-deband-absorbing-parent-banded") when resolveStrataHullPolicy(absorbingParent, strataBandDepth) === "banded" \u2014 a lifted leaf under a banded parent becomes its own band-row; "provider" absorbs into the root, pinned banded, so it is never legal. SCOPE: OD-15\'s height claim was measured against v1\'s vpc="mixed" forced-subnet-band policy; strata\'s vpc is already "packed", so that collapse is already paid for.',
      refs: ["v1: collapseTreeForDeBand (terraformPipelineRcllPlacement.ts)"],
    },
  },
  "strata.siftrelocate.off": {
    title: "Reduce hull crossings · Off",
    body: "Container hulls keep the order the earlier ordering passes produced. Where two unrelated hulls sit close on the canvas, their dependency arrows may still cross through one another — the layout spends no extra effort pulling them apart.",
    dev: {
      implements:
        "strataSiftRelocate=false: neither the external-incidence sift nor the post-A7 relocation runs; hull order and placement stay byte-identical to the pre-OD-15 engine.",
    },
  },
  "strata.siftrelocate.on": {
    title: "Reduce hull crossings · On — OD-15",
    body: "Two passes work to cut crossings between whole container hulls — which the owner ranks ABOVE shorter edges (hull-crossings ≻ edge-length): a sift widens the sibling orderings the packed scorer will consider, and a relocation pass moves each hull beside the neighbours it actually links to once edges are straightened. Fewer arrows cross unrelated containers, sometimes at the cost of slightly longer edges. Off by default pending its gate battery.",
    dev: {
      implements:
        "strataSiftRelocate=true (OD-15): the external-incidence SIFT rides the packed-scoring descent (so it needs strataPackedScoring); the post-A7 RELOCATION runs regardless. Both minimise the weighted crossing cost C = penW·penetrations + crossW·edgeEdge.",
    },
  },
  "strata.blockclamp.off": {
    title: "Compact pure-sink accounts · Off",
    body: "A whole dead-end account (one that only receives connections, like an org audit/security account) keeps the far-right columns its longest-path rank assigned it, so its inbound arrows stay long and the diagram stays wide.",
    dev: {
      implements:
        "strataBlockClamp=false: the post-A7 P4 block-clamp pass never runs; pure-sink account blocks keep their rankSeparate columns and the engine is byte-identical.",
    },
  },
  "strata.blockclamp.on": {
    title: "Compact pure-sink accounts · On — P4",
    body: "Pulls an entire dead-end account block left toward its deepest real source, shortening the long cross-account arrows feeding it — but only when doing so doesn't add crossings or make the diagram taller. Provider frame extents are held fixed this phase, so it shortens the arrows without yet reclaiming overall diagram width.",
    dev: {
      implements:
        "strataBlockClamp=true (P4, Lever A): a post-A7 pass clamps each pure-sink account block to max(source rank)+1 (decoupled from any single source — the anchors are multi-source fan-in hubs), rigid-translating the whole subtree left in pixels, gated by X-containment + checkStrataStructure all-zero + the weighted-C/ε machinery, plus gate (d), the P5 height-maintained-or-decreased check (opt-in via strataHeightGate). NOTE gate (d) is INERT under phase 1 — a rigid X-only translate touches no box's y/height — so it cannot referee anything today; it exists so a phase-2 box-recompute inherits a live, per-hull gate (it previously compared a scene-global maxBottom scalar, which was vacuous-by-construction: blind to any non-tallest hull growing). This pass's measured null result at the frozen preset is scorer-vetoed, not height-vetoed: k=2 is +4 crossings/+2 penetrations against −23.8k px length. Never re-ranks (preserves the rankSeparate height lever).",
    },
  },
  "strata.heightgate.off": {
    title: "Keep containers from growing taller · Off",
    body: "The clamp pass stays inside each container's existing rows, so it only makes moves that need no extra vertical room — a container's height cannot change, and the layout is identical to today's.",
    dev: {
      implements:
        "strataHeightGate=false: phase-1 behavior, byte-identical. refineStrataBlockClamp's gate (d) is skipped (it is a rigid X-only translate, so no implied height can change either way).",
    },
  },
  "strata.heightgate.on": {
    title: "Keep containers from growing taller · On — P5 (Lever C)",
    body: "Checks every clamp move against each container it touches and throws the move away unless every one of them ends up the same height or shorter. Expect no visible change on this diagram — measured, not guaranteed: the moves these passes happen to make here are all height-safe already, so the check has nothing to catch. On other diagrams it can genuinely reject a move that would have made a container taller. It is the referee a later pass needs, the one that will move neighbours aside to make room.",
    dev: {
      implements:
        "strataHeightGate=true (P5, Lever C): applies strataHeightGateAdmits (terraformPipelineStrataHeightGate.ts) as gate (d) in refineStrataBlockClamp. Metric = per-hull IMPLIED content height, ∀-quantified: maxBottom(h) = max(topInset(h), max over placed of (box.y + box.height − hull.box.y)); impliedHeight = maxBottom + FRAME_PAD — mirroring placeStrataHulls step 5 (terraformPipelineStrataPlacement.ts:346-360) verbatim, pinned by an anchor test asserting it reproduces box.height exactly. NOT the stored box.height (the pass holds hull boxes fixed ⇒ a gate over stored heights is provably vacuous) and NOT a scene-global scalar (the shipped bug this replaces: max(y+height) is dominated by the tallest/root extent and blind to a non-tallest hull growing). Height is a GATE only — never a term in the packed objective ({crossings, penetrations, lengthL1} unchanged), never a trade, never a tiebreak. INERT in refineStrataBlockClamp under phase 1 (rigid X-only translate); it ships as the referee a phase-2 occupant-displacement relaxation needs. strataTranspose is envelope-preserving and needs no gate. Stage 2 (not built): occupant displacement + VPSC slack-aware Y-repair + box recompute.",
      refs: [
        "Jabrayilov, Mallach, Mutzel, Rüegg & Wagner 2016 — Compact Layered Drawings of General Directed Graphs (bound one dimension, optimize the other)",
        "Dwyer, Marriott & Stuckey 2006 — Fast Node Overlap Removal / IPSep-CoLa (VPSC gradient projection — Stage 2)",
        "Coffman & Graham 1972 — Optimal Scheduling for Two-Processor Systems (width-bounded layering)",
      ],
    },
  },
  "strata.transpose.off": {
    title: "Transpose crossing reduction · Off",
    body: "Layer ordering keeps the order the barycenter sweeps produced, with no adjacent-swap cleanup pass.",
    dev: {
      implements:
        "strataTranspose=false: the post-A7 within-column transpose pass never runs; sibling Y-order is left exactly as ordering + placement produced it and the engine is byte-identical.",
    },
  },
  "strata.transpose.on": {
    title: "Transpose crossing reduction · On — P2",
    body: "After Layer ordering runs, repeatedly swap neighbouring boxes within a band whenever the swap removes a crossing — catching crossings the barycenter sweeps leave behind, and only kept when it strictly improves.",
    dev: {
      implements:
        "strataTranspose=true (P2): a post-A7 pass (transposeStrataColumns, terraformPipelineStrataTranspose.ts) that partitions each hull's placed siblings into X-column-overlap groups and iterates direction-alternating adjacent Y-exchanges of X-OVERLAPPING pairs (the complement of the X-DISJOINT vertical-relocate). The adjacent exchange is envelope-preserving (union span unchanged ⇒ hull height invariant), gated by checkStrataStructure all-zero + strataRelocateAdoptable (weighted-C + edge-cross cap + ε) scored on real leaf geometry. X untouched (CON-12-safe, no X-compaction); never re-ranks (preserves the rankSeparate height lever).",
      refs: [
        "Gansner, Koutsofios, North & Vo 1993 — A Technique for Drawing Directed Graphs (the transpose heuristic)",
      ],
    },
  },
  "strata.coordcascade.off": {
    title: "Coordinate cascade · Off",
    body: "The straighten pass stops at the first column arrangement it cannot improve one column at a time. Where two columns are each locally optimal but a joint move would untangle them, that crossing stays.",
    dev: {
      implements:
        "strataCoordCascade=false: per-column coordinate refinement (A7) halts at its net-zero fixed point; no tie-cascade runs and the engine is byte-identical.",
    },
  },
  "strata.coordcascade.on": {
    title: "Coordinate cascade · On",
    body: "Extends Straighten edges: when a column reaches a net-zero tie the straighten pass would otherwise stop at, it escapes to its two-sided median and chases the improvement, keeping the move only if it shortens edges on the A7 length proxy. Cuts more crossings than the straighten pass alone. Measured on the flagship preset: crossings 116 → 98 (−15.5%), routed edge length −1.6%, height unchanged. Does nothing unless Straighten edges is on. Off by default (experimental).",
    dev: {
      implements:
        "strataCoordCascade=true (A7 tie-cascade, extends strataCoordinateRefine): a net-zero fixed-point column escapes to its two-sided median + chase, adopt-or-rollback on the A7 length proxy. Inert unless strataCoordinateRefine. Measured (P2 audit-config): −15.5% rendered crossings / −1.6% routed edge length / height-gated.",
    },
  },
  "strata.chainrelocate.off": {
    title: "Chain relocate · Off",
    body: "A unit and the resources that depend only on it (a lambda, its SSM parameter, its database) each keep the row their own rank assigned, so the arrows chaining them can stay longer than they need to be.",
    dev: {
      implements:
        "strataChainRelocate=false: the post-A7 exclusive-downstream chain relocate never runs; unit placement stays byte-identical.",
    },
  },
  "strata.chainrelocate.on": {
    title: "Chain relocate · On",
    body: "After edges are straightened, slides a unit together with its exclusive downstream chain — the resources that depend only on it (its SSM parameter, its database) — vertically as one rigid group, shortening the arrows that link them without disturbing anything else. Measured on the flagship preset: routed edge length −4.3%, crossings 116 → 113, height unchanged. Off by default (experimental).",
    dev: {
      implements:
        "strataChainRelocate=true: a post-A7 pass that rigid-translates a unit plus its exclusive downstream chain vertically to shorten edges, adopt-or-rollback scored. Strata-only. Measured: −4.3% routed edge length, crossings 116 → 113, height unchanged.",
    },
  },
  "strata.crosspenweight": {
    title: "Penetration weight (penW)",
    body: "How heavily the crossing objective counts a dependency arrow that tunnels straight through an unrelated container box. Raise it to punish tunnelling harder; lower it toward 0 to tolerate more. Applies while any crossing-reduction relocation pass — Reduce hull crossings, Pull leaf sinks toward source, or Compact pure-sink accounts — is on.",
    dev: {
      implements:
        "strataCrossWeightPenetration (penW, default 1, integer ≥ 0): the penetrations coefficient in the weighted crossing cost C = penW·penetrations + crossW·edgeEdge minimised by the sift + relocation.",
    },
  },
  "strata.crossedgeweight": {
    title: "Edge-crossing weight (crossW)",
    body: "How heavily the crossing objective counts two dependency arrows crossing each other. Raise it to prioritise untangling arrow-vs-arrow crossings; lower it toward 0 to focus on box tunnelling instead. Applies while any crossing-reduction relocation pass — Reduce hull crossings, Pull leaf sinks toward source, or Compact pure-sink accounts — is on.",
    dev: {
      implements:
        "strataCrossWeightEdge (crossW, default 1, integer ≥ 0): the edge-edge coefficient in the weighted crossing cost C = penW·penetrations + crossW·edgeEdge minimised by the sift + relocation.",
    },
  },
  "strata.edgecrosscap": {
    title: "Edge-crossing cap (optional)",
    body: "An optional ceiling on how many extra arrow-vs-arrow crossings a single crossing-reduction move may add before it is rejected. Leave it blank to inherit the packed edge-scoring crossing budget (ε). Set a number to cap it independently. Applies while any crossing-reduction relocation pass — Reduce hull crossings, Pull leaf sinks toward source, or Compact pure-sink accounts — is on.",
    dev: {
      implements:
        "strataEdgeCrossCap (optional; blank ⇒ inherits strataPackedScoringEpsilon): the ε-style edge-edge regression cap the relocation may not exceed.",
    },
  },
  // Private API placement help was removed with its control (owner-decisions.md
  // 2026-07-17 Q9: strata always places private REST APIs regionally; the engine
  // clamps `pipelinePrivateApiRegional` true, so there is no Off/On toggle to
  // explain). The legacy `privateApiRegional` URL param stays parsed but inert.
  // Resources help is keyed SEPARATELY for strata rather than reusing
  // "resources.all": the content filter is the same, but strata's cost is not.
  // The generic entry says "collected into an 'Unconnected' strip … works in
  // all three layouts" and states no price; in strata the bands are the LAST
  // geometry stage and are invisible to every optimizer, so they buy that
  // inventory with substantial scene height. One shared key would make that
  // cost structurally unstatable — the same reason de-band is keyed per rung.
  "strata.resources.dataflow": {
    title: "Resources · Dataflow only",
    body: "Draw only resources connected by a .tfd dataflow edge. Keeps the diagram focused on the actual flow; standalone resources (IAM roles, log groups, …) are omitted. The default, and the shorter canvas — see All resources for what the inventory costs.",
    dev: {
      implements:
        "pipelineIncludeAncillary=false (default): the strata engine never calls buildAncillaryStrips, so no strips are built, no bands are injected and the scene is byte-identical to today. Off by construction, not by guard.",
    },
  },
  "strata.resources.all": {
    title: "Resources · All resources — costs substantial height",
    body: "Also draw the unconnected resources, collected into an 'Unconnected' band per scope so they don't clutter the flow. Primary resources (Lambda, S3, ECS, …) keep their full cluster grouping there — category color, nested satellites, expandable — so the band is an inventory, not a pile of bare boxes. Under Dissolve containers the bands relocate to the surviving ancestor hull and NEST, so you can still see which VPC or region each unconnected resource came from. COSTS SUBSTANTIAL SCENE HEIGHT — MEASURED at Band depth = Root with Transpose on: with Dissolve containers off, 8,692 → 14,465px (+66%); with Dissolve containers = VPCs, 8,013 → 15,106px (+88%). Your dataflow diagram is never moved sideways to make room: X and width are frozen and the canvas may only grow downward, so the flow you were reading keeps its shape — you just scroll further.",
    dev: {
      implements:
        'pipelineIncludeAncillary=true. Ancillary resources are grouped into per-scope strips (buildAncillaryStrips), each card built by the same primary-cluster builder as connected primaries (never the bare fallback), then injected as bands in the LAST geometry stage (plan §3d) — after A7/relocate/transpose/blockClamp, which score over model UNITS and cannot see bands, and BEFORE checkStrataStructure, which re-validates model geometry post-growth for free. §3o greedy right-slack allocator ON by default: widens each band into PRE-EXISTING right slack to cut band height, validates every grant end-to-end, and degrades to the §3f host-interior baseline one lowest-benefit grant at a time. STATED COST: bands get no crossing-min, no height gate and no compaction — they are invisible to every optimizer and can create a tall dead zone no pass reclaims; the allocator is the only lever that reclaims it. INVARIANT: injection only grows Y downward (X/width frozen), so dataflow geometry is never displaced laterally. §3g containment check (checkStrataAncillaryContainment) is the ONLY check that sees bands — any band/leaf overlap, host escape or title collision drops the bands and keeps the strata scene (strataAncillaryDegraded), never degrading to v2. MEASUREMENT PROVENANCE: N=1, frozen preset staging-extended-localstack-v2, strataBandDepth="root", strataTranspose on, real app path, rendered extent.',
    },
  },
};

export type OptionHelpKey = keyof typeof OPTION_HELP;

/** Human labels for the de-band depth `<select>` options. */
const DEBAND_LEVEL_LABELS: Record<DeBandLevel, string> = {
  none: "None — keep every level boxed",
  subnet: "Subnet",
  vpc: "VPC (+ subnets)",
  region: "Region (+ VPCs, subnets)",
  account: "Account (+ regions …)",
  provider: "Provider (everything)",
};

export const TerraformImportPipelineSettings = ({
  pipelineCompact,
  pipelineLayoutVariant,
  pipelinePacked,
  pipelinePackedPullLeft,
  pipelineIncludeAncillary,
  pipelineSemanticPlacement,
  pipelineSwimlaneLaneRise,
  pipelineReorder,
  pipelineCrossingMin,
  pipelineDeBandLevel,
  pipelineRankSeparate,
  pipelineStraighten,
  pipelineCoordRepack,
  pipelineColumnPacking,
  pipelineLayoutProfile,
  pipelineStaircaseBandOverlap,
  setPipelineCompact,
  setPipelineLayoutVariant,
  setPipelinePacked,
  setPipelinePackedPullLeft,
  setPipelineIncludeAncillary,
  setPipelineSemanticPlacement,
  setPipelineSwimlaneLaneRise,
  setPipelineReorder,
  setPipelineCrossingMin,
  setPipelineDeBandLevel,
  setPipelineRankSeparate,
  setPipelineStraighten,
  setPipelineCoordRepack,
  setPipelineColumnPacking,
  setPipelineLayoutProfile,
  setPipelineStaircaseBandOverlap,
  showPlacement = true,
  showVariant = true,
}: {
  pipelineCompact: boolean;
  pipelineLayoutVariant: PipelineLayoutVariant;
  pipelinePacked: boolean;
  pipelinePackedPullLeft: boolean;
  pipelineIncludeAncillary: boolean;
  pipelineSemanticPlacement: boolean;
  pipelineSwimlaneLaneRise: boolean;
  pipelineReorder: boolean;
  pipelineCrossingMin: boolean;
  pipelineDeBandLevel: DeBandLevel;
  pipelineRankSeparate: boolean;
  pipelineStraighten: boolean;
  pipelineCoordRepack: boolean;
  pipelineColumnPacking: "spread" | "none" | "compact" | "shorten";
  pipelineLayoutProfile: RcllLayoutProfileSelection;
  pipelineStaircaseBandOverlap: boolean;
  setPipelineCompact: (compact: boolean) => void;
  setPipelineLayoutVariant: (variant: PipelineLayoutVariant) => void;
  setPipelinePacked: (packed: boolean) => void;
  setPipelinePackedPullLeft: (pullLeft: boolean) => void;
  setPipelineIncludeAncillary: (includeAncillary: boolean) => void;
  setPipelineSemanticPlacement: (semanticPlacement: boolean) => void;
  setPipelineSwimlaneLaneRise: (swimlaneLaneRise: boolean) => void;
  setPipelineReorder: (reorder: boolean) => void;
  setPipelineCrossingMin: (crossingMin: boolean) => void;
  setPipelineDeBandLevel: (deBandLevel: DeBandLevel) => void;
  setPipelineRankSeparate: (rankSeparate: boolean) => void;
  setPipelineStraighten: (straighten: boolean) => void;
  setPipelineCoordRepack: (coordRepack: boolean) => void;
  setPipelineColumnPacking: (
    columnPacking: "spread" | "none" | "compact" | "shorten",
  ) => void;
  setPipelineLayoutProfile: (profile: RcllLayoutProfile) => void;
  setPipelineStaircaseBandOverlap: (staircaseBandOverlap: boolean) => void;
  /** Experimental view hides Placement — Semantic forced-bands competes with its engine. */
  showPlacement?: boolean;
  /** RCLL view hides the Layout variant + Height — it owns placement (M0 delegates to Compound). */
  showVariant?: boolean;
}) => {
  // V2 is a self-contained engine: it pins X to global TFD depth columns and
  // 2-D-packs hulls by construction, so the Height / Resources / Placement
  // controls (all classic/compound-only post-passes) do nothing under it.
  // Hiding them removes dead controls rather than letting the user toggle
  // options the V2 builder ignores.
  const isV2 = pipelineLayoutVariant === "v2";

  // RCLL is the view that hides the Layout-variant control (mirrors the swimlane
  // control's gating); the dialog's `pipelineLayoutVariant` state is NOT "rcll".
  const isRcll = !showVariant;

  // The side panel shows the option being hovered/focused (preview); when the
  // pointer leaves it falls back to the last option clicked (sticky), seeded
  // with the current Layout variant so it is never empty on open.
  const layoutHelpKey = `layout.${pipelineLayoutVariant}` as OptionHelpKey;
  const [hoverKey, setHoverKey] = React.useState<OptionHelpKey | null>(null);
  const [stickyKey, setStickyKey] =
    React.useState<OptionHelpKey>(layoutHelpKey);
  const activeKey = hoverKey ?? stickyKey;
  const activeHelp = OPTION_HELP[activeKey] ?? OPTION_HELP[layoutHelpKey];
  // Decorative before/after schematic for the active option (null for content
  // filters / layout-variant keys that have no geometry to show).
  const activeFigure = renderOptionFigure(activeKey);

  const option = (
    label: string,
    pressed: boolean,
    helpKey: OptionHelpKey,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      type="button"
      className={`TerraformImportModal__segmentedButton${
        pressed ? " TerraformImportModal__segmentedButton--active" : ""
      }`}
      aria-pressed={pressed}
      // `aria-disabled` (not native `disabled`) keeps the button focusable, so
      // the "why is this off?" explanation is reachable by keyboard (Tab) and by
      // hover; only the click action is suppressed (below). Native `disabled`
      // buttons are not focusable, which hides the explanation from keyboard users.
      aria-disabled={disabled || undefined}
      title={OPTION_HELP[helpKey].body}
      onMouseEnter={() => setHoverKey(helpKey)}
      onMouseLeave={() => setHoverKey(null)}
      onFocus={() => setHoverKey(helpKey)}
      onBlur={() => setHoverKey(null)}
      onClick={() => {
        setStickyKey(helpKey);
        if (!disabled) {
          onClick();
        }
      }}
    >
      {label}
    </button>
  );

  // A small uppercase section label that announces the next pipeline phase, so
  // the RCLL controls read top-to-bottom as the order the engine applies them
  // (Sugiyama: content → structure → layer/columns → ordering → coordinate/Y).
  const phaseHeader = (label: string, hint: string) => (
    <div
      className="TerraformImportModal__layoutSettingsGroupHeader"
      aria-hidden="true"
    >
      {label}
      <span>{hint}</span>
    </div>
  );

  // Detail + Resources are the two content filters shared by every layout (RCLL
  // and Classic/Compound/V2), so they are extracted once and placed by branch.
  const detailGroup = (
    <div role="group" aria-label="Pipeline detail level">
      <span className="TerraformImportModal__controlLabel">
        Detail <span>how much of each cluster to draw</span>
      </span>
      <div className="TerraformImportModal__segmentedControl">
        {option("Compact", pipelineCompact, "detail.compact", () =>
          setPipelineCompact(true),
        )}
        {option("Full", !pipelineCompact, "detail.full", () =>
          setPipelineCompact(false),
        )}
      </div>
    </div>
  );

  const resourcesGroup = (
    <div role="group" aria-label="Pipeline resource scope">
      <span className="TerraformImportModal__controlLabel">
        Resources <span>which resources appear in the diagram</span>
      </span>
      <div className="TerraformImportModal__segmentedControl">
        {option(
          "Dataflow only",
          !pipelineIncludeAncillary,
          "resources.dataflow",
          () => setPipelineIncludeAncillary(false),
        )}
        {option(
          "All resources",
          pipelineIncludeAncillary,
          "resources.all",
          () => setPipelineIncludeAncillary(true),
        )}
      </div>
    </div>
  );

  return (
    <div className="TerraformImportModal__layoutSettings">
      <div className="TerraformImportModal__layoutSettingsHeader">
        <strong>Pipeline settings</strong>
        <span>Fine-tune how the dataflow diagram is arranged.</span>
      </div>
      <div className="TerraformImportModal__layoutSettingsBody">
        <div className="TerraformImportModal__layoutSettingsGrid">
          {isRcll ? (
            // RCLL owns placement. PRIMARY: pick a plain-outcome "Layout" profile.
            // ADVANCED (collapsed): the individual Sugiyama passes for A/B work —
            // touching any of them flips the profile control to "Custom".
            <>
              {phaseHeader("Content", "how much to draw")}
              {detailGroup}
              {phaseHeader("Layout", "height ↔ width ↔ readability")}
              <div role="group" aria-label="Pipeline layout profile">
                <span className="TerraformImportModal__controlLabel">
                  Layout{" "}
                  <span>pick the trade — adjust passes below to tune</span>
                </span>
                <div className="TerraformImportModal__segmentedControl">
                  {option(
                    "Readable",
                    pipelineLayoutProfile === "readable",
                    "profile.readable",
                    () => setPipelineLayoutProfile("readable"),
                  )}
                  {option(
                    "Balanced",
                    pipelineLayoutProfile === "balanced",
                    "profile.balanced",
                    () => setPipelineLayoutProfile("balanced"),
                  )}
                  {option(
                    "Compact",
                    pipelineLayoutProfile === "compact",
                    "profile.compact",
                    () => setPipelineLayoutProfile("compact"),
                  )}
                  {pipelineLayoutProfile === "custom" &&
                    // Non-clickable badge: surfaces the active "Custom" state once an
                    // advanced lever is touched. Click a profile above to leave it.
                    option("Custom", true, "profile.custom", () => {}, true)}
                </div>
              </div>
              <details className="TerraformImportModal__advancedDisclosure">
                <summary className="TerraformImportModal__advancedSummary">
                  Fine-tune layout (advanced) — individual passes
                </summary>
                <div className="TerraformImportModal__controlNote">
                  Each control is one pass of the layout engine, in the order it
                  applies. Changing any of them switches Layout to “Custom”.
                </div>
                {phaseHeader("Content", "which resources appear")}
                {resourcesGroup}
                {phaseHeader("Structure", "the model")}
                <div role="group" aria-label="Pipeline de-band depth">
                  <span className="TerraformImportModal__controlLabel">
                    De-band depth{" "}
                    <span>
                      dissolve a level + everything inside it into one stack
                    </span>
                  </span>
                  <select
                    className="TerraformImportModal__select"
                    aria-label="De-band depth"
                    value={pipelineDeBandLevel}
                    title={OPTION_HELP["deband.depth"].body}
                    onMouseEnter={() => setHoverKey("deband.depth")}
                    onMouseLeave={() => setHoverKey(null)}
                    onFocus={() => {
                      setHoverKey("deband.depth");
                      setStickyKey("deband.depth");
                    }}
                    onBlur={() => setHoverKey(null)}
                    onChange={(e) =>
                      setPipelineDeBandLevel(e.target.value as DeBandLevel)
                    }
                  >
                    {DEBAND_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {DEBAND_LEVEL_LABELS[level]}
                      </option>
                    ))}
                  </select>
                </div>
                {phaseHeader("Columns", "left → right placement (X)")}
                <div role="group" aria-label="Pipeline column packing">
                  <span className="TerraformImportModal__controlLabel">
                    Column packing <span>spread or compact columns</span>
                  </span>
                  <div className="TerraformImportModal__segmentedControl">
                    {option(
                      "Spread",
                      pipelineColumnPacking === "spread",
                      "columnpacking.spread",
                      () => setPipelineColumnPacking("spread"),
                    )}
                    {option(
                      "None",
                      pipelineColumnPacking === "none",
                      "columnpacking.none",
                      () => setPipelineColumnPacking("none"),
                    )}
                    {option(
                      "Compact",
                      pipelineColumnPacking === "compact",
                      "columnpacking.compact",
                      () => setPipelineColumnPacking("compact"),
                    )}
                    {option(
                      "Shorten",
                      pipelineColumnPacking === "shorten",
                      "columnpacking.shorten",
                      () => setPipelineColumnPacking("shorten"),
                    )}
                  </div>
                </div>
                {phaseHeader("Ordering", "reduce crossing arrows")}
                <div role="group" aria-label="Pipeline ordering">
                  <span className="TerraformImportModal__controlLabel">
                    Ordering <span>reduce crossing arrows within groups</span>
                  </span>
                  <div className="TerraformImportModal__segmentedControl">
                    {option("Off", !pipelineReorder, "ordering.off", () =>
                      setPipelineReorder(false),
                    )}
                    {option("On", pipelineReorder, "ordering.on", () =>
                      setPipelineReorder(true),
                    )}
                  </div>
                </div>
                {/* Cross-container is NESTED under Ordering: it is the hierarchical
                    superset of the per-group reorder (reorders whole groups within
                    their parent, not just leaves within a column), so it reads as
                    "extend the crossing-min across group boundaries". When On it
                    supersedes the leaf reorder (the toggle guard makes it win). */}
                <div
                  role="group"
                  aria-label="Pipeline cross-container crossing-min"
                  className="TerraformImportModal__nestedControl"
                >
                  <span className="TerraformImportModal__controlLabel">
                    Cross-container{" "}
                    <span>
                      cut crossings between groups (supersedes Ordering)
                    </span>
                  </span>
                  <div className="TerraformImportModal__segmentedControl">
                    {option(
                      "Off",
                      !pipelineCrossingMin,
                      "crossingmin.off",
                      () => setPipelineCrossingMin(false),
                    )}
                    {option("On", pipelineCrossingMin, "crossingmin.on", () =>
                      setPipelineCrossingMin(true),
                    )}
                  </div>
                </div>
                {phaseHeader("Vertical", "top → down placement (Y)")}
                <div role="group" aria-label="Pipeline lane height">
                  <span className="TerraformImportModal__controlLabel">
                    Lane height <span>height of mutually-dependent groups</span>
                  </span>
                  <div className="TerraformImportModal__segmentedControl">
                    {option(
                      "Stacked",
                      !pipelineSwimlaneLaneRise,
                      "laneheight.stacked",
                      () => {
                        // Footgun guard: Lane split is only valid with risen lane
                        // height, so turning the rise off also clears it (it would
                        // otherwise be a stale, suppressed On).
                        setPipelineSwimlaneLaneRise(false);
                        setPipelineRankSeparate(false);
                      },
                    )}
                    {option(
                      "Risen",
                      pipelineSwimlaneLaneRise,
                      "laneheight.risen",
                      () => setPipelineSwimlaneLaneRise(true),
                    )}
                  </div>
                </div>
                {/* Lane split is NESTED under Lane height: it is a sub-choice that
                    only does something once Lane height = Risen. Indented + an
                    always-visible prerequisite line make the dependency structural
                    (not a silent grey-out the user has to discover). */}
                <div
                  role="group"
                  aria-label="Pipeline lane split"
                  className="TerraformImportModal__nestedControl"
                >
                  <span className="TerraformImportModal__controlLabel">
                    Lane split{" "}
                    <span>
                      {pipelineSwimlaneLaneRise
                        ? "split dependent lanes into separate columns"
                        : "needs Lane height = Risen (above) — off until then"}
                    </span>
                  </span>
                  <div className="TerraformImportModal__segmentedControl">
                    {option("Off", !pipelineRankSeparate, "lanesplit.off", () =>
                      setPipelineRankSeparate(false),
                    )}
                    {option(
                      "On",
                      pipelineRankSeparate,
                      "lanesplit.on",
                      () => setPipelineRankSeparate(true),
                      // Footgun guard: lane split alone is taller + wider; the win
                      // exists only composed with the risen lane height (M4).
                      !pipelineSwimlaneLaneRise,
                    )}
                  </div>
                </div>
                <div role="group" aria-label="Pipeline cycle height">
                  <span className="TerraformImportModal__controlLabel">
                    Cycle height{" "}
                    <span>height of mutually-dependent cycles</span>
                  </span>
                  {/* Button order matches Lane height (Stacked, Risen) so the two
                      height levers read as the same control at different scopes. */}
                  <div className="TerraformImportModal__segmentedControl">
                    {option(
                      "Stacked",
                      !pipelineStaircaseBandOverlap,
                      "cycleheight.stacked",
                      () => setPipelineStaircaseBandOverlap(false),
                    )}
                    {option(
                      "Risen",
                      pipelineStaircaseBandOverlap,
                      "cycleheight.risen",
                      () => setPipelineStaircaseBandOverlap(true),
                    )}
                  </div>
                </div>
                <div role="group" aria-label="Pipeline straighten">
                  <span className="TerraformImportModal__controlLabel">
                    Straighten <span>align and lift direct resources</span>
                  </span>
                  <div className="TerraformImportModal__segmentedControl">
                    {option("Off", !pipelineStraighten, "straighten.off", () =>
                      setPipelineStraighten(false),
                    )}
                    {option("On", pipelineStraighten, "straighten.on", () =>
                      setPipelineStraighten(true),
                    )}
                  </div>
                </div>
                <div
                  role="group"
                  aria-label="Pipeline coordinated re-pack"
                  className="TerraformImportModal__nestedControl"
                >
                  <span className="TerraformImportModal__controlLabel">
                    Coordinated re-pack{" "}
                    <span>
                      {pipelineStraighten
                        ? "jointly re-order each column within its band"
                        : "needs Straighten = On (above) — off until then"}
                    </span>
                  </span>
                  <div className="TerraformImportModal__segmentedControl">
                    {option(
                      "Off",
                      !pipelineCoordRepack,
                      "coordrepack.off",
                      () => setPipelineCoordRepack(false),
                    )}
                    {option(
                      "On",
                      pipelineCoordRepack,
                      "coordrepack.on",
                      () => setPipelineCoordRepack(true),
                      // Refines the straightened result — meaningless without it.
                      !pipelineStraighten,
                    )}
                  </div>
                </div>
              </details>
            </>
          ) : (
            // Classic / Compound / V2: the original flat order (no phases — these
            // engines expose Layout / Height / Placement, not the RCLL passes).
            <>
              {detailGroup}
              <div role="group" aria-label="Pipeline layout variant">
                <span className="TerraformImportModal__controlLabel">
                  Layout{" "}
                  <span>which placement engine arranges the diagram</span>
                </span>
                <div className="TerraformImportModal__segmentedControl">
                  {option(
                    "Classic",
                    pipelineLayoutVariant === "classic",
                    "layout.classic",
                    () => setPipelineLayoutVariant("classic"),
                  )}
                  {option(
                    "Compound",
                    pipelineLayoutVariant === "compound",
                    "layout.compound",
                    () => setPipelineLayoutVariant("compound"),
                  )}
                  {option(
                    "V2",
                    pipelineLayoutVariant === "v2",
                    "layout.v2",
                    () => setPipelineLayoutVariant("v2"),
                  )}
                </div>
              </div>
              {isV2 && (
                <div className="TerraformImportModal__controlNote">
                  V2 arranges height, packing, and placement automatically. Only
                  the Detail and Resources toggles apply.
                </div>
              )}
              {!isV2 && (
                <div role="group" aria-label="Pipeline height packing">
                  <span className="TerraformImportModal__controlLabel">
                    Height <span>trade vertical height for width</span>
                  </span>
                  <div className="TerraformImportModal__segmentedControl">
                    {option(
                      "Stacked",
                      !pipelinePacked,
                      "height.stacked",
                      () => {
                        setPipelinePacked(false);
                        setPipelinePackedPullLeft(false);
                      },
                    )}
                    {option(
                      "Packed",
                      pipelinePacked && !pipelinePackedPullLeft,
                      "height.packed",
                      () => {
                        setPipelinePacked(true);
                        setPipelinePackedPullLeft(false);
                      },
                    )}
                    {option(
                      "Packed + pull-left",
                      pipelinePacked && pipelinePackedPullLeft,
                      "height.pullLeft",
                      () => {
                        setPipelinePacked(true);
                        setPipelinePackedPullLeft(true);
                      },
                    )}
                  </div>
                </div>
              )}
              {resourcesGroup}
              {!isV2 && showPlacement && (
                <div role="group" aria-label="Pipeline semantic placement">
                  <span className="TerraformImportModal__controlLabel">
                    Placement <span>nesting-aware band &amp; arrow tuning</span>
                  </span>
                  <div className="TerraformImportModal__segmentedControl">
                    {option(
                      "Default",
                      !pipelineSemanticPlacement,
                      "placement.default",
                      () => setPipelineSemanticPlacement(false),
                    )}
                    {option(
                      "Semantic",
                      pipelineSemanticPlacement,
                      "placement.semantic",
                      () => setPipelineSemanticPlacement(true),
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <aside
          className="TerraformImportModal__layoutHelp"
          aria-live="polite"
          aria-label="Option explanation"
        >
          <strong className="TerraformImportModal__layoutHelpTitle">
            {activeHelp.title}
          </strong>
          {activeFigure && (
            <div className="TerraformImportModal__layoutHelpFigure">
              {activeFigure}
            </div>
          )}
          <p className="TerraformImportModal__layoutHelpBody">
            {activeHelp.body}
          </p>
          <div className="TerraformImportModal__layoutHelpDev">
            <span className="TerraformImportModal__layoutHelpDevLabel">
              Implements
            </span>
            <span className="TerraformImportModal__layoutHelpDevText">
              {activeHelp.dev.implements}
            </span>
            {activeHelp.dev.refs && activeHelp.dev.refs.length > 0 && (
              <span className="TerraformImportModal__layoutHelpDevRefs">
                {activeHelp.dev.refs.join(" · ")}
              </span>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
