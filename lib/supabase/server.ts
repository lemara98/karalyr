import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Karalyr shares its Supabase project (and therefore its user accounts) with
// the karafilt.com website — same NEXT_PUBLIC_SUPABASE_* values. Comments and
// all other Karalyr data stay in the local SQLite DB; Supabase is only the
// identity provider here.

/** True only when the Supabase env vars are present, so auth-dependent UI can degrade gracefully. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * Server-side Supabase client bound to the request's cookies. Use in Server
 * Components, Server Actions, and Route Handlers.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component, where cookies can't be written.
            // Safe to ignore — middleware.ts refreshes the session instead.
          }
        },
      },
    }
  );
}
