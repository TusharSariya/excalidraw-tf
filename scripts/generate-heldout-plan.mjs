/* eslint-disable no-console -- CLI generator script */
/**
 * W12 WP1 — deterministic generator for the synthetic held-out preset
 * `staging-heldout-mesh` (P3 of the W12 out-of-tuning-distribution battery).
 *
 * Emits into packages/backend/terraform/staging-heldout-mesh/:
 *   plan.json     — terraform show -json shaped plan (resource_changes +
 *                   planned_values module tree; fresh create plan, no prior_state)
 *   graph.dot     — terraform graph shaped dependency DOT (drives edges_new)
 *   pipeline.tfd  — tfd 2 declared dataflow (binds + flows; drives the layout
 *                   substrate). Cycles live HERE, in resolved TFD flow endpoints.
 *
 * Design intent (distinct from P1 staging-extended-localstack-v2 and
 * P2 staging-localstack — see docs/strata-baselines/q12/):
 *   - event-driven MESH topology (EventBridge hub + SNS/SQS/Lambda/SFN cells),
 *     NOT P2's API-gateway lane/fanout pattern and NOT P1's multi-account
 *     org-namespace pattern;
 *   - one high-fanout hub: the mesh event bus, TFD out-degree 16 (>= 12);
 *   - >= 2 reference cycles on RESOLVED TFD flow endpoints:
 *       C1  2-cycle: cell_01 handler <-> cell_02 handler (mutual service calls)
 *       C2  3-cycle: cell_03 sfn -> retry queue -> handler -> sfn
 *       C3  2-cycle: mutual security-group rules (a_to_b <-> b_to_a)
 *   - module depth 4-5 (cell -> service -> runtime -> telemetry [-> tracing]);
 *   - ~400 resource_changes, real AWS resource types only.
 *
 * FIXTURE v2 (AMENDMENT-1, docs/strata-view-w12-heldout-scale.md): v1 fixed
 * every resource to ONE provider/account/region, so the scene had a single
 * band and ZERO slice-B (cross-band) edges — a generator artifact that froze
 * every extent headline cell VOID and left extent transfer unexercised. v2
 * introduces genuine multi-band structure the same way P1/P2 get it (distinct
 * account/region per resource via `after.arn` + `after.region`, the values
 * resolveAccountRegion/extractRegionalTopologyPrimaries band on):
 *   - band 1 (primary):       account 000000000000 / us-east-1 — mesh core,
 *     network, cells 01-12;
 *   - band 2 (west replica):  account 000000000000 / us-west-2 — cells 13-14;
 *   - band 3 (observability): account 210987654321 / us-east-1 — cells 15-16
 *     + module.observability audit/alert sinks.
 *   Cross-band TFD flows: hub fan-out to cells 13-16, the i->i+4 cascade
 *   lanes into cells 13-16, and two mesh-wide fan-ins into the observability
 *   account (sfn -> audit_stream, dlq_alarm -> ops_alerts) — >= 31 distinct
 *   cross-band declared edges so the frozen p90 floor (v3.1 §12, n >= 31) is
 *   reachable. Depth-5 modules, the hub out-degree and all three cycles are
 *   UNCHANGED from v1; band structure is the ONLY topology-affecting change.
 *
 * DETERMINISM: mulberry32 PRNG seeded 20260704 (frozen v3.1 §12 seed).
 * NO Date.now / Math.random anywhere; timestamp is a fixed literal.
 * Rerunning the generator reproduces the committed files byte-for-byte.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(
  REPO_ROOT,
  "packages/backend/terraform/staging-heldout-mesh",
);

const SEED = 20260704;
const STACK_ID = "staging-heldout-mesh";
const REGION = "us-east-1";
const ACCOUNT = "000000000000";
const FIXED_TIMESTAMP = "2026-07-04T00:00:00Z";
const CELL_COUNT = 16;
const HUB_ADDRESS = "module.mesh_core.aws_cloudwatch_event_bus.mesh";

// ── v2 multi-band structure (AMENDMENT-1) ────────────────────────────────────
// Deterministic module-address → (account, region) band map. Bands surface in
// `resource_changes[].change.after.{arn,region}` — the exact values the
// pipeline's resolveAccountRegion / extractRegionalTopologyPrimaries read to
// build provider/account/region hulls (the slice-B "cross-band" seam).
const BANDS = {
  primary: { key: "primary", account: ACCOUNT, region: REGION },
  westReplica: { key: "westReplica", account: ACCOUNT, region: "us-west-2" },
  observability: {
    key: "observability",
    account: "210987654321",
    region: REGION,
  },
};

function bandForModule(moduleAddress) {
  const m = /^module\.cell_(\d{2})\b/.exec(moduleAddress ?? "");
  if (m) {
    const i = Number(m[1]);
    if (i === 13 || i === 14) {
      return BANDS.westReplica;
    }
    if (i >= 15) {
      return BANDS.observability;
    }
    return BANDS.primary;
  }
  if ((moduleAddress ?? "").startsWith("module.observability")) {
    return BANDS.observability;
  }
  return BANDS.primary;
}

/** mulberry32 — same construction as terraformPipelineBootstrapCi. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

// ── resource model ───────────────────────────────────────────────────────────

/** address -> { type, name, module, deps: [addresses] } */
const resources = new Map();

