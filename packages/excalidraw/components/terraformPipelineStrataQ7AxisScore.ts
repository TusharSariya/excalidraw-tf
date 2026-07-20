/**
 * Q7-AXIS scorer + shared machine direction proxy (W11 WP2; SDEC-24's owed
 * 20-edge direction-reading hand-label, both presets, impact-tracing framing).
 *
 * PURE, measurement-only: this module owns NO layout behavior and reads NO
 * scene geometry directly — it ingests a filled labels JSON (owner reads) and a
 * sealed key JSON (declared-dependency direction + the machine proxy), and
 * reports per-preset + pooled accuracy with a WILSON 95% score interval.
 *
 * SDEC-34 import-cycle rule honored: this module imports NOTHING from
 * terraformPipelineLayoutShared (the terraformPlanParsing→terraformLayoutCore
 * cycle makes module-level consts sourced from LayoutShared entry-order NaNs).
 * Every module-level constant below is a numeric/string literal.
 *
 * Scoring (plan decision 8, frozen BEFORE labels):
 *  - The sheet presents each edge's two endpoints in a RANDOMIZED A/B frame; the
 *    key records which slot ("A"|"B") is the declared-dependency SOURCE.
 *  - The owner answers the frozen proposition per edge: "on the canvas, which way
 *    does this connection read as flowing?" ∈ {A→B, B→A, ambiguous}.
 *  - correct  = the owner's directional read (mapped through the sheet's A/B
 *    frame) matches the sealed key's declared-dependency direction.
 *  - `ambiguous` is COUNTED but EXCLUDED from the accuracy denominator.
 *  - accuracy = matches / (matches + mismatches); Wilson 95% interval on it.
 *  - Robust: partial/missing labels are reported (missing count), unrecognized
 *    non-empty labels are reported (invalid count) — both excluded from the
 *    denominator; a label for an unknown edge becomes an error entry (never
 *    throws); a duplicate label (same edge twice) is last-wins + a warning
 *    count.
 *
 * The Wilson score interval is implemented DIRECTLY here (not via
 * `pairedBootstrapCi` — that is a paired-delta tool, wrong for a one-sample
 * binary proportion).
 */

/** Standard-normal 97.5th percentile (two-sided 95%). Pinned so the interval is
 * reproducible; hand-checkable against the 16/20 known answer below. */
export const WILSON_Z_95 = 1.959963984540054;

/** Tie band for the machine "source-left-of-target" proxy: |Δx| ≤ this (px) is a
 * tie (→ null), not a left/right read. Sub-pixel horizontal offsets carry no
 * legible direction. */
export const SOURCE_LEFT_TIE_PX = 0.5;

// ────────────────────────────────────────────────────────────────────────────
// Shared machine direction proxy (DRY — plan decision 13). Imported by BOTH the
// Q7 sheet/key generator and WP3's task-tracing battery direction-correctness
// cell. Signature is scene-element-friendly: callers resolve each endpoint to a
// rendered x-coordinate (e.g. a primaryCluster card center x) and pass the two.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Does the declared SOURCE endpoint render to the LEFT of the declared TARGET
 * endpoint? Pure function of two rendered x-coordinates.
 *
 * @returns `true`  — source is left of target (target.x − source.x >  tie band)
 *          `false` — source is right of target
 *          `null`  — tie (|Δx| ≤ tie band) or a non-finite coordinate
 */
