/**
 * Standalone Spotify player card. Spotify's embed only reliably plays
 * previews (full tracks need a logged-in premium session inside the iframe),
 * so it is never wired into the lyric clock — see YouTubeLyricsPlayer for
 * the synced path.
 */
export function SpotifyEmbed({ spotifyTrackId }: { spotifyTrackId: string }) {
  return (
    <div className="space-y-2">
      <div className="klr-card overflow-hidden">
        <iframe
          src={`https://open.spotify.com/embed/track/${spotifyTrackId}`}
          width="100%"
          height={152}
          loading="lazy"
          title="Spotify player"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          className="block"
          style={{ border: 0 }}
        />
      </div>
      <p className="text-xs text-[color:var(--color-text-dim)]">
        Spotify preview — not synced to the lyrics below.
      </p>
    </div>
  );
}
