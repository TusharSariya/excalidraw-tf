/**
 * A4 FIXTURE-TRIPLE churn harness (rcll-v2 spec v2.0 §6-A4, WP-3e / M1b W3).
 * Report-emitting, Q2-style. Measurement/harness ONLY — this file owns NO
 * layout behavior and must never be used to derive/freeze thresholds itself;
 * it emits the JSON the orchestrator reads to derive+freeze the frozen A4
 * thresholds (v2.0 §6-A4 / C11).
 *
 * For each preset (P1 = staging-extended-localstack-v2, derivation; P2 =
 * staging-localstack, validation — same two presets as
 * terraformPipelineQ2Audit.test.ts's PRESET_1/PRESET_2) this harness builds
 * the fixture TRIPLE of minimal semantic plan edits:
 *   1. add-one-resource — clone one existing (bind-referenced) leaf resource
 *      under a fresh address in the SAME container, wired into the declared
 *      dataflow via one new bind + widening an existing single-target tfd
 *      edge line into a 2-target fanout (`X -> Y` -> `X -> Y, newAlias`).
 *      NOTE: `preparePipelineLayout` builds `clusters` EXCLUSIVELY from tfd
 *      declared-dataflow endpoints (nodes[DECLARED_DATAFLOW_ORDERED_KEY]) —
 *      a plan-only resource with no tfd reference never becomes a
 *      primaryCluster, so the tfd wiring above is NOT optional plumbing, it
 *      is required for the mutation to bite at all.
 *   2. add-one-edge — reuses terraformPipelineChurnProbe.test.ts's mid-file
 *      acyclic single-edge-insertion logic (mutateAdd; helpers duplicated
 *      here per that file's own non-exported-helpers precedent, and per
 *      terraformPipelineStrataChurnMetrics.ts's file-header precedent of
 *      duplicating rather than importing to stay additive).
 *   3. moved{}-rename — renames ONE existing resource's address (leaf
 *      segment only, `type.name[idx]` -> `type.name_moved[idx]`) consistently
 *      across every source line that references it: the plan's
 *      `resource_changes` entry, the plan's `prior_state` module tree (else
 *      `buildExistingEdges` synthesizes a phantom "existing" duplicate node
 *      under the OLD address — verified against
 *      packages/excalidraw/components/terraformPlanParsing.tsx), and the tfd
 *      bind line's RHS address token. `renames: {old: new}` is passed to
 *      computeStrataChurnMetrics so the renamed node stays in U (v2.0 §6-A4).
 *
 * For every (preset x arm x mutation) this builds base + mutated layouts via
 * the SAME arm options, runs computeStrataChurnMetrics(base, mutated,
 * {renames?}), and records {mutationNote, healthChecks, metrics}. TEST
 * ASSERTIONS are harness-health ONLY (never thresholds): every mutation
 * bites, no strata arm degrades (rcllV2Degraded absent), U.size >= N_min for
 * every strata cell (reported prominently, never loosened, if a cell is
 * short), m4/m5 status strings present, and a cheap determinism sanity
 * rebuild (one arm's base layout, twice).
 *
 * Run:
 *   Q2_REPORT_DIR=/tmp/a4 yarn vitest run packages/excalidraw/components/terraformPipelineStrataChurnTriple.test.ts
 *
 * Writes A4_TRIPLE_REPORT_P1.json / A4_TRIPLE_REPORT_P2.json to
 * $Q2_REPORT_DIR (default: os tmpdir) — same env var as
 * terraformPipelineQ2Audit.test.ts, per WP-3e brief.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import graphlibDot from "@dagrejs/graphlib-dot";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { DECLARED_DATAFLOW_ORDERED_KEY } from "./terraformDeclaredDataFlow";
import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";
import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
} from "./terraformPlanParsing";
import {
  computeStrataChurnMetrics,
  type ChurnMetrics,
} from "./terraformPipelineStrataChurnMetrics";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";
import type { TerraformPlanDotBundle } from "./terraformImportMerge";

// P1 = derivation preset, P2 = validation preset — identical to
// terraformPipelineQ2Audit.test.ts's PRESET_1 / PRESET_2 (v2.0 §6-A4 C11:
// thresholds derived on preset #1's triple, validated on preset #2's triple).
const PRESET_1 = "staging-extended-localstack-v2";
const PRESET_2 = "staging-localstack";

const REPORT_DIR = process.env.Q2_REPORT_DIR ?? tmpdir();
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 10;

/** Frozen v3.1 §12: N_min = 20, M4 coverage floor = 0.5 (defaults of the
 * metrics module — echoed here only for report/assert messages). */
