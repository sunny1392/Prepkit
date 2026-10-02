"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { KitStatus, ProgressEvent } from "@/lib/types";
import { ErrorBox, Spinner } from "../ui";

const STEPS: Array<{ id: string; label: string }> = [
  { id: "extract-requirements", label: "Read the job description" },
  { id: "crawl-company", label: "Crawl the company site" },
  { id: "search-discussion", label: "Search public interview discussion" },
  { id: "company-brief", label: "Write the company brief" },
  { id: "questions:technical", label: "Technical questions" },
  { id: "questions:behavioural", label: "Behavioural questions" },
  { id: "questions:system-design", label: "System design questions" },
  { id: "questions:company-fit", label: "Company-fit questions" },
  { id: "coverage", label: "Check coverage & fill gaps" },
  { id: "flashcards", label: "Flashcards" },
  { id: "schedule", label: "Build the schedule" },
  { id: "validate-kit", label: "Validate the kit" },
];

const ICON: Record<string, React.ReactNode> = {
  done: <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-[11px] text-white" aria-hidden>✓</span>,
  failed: <span className="grid h-5 w-5 place-items-center rounded-full bg-red-500 text-[11px] text-white" aria-hidden>!</span>,
  skipped: <span className="grid h-5 w-5 place-items-center rounded-full bg-zinc-300 text-[11px] text-white" aria-hidden>–</span>,
  running: <Spinner className="h-5 w-5" />,
  pending: <span className="block h-5 w-5 rounded-full border-2 border-zinc-200" aria-hidden />,
};

/** Live progress for a kit being generated: polls /status and renders each pipeline step with its latest message. */
export function GenerationView({ kitId, initialStatus, onFinished, onRetry, error }: { kitId: string; initialStatus: KitStatus; onFinished: () => void; onRetry: () => void; error: { code: string; message: string } | null }) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [status, setStatus] = useState<KitStatus>(initialStatus);
  const [err, setErr] = useState(error);
  const [elapsed, setElapsed] = useState(0);
  const count = useRef(0);
  const started = useRef(Date.now());

  useEffect(() => {
    let stop = false;
    let failures = 0;
    async function tick() {
      try {
        const r = await api<{ status: KitStatus; error: typeof error; events: ProgressEvent[]; eventCount: number }>(`/kits/${kitId}/status?since=${count.current}`);
        failures = 0;
        count.current = r.eventCount;
        if (r.events.length) setEvents((e) => [...e, ...r.events]);
        setStatus(r.status);
        setErr(r.error);
        if (r.status === "ready") return onFinished();
        if (r.status === "failed") return;
      } catch {
        failures++;
      }
      if (!stop) setTimeout(tick, failures ? Math.min(10_000, 1500 * 2 ** failures) : 1500);
    }
    tick();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started.current) / 1000)), 1000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [kitId, onFinished]);

  const latest = new Map<string, ProgressEvent>();
  for (const e of events) latest.set(e.step, e);
  const currentlyRunning = [...latest.values()].filter((e) => e.status === "running").map((e) => e.step);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">{status === "failed" ? "Generation failed" : status === "queued" ? "Waiting to start…" : "Researching and building your kit"}</h1>
          {status !== "failed" && <span className="text-sm tabular-nums text-ink-faint" aria-hidden>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>}
        </div>
        {status !== "failed" && <p className="mt-1 text-sm text-ink-soft">Usually 1–3 minutes on free-tier models. You can leave this page — it keeps going and the kit will be in your list.</p>}
        <ol className="mt-5 space-y-3" aria-live="polite">
          {STEPS.map((s) => {
            const e = latest.get(s.id);
            const st = e?.status ?? (status === "failed" ? "skipped" : "pending");
            return (
              <li key={s.id} className="flex gap-3">
                <span className="mt-0.5 shrink-0">{ICON[st === "running" && !currentlyRunning.includes(s.id) ? "done" : st]}</span>
                <div className="min-w-0">
                  <p className={`text-sm ${st === "pending" ? "text-ink-faint" : "font-medium"}`}>{s.label}</p>
                  {e && <p className={`break-words text-xs ${st === "failed" ? "text-red-700" : "text-ink-soft"}`}>{e.message}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      {status === "failed" && (
        <ErrorBox
          title="We couldn't build this kit"
          message={`${err?.message ?? "Unknown error."}${err?.code?.startsWith("LLM") ? " The AI provider is unavailable or out of free quota right now — retrying in a few minutes usually works." : ""}`}
          action={<button className="btn-primary" onClick={onRetry}>Try again</button>}
        />
      )}
    </div>
  );
}
