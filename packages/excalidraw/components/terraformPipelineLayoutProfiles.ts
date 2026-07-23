/**
 * De-band depth machinery — the hierarchy-level ladder shared by the Strata engine
 * (frame suppression, path truncation, membership annotation). Pure + UI-free so
 * `terraformLayoutCore` can import it without the dependency-cruiser "core must not
 * import UI" violation.
 *
 * (Historically this file also held the RCLL "Layout" profile expansion; that was
 * removed with the Pipeline/RCLL views. Only the de-band ladder — still read by
 * Strata — remains.)
 */

/**
 * De-band **depth** — the hierarchy level whose containers are dissolved (along with
 * every deeper level) so all of that subtree's resources share ONE column stack.
 * `none` (default) = today's boxed layout, byte-identical. The ladder runs from the
 * deepest container outward: `subnet → vpc → region → account → provider`. De-banding
 * a level cascades downward (vpc also de-bands subnets; provider de-bands everything).
 * Generalizes the original subnet-only `subnetDeBand` boolean (kept as an alias).
 */
export type DeBandLevel =
  | "none"
  | "subnet"
  | "vpc"
  | "region"
  | "account"
  | "provider";

export const DEBAND_LEVELS: readonly DeBandLevel[] = [
  "none",
  "subnet",
  "vpc",
  "region",
  "account",
  "provider",
] as const;

export function isDeBandLevel(value: unknown): value is DeBandLevel {
  return (
    value === "none" ||
    value === "subnet" ||
    value === "vpc" ||
    value === "region" ||
    value === "account" ||
    value === "provider"
  );
}

/**
 * Container depth ladder (provider shallowest = 1 … subnet deepest = 5; `none` = 0).
 * A de-band at level L dissolves every container whose depth ≥ depth(L) — so comparing
 * ranks is the single predicate shared by the collapse, the frame suppression, the path
 * truncation, and the membership annotation.
 */
const DEBAND_LEVEL_RANK: Record<DeBandLevel, number> = {
  none: 0,
  provider: 1,
  account: 2,
  region: 3,
  vpc: 4,
  subnet: 5,
};

export function deBandLevelRank(level: DeBandLevel): number {
  return DEBAND_LEVEL_RANK[level];
}

/** Topology container role (frame role) → the de-band level that dissolves it. */
export const DEBAND_LEVEL_BY_TOPOLOGY_ROLE: Record<
  "subnetZone" | "vpc" | "region" | "account" | "provider",
  Exclude<DeBandLevel, "none">
> = {
  subnetZone: "subnet",
  vpc: "vpc",
  region: "region",
  account: "account",
  provider: "provider",
};

/** Depth rank of a topology container role (subnetZone = 5 … provider = 1). */
export function topologyRoleDeBandRank(
  role: "subnetZone" | "vpc" | "region" | "account" | "provider",
): number {
  return DEBAND_LEVEL_RANK[DEBAND_LEVEL_BY_TOPOLOGY_ROLE[role]];
}
