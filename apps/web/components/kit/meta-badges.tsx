import type { ItemMeta } from "@/lib/types";

export function MetaBadges({ meta }: { meta?: ItemMeta }) {
  if (!meta) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {meta.origin === "user" && <span className="chip bg-sky-50 text-sky-700" title="You wrote this — kept on regeneration">Yours</span>}
      {meta.origin === "fallback" && <span className="chip bg-amber-50 text-amber-800" title="Template question added so a must-have requirement isn't left uncovered">Template</span>}
      {meta.edited && meta.origin !== "user" && <span className="chip bg-violet-50 text-violet-700" title="Edited by you — kept on regeneration">Edited</span>}
      {meta.pinned && <span className="chip bg-brand-soft text-brand" title="Pinned — kept on regeneration">Pinned</span>}
    </span>
  );
}

export function PinButton({ pinned, onToggle, label }: { pinned: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={pinned} aria-label={`${pinned ? "Unpin" : "Pin"} ${label}`} title={pinned ? "Unpin" : "Pin — keep through regeneration"} className={`btn-ghost px-2 ${pinned ? "text-brand" : ""}`}>
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M7 2h6l-1 5 3 3H5l3-3-1-5Zm3 8v8" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
