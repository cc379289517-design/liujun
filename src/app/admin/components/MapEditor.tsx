"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type Building = {
  id: number;
  name: string;
  floorPlanUrl: string | null;
  rooms: Room[];
};

type Room = {
  id: number;
  buildingId: number;
  roomNumber: string;
  floor: number;
  xPosition: number;
  yPosition: number;
  fenceRadius: number;
};

interface MapEditorProps {
  building: Building;
  rooms: Room[];
  onRoomUpdate: (roomId: number, xPosition: number, yPosition: number, fenceRadius: number) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.15;

export default function MapEditor({ building, rooms, onRoomUpdate }: MapEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  // Room dragging state
  const [dragging, setDragging] = useState<{
    roomId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredRoom, setHoveredRoom] = useState<number | null>(null);

  // Pan & zoom state
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState<{
    startX: number;
    startY: number;
    origPanX: number;
    origPanY: number;
  } | null>(null);

  const clampZoom = useCallback(
    (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100)),
    []
  );

  // Constrain pan so the image edges never reveal blank areas
  const clampPan = useCallback(
    (px: number, py: number, z: number) => {
      const container = containerRef.current;
      if (!container) return { x: px, y: py };
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const inner = innerRef.current;
      if (!inner) return { x: px, y: py };
      const iw = inner.scrollWidth * z;
      const ih = inner.scrollHeight * z;

      let x = px;
      let y = py;

      if (iw <= cw) {
        // Image is smaller than container — center it
        x = (cw - iw) / 2;
      } else {
        // Image is larger — don't let edges show
        x = Math.min(0, Math.max(cw - iw, x));
      }

      if (ih <= ch) {
        y = (ch - ih) / 2;
      } else {
        y = Math.min(0, Math.max(ch - ih, y));
      }

      return { x, y };
    },
    []
  );

  const resetView = useCallback(() => {
    setZoom(MIN_ZOOM);
    setPan(clampPan(0, 0, MIN_ZOOM));
  }, [clampPan]);