function addResource(moduleAddress, type, name, values = {}, deps = []) {
  const address = moduleAddress
    ? `${moduleAddress}.${type}.${name}`
    : `${type}.${name}`;
  if (resources.has(address)) {
    throw new Error(`duplicate address: ${address}`);
  }
  resources.set(address, {
    address,
    module: moduleAddress,
    band: bandForModule(moduleAddress),
    type,
    name,
    values,
    deps: [...deps],
  });
  return address;
}

const arnFor = (type, name, band) => {
  const service = type.replace(/^aws_/, "").split("_")[0];
  return `arn:aws:${service}:${band.region}:${band.account}:${name}`;
};

const TAGS = {
  environment: "staging",
  managed_by: "terraform",
  stack: STACK_ID,
};

// ── mesh core (depth 1-2) ────────────────────────────────────────────────────

const busAddr = addResource(
  "module.mesh_core",
  "aws_cloudwatch_event_bus",
  "mesh",
  {
    name: "heldout-mesh-bus",
  },
);
const meshKms = addResource("module.mesh_core", "aws_kms_key", "mesh", {
  description: "heldout mesh envelope key",
});
addResource(
  "module.mesh_core",
  "aws_cloudwatch_log_group",
  "bus_audit",
  { name: "/aws/events/heldout-mesh/audit", retention_in_days: 30 },
  [busAddr, meshKms],
);

const registryTable = addResource(
  "module.mesh_core.module.registry",
  "aws_dynamodb_table",
  "services",
  { name: "heldout-mesh-service-registry", billing_mode: "PAY_PER_REQUEST" },
  [meshKms],
);
const registryRole = addResource(
  "module.mesh_core.module.registry",
  "aws_iam_role",
  "registry",
  { name: "heldout-mesh-registry" },
);
addResource(
  "module.mesh_core.module.registry",
  "aws_iam_role_policy",
  "registry",
  { name: "heldout-mesh-registry-rw" },
  [registryRole, registryTable],
);

// ── network (mutual SG rules — reference-cycle material) ─────────────────────

