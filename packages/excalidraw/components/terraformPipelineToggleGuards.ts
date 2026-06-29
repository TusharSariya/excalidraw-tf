/**
 * RCLL toggle safety guards — the single source of truth for the cross-toggle
 * coupling policy, shared by the import dialog (UI gating) and `terraformLayoutCore`
 * (the URL/programmatic backstop) so the two can never drift apart.
 *
 * Pure + UI-free (so `terraformLayoutCore` can import it without violating the
 * dependency-cruiser rule that core must not import UI).
 *
 * The footguns this addresses (RFC §9.6 / DEC-13 + the campaign measurements):
 *   - `rankSeparate` ALONE makes the diagram WORSE (taller, ~+28% width, ~+45%
 *     crossings). Its −42% height win exists only composed with `swimlaneLaneRise`
 *     (the M4 lane-rise reclaims the Y once separation makes the lanes X-disjoint).
 *     ⇒ rankSeparate is only honored when swimlaneLaneRise is on. The dialog greys
 *     out its "On"; this guard is the backstop for the URL/programmatic path.
 *   - `deDensify` is inert unless its width dial `deDensifyMaxCols` is > 0. The UI
 *     exposes only the boolean; this guard supplies a sensible default dial so the
 *     toggle actually does something when enabled.
 */

/** The dial `deDensify` gets when the UI enables it without an explicit value. */
export const DEDENSIFY_DEFAULT_MAX_COLS = 2;

/** Reason codes for a suppressed/adjusted toggle (surfaced in scene meta). */
export type RcllToggleSuppression =
  | "rankSeparate-needs-rise"
  | "column-packing-conflict-compact-wins"
  | "ordering-conflict-crossing-min-wins"
  | "rank-floor-conflict-rankseparate-wins-network-simplex"
  | "rank-floor-conflict-network-simplex-wins-dedensify"
  | "coord-repack-needs-straighten";

/**
 * Whether `rankSeparate` may be enabled. True only when the M4 swimlane lane-rise
 * is also on — the composition that turns separation's rightward push into a net
 * height win instead of a taller, wider diagram.
 */
export function rankSeparateAvailable(swimlaneLaneRise: boolean): boolean {
  return swimlaneLaneRise === true;
}

/** The subset of pipeline options this guard reads/rewrites. */
export type GuardablePipelineOptions = {
  swimlaneLaneRise?: boolean;
  rankSeparate?: boolean;
  deDensify?: boolean;
  deDensifyMaxCols?: number;
  /** M5c column compaction (pull-left). Mutually exclusive with `deDensify` (pull-right). */
  columnCompact?: boolean;
  /** M5 Brandes–Köpf straighten. `coordRepack` refines its result, so requires it on. */
  straighten?: boolean;
  /** M5b coordinated per-column permutation re-pack. Only meaningful refining a
   * straightened placement ⇒ dropped when `straighten` is off. */
  coordRepack?: boolean;
  /** M6 leaf-only within-column reorder. Subsumed by `crossingMin` when both set. */
  reorder?: boolean;
  /** M6c container-aware crossing minimization (hierarchical superset of `reorder`). */
  crossingMin?: boolean;
  /** X-axis network-simplex depth-floor ranker (the `"shorten"` bundle). Rewrites the
   * column axis. It LOSES to a live `rankSeparate` (the dominant height lever — see the
   * guard) and WINS over `deDensify`; `columnCompact` is additive and NOT guarded. */
  networkSimplexRank?: boolean;
};

/**
 * Sanitize RCLL pipeline options against the coupling policy. Pure — returns a new
 * object (never mutates the input) plus the list of suppressions applied, so a
 * caller can surface them in scene meta. When no guard fires the returned options
 * are field-for-field equal to the input (OFF byte-identical).
 */
