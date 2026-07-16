import { Contribute } from "@/components/Contribute";
import { localAlignAvailable } from "@/lib/align-local";

export default function ContributePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <p className="klr-eyebrow">THE STUDIO</p>
      <h1
        className="mt-2 text-3xl font-bold tracking-[-0.02em]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Sync a song
      </h1>
      <p className="mb-7 mt-2 text-sm text-[color:var(--color-text-muted)]">
        Paste an LRC / Enhanced LRC / UltraStar file, or tap out line timing
        with the simulator. Every submission becomes a new revision — nothing
        is overwritten.
      </p>
      <Contribute aiAlignEnabled={localAlignAvailable()} />
    </div>
  );
}