const sgA = addResource("module.network", "aws_security_group", "mesh_a", {
  name: "heldout-mesh-a",
});
const sgB = addResource("module.network", "aws_security_group", "mesh_b", {
  name: "heldout-mesh-b",
});
const sgRuleAB = addResource(
  "module.network",
  "aws_security_group_rule",
  "a_to_b",
  { type: "ingress", from_port: 443, to_port: 443, protocol: "tcp" },
  [sgA, sgB],
);
const sgRuleBA = addResource(
  "module.network",
  "aws_security_group_rule",
  "b_to_a",
  { type: "ingress", from_port: 443, to_port: 443, protocol: "tcp" },
  [sgB, sgA],
);
addResource(
  "module.network",
  "aws_security_group_rule",
  "a_egress",
  { type: "egress", from_port: 0, to_port: 0, protocol: "-1" },
  [sgA],
);
addResource(
  "module.network",
  "aws_security_group_rule",
  "b_egress",
  { type: "egress", from_port: 0, to_port: 0, protocol: "-1" },
  [sgB],
);

// ── observability sinks (band 3 — the cross-band fan-in targets, v2) ─────────

const auditStream = addResource(
  "module.observability",
  "aws_sns_topic",
  "audit_stream",
  { name: "heldout-mesh-audit-stream" },
);
const opsAlerts = addResource(
  "module.observability",
  "aws_sns_topic",
  "ops_alerts",
  { name: "heldout-mesh-ops-alerts" },
);
addResource(
  "module.observability",
  "aws_cloudwatch_log_group",
  "audit",
  { name: "/heldout/mesh/audit", retention_in_days: 30 },
  [auditStream],
);

// ── cells (depth 1..5) ───────────────────────────────────────────────────────

