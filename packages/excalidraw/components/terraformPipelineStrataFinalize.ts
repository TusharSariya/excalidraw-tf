/**
 * Strata engine — A6 deterministic finalize (WP-3c; spec rcll-v2-spec-v2 §6-A6,
 * amended by v3.1 §6: `group` role + groupIds in the id-reference rewrite).
 *
 * A PURE post-processing pass over the strata scene-build output (the elements
 * `convertPipelineSkeletonToElements` returns): every element gets a
 * content-derived stable id, a deterministic RoughJS seed, a generation version
 * and a generation-keyed versionNonce; every id REFERENCE (`boundElements[].id`,
 * `containerId`, `frameId`, `startBinding`/`endBinding.elementId`, `groupIds`)
 * is rewritten through the oldId→newId map. Geometry is NEVER touched — the
 * committed Q2 strata baselines' geometry is byte-identical through this pass.
 *
 * D2′: this pass applies ONLY to strata scenes (`buildStrataScene` is its only
 * production caller); no other engine's element identity/versioning changes.
 *
 * ── stable id scheme (spec §6-A6 verbatim) ───────────────────────────────────
 *   stableId(role, address, ordinal?) = "tf:" + role + ":" + address (+ ":#" + ordinal)
 *     roles ∈ {node, frame, label, icon, edge, dup, group}   (group per v3.1 §6)
 *   edgeId(u→v, relKind, parallelOrdinal?) = "tf:edge:" + len(u) + ":" + u + "→"
 *     + len(v) + ":" + v + ":" + relKind (+ ":#" + parallelOrdinal)
 *   groupId(stableGroupKey) = "tfg:" + stableGroupKey            (v3.1 §6)
 *   seed         = (FNV-1a(stableId) & 0x7fffffff) || 1          (nonzero clamp)
 *   version      = G (generation, an INPUT — finalize stays pure; OD-7)
 *   versionNonce = (FNV-1a(stableId + ":" + G) & 0x7fffffff) || 1
 *   frame-role ids pass an INJECTIVE SVG-safe encoding (percent-encode every
 *   char outside [A-Za-z0-9_.-]; NEVER strip — stripping can collide two
 *   distinct addresses, violating R8) because frame ids are emitted raw into
 *   clipPath/url(#…).
 *
 * ── address derivation (what "address" means per element class) ──────────────
 * Every strata element belongs to a cluster build, a hull frame, or an edge;
 * addresses are read off customData (ids are regenerated at convert time, so
 * customData is the only identity carrier that survives conversion):
 *   hull frame     role=frame  address = `${terraformTopologyRole}:` +
 *                              topology-path segments, each percent-encoded,
 *                              joined with "/" (injective: "/" never survives
 *                              segment encoding)
 *   cluster frame  role=frame  address = `cluster:${terraformPrimaryAddress}`
 *                              (covers both `primaryCluster` frames and — via
 *                              the hull-path branch — full-mode
 *                              `satelliteCluster` frames, whose topology paths
 *                              embed primary + satellite root and are unique)
 *   resource card  role=node   address = APPEARANCE address (see the satellite
 *                              sub-address rule below): terraformVisibilityKey,
 *                              qualified `:#${terraformExplodeParent}` when the
 *                              card is a satellite appearance
 *   detached label role=label  address = APPEARANCE address (one label per card
 *                              appearance — `mirrorAndDetachTerraformResource-
 *                              Labels` mirrors exactly one label per card and
 *                              copies its `terraformExplodeParent`)
 *   icon glyph     role=icon   address = APPEARANCE address (resolved via the
 *                              card's pin group — glyphs carry no explode
 *                              parent of their own), ordinal = the glyph's
 *                              element index WITHIN its card's icon block,
 *                              counted PER APPEARANCE. The index is
 *                              content-derived, NOT a scene position: the block
 *                              is cloned verbatim from the committed AWS
 *                              icon-library asset
 *                              (`aws-architecture-icons.excalidrawlib`), so the
 *                              in-block order IS the asset's element order — a
 *                              stable sub-address of the icon content.
 *   TFD arrow      role=edge   u/v = relationship.source/target (collapsed
 *                              primary addresses), relKind =
 *                              customData.terraformEdgeLayer; parallelOrdinal =
 *                              pinned-comparator (C4′ code-unit) rank of the
 *                              edge's distinguishing content (original
 *                              pre-collapse endpoints + detail + label — NEVER
 *                              the file-position `sequence`)
 *   hull connector role=edge   u/v = relationship.source/target (content-
 *                              derived frame keys), relKind =
 *                              "topologyFrameFlow"; distinguishing content =
 *                              (topologyRole, parentFrameId)
 *   groups         "tfg:"      pin group (`tfpin-…`)  → `tfg:pin:${appearance}`
 *                              outer icon group (`ico-…`) → `tfg:icon:${appearance}`
 *                              inner template groups (`icg-…`) →
 *                              `tfg:icon:${appearance}:#${ordinal}` — ordinal =
 *                              first-appearance rank within the card's icon
 *                              block (icon-asset content order, see above)
 *
 * ── satellite sub-address rule (full mode; spec's "ordinal = content-derived
 *    (satellite sub-address)") ─────────────────────────────────────────────────
 * FULL card mode renders satellite bundles, and one resource can appear as a
 * satellite card inside more than one cluster's build — the bare
 * `terraformVisibilityKey` is then not unique scene-wide. Every satellite
 * APPEARANCE (recognizable by a non-null `terraformExplodeParent`) is
 * qualified: `appearance = key + ":#" + explodeParent`, applied uniformly to
 * node, label and icon roles AND to their group keys; icon in-block ordinals
 * restart per appearance. COMPACT mode is byte-unaffected: compact cards (and
 * full-mode primary cards) carry `terraformExplodeParent: null`, so their
 * appearance address IS the bare key and every compact id is byte-identical
 * to the unqualified scheme (frozen by the compact T1 tests). See
 * `appearanceAddressOf` for the injectivity evidence and the frameId-carrier
 * rejection.
 * No legitimate class of unaddressable elements was found in strata scenes
 * (verified empirically against the committed presets), so the `dup` role is
 * currently unused: an element with no derivable address dev-ASSERTS (throws)
 * rather than silently passing through. Every throw in this module carries the
 * "Strata A6 finalize:" prefix so the engine entry point attributes the failure
 * to the `finalize` stage (same contract as the "Strata A2" ordering prefix).
 *
 * ── C3′ (`updated` normalization) ────────────────────────────────────────────
 * No wall-clock reads or randomness anywhere in the strata module family
 * (statically asserted by the test suite). The shared icon-injection kernel
 * stamps real wall-clock `updated` values on icon glyphs, so finalize
 * normalizes EVERY element's `updated` to the constant 1 (the test-env
 * `getUpdatedTimestamp` value) — deterministic across builds and environments.
 *
 * ── OD-8 (`repairTerraformEdgeBindings` disposition) ─────────────────────────
 * INTEGRATE, do not replace. The repair (terraformVisibility.ts:969) never
 * touches element ids: it re-derives arrow geometry + orbit bindings from
 * `customData.relationship` ADDRESSES resolved against the CURRENT scene's
 * rect/frame keys, and short-circuits (`arrowGeometryEqual`) when the scene is
 * already consistent. Finalize rewrites ids and all id references coherently
 * and never touches geometry, so the two are orthogonal by construction:
 * repair-before-finalize (inside `convertPipelineSkeletonToElements`) resolves
 * bindings that finalize then renames consistently, and repair-after-finalize
 * (the apply path) is an empirically-verified no-op on the finalized scene
 * (asserted by the test suite). Neither runs "blindly against" the other.
 *
 * ── tombstones (OWNED BY THE APPLY LAYER, not finalize) ──────────────────────
 * `computeStrataTombstones` lives here so the id/nonce formulas stay in one
 * module, but it is CALLED from `terraformSceneApply` at replaceAllElements
 * time: removed = prevSceneAddresses − newAddresses (the pre-regenerate scene
 * is in hand — no store needed); per removed address the previous scene's
 * canonical-id element is appended with `isDeleted: true`, `version = G` and
 * the generation-keyed nonce. Tombstones persist ONE generation window: they
 * are marked `customData.terraformStrataTombstone = true`, and marked elements
 * never count as "previous addresses" on the next apply, so they are GC'd by
 * the following replaceAllElements. Strata-scoped by construction — when the
 * incoming scene carries no canonical strata ids the function returns [] and
 * non-strata scenes flow through the apply path byte-unchanged (D2′).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataFinalize.test.ts
 */
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { compareStrataContentKeys } from "./terraformPipelineStrataTypes";

