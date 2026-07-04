import { nanoid } from "nanoid";
import { Random } from "roughjs/bin/math";

import { isTestEnv } from "./utils";

let random = new Random(Date.now());
let testIdBase = 0;

// `|| 1` clamps the one-in-2^31 case where the raw draw floors to 0. RoughJS
// treats a `seed` of exactly 0 as "unseeded" and falls back to `Math.random()`
// per render — silently breaking determinism for whichever element happened to
// draw that value (also used for `versionNonce`; excluding a single value out
// of 2^31 there is harmless — nothing special-cases nonce/seed 0 elsewhere).
export const randomInteger = () => Math.floor(random.next() * 2 ** 31) || 1;

export const reseed = (seed: number) => {
  random = new Random(seed);
  testIdBase = 0;
};

export const randomId = () => (isTestEnv() ? `id${testIdBase++}` : nanoid());
