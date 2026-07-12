import { Contribute } from "@/components/Contribute";

export default function ContributePage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Contribute lyrics</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Paste an LRC / Enhanced LRC / UltraStar file, or tap out line timing
        with the simulator. Every submission becomes a new revision — nothing
        is overwritten.
      </p>
      <Contribute />
    </div>
  );
}