// ── formulas ──────────────────────────────────────────────────────────────────

/**
 * 32-bit FNV-1a over the string's UTF-16 code units (pinned variant — the
 * hash input is always an ASCII-safe canonical id, where code units ≡ octets).
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** seed = (FNV-1a(stableId) & 0x7fffffff) || 1 — RoughJS treats seed 0 as unseeded. */
export function strataSeed(stableId: string): number {
  return fnv1a32(stableId) & 0x7fffffff || 1;
}

/** versionNonce = (FNV-1a(stableId + ":" + G) & 0x7fffffff) || 1 (OD-7). */
export function strataVersionNonce(
  stableId: string,
  generation: number,
): number {
  return fnv1a32(`${stableId}:${generation}`) & 0x7fffffff || 1;
}

export type StrataStableIdRole =
  | "node"
  | "frame"
  | "label"
  | "icon"
  | "edge"
  | "dup"
  | "group";

/** stableId(role, address, ordinal?) — ordinal is content-derived, never positional. */
export function strataStableId(
  role: StrataStableIdRole,
  address: string,
  ordinal?: number,
): string {
  return `tf:${role}:${address}${ordinal !== undefined ? `:#${ordinal}` : ""}`;
}

/** edgeId(u→v, relKind, parallelOrdinal?) — length-prefixed, injective. */
export function strataEdgeStableId(
  u: string,
  v: string,
  relKind: string,
  parallelOrdinal?: number,
): string {
  return `tf:edge:${u.length}:${u}→${v.length}:${v}:${relKind}${
    parallelOrdinal !== undefined ? `:#${parallelOrdinal}` : ""
  }`;
}

/** groupId(stableGroupKey) = "tfg:" + stableGroupKey (v3.1 §6). */
export function strataGroupId(stableGroupKey: string): string {
  return `tfg:${stableGroupKey}`;
}

const SVG_SAFE_CHAR = /^[A-Za-z0-9_.-]$/;

/**
 * INJECTIVE SVG-safe encoding for frame-role ids: percent-encode every char
 * outside [A-Za-z0-9_.-] (never strip). `encodeURIComponent` covers multi-byte
 * chars; its unreserved extras (!~*'()) get an explicit %XX so the safe
 * alphabet is EXACTLY [A-Za-z0-9_.-] (plus "%" as the escape introducer).
 */
export function sanitizeStrataFrameId(rawId: string): string {
  let out = "";
  for (const ch of rawId) {
    if (SVG_SAFE_CHAR.test(ch)) {
      out += ch;
      continue;
    }
    const enc = encodeURIComponent(ch);
    out +=
      enc !== ch
        ? enc
        : `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

