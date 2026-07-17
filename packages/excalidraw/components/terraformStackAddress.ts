/**
 * Synthetic stack namespace for multi-root Terraform imports.
 * Format: `{stackId}::{terraformAddress}`
 */

export const STACK_ADDRESS_SEP = "::";

/** Synthetic module-tree path segment grouping all modules for one Terraform state/stack. */
export const STACK_GROUP_PREFIX = "__stack__::";

const STACK_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function isValidStackId(stackId: string): boolean {
  const trimmed = stackId.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.includes(STACK_ADDRESS_SEP) &&
    STACK_ID_PATTERN.test(trimmed)
  );
}

export function isStackQualifiedAddress(address: string): boolean {
  return parseStackAddress(address) != null;
}

export function prefixStackAddress(stackId: string, address: string): string {
  const trimmedStack = stackId.trim();
  const trimmedAddress = address.trim();
  if (!isValidStackId(trimmedStack) || !trimmedAddress) {
    return address;
  }
  if (isStackQualifiedAddress(trimmedAddress)) {
    const parsed = parseStackAddress(trimmedAddress);
    if (parsed?.stackId === trimmedStack) {
      return trimmedAddress;
    }
  }
  return `${trimmedStack}${STACK_ADDRESS_SEP}${trimmedAddress}`;
}

type ParsedStackAddress = { stackId: string; address: string } | null;

/**
 * Hard upper bound on entries retained by the pure-string memo caches in this
 * module. `parseStackAddress` is a pure function of its input string, so the
 * cache is a lossless accelerator: on a miss we recompute, and evicting any
 * entry can never change an output. The layout path reuses this module across
 * jobs/runs, so an unbounded Map would retain every distinct raw address (and
 * invalid string cached as `null`) for the whole process lifetime — a slow
 * cross-run leak. Capping the cache and evicting the oldest entry on overflow
 * keeps memory bounded while staying byte-identical (eviction only forces a
 * recompute of the same value). ~50k distinct addresses comfortably covers the
 * largest single preset; overflow only bites pathological multi-plan sessions,
 * exactly the leak we are bounding.
 */
const MEMO_CACHE_MAX_ENTRIES = 50_000;

/** Bounded FIFO set for a pure-string memo cache: evict the oldest key on overflow. */
const setBoundedMemo = <V>(cache: Map<string, V>, key: string, value: V): void => {
  if (cache.size >= MEMO_CACHE_MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, value);
};

/**
 * O4 floor memo (Track B, overnight-20260717). `parseStackAddress` is a pure
 * function of its raw input string — no config, no preset, no external state —
 * so the same input always maps to the same result. This function sits on both
 * the plan-parse head (~2s) and the scene-apply tail (~2s) of the canonical
 * trace, where the same address strings recur, so one warmed cache pays twice.
 *
 * The cache stores only the immutable SCALAR fields of the parse (or `null`);
 * every call materializes a FRESH result object from those scalars. This
 * preserves the pre-memo return-value protocol — each call returns a distinct
 * object — so a caller that mutates the returned result can never poison the
 * cache or a later parse of the same string. The cache is bounded via
 * {@link setBoundedMemo}.
 */
const parseStackAddressCache = new Map<string, ParsedStackAddress>();

function computeParseStackAddress(full: string): ParsedStackAddress {
  const trimmed = full.trim();
  const sepIndex = trimmed.indexOf(STACK_ADDRESS_SEP);
  if (sepIndex <= 0) {
    return null;
  }
  const stackId = trimmed.slice(0, sepIndex);
  const address = trimmed.slice(sepIndex + STACK_ADDRESS_SEP.length);
  if (!isValidStackId(stackId) || !address) {
    return null;
  }
  return { stackId, address };
}

export function parseStackAddress(full: string): ParsedStackAddress {
  let cached = parseStackAddressCache.get(full);
  if (cached === undefined) {
    cached = computeParseStackAddress(full);
    setBoundedMemo(parseStackAddressCache, full, cached);
  }
  // Materialize a fresh object per call so a caller mutating the result can
  // never poison the cache (the cached record is never handed out directly).
  return cached === null ? null : { stackId: cached.stackId, address: cached.address };
}

