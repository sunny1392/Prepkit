"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Inline editable text. Local state updates per keystroke; the change is
 * committed (dispatched as an op) after a pause or on blur — never a request
 * per keystroke. Esc reverts the in-progress edit.
 */
export function InlineText({
  value,
  onCommit,
  label,
  multiline = false,
  className = "",
  placeholder = "Click to edit",
  debounceMs = 700,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
  debounceMs?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committed = useRef(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Adopt outside changes (regeneration, other tab) unless the user is mid-edit.
  useEffect(() => {
    if (!focused) {
      setDraft(value);
      committed.current = value;
    }
  }, [value, focused]);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [draft]);

  const commit = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (v !== committed.current && v.trim().length > 0) {
      committed.current = v;
      onCommit(v);
    }
  };

  return (
    <textarea
      ref={ref}
      aria-label={label}
      rows={1}
      value={draft}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        const v = multiline ? e.target.value : e.target.value.replace(/\n/g, " ");
        setDraft(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(v), debounceMs);
      }}
      onBlur={() => {
        setFocused(false);
        commit(draft);
        if (!draft.trim()) setDraft(committed.current);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (timer.current) clearTimeout(timer.current);
          setDraft(committed.current);
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === "Enter" && !multiline) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className={`block w-full resize-none overflow-hidden rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-zinc-200 focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 ${className}`}
    />
  );
}
