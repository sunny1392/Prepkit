"use client";
import { useEffect, useId, useRef } from "react";

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-brand ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <h3 className="font-medium">{title}</h3>
      {children && <div className="max-w-md text-sm text-ink-soft">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorBox({ title = "Something went wrong", message, action }: { title?: string; message: string; action?: React.ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-medium">{title}</p>
      <p className="mt-1">{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn"; children: React.ReactNode }) {
  return <div className={`rounded-md border p-3 text-sm ${tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-indigo-100 bg-brand-soft text-indigo-900"}`}>{children}</div>;
}

const PRIORITY_STYLE = { must: "bg-red-50 text-red-700 ring-1 ring-red-200", nice: "bg-zinc-100 text-ink-soft ring-1 ring-zinc-200" } as const;
export const PriorityChip = ({ p }: { p: "must" | "nice" }) => <span className={`chip ${PRIORITY_STYLE[p]}`}>{p === "must" ? "Must" : "Nice"}</span>;

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={id} onClose={onClose} className="w-[min(32rem,calc(100vw-2rem))] rounded-lg p-0 shadow-xl backdrop:bg-black/40">
      <div className="p-5">
        <h2 id={id} className="text-lg font-semibold">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </dialog>
  );
}
