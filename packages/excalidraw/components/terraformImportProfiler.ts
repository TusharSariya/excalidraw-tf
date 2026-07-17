/**
 * Hierarchical profiler for Terraform import / layout (dev + vitest).
 * Enable: VITEST_TERRAFORM_PROFILE=1, localStorage.terraformImportProfile=1, or DEV.
 */

export type TerraformImportProfilerSpan = {
  name: string;
  ms: number;
  selfMs: number;
  callCount: number;
};

type StackEntry = { name: string; start: number };

let enabled: boolean | null = null;
// Memoized result of the (env/localStorage) auto-resolution. The auto path
// touches process.env, import.meta.env and localStorage; resolving it on EVERY
// `isProfilerEnabled()` call is the per-call overhead a disabled profiler must
// not pay (it sits in front of every `measure`/`record` guard). Resolve once,
// then serve a single boolean read until the override is toggled or reset.
let autoResolved: boolean | null = null;
const stack: StackEntry[] = [];
const totals = new Map<
  string,
  { ms: number; selfMs: number; callCount: number }
>();

function resolveAutoEnabled(): boolean {
  if (
    typeof process !== "undefined" &&
    process.env.VITEST_TERRAFORM_PROFILE === "1"
  ) {
    return true;
  }
  if (
    import.meta.env.DEV &&
    import.meta.env.VITE_TERRAFORM_IMPORT_PROFILE === "1"
  ) {
    return true;
  }
  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem("terraformImportProfile") === "1"
  ) {
    return true;
  }
  return false;
}

function isProfilerEnabled(): boolean {
  if (enabled !== null) {
    return enabled;
  }
  if (autoResolved === null) {
    autoResolved = resolveAutoEnabled();
  }
  return autoResolved;
}

/** Tests / tooling: force profiler on or off (null = auto). */
export function setTerraformImportProfilerEnabled(value: boolean | null): void {
  enabled = value;
  // Drop the memo so a later switch back to auto (null) re-resolves the
  // environment rather than serving a stale snapshot.
  autoResolved = null;
}

export function isTerraformImportProfilerEnabled(): boolean {
  return isProfilerEnabled();
}

function ensureEntry(name: string): {
  ms: number;
  selfMs: number;
  callCount: number;
} {
  let entry = totals.get(name);
  if (!entry) {
    entry = { ms: 0, selfMs: 0, callCount: 0 };
    totals.set(name, entry);
  }
  return entry;
}

function recordSpan(name: string, durationMs: number, selfMs: number): void {
  const entry = ensureEntry(name);
  entry.ms += durationMs;
  entry.selfMs += selfMs;
  entry.callCount += 1;
}

export function terraformImportProfilerMark(_name: string): void {
  // Reserved for future instant events; spans use measure/measureAsync.
}

/**
 * Record an already-timed span directly, without participating in the
 * synchronous parent/child `stack`. This is the zero-overhead-when-disabled and
 * concurrency-safe primitive for instrumenting SIBLING stages (and async stages
 * whose wall time is measured around an `await`): the caller gates the whole
 * thing behind a cached `isTerraformImportProfilerEnabled()` boolean, so when
 * the profiler is off there is no closure allocation, no wrapper call, and no
 * per-call environment probe — the caller simply does not measure.
 *
 * `selfMs` is the recorded duration (flat). Callers that own genuine nesting
 * should keep using `terraformImportProfilerMeasure`, which does the stack-based
 * self-time subtraction; siblings do not nest, so flat recording is exact.
 */
export function terraformImportProfilerRecord(
  name: string,
  durationMs: number,
): void {
  recordSpan(name, durationMs, durationMs);
}

export function terraformImportProfilerMeasure<T>(
  name: string,
  fn: () => T,
): T {
  if (!isProfilerEnabled()) {
    return fn();
  }
  const parentSelf = stack.length > 0 ? stack[stack.length - 1]!.name : null;
  const start = performance.now();
  stack.push({ name, start });
  // Pre-create this span's entry so any child completing before us (post-order
  // `finally`) can decrement our selfMs — otherwise the subtraction silently no-ops.
  ensureEntry(name);
  try {
    return fn();
  } finally {
    stack.pop();
    const durationMs = performance.now() - start;
    recordSpan(name, durationMs, durationMs);
    if (parentSelf) {
      const p = totals.get(parentSelf);
      if (p) {
        p.selfMs -= durationMs;
      }
    }
  }
}

export async function terraformImportProfilerMeasureAsync<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isProfilerEnabled()) {
    return fn();
  }
  // Correctness under concurrent/overlapping builds: an async span must NOT keep
  // a frame on the shared synchronous `stack` across the `await`. If it did,
  // sync spans from an interleaved build (or a nested async span) would resolve
  // THIS span as their parent and decrement the wrong build's selfMs, and the
  // eventual `stack.pop()` could remove the wrong frame. So we snapshot the
  // enclosing parent name synchronously, leave the stack untouched during the
  // await, then subtract this span's wall time from that parent by name (pure
  // arithmetic on the aggregate totals — no stack mutation). selfMs is the span's
  // own wall time (inclusive of any sync children measured during the await);
  // exact self-time attribution across an await would require async-context
  // tracking, which this dev/test profiler intentionally does not carry.
  const parentSelf = stack.length > 0 ? stack[stack.length - 1]!.name : null;
  const start = performance.now();
  ensureEntry(name);
  try {
    return await fn();
  } finally {
    const durationMs = performance.now() - start;
    recordSpan(name, durationMs, durationMs);
    if (parentSelf) {
      const p = totals.get(parentSelf);
      if (p) {
        p.selfMs -= durationMs;
      }
    }
  }
}

export function terraformImportProfilerSummary(): TerraformImportProfilerSpan[] {
  return [...totals.entries()]
    .map(([name, v]) => ({
      name,
      ms: Math.round(v.ms * 100) / 100,
      selfMs: Math.round(Math.max(0, v.selfMs) * 100) / 100,
      callCount: v.callCount,
    }))
    .sort((a, b) => b.selfMs - a.selfMs);
}

export function terraformImportProfilerReset(): void {
  stack.length = 0;
  totals.clear();
  // Re-probe the environment on the next auto-mode call.
  autoResolved = null;
}

export function terraformImportProfilerLogSummary(
  prefix = "[terraform:profile]",
): void {
  if (!isProfilerEnabled()) {
    return;
  }
  const rows = terraformImportProfilerSummary();
  if (rows.length === 0) {
    return;
  }
  // eslint-disable-next-line no-console -- intentional profiling output
  console.log(prefix, rows);
}
