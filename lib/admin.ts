import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * Admin identity. Karalyr's moderation surfaces are gated by a real account —
 * the shared Supabase login it already uses for comments — not by a shared
 * secret, so every action has a person behind it and access is revocable per
 * user.
 *
 * Two ways to be an admin, matching the karafilt.com website:
 *   1. ADMIN_EMAILS — comma-separated allowlist, zero-friction bootstrap.
 *   2. public.app_admins in the shared Supabase project (karafilt's
 *      0002_admin.sql). That table has a select-own RLS policy and *no*
 *      write policy, so a user can read their own admin status but can never
 *      grant it to themselves.
 *
 * ADMIN_TOKEN still works as a fallback (see below) so a deploy can't lock
 * the operator out mid-migration. Drop it once every admin has an account.
 */

/** @deprecated Legacy shared-secret cookie. Remove with ADMIN_TOKEN. */
export const ADMIN_COOKIE = "karalyr_admin";

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** @deprecated Legacy shared-secret check, kept for the ADMIN_TOKEN fallback. */
export function isValidAdminToken(token: string | undefined | null): boolean {
  const expected = process.env.ADMIN_TOKEN || null;
  return !!expected && !!token && tokensMatch(token, expected);
}

function adminEmailAllowlist(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True if `user` is an admin: in the ADMIN_EMAILS allowlist, or present in
 * public.app_admins. `supabase` must be the request-scoped client — the
 * own-row SELECT policy is what lets the user read their own status.
 */
export async function isAdminUser(user: User, supabase: SupabaseClient): Promise<boolean> {
  if (user.email && adminEmailAllowlist().includes(user.email.toLowerCase())) {
    return true;
  }
  // Absent/unreadable table (project without karafilt's migration) => not an
  // admin, rather than an exception on every admin request.
  const { data } = await supabase
    .from("app_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return Boolean(data);
}

export interface AdminStatus {
  isAdmin: boolean;
  /** Email of the signed-in user, when there is one. */
  email: string | null;
  /** How admin was established, for the UI to explain itself. */
  via: "account" | "legacy-token" | null;
}

/**
 * Resolve admin status for the current request from cookies. Safe in Server
 * Components and Route Handlers alike.
 *
 * Uses auth.getUser(), which verifies the JWT with the auth server — never
 * getSession(), which would trust whatever cookie the browser presented.
 */
export async function adminStatus(): Promise<AdminStatus> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const admin = await isAdminUser(user, supabase);
      return { isAdmin: admin, email: user.email ?? null, via: admin ? "account" : null };
    }
  }

  const cookieStore = await cookies();
  if (isValidAdminToken(cookieStore.get(ADMIN_COOKIE)?.value)) {
    return { isAdmin: true, email: null, via: "legacy-token" };
  }
  return { isAdmin: false, email: null, via: null };
}

/**
 * Guard for admin route handlers. Every admin endpoint is reachable directly
 * over HTTP, so each one calls this for itself — gating the page is never the
 * only check.
 */
export async function isAdminRequest(): Promise<boolean> {
  return (await adminStatus()).isAdmin;
}
