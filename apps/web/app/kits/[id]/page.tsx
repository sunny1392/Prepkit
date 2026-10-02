"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { KitRecord } from "@/lib/types";
import { GenerationView } from "@/components/kit/generation-view";
import { KitBuilder } from "@/components/kit/kit-builder";
import { ErrorBox, Spinner } from "@/components/ui";

export default function KitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [rec, setRec] = useState<KitRecord | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    try {
      setRec((await api<{ kit: KitRecord }>(`/kits/${id}`)).kit);
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const retry = async () => {
    try {
      await api(`/kits/${id}/retry`, { method: "POST" });
      setRec((r) => (r ? { ...r, status: "queued", error: null } : r));
    } catch (e) {
      setError(e as ApiError);
    }
  };

  if (error) return <ErrorBox title={error.status === 404 ? "Kit not found" : "Couldn't load this kit"} message={error.status === 404 ? "It may have been deleted, or it belongs to another account." : error.message} action={<Link href="/kits" className="btn-secondary">Back to my kits</Link>} />;
  if (!rec) return <div className="flex items-center justify-center py-20" role="status" aria-label="Loading kit"><Spinner /></div>;
  if (rec.status !== "ready" || !rec.kit) return <GenerationView key={`${rec.id}-${rec.status === "failed" ? "f" : "r"}`} kitId={rec.id} initialStatus={rec.status} error={rec.error} onFinished={load} onRetry={retry} />;
  return <KitBuilder record={rec} />;
}
