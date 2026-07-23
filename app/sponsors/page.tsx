import type { Metadata } from "next";
import { SponsorsGrid } from "@/components/SponsorsGrid";
import { getSponsors } from "@/lib/github";

export const metadata: Metadata = {
  title: "Sponsors — Karalyr",
  description:
    "Karalyr is a solo open-source project. Support the maintainer via GitHub Sponsors, Ko-fi, or PayPal.",
};

const LINK_CLS =
  "text-[color:var(--klr-b)] underline decoration-dotted underline-offset-2 hover:no-underline";

export default async function SponsorsPage() {
  const sponsors = await getSponsors();

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <h1
          className="text-4xl font-bold tracking-[-0.025em] sm:text-5xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Backed by the <span className="brand-gradient">community</span>.
        </h1>
        <p className="mt-4 text-[color:var(--color-text-muted)]">
          Karalyr is free and open source, like the whole Karafilt family. The
          people listed below help keep the project going.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a
            href="https://github.com/sponsors/lemara98"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            Sponsor on GitHub
          </a>
          <a
            href="https://ko-fi.com/milanknezevic"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            ☕ Tip on Ko-fi
          </a>
          <a
            href="https://paypal.me/betaniatech"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Donate with PayPal
          </a>
        </div>
      </div>

      {/* Where the money goes: honest framing */}
      <div className="mx-auto mt-16 max-w-4xl">
        <h2
          className="text-xl font-semibold tracking-[-0.02em]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Where the money goes
        </h2>
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Karalyr is free to use. Donations are gifts, not purchases. They
          support the person building it.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="klr-card p-6">
            <h3
              className="text-lg font-semibold"
              style={{ fontFamily: "var(--font-display)" }}
            >
              GitHub Sponsors
            </h3>
            <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
              Recurring or one-off donations directly to the maintainer. GitHub
              covers the processing fees, so 100% reaches the developer.
            </p>
          </div>
          <div className="klr-card p-6">
            <h3
              className="text-lg font-semibold"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Ko-fi
            </h3>
            <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
              No GitHub account? Tip a coffee at{" "}
              <a
                className={LINK_CLS}
                href="https://ko-fi.com/milanknezevic"
                target="_blank"
                rel="noopener noreferrer"
              >
                ko-fi.com/milanknezevic
              </a>{" "}
              — one-off tips by card or PayPal, no account needed, and Ko-fi
              takes 0% of tips.
            </p>
          </div>
          <div className="klr-card p-6">
            <h3
              className="text-lg font-semibold"
              style={{ fontFamily: "var(--font-display)" }}
            >
              PayPal
            </h3>
            <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
              Prefer PayPal directly? Send your gift via{" "}
              <a
                className={LINK_CLS}
                href="https://paypal.me/betaniatech"
                target="_blank"
                rel="noopener noreferrer"
              >
                paypal.me/betaniatech
              </a>
              . The account belongs to{" "}
              <a
                className={LINK_CLS}
                href="https://betania.io"
                target="_blank"
                rel="noopener noreferrer"
              >
                Betania.io
              </a>
              , the maintainer&rsquo;s company — need an invoice for your
              company or venue? Email{" "}
              <a className={LINK_CLS} href="mailto:milan.knezevic@betania.io">
                milan.knezevic@betania.io
              </a>{" "}
              and it&rsquo;s no problem.
            </p>
          </div>
        </div>
      </div>

      {/* GitHub Sponsors list */}
      <div className="mx-auto mt-16 max-w-4xl">
        <h2
          className="text-xl font-semibold tracking-[-0.02em]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          GitHub Sponsors
        </h2>
        <p className="mt-2 text-sm text-[color:var(--color-text-dim)]">
          Ordered by amount, pulled live from{" "}
          <a
            className={LINK_CLS}
            href="https://github.com/sponsors/lemara98"
            target="_blank"
            rel="noopener noreferrer"
          >
            github.com/sponsors/lemara98
          </a>
          . Sponsors who chose to stay private are thanked anonymously.
        </p>
        <div className="mt-4">
          <SponsorsGrid sponsors={sponsors} />
        </div>
      </div>
    </div>
  );
}
