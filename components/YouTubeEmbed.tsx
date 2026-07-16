/**
 * Static YouTube iframe for pages with a linked video but no lyrics to
 * sync — no IFrame API, nothing to drive. The synced player lives in
 * YouTubeLyricsPlayer.
 */
export function YouTubeEmbed({ videoId }: { videoId: string }) {
  return (
    <div className="klr-card relative aspect-video overflow-hidden">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0`}
        title="YouTube player"
        loading="lazy"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        className="absolute inset-0 h-full w-full"
        style={{ border: 0 }}
      />
    </div>
  );
}
