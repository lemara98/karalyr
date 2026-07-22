import { apiError, corsOptions, json } from "@/lib/api-helpers";
import { fingerprintFromRequest } from "@/lib/fingerprint";
import { createChallenge } from "@/lib/pow";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getKvStore } from "@/lib/stores";

export async function POST(req: Request) {
  const fingerprint = fingerprintFromRequest(req);
  const { allowed } = await checkRateLimit(
    getKvStore(),
    `challenge:${fingerprint}`,
    RATE_LIMITS.challenge.limit,
    RATE_LIMITS.challenge.windowMs
  );
  if (!allowed) return apiError(429, "TooManyRequests", "Challenge rate limit exceeded");

  return json(createChallenge());
}

export const OPTIONS = corsOptions;
