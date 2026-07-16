"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type AuthState = { error?: string };

/** Only allow internal redirect targets ("/track/17"), never external URLs. */
function safeNext(raw: FormDataEntryValue | null): string {
  const next = String(raw || "");
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function siteOrigin(headerOrigin: string | null): string {
  return process.env.NEXT_PUBLIC_SITE_URL || headerOrigin || "http://localhost:3000";
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) {
    return { error: "Sign-in isn't configured yet (missing Supabase keys)." };
  }
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  if (!email || !password) return { error: "Email and password are required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect(safeNext(formData.get("next")));
}

/**
 * OAuth sign-in (Google / GitHub) with the shared karafilt.com Supabase
 * project. The PKCE code lands on /auth/confirm, which exchanges it and
 * forwards to `next`.
 */
export async function signInWithOAuth(formData: FormData) {
  const provider = formData.get("provider");
  const next = safeNext(formData.get("next"));
  if (provider !== "google" && provider !== "github") redirect("/login");
  if (!isSupabaseConfigured()) redirect("/login?error=oauth_failed");

  const supabase = await createClient();
  const origin = siteOrigin((await headers()).get("origin"));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  if (error || !data?.url) redirect("/login?error=oauth_failed");
  redirect(data.url);
}

export async function logout(formData: FormData) {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  revalidatePath("/", "layout");
  redirect(safeNext(formData.get("next")));
}
