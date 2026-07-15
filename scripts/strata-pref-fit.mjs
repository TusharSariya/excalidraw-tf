#!/usr/bin/env node
/**
 * STRATA PREFERENCE FIT — estimate the crossings ↔ penetration ↔ length
 * exchange rate from blinded pairwise labels (P1 of the 2026-07-15 objective
 * audit; companion to packages/excalidraw/components/terraformStrataPrefPairs.test.ts).
 *
 * Model: Bradley-Terry / logistic over per-pair score deltas.
 *   P(rater prefers slot A) = sigma( beta . (s_B - s_A) )
 * where s = (crossings, pierce, tll/1000) — RENDERED metrics by default
 * (the audit proved chord scores can invert the crossings sign; use --chord
 * to fit on the optimizer's own chord scores instead). Lower s is better, so
 * positive beta_k means metric k hurts readability.
 *
 * Exchange rates are coefficient ratios, e.g.
 *   crossings per 1000px of total edge length = beta_tllK / beta_cr
 * CIs via nonparametric bootstrap over pairs. Inter-rater agreement via
 * percent agreement + Cohen's kappa over {A,B,tie}.
 *
 * Usage:
 *   node scripts/strata-pref-fit.mjs --dir docs/strata-baselines/prefpairs \
 *     [--chord] [--boot 2000] [--out report.md]
 *
 * Labels: --dir/labels/*.json, one file per rater, produced by the viewer
 * (index.html) or hand-written:
 *   { "rater": "owner", "labels": [ { "pairId": "P01", "choice": "A"|"B"|"tie",
 *     "confidence": 1|2|3, "notes": "" } ] }
 *
 * HELD-OUT INVARIANT: this script's fitted exchange rate is the ONLY
 * decision-facing output of the instrument. Raw labels/keys must never be
 * optimized against directly (see docs/strata-baselines/prefpairs/README.md).
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getFlag = (name) => args.includes(name);
const getOpt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const DIR = path.resolve(getOpt("--dir", "docs/strata-baselines/prefpairs"));
const USE_CHORD = getFlag("--chord");
const BOOT = Number(getOpt("--boot", "2000"));
const OUT = getOpt("--out", null);
const SEED = Number(getOpt("--seed", "20260715"));

// ── load key + labels ────────────────────────────────────────────────────────
const keyPath = path.join(DIR, "PREF_PAIRS_KEY.json");
if (!existsSync(keyPath)) {
  console.error(`no key at ${keyPath} — run the generator first`);
  process.exit(1);
}
const key = JSON.parse(readFileSync(keyPath, "utf8"));
const entries = new Map(key.entries.map((e) => [e.pairId, e]));

const labelsDir = path.join(DIR, "labels");
const raters = [];
if (existsSync(labelsDir)) {
  for (const f of readdirSync(labelsDir).sort()) {
    if (!f.endsWith(".json")) {
      continue;
    }
    const j = JSON.parse(readFileSync(path.join(labelsDir, f), "utf8"));
    if (!j.rater || !Array.isArray(j.labels)) {
      console.error(`skipping malformed label file ${f}`);
      continue;
    }
    raters.push(j);
  }
}
if (raters.length === 0) {
  console.error(
    `No label files in ${labelsDir}.\n` +
      `Labels are pending (owner + >=2 raters). Open ${path.join(
        DIR,
        "index.html",
      )} in a browser, label every pair, download the JSON, drop it in labels/.`,
  );
  process.exit(2);
}

// ── feature extraction (deltas are stored as B − A in the key) ──────────────
const featNames = USE_CHORD
  ? ["chordCrossings", "chordPenetrations", "chordLengthL1K"]
  : ["renderedCrossings", "renderedPierce", "renderedTllK"];
const featOf = (e) => {
  const d = e.deltas;
  if (USE_CHORD) {
    return [d.chordCrossings, d.chordPenetrations, d.chordLengthL1 / 1000];
  }
  if (d.renderedCrossings === undefined) {
    return null;
  }
  return [d.renderedCrossings, d.renderedPierce, d.renderedTll / 1000];
};

// observations: y=1 iff rater chose A. x = s_B − s_A (the key's delta).
// ties contribute half an observation in each direction (weight 0.5).
const obs = []; // { pairId, rater, x: number[], y: 0|1, w }
let tieCount = 0;
let skipped = 0;
for (const r of raters) {
  for (const l of r.labels) {
    const e = entries.get(l.pairId);
    if (!e || !l.choice) {
      skipped++;
      continue;
    }
    const x = featOf(e);
    if (!x) {
      skipped++;
      continue;
    }
    if (l.choice === "tie") {
      tieCount++;
      obs.push({ pairId: l.pairId, rater: r.rater, x, y: 1, w: 0.5 });
      obs.push({ pairId: l.pairId, rater: r.rater, x, y: 0, w: 0.5 });
    } else if (l.choice === "A" || l.choice === "B") {
      obs.push({
        pairId: l.pairId,
        rater: r.rater,
        x,
        y: l.choice === "A" ? 1 : 0,
        w: 1,
      });
    } else {
      skipped++;
    }
  }
}
if (obs.length < 4) {
  console.error(`only ${obs.length} usable observations — need more labels`);
  process.exit(2);
}

// ── weighted logistic regression (Newton-Raphson, tiny ridge, no intercept:
//    a pair with zero deltas should be a coin flip) ─────────────────────────
const sigma = (z) => 1 / (1 + Math.exp(-z));
const fit = (rows) => {
  const k = featNames.length;
  let beta = new Array(k).fill(0);
  const ridge = 1e-4;
  for (let iter = 0; iter < 100; iter++) {
    const grad = new Array(k).fill(0);
    const hess = Array.from({ length: k }, () => new Array(k).fill(0));
    for (const o of rows) {
      const z = o.x.reduce((s, v, j) => s + v * beta[j], 0);
      const p = sigma(z);
      const g = o.w * (o.y - p);
      const hw = o.w * p * (1 - p);
      for (let j = 0; j < k; j++) {
        grad[j] += g * o.x[j];
        for (let m = 0; m < k; m++) {
          hess[j][m] += hw * o.x[j] * o.x[m];
        }
      }
    }
    for (let j = 0; j < k; j++) {
      grad[j] -= ridge * beta[j];
      hess[j][j] += ridge;
    }
    // solve hess * step = grad (gaussian elimination)
    const A = hess.map((row, i) => [...row, grad[i]]);
    for (let c = 0; c < k; c++) {
      let piv = c;
      for (let rI = c + 1; rI < k; rI++) {
        if (Math.abs(A[rI][c]) > Math.abs(A[piv][c])) {
          piv = rI;
        }
      }
      [A[c], A[piv]] = [A[piv], A[c]];
      if (Math.abs(A[c][c]) < 1e-12) {
        return { beta, converged: false };
      }
      for (let rI = 0; rI < k; rI++) {
        if (rI === c) {
          continue;
        }
        const f = A[rI][c] / A[c][c];
        for (let cc = c; cc <= k; cc++) {
          A[rI][cc] -= f * A[c][cc];
        }
      }
    }
    const step = A.map((row, i) => row[k] / row[i]);
    let maxStep = 0;
    for (let j = 0; j < k; j++) {
      beta[j] += step[j];
      maxStep = Math.max(maxStep, Math.abs(step[j]));
    }
    if (maxStep < 1e-9) {
      return { beta, converged: true };
    }
  }
  return { beta, converged: true };
};

const full = fit(obs);

// ── bootstrap over PAIRS (cluster bootstrap: all observations of a sampled
//    pair move together — labels of the same pair are correlated) ───────────
const mulberry32 = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rng = mulberry32(SEED);
const pairIds = [...new Set(obs.map((o) => o.pairId))];
const byPair = new Map(pairIds.map((p) => [p, obs.filter((o) => o.pairId === p)]));
const bootBetas = [];
for (let b = 0; b < BOOT; b++) {
  const rows = [];
  for (let i = 0; i < pairIds.length; i++) {
    const p = pairIds[Math.floor(rng() * pairIds.length)];
    rows.push(...byPair.get(p));
  }
  const f = fit(rows);
  if (f.converged) {
    bootBetas.push(f.beta);
  }
}
const pct = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) {
    return NaN;
  }
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
};
const ciOf = (fn) => {
  const vals = bootBetas.map(fn).filter((v) => Number.isFinite(v));
  return { lo: pct(vals, 0.025), hi: pct(vals, 0.975), n: vals.length };
};

// ── inter-rater agreement (percent + Cohen's kappa over {A,B,tie}) ──────────
const choiceOf = (rater, pairId) => {
  const l = rater.labels.find((x) => x.pairId === pairId);
  return l && l.choice ? l.choice : null;
};
const agreements = [];
for (let i = 0; i < raters.length; i++) {
  for (let j = i + 1; j < raters.length; j++) {
    const common = [...entries.keys()].filter(
      (p) => choiceOf(raters[i], p) && choiceOf(raters[j], p),
    );
    if (!common.length) {
      continue;
    }
    const cats = ["A", "B", "tie"];
    let agree = 0;
    const mi = Object.fromEntries(cats.map((c) => [c, 0]));
    const mj = Object.fromEntries(cats.map((c) => [c, 0]));
    for (const p of common) {
      const a = choiceOf(raters[i], p);
      const b = choiceOf(raters[j], p);
      if (a === b) {
        agree++;
      }
      mi[a] = (mi[a] ?? 0) + 1;
      mj[b] = (mj[b] ?? 0) + 1;
    }
    const po = agree / common.length;
    let pe = 0;
    for (const c of cats) {
      pe += ((mi[c] ?? 0) / common.length) * ((mj[c] ?? 0) / common.length);
    }
    const kappa = pe < 1 ? (po - pe) / (1 - pe) : NaN;
    agreements.push({
      a: raters[i].rater,
      b: raters[j].rater,
      n: common.length,
      percent: po,
      kappa,
    });
  }
}

// ── attention checks ─────────────────────────────────────────────────────────
const attention = [];
for (const e of key.entries) {
  if (!e.expectedDominatedSlot) {
    continue;
  }
  for (const r of raters) {
    const c = choiceOf(r, e.pairId);
    if (!c) {
      continue;
    }
    // expectedDominatedSlot marks the WORSE side; preferred should be the other
    const expected = e.expectedDominatedSlot === "A" ? "B" : "A";
    attention.push({
      pairId: e.pairId,
      rater: r.rater,
      expected,
      got: c,
      pass: c === expected,
    });
  }
}

// ── report ───────────────────────────────────────────────────────────────────
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : "n/a");
const lines = [];
lines.push(`# Strata preference fit — ${new Date().toISOString().slice(0, 10)}`);
lines.push("");
lines.push(
  `- feature set: ${USE_CHORD ? "CHORD (optimizer's own scores)" : "RENDERED (default; chord can invert crossings sign)"} — [${featNames.join(", ")}]`,
);
lines.push(
  `- raters: ${raters.map((r) => `${r.rater} (${r.labels.filter((l) => l.choice).length} labels)`).join(", ")}`,
);
lines.push(
  `- observations: ${obs.length} (ties ${tieCount}, skipped ${skipped}); pairs with labels: ${pairIds.length}/${key.entries.length}`,
);
if (raters.length < 3) {
  lines.push(
    `- **WARNING:** only ${raters.length} rater(s) — the design asks for owner + >=2 independent raters before treating the exchange rate as calibrated.`,
  );
}
lines.push("");
lines.push("## Coefficients (positive = hurts readability)");
lines.push("");
lines.push("| feature | beta | 95% CI (pair bootstrap) |");
lines.push("| ------- | ---- | ----------------------- |");
featNames.forEach((nm, j) => {
  const ci = ciOf((b) => b[j]);
  lines.push(`| ${nm} | ${f3(full.beta[j])} | [${f3(ci.lo)}, ${f3(ci.hi)}] |`);
});
lines.push("");
lines.push("## Exchange rates");
lines.push("");
const exch = [
  {
    name: "crossings equivalent to 1000px total edge length",
    fn: (b) => b[2] / b[0],
  },
  {
    name: "crossings equivalent to 1 penetration/pierce",
    fn: (b) => b[1] / b[0],
  },
  {
    name: "penetrations equivalent to 1000px total edge length",
    fn: (b) => b[2] / b[1],
  },
];
lines.push("| rate | point | 95% CI |");
lines.push("| ---- | ----- | ------ |");
for (const e of exch) {
  const ci = ciOf(e.fn);
  lines.push(`| ${e.name} | ${f3(e.fn(full.beta))} | [${f3(ci.lo)}, ${f3(ci.hi)}] |`);
}
lines.push("");
lines.push(
  "Interpretation: the engine's lexicographic objective implies an INFINITE " +
    "crossings-first exchange rate; a finite fitted rate with a CI excluding " +
    "'very large' is evidence for finite pricing (Ware 2002 / Klammler et al.).",
);
lines.push("");
lines.push("## Inter-rater agreement");
lines.push("");
if (agreements.length === 0) {
  lines.push("(single rater — no agreement computable)");
} else {
  lines.push("| raters | n | % agree | Cohen's kappa |");
  lines.push("| ------ | - | ------- | ------------- |");
  for (const a of agreements) {
    lines.push(
      `| ${a.a} vs ${a.b} | ${a.n} | ${f3(a.percent)} | ${f3(a.kappa)} |`,
    );
  }
}
lines.push("");
lines.push("## Attention checks (expected-dominated pairs)");
lines.push("");
if (!attention.length) {
  lines.push("(none labeled)");
} else {
  lines.push("| pair | rater | expected | got | pass |");
  lines.push("| ---- | ----- | -------- | --- | ---- |");
  for (const a of attention) {
    lines.push(
      `| ${a.pairId} | ${a.rater} | ${a.expected} | ${a.got} | ${a.pass ? "yes" : "NO"} |`,
    );
  }
  const fails = attention.filter((a) => !a.pass).length;
  if (fails) {
    lines.push("");
    lines.push(
      `**${fails} attention-check failure(s)** — either the rater rushed, or the 'obviously dominated' assumption is itself wrong (which would be a finding).`,
    );
  }
}
lines.push("");
lines.push("## Per-pair label summary");
lines.push("");
lines.push("| pair | cfg | deltas (B−A) | labels |");
lines.push("| ---- | --- | ------------- | ------ |");
for (const e of key.entries) {
  const ls = raters
    .map((r) => {
      const c = choiceOf(r, e.pairId);
      return c ? `${r.rater}:${c}` : null;
    })
    .filter(Boolean)
    .join(" ");
  const d = e.deltas;
  const dd =
    d.renderedCrossings !== undefined
      ? `cr ${d.renderedCrossings}, pierce ${d.renderedPierce}, tll ${d.renderedTll}`
      : `chord cr ${d.chordCrossings}, pen ${d.chordPenetrations}, L1 ${d.chordLengthL1}`;
  lines.push(`| ${e.pairId} | ${e.cfg} | ${dd} | ${ls || "(unlabeled)"} |`);
}
lines.push("");

const report = lines.join("\n");
if (OUT) {
  writeFileSync(path.resolve(OUT), report);
  console.log(`report written to ${OUT}`);
} else {
  console.log(report);
}