export function sourceLeftOfTarget(
  sourceX: number,
  targetX: number,
  tiePx: number = SOURCE_LEFT_TIE_PX,
): boolean | null {
  const dx = targetX - sourceX;
  if (!Number.isFinite(dx) || Math.abs(dx) <= tiePx) {
    return null;
  }
  return dx > 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Sheet / key / labels shapes (the generator emits key entries; the owner fills
// label entries into the blinded sheet).
// ────────────────────────────────────────────────────────────────────────────

/** One sealed-key row (see the generator). The scorer reads only the fields it
 * needs; extra provenance fields on the JSON are ignored. */
export type Q7AxisKeyEntry = {
  /** Neutral sheet row index (1-based, stable within a preset). */
  index: number;
  /** Rendered arrow element id (deblinding + cross-checks). */
  edgeId: string;
  /** Canonical declared-dependency endpoints. */
  sourceAddress: string;
  targetAddress: string;
  /** Pairing key (canonicalEdgeKey(source, target)). */
  canonicalEdgeKey: string;
  /** Which RANDOMIZED sheet slot holds the declared-dependency SOURCE. */
  declaredSourceSlot: "A" | "B";
  /** The machine source-left-of-target proxy (rendered card centers). */
  machineSourceLeftOfTarget: boolean | null;
};

export type Q7AxisKey = {
  preset: string;
  seed: number;
  entries: Q7AxisKeyEntry[];
};

/** One filled label row (owner). `ownerLabel` blank/absent ⇒ unlabeled. An
 * optional `edgeId` is cross-checked against the key when present. */
export type Q7AxisLabelEntry = {
  index: number;
  ownerLabel?: string;
  edgeId?: string;
};

/** Filled labels JSON: either the bare array or `{ labels: [...] }`. */
export type Q7AxisLabels =
  | Q7AxisLabelEntry[]
  | { preset?: string; labels: Q7AxisLabelEntry[] };

/** Normalized owner read. */
export type OwnerRead = "A->B" | "B->A" | "ambiguous" | "missing" | "invalid";

export type Q7PerEdgeResult = {
  index: number;
  edgeId: string | null;
  ownerRead: OwnerRead;
  /** The direction the sheet-frame + key imply is CORRECT ("A->B" | "B->A"),
   * or null when the key entry is missing (unknown edge). */
  declaredRead: "A->B" | "B->A" | null;
  outcome:
    | "match"
    | "mismatch"
    | "ambiguous"
    | "missing"
    | "invalid"
    | "unknown";
  machineSourceLeftOfTarget: boolean | null;
};

export type WilsonInterval = {
  successes: number;
  n: number;
  pointEstimate: number;
  lo: number;
  hi: number;
  z: number;
};

export type Q7PresetScore = {
  preset: string;
  /** Rows scored into the accuracy denominator (match + mismatch). */
  n: number;
  matches: number;
  mismatches: number;
  ambiguous: number;
  missing: number;
  invalid: number;
  /** Label rows whose index is absent from the key (never crash). */
  unknown: number;
  /** Duplicate label rows collapsed via last-wins. */
  duplicateWarnings: number;
  accuracy: number | null;
  wilson: WilsonInterval | null;
  perEdge: Q7PerEdgeResult[];
  /** Human-readable notes (unknown ids, duplicates, edgeId mismatches). */
  warnings: string[];
};

export type Q7ScoreResult = {
  perPreset: Q7PresetScore[];
  pooled: Q7PresetScore;
};

// ────────────────────────────────────────────────────────────────────────────
// Wilson 95% score interval (one-sample binary proportion).
// ────────────────────────────────────────────────────────────────────────────

/**
 * Wilson score interval for `successes`/`n` at confidence set by `z`
 * (default 95%). Returns null when n === 0 (no denominator).
 *
 * Known answer (hand-computed, z = 1.959963984540054): 16/20 →
 * point 0.8, lo ≈ 0.5840, hi ≈ 0.9193.
 */
export function wilsonInterval(
  successes: number,
  n: number,
  z: number = WILSON_Z_95,
): WilsonInterval | null {
  if (n <= 0) {
    return null;
  }
  const pHat = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (pHat + z2 / (2 * n)) / denom;
  const margin =
    (z / denom) * Math.sqrt((pHat * (1 - pHat)) / n + z2 / (4 * n * n));
  return {
    successes,
    n,
    pointEstimate: pHat,
    lo: Math.max(0, center - margin),
    hi: Math.min(1, center + margin),
    z,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Label normalization.
// ────────────────────────────────────────────────────────────────────────────

/** Normalize a raw owner label into an OwnerRead. Accepts unicode/ascii arrows,
 * ">", or "to"; case/space-insensitive. Blank ⇒ missing; unrecognized non-empty
 * ⇒ invalid. */
export function normalizeOwnerLabel(raw: string | undefined | null): OwnerRead {
  if (raw == null) {
    return "missing";
  }
  const s = String(raw).trim().toLowerCase();
  if (s === "") {
    return "missing";
  }
  if (s.includes("amb")) {
    return "ambiguous";
  }
  // Collapse arrow/connector tokens to a single ">" so a->b, a>b, a to b match.
  const norm = s.replace(/→|⟶|➔|➜|⇒|-+>|>|\s+to\s+/g, ">").replace(/\s+/g, "");
  if (/^a>b$/.test(norm)) {
    return "A->B";
  }
  if (/^b>a$/.test(norm)) {
    return "B->A";
  }
  return "invalid";
}

// ────────────────────────────────────────────────────────────────────────────
// Scorer.
// ────────────────────────────────────────────────────────────────────────────

function labelArray(labels: Q7AxisLabels): Q7AxisLabelEntry[] {
  return Array.isArray(labels) ? labels : labels.labels ?? [];
}

/** The direction that the sheet-frame + key declare CORRECT: if the declared
 * source sits in slot A, the declared read is "A->B", else "B->A". */
function declaredReadOf(entry: Q7AxisKeyEntry): "A->B" | "B->A" {
  return entry.declaredSourceSlot === "A" ? "A->B" : "B->A";
}

/** Score one preset: match filled label rows to the sealed key by `index`. */
export function scoreQ7AxisPreset(
  key: Q7AxisKey,
  labels: Q7AxisLabels,
): Q7PresetScore {
  const keyByIndex = new Map<number, Q7AxisKeyEntry>();
  for (const e of key.entries) {
    keyByIndex.set(e.index, e);
  }

  const warnings: string[] = [];
  let duplicateWarnings = 0;

  // Last-wins on duplicate label indices (report the count).
  const labelByIndex = new Map<number, Q7AxisLabelEntry>();
  for (const l of labelArray(labels)) {
    if (labelByIndex.has(l.index)) {
      duplicateWarnings += 1;
      warnings.push(
        `duplicate label for index ${l.index} — last wins (was "${
          labelByIndex.get(l.index)!.ownerLabel ?? ""
        }", now "${l.ownerLabel ?? ""}")`,
      );
    }
    labelByIndex.set(l.index, l);
  }

  const perEdge: Q7PerEdgeResult[] = [];
  let matches = 0;
  let mismatches = 0;
  let ambiguous = 0;
  let missing = 0;
  let invalid = 0;
  let unknown = 0;

  // Iterate the KEY (every eligible edge), plus any label indices absent from
  // the key (unknown edges). Deterministic ascending index order.
  const allIndices = new Set<number>([
    ...keyByIndex.keys(),
    ...labelByIndex.keys(),
  ]);
  for (const index of [...allIndices].sort((a, b) => a - b)) {
    const entry = keyByIndex.get(index);
    const label = labelByIndex.get(index);

    if (!entry) {
      // Label references an edge absent from the key — never crash.
      unknown += 1;
      warnings.push(
        `label index ${index} has no matching key entry (unknown edge)`,
      );
      perEdge.push({
        index,
        edgeId: label?.edgeId ?? null,
        ownerRead: normalizeOwnerLabel(label?.ownerLabel),
        declaredRead: null,
        outcome: "unknown",
        machineSourceLeftOfTarget: null,
      });
      continue;
    }

    if (label?.edgeId != null && label.edgeId !== entry.edgeId) {
      warnings.push(
        `label index ${index} edgeId "${label.edgeId}" != key edgeId "${entry.edgeId}"`,
      );
    }

    const ownerRead = normalizeOwnerLabel(label?.ownerLabel);
    const declaredRead = declaredReadOf(entry);
    let outcome: Q7PerEdgeResult["outcome"];
    if (ownerRead === "missing") {
      missing += 1;
      outcome = "missing";
    } else if (ownerRead === "invalid") {
      invalid += 1;
      outcome = "invalid";
    } else if (ownerRead === "ambiguous") {
      ambiguous += 1;
      outcome = "ambiguous";
    } else if (ownerRead === declaredRead) {
      matches += 1;
      outcome = "match";
    } else {
      mismatches += 1;
      outcome = "mismatch";
    }

    perEdge.push({
      index,
      edgeId: entry.edgeId,
      ownerRead,
      declaredRead,
      outcome,
      machineSourceLeftOfTarget: entry.machineSourceLeftOfTarget,
    });
  }

  const n = matches + mismatches;
  const accuracy = n > 0 ? matches / n : null;
  return {
    preset: key.preset,
    n,
    matches,
    mismatches,
    ambiguous,
    missing,
    invalid,
    unknown,
    duplicateWarnings,
    accuracy,
    wilson: wilsonInterval(matches, n),
    perEdge,
    warnings,
  };
}

/** Score every preset and pool them into one combined accuracy + Wilson. */
export function scoreQ7Axis(
  inputs: ReadonlyArray<{ key: Q7AxisKey; labels: Q7AxisLabels }>,
): Q7ScoreResult {
  const perPreset = inputs.map(({ key, labels }) =>
    scoreQ7AxisPreset(key, labels),
  );

  const sum = (pick: (s: Q7PresetScore) => number): number =>
    perPreset.reduce((acc, s) => acc + pick(s), 0);

  const matches = sum((s) => s.matches);
  const mismatches = sum((s) => s.mismatches);
  const n = matches + mismatches;
  const pooled: Q7PresetScore = {
    preset: "POOLED",
    n,
    matches,
    mismatches,
    ambiguous: sum((s) => s.ambiguous),
    missing: sum((s) => s.missing),
    invalid: sum((s) => s.invalid),
    unknown: sum((s) => s.unknown),
    duplicateWarnings: sum((s) => s.duplicateWarnings),
    accuracy: n > 0 ? matches / n : null,
    wilson: wilsonInterval(matches, n),
    perEdge: perPreset.flatMap((s) => s.perEdge),
    warnings: perPreset.flatMap((s) =>
      s.warnings.map((w) => `[${s.preset}] ${w}`),
    ),
  };

  return { perPreset, pooled };
}
