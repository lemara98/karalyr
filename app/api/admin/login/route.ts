import { ADMIN_COOKIE, isValidAdminToken } from "@/lib/admin";
import { apiError } from "@/lib/api-helpers";

export async function POST(req: Request) {
  let token: unknown;
  try {
    ({ token } = await req.json());
  } catch {
    return apiError(400, "BadRequest", "Invalid JSON body");
  }
  if (typeof token !== "string" || !isValidAdminToken(token)) {
    return apiError(401, "Unauthorized", "Invalid admin token");
  }

  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 30}${secure}`,
      },
    }
  );
}
