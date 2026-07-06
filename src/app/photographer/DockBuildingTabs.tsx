"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { DockEntry } from "./types";

export default function DockBuildingTabs({
  entries,
  activeBld,
  onSelect,
  onReorder,
}: {
  entries: DockEntry[];
  activeBld: number | null;
  onSelect: (id: number) => void;
  onReorder: (order: number[]) => void;
}) {
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const [drag, setDrag] = useState<{
    id: number;
    startX: number;
    currentX: number;
    pointerId: number;
  } | null>(null);
  // visualOrder: the logical order items should appear in (indices into entries)
  const [visualOrder, setVisualOrder] = useState<number[]>(() => entries.map(([id]) => id));
  const dragRef = useRef(drag);
  const visualOrderRef = useRef(visualOrder);
  const suppressClickRef = useRef(false);
  // snapshot of each item's left edge at drag start (keyed by id)
  const startRectsRef = useRef<Map<number, { left: number; width: number }>>(new Map());
  const [startRects, setStartRects] = useState<Map<number, { left: number; width: number }>>(new Map());
  // whether we're in the "settling" phase right after drop
  const [settling, setSettling] = useState(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup settle timer on unmount
  useEffect(() => () => { if (settleTimerRef.current) clearTimeout(settleTimerRef.current); }, []);

  // Keep refs in sync (avoid writing refs during render)
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);
  useEffect(() => {
    visualOrderRef.current = visualOrder;
  }, [visualOrder]);

  // Sync when entries change from parent
  useEffect(() => {
    setVisualOrder(entries.map(([id]) => id));
  }, [entries]);

  // Snapshot positions at drag start
  const snapshotPositions = useCallback(() => {
    const m = new Map<number, { left: number; width: number }>();
    for (const [id] of entries) {
      const el = itemRefs.current.get(id);
      if (el) {
        const r = el.getBoundingClientRect();
        m.set(id, { left: r.left, width: r.width });
      }
    }
    startRectsRef.current = m;
    setStartRects(m);
  }, [entries]);

  const handlePointerDown = useCallback((e: PointerEvent, id: number) => {
    const el = itemRefs.current.get(id);
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    snapshotPositions();
    setDrag({ id, startX: e.clientX, currentX: e.clientX, pointerId: e.pointerId });
    setVisualOrder(visualOrderRef.current);
    setSettling(false);
  }, [snapshotPositions]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const newX = e.clientX;
    setDrag((prev) => prev ? { ...prev, currentX: newX } : prev);

    // Where is the dragged item's center now?
    const dragEl = itemRefs.current.get(d.id);
    if (!dragEl) return;
    const startRect = startRectsRef.current.get(d.id);
    if (!startRect) return;
    const dx = newX - d.startX;
    const draggedCenter = startRect.left + startRect.width / 2 + dx;

    // Compute new visual order based on dragged center vs other items' resting centers
    const currentOrder = visualOrderRef.current;

    // Compute "resting" center for each slot in visual order
    // We need to know: if items were laid out in visualOrder, what center would each slot have?
    // Use the snapshot widths + gap(8px)
    const gap = 8;
    const slotPositions: { id: number; center: number }[] = [];
    let x = startRectsRef.current.get(currentOrder[0])?.left ?? 0;
    // Recalculate from the leftmost item's original position
    const firstOrigLeft = Math.min(...Array.from(startRectsRef.current.values()).map((r) => r.left));
    x = firstOrigLeft;
    for (const slotId of currentOrder) {
      const w = startRectsRef.current.get(slotId)?.width ?? 60;
      slotPositions.push({ id: slotId, center: x + w / 2 });
      x += w + gap;
    }

    // Remove dragged, find where to insert based on draggedCenter
    const others = currentOrder.filter((id) => id !== d.id);
    const otherSlots = slotPositions.filter((s) => s.id !== d.id);

    let insertIdx = others.length;
    for (let i = 0; i < otherSlots.length; i++) {
      if (draggedCenter < otherSlots[i].center) {
        insertIdx = i;
        break;
      }
    }

    const newOrder = [...others];
    newOrder.splice(insertIdx, 0, d.id);

    // Only update if changed
    if (newOrder.some((id, i) => currentOrder[i] !== id)) {
      setVisualOrder(newOrder);
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    const wasDragged = Math.abs(d.currentX - d.startX) > 3;
    // Start settling animation
    setSettling(true);
    setDrag(null);
    // Commit order after settle animation
    const finalOrder = [...visualOrderRef.current];
    settleTimerRef.current = setTimeout(() => {
      startRectsRef.current = new Map();
      setStartRects(new Map());
      onReorder(finalOrder);
      setSettling(false);
    }, 320);
    if (wasDragged) {
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 100);
    }
  }, [onReorder]);

  // Compute translateX for each item based on visual order vs DOM order
  // DOM order = entries order (fixed), visual order = where they should appear
  const gap = 8;
  const entryIds = entries.map(([id]) => id);

  // Build slot X positions based on visual order
  const slotLefts: number[] = [];
  let xAccum = 0;
  for (const id of visualOrder) {
    slotLefts.push(xAccum);
    const w = startRects.get(id)?.width ?? 0;
    xAccum += w + gap;
  }

  // Build DOM-order X positions
  const domLefts: number[] = [];
  let xAccum2 = 0;
  for (const id of entryIds) {
    domLefts.push(xAccum2);
    const w = startRects.get(id)?.width ?? 0;
    xAccum2 += w + gap;
  }

  // For each item: find its slot index in visualOrder, compute offset from its DOM position
  const offsets = new Map<number, number>();
  for (let domIdx = 0; domIdx < entryIds.length; domIdx++) {
    const id = entryIds[domIdx];
    const slotIdx = visualOrder.indexOf(id);
    if (slotIdx !== -1 && startRects.size > 0) {
      offsets.set(id, slotLefts[slotIdx] - domLefts[domIdx]);
    } else {
      offsets.set(id, 0);
    }
  }

  const isDragging = drag !== null;

  return (
    <div
      className="px-5 pb-3 flex items-center gap-2 relative"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ touchAction: "none" }}
    >
      {/* Render in DOM (entries) order — always fixed */}
      {entries.map(([bId, data]) => {
        const isThisDragging = drag?.id === bId;
        const isActive = activeBld === bId;
        const offset = offsets.get(bId) ?? 0;

        let style: CSSProperties;
        if (isThisDragging && drag) {
          // Dragged item: follow cursor directly, no transition
          const dx = drag.currentX - drag.startX;
          style = {
            transform: `translateX(${dx}px) scale(1.06)`,
            zIndex: 50,
            boxShadow: "0 10px 30px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1)",
            transition: "box-shadow 0.15s ease, transform 0s",
            cursor: "grabbing",
          };
        } else if (isDragging || settling) {
          // Other items: smooth slide to their visual slot
          style = {
            transform: offset ? `translateX(${offset}px)` : "none",
            transition: "transform 0.32s cubic-bezier(.2,1,.3,1)",
            cursor: "grab",
            zIndex: 1,
          };
        } else {
          // Idle
          style = {
            transform: "none",
            transition: "none",
            cursor: "grab",
          };
        }

        return (
          <button
            key={bId}
            ref={(el) => { if (el) itemRefs.current.set(bId, el); }}
            onPointerDown={(e) => handlePointerDown(e, bId)}
            onClick={() => { if (!suppressClickRef.current) onSelect(bId); }}
            className={`relative select-none rounded-2xl border px-3.5 py-2 text-[11px] font-extrabold shadow-sm backdrop-blur-xl transition-colors ${
              isActive
                ? "border-orange-300/80 bg-orange-500/95 text-white shadow-orange-300/40"
                : "border-white/70 bg-white/38 text-[--text-secondary] hover:bg-white/62 hover:text-[--text-primary]"
            }`}
            style={style}
          >
            {data.name} <span className={`ml-0.5 ${isActive ? "text-white/80" : "text-[--text-muted]"}`}>{data.profiles.length}人</span>
          </button>
        );
      })}
    </div>
  );
}
