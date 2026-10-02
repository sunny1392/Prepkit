"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "./providers";
import { ErrorBox, Spinner } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const { user, setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = params.get("next") || "/kits";

  useEffect(() => {
    if (user) router.replace(next);
  }, [user, router, next]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: { id: string; email: string } }>(`/auth/${mode}`, { method: "POST", json: { email, password } });
      setUser(r.user);
      router.replace(next.startsWith("/") ? next : "/kits");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === "login";
  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div aria-hidden className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-brand text-lg font-bold text-white">P</div>
          <h1 className="text-2xl font-semibold">{isLogin ? "Sign in to PrepKit" : "Create your account"}</h1>
          <p className="mt-1 text-sm text-ink-soft">Paste a job description, get a prep kit built from real research.</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6" noValidate>
          {params.get("next") && !error && isLogin && <p className="text-sm text-ink-soft">Please sign in to continue.</p>}
          {error && <ErrorBox title={isLogin ? "Couldn't sign in" : "Couldn't create account"} message={error} />}
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
          </div>
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input id="password" type="password" autoComplete={isLogin ? "current-password" : "new-password"} required minLength={isLogin ? 1 : 8} value={password} onChange={(e) => setPassword(e.target.value)} className="input" aria-describedby={isLogin ? undefined : "pw-hint"} />
            {!isLogin && <p id="pw-hint" className="mt-1 text-xs text-ink-faint">At least 8 characters.</p>}
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy || !email || !password}>
            {busy && <Spinner className="h-4 w-4 text-white" />}
            {isLogin ? "Sign in" : "Create account"}
          </button>
          <p className="text-center text-sm text-ink-soft">
            {isLogin ? "New here? " : "Already have an account? "}
            <Link className="font-medium text-brand hover:underline" href={isLogin ? "/register" : "/login"}>{isLogin ? "Create an account" : "Sign in"}</Link>
          </p>
        </form>
      </div>
    </main>
  );
}