const FRAME_ID_PREFIX = sanitizeStrataFrameId("tf:frame:");

/**
 * Exact canonical-id grammar (tightened per codex-review WP-3f fix-1): `tf:`
 * followed by one of the known roles and a colon. A bare `id.startsWith("tf:")`
 * check would also accept a foreign tf:-prefixed id (e.g. pasted from an
 * exported scene) and let it wrongly activate the apply-layer tombstone pass —
 * this pins the grammar to exactly what {@link strataStableId} /
 * {@link strataEdgeStableId} ever emit.
 */
const STRATA_CANONICAL_ID_PATTERN =
  /^tf:(node|frame|label|icon|edge|dup|group):/;

/** True iff `id` is a canonical strata id (finalized element). */
export function isStrataCanonicalId(id: string): boolean {
  return STRATA_CANONICAL_ID_PATTERN.test(id) || id.startsWith(FRAME_ID_PREFIX);
}

export const STRATA_TOMBSTONE_CUSTOM_DATA_KEY = "terraformStrataTombstone";

// ── internals ─────────────────────────────────────────────────────────────────

type CustomData = Record<string, unknown>;

const fail = (message: string): never => {
  throw new Error(`Strata A6 finalize: ${message}`);
};

const cdOf = (el: ExcalidrawElement): CustomData =>
  (el.customData ?? {}) as CustomData;

