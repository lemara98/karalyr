import { getDb } from "@/lib/db/client";
import { LIBRARY_PAGE_SIZE, listSyncedTracksPage } from "@/lib/db/queries";
import { apiError, corsOptions, json } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/**
 * /api/library?cursor=<track id>&limit=N - one page of the library browser.
 * `cursor` is the `nextCursor` of the previous page; omit it for the first.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;

  const rawCursor = params.get("cursor");
  let cursor: number | null = null;
  if (rawCursor !== null && rawCursor !== "") {
    cursor = Number(rawCursor);
    if (!Number.isSafeInteger(cursor) || cursor <= 0) {
      return apiError(400, "BadRequest", "cursor must be a positive integer track id");
    }
  }

  const rawLimit = params.get("limit");
  let limit = LIBRARY_PAGE_SIZE;
  if (rawLimit !== null && rawLimit !== "") {
    limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return apiError(400, "BadRequest", "limit must be an integer between 1 and 100");
    }
  }

  const rawLang = params.get("lang");
  let language: string | null = null;
  if (rawLang !== null && rawLang !== "") {
    if (!/^[a-z]{2,3}$/.test(rawLang)) {
      return apiError(400, "BadRequest", "lang must be an ISO 639-1 code");
    }
    language = rawLang;
  }

  const page = await listSyncedTracksPage(getDb(), { cursor, limit, language });
  return json(page);
}

export const OPTIONS = corsOptions;
