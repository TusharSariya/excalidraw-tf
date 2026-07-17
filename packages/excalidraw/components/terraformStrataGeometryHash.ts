// Canonical scene-geometry fingerprint for the strata instrumentation stack.
// The dev proof API (/api/terraform-layout), the arm-eval probe, and the
// geometry regression suite must agree byte-for-byte on what "identical
// layout" means, so the canonicalization lives in exactly one place.
//
// Deliberately dependency-free (no element-type imports): safe to import from
// dev-server middleware, probe tests, and engine-adjacent modules without
// touching the terraformPlanParsing ↔ terraformLayoutCore import cycle
// (SDEC-34), and structural typing keeps it usable on raw JSON payloads.

interface GeometryLike {
  readonly id: string;
  readonly type?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly angle?: number;
  readonly isDeleted?: boolean;
  readonly points?: readonly (readonly number[])[];
}

// 1e-4 px: far below visual relevance, above float-noise from reordered
// arithmetic. Canonicalizes -0 to 0 so "-0" never leaks into the string.
const round4 = (value: number | undefined): string => {
  if (value === undefined || Number.isNaN(value)) {
    return "nan";
  }
  const r = Math.round(value * 10000) / 10000;
  return (Object.is(r, -0) ? 0 : r).toString();
};

/**
 * Deterministic, human-diffable canonical string of the scene geometry:
 * one line per non-deleted element, sorted by id. Points are included so
 * arrow/line reroutes are visible to the fingerprint.
 */
export const canonicalStrataGeometryString = (
  elements: readonly GeometryLike[],
): string => {
  const lines: string[] = [];
  for (const el of elements) {
    if (el.isDeleted) {
      continue;
    }
    const pts = el.points
      ? `|pts:${el.points
          .map((p) => `${round4(p[0])},${round4(p[1])}`)
          .join(";")}`
      : "";
    lines.push(
      `${el.id}|${el.type ?? "?"}|${round4(el.x)}|${round4(el.y)}|${round4(
        el.width,
      )}|${round4(el.height)}|${round4(el.angle)}${pts}`,
    );
  }
  lines.sort();
  return lines.join("\n");
};

// FNV-1a 64-bit (same family the strata finalize pass already uses for
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
 * Scene-geometry hash: `<elementCount>:<canonicalLength>:<fnv1a64hex>`.
 * Two payloads with equal hashes have byte-identical canonical geometry for
 * all practical purposes; the count/length prefix makes accidental collisions
 * even less plausible and cheap to eyeball in logs.
 */
export const strataGeometryHash = (
  elements: readonly GeometryLike[],
): string => {
  const canonical = canonicalStrataGeometryString(elements);
  const count = canonical.length === 0 ? 0 : canonical.split("\n").length;
  return `${count}:${canonical.length}:${fnv1a64(canonical)}`;
};
