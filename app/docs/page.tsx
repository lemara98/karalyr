const BASE = "http://localhost:3000";

function Endpoint({
  method,
  path,
  children,
}: {
  method: string;
  path: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-mono)" }}>
        <span
          className={`mr-2.5 rounded-full border px-2 py-0.5 text-[11px] ${
            method === "GET"
              ? "border-sky-400/30 bg-sky-400/10 text-sky-300"
              : "border-[color:color-mix(in_srgb,var(--klr-b)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--klr-b)_12%,transparent)] text-[color:var(--klr-hi)]"
          }`}
        >
          {method}
        </span>
        {path}
      </h2>
      <div className="space-y-2.5 text-sm leading-relaxed text-[color:var(--color-text-muted)]">
        {children}
      </div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre
      className="overflow-x-auto rounded-xl border border-white/10 bg-black/25 p-3.5 text-xs leading-relaxed text-[color:var(--color-text)]"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {children}
    </pre>
  );
}

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-9 px-6 py-10">
      <div>
        <p className="klr-eyebrow">API</p>
        <h1
          className="mt-2 text-3xl font-bold tracking-[-0.02em]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Free, open, LRCLIB-compatible
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[color:var(--color-text-muted)]">
          Public JSON API, CORS enabled for all origins, no keys. The request
          and response shapes are LRCLIB-compatible: an LRCLIB client works by
          swapping the base URL. Karaoke-specific data lives in the extra{" "}
          <code>karalyr</code> object.
        </p>
      </div>

      <Endpoint method="GET" path="/api/get">
        <p>
          Best lyrics for an exact track match. Params: <code>artist_name</code>,{" "}
          <code>track_name</code> (required), <code>album_name</code>,{" "}
          <code>duration</code> (seconds, matched ±2s). On a miss it returns 404
          and triggers a background import from LRCLIB — retry once after a
          couple of seconds.
        </p>
        <Code>{`curl "${BASE}/api/get?artist_name=Neon%20Practice&track_name=Refactor%20My%20Heart&duration=212"`}</Code>
        <p>
          Response: LRCLIB fields (<code>plainLyrics</code>,{" "}
          <code>syncedLyrics</code> — Enhanced LRC when word timing exists) plus{" "}
          <code>karalyr: {"{ payload, tier, source, revision_id, has_word_timing }"}</code>.
        </p>
      </Endpoint>

      <Endpoint method="GET" path="/api/get/:track_id">
        <p>Same response by internal track id.</p>
        <Code>{`curl "${BASE}/api/get/2"`}</Code>
      </Endpoint>

      <Endpoint method="GET" path="/api/search">
        <p>
          Fuzzy full-text search over artist / title / album. Params:{" "}
          <code>q</code>, or <code>artist_name</code> / <code>track_name</code> /{" "}
          <code>album_name</code>.
        </p>
        <Code>{`curl "${BASE}/api/search?q=refactor"`}</Code>
      </Endpoint>

      <Endpoint method="POST" path="/api/request-challenge">
        <p>
          Proof-of-work challenge for publishing. Find a <code>nonce</code> such
          that <code>sha256(prefix + nonce)</code> (hex) is ≤ <code>target</code>.
          Challenges expire after 10 minutes and are single-use.
        </p>
        <Code>{`curl -X POST "${BASE}/api/request-challenge"
# → { "prefix": "…", "target": "00001fff…" }`}</Code>
      </Endpoint>

      <Endpoint method="POST" path="/api/publish">
        <p>
          Submit lyrics as a new revision (nothing is overwritten). Body: track
          metadata + either a structured <code>payload</code> or <code>raw</code>{" "}
          text with <code>format</code> (<code>lrc</code>,{" "}
          <code>enhanced_lrc</code>, <code>ultrastar</code>), plus the solved
          challenge. If the track&apos;s current best revision is verified, the
          submission enters <code>pending_review</code>.
        </p>
        <Code>{`curl -X POST "${BASE}/api/publish" -H "Content-Type: application/json" -d '{
  "challenge": { "prefix": "<prefix>", "nonce": "<nonce>" },
  "artist_name": "Artist",
  "track_name": "Song",
  "duration": 201,
  "raw": "[00:12.00]First line\\n[00:15.30]Second line",
  "format": "lrc"
}'`}</Code>
      </Endpoint>

      <Endpoint method="POST" path="/api/signal">
        <p>
          Quality feedback for a revision. Types: <code>explicit_up</code>,{" "}
          <code>explicit_down</code>, <code>clean_playthrough</code>,{" "}
          <code>offset_correction</code> (with <code>value</code> = offset in
          ms, positive = lyrics should appear later). Three agreeing offset
          reports auto-create a corrected revision; three positive signals
          promote a revision one tier.
        </p>
        <Code>{`curl -X POST "${BASE}/api/signal" -H "Content-Type: application/json" \\
  -d '{ "revision_id": 2, "type": "explicit_up" }'`}</Code>
      </Endpoint>

      <Endpoint method="POST" path="/api/observe">
        <p>
          Listen-along alignment: karaoke clients (the Karafilt extension)
          submit per-line word-timing observations measured during normal
          playback. Body: track metadata + <code>line_start_ms</code>,{" "}
          <code>line_text</code>, <code>words</code> and a{" "}
          <code>confidence</code> (0–1). Once enough lines of a track are
          covered, observations are median-merged and published automatically
          as an <code>auto_aligned</code> revision. Unknown tracks return 202
          and trigger a LRCLIB import.
        </p>
        <Code>{`curl -X POST "${BASE}/api/observe" -H "Content-Type: application/json" -d '{
  "artist_name": "Artist", "track_name": "Song", "duration": 195,
  "line_start_ms": 4000, "line_text": "First line here",
  "words": [ { "text": "First", "start_ms": 4000, "end_ms": 4400 },
             { "text": "line", "start_ms": 4400, "end_ms": 4800 },
             { "text": "here", "start_ms": 4800, "end_ms": 5400 } ],
  "confidence": 0.7
}'`}</Code>
      </Endpoint>

      <Endpoint method="GET" path="/api/track/:id/revisions">
        <p>Full revision history for a track (public transparency).</p>
        <Code>{`curl "${BASE}/api/track/2/revisions"`}</Code>
      </Endpoint>

      <section className="space-y-2.5 text-sm leading-relaxed text-[color:var(--color-text-muted)]">
        <h2 className="text-base font-semibold text-[color:var(--color-text)]">Tiers</h2>
        <p>
          Every revision has a tier:{" "}
          <code>imported &lt; auto_aligned &lt; community &lt; verified</code>.
          The API always serves the active revision with the highest tier; ties
          break by community signals, then recency.
        </p>
      </section>
    </div>
  );
}
