"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type CropData = { cropX: number; cropY: number; cropW: number; cropH: number };
export type VenuePoint = { x: number; y: number };

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

export type IroningMachine = {
  id: number;
  buildingId: number;
  name: string;
  status: "normal" | "maintenance";
  xPosition: number;
  yPosition: number;
  sortRank: number;
};

export type Venue = {
  name: string;
  x: number;
  y: number;
  type?: "实景棚" | "无影棚";
  color?: string;
  polygon?: VenuePoint[];
};

interface MapEditorProps {
  building: Building;
  rooms: Room[];
  venues?: Venue[];
  ironingMachines?: IroningMachine[];
  cropMode?: boolean;
  onRoomUpdate: (roomId: number, xPosition: number, yPosition: number, fenceRadius: number) => void;
  onVenueUpdate?: (venueName: string, x: number, y: number) => void;
  onIroningMachineUpdate?: (machineId: number, x: number, y: number) => void;
  areaEditVenueName?: string | null;
  onVenueAreaSave?: (venueName: string, polygon: VenuePoint[]) => void;
  onVenueAreaCancel?: () => void;
  onCropUpdate?: (crop: CropData | null) => void;
  onCropModeChange?: (mode: boolean) => void;
  onCropSave?: () => void;
  onCropClear?: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.15;

function IroningMachineIcon({ muted = false }: { muted?: boolean }) {
  const color = muted ? "#94a3b8" : "#f05b51";
  return (
    <svg width="22" height="22" viewBox="0 0 96 96" fill="none" aria-hidden="true">
      <path d="M21 52c0-12 8-22 20-22h20c8 0 14 6 14 14v8" stroke={color} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 55h58c4 0 7 3 7 7v4c0 5-4 9-9 9H24c-6 0-10-4-10-10v-3c0-4 2-7 5-7Z" stroke={color} strokeWidth="7" strokeLinejoin="round" />
      <path d="M36 30V20h24c7 0 12 5 12 12" stroke={color} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M33 62h30" stroke={color} strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

export default function MapEditor({ building, rooms, venues = [], ironingMachines = [], cropMode: cropModeProp, onRoomUpdate, onVenueUpdate, onIroningMachineUpdate, areaEditVenueName, onVenueAreaSave, onVenueAreaCancel, onCropUpdate, onCropModeChange, onCropSave, onCropClear }: MapEditorProps) {
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
  const [areaDraft, setAreaDraft] = useState<VenuePoint[]>([]);
  const [areaPointDragging, setAreaPointDragging] = useState<{
    index: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [areaCanvasAction, setAreaCanvasAction] = useState<{
    startX: number;
    startY: number;
    origPanX: number;
    origPanY: number;
    moved: boolean;
  } | null>(null);
  const areaEditVenue = venues.find((venue) => venue.name === areaEditVenueName) ?? null;
  const areaEditMode = !!areaEditVenue;

  const [machineDragging, setMachineDragging] = useState<{
    id: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [machineDragPos, setMachineDragPos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredMachine, setHoveredMachine] = useState<number | null>(null);

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

  useEffect(() => {
    if (!areaEditVenueName) {
      setAreaDraft([]);
      return;
    }
    const nextVenue = venues.find((venue) => venue.name === areaEditVenueName);
    setAreaDraft(Array.isArray(nextVenue?.polygon) ? nextVenue.polygon : []);
  }, [areaEditVenueName]);

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
      if (cropMode || areaEditMode) return;
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
    [cropMode, areaEditMode]
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
      if (cropMode || areaEditMode) return;
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
    [cropMode, areaEditMode]
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

  const handleMachineMouseDown = useCallback(
    (e: React.MouseEvent, machine: IroningMachine) => {
      if (cropMode || areaEditMode) return;
      e.preventDefault();
      e.stopPropagation();
      setMachineDragging({
        id: machine.id,
        startX: e.clientX,
        startY: e.clientY,
        origX: machine.xPosition,
        origY: machine.yPosition,
      });
      setMachineDragPos({ x: machine.xPosition, y: machine.yPosition });
    },
    [cropMode, areaEditMode]
  );

  useEffect(() => {
    if (!machineDragging) return;

    const handleMove = (e: MouseEvent) => {
      const inner = innerRef.current;
      if (!inner) return;
      const rect = inner.getBoundingClientRect();
      const deltaXPct = ((e.clientX - machineDragging.startX) / rect.width) * 100;
      const deltaYPct = ((e.clientY - machineDragging.startY) / rect.height) * 100;
      const newX = Math.max(0, Math.min(100, machineDragging.origX + deltaXPct));
      const newY = Math.max(0, Math.min(100, machineDragging.origY + deltaYPct));
      setMachineDragPos({ x: newX, y: newY });
    };

    const handleUp = () => {
      if (machineDragPos && onIroningMachineUpdate) {
        onIroningMachineUpdate(
          machineDragging.id,
          Math.round(machineDragPos.x * 100) / 100,
          Math.round(machineDragPos.y * 100) / 100
        );
      }
      setMachineDragging(null);
      setMachineDragPos(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [machineDragging, machineDragPos, onIroningMachineUpdate]);

  // --- Pan handlers ---
  const handlePanMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (dragging || venueDragging || cropMode || areaEditMode) return;
      e.preventDefault();
      setPanning({
        startX: e.clientX,
        startY: e.clientY,
        origPanX: pan.x,
        origPanY: pan.y,
      });
    },
    [dragging, venueDragging, pan, cropMode, areaEditMode]
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

  const addAreaPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (!areaEditMode) return;
      const { px, py } = clientToPercent(clientX, clientY);
      setAreaDraft((prev) => [
        ...prev,
        { x: Math.round(px * 100) / 100, y: Math.round(py * 100) / 100 },
      ]);
    },
    [areaEditMode, clientToPercent]
  );

  const handleAreaCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!areaEditMode || areaPointDragging) return;
      e.preventDefault();
      e.stopPropagation();
      setAreaCanvasAction({
        startX: e.clientX,
        startY: e.clientY,
        origPanX: pan.x,
        origPanY: pan.y,
        moved: false,
      });
    },
    [areaEditMode, areaPointDragging, pan.x, pan.y]
  );

  const handleAreaPointMouseDown = useCallback(
    (e: React.MouseEvent, point: VenuePoint, index: number) => {
      if (!areaEditMode) return;
      e.preventDefault();
      e.stopPropagation();
      setAreaPointDragging({
        index,
        startX: e.clientX,
        startY: e.clientY,
        origX: point.x,
        origY: point.y,
      });
    },
    [areaEditMode]
  );

  useEffect(() => {
    if (!areaPointDragging) return;

    const handleMove = (e: MouseEvent) => {
      const inner = innerRef.current;
      if (!inner) return;
      const rect = inner.getBoundingClientRect();
      const deltaXPct = ((e.clientX - areaPointDragging.startX) / rect.width) * 100;
      const deltaYPct = ((e.clientY - areaPointDragging.startY) / rect.height) * 100;
      const nextX = Math.max(0, Math.min(100, areaPointDragging.origX + deltaXPct));
      const nextY = Math.max(0, Math.min(100, areaPointDragging.origY + deltaYPct));
      setAreaDraft((prev) =>
        prev.map((point, index) =>
          index === areaPointDragging.index
            ? { x: Math.round(nextX * 100) / 100, y: Math.round(nextY * 100) / 100 }
            : point
        )
      );
    };

    const handleUp = () => setAreaPointDragging(null);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [areaPointDragging]);

  useEffect(() => {
    if (!areaCanvasAction) return;

    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - areaCanvasAction.startX;
      const dy = e.clientY - areaCanvasAction.startY;
      const moved = areaCanvasAction.moved || Math.abs(dx) > 4 || Math.abs(dy) > 4;
      if (moved) {
        setPan(clampPan(areaCanvasAction.origPanX + dx, areaCanvasAction.origPanY + dy, zoom));
        if (!areaCanvasAction.moved) {
          setAreaCanvasAction((prev) => (prev ? { ...prev, moved: true } : prev));
        }
      }
    };

    const handleUp = () => {
      if (!areaCanvasAction.moved) {
        addAreaPoint(areaCanvasAction.startX, areaCanvasAction.startY);
      }
      setAreaCanvasAction(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [addAreaPoint, areaCanvasAction, clampPan, zoom]);

  const saveVenueArea = useCallback(() => {
    if (!areaEditVenue || areaDraft.length < 3 || !onVenueAreaSave) return;
    onVenueAreaSave(areaEditVenue.name, areaDraft);
  }, [areaDraft, areaEditVenue, onVenueAreaSave]);

  const cancelVenueArea = useCallback(() => {
    setAreaDraft([]);
    onVenueAreaCancel?.();
  }, [onVenueAreaCancel]);

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
  const polygonPoints = (points: VenuePoint[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
  const polygonCenter = (points: VenuePoint[]) => {
    if (points.length === 0) return { x: 50, y: 50 };
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  };
  const areaHandleScale = Math.max(0.32, 1 / Math.pow(zoom, 1.35));
  const areaLabelScale = Math.max(0.42, 1 / Math.pow(zoom, 1.08));
  const areaStrokeWidth = Math.max(0.05, 0.18 / Math.pow(zoom, 1.1));
  const areaDraftStrokeWidth = Math.max(0.05, 0.2 / Math.pow(zoom, 1.1));

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

      {areaEditVenue && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-2xl border border-white/70 bg-white/72 px-3 py-2 text-xs shadow-sm backdrop-blur-xl">
          <span className="font-extrabold text-slate-700">框选：{areaEditVenue.name}</span>
          <span className="font-semibold text-slate-500">点击地图添加边界点，至少 3 个点</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-500">{areaDraft.length} 点</span>
          <button
            type="button"
            onClick={saveVenueArea}
            disabled={areaDraft.length < 3}
            className="rounded-xl bg-blue-500 px-3 py-1.5 font-bold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            保存范围
          </button>
          <button
            type="button"
            onClick={() => setAreaDraft((prev) => prev.slice(0, -1))}
            disabled={areaDraft.length === 0}
            className="rounded-xl bg-slate-100 px-3 py-1.5 font-bold text-slate-600 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            撤销一点
          </button>
          <button
            type="button"
            onClick={() => setAreaDraft([])}
            disabled={areaDraft.length === 0}
            className="rounded-xl bg-slate-100 px-3 py-1.5 font-bold text-slate-600 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            清空
          </button>
          <button
            type="button"
            onClick={cancelVenueArea}
            className="rounded-xl bg-red-50 px-3 py-1.5 font-bold text-red-600 transition-colors hover:bg-red-100"
          >
            取消
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className="relative rounded-2xl overflow-hidden border border-white/70 select-none shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
        style={{
          cursor: cropMode
            ? cropDrawing ? "crosshair" : "crosshair"
            : areaEditMode ? "crosshair"
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

          {/* Public area polygons */}
          <div className="pointer-events-none absolute inset-0" style={{ zIndex: 6 }}>
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              {venues.map((venue) => {
                const points = areaEditVenue?.name === venue.name ? areaDraft : venue.polygon;
                if (!Array.isArray(points) || points.length < 3) return null;
                const color = venue.color || "#3b82f6";
                return (
                  <polygon
                    key={venue.name}
                    points={polygonPoints(points)}
                    fill={color}
                    fillOpacity={areaEditVenue?.name === venue.name ? 0.26 : 0.22}
                    stroke={color}
                    strokeOpacity={areaEditVenue?.name === venue.name ? 0.36 : 0.32}
                    strokeWidth={areaEditVenue?.name === venue.name ? areaStrokeWidth : 0.18}
                    strokeLinejoin="round"
                  />
                );
              })}
            </svg>
            {venues.map((venue) => {
              const points = areaEditVenue?.name === venue.name ? areaDraft : venue.polygon;
              if (!Array.isArray(points) || points.length < 3) return null;
              const center = polygonCenter(points);
              const color = venue.color || "#3b82f6";
              return (
                <div
                  key={`${venue.name}-label`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 px-2 py-0.5 text-[10px] font-extrabold text-white shadow-sm"
                  style={{
                    left: `${center.x}%`,
                    top: `${center.y}%`,
                    transform: `translate(-50%, -50%) scale(${areaLabelScale})`,
                    backgroundColor: `${color}cc`,
                    textShadow: "0 1px 2px rgba(0,0,0,0.32)",
                  }}
                >
                  {venue.name}
                </div>
              );
            })}
          </div>

          {areaEditVenue && areaDraft.length > 0 && (
            <div className="pointer-events-none absolute inset-0" style={{ zIndex: 26 }}>
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                {areaDraft.length >= 2 && (
                  <polyline
                    points={polygonPoints(areaDraft)}
                    fill="none"
                    stroke={areaEditVenue.color || "#3b82f6"}
                    strokeDasharray="0.9 1.05"
                    strokeOpacity={0.55}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={areaDraftStrokeWidth}
                  />
                )}
              </svg>
              {areaDraft.map((point, index) => (
                <div
                  key={`${point.x}-${point.y}-${index}`}
                  className="pointer-events-auto absolute flex h-3.5 w-3.5 cursor-grab items-center justify-center rounded-full border border-white/80 text-[7px] font-black text-white/90 shadow-sm active:cursor-grabbing"
                  style={{
                    left: `${point.x}%`,
                    top: `${point.y}%`,
                    transform: `translate(-50%, -50%) scale(${areaHandleScale})`,
                    backgroundColor: areaEditVenue.color || "#3b82f6",
                  }}
                  onMouseDown={(e) => handleAreaPointMouseDown(e, point, index)}
                >
                  {index + 1}
                </div>
              ))}
            </div>
          )}

          {areaEditMode && (
            <div
              className="absolute inset-0"
              style={{ zIndex: 25, cursor: areaCanvasAction?.moved ? "grabbing" : "crosshair" }}
              onMouseDown={handleAreaCanvasMouseDown}
            />
          )}

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
                  cursor: cropMode || areaEditMode ? "default" : isDragging ? "grabbing" : "grab",
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
                  cursor: cropMode || areaEditMode ? "default" : isDraggingVenue ? "grabbing" : "grab",
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

          {/* Ironing machine markers */}
          {ironingMachines.map((machine) => {
            const isDraggingMachine = machineDragging?.id === machine.id;
            const mx = isDraggingMachine && machineDragPos ? machineDragPos.x : machine.xPosition;
            const my = isDraggingMachine && machineDragPos ? machineDragPos.y : machine.yPosition;
            const isMachineHovered = hoveredMachine === machine.id;
            const isMaintenance = machine.status === "maintenance";

            return (
              <div
                key={machine.id}
                className="absolute flex flex-col items-center"
                style={{
                  left: `${mx}%`,
                  top: `${my}%`,
                  transform: "translate(-50%, -50%)",
                  zIndex: isDraggingMachine ? 54 : isMachineHovered ? 44 : 14,
                  cursor: cropMode || areaEditMode ? "default" : isDraggingMachine ? "grabbing" : "grab",
                  opacity: isMaintenance ? 0.58 : 1,
                  filter: isMaintenance ? "grayscale(1)" : "none",
                }}
                onMouseDown={(e) => handleMachineMouseDown(e, machine)}
                onMouseEnter={() => setHoveredMachine(machine.id)}
                onMouseLeave={() => setHoveredMachine(null)}
              >
                <div
                  className="grid place-items-center rounded-lg border-2 bg-white/92 shadow-sm transition-all duration-150"
                  style={{
                    width: isDraggingMachine ? 34 : isMachineHovered ? 32 : 30,
                    height: isDraggingMachine ? 34 : isMachineHovered ? 32 : 30,
                    borderColor: isMaintenance ? "#94a3b8" : "#f05b51",
                    boxShadow: isDraggingMachine
                      ? "0 0 0 4px rgba(240,91,81,0.22), 0 2px 8px rgba(0,0,0,0.18)"
                      : isMachineHovered
                      ? "0 0 0 3px rgba(240,91,81,0.16), 0 2px 6px rgba(0,0,0,0.14)"
                      : "0 1px 3px rgba(0,0,0,0.18)",
                  }}
                >
                  <IroningMachineIcon muted={isMaintenance} />
                </div>
                <span
                  className="mt-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                  style={{
                    backgroundColor: isMaintenance ? "rgba(100,116,139,0.76)" : "rgba(240,91,81,0.82)",
                    lineHeight: 1.2,
                  }}
                >
                  {machine.name}{isMaintenance ? " · 维修" : ""}
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
