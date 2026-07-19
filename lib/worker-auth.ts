import { timingSafeEqual } from "node:crypto";

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function secretMatches(presented: string | undefined | null, expected: string | undefined): boolean {
  return !!expected && !!presented && tokensMatch(presented, expected);
}

/** Bearer-token check for the pull-worker daemon's /api/worker/* routes. */
export function isWorkerRequest(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  return secretMatches(token, process.env.WORKER_TOKEN);
}

/** Shared-secret check for the karafilt.com proxy's /api/sync-queue/intake. */
export function isIntakeRequest(req: Request): boolean {
  return secretMatches(
    req.headers.get("x-karalyr-intake-secret"),
    process.env.KARALYR_INTAKE_SECRET
  );
}
