"use client";

import { useActionState } from "react";
import { login, signInWithOAuth, type AuthState } from "@/app/login/actions";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(login, {});
  const error = state.error ?? initialError;

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <input
          className="field w-full"
          type="email"
          name="email"
          placeholder="Email"
          autoComplete="email"
          required
        />
        <input
          className="field w-full"
          type="password"
          name="password"
          placeholder="Password"
          autoComplete="current-password"
          required
        />
        <button type="submit" className="btn btn-primary w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {/* Separate form: OAuth buttons can't nest inside the password form. */}
      <form action={signInWithOAuth} className="grid grid-cols-2 gap-3">
        <input type="hidden" name="next" value={next} />
        <button type="submit" name="provider" value="google" className="btn btn-secondary">
          Google
        </button>
        <button type="submit" name="provider" value="github" className="btn btn-secondary">
          GitHub
        </button>
      </form>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <p className="text-xs text-[color:var(--color-text-dim)]">
        Karalyr uses your Karafilt account. No account yet?{" "}
        <a
          href="https://karafilt.com/signup"
          className="text-[color:var(--klr-b)] hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          Create one on karafilt.com
        </a>
        .
      </p>
    </div>
  );
}
