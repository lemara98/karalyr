import type { Metadata } from "next";
import { ContributorsGrid } from "@/components/ContributorsGrid";
import { getContributors } from "@/lib/github";

export const metadata: Metadata = {
  title: "Contributors — Karalyr",
  description:
    "The people who build Karalyr. Karalyr is open source, and every contribution, big or small, keeps it going.",
};

export default async function ContributorsPage() {
  const contributors = await getContributors();

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <h1
          className="text-4xl font-bold tracking-[-0.025em] sm:text-5xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Built by <span className="brand-gradient">contributors</span>.
        </h1>
        <p className="mt-4 text-[color:var(--color-text-muted)]">
          Karalyr is open source. Everyone below has pushed code that made it
          better, ordered by commits to the repository. Thank you.
        </p>
        <div className="mt-8 flex justify-center">
          <a
            href="https://github.com/lemara98/karalyr"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Contribute on GitHub
          </a>
        </div>
      </div>

      <div className="mx-auto mt-14 max-w-4xl">
        <ContributorsGrid contributors={contributors} />
      </div>
    </div>
  );
}
