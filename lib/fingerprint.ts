import { createHash } from "node:crypto";

/**
 * Anonymous submitter identity: sha256(ip | user-agent | salt). Raw IPs are
 * never stored. In dev (NODE_ENV !== production) the `x-karalyr-debug-fp`
 * header overrides the fingerprint so promotion rules can be exercised from
 * one machine.
 */
export function fingerprintFromRequest(req: Request): string {
  if (process.env.NODE_ENV !== "production") {
    const debug = req.headers.get("x-karalyr-debug-fp");
    if (debug) return `debug:${debug}`;
  }
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "local";
  const ua = req.headers.get("user-agent") ?? "unknown";
  const salt = process.env.FINGERPRINT_SALT || "insecure-dev-salt";
  return createHash("sha256").update(`${ip}|${ua}|${salt}`).digest("hex");
}
