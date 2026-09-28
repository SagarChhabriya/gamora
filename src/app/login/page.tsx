"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

import { Alert, Button, Eyebrow, Field, Input } from "@/components/ui";
import { saveSession } from "@/lib/auth/client";
import type { SessionPayload } from "@/lib/auth/supabase-auth";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(mode === "signin" ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ...(mode === "signup" && name ? { display_name: name } : {}) }),
      });
      const payload = (await response.json()) as SessionPayload & { error?: string };
      if (!response.ok || !payload.access_token) throw new Error(payload.error ?? "Sign in failed");
      saveSession(payload);
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-paper px-4 py-10 text-ink lg:grid-cols-2">
      <section className="flex flex-col justify-between gap-10 p-2 sm:p-8">
        <p className="text-base font-semibold uppercase tracking-[0.22em]">Gamora</p>
        <div>
          <Eyebrow>Learning that listens</Eyebrow>
          <h1 className="mt-5 max-w-xl text-5xl font-semibold leading-[0.95] tracking-[-0.04em] sm:text-7xl">
            Any document. Your own journey.
          </h1>
          <p className="mt-6 max-w-md text-lg leading-7 text-ink/70">
            Missions built from your material. The guide adapts as you go and tracks progress from what you do, not from tests.
          </p>
        </div>
        <p className="text-xs uppercase tracking-[0.14em] text-ink/55">English / Roman Urdu / Voice or text</p>
      </section>

      <section className="flex items-center justify-center">
        <form onSubmit={submit} className="w-full max-w-md space-y-5 border border-ink/15 bg-panel p-6 sm:p-8" aria-label={mode === "signin" ? "Sign in" : "Create account"}>
          <div className="grid grid-cols-2 border-b border-ink/20" role="tablist">
            {(["signin", "signup"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={mode === item}
                onClick={() => setMode(item)}
                className={`border-b-2 px-2 py-3 text-sm font-semibold ${mode === item ? "border-accent text-accent" : "border-transparent text-ink/55"}`}
              >
                {item === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
          {mode === "signup" && (
            <Field label="Your name">
              <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={60} />
            </Field>
          )}
          <Field label="Email">
            <Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </Field>
          <Field label="Password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
            <Input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
          </Field>
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "One moment..." : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
