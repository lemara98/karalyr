import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isAdminUser, isValidAdminToken } from "@/lib/admin";

const ORIGINAL_EMAILS = process.env.ADMIN_EMAILS;
const ORIGINAL_TOKEN = process.env.ADMIN_TOKEN;

afterEach(() => {
  process.env.ADMIN_EMAILS = ORIGINAL_EMAILS;
  process.env.ADMIN_TOKEN = ORIGINAL_TOKEN;
});

function user(overrides: Partial<User> = {}): User {
  return { id: "user-1", email: "person@example.com", ...overrides } as User;
}

/** Minimal stand-in for the request-scoped client's app_admins lookup. */
function supabaseReturning(row: { user_id: string } | null, calls?: { n: number }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (calls) calls.n++;
            return { data: row };
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("isAdminUser", () => {
  it("accepts an allowlisted email regardless of case or padding", async () => {
    process.env.ADMIN_EMAILS = " Owner@Example.com , second@example.com ";
    const calls = { n: 0 };
    expect(await isAdminUser(user({ email: "owner@example.com" }), supabaseReturning(null, calls))).toBe(true);
    expect(await isAdminUser(user({ email: "second@example.com" }), supabaseReturning(null))).toBe(true);
    // The allowlist short-circuits, so no app_admins round trip is needed.
    expect(calls.n).toBe(0);
  });

  it("falls back to app_admins when the email is not allowlisted", async () => {
    process.env.ADMIN_EMAILS = "";
    expect(await isAdminUser(user(), supabaseReturning({ user_id: "user-1" }))).toBe(true);
    expect(await isAdminUser(user(), supabaseReturning(null))).toBe(false);
  });

  it("treats a user with no email and no admin row as not an admin", async () => {
    process.env.ADMIN_EMAILS = "owner@example.com";
    expect(await isAdminUser(user({ email: undefined }), supabaseReturning(null))).toBe(false);
  });

  it("does not grant admin when ADMIN_EMAILS is unset", async () => {
    delete process.env.ADMIN_EMAILS;
    expect(await isAdminUser(user(), supabaseReturning(null))).toBe(false);
  });
});

describe("isValidAdminToken (deprecated fallback)", () => {
  it("matches only the configured token", () => {
    process.env.ADMIN_TOKEN = "a-long-random-token";
    expect(isValidAdminToken("a-long-random-token")).toBe(true);
    expect(isValidAdminToken("wrong")).toBe(false);
    expect(isValidAdminToken(undefined)).toBe(false);
  });

  it("never authenticates when the token is unset or empty", () => {
    delete process.env.ADMIN_TOKEN;
    expect(isValidAdminToken("")).toBe(false);
    expect(isValidAdminToken("anything")).toBe(false);
    process.env.ADMIN_TOKEN = "";
    expect(isValidAdminToken("")).toBe(false);
  });
});
