"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { parseBatchFile, type BatchCase } from "@/lib/csv";
import type { KitSummary } from "@/lib/types";
import { useToast } from "./providers";
import { ErrorBox, Notice, Spinner } from "./ui";

const MAX_DAYS = 90;

export function NewKitForm({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [jd, setJd] = useState("");
  const [url, setUrl] = useState("");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupe, setDupe] = useState<KitSummary | null>(null);

  async function submit(force = false) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ kit: KitSummary; deduped: boolean }>("/kits", { method: "POST", json: { jd, company_url: url, days, force } });
      if (r.deduped) {
        setDupe(r.kit);
        return;
      }
      toast("success", "Kit queued — researching now");
      onCreated();
      router.push(`/kits/${r.kit.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the kit.");
    } finally {
      setBusy(false);
    }
  }

  const tooShort = jd.trim().length < 10;
  return (
    <form
      className="card space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      aria-labelledby="new-kit-title"
    >
      <h2 id="new-kit-title" className="text-lg font-semibold">New prep kit</h2>
      {error && <ErrorBox message={error} />}
      {dupe && (
        <Notice tone="warn">
          You already have a kit for this posting ({dupe.status === "ready" ? "ready" : dupe.status}).
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => router.push(`/kits/${dupe.id}`)}>Open existing kit</button>
            <button type="button" className="btn-secondary" onClick={() => { setDupe(null); submit(true); }}>Generate a fresh one</button>
          </div>
        </Notice>
      )}
      <div>
        <label htmlFor="jd" className="label">Job description</label>
        <textarea id="jd" className="input min-h-[12rem] font-mono text-[13px]" placeholder="Paste the full job posting here…" value={jd} onChange={(e) => { setJd(e.target.value); setDupe(null); }} aria-describedby="jd-help" />
        <p id="jd-help" className="mt-1 text-xs text-ink-faint">{jd.length.toLocaleString()} characters. Paste the text — job boards aren't fetched.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <div>
          <label htmlFor="url" className="label">Company website</label>
          <input id="url" className="input" type="text" inputMode="url" placeholder="https://company.com" value={url} onChange={(e) => { setUrl(e.target.value); setDupe(null); }} />
        </div>
        <div>
          <label htmlFor="days" className="label">Days until interview</label>
          <input id="days" className="input" type="number" min={1} max={MAX_DAYS} value={days} onChange={(e) => setDays(Math.max(1, Math.min(MAX_DAYS, Number(e.target.value) || 1)))} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="submit" className="btn-primary" disabled={busy || tooShort || !url.trim()}>
          {busy && <Spinner className="h-4 w-4 text-white" />}
          Build my kit
        </button>
      </div>
    </form>
  );
}

export function BatchUpload({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [cases, setCases] = useState<BatchCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [defaultDays, setDefaultDays] = useState(7);

  async function onFile(f: File | undefined) {
    setError(null);
    setCases(null);
    if (!f) return;
    if (f.size > 1_000_000) return setError("File is larger than 1 MB.");
    try {
      setCases(parseBatchFile(f.name, await f.text(), defaultDays));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit() {
    if (!cases) return;
    setBusy(true);
    try {
      const r = await api<{ results: Array<{ ok: boolean; deduped?: boolean; error?: { message: string } }> }>("/kits/batch", { method: "POST", json: { cases } });
      const ok = r.results.filter((x) => x.ok && !x.deduped).length;
      const dup = r.results.filter((x) => x.deduped).length;
      const bad = r.results.filter((x) => !x.ok);
      toast(bad.length ? "error" : "success", `${ok} kit(s) queued${dup ? `, ${dup} already existed` : ""}${bad.length ? `, ${bad.length} rejected: ${bad[0].error?.message}` : ""}`);
      setCases(null);
      if (input.current) input.current.value = "";
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3 p-5" aria-labelledby="batch-title">
      <h2 id="batch-title" className="font-semibold">Preparing for several roles?</h2>
      <p className="text-sm text-ink-soft">
        Upload a <code>.json</code> array of <code>{"{ jd, company_url, days }"}</code> or a <code>.csv</code> with <code>jd</code>, <code>company_url</code> and optional <code>days</code> columns.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="batch-file" className="label">File</label>
          <input id="batch-file" ref={input} type="file" accept=".json,.csv,application/json,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm" />
        </div>
        <div className="w-28">
          <label htmlFor="batch-days" className="label">Default days</label>
          <input id="batch-days" type="number" min={1} max={MAX_DAYS} className="input" value={defaultDays} onChange={(e) => setDefaultDays(Math.max(1, Math.min(MAX_DAYS, Number(e.target.value) || 1)))} />
        </div>
      </div>
      {error && <ErrorBox title="Couldn't read that file" message={error} />}
      {cases && (
        <div className="space-y-2">
          <ul className="max-h-48 divide-y divide-zinc-100 overflow-auto rounded border border-zinc-200 text-sm">
            {cases.map((c, i) => (
              <li key={i} className="flex justify-between gap-3 px-3 py-2">
                <span className="truncate">{c.jd.split("\n")[0]}</span>
                <span className="shrink-0 text-ink-faint">{c.company_url} · {c.days}d</span>
              </li>
            ))}
          </ul>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy && <Spinner className="h-4 w-4 text-white" />}Create {cases.length} kit(s)
          </button>
        </div>
      )}
    </section>
  );
}