  // --- Room drag handlers ---
  const handleRoomMouseDown = useCallback(
    (e: React.MouseEvent, room: Room) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging({
        roomId: room.id,
        startX: e.clientX,
        startY: e.clientY,
        origX: room.xPosition,
        origY: room.yPosition,
      });
      setDragPos({ x: room.xPosition, y: room.yPosition });
    },
    []
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      const inner = innerRef.current;
      if (!inner) return;
      const rect = inner.getBoundingClientRect();
      const deltaXPct = ((e.clientX - dragging.startX) / rect.width) * 100;
      const deltaYPct = ((e.clientY - dragging.startY) / rect.height) * 100;
      const newX = Math.max(0, Math.min(100, dragging.origX + deltaXPct));
      const newY = Math.max(0, Math.min(100, dragging.origY + deltaYPct));
      setDragPos({ x: newX, y: newY });
    };

    const handleUp = () => {
      if (dragPos) {
        const room = rooms.find((r) => r.id === dragging.roomId);
        if (room) {
          onRoomUpdate(
            dragging.roomId,
            Math.round(dragPos.x * 100) / 100,
            Math.round(dragPos.y * 100) / 100,
            room.fenceRadius
          );
        }
      }
      setDragging(null);
      setDragPos(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, dragPos, rooms, onRoomUpdate]);

  // --- Pan handlers ---
  const handlePanMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (dragging) return;
      e.preventDefault();
      setPanning({
        startX: e.clientX,
        startY: e.clientY,
        origPanX: pan.x,
        origPanY: pan.y,
      });
    },
    [dragging, pan]
  );

  useEffect(() => {
    if (!panning) return;

    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - panning.startX;
      const dy = e.clientY - panning.startY;
      setPan(clampPan(panning.origPanX + dx, panning.origPanY + dy, zoom));
    };

    const handleUp = () => setPanning(null);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [panning, zoom, clampPan]);

  // --- Wheel zoom ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const oldZoom = zoom;
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      const newZoom = clampZoom(oldZoom + delta);
      if (newZoom === oldZoom) return;

      // Zoom towards mouse cursor
      const scale = newZoom / oldZoom;
      const newPanX = mouseX - scale * (mouseX - pan.x);
      const newPanY = mouseY - scale * (mouseY - pan.y);

      setZoom(newZoom);
      setPan(clampPan(newPanX, newPanY, newZoom));
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [zoom, pan, clampZoom, clampPan]);

  if (!building.floorPlanUrl) {
    return (
      <div className="border-2 border-dashed border-gray-200 rounded-2xl p-12 text-center">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#94a3b8"
          strokeWidth="1.5"
          className="mx-auto mb-3"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <p className="text-sm text-[--text-muted]">请先上传楼层平面图</p>
      </div>
    );
  }

  const zoomPercent = Math.round(zoom * 100);
  // Slider value: 0 at MIN_ZOOM, 100 at MAX_ZOOM
  const sliderValue = ((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100;

  return (
    <div
      ref={containerRef}
      className="relative rounded-2xl overflow-hidden border border-gray-200 select-none"
      style={{
        cursor: panning ? "grabbing" : dragging ? "default" : "grab",
      }}
      onMouseDown={handlePanMouseDown}
    >
      {/* Transformable inner container */}
      <div
        ref={innerRef}
        className="relative"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {/* Floor plan image */}
        <img
          src={building.floorPlanUrl}
          alt={`${building.name} 平面图`}
          className="block w-full h-auto"
          draggable={false}
        />

        {/* Room markers */}
        {rooms.map((room) => {
          const isDragging = dragging?.roomId === room.id;
          const x = isDragging && dragPos ? dragPos.x : room.xPosition;
          const y = isDragging && dragPos ? dragPos.y : room.yPosition;
          const isHovered = hoveredRoom === room.id;

          return (
            <div
              key={room.id}
              className="absolute flex flex-col items-center"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                transform: "translate(-50%, -50%)",
                zIndex: isDragging ? 50 : isHovered ? 40 : 10,
                cursor: isDragging ? "grabbing" : "grab",
              }}
              onMouseDown={(e) => handleRoomMouseDown(e, room)}
              onMouseEnter={() => setHoveredRoom(room.id)}
              onMouseLeave={() => setHoveredRoom(null)}
            >
              <div
                className="rounded-full border-2 border-white transition-all duration-150"
                style={{
                  width: isDragging ? 16 : isHovered ? 14 : 12,
                  height: isDragging ? 16 : isHovered ? 14 : 12,
                  backgroundColor: "#ef4444",
                  boxShadow: isDragging
                    ? "0 0 0 4px rgba(239,68,68,0.3), 0 2px 8px rgba(0,0,0,0.2)"
                    : isHovered
                    ? "0 0 0 3px rgba(239,68,68,0.2), 0 2px 6px rgba(0,0,0,0.15)"
                    : "0 1px 3px rgba(0,0,0,0.2)",
                }}
              />
              <span
                className="mt-0.5 px-1.5 py-0.5 rounded text-white font-medium whitespace-nowrap"
                style={{
                  fontSize: "10px",
                  backgroundColor: "rgba(0,0,0,0.6)",
                  lineHeight: 1.2,
                }}
              >
                {room.roomNumber}
              </span>
            </div>
          );
        })}
      </div>

      {/* Vertical zoom control — right side overlay */}
      <div
        className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-1.5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Zoom in (+) */}
        <button
          onClick={() => {
            const container = containerRef.current;
            if (!container) return;
            const newZoom = clampZoom(zoom + ZOOM_STEP);
            if (newZoom === zoom) return;
            const cx = container.clientWidth / 2;
            const cy = container.clientHeight / 2;
            const scale = newZoom / zoom;
            const newPanX = cx - scale * (cx - pan.x);
            const newPanY = cy - scale * (cy - pan.y);
            setZoom(newZoom);
            setPan(clampPan(newPanX, newPanY, newZoom));
          }}
          disabled={zoom >= MAX_ZOOM}
          className="w-7 h-7 rounded-lg bg-gray-50 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          title="放大"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        {/* Vertical slider */}
        <div className="relative h-28 w-7 flex items-center justify-center">
          <input
            type="range"
            min={0}
            max={100}
            value={sliderValue}
            onChange={(e) => {
              const container = containerRef.current;
              if (!container) return;
              const v = parseInt(e.target.value);
              const newZoom = clampZoom(MIN_ZOOM + (v / 100) * (MAX_ZOOM - MIN_ZOOM));
              if (newZoom === zoom) return;
              const cx = container.clientWidth / 2;
              const cy = container.clientHeight / 2;
              const scale = newZoom / zoom;
              const newPanX = cx - scale * (cx - pan.x);
              const newPanY = cy - scale * (cy - pan.y);
              setZoom(newZoom);
              setPan(clampPan(newPanX, newPanY, newZoom));
            }}
            className="absolute h-24 accent-purple-500 cursor-pointer"
            style={{
              writingMode: "vertical-lr",
              direction: "rtl",
              width: "24px",
              appearance: "auto",
            }}
            title={`${zoomPercent}%`}
          />
        </div>

        {/* Zoom out (-) */}
        <button
          onClick={() => {
            const container = containerRef.current;
            if (!container) return;
            const newZoom = clampZoom(zoom - ZOOM_STEP);
            if (newZoom === zoom) return;
            const cx = container.clientWidth / 2;
            const cy = container.clientHeight / 2;
            const scale = newZoom / zoom;
            const newPanX = cx - scale * (cx - pan.x);
            const newPanY = cy - scale * (cy - pan.y);
            setZoom(newZoom);
            setPan(clampPan(newPanX, newPanY, newZoom));
          }}
          disabled={zoom <= MIN_ZOOM}
          className="w-7 h-7 rounded-lg bg-gray-50 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          title="缩小"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        {/* Zoom percentage */}
        <span className="text-[9px] text-gray-500 font-mono leading-none">{zoomPercent}%</span>

        {/* Reset */}
        <button
          onClick={resetView}
          className="w-7 h-7 rounded-lg bg-gray-50 hover:bg-gray-200 flex items-center justify-center transition-colors"
          title="重置视图"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12a9 9 0 1 1 3 6.7" />
            <polyline points="3 22 3 16 9 16" />
          </svg>
        </button>
      </div>
    </div>
  );
}