const cells = [];
for (let i = 1; i <= CELL_COUNT; i++) {
  const id = String(i).padStart(2, "0");
  const cellMod = `module.cell_${id}`;
  const serviceMod = `${cellMod}.module.service`;
  const runtimeMod = `${serviceMod}.module.runtime`;
  const telemetryMod = `${runtimeMod}.module.telemetry`;
  // every 4th cell gets a depth-5 tracing module
  const deep = i % 4 === 0;
  const tracingMod = `${telemetryMod}.module.tracing`;
  // deterministic store flavor mix
  const storeFlavor = pick(["dynamodb", "dynamodb", "s3"]);

  // cell level (module depth 1)
  const ingress = addResource(cellMod, "aws_sns_topic", "ingress", {
    name: `heldout-cell-${id}-ingress`,
  });
  const work = addResource(cellMod, "aws_sqs_queue", "work", {
    name: `heldout-cell-${id}-work`,
  });
  const dlq = addResource(cellMod, "aws_sqs_queue", "dlq", {
    name: `heldout-cell-${id}-dlq`,
  });
  addResource(
    cellMod,
    "aws_sns_topic_subscription",
    "work",
    { protocol: "sqs" },
    [ingress, work],
  );
  const dlqAlarm = addResource(
    cellMod,
    "aws_cloudwatch_metric_alarm",
    "dlq_depth",
    { alarm_name: `heldout-cell-${id}-dlq-depth` },
    [dlq],
  );
  addResource(cellMod, "aws_ssm_parameter", "config", {
    name: `/heldout/cell-${id}/config`,
    type: "String",
  });
  const store =
    storeFlavor === "s3"
      ? addResource(cellMod, "aws_s3_bucket", "state", {
          bucket: `heldout-cell-${id}-state`,
        })
      : addResource(cellMod, "aws_dynamodb_table", "state", {
          name: `heldout-cell-${id}-state`,
          billing_mode: "PAY_PER_REQUEST",
        });
  // cells 1-4 get an explicit retry queue (cycle material for cell_03)
  const retry =
    i <= 4
      ? addResource(cellMod, "aws_sqs_queue", "retry", {
          name: `heldout-cell-${id}-retry`,
        })
      : null;

  // service level (module depth 2)
  const sfnRole = addResource(serviceMod, "aws_iam_role", "sfn", {
    name: `heldout-cell-${id}-sfn`,
  });
  addResource(
    serviceMod,
    "aws_iam_role_policy",
    "sfn",
    { name: `heldout-cell-${id}-sfn-invoke` },
    [sfnRole],
  );

  // runtime level (module depth 3)
  const handlerRole = addResource(runtimeMod, "aws_iam_role", "handler", {
    name: `heldout-cell-${id}-handler`,
  });
  addResource(
    runtimeMod,
    "aws_iam_role_policy",
    "handler",
    { name: `heldout-cell-${id}-handler-rw` },
    [handlerRole, store],
  );
  const handler = addResource(
    runtimeMod,
    "aws_lambda_function",
    "handler",
    { function_name: `heldout-cell-${id}-handler`, runtime: "nodejs20.x" },
    [handlerRole, sgA],
  );
  addResource(
    runtimeMod,
    "aws_lambda_event_source_mapping",
    "work",
    { batch_size: 10 },
    [work, handler],
  );
  addResource(
    runtimeMod,
    "aws_cloudwatch_log_group",
    "handler",
    { name: `/aws/lambda/heldout-cell-${id}-handler`, retention_in_days: 14 },
    [handler],
  );
  const transformer = addResource(
    runtimeMod,
    "aws_lambda_function",
    "transformer",
    { function_name: `heldout-cell-${id}-transformer`, runtime: "nodejs20.x" },
    [handlerRole, sgB],
  );
  addResource(
    runtimeMod,
    "aws_cloudwatch_log_group",
    "transformer",
    {
      name: `/aws/lambda/heldout-cell-${id}-transformer`,
      retention_in_days: 14,
    },
    [transformer],
  );

  // sfn depends on runtime lambdas (service level, declared after runtime)
  const sfn = addResource(
    serviceMod,
    "aws_sfn_state_machine",
    "orchestrator",
    { name: `heldout-cell-${id}-orchestrator` },
    [sfnRole, handler, transformer],
  );

  // telemetry level (module depth 4)
  const errorsAlarm = addResource(
    telemetryMod,
    "aws_cloudwatch_metric_alarm",
    "handler_errors",
    { alarm_name: `heldout-cell-${id}-handler-errors` },
    [handler],
  );
  addResource(
    telemetryMod,
    "aws_cloudwatch_metric_alarm",
    "handler_throttles",
    { alarm_name: `heldout-cell-${id}-handler-throttles` },
    [handler],
  );
  addResource(telemetryMod, "aws_cloudwatch_log_group", "telemetry", {
    name: `/heldout/cell-${id}/telemetry`,
    retention_in_days: 7,
  });
  addResource(
    telemetryMod,
    "aws_cloudwatch_event_rule",
    "heartbeat",
    {
      name: `heldout-cell-${id}-heartbeat`,
      schedule_expression: "rate(5 minutes)",
    },
    [],
  );

  // tracing level (module depth 5, every 4th cell)
  let traceAlerts = null;
  if (deep) {
    const traceLog = addResource(
      tracingMod,
      "aws_cloudwatch_log_group",
      "trace",
      {
        name: `/heldout/cell-${id}/trace`,
        retention_in_days: 3,
      },
    );
    addResource(
      tracingMod,
      "aws_cloudwatch_metric_alarm",
      "trace_latency",
      { alarm_name: `heldout-cell-${id}-trace-latency` },
      [traceLog],
    );
    traceAlerts = addResource(tracingMod, "aws_sns_topic", "trace_alerts", {
      name: `heldout-cell-${id}-trace-alerts`,
    });
  }

  // hub routing (mesh core level): rule + target per cell
  const rule = addResource(
    "module.mesh_core",
    "aws_cloudwatch_event_rule",
    `cell_${id}`,
    { name: `heldout-route-cell-${id}` },
    [busAddr],
  );
  addResource(
    "module.mesh_core",
    "aws_cloudwatch_event_target",
    `cell_${id}`,
    { target_id: `cell-${id}` },
    [rule, ingress],
  );

  cells.push({
    id,
    ingress,
    work,
    dlq,
    dlqAlarm,
    retry,
    store,
    handler,
    transformer,
    sfn,
    errorsAlarm,
    traceAlerts,
    deep,
  });
}