const str = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** Per-segment percent-encoded, "/"-joined topology path (injective join). */
const encodePathSegments = (path: readonly unknown[]): string =>
  path.map((seg) => encodeURIComponent(String(seg))).join("/");

type Relationship = {
  source?: unknown;
  target?: unknown;
  detail?: unknown;
  label?: unknown;
  topologyRole?: unknown;
  parentFrameId?: unknown;
  terraformPipelineOriginalSource?: unknown;
  terraformPipelineOriginalTarget?: unknown;
};

/**
 * The edge's distinguishing content for the pinned parallel-edge comparator
 * (C4′): original pre-collapse endpoints + detail + label for TFD arrows,
 * (topologyRole, parentFrameId) for aggregated hull connectors. NEVER the
 * file-position `sequence`.
 */
const edgeContentKey = (rel: Relationship): string =>
  [
    str(rel.terraformPipelineOriginalSource) ?? "",
    str(rel.terraformPipelineOriginalTarget) ?? "",
    str(rel.detail) ?? "",
    str(rel.label) ?? "",
    str(rel.topologyRole) ?? "",
    str(rel.parentFrameId) ?? "",
  ].join("\0");

/**
 * Satellite sub-address qualification (spec §6-A6: "ordinal = content-derived
 * (satellite sub-address)"). In FULL card mode a resource can be rendered as a
 * SATELLITE card inside more than one cluster's build, so its bare
 * `terraformVisibilityKey` is NOT unique scene-wide (verified on
 * staging-extended-localstack-v2: 16 addresses appear as satellites in two
 * clusters each). Each satellite APPEARANCE is qualified by its explode-graph
 * parent — `customData.terraformExplodeParent`, stamped on satellite cards by
 * the cluster builder and copied onto their detached labels by
 * `mirrorAndDetachTerraformResourceLabels`:
 *
 *   appearanceAddress = key                     (primary cards, and every
 *                                                COMPACT-mode card: their
 *                                                terraformExplodeParent is
 *                                                null ⇒ compact ids stay
 *                                                byte-identical)
 *   appearanceAddress = `${key}:#${parent}`     (satellite appearances — the
 *                                                ":#" segment IS the spec's
 *                                                content-derived satellite
 *                                                sub-address ordinal)
 *
 * `(key, parent)` is empirically injective scene-wide (probed: zero duplicate
 * pairs, zero satellite appearances missing the parent). Were a nested
 * satellite bundle ever replicated under the SAME direct parent in two
 * clusters, the id-uniqueness dev-assert below fires and the engine degrades
 * honestly (§5) — no silent randomization. The element's own customData is
 * used (NOT `frameId` → frame `terraformPrimaryAddress`): satellite cards can
 * carry `frameId: null` in full-mode scenes, so the frame route is not total.
 */
const appearanceAddressOf = (key: string, cd: CustomData): string => {
  const parent = str(cd.terraformExplodeParent);
  return parent ? `${key}:#${parent}` : key;
};

type AppearanceResolution = {
  /** oldElementId → appearance address (resource rects, labels, icon glyphs). */
  byElement: ReadonlyMap<string, string>;
  /** pin group id → the OWNING RECT's appearance address (see below). */
  byPinGroup: ReadonlyMap<string, string>;
};

/**
 * Per-element appearance address for every card-family element (resource
 * rects, their labels, their icon glyphs) — the shared prepass both
 * `deriveStableIds` and `deriveGroupIds` key off. Rects and labels
 * self-derive (both carry `terraformExplodeParent`); icon glyphs carry
 * neither the parent nor a tier, so they resolve through their card's pin
 * group (`tfpin-…`, or the canonical `tfg:pin:…` on a re-finalize), which is
 * claimed by exactly one rect.
 *
 * The RECT is the authoritative owner of its pin group. This matters for
 * full-mode duplicate keys: the shared icon-injection kernel resolves
 * detached labels by BARE visibility key, so when a resource appears in two
 * clusters, one appearance's label can be stamped with the OTHER appearance's
 * pin group (frozen upstream behavior — A6 finalizes identity, it does not
 * repair grouping). Labels therefore keep their SELF-derived identity, and
 * pin-group KEYS come from the claiming rect, never from label membership.
 */
