# Toolchain & Hosting Migration Report — `excalidraw-tf` (June 2026)

**Three questions, researched separately:** **A.** Node → **Bun** · **B1.** Cloudflare Pages → **Vercel** · **B2.** Cloudflare Pages → **Railway** Plus a fourth option this report adds: **B0.5 — decouple the data layer, keep the Cloudflare edge** (portability as insurance).

> **Revision note (2026-06-25):** this doc was hardened in a CEO-mode review. Two original arguments were weak — the "you can't leave CF, they own Vite" hook (it conflated open-source tool stewardship with proprietary platform lock-in) and a cost pillar that was never modeled for this app. Both are now fixed. A reversibility axis (§2.5), a real cost model (§4.4), a portability hedge (§4.0.5), and a do-nothing baseline + revisit triggers (§8) were added. The headline conclusion shifted: the safest move is **decouple now, migrate never (until a trigger fires)** rather than "consolidate onto Cloudflare."

---

## 0. Executive summary

| Option | Difficulty | Verdict |
| --- | --- | --- |
| **A — Node → Bun** | **Low–Medium** (~1–2 days) | **Do it, Tier 1 only** (package manager + script runner). Keep Node runtime, Vite bundler, Vitest tests. Fully reversible. |
| **B0 — Stay → Cloudflare Workers** | **Low** (~2–4 days) | The cheapest hosting move; keeps D1/KV/functions. But there is **no forcing function yet** — do it when a trigger fires (§8), not reflexively. |
| **B0.5 — Decouple data, keep CF edge** | **Medium** (~3–5 days) | **The recommended de-risking move.** Move D1→Turso/libSQL + abstract KV, stay on CF for static+edge. Buys vendor-portability without a full migration. Directly serves the "vendor risk" motivation. |
| **B1 — → Vercel** | **Medium–High** (~1–2 weeks) | Only if you decide to actually _leave_ Cloudflare. Requires B0.5's data work **plus** moving the edge. Higher bill at scale (§4.4). |
| **B2 — → Railway** | **High** (~2–3 weeks) + ongoing ops | **Not recommended** for this app. Railway is single-region/backend-first, not an edge CDN. Right only if you _add_ a stateful server backend. |

**The corrected reframe:** in the last six months Cloudflare **acquired the Vite team**, Anthropic **acquired Bun**, and Cloudflare **folded Pages into Workers**. The original draft read this as "leaving CF while keeping Vite is self-contradictory." That is wrong, and it matters: depending on **CF-stewarded open-source Vite** (MIT, vendor-agnostic governance, $1M community fund, your source untouched if you ever swap it) is a categorically _lighter_ dependency than depending on **CF's proprietary platform** (Workers runtime contract, D1, KV). One is a two-minute bundler swap; the other holds your data. So Vite ownership is **not** a reason to stay on Cloudflare for hosting.

