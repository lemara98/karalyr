import { HeaderAuthMenu, type HeaderUser } from "@/components/HeaderAuthMenu";
import { MobileMenu, type NavLink } from "@/components/MobileMenu";
import { isAdminUser } from "@/lib/admin";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

// Server boundary for the header auth element: resolves the session user
// (shared karafilt.com Supabase accounts) and hands the client menu a plain
// serializable prop. Reading cookies here makes routes render dynamically —
// accepted, since middleware already runs auth.getUser() on every request.
// Admin status rides along so the dropdown can offer the moderation page;
// it is presentation only — every /admin surface re-checks for itself.
// The mobile burger menu renders here too, so it can share the resolved
// user without a second auth round-trip.
export async function HeaderAuth({ navLinks }: { navLinks: NavLink[] }) {
  let user: HeaderUser = null;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      user = {
        email: data.user.email ?? "",
        isAdmin: await isAdminUser(data.user, supabase),
      };
    }
  }
  return (
    <>
      <HeaderAuthMenu user={user} />
      <MobileMenu links={navLinks} signedIn={user !== null} />
    </>
  );
}