const deriveAppearanceAddresses = (
  elements: readonly ExcalidrawElement[],
): AppearanceResolution => {
  const out = new Map<string, string>();
  const byPinGroup = new Map<string, string>();
  for (const el of elements) {
    const cd = cdOf(el);
    if (
      cd.terraformVisibilityRole !== "resource" ||
      (el.type !== "rectangle" && el.type !== "text")
    ) {
      continue;
    }
    const key = str(cd.terraformVisibilityKey);
    if (!key) {
      continue; // the role-specific assert in deriveStableIds reports this
    }
    const address = appearanceAddressOf(key, cd);
    out.set(el.id, address);
    if (el.type !== "rectangle") {
      continue;
    }
    for (const gid of el.groupIds ?? []) {
      if (!gid.startsWith("tfpin-") && !gid.startsWith("tfg:pin:")) {
        continue;
      }
      const prev = byPinGroup.get(gid);
      if (prev !== undefined && prev !== address) {
        fail(
          `pin group "${gid}" is claimed by two card appearances ("${prev}" vs "${address}")`,
        );
      }
      byPinGroup.set(gid, address);
    }
  }
  for (const el of elements) {
    const cd = cdOf(el);
    if (cd.terraformAwsIconGlyph !== true) {
      continue;
    }
    const pinGid = (el.groupIds ?? []).find(
      (gid) => gid.startsWith("tfpin-") || gid.startsWith("tfg:pin:"),
    );
    const address = pinGid ? byPinGroup.get(pinGid) : undefined;
    if (address === undefined) {
      return fail(
        `icon glyph "${el.id}" has no resolvable card appearance (missing or unclaimed pin group)`,
      );
    }
    out.set(el.id, address);
  }
  return { byElement: out, byPinGroup };
};

/** Frame address (see the module-header derivation table). */
const frameAddressOf = (el: ExcalidrawElement): string => {
  const cd = cdOf(el);
  const role = str(cd.terraformTopologyRole);
  if (!role) {
    return fail(
      `frame "${el.id}" has no terraformTopologyRole — not a strata frame`,
    );
  }
  if (role === "primaryCluster") {
    const address = str(cd.terraformPrimaryAddress);
    if (!address) {
      return fail(
        `primaryCluster frame "${el.id}" has no terraformPrimaryAddress`,
      );
    }
    return `cluster:${address}`;
  }
  const path = cd.terraformTopologyPath;
  if (!Array.isArray(path) || path.length === 0) {
    return fail(`hull frame "${el.id}" (${role}) has no terraformTopologyPath`);
  }
  return `${role}:${encodePathSegments(path)}`;
};

/**
 * Derive every element's stable id. Two passes over the scene: pass 1 buckets
 * parallel edges and icon blocks (whose ordinals are content-ranked within
 * their bucket), pass 2 assigns ids.
 */