**The honest recommendation:** Adopt **Bun Tier-1** now (cheap, reversible, real CI win). Then **do nothing on hosting until a trigger fires (§8)** — Pages isn't sunset and you have no pain signal today. **B0.5 (decouple the data layer)** is the de-risk to run _when_ vendor-risk starts to feel real or just before any migration, and only **after a latency gate** confirms remote Turso doesn't regress the read path from Workers (see §4.0.5 — embedded replicas don't run in the Workers isolate). Treat the full **Workers (B0)** or **Vercel (B1)** migration as a _triggered_ decision (§8). **Skip Railway** unless your roadmap grows a real server.

---

## 1. Context — why this question, and why now

You're on Node 22 + Yarn 1 (Classic) workspaces + Vite 5/esbuild, shipping `excalidraw-app` (the `tfdraw-io` Cloudflare project) to Cloudflare Pages. Your stated motivations span all four axes: **speed/DX, cost, vendor/roadmap risk, and features/SSR/edge**. That breadth matters because the right answer differs sharply by motivation.

**A dependency is not a dependency.** Before weighing anything, separate the two kinds of Cloudflare dependency you have, because they carry very different lock-in:

| Dependency | Type | Lock-in | Exit cost |
| --- | --- | --- | --- |
| **Vite / Vitest / Rolldown** | OSS, CF-stewarded | Governance only | Hours (swap bundler; source untouched) |
| **Workers runtime** | Proprietary platform | API/runtime contract | Days (rewrite function entrypoints) |
| **D1 (presets, analytics)** | Proprietary, but SQLite | Data + dialect | Days (dump/restore to libSQL/Turso) |
| **KV (STATS, LAYOUT_CACHE)** | Proprietary | API + semantics | Hours behind an interface |

The 2026 vendor shifts:

- **Cloudflare acquired VoidZero** (Vite, Vitest, Rolldown, Oxc, Vite+), announced **June 4 2026**, Evan You's team joining CF's Emerging Technology org. Tools stay open-source/vendor-agnostic with a **$1M maintainer commitment**. Net effect on you: your bundler is **maintained by a well-capitalized owner and stays portable**. This is a tailwind for _keeping Vite_, and neutral on _where you host_. ([Cloudflare blog](https://blog.cloudflare.com/voidzero-joins-cloudflare/), [press release](https://www.cloudflare.com/press/press-releases/2026/cloudflare-acquires-voidzero-to-build-the-future-of-the-ai-native-web/))
- **Anthropic acquired Bun** (Dec 2025). Production-grade (1.3.x), MIT, well-funded, **Zig→Rust rewrite merged** May 2026. Low abandonment risk. ([The Register](https://www.theregister.com/devops/2026/05/14/anthropics-bun-rust-rewrite-merged-at-speed-of-ai/5240381))
- **Cloudflare Pages is being absorbed into Workers, not deprecated.** Per Kenton Varda, "We are taking all the Pages-specific features and turning them into general Workers features." New features (Secrets Store, Workflows, Containers) are **Workers-only**; Pages gets maintenance. **No sunset date.** Forced build-image bumps only: **Pages v1→v3 auto-migrate Sep 15 2026; v2→v3 Feb 23 2027.** ([migrate-from-pages](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/), [Pages vs Workers 2026](https://dev.to/rickcogley/cloudflare-pages-vs-workers-in-2026-migration-guide-ka7))

---

## 2. Current-state inventory (grounds every effort estimate)

`excalidraw-tf` is **not** a pure static SPA. It is a static SPA **plus a real Cloudflare-specific stateful backend.** This is the single biggest driver of hosting-migration cost.

**Toolchain**

- **Package manager:** Yarn **1.22.22 (Classic)** — `packageManager` field; `yarn.lock`; `.npmrc` sets `registry=registry.yarnpkg.com`, `save-exact=true`, `legacy-peer-deps=true`.
- **Node:** `.nvmrc` = 22; `engines: node >=22`; CI `node-version: 22.x`; `Dockerfile` builds on Node 24.
- **Workspaces:** `["excalidraw-app", "packages/*"]`; cross-package refs via **TS path aliases** (mirrored in Vite + Vitest configs).
- **Build:** **Vite 5.0.12** for the app (`excalidraw-app/vite.config.mts`) with a heavy plugin chain — react, svgr, ejs, pwa, checker, html, sitemap, a custom woff2 plugin, and `terraformImportPresetDevPlugin` (TS layout engine via Vite **`ssrLoadModule`**, dev only). **esbuild** builds the publishable packages.
- **Tests:** **Vitest 3.0.6** + jsdom + `vitest-canvas-mock`, forked-worker pool, `fake-indexeddb`, SQLite fixtures.

**Cloudflare backend** (from `wrangler.jsonc`, project `tfdraw-io`)

- **D1, 2 databases:** `PRESETS_DB` → `tfdraw-presets` (preview: `-preview`); `DB` → `tfdraw-analytics`.
- **KV namespaces:** `STATS`, `LAYOUT_CACHE`.
- **Pages Functions** (`/functions/`, typed `PagesFunction`): roughly **4 HTTP route endpoints** — `api/subscribe.ts` (Turnstile), `api/event.ts`, `api/terraform-import-layout-cache.ts`, `api/terraform-import-presets/*` — plus shared helper modules (`_terraformPresets.ts`, `_terraformLayoutCache.ts`) imported by routes. _Confirm the exact route count before scoping the rewrite_ (leading-underscore files are not routes).
- **Config/deploy:** `wrangler.jsonc` (Pages format — no `assets` block), `public/_headers`, `.github/workflows/pages-deploy.yml` (`wrangler pages deploy ./excalidraw-app/build`), curl smoke tests + post-deploy KV warm-up.
- **Also present:** a working **`Dockerfile`** (Node 24 → nginx) and a **legacy `vercel.json`**.

**Native deps that matter for Bun:** `better-sqlite3@11.8.1` (native addon), `sharp@0.34.2` (libvips), `rewire@6.0.0` (legacy `scripts/build-node.js`).

---

## 2.5 Reversibility map (the decision axis that should drive sequencing)

Rank these by **regret-on-reversal** (Bezos one-way / two-way doors), not just effort. Cheap reversible moves should happen first and without much debate; sticky moves get the scrutiny.

```
                 TWO-WAY (reversible)  <------------------------->  ONE-WAY (sticky)

  Bun Tier-1 ......*                                                  data migration
  (hours, revert lockfile)                                           D1 -> Turso/libSQL ......*
                                                                     (new vendor contract,
  Pages -> Workers ........*                                          dump/restore, re-point)
  (same vendor, data stays,
   wrangler stays)
                                  KV -> interface ....*
                                  (abstract behind a port;
                                   swap impl later, cheap)
```

**Implication:** Do Bun Tier-1 freely. Treat the **data migration as the one expensive decision** in this whole report — it is the only near-one-way door, and it is the gate to _any_ off-CF future. Which is exactly why **B0.5 (do the data decoupling on its own, deliberately, while staying on CF) is the highest-leverage move**: it converts the sticky decision into a controlled, standalone project instead of bundling it under a rushed hosting migration.

---

## 3. Question A — Node → Bun

**Verdict: adopt Tier 1 only. Effort Low–Medium (~1–2 days). Two-way door. Do it first, independent of hosting.**

### 3.1 The tier model — and exactly where to stop

| Tier | Scope | Payoff | Risk | Call |
| --- | --- | --- | --- | --- |
| **1 — pkg manager + scripts** | `bun install` replaces Yarn; `bun run` executes scripts | **High** — installs/CI markedly faster; warm installs ~7× faster in 1.3.x | **Low** | **Adopt** |
| **2 — test runner** | `bun test` replaces Vitest | Modest | **High** — Vitest is fused to jsdom, the canvas mock, your Vite plugins, and TS path aliases; `bun test` is not API-compatible | **Skip** |
| **3 — runtime + bundler** | `bun build` replaces Vite/esbuild; Bun as runtime | Speed | **Very high** — can't reproduce your Vite plugin chain; `rewire`/native addons break under Bun's runtime | **Skip** |

The key insight: **Vitest and Vite both run fine with Node as the runtime under them.** Tier 1 changes who installs packages and launches scripts; it does **not** require Bun to execute your bundler or tests. That keeps risk low and the native-module problem out of scope.

### 3.2 Compatibility (2026 status)

- **Workspaces:** `bun install` supports Yarn-style workspaces natively + **version catalogs**; fastest monorepo installer. Task orchestration (Turborepo/Nx) optional. ([Bun install](https://bun.com/docs/pm/cli/install))
- **`better-sqlite3`:** native addon — Bun won't load the `.node` binding under its _runtime_. Irrelevant at Tier 1 (Node still runs tests; `bun install` only needs the build step). Tier-3 replacement would be `bun:sqlite` (3–6× faster, but an API rewrite). ([Bun SQLite](https://bun.com/docs/runtime/sqlite))
- **`sharp`:** works on Bun in 2026 via libvips/WASM fallback. Dev-only, low concern.
- **`rewire` / `build-node.js`:** the canary if you ever go Tier 3. Safe at Tier 1.

### 3.3 Migration mechanics (Tier 1)

1. `rm yarn.lock && bun install` → `bun.lock`. (Higher-fidelity carry-over: `synp → npm lockfile v3 → bun pm migrate`.) ([yarn→bun](https://notes.joschua.io/50-Slipbox/Migrate-from-yarn-to-bun))
2. Set `packageManager: "bun@<version>"`; keep script names so docs/muscle-memory hold.
3. Map `.npmrc` (`save-exact`, `legacy-peer-deps`) → `bunfig.toml`.
4. CI: `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile`; cache `~/.bun/install/cache`. Keep Node for Vite/Vitest. ([setup-bun](https://render.com/blog/hello-bun-deploy-2x-faster-on-github-render))
5. Verify `better-sqlite3`/`sharp` build; `bun run build:app` is **functionally equivalent** (passes existing smoke + visual checks — do _not_ expect byte-identical output; Vite/esbuild hashes and ordering shift across lockfile changes); `vitest run` green.
6. **Changesets caveat:** doesn't natively resolve Bun workspaces/catalogs — keep release tooling on Node. ([Changesets+Bun](https://ianm.com/posts/2025-08-18-setting-up-changesets-with-bun-workspaces))
7. **Lockfile carry-over is best-effort** — `bun pm migrate` from `yarn.lock` is partial; diff resolved versions of a few key deps after install to confirm nothing drifted.

**Effort: ~1–2 days, fully reversible.** Do it regardless of the hosting outcome.

---

## 4. Question B — Hosting

Because your app carries **D1 + KV + 5 edge functions**, "migrate hosting" really means "re-platform a stateful edge backend." The static SPA is the easy 20%; the data layer is the 80%, and it is the only near-one-way door (§2.5).

### 4.0 Option B0 — Stay on Cloudflare: Pages → Workers

**Why it's cheap:** Workers' static-assets + Worker model keeps **D1, KV, and your functions essentially in place**, you already own `wrangler`, and it's where every new CF feature lands. Official migration exists. ([migrate-from-pages](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/))

**What changes (small, mechanical):**

- **Functions:** Pages `onRequest*` handlers consolidate into a Worker **`fetch` handler** (or router). Each `api/*` route becomes a path branch; bindings move from implicit injection to `env`. ([refactor worker↔pages](https://developers.cloudflare.com/pages/how-to/refactor-a-worker-to-pages-functions/))
- **Routing:** Pages served Functions ahead of assets via `_routes.json`/middleware. Workers serve **assets first** unless you set **`assets.run_worker_first`**, which takes an **array of route patterns** (not a bare boolean) — scope it to `/api/*` so the Worker runs first only for your auth (Turnstile) / logging routes, _not_ for static-asset requests (running the Worker on every asset would defeat the cost/perf model). ([static-assets binding](https://developers.cloudflare.com/workers/static-assets/binding/))
- **`ASSETS` binding:** declare explicitly in `wrangler.jsonc` (which now _does_ take an `assets` block).
- **Bindings:** D1 + KV carry over unchanged; **no data migration**. Secrets via `wrangler secret` + `.dev.vars`.
- **CI:** `wrangler pages deploy` → `wrangler deploy`.

**Effort: Low (~2–4 days). Mostly a two-way door.** But note: this does **not** reduce vendor concentration — it deepens it. And there is **no forcing function today** (§8). Do it when a trigger fires, or fold it into B0.5 if you decide CF Workers is your long-term edge.

### 4.0.5 Option B0.5 — Decouple the data layer, keep the Cloudflare edge (recommended de-risk)

This is the option the original draft missed. It is neither "stay all-CF" nor "leave CF" — it is **"make leaving cheap, then decide later."**

**The move:** keep static + CDN + functions on Cloudflare (what CF is genuinely best and cheapest at — see §4.4), but lift the **stateful backend** off Cloudflare-proprietary storage:

- **D1 → Turso / libSQL.** Data is portable SQLite (dump/restore both ways — see exit note below). From a Cloudflare Worker you talk to Turso over **remote/HTTP libSQL**. _Important correction:_ Turso's **embedded replicas** (a local synced SQLite file, sub-ms reads) need a **persistent runtime/filesystem** and do **not** work in the Workers isolate model (no durable local FS across requests). So on Workers you get a remote round-trip, which can be **higher latency than D1 in the same datacenter**. This is the central risk of B0.5 — see "latency gate" below. ([Turso on Workers](https://developers.cloudflare.com/workers/databases/third-party-integrations/turso/))
- **KV → a thin `CacheStore` interface** with a CF-KV implementation today. The interface must **pin TTL and consistency semantics** (CF KV is eventually-consistent with its own TTL behavior); a later swap to Upstash/Redis changes those, so make them explicit contract, not incidental. Verification (§10) asserts them.

**Why this is the highest-leverage de-risk (when you choose to do it):**

- It directly answers "vendor/roadmap risk": no single vendor holds hosting **and** data anymore.
- It converts the one sticky decision (§2.5) into a **standalone, well-scoped project** done calmly, instead of bundled into a rushed Vercel/Workers move under time pressure.
- If you later choose B0 (Workers) or B1 (Vercel), the expensive 80% is **already done** — the remaining hosting move is the easy 20%.

**Turso is also a vendor.** Smaller and less-capitalized than Cloudflare, so weigh its own roadmap/abandonment risk. Two mitigations: (1) data stays portable SQLite, so the **exit is symmetric** — `turso db dump` → restore back into D1 reverses B0.5; (2) if you later run a persistent runtime, an embedded replica means a Turso outage degrades to local reads rather than hard-failing.

**Latency gate (do this BEFORE the port, not after):** stand up a throwaway Turso DB and measure the presets + `LAYOUT_CACHE` read path from a Worker against current D1. If remote libSQL regresses the canvas/presets UX past budget, **do not do B0.5 while on Workers** — keep D1, and only migrate the data as part of an actual B1 (Vercel) departure where the function runtime can hold an embedded replica.

**Cutover:** the live `analytics` write path can't tolerate a naive dump/restore (writes during the copy are lost). Use a **dual-write window** (write to D1 and Turso, read from D1) until Turso is caught up, then flip reads. The read-only `presets` DB can do a simple dump/restore.

**Cost:** Turso has a usable free tier; paid ~$5–29/mo at your likely scale (§4.4). **Effort: Medium (~3–5 days)** assuming the latency gate passes — the D1→Turso port + dual-write cutover + re-pointing two functions.

### 4.1 Option B1 — → Vercel (full departure)

**Difficulty: Medium–High (~1–2 weeks cold; ~2–4 days if B0.5 already ran).** This is **B0.5's data work plus moving the edge** — so if the data is already on Turso, only the SPA config + function rewrite remain. Bonus: Vercel/Node can hold a Turso **embedded replica** (unlike the Workers isolate), so the latency tradeoff that gates B0.5-on-Workers largely disappears here. Only pick it if you've decided to actually leave Cloudflare.

- **Static + routing — easy.** Vite SPAs are first-class; your legacy `vercel.json` already targets `excalidraw-app/build`. Need an SPA rewrite + an explicit `/api/(.*)` passthrough. ([Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite))
- **Functions — mechanical rewrite (~5 endpoints)** to `@vercel/node` (or Edge runtime) signatures; re-point bindings. ([Vercel non-Next](https://randombits.dev/articles/vercel-tips))
- **Data:** same as B0.5 — D1→Turso, KV→**Vercel KV (Upstash)** or **Edge Config**.
- **Cost:** materially pricier at scale, dominated by **egress** (§4.4).
- **Honest correction to the original draft:** a static Vite SPA + 5 functions runs **perfectly well** on Vercel. You are not "broken" or truly second-class — you simply don't benefit from Vercel's Next.js-specific premium features (Vinext, AI-native Next), so you pay a higher price for parity, not for an edge. ([Vinext](https://www.sitepoint.com/bridging-vite-and-next-js-the-vinext-revolution/))

**When B1 is right:** you've decided vendor-escape from Cloudflare is worth a recurring premium, and you want a single integrated dashboard/DX. Otherwise B0.5 gives you most of the risk reduction at a fraction of the cost.

### 4.2 Option B2 — → Railway

**Difficulty: High (~2–3 weeks) + ongoing ops. Not recommended for this workload.**

Railway is **backend/stateful-first and single-region**, not an edge CDN. For a globally-consumed static SPA this is a **TTFB/distribution downgrade**. ([Railway serverless 2026](https://blog.railway.com/p/best-serverless-platforms-2026), [Railway vs CF vs Vercel](https://northflank.com/blog/railway-vs-cloudflare-vs-vercel))

- **Static:** reuse the `Dockerfile` (nginx), single-region origin; you'd want a CDN in front.
- **Functions → long-running server** (Node/Hono/Express): bigger rewrite than Vercel (different execution model, not just signatures).
- **Data:** D1 → Railway Postgres (dialect port), KV → Railway Redis.

**When B2 is right:** only if your roadmap **adds a genuine stateful backend** (websockets, jobs, long-running compute). The 2026 pattern is **frontend on CF/Vercel + backend on Railway**, never "whole static SPA on Railway."

### 4.3 Side-by-side

| Dimension | B0 Workers | B0.5 Decouple+CF | B1 Vercel | B2 Railway |
| --- | --- | --- | --- | --- |
| Static SPA | trivial | unchanged (CF) | trivial | Dockerfile (1-region) |
| Your D1 | keep as-is | **→ Turso (portable)** | → Turso | → Postgres |
| Your KV | keep as-is | **→ interface (CF impl)** | → Vercel KV | → Redis |
| 5 functions | small: `onRequest`→`fetch` | unchanged + re-point data | rewrite → Vercel | rewrite edge→server |
| Global edge | yes | yes | yes | no (single-region) |
| Reduces vendor concentration | no (deepens it) | **yes** | swaps vendor (no net reduction) | swaps vendor (no net reduction) |
| Preview/branch envs | per-PR (rebuild) | per-PR (CF) | per-PR (native, strong) | manual/extra service + preview DB |
| Relative cost | lowest | low + Turso | highest (egress) | mid + ops + CDN |
| Reversibility | two-way | two-way | one-way-ish | one-way-ish |
| Effort | Low (2–4d) | **Medium (3–5d)** | Med–High (1–2wk) | High (2–3wk) |

### 4.4 Cost model — sized to `tfdraw-io` (replace assumptions with your real numbers)

The original draft quoted a generic "$5–15 vs $20–50 SaaS" range. That is not your app. Here is a model with **explicit assumptions** so you can plug in reality.

**Assumptions (edit these):**

- Avg delivered page weight on a cold load ≈ **2.5 MB** (canvas app bundle; conservative, pre cache-hit). Warm loads ≈ near-zero egress.
- ~**40%** of loads are cold (cache-miss / new visitor) → effective egress ≈ `loads × 2.5MB × 0.4`.
- ~**8 function invocations** per session (presets, layout-cache, event, occasional subscribe).
- D1: a few preset reads + a handful of analytics writes per session.

**Published rates:** Cloudflare Workers Paid = **$5/mo, 10M requests included, $0.30/M after, zero egress**; D1 ≈ $0.001/M rows read, $1/M rows written, $0.75/GB stored. Vercel Pro = **$20/seat + ~$2/M edge requests + $0.60/M invocations + $0.15/GB egress**. Turso paid ≈ $5–29/mo; Upstash ≈ $0–10/mo. ([CF vs Vercel](https://www.morphllm.com/comparisons/cloudflare-workers-vs-vercel), [Vercel storage](https://vercel.com/docs/storage))

Note the **$5 Workers-Paid floor effectively applies from day one** — the live D1 analytics write path puts you on the paid plan regardless of traffic, so the CF column starts at $5, not $0.

| Band | Loads/mo | Eff. egress | CF requests (8 fn + assets) | **CF (B0 / B0.5)** | **Vercel (B1)** |
| --- | --- | --- | --- | --- | --- |
| Hobby | 10k | ~10 GB | <1M (in 10M incl.) | **~$5** | ~$20 seat + ~$2 = **~$22** |
| Growing | 100k | ~100 GB | ~1–3M (in 10M incl.) | **~$5–10** | ~$20 seat + ~$15 egress + ~$1 inv = **~$36** |
| Popular | 1M | ~1 TB | **~8M fn + asset reqs → likely >10M → +$0.30/M overage** | **~$10–30** | ~$20 seat + **~$150 egress** + ~$6 inv = **~$176** |

**The headline the generic numbers hid:** for a media-weight SPA, **egress dominates** on Vercel, and Cloudflare's **zero-egress** is the real moat — the gap widens with traffic (the CF request overage at the Popular band is single-digit dollars; the Vercel egress is ~$150). B0.5 adds ~$5–29/mo Turso on either side, so it barely moves the CF column and slightly softens the Vercel premium's relative size. **Cost is a real argument for staying on CF's _edge_ (B0/B0.5); it is not an argument about _data_ (Turso is cheap everywhere).**

**Get your real numbers:** query the `analytics` D1 (`wrangler d1 execute tfdraw-analytics --command "select count(*) ..."`), pull request/egress from the **CF dashboard → Workers/Pages analytics**, and check D1 row I/O with `wrangler d1 insights`. Drop them into the assumptions above.

---

## 5. How the June-2026 shifts change the roadmap calculus

- **Cloudflare owns Vite/Vitest/Rolldown/Oxc.** Tools stay OSS ($1M commitment). Expect tighter **Vite ⇄ Workers** integration and Rolldown-Vite defaults. This makes **keeping Vite** a safe, improving bet. It is **not** a reason to host on CF — Vite runs identically whoever you deploy to. (Correcting the original draft's "swimming against the current" framing.)
- **Anthropic owns Bun.** Production-grade, Rust-rewritten, funded → **Tier-1 Bun is a safe, durable bet**.
- **Pages → Workers.** Not a sunset, but a freeze: new features are Workers-only. Plan the Workers move on a **trigger**, not a calendar (§8).
- **Vercel → Next.js-first.** Great for Next; a parity-priced premium for a Vite SPA.
- **Railway → best-in-class stateful backend host**, not edge static.

---

## 6. Decision framework (mapped to your four motivations, concentration risk foregrounded)

| Motivation | What it argues for |
| --- | --- |
| **Speed / DX** | Bun Tier-1 (CI/install speed). Hosting DX is a wash between CF and Vercel for a Vite SPA. |
| **Cost** | **CF edge** (zero egress) ≫ Vercel at scale (§4.4). This argues B0/B0.5, not B1. |
| **Vendor / roadmap** | The crux. Staying all-CF (B0) **increases** concentration — hosting + data + (loosely) toolchain on one vendor. **B0.5 is the only option that reduces concentration without a full, costly migration.** A full B1 departure reduces CF concentration but adds Vercel concentration + cost. |
| **Features / SSR / edge** | You have no SSR today (the one `ssrLoadModule` use is dev-only). If you add SSR/edge compute, **Workers** has the richer, growing surface; Vercel matches edge but gates its best features behind Next. |

**Inversion (what makes each option wrong):** B0 is wrong if CF raises Workers/D1 prices or pivots — you'd be fully exposed. B1 is wrong if traffic grows (egress bill) or you never needed to leave. B0.5 is wrong only if you were never going to leave CF _and_ D1 latency matters more than portability — a narrow case. That asymmetry is why B0.5 is the recommended hedge.

---

## 7. Recommendation (reversibility-first sequencing)

1. **Now (two-way door):** Adopt **Bun Tier-1**. ~1–2 days, reversible, immediate CI/install win.
2. **Then: do nothing on hosting until a trigger fires (§8).** Pages isn't sunset; you have no pain signal today. Motion without a forcing function is just risk.
3. **The de-risk, when you choose it (B0.5 — decouple the data layer):** run it when vendor-risk starts to feel real, or as the first phase of an actual migration. **Gate it on the latency test** in §4.0.5 first — because embedded replicas don't run on the Workers isolate, doing B0.5 _while staying on Workers_ trades latency for portability you may not use yet. The honest case for doing it early anyway: it's the one near-one-way door (§2.5), so doing it deliberately while calm beats doing it rushed under a forced migration. That's a judgment call, not an obligation.
4. **If/when a trigger hits**, the data work is the gate; everything after is easy:
   - Trigger = "want CF's new Workers features / forced build-image date" → **B0 (Workers)**. ~2 days if B0.5 already ran, ~2–4 days cold (data stays on D1 either way, so B0 doesn't actually need B0.5).
   - Trigger = "must leave Cloudflare entirely" → **B1 (Vercel)**. ~1–2 weeks cold; **~2–4 days if B0.5 already ran** (only the edge + function rewrite remain).
5. **Railway:** revisit only if you add a real stateful server backend.

---

## 8. Do-nothing baseline & revisit triggers

> **Verify the dates before acting.** The specific dated claims in this doc — the VoidZero/Bun acquisition dates, the Bun Rust-rewrite merge, and especially the Pages build-image auto-migration dates below — come from secondary sources (blogs, dev.to, press coverage) and should be **confirmed against the official Cloudflare changelog** before any of them drives a migration. Do not let an unverified date force a move.

**Baseline:** Cloudflare Pages is not deprecated. Build images are reported to auto-migrate (v1→v3 **~Sep 2026**, v2→v3 **~Feb 2027**) with no action from you — _verify on the CF changelog_. There is currently **no outage, no bill shock, and no blocked feature** in evidence. So after Bun Tier-1, the correct hosting action is **none** — until one of these fires:

- **Forced:** your Pages build image hits its auto-migration date and something breaks → move to Workers (B0).
- **Cost:** monthly CF bill crosses a threshold you set (e.g. >$N/mo), or egress/D1 row I/O spikes → re-run §4.4 with real numbers.
- **Feature:** you need a Workers-only capability (Workflows, Containers, Secrets Store, Durable Objects) → B0.
- **Vendor:** a CF pricing change, ToS change, outage pattern, or strategic pivot makes staying untenable → B1 (cheap now, because B0.5 already ran).
- **Latency:** Turso read path (post-B0.5) measurably hurts the canvas/presets UX → reconsider keeping D1 on a Workers deploy.

Put this list somewhere you'll see it (TODOS.md). Strategy docs rot; a trigger list is what keeps this one honest.

---

## 9. Execution playbooks (optional next steps)

**Bun Tier-1 spike** (½–1 day, branch, reversible)

1. `rm yarn.lock && bun install`; set `packageManager`; add `bunfig.toml` (`exact`/registry).
2. CI → `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile`; cache `~/.bun/install/cache`.
3. Confirm `better-sqlite3`/`sharp` build; `bun run build:app` is functionally equivalent (smoke + visual, not byte-identical); `vitest run` green.

**B0.5 data-decouple spike** (gated; ~3–5 days if the gate passes) 0. **Latency gate FIRST:** stand up a throwaway Turso DB, measure the presets + `LAYOUT_CACHE` read path from a Worker (remote libSQL — embedded replicas don't run on the isolate) vs current D1. If it regresses UX past budget, **stop** — keep D1, and only move data as part of an actual B1 departure.

1. Gate passed → `wrangler d1 export tfdraw-presets` → import into Turso (read-only DB, simple dump/restore).
2. Introduce a `CacheStore` interface pinning TTL/consistency; wrap current CF-KV (`STATS`, `LAYOUT_CACHE`) behind it.
3. Re-point `api/terraform-import-presets/*` (and its `_terraformPresets.ts` helper) at Turso over remote libSQL; keep everything else on CF.
4. For the live `analytics` write path, run a **dual-write window** (D1 + Turso, read D1) until caught up, then flip reads — don't naive dump/restore a hot table.

**Pages→Workers spike** (only when a §8 trigger fires; 1–2 days)

1. Add an `assets` block to `wrangler.jsonc`; keep bindings.
2. Port one endpoint (`api/event.ts`) `onRequest`→`fetch`; set `assets.run_worker_first` for Turnstile/logging; recreate `_routes.json` intent.
3. `wrangler dev` → verify; `wrangler deploy`; migrate CI from `pages deploy` to `deploy`.

**Vercel departure** (only if vendor-escape is decided; assumes B0.5 done)

1. Static build + SPA-rewrite `vercel.json` + `/api/(.*)` passthrough.
2. Port the 5 functions to `@vercel/node`; wire Turso (already migrated) + Vercel KV/Edge Config for the `CacheStore`.
3. Re-run §4.4 with real traffic to confirm the bill before cutting DNS.

---

## 10. Verification (for any executed spike)

- **Bun:** clean `bun install`; native deps build; `vitest run` green; `bun run build:app` produces a **functionally equivalent** `excalidraw-app/build` (smoke + visual parity, not byte-identical).
- **B0.5:** presets + analytics reads/writes return parity against current D1; **`CacheStore` asserts the pinned TTL/consistency semantics**; layout-cache + presets read latency within budget (the gate from §4.0.5); no writes lost across the dual-write cutover; Turnstile on `subscribe` still validates.
- **Hosting:** deploy a preview; run the curl smoke checks in `pages-deploy.yml` (index, `/demo`, presets API, layout cache); confirm D1/KV (or Turso/interface) reads return parity.

---

## 11. Sources

**Vendor moves**

- Cloudflare acquires VoidZero/Vite — https://blog.cloudflare.com/voidzero-joins-cloudflare/ · https://www.cloudflare.com/press/press-releases/2026/cloudflare-acquires-voidzero-to-build-the-future-of-the-ai-native-web/
- Anthropic/Bun + Rust rewrite — https://www.theregister.com/devops/2026/05/14/anthropics-bun-rust-rewrite-merged-at-speed-of-ai/5240381 · https://github.com/oven-sh/bun/releases

**Bun**

- Compatibility 2026 — https://dev.to/alexcloudstar/bun-compatibility-in-2026-what-actually-works-what-does-not-and-when-to-switch-23eb
- SQLite / install / workspaces — https://bun.com/docs/runtime/sqlite · https://bun.com/docs/pm/cli/install · https://www.pkgpulse.com/guides/pnpm-vs-npm-vs-yarn-vs-bun-2026
- yarn→bun + setup-bun CI — https://notes.joschua.io/50-Slipbox/Migrate-from-yarn-to-bun · https://render.com/blog/hello-bun-deploy-2x-faster-on-github-render
- Changesets + Bun — https://ianm.com/posts/2025-08-18-setting-up-changesets-with-bun-workspaces

**Cloudflare Pages → Workers**

- Official migrate-from-pages — https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/
- Refactor worker↔pages — https://developers.cloudflare.com/pages/how-to/refactor-a-worker-to-pages-functions/
- Static-assets binding / run_worker_first — https://developers.cloudflare.com/workers/static-assets/binding/
- Pages vs Workers 2026 + build-image dates — https://dev.to/rickcogley/cloudflare-pages-vs-workers-in-2026-migration-guide-ka7 · https://cogley.jp/articles/cloudflare-pages-to-workers-migration

**Vercel / Turso / Railway**

- Vite on Vercel / config / non-Next — https://vercel.com/docs/frameworks/frontend/vite · https://vercel.com/docs/project-configuration/vercel-json · https://randombits.dev/articles/vercel-tips
- Storage + cost vs CF — https://vercel.com/docs/storage · https://www.morphllm.com/comparisons/cloudflare-workers-vs-vercel
- Vinext — https://www.sitepoint.com/bridging-vite-and-next-js-the-vinext-revolution/
- Turso on Workers — https://developers.cloudflare.com/workers/databases/third-party-integrations/turso/ (verify embedded-replica-on-Workers limitations against current Turso docs)
- Railway positioning — https://blog.railway.com/p/best-serverless-platforms-2026 · https://northflank.com/blog/railway-vs-cloudflare-vs-vercel
