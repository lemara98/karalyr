import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { KeyValueStore } from "./stores/kv";

export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

function secret(): string {
  return process.env.POW_SECRET || "insecure-dev-secret";
}

export function difficultyBits(): number {
  const n = parseInt(process.env.POW_DIFFICULTY ?? "19", 10);
  return Number.isFinite(n) && n > 0 && n <= 64 ? n : 19;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex").slice(0, 32);
}

/**
 * Target string in the LRCLIB style: a 64-hex-char threshold. A solution's
 * sha256(prefix + nonce) interpreted as hex must be <= target. With N
 * difficulty bits the target has N leading zero bits.
 */
export function difficultyTarget(bits: number): string {
  const bytes = new Uint8Array(32).fill(0xff);
  const fullBytes = Math.floor(bits / 8);
  const remBits = bits % 8;
  for (let i = 0; i < fullBytes; i++) bytes[i] = 0;
  if (fullBytes < 32 && remBits > 0) bytes[fullBytes] = 0xff >> remBits;
  return Buffer.from(bytes).toString("hex");
}

export interface Challenge {
  prefix: string;
  target: string;
}

/** Stateless challenge: prefix embeds an expiry and an HMAC over both. */
export function createChallenge(now: number = Date.now()): Challenge {
  const rand = randomBytes(12).toString("hex");
  const expiresAt = now + CHALLENGE_TTL_MS;
  const prefix = `${rand}.${expiresAt}.${sign(`${rand}.${expiresAt}`)}`;
  return { prefix, target: difficultyTarget(difficultyBits()) };
}

export function hashMeetsTarget(hashHex: string, targetHex: string): boolean {
  // Both are 64 lowercase hex chars; lexicographic compare == numeric compare.
  return hashHex <= targetHex;
}

export type PowVerdict =
  | { ok: true }
  | { ok: false; reason: "malformed" | "expired" | "bad_signature" | "wrong_hash" | "already_used" };

/**
 * Verify a solved challenge and consume it (single use). Stateless except
 * for the replay guard, which lives in the KV seam.
 */
export async function verifyAndConsumeSolution(
  store: KeyValueStore,
  prefix: string,
  nonce: string,
  now: number = Date.now()
): Promise<PowVerdict> {
  const parts = prefix.split(".");
  if (parts.length !== 3 || !nonce || nonce.length > 64) return { ok: false, reason: "malformed" };
  const [rand, expiresAtStr, mac] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: "malformed" };
  if (expiresAt < now) return { ok: false, reason: "expired" };

  const expected = sign(`${rand}.${expiresAt}`);
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expected);
  if (macBuf.length !== expectedBuf.length || !timingSafeEqual(macBuf, expectedBuf)) {
    return { ok: false, reason: "bad_signature" };
  }

  const hash = createHash("sha256").update(prefix + nonce).digest("hex");
  if (!hashMeetsTarget(hash, difficultyTarget(difficultyBits()))) {
    return { ok: false, reason: "wrong_hash" };
  }

  const usedKey = `pow-used:${rand}`;
  if ((await store.get(usedKey)) !== null) return { ok: false, reason: "already_used" };
  await store.set(usedKey, "1", CHALLENGE_TTL_MS);
  return { ok: true };
}