const deriveStableIds = (
  elements: readonly ExcalidrawElement[],
  appearance: ReadonlyMap<string, string>,
): Map<string, string> => {
  // ── pass 1: parallel-edge buckets + per-card icon counters ──
  const edgeBuckets = new Map<string, { index: number; content: string }[]>();
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]!;
    const cd = cdOf(el);
    const rel = cd.relationship as Relationship | undefined;
    if ((el.type !== "arrow" && el.type !== "line") || !rel) {
      continue;
    }
    const u = str(rel.source);
    const v = str(rel.target);
    const relKind = str(cd.terraformEdgeLayer);
    if (!u || !v || !relKind) {
      fail(
        `edge "${el.id}" is missing relationship.source/target or terraformEdgeLayer`,
      );
    }
    const bucketKey = `${relKind}\0${u}\0${v}`;
    const bucket = edgeBuckets.get(bucketKey) ?? [];
    bucket.push({ index: i, content: edgeContentKey(rel) });
    edgeBuckets.set(bucketKey, bucket);
  }
  // parallelOrdinal = pinned-comparator rank of the distinguishing content.
  // Ties (byte-identical content) keep in-bucket order — the tied edges are
  // indistinguishable, so any tie assignment yields the same scene bytes.
  const edgeOrdinal = new Map<number, number>();
  for (const bucket of edgeBuckets.values()) {
    if (bucket.length < 2) {
      continue;
    }
    const ranked = [...bucket].sort((a, b) =>
      compareStrataContentKeys(a.content, b.content),
    );
    ranked.forEach((entry, ordinal) => edgeOrdinal.set(entry.index, ordinal));
  }

  // ── pass 2: assign ids ──
  const stableIds = new Map<string, string>();
  const iconCounters = new Map<string, number>();
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]!;
    const cd = cdOf(el);
    let stableId: string;

    if (el.type === "frame") {
      stableId = sanitizeStrataFrameId(
        strataStableId("frame", frameAddressOf(el)),
      );
    } else if (cd.terraformAwsIconGlyph === true) {
      // Appearance-qualified (satellite sub-address) — resolved via the pin
      // group; the counter is scoped PER APPEARANCE, so two appearances of one
      // resource each restart at ordinal 0.
      const address = appearance.get(el.id)!; // total for icons (prepass asserts)
      // In-block index = icon-asset element order (content sub-address).
      const ordinal = iconCounters.get(address) ?? 0;
      iconCounters.set(address, ordinal + 1);
      stableId = strataStableId("icon", address, ordinal);
    } else if (cd.relationship && (el.type === "arrow" || el.type === "line")) {
      const rel = cd.relationship as Relationship;
      stableId = strataEdgeStableId(
        str(rel.source)!,
        str(rel.target)!,
        str(cd.terraformEdgeLayer)!,
        edgeOrdinal.get(i),
      );
    } else if (
      el.type === "rectangle" &&
      cd.terraformVisibilityRole === "resource"
    ) {
      // Appearance-qualified: bare key for primaries/compact cards, satellite
      // sub-address (`key:#parent`) for satellite appearances.
      const address = appearance.get(el.id);
      if (!address) {
        return fail(`resource card "${el.id}" has no terraformVisibilityKey`);
      }
      stableId = strataStableId("node", address);
    } else if (
      el.type === "text" &&
      cd.terraformVisibilityRole === "resource"
    ) {
      // The detached (or still-bound) resource-card label — exactly one per
      // card APPEARANCE (qualified like its card).
      const address = appearance.get(el.id);
      if (!address) {
        return fail(`label "${el.id}" has no terraformVisibilityKey`);
      }
      stableId = strataStableId("label", address);
    } else {
      // No legitimate class of unaddressable elements exists in a strata scene
      // (every element belongs to a cluster build, a hull frame, or an edge) —
      // dev-assert rather than silently passing through (the `dup` route stays
      // unused until a real class appears; see module header).
      return fail(
        `element "${el.id}" (type ${el.type}) has no derivable address`,
      );
    }
    stableIds.set(el.id, stableId);
  }

  // uniqueness dev-ASSERT — BEFORE convert/restore consumers (restore silently
  // randomizes duplicate ids, which would break R8 stability undetected).
  const seen = new Map<string, string>();
  for (const [oldId, stableId] of stableIds) {
    const clash = seen.get(stableId);
    if (clash !== undefined) {
      fail(
        `duplicate stable id "${stableId}" (derived for both "${clash}" and "${oldId}")`,
      );
    }
    seen.set(stableId, oldId);
  }
  return stableIds;
};

/**
 * Group-id map (v3.1 §6): every old group id → "tfg:" + content-stable key.
 * Keys are member-set-independent — derived from the group's OWNER APPEARANCE
 * ADDRESS (satellite appearances are sub-address-qualified, see
 * {@link appearanceAddressOf}), not from the member list. Pin groups are keyed
 * by their claiming RECT's appearance (label membership never keys a pin
 * group — see the label-crossing note on {@link deriveAppearanceAddresses});
 * ico/icg groups are keyed by their icon members, which must agree.
 */
