export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Karalyr-Debug-Fp",
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: { ...CORS_HEADERS, ...init.headers },
  });
}

/** LRCLIB-style error body. */
export function apiError(status: number, name: string, message: string): Response {
  return json({ code: status, name, message }, { status });
}

/** Shared OPTIONS handler for CORS preflight. */
export function corsOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