// ── plan.json ────────────────────────────────────────────────────────────────

function resourceChangeFor(r) {
  // v2 (AMENDMENT-1): `arn` + `region` in `after` carry the band — the same
  // per-resource signals real multi-account plans (P1) band on.
  const after = {
    ...r.values,
    arn: arnFor(r.type, r.name, r.band),
    region: r.band.region,
    tags: {},
    tags_all: TAGS,
  };
  return {
    address: r.address,
    ...(r.module ? { module_address: r.module } : {}),
    mode: "managed",
    type: r.type,
    name: r.name,
    provider_name: "registry.terraform.io/hashicorp/aws",
    change: {
      actions: ["create"],
      before: null,
      after,
      after_unknown: { id: true },
      before_sensitive: false,
      after_sensitive: { tags: {}, tags_all: {} },
    },
  };
}

/** planned_values.root_module tree mirroring the module nesting. */
function buildPlannedValues() {
  const moduleNodes = new Map(); // module address -> node
  const rootNode = { resources: [], child_modules: [] };
  const nodeFor = (moduleAddress) => {
    if (!moduleAddress) {
      return rootNode;
    }
    if (moduleNodes.has(moduleAddress)) {
      return moduleNodes.get(moduleAddress);
    }
    const node = {
      address: moduleAddress,
      resources: [],
      child_modules: [],
    };
    moduleNodes.set(moduleAddress, node);
    const parentAddress = moduleAddress.replace(/\.module\.[^.]+$/, "");
    const parent =
      parentAddress === moduleAddress ? rootNode : nodeFor(parentAddress);
    parent.child_modules.push(node);
    return node;
  };
  for (const r of resources.values()) {
    nodeFor(r.module).resources.push({
      address: r.address,
      mode: "managed",
      type: r.type,
      name: r.name,
      provider_name: "registry.terraform.io/hashicorp/aws",
      schema_version: 0,
      values: {
        ...r.values,
        arn: arnFor(r.type, r.name, r.band),
        region: r.band.region,
        tags: {},
        tags_all: TAGS,
      },
      sensitive_values: {},
    });
  }
  return { root_module: rootNode };
}

const plan = {
  format_version: "1.2",
  terraform_version: "1.9.8",
  variables: {},
  planned_values: buildPlannedValues(),
  resource_drift: [],
  resource_changes: [...resources.values()].map(resourceChangeFor),
  output_changes: {},
  configuration: {
    provider_config: {
      aws: {
        name: "aws",
        full_name: "registry.terraform.io/hashicorp/aws",
        expressions: { region: { constant_value: REGION } },
      },
    },
    root_module: {},
  },
  relevant_attributes: [],
  checks: [],
  timestamp: FIXED_TIMESTAMP,
  applyable: true,
  complete: true,
  errored: false,
};

// ── graph.dot (terraform graph shape: dependent -> dependency) ──────────────

function buildGraphDot() {
  const lines = [
    "digraph G {",
    '  rankdir = "RL";',
    '  node [shape = rect, fontname = "sans-serif"];',
  ];
  const addrs = [...resources.keys()].sort();
  for (const addr of addrs) {
    lines.push(`  "${addr}" [label="${addr}"];`);
  }
  const edgeLines = [];
  for (const addr of addrs) {
    const r = resources.get(addr);
    for (const dep of r.deps) {
      edgeLines.push(`  "${addr}" -> "${dep}";`);
    }
  }
  edgeLines.sort();
  lines.push(...edgeLines, "}", "");
  return lines.join("\n");
}

// ── pipeline.tfd (tfd 2 binds + flows; cycles live here) ─────────────────────