const deriveGroupIds = (
  elements: readonly ExcalidrawElement[],
  appearance: AppearanceResolution,
): Map<string, string> => {
  type GroupInfo = { address: string; firstIndex: number };
  const groups = new Map<string, GroupInfo>();
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]!;
    if (!el.groupIds || el.groupIds.length === 0) {
      continue;
    }
    for (const gid of el.groupIds) {
      if (gid.startsWith("tfg:")) {
        continue; // already canonical (re-finalize) — identity-mapped below
      }
      // Pin groups: address = the claiming rect's appearance (authoritative).
      const address = gid.startsWith("tfpin-")
        ? appearance.byPinGroup.get(gid)
        : appearance.byElement.get(el.id);
      if (!address) {
        fail(
          gid.startsWith("tfpin-")
            ? `pin group "${gid}" has no claiming card appearance`
            : `group member "${el.id}" of group "${gid}" has no derivable appearance address`,
        );
      }
      const info = groups.get(gid);
      if (!info) {
        groups.set(gid, { address: address!, firstIndex: i });
      } else if (info.address !== address) {
        fail(
          `group "${gid}" spans two addresses ("${info.address}" vs "${address}")`,
        );
      }
    }
  }

  // inner icon-template group ordinals: first-appearance rank within the
  // card's icon block (= the icon asset's own group order — content-derived).
  const icgByAddress = new Map<string, { gid: string; firstIndex: number }[]>();
  for (const [gid, info] of groups) {
    if (gid.startsWith("icg-")) {
      const list = icgByAddress.get(info.address) ?? [];
      list.push({ gid, firstIndex: info.firstIndex });
      icgByAddress.set(info.address, list);
    }
  }
  const icgOrdinal = new Map<string, number>();
  for (const list of icgByAddress.values()) {
    list.sort((a, b) => a.firstIndex - b.firstIndex);
    list.forEach((entry, ordinal) => icgOrdinal.set(entry.gid, ordinal));
  }

  const map = new Map<string, string>();
  for (const [gid, info] of groups) {
    let key: string;
    if (gid.startsWith("tfpin-")) {
      key = `pin:${info.address}`;
    } else if (gid.startsWith("ico-")) {
      key = `icon:${info.address}`;
    } else if (gid.startsWith("icg-")) {
      key = `icon:${info.address}:#${icgOrdinal.get(gid)}`;
    } else {
      return fail(
        `group "${gid}" has no derivable stable key (unknown group class)`,
      );
    }
    map.set(gid, strataGroupId(key));
  }
  // group-id uniqueness dev-assert (mirror of the element-id one).
  const seen = new Map<string, string>();
  for (const [oldGid, newGid] of map) {
    const clash = seen.get(newGid);
    if (clash !== undefined) {
      fail(
        `duplicate stable group id "${newGid}" (derived for both "${clash}" and "${oldGid}")`,
      );
    }
    seen.set(newGid, oldGid);
  }
  return map;
};

// ── finalize ──────────────────────────────────────────────────────────────────

export type StrataFinalizeOptions = {
  /** Generation G (OD-7) — a monotone integer INPUT; finalize stays pure. */
  generation: number;
};

/**
 * A6 finalize — see the module header for the full contract. Pure function of
 * `(elements, generation)`: same inputs ⇒ byte-identical output (ids, seeds,
 * versions, nonces, references included). Never mutates its input.
 */
