// Canonical scene-geometry fingerprint for the strata instrumentation stack.
//
// The dev proof API (/api/terraform-layout), the arm-eval probe, and the
// geometry regression suite must agree byte-for-byte on what "identical layout"
// means, so the canonicalization lives in exactly one place. Every agent + proof
// surface MUST route geometry fingerprints through this one module — never
// invent a second canonicalization (the overnight SHARED HASH rule).
//
// Deliberately dependency-free (no element-type imports): safe to import from
// dev-server middleware, probe tests, and engine-adjacent modules without
// touching the terraformPlanParsing ↔ terraformLayoutCore import cycle
// (SDEC-34), and structural typing keeps it usable on raw JSON payloads. It
// reads nothing from LayoutShared at module-eval time, so no module-level const
// is frozen as NaN by an import cycle (SDEC-34); all numbers are computed at
// call time.
//
// WHY THE CANONICAL LINE OMITS element id (load-bearing, not an oversight — an
// earlier revision keyed each line by id and was WRONG on the real proof path):
//   The dev proof API regenerates every element id on every run —
//   convertPipelineSkeletonToElements → convertToExcalidrawElements(
//   { regenerateIds: true }) → transform.ts randomId() mints a fresh nanoid per
//   element (isTestEnv is false in the dev server). Two identical requests
//   therefore render byte-identical geometry under DISJOINT id sets. Keying the
//   fingerprint on id made it NON-deterministic on that path: two equivalent
//   layouts hashed differently and every byte-identity check was corrupted.
//
//   The fingerprint is instead the SORTED MULTISET of geometry lines. That is
//   exactly the byte-identity of the RENDERED geometry: ids do not affect what
//   is drawn, so id churn (nanoid regeneration) must not flip the hash. By the
//   same token, swapping two geometrically-identical elements is not a geometric
//   change and (correctly) does not flip the hash. Linear-element routing still
//   counts, because `points` (local polyline offsets, NOT the bounding box) is
//   part of each line, so a reroute is visible to the fingerprint.

interface GeometryLike {
  // `id` intentionally NOT part of the fingerprint — see the module header.
  readonly id?: string;
  readonly type?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly angle?: number;
  readonly isDeleted?: boolean;
  readonly points?: readonly (readonly number[])[];
}

// Integer-pixel rounding: sub-pixel float jitter (reordered arithmetic) is not
// visible on the canvas, so it must not flip the fingerprint; any real layout
// movement still does. Non-finite coordinates collapse to 0 so a transient NaN
// can't leak an unstable token. `String(-0)` is "0", so the template joins below
// never emit a stray "-0".
const round = (value: number | undefined): number =>
  Math.round(Number.isFinite(value) ? (value as number) : 0);

// Local polyline points of a linear element (arrow/line), rounded and
// serialized as `x,y;x,y;…`, or "" for elements with no `points` array. Points
// are offsets from x/y, so they capture routing the bounding box cannot.
const canonicalPoints = (el: GeometryLike): string => {
  const points = el.points;
  if (!Array.isArray(points)) {
    return "";
  }
  const parts: string[] = [];
  for (const p of points) {
    if (Array.isArray(p) && p.length >= 2) {
      parts.push(`${round(p[0])},${round(p[1])}`);
    }
  }
  return parts.join(";");
};

/** One canonical line per element: `type|x|y|w|h|angle|pts`. NO id — see the
 * module header: the proof-API path regenerates ids per run and ids do not
 * affect rendered geometry. */
const canonicalElementLine = (el: GeometryLike): string => {
  const angle = Math.round((el.angle ?? 0) * 1000) / 1000;
  return [
    el.type ?? "?",
    round(el.x),
    round(el.y),
    round(el.width),
    round(el.height),
    angle,
    canonicalPoints(el),
  ].join("|");
};

/**
 * Deterministic, human-diffable canonical string of the scene geometry: one line
 * per non-deleted element, code-unit sorted so the string depends only on the
 * multiset of geometry lines, not the element array order — and NOT on element
 * id (see the module header).
 */
export const canonicalStrataGeometryString = (
  elements: readonly GeometryLike[],
): string => {
  const lines: string[] = [];
  for (const el of elements) {
    if (el.isDeleted) {
      continue;
    }
    lines.push(canonicalElementLine(el));
  }
  lines.sort();
  return lines.join("\n");
};

// FNV-1a 64-bit (the family the strata finalize pass already uses for
// deterministic seeds). BigInt keeps it exact; hex-padded to 16 chars.
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

const fnv1a64 = (input: string): string => {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
};

/**
 * Scene-geometry hash: `<elementCount>:<canonicalLength>:<fnv1a64hex>`. Two
 * payloads with equal hashes have byte-identical canonical (id-independent)
 * geometry for all practical purposes; the count/length prefix makes accidental
 * collisions even less plausible and is cheap to eyeball in logs. Deterministic
 * across runs even though the proof-API path regenerates element ids.
 */
export const strataGeometryHash = (
  elements: readonly GeometryLike[],
): string => {
  const canonical = canonicalStrataGeometryString(elements);
  const count = canonical.length === 0 ? 0 : canonical.split("\n").length;
  return `${count}:${canonical.length}:${fnv1a64(canonical)}`;
};
