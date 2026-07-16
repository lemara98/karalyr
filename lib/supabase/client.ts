import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client (public anon key — RLS protects the data).
// Shares the karafilt.com project, so karafilt accounts work here.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
