import { LoginForm } from "@/components/LoginForm";

const ERROR_COPY: Record<string, string> = {
  verification_failed: "That sign-in link didn't work. Try again.",
  oauth_failed: "Sign-in with that provider failed. Try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const next = rawNext?.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1
        className="text-3xl font-bold tracking-[-0.02em]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Sign in
      </h1>
      <p className="mb-7 mt-2 text-sm text-[color:var(--color-text-muted)]">
        One account across the Karafilt family.
      </p>
      <LoginForm next={next} initialError={error ? ERROR_COPY[error] ?? error : undefined} />
    </div>
  );
}
