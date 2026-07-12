import { timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "karalyr_admin";

export function adminToken(): string | null {
  return process.env.ADMIN_TOKEN || null;
}

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function isValidAdminToken(token: string | undefined | null): boolean {
  const expected = adminToken();
  return !!expected && !!token && tokensMatch(token, expected);
}

/** Check the admin cookie on a plain Request. */
export function isAdminRequest(req: Request): boolean {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ADMIN_COOKIE}=`));
  return isValidAdminToken(match?.slice(ADMIN_COOKIE.length + 1));
}