/** Strip stack prefix before Terraform module-path parsing (`module.foo.bar`). */
export function stripStackPrefixForModuleParsing(address: string): string {
  return parseStackAddress(address)?.address ?? address;
}

export function stackGroupModulePath(stackId: string): string {
  return `${STACK_GROUP_PREFIX}${stackId.trim()}`;
}

export function parseStackGroupModulePath(
  modulePath: string,
): { stackId: string } | null {
  if (!modulePath.startsWith(STACK_GROUP_PREFIX)) {
    return null;
  }
  const stackId = modulePath.slice(STACK_GROUP_PREFIX.length);
  if (!isValidStackId(stackId)) {
    return null;
  }
  return { stackId };
}

export function isStackGroupModulePath(modulePath: string): boolean {
  return parseStackGroupModulePath(modulePath) != null;
}

/** Prefix a bare Terraform module path with stack namespace for multi-root imports. */
export function stackQualifiedModulePath(
  stackId: string | undefined,
  bareModulePath: string,
): string {
  const bare = bareModulePath || "root";
  const trimmedStack = stackId?.trim();
  if (!trimmedStack) {
    return bare;
  }
  if (bare === "root") {
    return `${trimmedStack}${STACK_ADDRESS_SEP}root`;
  }
  return prefixStackAddress(trimmedStack, bare);
}

export function stackIdFromBundleLabel(
  label: string | undefined,
  index: number,
): string {
  const trimmed = label?.trim();
  if (trimmed && isValidStackId(trimmed)) {
    return trimmed;
  }
  return `stack-${index + 1}`;
}

export function collectKnownStackIdsFromNodes(
  nodes: Record<string, unknown>,
): string[] {
  const stackIds = new Set<string>();
  for (const key of Object.keys(nodes)) {
    const parsed = parseStackAddress(key);
    if (parsed) {
      stackIds.add(parsed.stackId);
    }
  }
  return [...stackIds];
}

// O4 floor (Track B, overnight-20260717): hoist the instance-index RegExp to
// module scope so it is compiled once instead of re-created on every call. The
// `g` flag carries a mutable `lastIndex`, but `String.prototype.replace(re, "")`
// resets `lastIndex` to 0 on every invocation (and does not rely on incoming
// state), so a shared module-level global-flag regex is behaviorally identical
// to a fresh literal here. Byte-identical by construction.
const INSTANCE_INDEX_RE = /\[[^\]]+\]/g;

const stripInstanceIndexes = (address: string) =>
  address.replace(INSTANCE_INDEX_RE, "");

/** Strip stack prefix and instance indexes for stable cross-key matching. */
export function topologyBareAddressKey(address: string): string {
  const bare = parseStackAddress(address)?.address ?? address;
  return stripInstanceIndexes(bare);
}

const DEDUPE_KEY_SEP = "\0";

/**
 * Key for node deduplication: same stack + same Terraform address (including
 * `count`/`for_each` instance indexes). Different stacks never share a key even
 * when module paths match (e.g. five `module.api` stacks). Unqualified ghosts
 * still collapse via {@link topologyBareAddressKey} in dedupeTerraformPlanNodesByBareAddress.
 */
export function topologyNodeDedupeKey(address: string): string {
  const parsed = parseStackAddress(address);
  const terraformAddress = parsed?.address ?? address.trim();
  if (parsed) {
    return `${parsed.stackId}${DEDUPE_KEY_SEP}${terraformAddress}`;
  }
  return terraformAddress;
}

/** When bare keys collide, prefer `stackId::resource` over unqualified duplicates. */
export function preferTopologyNodeKeyAmongAliases(
  keys: readonly string[],
): string {
  const qualified = keys.filter((k) => parseStackAddress(k));
  if (qualified.length === 1) {
    return qualified[0]!;
  }
  if (qualified.length > 1) {
    return [...qualified].sort((a, b) => a.localeCompare(b))[0]!;
  }
  return [...keys].sort((a, b) => a.localeCompare(b))[0]!;
}