export function finalizeStrataScene(
  elements: readonly ExcalidrawElement[],
  options: StrataFinalizeOptions,
): ExcalidrawElement[] {
  const { generation } = options;
  const appearance = deriveAppearanceAddresses(elements);
  const idMap = deriveStableIds(elements, appearance.byElement);
  const groupMap = deriveGroupIds(elements, appearance);

  const mapId = (ref: string, kind: string, owner: string): string => {
    const mapped = idMap.get(ref);
    if (mapped === undefined) {
      return fail(`dangling ${kind} reference "${ref}" on element "${owner}"`);
    }
    return mapped;
  };
  const mapGroupId = (gid: string, owner: string): string => {
    if (gid.startsWith("tfg:")) {
      return gid; // already canonical (re-finalize is idempotent)
    }
    const mapped = groupMap.get(gid);
    if (mapped === undefined) {
      return fail(`dangling groupIds reference "${gid}" on element "${owner}"`);
    }
    return mapped;
  };

  return elements.map((el) => {
    const stableId = idMap.get(el.id)!;
    const next = {
      ...el,
      id: stableId,
      seed: strataSeed(stableId),
      version: generation,
      versionNonce: strataVersionNonce(stableId, generation),
      // C3′: the icon-injection kernel stamps real wall-clock values — pin the
      // whole scene to the deterministic constant (see module header).
      updated: 1,
    } as Record<string, unknown>;

    if (el.frameId != null) {
      next.frameId = mapId(el.frameId, "frameId", el.id);
    }
    const containerId = (el as { containerId?: string | null }).containerId;
    if (containerId != null) {
      next.containerId = mapId(containerId, "containerId", el.id);
    }
    if (el.boundElements && el.boundElements.length > 0) {
      next.boundElements = el.boundElements.map((bound) => ({
        ...bound,
        id: mapId(bound.id, "boundElements", el.id),
      }));
    }
    // Icon glyphs cloned from the library asset can carry start/endBinding
    // referencing the ASSET's own element ids (the clone kernel nulls
    // boundElements/containerId but not bindings) — never scene references.
    // Normalize those to null (deterministic); every non-icon dangling
    // binding stays a hard dev-assert.
    const isIconGlyph = cdOf(el).terraformAwsIconGlyph === true;
    const mapBinding = (
      binding: { elementId: string },
      kind: string,
    ): { elementId: string } | null => {
      const mapped = idMap.get(binding.elementId);
      if (mapped !== undefined) {
        return { ...binding, elementId: mapped };
      }
      if (isIconGlyph) {
        return null; // icon-asset baggage, not a scene reference
      }
      return fail(
        `dangling ${kind} reference "${binding.elementId}" on element "${el.id}"`,
      );
    };
    const startBinding = (el as { startBinding?: { elementId: string } | null })
      .startBinding;
    if (startBinding != null) {
      next.startBinding = mapBinding(startBinding, "startBinding");
    }
    const endBinding = (el as { endBinding?: { elementId: string } | null })
      .endBinding;
    if (endBinding != null) {
      next.endBinding = mapBinding(endBinding, "endBinding");
    }
    if (el.groupIds && el.groupIds.length > 0) {
      next.groupIds = el.groupIds.map((gid) => mapGroupId(gid, el.id));
    }
    return next as unknown as ExcalidrawElement;
  });
}

// ── tombstones (apply-layer machinery; see module header) ─────────────────────

/**
 * removed = prevSceneAddresses − newAddresses, materialized as tombstones.
 * Returns [] unless the INCOMING scene is a finalized strata scene (canonical
 * ids present) — the strata scoping gate (D2′). `generation` comes from the
 * scene meta echo when available; otherwise the incoming elements' stamped
 * version (all strata elements share version = G) is used.
 */
export function computeStrataTombstones(
  prevElements: readonly ExcalidrawElement[],
  nextElements: readonly ExcalidrawElement[],
  generation?: number,
): ExcalidrawElement[] {
  const nextCanonicalIds = new Set<string>();
  let stampedGeneration: number | undefined;
  for (const el of nextElements) {
    if (isStrataCanonicalId(el.id)) {
      nextCanonicalIds.add(el.id);
      stampedGeneration ??= el.version;
    }
  }
  if (nextCanonicalIds.size === 0) {
    return [];
  }
  const g = generation ?? stampedGeneration ?? 1;

  const tombstones: ExcalidrawElement[] = [];
  for (const el of prevElements) {
    if (!isStrataCanonicalId(el.id) || nextCanonicalIds.has(el.id)) {
      continue;
    }
    // One-generation window: a prior tombstone never counts as a previous
    // address, so it is GC'd by this replaceAllElements.
    if (cdOf(el)[STRATA_TOMBSTONE_CUSTOM_DATA_KEY] === true) {
      continue;
    }
    tombstones.push({
      ...el,
      isDeleted: true,
      version: g,
      versionNonce: strataVersionNonce(el.id, g),
      customData: {
        ...cdOf(el),
        [STRATA_TOMBSTONE_CUSTOM_DATA_KEY]: true,
      },
    } as ExcalidrawElement);
  }
  return tombstones;
}