const N_MIN = 20;

function emitReport(name: string, payload: unknown) {
  const json = JSON.stringify(payload, null, 2);
  writeFileSync(`${REPORT_DIR}/${name}.json`, json);
  // eslint-disable-next-line no-console -- probe output IS the deliverable
  console.log(`${name} written (${json.length} bytes)`);
}

function loadSources(preset: string) {
  const raw = getTerraformImportPresetSourcesFromDb(preset);
  expect(raw, `preset ${preset} exists`).toBeTruthy();
  return resolveSourcesWithTfdComposition(raw! as TerraformImportPresetSources);
}

// ---------------------------------------------------------------------------
// ARMS (WP-3a/3b options; A_v2_baseline = the v2.0 §6-A4 empirical anchor)
// ---------------------------------------------------------------------------

const ARMS: Array<[string, Record<string, unknown>]> = [
  [
    "A_v2_baseline",
    {
      layoutMode: "pipeline",
      pipelineLayoutVariant: "v2",
      pipelineCompact: true,
    },
  ],
  ["G_strata_k0", { layoutMode: "strata", pipelineCompact: true }],
  [
    "H_strata_k4",
    { layoutMode: "strata", pipelineCompact: true, strataSweeps: 4 },
  ],
  [
    "I_strata_k4_a7",
    {
      layoutMode: "strata",
      pipelineCompact: true,
      strataSweeps: 4,
      strataCoordinateRefine: true,
    },
  ],
];
const STRATA_ARM_LABELS: ReadonlySet<string> = new Set([
  "G_strata_k0",
  "H_strata_k4",
  "I_strata_k4_a7",
]);
const DETERMINISM_ARM_LABEL = "I_strata_k4_a7";

// ---------------------------------------------------------------------------
// tfd text surgery — shared low-level helpers
// ---------------------------------------------------------------------------

/** Single-target `src -> tgt` edge line (mirrors terraformPipelineChurnProbe
 * .test.ts's isEdgeLine; duplicated per that file's own non-exported-helper
 * precedent — see file header). */
