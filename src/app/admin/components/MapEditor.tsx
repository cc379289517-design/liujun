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

export default function MapEditor({ building, rooms, onRoomUpdate }: MapEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ roomId: number; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredRoom, setHoveredRoom] = useState<number | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent, room: Room) => {
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
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
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
          onRoomUpdate(dragging.roomId, Math.round(dragPos.x * 100) / 100, Math.round(dragPos.y * 100) / 100, room.fenceRadius);
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

  if (!building.floorPlanUrl) {
    return (
      <div className="border-2 border-dashed border-gray-200 rounded-2xl p-12 text-center">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" className="mx-auto mb-3">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <p className="text-sm text-[--text-muted]">请先上传楼层平面图</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative rounded-2xl overflow-hidden border border-gray-200 select-none"
      style={{ cursor: dragging ? "grabbing" : "default" }}
    >
      {/* Floor plan image */}
      <img
        src={building.floorPlanUrl}
        alt={`${building.name} 平面图`}
        className="w-full h-auto block"
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
            onMouseDown={(e) => handleMouseDown(e, room)}
            onMouseEnter={() => setHoveredRoom(room.id)}
            onMouseLeave={() => setHoveredRoom(null)}
          >
            {/* Dot */}
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
            {/* Label */}
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
  );
}