function buildTfd() {
  const q = (addr) => `${STACK_ID}::${addr}`;
  const out = [];
  out.push("tfd 2");
  out.push(
    `# Declared dataflow for ${STACK_ID} (W12 P3 synthetic held-out mesh).`,
  );
  out.push(
    "# SELF-AUTHORED synthetic fixture generated by scripts/generate-heldout-plan.mjs",
  );
  out.push(
    `# (mulberry32 seed ${SEED}); out-of-tuning-distribution transfer probe, NOT an`,
  );
  out.push("# independently sampled held-out plan (R8-F4 stays open).");
  out.push("#");
  out.push(
    "# v2 (AMENDMENT-1): three account/region bands (000000000000/us-east-1,",
  );
  out.push(
    "# 000000000000/us-west-2 cells 13-14, 210987654321/us-east-1 cells 15-16 +",
  );
  out.push(
    "# observability sinks) with cross-band audit/alert fan-ins — slice-B edges.",
  );
  out.push(
    "# Topology: EventBridge hub (out-degree 16) -> 16 SNS/SQS/Lambda/SFN cells,",
  );
  out.push(
    "# cross-cell cascade chains, and THREE reference cycles on resolved endpoints:",
  );
  out.push(
    "#   C1 cell_01 handler <-> cell_02 handler   (mutual service calls, 2-cycle)",
  );
  out.push(
    "#   C2 cell_03 sfn -> retry -> handler -> sfn (redrive loop, 3-cycle)",
  );
  out.push(
    "#   C3 sg rule a_to_b <-> b_to_a              (mutual security-group rules, 2-cycle)",
  );
  out.push("");
  out.push("# Hub + network binds");
  out.push(`bind mesh_bus        = ${q(HUB_ADDRESS)}`);
  out.push(`bind registry_table  = ${q(registryTable)}`);
  out.push(`bind sg_rule_a_to_b  = ${q(sgRuleAB)}`);
  out.push(`bind sg_rule_b_to_a  = ${q(sgRuleBA)}`);
  out.push("# v2 (AMENDMENT-1): band-3 observability sinks");
  out.push(`bind audit_stream    = ${q(auditStream)}`);
  out.push(`bind ops_alerts      = ${q(opsAlerts)}`);
  out.push("");
  for (const c of cells) {
    out.push(`# cell_${c.id} binds`);
    out.push(`bind c${c.id}_ingress   = ${q(c.ingress)}`);
    out.push(`bind c${c.id}_work      = ${q(c.work)}`);
    out.push(`bind c${c.id}_dlq       = ${q(c.dlq)}`);
    out.push(`bind c${c.id}_dlq_alarm = ${q(c.dlqAlarm)}`);
    out.push(`bind c${c.id}_handler   = ${q(c.handler)}`);
    out.push(`bind c${c.id}_transform = ${q(c.transformer)}`);
    out.push(`bind c${c.id}_sfn       = ${q(c.sfn)}`);
    out.push(`bind c${c.id}_store     = ${q(c.store)}`);
    out.push(`bind c${c.id}_errors    = ${q(c.errorsAlarm)}`);
    if (c.retry) {
      out.push(`bind c${c.id}_retry     = ${q(c.retry)}`);
    }
    if (c.traceAlerts) {
      out.push(`bind c${c.id}_trace     = ${q(c.traceAlerts)}`);
    }
    out.push("");
  }

  out.push("# Hub fan-out: the high-fanout hub (out-degree 16 >= 12)");
  out.push(`mesh_bus -> ${cells.map((c) => `c${c.id}_ingress`).join(", ")}`);
  out.push("");
  out.push("# Per-cell processing chains");
  for (const c of cells) {
    out.push(`c${c.id}_ingress -> c${c.id}_work`);
    out.push(`c${c.id}_work -> c${c.id}_handler`);
    out.push(`c${c.id}_work -> c${c.id}_dlq`);
    out.push(`c${c.id}_dlq -> c${c.id}_dlq_alarm`);
    out.push(`c${c.id}_handler -> c${c.id}_transform`);
    out.push(`c${c.id}_transform -> c${c.id}_sfn`);
    out.push(`c${c.id}_sfn -> c${c.id}_store`);
    out.push(`c${c.id}_handler -> c${c.id}_errors`);
  }
  out.push("");
  out.push("# Service registry reads (deterministic subset of cells)");
  for (const c of cells) {
    if (rng() < 0.5) {
      out.push(`c${c.id}_handler -> registry_table`);
    }
  }
  out.push("");
  out.push("# Cross-cell cascade: long east-west chains through the mesh");
  out.push(
    "# (i -> i+4 lanes give 4 parallel deep chains; paths up to ~13 hops)",
  );
  for (let i = 1; i + 4 <= CELL_COUNT; i++) {
    const a = cells[i - 1];
    const b = cells[i + 3];
    out.push(`c${a.id}_sfn -> c${b.id}_ingress`);
  }
  out.push("");
  out.push(
    "# v2 (AMENDMENT-1) cross-band fan-ins into the observability account",
  );
  out.push("# (slice-B edge material — every band-1/band-2 cell crosses into");
  out.push("# band 3 here).");
  out.push("# Mesh-wide audit fan-in (sfn -> audit stream)");
  for (const c of cells) {
    out.push(`c${c.id}_sfn -> audit_stream`);
  }
  out.push("");
  out.push("# Mesh-wide ops alerting (dlq alarms -> ops alerts topic)");
  for (const c of cells) {
    out.push(`c${c.id}_dlq_alarm -> ops_alerts`);
  }
  out.push("");
  out.push("# Deep-cell tracing alert fan-in");
  for (const c of cells) {
    if (c.traceAlerts) {
      out.push(`c${c.id}_errors -> c${c.id}_trace`);
    }
  }
  out.push("");
  out.push("# C1 — mutual service calls (2-cycle on resolved endpoints)");
  out.push("c01_handler -> c02_handler");
  out.push("c02_handler -> c01_handler");
  out.push("");
  out.push(
    "# C2 — redrive loop in cell_03 (3-cycle: sfn -> retry -> handler -> sfn)",
  );
  out.push("c03_sfn -> c03_retry");
  out.push("c03_retry -> c03_handler");
  out.push("c03_handler -> c03_sfn");
  out.push("");
  out.push("# C3 — mutual security-group rules (2-cycle)");
  out.push("sg_rule_a_to_b -> sg_rule_b_to_a");
  out.push("sg_rule_b_to_a -> sg_rule_a_to_b");
  out.push("");
  return out.join("\n");
}

// ── emit ─────────────────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });
const planJson = `${JSON.stringify(plan, null, 1)}\n`;
fs.writeFileSync(path.join(OUT_DIR, "plan.json"), planJson);
fs.writeFileSync(path.join(OUT_DIR, "graph.dot"), buildGraphDot());
fs.writeFileSync(path.join(OUT_DIR, "pipeline.tfd"), buildTfd());

console.log(`staging-heldout-mesh written to ${OUT_DIR}`);
console.log(`  resource_changes: ${resources.size}`);
const depthOf = (addr) => (addr.match(/\bmodule\./g) ?? []).length;
const depths = {};
for (const addr of resources.keys()) {
  const d = depthOf(addr);
  depths[d] = (depths[d] ?? 0) + 1;
}
console.log(`  module-depth histogram: ${JSON.stringify(depths)}`);
console.log(`  hub: ${HUB_ADDRESS} (TFD out-degree ${CELL_COUNT})`);
const bandHistogram = {};
for (const r of resources.values()) {
  const key = `${r.band.account}/${r.band.region}`;
  bandHistogram[key] = (bandHistogram[key] ?? 0) + 1;
}
console.log(
  `  v2 bands (account/region histogram): ${JSON.stringify(bandHistogram)}`,
);