const isEdgeLine = (line: string): { src: string; tgt: string } | null => {
  const t = line.trim();
  if (!t || t.startsWith("#") || /^bind\s/i.test(t) || t.includes("-->")) {
    return null;
  }
  const m = t.match(/^([^\s#]+)\s*->\s*(.+)$/);
  if (!m) {
    return null;
  }
  const targets = m[2]!.split(",").map((s) => s.trim());
  if (targets.length !== 1) {
    return null;
  }
  return { src: m[1]!, tgt: targets[0]! };
};

const parseBindsMap = (lines: readonly string[]): Map<string, string> => {
  const binds = new Map<string, string>();
  for (const line of lines) {
    const m = line.trim().match(/^bind\s+([A-Za-z_][\w]*)\s*=?\s+(.+)$/i);
    if (m) {
      binds.set(m[1]!, m[2]!.trim());
    }
  }
  return binds;
};

/** index of the tfd file with the most single-target edge lines. */
const pickTfdFile = (texts: readonly string[]): number => {
  let best = -1;
  let bestCount = -1;
  texts.forEach((t, i) => {
    const n = (t ?? "")
      .split(/\r?\n/)
      .filter((l) => isEdgeLine(l) != null).length;
    if (n > bestCount) {
      bestCount = n;
      best = i;
    }
  });
  expect(bestCount).toBeGreaterThan(10);
  return best;
};

/** C (add-one-edge, verbatim port of terraformPipelineChurnProbe.test.ts's
 * mutateAdd): insert one NEW edge (acyclic, non-duplicate) mid-file. */
const mutateAddEdge = (
  texts: readonly string[],
): { texts: string[]; note: string; touchedAddresses: string[] } => {
  const fi = pickTfdFile(texts);
  const lines = texts[fi]!.split(/\r?\n/);
  const binds = parseBindsMap(lines);
  const canon = (a: string) => binds.get(a) ?? a;

  const adj = new Map<string, Set<string>>();
  const edgeSet = new Set<string>();
  const plainEdges: Array<{ src: string; tgt: string; idx: number }> = [];
  lines.forEach((raw, idx) => {
    const t = raw.trim();
    if (!t || t.startsWith("#") || /^bind\s/i.test(t)) {
      return;
    }
    const m = t.match(/^([^\s#]+)\s*-{1,2}>\s*(.+)$/);
    if (!m) {
      return;
    }
    const src = canon(m[1]!);
    for (const tgtRaw of m[2]!.split(",")) {
      const tgt = canon(tgtRaw.trim());
      if (!tgt) {
        continue;
      }
      if (!adj.has(src)) {
        adj.set(src, new Set());
      }
      adj.get(src)!.add(tgt);
      edgeSet.add(`${src} ${tgt}`);
    }
    const plain = isEdgeLine(raw);
    if (plain) {
      plainEdges.push({ src: plain.src, tgt: plain.tgt, idx });
    }
  });

  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>([from]);
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === to) {
        return true;
      }
      for (const nxt of adj.get(cur) ?? []) {
        if (!seen.has(nxt)) {
          seen.add(nxt);
          stack.push(nxt);
        }
      }
    }
    return false;
  };

  let pick: { a: string; c: string } | null = null;
  outer: for (let i = 0; i < Math.floor(plainEdges.length / 3); i++) {
    const a = plainEdges[i]!.src;
    for (
      let j = plainEdges.length - 1;
      j >= Math.floor((plainEdges.length * 2) / 3);
      j--
    ) {
      const c = plainEdges[j]!.tgt;
      const ca = canon(a);
      const cc = canon(c);
      if (ca !== cc && !edgeSet.has(`${ca} ${cc}`) && !reaches(cc, ca)) {
        pick = { a, c };
        break outer;
      }
    }
  }
  expect(pick, "found a safe new edge to insert").not.toBeNull();
  const midLine = plainEdges[Math.floor(plainEdges.length / 2)]!.idx;
  const newLine = `${pick!.a} -> ${pick!.c}`;
  const next = [...lines.slice(0, midLine), newLine, ...lines.slice(midLine)];
  const out = [...texts];
  out[fi] = next.join("\n");
  return {
    texts: out,
    note: `inserted "${newLine}" before line ${midLine + 1} of tfd[${fi}]`,
    touchedAddresses: [pick!.a, pick!.c].map(canon),
  };
};

// ---------------------------------------------------------------------------
// address / bind parsing shared by add-one-resource + moved{}-rename
// ---------------------------------------------------------------------------

type BindEntry = {
  alias: string;
  rhs: string;
  fileIndex: number;
  lineIndex: number;
};

function parseAllBindEntries(texts: readonly string[]): BindEntry[] {
  const out: BindEntry[] = [];
  texts.forEach((text, fileIndex) => {
    const lines = (text ?? "").split(/\r?\n/);
    lines.forEach((line, lineIndex) => {
      const m = line.trim().match(/^bind\s+([A-Za-z_][\w]*)\s*=?\s+(.+)$/i);
      if (m) {
        out.push({ alias: m[1]!, rhs: m[2]!.trim(), fileIndex, lineIndex });
      }
    });
  });
  return out;
}

/** `STACKID::ADDRESS` -> bare `ADDRESS` (or the RHS unchanged if no stack
 * prefix is present). */
const bareAddressOf = (rhs: string): string =>
  rhs.includes("::") ? rhs.slice(rhs.indexOf("::") + 2) : rhs;

type ParsedAddress = {
  prefix: string;
  type: string;
  name: string;
  indexSuffix: string;
};

/** Parses a bare terraform resource address `[module.a.module.b.]type.name[idx]`
 * into its module-path prefix, type, leaf name, and optional index suffix. */
function parseResourceAddress(address: string): ParsedAddress | null {
  const m = address.match(
    /^(.*\.)?([A-Za-z_][\w-]*)\.([A-Za-z_][\w-]*)(\[[^\]]*\])?$/,
  );
  if (!m) {
    return null;
  }
  return {
    prefix: m[1] ?? "",
    type: m[2]!,
    name: m[3]!,
    indexSuffix: m[4] ?? "",
  };
}

type BindCandidate = BindEntry & { bareAddress: string; parsed: ParsedAddress };

function pickBindCandidate(
  binds: readonly BindEntry[],
  resourceAddresses: ReadonlySet<string>,
  opts: { requireNoBracket?: boolean } = {},
): BindCandidate {
  for (const b of binds) {
    const bare = bareAddressOf(b.rhs);
    if (!resourceAddresses.has(bare)) {
      continue;
    }
    if (opts.requireNoBracket && bare.includes("[")) {
      continue;
    }
    const parsed = parseResourceAddress(bare);
    if (!parsed) {
      continue;
    }
    return { ...b, bareAddress: bare, parsed };
  }
  throw new Error("pickBindCandidate: no matching bind found (harness bug)");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Renames every whole-token occurrence of `oldAddr` to `newAddr` across a
 * tfd text (bind RHS today; any direct un-aliased edge-line reference in a
 * future preset format is covered by the same token-boundary regex). */
function renameAddressTokenInText(
  text: string,
  oldAddr: string,
  newAddr: string,
): string {
  const re = new RegExp(
    `(?<![\\w.\\]])${escapeRegExp(oldAddr)}(?![\\w.[])`,
    "g",
  );
  return text.replace(re, newAddr);
}

// ---------------------------------------------------------------------------
// plan.json (JS object) mutation helpers
// ---------------------------------------------------------------------------

type RawPlan = {
  resource_changes: Array<Record<string, unknown>>;
  prior_state?: { values?: { root_module?: unknown } };
  [k: string]: unknown;
};

function clonePlan(plan: unknown): RawPlan {
  return JSON.parse(JSON.stringify(plan)) as RawPlan;
}

function resourceChangeAddresses(plan: RawPlan): Set<string> {
  return new Set(
    plan.resource_changes
      .map((rc) => rc.address)
      .filter((a): a is string => typeof a === "string"),
  );
}

/** Recursively renames every `{address: oldAddr, ...}` object's `.address`
 * (and `.name`, and any `depends_on` reference) to the new value, walking
 * the WHOLE plan object graph (resource_changes + prior_state module tree +
 * anything else) so no stage of buildTerraformLocalImportNodesMap /
 * buildExistingEdges can resurrect a phantom node under the OLD address. */
function renameAddressEverywhereInPlan(
  plan: RawPlan,
  oldAddr: string,
  newAddr: string,
  newName: string,
): number {
  let count = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (typeof obj.address === "string" && obj.address === oldAddr) {
        obj.address = newAddr;
        count += 1;
        if (typeof obj.name === "string") {
          obj.name = newName;
        }
      }
      if (Array.isArray(obj.depends_on)) {
        obj.depends_on = (obj.depends_on as unknown[]).map((d) =>
          d === oldAddr ? newAddr : d,
        );
      }
      for (const key of Object.keys(obj)) {
        if (key === "address" || key === "depends_on") {
          continue;
        }
        walk(obj[key]);
      }
    }
  };
  walk(plan);
  return count;
}

// ---------------------------------------------------------------------------
// mutation builders — return a self-contained {planDotBundles, tfdTexts}
// payload ready to hand to layoutTerraformViaWorkers, arm-independent (built
// once per preset, reused across all 4 arms).
// ---------------------------------------------------------------------------

type MutationLabel = "addOneResource" | "addOneEdge" | "movedRename";

type MutationPayload = {
  label: MutationLabel;
  planDotBundles: TerraformPlanDotBundle[];
  tfdTexts: string[];
  note: string;
  oldAddress?: string;
  newAddress?: string;
  touchedAddresses?: string[];
};

function buildAddResourceMutation(
  sources: TerraformImportPresetSources,
): MutationPayload {
  const bundle = sources.planDotBundles[0]!;
  const plan = clonePlan(bundle.plan);
  const resourceAddrs = resourceChangeAddresses(plan);
  const binds = parseAllBindEntries(sources.tfdTexts);
  const picked = pickBindCandidate(binds, resourceAddrs, {
    requireNoBracket: true,
  });
  const newName = `${picked.parsed.name}_a4new`;
  const newAddress = `${picked.parsed.prefix}${picked.parsed.type}.${newName}${picked.parsed.indexSuffix}`;
  expect(resourceAddrs.has(newAddress), "new address must not pre-exist").toBe(
    false,
  );

  const origEntry = plan.resource_changes.find(
    (rc) => rc.address === picked.bareAddress,
  );
  expect(origEntry, `resource_changes has ${picked.bareAddress}`).toBeTruthy();
  const clonedEntry = JSON.parse(JSON.stringify(origEntry)) as Record<
    string,
    unknown
  >;
  clonedEntry.address = newAddress;
  if (typeof clonedEntry.name === "string") {
    clonedEntry.name = newName;
  }
  plan.resource_changes = [...plan.resource_changes, clonedEntry];

  const newAlias = `${picked.alias}_a4new`;
  const newRhs = picked.rhs.includes("::")
    ? `${picked.rhs.slice(0, picked.rhs.indexOf("::"))}::${newAddress}`
    : newAddress;
  const newBindLine = `bind ${newAlias} = ${newRhs}`;

  const texts = [...sources.tfdTexts];
  const bindFileLines = texts[picked.fileIndex]!.split(/\r?\n/);
  bindFileLines.splice(picked.lineIndex + 1, 0, newBindLine);
  texts[picked.fileIndex] = bindFileLines.join("\n");

  // Wire the new resource into the declared dataflow: widen an existing
  // single-target edge line into a 2-target fanout. preparePipelineLayout
  // builds `clusters` EXCLUSIVELY from tfd declared-dataflow endpoints, so
  // without this the cloned resource would never become a primaryCluster.
  const edgeFileIdx = pickTfdFile(texts);
  const edgeLines = texts[edgeFileIdx]!.split(/\r?\n/);
  const edgeIdx = edgeLines
    .map((l, i) => (isEdgeLine(l) ? i : -1))
    .filter((i) => i >= 0);
  expect(edgeIdx.length).toBeGreaterThan(0);
  const mid = edgeIdx[Math.floor(edgeIdx.length / 2)]!;
  const parsedEdge = isEdgeLine(edgeLines[mid]!)!;
  edgeLines[mid] = `${parsedEdge.src} -> ${parsedEdge.tgt}, ${newAlias}`;
  texts[edgeFileIdx] = edgeLines.join("\n");

  return {
    label: "addOneResource",
    planDotBundles: [{ ...bundle, plan }],
    tfdTexts: texts,
    note:
      `duplicated resource "${picked.bareAddress}" -> "${newAddress}" ` +
      `(new bind ${newAlias}); attached via widening ` +
      `"${parsedEdge.src} -> ${parsedEdge.tgt}" into a 2-target fanout in tfd[${edgeFileIdx}]`,
    oldAddress: picked.bareAddress,
    newAddress,
  };
}

function buildAddEdgeMutation(
  sources: TerraformImportPresetSources,
): MutationPayload {
  const { texts, note, touchedAddresses } = mutateAddEdge(sources.tfdTexts);
  return {
    label: "addOneEdge",
    planDotBundles: sources.planDotBundles,
    tfdTexts: texts,
    note,
    touchedAddresses,
  };
}

function buildRenameMutation(
  sources: TerraformImportPresetSources,
): MutationPayload {
  const bundle = sources.planDotBundles[0]!;
  const plan = clonePlan(bundle.plan);
  const resourceAddrs = resourceChangeAddresses(plan);
  // pick from the tail of the bind list (distinct from add-one-resource's
  // head pick, purely for coverage diversity — not a correctness constraint).
  const binds = [...parseAllBindEntries(sources.tfdTexts)].reverse();
  const picked = pickBindCandidate(binds, resourceAddrs, {});
  const newName = `${picked.parsed.name}_moved`;
  const newAddress = `${picked.parsed.prefix}${picked.parsed.type}.${newName}${picked.parsed.indexSuffix}`;
  expect(resourceAddrs.has(newAddress), "new address must not pre-exist").toBe(
    false,
  );

  const renameCount = renameAddressEverywhereInPlan(
    plan,
    picked.bareAddress,
    newAddress,
    newName,
  );
  expect(
    renameCount,
    "rename must hit >=1 plan object (resource_changes and/or prior_state)",
  ).toBeGreaterThanOrEqual(1);

  const texts = sources.tfdTexts.map((text) =>
    renameAddressTokenInText(text ?? "", picked.bareAddress, newAddress),
  );
  const textsChanged = texts.some((t, i) => t !== sources.tfdTexts[i]);
  expect(textsChanged, "rename must textually alter >=1 tfd file").toBe(true);

  return {
    label: "movedRename",
    planDotBundles: [{ ...bundle, plan }],
    tfdTexts: texts,
    note: `renamed "${picked.bareAddress}" -> "${newAddress}" (bind ${picked.alias}; ${renameCount} plan object(s) updated)`,
    oldAddress: picked.bareAddress,
    newAddress,
  };
}

// ---------------------------------------------------------------------------
// layout runner + scene readers
// ---------------------------------------------------------------------------

type LayoutResult = {
  elements: ExcalidrawElement[];
  live: ExcalidrawElement[];
  meta: Record<string, unknown>;
};

async function runLayout(
  planDotBundles: readonly TerraformPlanDotBundle[],
  tfdTexts: readonly string[],
  tfdLabels: readonly string[],
  options: Record<string, unknown>,
): Promise<LayoutResult> {
  clearTerraformImportPrepCache();
  const body = await layoutTerraformViaWorkers(
    {
      planDotBundles: [...planDotBundles],
      states: [],
      stateLabels: [],
      tfdTexts: [...tfdTexts],
      tfdLabels: [...tfdLabels],
    },
    { semanticLayout: false, ...options },
  );
  const elements = (body.elements ?? []) as ExcalidrawElement[];
  const live = elements.filter((e) => !e.isDeleted);
  const meta = (body.meta ?? {}) as Record<string, unknown>;
  return { elements, live, meta };
}

/** Sanity guard mirroring terraformPipelineQ2Audit.test.ts's per-bundle
 * pre-check: fails fast with a clear message if this harness's own text
 * surgery broke tfd parsing, rather than surfacing as an opaque engine error
 * or (worse) a silently-vacuous 0-edge declared dataflow. */
function assertTfdOverlayResolves(
  bundle: TerraformPlanDotBundle,
  tfdTexts: readonly string[],
  tfdLabels: readonly string[],
  label: string,
): void {
  const graph = graphlibDot.read("digraph G {}\n");
  const nodes = buildTerraformLocalImportNodesMap(bundle.plan, graph, [], {});
  applyTfdOverlayToNodes(nodes, [...tfdTexts], [...tfdLabels]);
  const count =
    (nodes[DECLARED_DATAFLOW_ORDERED_KEY] as unknown[] | undefined)?.length ??
    0;
  expect(
    count,
    `${label}: tfd overlay resolves to >0 declared edges`,
  ).toBeGreaterThan(0);
}

function collectPrimaryClusterAddresses(
  elements: readonly ExcalidrawElement[],
): Set<string> {
  const out = new Set<string>();
  for (const el of elements) {
    if (el.type !== "frame" || el.isDeleted) {
      continue;
    }
    const cd = el.customData as Record<string, unknown> | undefined;
    if (
      cd?.terraformTopologyRole === "primaryCluster" &&
      typeof cd.terraformPrimaryAddress === "string"
    ) {
      out.add(cd.terraformPrimaryAddress);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// per-mutation health checks
// ---------------------------------------------------------------------------

type HealthCheck = { name: string; pass: boolean; detail: string };

function buildHealthChecks(
  mutation: MutationPayload,
  base: LayoutResult,
  mutated: LayoutResult,
  metrics: ChurnMetrics,
): HealthCheck[] {
  const checks: HealthCheck[] = [];
  const baseClusterAddrs = collectPrimaryClusterAddresses(base.elements);
  const mutatedClusterAddrs = collectPrimaryClusterAddresses(mutated.elements);

  if (mutation.label === "addOneResource") {
    checks.push({
      name: "primaryCluster frame count +1",
      pass: mutatedClusterAddrs.size === baseClusterAddrs.size + 1,
      detail: `base=${baseClusterAddrs.size} mutated=${mutatedClusterAddrs.size}`,
    });
    const basePcc =
      typeof base.meta.pipelineClusterCount === "number"
        ? base.meta.pipelineClusterCount
        : null;
    const mutPcc =
      typeof mutated.meta.pipelineClusterCount === "number"
        ? mutated.meta.pipelineClusterCount
        : null;
    checks.push({
      name: "meta.pipelineClusterCount +1",
      pass: basePcc !== null && mutPcc !== null && mutPcc === basePcc + 1,
      detail: `base=${basePcc} mutated=${mutPcc}`,
    });
    checks.push({
      name: "new address present in mutated cluster set, absent from base",
      pass:
        typeof mutation.newAddress === "string" &&
        mutatedClusterAddrs.has(mutation.newAddress) &&
        !baseClusterAddrs.has(mutation.newAddress),
      detail: `newAddress=${mutation.newAddress}`,
    });
  } else if (mutation.label === "addOneEdge") {
    const baseArrowCount = diagnosePipelineScene(base.elements).dataflow
      .tfdArrowCount;
    const mutArrowCount = diagnosePipelineScene(mutated.elements).dataflow
      .tfdArrowCount;
    checks.push({
      name: "tfdArrowCount +1",
      pass: mutArrowCount === baseArrowCount + 1,
      detail: `base=${baseArrowCount} mutated=${mutArrowCount}`,
    });
    checks.push({
      name: "layout not degraded (mutated element count sane)",
      pass: mutated.live.length > 0 && Number.isFinite(mutated.live.length),
      detail: `mutatedElementCount=${mutated.live.length}`,
    });
  } else {
    checks.push({
      name: "old address absent from mutated cluster addresses",
      pass:
        typeof mutation.oldAddress === "string" &&
        !mutatedClusterAddrs.has(mutation.oldAddress),
      detail: `oldAddress=${mutation.oldAddress}`,
    });
    checks.push({
      name: "new address present in mutated cluster addresses",
      pass:
        typeof mutation.newAddress === "string" &&
        mutatedClusterAddrs.has(mutation.newAddress),
      detail: `newAddress=${mutation.newAddress}`,
    });
    checks.push({
      name: "U.size > 0 with rename applied",
      pass: metrics.U.size > 0,
      detail: `U.size=${metrics.U.size}`,
    });
  }
  return checks;
}

function isDegraded(meta: Record<string, unknown>): boolean {
  return meta.rcllV2Degraded !== undefined && meta.rcllV2Degraded !== false;
}

// ---------------------------------------------------------------------------
// battery
// ---------------------------------------------------------------------------

const MUTATION_LABELS: readonly MutationLabel[] = [
  "addOneResource",
  "addOneEdge",
  "movedRename",
];

async function runPresetBattery(
  preset: string,
): Promise<Record<string, unknown>> {
  const sources = loadSources(preset);
  expect(
    sources.planDotBundles.length,
    `${preset}: single plan/dot bundle (harness assumption)`,
  ).toBe(1);
  const bundle = sources.planDotBundles[0]!;

  assertTfdOverlayResolves(
    bundle,
    sources.tfdTexts,
    sources.tfdLabels,
    `${preset} base`,
  );

  const addResourceMut = buildAddResourceMutation(sources);
  const addEdgeMut = buildAddEdgeMutation(sources);
  const renameMut = buildRenameMutation(sources);
  const mutationsByLabel: Record<MutationLabel, MutationPayload> = {
    addOneResource: addResourceMut,
    addOneEdge: addEdgeMut,
    movedRename: renameMut,
  };

  assertTfdOverlayResolves(
    addResourceMut.planDotBundles[0]!,
    addResourceMut.tfdTexts,
    sources.tfdLabels,
    `${preset} add-one-resource`,
  );
  assertTfdOverlayResolves(
    bundle,
    addEdgeMut.tfdTexts,
    sources.tfdLabels,
    `${preset} add-one-edge`,
  );
  assertTfdOverlayResolves(
    renameMut.planDotBundles[0]!,
    renameMut.tfdTexts,
    sources.tfdLabels,
    `${preset} moved-rename`,
  );

  const softFailures: string[] = [];
  const armsReport: Record<string, unknown> = {};

  for (const [armLabel, armOptions] of ARMS) {
    const base = await runLayout(
      sources.planDotBundles,
      sources.tfdTexts,
      sources.tfdLabels,
      armOptions,
    );

    if (STRATA_ARM_LABELS.has(armLabel) && isDegraded(base.meta)) {
      softFailures.push(
        `${preset}/${armLabel}/base: rcllV2Degraded present (${JSON.stringify(
          base.meta.rcllV2Degraded,
        )})`,
      );
    }

    const armCell: Record<string, unknown> = {
      base: {
        elementCount: base.live.length,
        pipelineClusterCount: base.meta.pipelineClusterCount ?? null,
        rcllV2Degraded: base.meta.rcllV2Degraded ?? null,
      },
    };

    for (const mutLabel of MUTATION_LABELS) {
      const mutation = mutationsByLabel[mutLabel];
      const mutated = await runLayout(
        mutation.planDotBundles,
        mutation.tfdTexts,
        sources.tfdLabels,
        armOptions,
      );

      if (STRATA_ARM_LABELS.has(armLabel) && isDegraded(mutated.meta)) {
        softFailures.push(
          `${preset}/${armLabel}/${mutLabel}: rcllV2Degraded present (${JSON.stringify(
            mutated.meta.rcllV2Degraded,
          )})`,
        );
      }

      const renames =
        mutLabel === "movedRename" &&
        renameMut.oldAddress &&
        renameMut.newAddress
          ? { [renameMut.oldAddress]: renameMut.newAddress }
          : undefined;
      const metrics = computeStrataChurnMetrics(
        base.elements,
        mutated.elements,
        renames ? { renames, nMin: N_MIN } : { nMin: N_MIN },
      );

      const healthChecks = buildHealthChecks(mutation, base, mutated, metrics);
      for (const hc of healthChecks) {
        if (!hc.pass) {
          softFailures.push(
            `${preset}/${armLabel}/${mutLabel}: HEALTH FAIL — ${hc.name} (${hc.detail})`,
          );
        }
      }

      if (STRATA_ARM_LABELS.has(armLabel) && !metrics.U.gatable) {
        softFailures.push(
          `${preset}/${armLabel}/${mutLabel}: U.size=${metrics.U.size} < nMin=${metrics.U.nMin} ` +
            `(BELOW FROZEN N_MIN — do not loosen the gate, flag for the orchestrator)`,
        );
      }
      if (
        typeof metrics.m4.status !== "string" ||
        typeof metrics.m5.status !== "string"
      ) {
        softFailures.push(
          `${preset}/${armLabel}/${mutLabel}: missing m4/m5 status string(s)`,
        );
      }

      armCell[mutLabel] = {
        mutationNote: mutation.note,
        healthChecks,
        mutatedElementCount: mutated.live.length,
        mutatedPipelineClusterCount: mutated.meta.pipelineClusterCount ?? null,
        rcllV2Degraded: mutated.meta.rcllV2Degraded ?? null,
        metrics,
      };
    }

    armsReport[armLabel] = armCell;
  }

  // Determinism sanity (cheap, not a full byte-compare — T1 lives elsewhere):
  // rebuild ONE arm's base layout twice, compare element count + first/last ids.
  const detOptions = ARMS.find(
    ([label]) => label === DETERMINISM_ARM_LABEL,
  )![1];
  const detA = await runLayout(
    sources.planDotBundles,
    sources.tfdTexts,
    sources.tfdLabels,
    detOptions,
  );
  const detB = await runLayout(
    sources.planDotBundles,
    sources.tfdTexts,
    sources.tfdLabels,
    detOptions,
  );
  const idsA = detA.live.map((e) => e.id);
  const idsB = detB.live.map((e) => e.id);
  const determinism = {
    arm: DETERMINISM_ARM_LABEL,
    elementCountA: idsA.length,
    elementCountB: idsB.length,
    firstIdMatch: idsA[0] === idsB[0],
    lastIdMatch: idsA[idsA.length - 1] === idsB[idsB.length - 1],
  };
  const determinismOk =
    determinism.elementCountA === determinism.elementCountB &&
    determinism.firstIdMatch &&
    determinism.lastIdMatch;
  if (!determinismOk) {
    softFailures.push(
      `${preset}: determinism sanity FAILED — ${JSON.stringify(determinism)}`,
    );
  }

  return {
    preset,
    nMin: N_MIN,
    mutations: {
      addOneResource: {
        note: addResourceMut.note,
        oldAddress: addResourceMut.oldAddress,
        newAddress: addResourceMut.newAddress,
      },
      addOneEdge: {
        note: addEdgeMut.note,
        touchedAddresses: addEdgeMut.touchedAddresses,
      },
      movedRename: {
        note: renameMut.note,
        oldAddress: renameMut.oldAddress,
        newAddress: renameMut.newAddress,
      },
    },
    arms: armsReport,
    determinism,
    softFailures,
  };
}

// ---------------------------------------------------------------------------

describe("A4 fixture-triple churn harness (report-emitting)", () => {
  it(
    `${PRESET_1} — A4 fixture triple x 4 arms (derivation preset)`,
    async () => {
      const report = await runPresetBattery(PRESET_1);
      emitReport("A4_TRIPLE_REPORT_P1", report);
      const failures = report.softFailures as string[];
      expect(
        failures,
        `harness health failures:\n${failures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    `${PRESET_2} — A4 fixture triple x 4 arms (validation preset)`,
    async () => {
      const report = await runPresetBattery(PRESET_2);
      emitReport("A4_TRIPLE_REPORT_P2", report);
      const failures = report.softFailures as string[];
      expect(
        failures,
        `harness health failures:\n${failures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );
});
