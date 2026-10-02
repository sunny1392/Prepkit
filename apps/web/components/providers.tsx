"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";

// ---------- toasts ----------
type Toast = { id: number; kind: "info" | "error" | "success"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

// ---------- auth ----------
type User = { id: string; email: string };
interface AuthState {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User | null) => void;
}
const AuthCtx = createContext<AuthState>({ user: null, loading: true, refresh: async () => {}, logout: async () => {}, setUser: () => {} });
export const useAuth = () => useContext(AuthCtx);

export function Providers({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const refresh = useCallback(async () => {
    try {
      setUser((await api<{ user: User }>("/auth/me")).user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);
  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    router.push("/login");
  }, [router]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Any 401 mid-session (expired cookie) sends the user to sign in, keeping where they were.
  useEffect(() => {
    const onUnauth = (e: Event) => {
      const err = (e as CustomEvent<ApiError>).detail;
      setUser(null);
      push("error", err.message || "Please sign in again.");
      router.push(`/login?next=${encodeURIComponent(location.pathname)}`);
    };
    window.addEventListener("prepkit:unauthorized", onUnauth);
    return () => window.removeEventListener("prepkit:unauthorized", onUnauth);
  }, [router, push]);

  const auth = useMemo(() => ({ user, loading, refresh, logout, setUser }), [user, loading, refresh, logout]);

  return (
    <AuthCtx.Provider value={auth}>
      <ToastCtx.Provider value={push}>
        {children}
        <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              className={`pointer-events-auto max-w-md rounded-md px-4 py-2 text-sm shadow-lg ${t.kind === "error" ? "bg-red-600 text-white" : t.kind === "success" ? "bg-emerald-600 text-white" : "bg-zinc-900 text-white"}`}
            >
              {t.text}
            </div>
          ))}
        </div>
      </ToastCtx.Provider>
    </AuthCtx.Provider>
  );
}
