"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { KitSummary } from "@/lib/types";
import { BatchUpload, NewKitForm } from "@/components/new-kit-form";
import { EmptyState, ErrorBox, Spinner } from "@/components/ui";
import { StatusChip } from "@/components/status-chip";
import { useToast } from "@/components/providers";

export default function KitsPage() {
  const [kits, setKits] = useState<KitSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setKits((await api<{ kits: KitSummary[] }>("/kits")).kits);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your kits.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  // Keep polling while anything is still generating.
  useEffect(() => {
    if (!kits?.some((k) => k.status === "queued" || k.status === "running")) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [kits, load]);

  async function remove(k: KitSummary) {
    if (!confirm(`Delete "${k.title}"? This can't be undone.`)) return;
    try {
      await api(`/kits/${k.id}`, { method: "DELETE" });
      setKits((ks) => ks?.filter((x) => x.id !== k.id) ?? null);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <NewKitForm onCreated={load} />
        <BatchUpload onCreated={load} />
      </div>
      <section aria-labelledby="my-kits" className="space-y-3">
        <h2 id="my-kits" className="text-lg font-semibold">My kits</h2>
        {error && <ErrorBox message={error} action={<button className="btn-secondary" onClick={load}>Try again</button>} />}
        {!kits && !error && (
          <div className="flex items-center gap-2 text-sm text-ink-soft" role="status"><Spinner className="h-4 w-4" /> Loading…</div>
        )}
        {kits?.length === 0 && <EmptyState title="No kits yet">Paste a job description and the company's website to build your first one.</EmptyState>}
        <ul className="space-y-2">
          {kits?.map((k) => (
            <li key={k.id} className="card group flex items-start justify-between gap-2 p-3">
              <Link href={`/kits/${k.id}`} className="min-w-0 flex-1 rounded">
                <p className="truncate font-medium group-hover:text-brand">{k.title}</p>
                <p className="mt-0.5 truncate text-xs text-ink-faint">{k.company} · {k.days} day{k.days === 1 ? "" : "s"} · {new Date(k.createdAt).toLocaleDateString()}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusChip status={k.status} />
                  {k.status === "ready" && <span className="text-xs text-ink-soft">{k.questionCount} questions</span>}
                  {k.status === "failed" && <span className="truncate text-xs text-red-700">{k.error?.message}</span>}
                </div>
              </Link>
              <button className="btn-ghost px-2 text-xs" onClick={() => remove(k)} aria-label={`Delete ${k.title}`}>Delete</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
