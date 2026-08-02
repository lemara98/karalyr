import type { Metadata } from "next";
import Link from "next/link";
import { TAKEDOWN_EMAIL } from "@/lib/takedown";
import { TakedownForm } from "@/components/TakedownForm";

export const metadata: Metadata = {
  title: "Report a rights issue - Karalyr",
  description:
    "How to ask Karalyr to remove lyrics you hold the rights to, what happens next, and the repeat-infringer policy.",
};

const LINK_CLS =
  "text-[color:var(--klr-b)] underline decoration-dotted underline-offset-2 hover:no-underline";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-xl font-semibold tracking-[-0.01em]" style={{ fontFamily: "var(--font-display)" }}>
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-[color:var(--color-text-muted)]">
        {children}
      </div>
    </section>
  );
}

export default function TakedownPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <p className="klr-eyebrow">RIGHTS</p>
      <h1
        className="mt-2 text-4xl font-bold tracking-[-0.025em]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Report a rights issue
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--color-text-muted)]">
        If you hold the rights to lyrics published here and want them removed, tell us
        and we will remove them. You do not need an account, a lawyer, or a particular
        form of words. The fastest route is the form at the bottom of this page; email{" "}
        <a className={LINK_CLS} href={`mailto:${TAKEDOWN_EMAIL}`}>
          {TAKEDOWN_EMAIL}
        </a>{" "}
        works just as well and is never rate limited.
      </p>

      <Section title="What Karalyr publishes">
        <p>
          Karalyr is a free, non-commercial, open-source database of word-synced
          karaoke lyrics. Two things sit in it: <strong>timing data</strong> - the
          millisecond positions of each word within a recording - and the{" "}
          <strong>lyric text</strong> those timings point at.
        </p>
        <p>
          No audio is stored, served, or transmitted by this site. Alignment happens on
          a contributor&rsquo;s own machine against audio they hold, and only the
          timings leave it.
        </p>
        <p>
          Lyric text is submitted by contributors, not compiled by the operator. We
          don&rsquo;t assert ownership of any lyrics here, and crediting a writer is not
          a claim of licence - where a rightsholder objects, the answer is removal, not
          argument.
        </p>
      </Section>

      <Section title="What to include">
        <p>Whether you use the form or email, we need four things:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>Who you are, and your relationship to the work - owner or authorised agent.</li>
          <li>Which work you hold rights in, identified clearly enough that we can be sure.</li>
          <li>What on Karalyr you say infringes it. Page URLs are ideal.</li>
          <li>An email address we can reply to.</li>
        </ul>
        <p>
          You will also be asked to state that you believe in good faith that the use is
          unauthorised, and that what you have told us is accurate. That is the
          substance of a notice under the DMCA and equivalent regimes; we don&rsquo;t
          require any particular format beyond it.
        </p>
      </Section>

      <Section title="What happens next">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Acknowledged within 3 working days</strong>, with a reference number.
          </li>
          <li>
            <strong>Removed on acceptance.</strong> The lyric text is purged from the
            database, not merely hidden - the revision row survives as a record of what
            was removed and why, with no content in it.
          </li>
          <li>
            <strong>The song&rsquo;s entry may remain</strong> with its title, artist and
            duration but no lyrics. That metadata is factual information about a
            recording. If you believe it should also go, say so and we will discuss it.
          </li>
          <li>
            <strong>If we decline</strong> - normally because the work is public domain,
            openly licensed, or submitted by its own rightsholder - we will tell you why
            rather than ignore you.
          </li>
        </ul>
      </Section>

      <Section title="Repeat-infringer policy">
        <p>
          Contributors whose submissions are repeatedly removed on valid notices are
          blocked from publishing. Karalyr accepts contributions without accounts, so a
          block is applied to the submitter identifier attached to each revision. It is
          an imperfect identifier and we know it can be evaded; we act on what we can
          see.
        </p>
        <p>
          Blocks are recorded with a reason and the number of removals that preceded
          them. If you have been blocked and think it&rsquo;s wrong, write to{" "}
          <a className={LINK_CLS} href={`mailto:${TAKEDOWN_EMAIL}`}>
            {TAKEDOWN_EMAIL}
          </a>
          .
        </p>
      </Section>

      <Section title="If we removed something wrongly">
        <p>
          Contributors whose work was removed can object to the same address. Tell us
          what was removed and why you believe you hold the rights or that the work is
          free to use - public-domain material, an open licence, or your own song. If
          you&rsquo;re right, we restore it and record that too.
        </p>
      </Section>

      <Section title="Contributing lyrics you don't own">
        <p>
          Please don&rsquo;t. Karalyr wants public-domain and traditional material,
          openly licensed work, and songs submitted by the people who wrote them. If
          you&rsquo;re unsure whether something qualifies, ask before publishing - the{" "}
          <Link className={LINK_CLS} href="/contribute">
            Studio
          </Link>{" "}
          is not a place to launder a catalogue.
        </p>
      </Section>

      <div className="mt-14 border-t border-white/5 pt-10">
        <h2
          className="text-xl font-semibold tracking-[-0.01em]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Send a notice
        </h2>
        <p className="mb-5 mt-2 text-[15px] text-[color:var(--color-text-muted)]">
          Goes straight to the operator. Nothing is removed automatically - a person
          reads every notice.
        </p>
        <TakedownForm contactEmail={TAKEDOWN_EMAIL} />
      </div>
    </div>
  );
}
