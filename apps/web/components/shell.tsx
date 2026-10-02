"use client";
import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./providers";
import { Spinner } from "./ui";

/** Authenticated layout: redirects signed-out visitors to /login. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [loading, user, router, path]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading">
        <Spinner />
      </div>
    );
  }
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/kits" className="flex items-center gap-2 font-semibold">
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-brand text-sm text-white">P</span>
            PrepKit
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/kits" className="btn-ghost">My kits</Link>
            <span className="hidden text-ink-faint sm:inline" title={user.email}>{user.email}</span>
            <button onClick={logout} className="btn-ghost">Sign out</button>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
