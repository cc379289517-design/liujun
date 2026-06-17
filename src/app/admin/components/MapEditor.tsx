"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type CropData = { cropX: number; cropY: number; cropW: number; cropH: number };

type Building = {
  id: number;
  name: string;
  floorPlanUrl: string | null;
  rooms: Room[];
  cropX?: number | null;
  cropY?: number | null;
  cropW?: number | null;
  cropH?: number | null;
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

export type Venue = {
  name: string;
  x: number;
  y: number;
  type?: "实景棚" | "无影棚";
};

interface MapEditorProps {
  building: Building;
  rooms: Room[];
  venues?: Venue[];
  cropMode?: boolean;
  onRoomUpdate: (roomId: number, xPosition: number, yPosition: number, fenceRadius: number) => void;
  onVenueUpdate?: (venueName: string, x: number, y: number) => void;
  onCropUpdate?: (crop: CropData | null) => void;
  onCropModeChange?: (mode: boolean) => void;
  onCropSave?: () => void;
  onCropClear?: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.15;

export default function MapEditor({ building, rooms, venues = [], cropMode: cropModeProp, onRoomUpdate, onVenueUpdate, onCropUpdate, onCropModeChange, onCropSave, onCropClear }: MapEditorProps) {
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

  // Venue dragging state
  const [venueDragging, setVenueDragging] = useState<{
    name: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [venueDragPos, setVenueDragPos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredVenue, setHoveredVenue] = useState<string | null>(null);

  // Pan & zoom state
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState<{
    startX: number;
    startY: number;
    origPanX: number;
    origPanY: number;
  } | null>(null);

  // Crop mode state — controlled by parent if prop provided
  const [cropModeInternal, setCropModeInternal] = useState(false);
  const cropMode = cropModeProp !== undefined ? cropModeProp : cropModeInternal;
  const setCropMode = onCropModeChange || setCropModeInternal;
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(
    building.cropX != null && building.cropY != null && building.cropW != null && building.cropH != null
      ? { x: building.cropX, y: building.cropY, w: building.cropW, h: building.cropH }
      : null
  );
  const [cropDrawing, setCropDrawing] = useState<{
    startX: number; startY: number;
  } | null>(null);
  const [cropDragging, setCropDragging] = useState<{
    origX: number; origY: number; startMX: number; startMY: number;
  } | null>(null);
  const [cropResizing, setCropResizing] = useState<{
    corner: string; origRect: { x: number; y: number; w: number; h: number }; startMX: number; startMY: number;
  } | null>(null);

  // Sync crop from building prop changes
  useEffect(() => {
    if (building.cropX != null && building.cropY != null && building.cropW != null && building.cropH != null) {
      setCropRect({ x: building.cropX, y: building.cropY, w: building.cropW, h: building.cropH });
    } else {
      setCropRect(null);
    }
  }, [building.cropX, building.cropY, building.cropW, building.cropH]);

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
        x = (cw - iw) / 2;
      } else {
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

  // --- Helper: convert client coords to percentage on image ---
  const clientToPercent = useCallback((clientX: number, clientY: number) => {
    const inner = innerRef.current;
    if (!inner) return { px: 0, py: 0 };
    const rect = inner.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * 100;
    const py = ((clientY - rect.top) / rect.height) * 100;
    return { px: Math.max(0, Math.min(100, px)), py: Math.max(0, Math.min(100, py)) };
  }, []);

  // --- Room drag handlers ---
  const handleRoomMouseDown = useCallback(
    (e: React.MouseEvent, room: Room) => {
      if (cropMode) return;
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
    [cropMode]
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

  // --- Venue drag handlers ---
  const handleVenueMouseDown = useCallback(
    (e: React.MouseEvent, venue: Venue) => {
      if (cropMode) return;
      e.preventDefault();
      e.stopPropagation();
      setVenueDragging({
        name: venue.name,
        startX: e.clientX,
        startY: e.clientY,
        origX: venue.x,
        origY: venue.y,
      });
      setVenueDragPos({ x: venue.x, y: venue.y });
    },
    [cropMode]
  );

  useEffect(() => {
    if (!venueDragging) return;

    const handleMove = (e: MouseEvent) => {
      const inner = innerRef.current;
      if (!inner) return;
      const rect = inner.getBoundingClientRect();
      const deltaXPct = ((e.clientX - venueDragging.startX) / rect.width) * 100;
      const deltaYPct = ((e.clientY - venueDragging.startY) / rect.height) * 100;
      const newX = Math.max(0, Math.min(100, venueDragging.origX + deltaXPct));
      const newY = Math.max(0, Math.min(100, venueDragging.origY + deltaYPct));
      setVenueDragPos({ x: newX, y: newY });
    };

    const handleUp = () => {
      if (venueDragPos && onVenueUpdate) {
        onVenueUpdate(
          venueDragging.name,
          Math.round(venueDragPos.x * 100) / 100,
          Math.round(venueDragPos.y * 100) / 100
        );
      }
      setVenueDragging(null);
      setVenueDragPos(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [venueDragging, venueDragPos, onVenueUpdate]);

  // --- Pan handlers ---
  const handlePanMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (dragging || venueDragging || cropMode) return;
      e.preventDefault();
      setPanning({
        startX: e.clientX,
        startY: e.clientY,
        origPanX: pan.x,
        origPanY: pan.y,
      });
    },
    [dragging, venueDragging, pan, cropMode]
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

  // --- Crop draw handler ---
  const handleCropMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!cropMode) return;
      e.preventDefault();
      e.stopPropagation();
      const { px, py } = clientToPercent(e.clientX, e.clientY);
      setCropDrawing({ startX: px, startY: py });
      setCropRect({ x: px, y: py, w: 0, h: 0 });
    },
    [cropMode, clientToPercent]
  );

  useEffect(() => {
    if (!cropDrawing) return;

    const handleMove = (e: MouseEvent) => {
      const { px, py } = clientToPercent(e.clientX, e.clientY);
      const x = Math.min(cropDrawing.startX, px);
      const y = Math.min(cropDrawing.startY, py);
      const w = Math.abs(px - cropDrawing.startX);
      const h = Math.abs(py - cropDrawing.startY);
      setCropRect({ x, y, w, h });
    };

    const handleUp = () => setCropDrawing(null);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [cropDrawing, clientToPercent]);

  // --- Crop move handler ---
  useEffect(() => {
    if (!cropDragging || !cropRect) return;

    const handleMove = (e: MouseEvent) => {
      const inner = innerRef.current;
      if (!inner) return;
      const rect = inner.getBoundingClientRect();
      const dx = ((e.clientX - cropDragging.startMX) / rect.width) * 100;
      const dy = ((e.clientY - cropDragging.startMY) / rect.height) * 100;
      let nx = cropDragging.origX + dx;
      let ny = cropDragging.origY + dy;
      nx = Math.max(0, Math.min(100 - cropRect.w, nx));
      ny = Math.max(0, Math.min(100 - cropRect.h, ny));
      setCropRect((prev) => prev ? { ...prev, x: nx, y: ny } : prev);
    };

    const handleUp = () => setCropDragging(null);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [cropDragging, cropRect]);

  // --- Crop resize handler ---
  useEffect(() => {
    if (!cropResizing) return;

    const handleMove = (e: MouseEvent) => {
      const inner = innerRef.current;
      if (!inner) return;
      const rect = inner.getBoundingClientRect();
      const dx = ((e.clientX - cropResizing.startMX) / rect.width) * 100;
      const dy = ((e.clientY - cropResizing.startMY) / rect.height) * 100;
      const o = cropResizing.origRect;

      let nx = o.x, ny = o.y, nw = o.w, nh = o.h;
      const corner = cropResizing.corner;

      if (corner.includes("l")) { nx = Math.max(0, Math.min(o.x + o.w - 2, o.x + dx)); nw = o.w - (nx - o.x); }
      if (corner.includes("r")) { nw = Math.max(2, Math.min(100 - o.x, o.w + dx)); }
      if (corner.includes("t")) { ny = Math.max(0, Math.min(o.y + o.h - 2, o.y + dy)); nh = o.h - (ny - o.y); }
      if (corner.includes("b")) { nh = Math.max(2, Math.min(100 - o.y, o.h + dy)); }

      setCropRect({ x: nx, y: ny, w: nw, h: nh });
    };

    const handleUp = () => setCropResizing(null);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [cropResizing]);

  const handleCropSave = useCallback(() => {
    if (cropRect && cropRect.w > 1 && cropRect.h > 1 && onCropUpdate) {
      onCropUpdate({
        cropX: Math.round(cropRect.x * 100) / 100,
        cropY: Math.round(cropRect.y * 100) / 100,
        cropW: Math.round(cropRect.w * 100) / 100,
        cropH: Math.round(cropRect.h * 100) / 100,
      });
    }
    setCropMode(false);
    onCropSave?.();
  }, [cropRect, onCropUpdate, setCropMode, onCropSave]);

  const handleCropClear = useCallback(() => {
    setCropRect(null);
    if (onCropUpdate) onCropUpdate(null);
    setCropMode(false);
    onCropClear?.();
  }, [onCropUpdate, setCropMode, onCropClear]);

  if (!building.floorPlanUrl) {
    return (
      <div className="border-2 border-dashed border-white/70 bg-white/30 rounded-2xl p-12 text-center">
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
  const sliderValue = ((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100;

  const corners = ["tl", "tr", "bl", "br"];
  const cornerCursors: Record<string, string> = { tl: "nw-resize", tr: "ne-resize", bl: "sw-resize", br: "se-resize" };
  const cornerPos: Record<string, { left: string; top: string; transform: string }> = {
    tl: { left: "0%", top: "0%", transform: "translate(-50%, -50%)" },
    tr: { left: "100%", top: "0%", transform: "translate(-50%, -50%)" },
    bl: { left: "0%", top: "100%", transform: "translate(-50%, -50%)" },
    br: { left: "100%", top: "100%", transform: "translate(-50%, -50%)" },
  };

  return (
    <div className="relative">
      {/* Crop save/clear inline when in crop mode */}
      {cropMode && cropRect && cropRect.w > 1 && cropRect.h > 1 && (
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={handleCropSave}
            className="px-3 py-1.5 rounded-xl bg-green-500 text-white text-xs font-semibold hover:bg-green-600 transition-colors"
          >
            保存范围
          </button>
          <button
            onClick={handleCropClear}
            className="px-3 py-1.5 rounded-xl bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors"
          >
            清除
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className="relative rounded-2xl overflow-hidden border border-white/70 select-none shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
        style={{
          cursor: cropMode
            ? cropDrawing ? "crosshair" : "crosshair"
            : panning ? "grabbing" : dragging ? "default" : "grab",
        }}
        onMouseDown={cropMode ? undefined : handlePanMouseDown}
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

          {/* Crop overlay & rectangle */}
          {cropMode && cropRect && cropRect.w > 0 && cropRect.h > 0 && (
            <>
              {/* Semi-transparent mask using box-shadow */}
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${cropRect.x}%`,
                  top: `${cropRect.y}%`,
                  width: `${cropRect.w}%`,
                  height: `${cropRect.h}%`,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
                  zIndex: 20,
                }}
              />
              {/* Crop rectangle border */}
              <div
                className="absolute border-2 border-orange-400"
                style={{
                  left: `${cropRect.x}%`,
                  top: `${cropRect.y}%`,
                  width: `${cropRect.w}%`,
                  height: `${cropRect.h}%`,
                  zIndex: 21,
                  cursor: "move",
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCropDragging({
                    origX: cropRect.x,
                    origY: cropRect.y,
                    startMX: e.clientX,
                    startMY: e.clientY,
                  });
                }}
              >
                {/* Resize handles */}
                {corners.map((c) => (
                  <div
                    key={c}
                    className="absolute w-3 h-3 bg-white border-2 border-orange-500 rounded-sm"
                    style={{
                      ...cornerPos[c],
                      cursor: cornerCursors[c],
                      zIndex: 22,
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setCropResizing({
                        corner: c,
                        origRect: { ...cropRect },
                        startMX: e.clientX,
                        startMY: e.clientY,
                      });
                    }}
                  />
                ))}
              </div>
            </>
          )}

          {/* Transparent draw layer for crop mode */}
          {cropMode && !cropDragging && !cropResizing && (
            <div
              className="absolute inset-0"
              style={{ zIndex: 19, cursor: "crosshair" }}
              onMouseDown={handleCropMouseDown}
            />
          )}

          {/* Persistent crop indicator when NOT in crop mode — gray dashed border */}
          {!cropMode && cropRect && cropRect.w > 1 && cropRect.h > 1 && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: `${cropRect.x}%`,
                top: `${cropRect.y}%`,
                width: `${cropRect.w}%`,
                height: `${cropRect.h}%`,
                border: "2px dashed #9ca3af",
                zIndex: 15,
              }}
            />
          )}

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
                  cursor: cropMode ? "default" : isDragging ? "grabbing" : "grab",
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

          {/* Venue markers — blue diamond */}
          {venues.map((venue) => {
            const isDraggingVenue = venueDragging?.name === venue.name;
            const vx = isDraggingVenue && venueDragPos ? venueDragPos.x : venue.x;
            const vy = isDraggingVenue && venueDragPos ? venueDragPos.y : venue.y;
            const isVenueHovered = hoveredVenue === venue.name;

            return (
              <div
                key={venue.name}
                className="absolute flex flex-col items-center"
                style={{
                  left: `${vx}%`,
                  top: `${vy}%`,
                  transform: "translate(-50%, -50%)",
                  zIndex: isDraggingVenue ? 50 : isVenueHovered ? 40 : 10,
                  cursor: cropMode ? "default" : isDraggingVenue ? "grabbing" : "grab",
                }}
                onMouseDown={(e) => handleVenueMouseDown(e, venue)}
                onMouseEnter={() => setHoveredVenue(venue.name)}
                onMouseLeave={() => setHoveredVenue(null)}
              >
                <div
                  className="border-2 border-white transition-all duration-150"
                  style={{
                    width: isDraggingVenue ? 14 : isVenueHovered ? 12 : 10,
                    height: isDraggingVenue ? 14 : isVenueHovered ? 12 : 10,
                    backgroundColor: "#3b82f6",
                    transform: "rotate(45deg)",
                    borderRadius: 2,
                    boxShadow: isDraggingVenue
                      ? "0 0 0 4px rgba(59,130,246,0.3), 0 2px 8px rgba(0,0,0,0.2)"
                      : isVenueHovered
                      ? "0 0 0 3px rgba(59,130,246,0.2), 0 2px 6px rgba(0,0,0,0.15)"
                      : "0 1px 3px rgba(0,0,0,0.2)",
                  }}
                />
                <span
                  className="mt-1 px-1.5 py-0.5 rounded text-white font-medium whitespace-nowrap"
                  style={{
                    fontSize: "10px",
                    backgroundColor: "rgba(59,130,246,0.75)",
                    lineHeight: 1.2,
                  }}
                >
                  {venue.name}
                </span>
              </div>
            );
          })}
        </div>

        {/* Vertical zoom control — right side overlay */}
        <div
          className="admin-glass-toolbar absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-1.5"
          style={{ zIndex: 30 }}
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
          <div className="relative h-28 w-7 flex items-center justify-center overflow-hidden">
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
              className="accent-purple-500 cursor-pointer"
              style={{
                writingMode: "vertical-lr",
                direction: "rtl",
                width: "24px",
                height: "96px",
                appearance: "slider-vertical" as string,
              } as React.CSSProperties}
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
    </div>
  );
}