export function applyRcllToggleGuards<T extends GuardablePipelineOptions>(
  opts: T,
): {
  options: T & GuardablePipelineOptions;
  suppressions: RcllToggleSuppression[];
} {
  const suppressions: RcllToggleSuppression[] = [];
  // Intersection type so the conditional `deDensifyMaxCols` / `rankSeparate`
  // rewrites below are not excess properties on a narrowly-inferred T.
  let next: T & GuardablePipelineOptions = opts;

  // rankSeparate requires the lane-rise to be a win, not a regression. Runs FIRST so
  // the NS-vs-rankSeparate rule below sees a rankSeparate that has already survived its
  // own precondition (an invalid rankSeparate must NOT suppress NS).
  if (
    next.rankSeparate === true &&
    !rankSeparateAvailable(next.swimlaneLaneRise === true)
  ) {
    next = { ...next, rankSeparate: false };
    suppressions.push("rankSeparate-needs-rise");
  }

  // `rankSeparate` (+ its lane-rise) and the network-simplex ranker ("shorten") are
  // mutually-exclusive COLUMN-AXIS strategies — both rewrite the depth floor. They
  // CANNOT compose: rankSeparate gives sibling lanes disjoint column ranges so the M4
  // lane-rise can interleave them in Y (the −60 % HEIGHT lever); NS re-ranks columns to
  // minimum-span, which DESTROYS that X-disjointness so the lanes can no longer rise
  // and the diagram balloons in height (measured +149 % on full-detail v2). So when a
  // live rankSeparate and NS are both requested, **rankSeparate WINS** — it is by far
  // the dominant lever (a big height win vs NS's modest width win) — and NS is dropped,
  // surfaced observably. NS is only effective when rankSeparate is off (the config its
  // probe measured); picking "shorten" on a rankSeparate layout is then a safe no-op,
  // never a catastrophic regression.
  if (next.rankSeparate === true && next.networkSimplexRank === true) {
    next = { ...next, networkSimplexRank: false };
    suppressions.push("rank-floor-conflict-rankseparate-wins-network-simplex");
  }

  // NS (if it survived) still wins over `deDensify` (column pull-right). The enum
  // surface makes this collision unrepresentable (compact/spread/shorten are sibling
  // arms); the guard is the defensive backstop for a direct engine caller.
  if (next.networkSimplexRank === true && next.deDensify === true) {
    next = { ...next, deDensify: false };
    suppressions.push("rank-floor-conflict-network-simplex-wins-dedensify");
  }

  // "Column packing" is a tri-state, so the UI/URL can never set both arms. Defensively,
  // if a direct engine caller sets both, Compact (the narrower, measure-verified op) wins
  // and Spread is dropped — surfaced observably (never a silent boolean conflict).
  if (next.deDensify === true && next.columnCompact === true) {
    next = { ...next, deDensify: false };
    suppressions.push("column-packing-conflict-compact-wins");
  }

  // `crossingMin` is the hierarchical superset of the leaf-only `reorder` (M6): it
  // permutes lanes/sub-hulls AND within-column leaves, gated on the rendered count. If a
  // caller sets both, crossingMin wins and the redundant leaf reorder is dropped (so the
  // two ordering passes never compose) — surfaced observably (RFC §7.2c / DEC-6).
  if (next.crossingMin === true && next.reorder === true) {
    next = { ...next, reorder: false };
    suppressions.push("ordering-conflict-crossing-min-wins");
  }

  // `coordRepack` refines the Brandes–Köpf straightened placement (it re-permutes &
  // re-stacks each column starting FROM the straightened Y). With straighten off there
  // is no straightened result to refine, so it would be a meaningless no-op — drop it,
  // surfaced observably (mirrors `rankSeparate-needs-rise`).
  if (next.coordRepack === true && next.straighten !== true) {
    next = { ...next, coordRepack: false };
    suppressions.push("coord-repack-needs-straighten");
  }

  // deDensify is a no-op without a positive width dial — supply a default.
  if (next.deDensify === true && !((next.deDensifyMaxCols ?? 0) > 0)) {
    next = { ...next, deDensifyMaxCols: DEDENSIFY_DEFAULT_MAX_COLS };
  }

  return { options: next, suppressions };
}
