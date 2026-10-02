"use client";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Kit, KitRecord } from "@/lib/types";
import { useKitEditor, type SaveState } from "@/lib/use-kit-editor";
import { useToast } from "../providers";
import { Notice } from "../ui";
import { OverviewTab } from "./overview-tab";
import { QuestionsTab } from "./questions-tab";
import { FlashcardsTab } from "./flashcards-tab";
import { ScheduleTab } from "./schedule-tab";
import { PracticeTab, usePractice } from "./practice-tab";
import { ReadinessTab } from "./readiness-tab";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "questions", label: "Questions" },
  { id: "flashcards", label: "Flashcards" },
  { id: "schedule", label: "Schedule" },
  { id: "practice", label: "Practice" },
  { id: "readiness", label: "Readiness" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function SaveIndicator({ state, error }: { state: SaveState; error: string | null }) {
  const map: Record<SaveState, [string, string]> = {
    saved: ["All changes saved", "text-ink-faint"],
    saving: ["Saving…", "text-ink-soft"],
    conflict: ["Merging with newer changes…", "text-amber-700"],
    error: [`Not saved: ${error ?? "error"}`, "text-red-700"],
  };
  const [text, cls] = map[state];
  return <span role="status" className={`text-xs ${cls}`}>{text}</span>;
}

export function KitBuilder({ record }: { record: KitRecord }) {
  const editor = useKitEditor(record.id, { kit: record.kit as Kit, version: record.version });
  const { kit, dispatch } = editor;
  const toast = useToast();
  const practice = usePractice(record.id);
  const [tab, setTab] = useState<TabId>("overview");
  const [regenerating, setRegenerating] = useState<Set<string>>(new Set());
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const regenerate = useCallback(
    async (section: string, force = false) => {
      setRegenerating((s) => new Set(s).add(section));
      try {
        const r = await api<{ kit: Kit; version: number; kept: number; added: number }>(`/kits/${record.id}/regenerate`, { method: "POST", json: { section, force } });
        editor.adoptServerKit(r.kit, r.version);
        toast("success", section === "schedule" ? "Schedule rebuilt" : `Regenerated — ${r.added} new, ${r.kept} of yours kept`);
        practice.load();
      } catch (e) {
        toast("error", e instanceof ApiError ? e.message : "Regeneration failed.");
      } finally {
        setRegenerating((s) => {
          const n = new Set(s);
          n.delete(section);
          return n;
        });
      }
    },
    [record.id, editor, toast, practice],
  );

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const n = TABS.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  const uncoveredMust = kit.role.requirements.filter((r) => r.priority === "must" && !kit.questions.some((q) => q.requirement_ids.includes(r.id)));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/kits" className="text-sm text-ink-soft hover:text-ink">← My kits</Link>
          <h1 className="mt-1 truncate text-2xl font-semibold">{kit.role.title || "Interview prep kit"}</h1>
          <p className="text-sm text-ink-soft">
            {kit.source.company || kit.source.company_url} · {kit.schedule.days_available} day plan · {kit.questions.length} questions · {kit.flashcards.length} cards
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator state={editor.saveState} error={editor.lastError} />
          <button className="btn-secondary" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      {uncoveredMust.length > 0 && (
        <Notice tone="warn">
          {uncoveredMust.length} must-have requirement(s) now have no question: {uncoveredMust.map((r) => r.text).join("; ")}. Add one, link an existing question, or regenerate a category.
        </Notice>
      )}

      <div role="tablist" aria-label="Kit sections" className="-mx-4 flex gap-1 overflow-x-auto border-b border-zinc-200 px-4 print:hidden">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onKeyDown={(e) => onTabKey(e, i)}
            onClick={() => setTab(t.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === t.id ? "border-brand text-brand" : "border-transparent text-ink-soft hover:text-ink"}`}
          >
            {t.label}
            {t.id === "questions" && regenerating.size > 0 && [...regenerating].some((s) => s.startsWith("questions:")) && <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand" aria-label="regenerating" />}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="focus:outline-none">
        {tab === "overview" && <OverviewTab kit={kit} dispatch={dispatch} busy={regenerating.has("company_brief")} onRegenerate={regenerate} />}
        {tab === "questions" && <QuestionsTab kit={kit} dispatch={dispatch} regenerating={regenerating} onRegenerate={(s) => regenerate(s)} />}
        {tab === "flashcards" && <FlashcardsTab kit={kit} dispatch={dispatch} busy={regenerating.has("flashcards")} onRegenerate={() => regenerate("flashcards")} />}
        {tab === "schedule" && <ScheduleTab kit={kit} dispatch={dispatch} busy={regenerating.has("schedule")} onRegenerate={() => regenerate("schedule")} />}
        {tab === "practice" && <PracticeTab kit={kit} kitId={record.id} practice={practice} />}
        {tab === "readiness" && <ReadinessTab state={practice.state} onPractise={() => setTab("practice")} />}
      </div>
    </div>
  );
}
