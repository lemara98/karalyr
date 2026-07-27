"use client";

import { useState } from "react";

type Phase = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; id: number } | { kind: "error"; message: string };

const FIELD_CLS = "field mt-1.5 w-full";
const LABEL_CLS = "text-sm font-medium";
const HINT_CLS = "mt-1 text-xs text-[color:var(--color-text-dim)]";

export function TakedownForm({ contactEmail }: { contactEmail: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPhase({ kind: "sending" });

    const res = await fetch("/api/takedown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimant_name: form.get("name"),
        claimant_email: form.get("email"),
        claimant_org: form.get("org") || null,
        claimant_role: form.get("role"),
        work_description: form.get("work"),
        complained_of: form.get("complained_of"),
        good_faith: form.get("good_faith") === "on",
        accurate: form.get("accurate") === "on",
      }),
    }).catch(() => null);

    if (!res) {
      setPhase({ kind: "error", message: `Network error. Please email ${contactEmail} instead.` });
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPhase({ kind: "error", message: body?.message ?? `Submission failed (${res.status}).` });
      return;
    }
    setPhase({ kind: "sent", id: body.notice_id });
  }

  if (phase.kind === "sent") {
    return (
      <div className="klr-card p-6">
        <p className="font-medium text-[color:var(--klr-hi)]">Notice received.</p>
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Your reference is{" "}
          <span style={{ fontFamily: "var(--font-mono)" }}>#{phase.id}</span>. A human
          reviews it, and you&rsquo;ll get a reply at the address you gave. If you
          don&rsquo;t hear back within three working days, email{" "}
          <a className="text-[color:var(--klr-b)] hover:underline" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>{" "}
          quoting that number.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="klr-card space-y-5 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL_CLS} htmlFor="td-name">Your name</label>
          <input id="td-name" name="name" required maxLength={200} className={FIELD_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor="td-email">Email</label>
          <input id="td-email" name="email" type="email" required maxLength={320} className={FIELD_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor="td-org">Company or publisher</label>
          <input id="td-org" name="org" maxLength={200} className={FIELD_CLS} placeholder="Optional" />
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor="td-role">Your relationship to the work</label>
          <input
            id="td-role"
            name="role"
            required
            maxLength={200}
            className={FIELD_CLS}
            placeholder="Rights owner, authorised agent…"
          />
        </div>
      </div>

      <div>
        <label className={LABEL_CLS} htmlFor="td-work">Which work do you hold rights in?</label>
        <textarea id="td-work" name="work" required rows={3} maxLength={5000} className={FIELD_CLS}
          placeholder="Song title, writer(s), publisher, and any catalogue reference." />
        <p className={HINT_CLS}>Enough for us to identify the work with certainty.</p>
      </div>

      <div>
        <label className={LABEL_CLS} htmlFor="td-complained">What on Karalyr infringes it?</label>
        <textarea id="td-complained" name="complained_of" required rows={3} maxLength={5000} className={FIELD_CLS}
          placeholder="Paste the page URLs, e.g. https://karalyr.com/track/artist-title-123" />
        <p className={HINT_CLS}>URLs are best. One notice can list several.</p>
      </div>

      <div className="space-y-2.5 border-t border-white/5 pt-4">
        <label className="flex gap-2.5 text-sm">
          <input type="checkbox" name="good_faith" required className="mt-1 flex-none" />
          <span>
            I have a good-faith belief that the use complained of is not authorised by the
            rights owner, its agent, or the law.
          </span>
        </label>
        <label className="flex gap-2.5 text-sm">
          <input type="checkbox" name="accurate" required className="mt-1 flex-none" />
          <span>
            The information in this notice is accurate, and I am the rights owner or
            authorised to act on their behalf.
          </span>
        </label>
      </div>

      {phase.kind === "error" && <p className="text-sm text-red-400">{phase.message}</p>}

      <button type="submit" disabled={phase.kind === "sending"} className="btn btn-primary">
        {phase.kind === "sending" ? "Sending…" : "Send notice"}
      </button>
    </form>
  );
}
