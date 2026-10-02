"use client";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

/** Vertical sortable list: mouse, touch and keyboard (focus handle → Space → arrows → Space). */
export function SortableList({ ids, onReorder, children, label }: { ids: string[]; onReorder: (ids: string[]) => void; children: ReactNode; label: string }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    if (from >= 0 && to >= 0) onReorder(arrayMove(ids, from, to));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{ screenReaderInstructions: { draggable: `To reorder ${label}, press space to pick up an item, use the arrow keys to move it, and space again to drop it. Press escape to cancel.` } }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">{children}</ul>
      </SortableContext>
    </DndContext>
  );
}

export function SortableItem({ id, children }: { id: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button type="button" {...attributes} {...listeners} aria-label="Drag to reorder" className="mt-1 cursor-grab touch-none rounded p-1 text-ink-faint hover:bg-zinc-100 hover:text-ink active:cursor-grabbing">
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
        <circle cx="7" cy="5" r="1.5" /><circle cx="13" cy="5" r="1.5" /><circle cx="7" cy="10" r="1.5" /><circle cx="13" cy="10" r="1.5" /><circle cx="7" cy="15" r="1.5" /><circle cx="13" cy="15" r="1.5" />
      </svg>
    </button>
  );
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? "relative z-10 opacity-80 shadow-lg" : ""}>
      {children(handle)}
    </li>
  );
}
