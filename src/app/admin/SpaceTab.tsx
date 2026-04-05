"use client";

import { useState, useRef, useEffect } from "react";
import MapEditor from "./components/MapEditor";
import type { Venue } from "./components/MapEditor";

type Building = {
  id: number;
  name: string;
  floorPlanUrl: string | null;
  cropX?: number | null;
  cropY?: number | null;
  cropW?: number | null;
  cropH?: number | null;
  extraVenues: string | null;
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

interface SpaceTabProps {
  buildings: Building[];
  onRefresh: () => void;
}

export default function SpaceTab({ buildings: buildingsProp, onRefresh }: SpaceTabProps) {
  const [localBuildings, setLocalBuildings] = useState<Building[]>(buildingsProp);
  const [selectedBuildingId, setSelectedBuildingId] = useState<number | null>(null);
  const [showBuildingModal, setShowBuildingModal] = useState(false);
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newVenue, setNewVenue] = useState("");
  const [newVenueType, setNewVenueType] = useState<"实景棚" | "无影棚">("实景棚");
  const [cropMode, setCropMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync from parent when prop changes (e.g. initial load or tab switch)
  useEffect(() => {
    setLocalBuildings(buildingsProp);
  }, [buildingsProp]);

  // Auto-select the first building when list loads and nothing is selected
  useEffect(() => {
    if (selectedBuildingId === null && localBuildings.length > 0) {
      setSelectedBuildingId(localBuildings[0].id);
    }
  }, [localBuildings, selectedBuildingId]);

  const selectedBuilding = localBuildings.find((b) => b.id === selectedBuildingId) || null;

  // Helper to update a single building's rooms locally
  function updateBuildingRooms(buildingId: number, updater: (rooms: Room[]) => Room[]) {
    setLocalBuildings((prev) =>
      prev.map((b) => (b.id === buildingId ? { ...b, rooms: updater(b.rooms) } : b))
    );
  }

  // --- API helpers ---

  async function createBuilding(name: string) {
    await fetch("/api/buildings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    onRefresh();
  }

  async function deleteBuilding(id: number) {
    if (!confirm("确定删除此楼座？其下所有房间将一并删除。")) return;
    await fetch(`/api/buildings/${id}`, { method: "DELETE" });
    if (selectedBuildingId === id) setSelectedBuildingId(null);
    onRefresh();
  }

  async function createRoom(buildingId: number, roomNumber: string, floor: number, fenceRadius: number) {
    const res = await fetch(`/api/buildings/${buildingId}/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomNumber, floor, fenceRadius }),
    });
    if (res.ok) {
      const newRoom: Room = await res.json();
      updateBuildingRooms(buildingId, (rooms) => [...rooms, newRoom]);
    }
  }

  async function deleteRoom(buildingId: number, roomId: number) {
    if (!confirm("确定删除此房间？")) return;
    const res = await fetch(`/api/buildings/${buildingId}/rooms?roomId=${roomId}`, { method: "DELETE" });
    if (res.ok) {
      updateBuildingRooms(buildingId, (rooms) => rooms.filter((r) => r.id !== roomId));
    }
  }

  async function updateRoomCoords(buildingId: number, roomId: number, xPosition: number, yPosition: number, fenceRadius: number) {
    // Optimistic local update first
    updateBuildingRooms(buildingId, (rooms) =>
      rooms.map((r) => (r.id === roomId ? { ...r, xPosition, yPosition, fenceRadius } : r))
    );
    await fetch(`/api/buildings/${buildingId}/rooms`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, xPosition, yPosition, fenceRadius }),
    });
  }

  async function updateBuildingCrop(buildingId: number, crop: { cropX: number; cropY: number; cropW: number; cropH: number } | null) {
    const data = crop || { cropX: null, cropY: null, cropW: null, cropH: null };
    // Optimistic local update
    setLocalBuildings((prev) =>
      prev.map((b) => (b.id === buildingId ? { ...b, ...data } : b))
    );
    await fetch(`/api/buildings/${buildingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  function getExtraVenues(building: Building): Venue[] {
    if (!building.extraVenues) return [];
    try {
      const parsed = JSON.parse(building.extraVenues);
      // Backward compat: old format was string[], new format is {name,x,y}[]
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "string") {
        return (parsed as string[]).map((name) => ({ name, x: 50, y: 50 }));
      }
      return parsed as Venue[];
    } catch { return []; }
  }

  async function updateExtraVenues(buildingId: number, venues: Venue[]) {
    const extraVenues = JSON.stringify(venues);
    setLocalBuildings((prev) =>
      prev.map((b) => (b.id === buildingId ? { ...b, extraVenues } : b))
    );
    await fetch(`/api/buildings/${buildingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraVenues }),
    });
  }

  async function uploadFloorPlan(buildingId: number, file: File) {
    setUploading(true);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch(`/api/buildings/${buildingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ floorPlanUrl: dataUrl }),
      });
      if (res.ok) {
        setLocalBuildings((prev) =>
          prev.map((b) => (b.id === buildingId ? { ...b, floorPlanUrl: dataUrl } : b))
        );
      }
    } catch (err) {
      console.error("Upload failed", err);
    }
    setUploading(false);
  }

  function handleFloorPlanDrop(e: React.DragEvent) {
    e.preventDefault();
    if (!selectedBuilding) return;
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      uploadFloorPlan(selectedBuilding.id, file);
    }
  }

  function handleFloorPlanSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (!selectedBuilding) return;
    const file = e.target.files?.[0];
    if (file) uploadFloorPlan(selectedBuilding.id, file);
  }

  return (
    <div className="flex gap-3">
      {/* Left Panel: Building List */}
      <div className="w-60 shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-[--text-primary]">
            楼座列表 ({localBuildings.length})
          </h3>
          <button
            onClick={() => setShowBuildingModal(true)}
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white text-xs font-semibold shadow-sm shadow-purple-200 hover:shadow-purple-300 transition-all active:scale-[0.98]"
          >
            + 添加楼座
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1.5 task-scroll">
          {localBuildings.map((b) => (
            <div
              key={b.id}
              onClick={() => setSelectedBuildingId(b.id)}
              className={`card p-3 cursor-pointer transition-all ${
                selectedBuildingId === b.id
                  ? "ring-2 ring-purple-400 shadow-md"
                  : "hover:shadow-md"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                    <span className="text-blue-600 text-xs font-bold">{b.name[0]}</span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[--text-primary]">{b.name}</p>
                    <p className="text-[10px] text-[--text-muted]">{b.rooms.length} 个房间</p>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteBuilding(b.id); }}
                  className="text-[10px] px-2 py-1 rounded-lg bg-red-50 text-red-600 font-medium hover:bg-red-100 transition-colors"
                >
                  删除
                </button>
              </div>
            </div>
          ))}

          {localBuildings.length === 0 && (
            <div className="text-center py-12 text-[--text-muted] text-sm">暂无楼座</div>
          )}
        </div>
      </div>

      {/* Right Panel: Building Detail */}
      <div className="flex-1 overflow-hidden">
        {!selectedBuilding ? (
          <div className="flex items-center justify-center h-full text-[--text-muted] text-sm">
            请从左侧选择一栋楼座
          </div>
        ) : (
          <div className="space-y-3">
            {/* Building Header — just name */}
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[--text-primary]">{selectedBuilding.name}</h2>
              {!cropMode && selectedBuilding.cropX != null && (
                <span className="text-[10px] text-green-600 font-medium">已设置主体范围</span>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFloorPlanSelect}
            />

            {/* Floor Plan Upload — only when no image yet */}
            {!selectedBuilding.floorPlanUrl && (
              <div
                className={`border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-colors ${
                  uploading ? "border-purple-300 bg-purple-50" : "border-gray-200 hover:border-purple-300"
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFloorPlanDrop}
              >
                {uploading ? (
                  <p className="text-sm text-purple-600 font-medium">上传中...</p>
                ) : (
                  <>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9333ea" strokeWidth="1.5" className="mx-auto mb-2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <p className="text-xs text-[--text-secondary]">拖拽或点击上传平面图</p>
                  </>
                )}
              </div>
            )}

            {/* Map + Right Sidebar */}
            {selectedBuilding.floorPlanUrl && (
              <div className="flex gap-3 items-start">
                {/* Map Editor — takes remaining space */}
                <div className="flex-1 min-w-0">
                  <MapEditor
                    building={selectedBuilding}
                    rooms={selectedBuilding.rooms}
                    venues={getExtraVenues(selectedBuilding)}
                    cropMode={cropMode}
                    onRoomUpdate={(roomId, x, y, fenceRadius) =>
                      updateRoomCoords(selectedBuilding.id, roomId, x, y, fenceRadius)
                    }
                    onVenueUpdate={(venueName, x, y) => {
                      const venues = getExtraVenues(selectedBuilding).map((v) =>
                        v.name === venueName ? { ...v, x, y } : v
                      );
                      updateExtraVenues(selectedBuilding.id, venues);
                    }}
                    onCropUpdate={(crop) => updateBuildingCrop(selectedBuilding.id, crop)}
                    onCropModeChange={setCropMode}
                  />
                </div>

                {/* Right Sidebar — all actions */}
                <div className="w-48 shrink-0 space-y-2">
                  {/* 1. 框选主体范围 */}
                  <div className="card p-3">
                    <button
                      onClick={() => setCropMode(!cropMode)}
                      className={`w-full flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                        cropMode
                          ? "bg-orange-100 text-orange-700 ring-2 ring-orange-400"
                          : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 2v14a2 2 0 0 0 2 2h14" />
                        <path d="M18 22V8a2 2 0 0 0-2-2H2" />
                      </svg>
                      {cropMode ? "正在框选…" : "框选主体范围"}
                    </button>
                  </div>

                  {/* 2. 更换平面图 */}
                  <div className="card p-3">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-purple-50 text-purple-600 text-xs font-medium hover:bg-purple-100 transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      {uploading ? "上传中..." : "更换平面图"}
                    </button>
                  </div>

                  {/* 3. 添加房间 */}
                  <div className="card p-3">
                    <button
                      onClick={() => setShowRoomModal(true)}
                      className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-green-50 text-green-600 text-xs font-medium hover:bg-green-100 transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      添加房间
                    </button>
                  </div>

                  {/* 4. 添加额外场地 */}
                  <div className="card p-3">
                    <div className="flex gap-1.5 mb-2">
                      <input
                        value={newVenue}
                        onChange={(e) => setNewVenue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newVenue.trim()) {
                            const venues = getExtraVenues(selectedBuilding);
                            if (!venues.some((v) => v.name === newVenue.trim())) {
                              updateExtraVenues(selectedBuilding.id, [...venues, { name: newVenue.trim(), x: 50, y: 50, type: newVenueType }]);
                            }
                            setNewVenue("");
                          }
                        }}
                        className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-[--bg-base] border border-gray-200 text-[11px] outline-none focus:border-blue-400 transition-colors"
                        placeholder="场地名称"
                      />
                      <select
                        value={newVenueType}
                        onChange={(e) => setNewVenueType(e.target.value as "实景棚" | "无影棚")}
                        className="px-1.5 py-1.5 rounded-lg bg-[--bg-base] border border-gray-200 text-[11px] outline-none focus:border-blue-400 transition-colors"
                      >
                        <option value="实景棚">实景棚</option>
                        <option value="无影棚">无影棚</option>
                      </select>
                      <button
                        onClick={() => {
                          if (!newVenue.trim()) return;
                          const venues = getExtraVenues(selectedBuilding);
                          if (!venues.some((v) => v.name === newVenue.trim())) {
                            updateExtraVenues(selectedBuilding.id, [...venues, { name: newVenue.trim(), x: 50, y: 50, type: newVenueType }]);
                          }
                          setNewVenue("");
                        }}
                        className="px-2 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-semibold hover:bg-blue-600 transition-colors shrink-0"
                      >
                        +
                      </button>
                    </div>
                    {getExtraVenues(selectedBuilding).length > 0 && (
                      <div className="space-y-1 max-h-32 overflow-y-auto task-scroll">
                        {getExtraVenues(selectedBuilding).map((venue) => (
                          <div
                            key={venue.name}
                            className={`flex items-center justify-between px-2 py-1 rounded-lg group ${venue.type === "无影棚" ? "bg-gray-50" : "bg-blue-50"}`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div className={`w-2 h-2 rounded-sm shrink-0 ${venue.type === "无影棚" ? "bg-gray-400" : "bg-blue-500"}`} style={{ transform: "rotate(45deg)" }} />
                              <span className={`text-[11px] font-medium truncate ${venue.type === "无影棚" ? "text-gray-600" : "text-blue-700"}`}>{venue.name}</span>
                              <span className="text-[9px] text-gray-400">{venue.type || "实景棚"}</span>
                            </div>
                            <button
                              onClick={() => {
                                const venues = getExtraVenues(selectedBuilding).filter((v) => v.name !== venue.name);
                                updateExtraVenues(selectedBuilding.id, venues);
                              }}
                              className="text-blue-300 hover:text-red-500 transition-colors text-sm leading-none ml-1 shrink-0 opacity-0 group-hover:opacity-100"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Room List — below the map */}
            {selectedBuilding.rooms.length > 0 && (
              <div className="card p-4">
                <h3 className="text-xs font-semibold text-[--text-primary] mb-2">
                  房间列表 ({selectedBuilding.rooms.length})
                </h3>
                <div className="space-y-1">
                  <div className="grid grid-cols-6 gap-2 px-2 text-[10px] text-[--text-muted] font-medium uppercase tracking-wider">
                    <span>房间号</span>
                    <span>楼层</span>
                    <span>围栏半径</span>
                    <span>X 坐标</span>
                    <span>Y 坐标</span>
                    <span>操作</span>
                  </div>
                  {selectedBuilding.rooms.map((room) => (
                    <div
                      key={room.id}
                      className="grid grid-cols-6 gap-2 px-2 py-2 rounded-xl bg-[--bg-base] hover:bg-gray-100 transition-colors items-center"
                    >
                      <span className="text-xs font-medium text-[--text-primary]">{room.roomNumber}</span>
                      <span className="text-xs text-[--text-secondary]">{room.floor}F</span>
                      <span className="text-xs text-[--text-secondary]">{room.fenceRadius}m</span>
                      <span className="text-xs text-[--text-muted] font-mono">
                        {room.xPosition ? `${room.xPosition.toFixed(1)}%` : "—"}
                      </span>
                      <span className="text-xs text-[--text-muted] font-mono">
                        {room.yPosition ? `${room.yPosition.toFixed(1)}%` : "—"}
                      </span>
                      <button
                        onClick={() => deleteRoom(selectedBuilding.id, room.id)}
                        className="text-[10px] px-2 py-1 rounded-lg bg-red-50 text-red-600 font-medium hover:bg-red-100 transition-colors w-fit"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Building Add Modal */}
      {showBuildingModal && (
        <BuildingModal
          onClose={() => setShowBuildingModal(false)}
          onSubmit={(name) => { createBuilding(name); setShowBuildingModal(false); }}
        />
      )}

      {/* Room Add Modal */}
      {showRoomModal && selectedBuilding && (
        <RoomModal
          onClose={() => setShowRoomModal(false)}
          onSubmit={(roomNumber, floor, fenceRadius) => {
            createRoom(selectedBuilding.id, roomNumber, floor, fenceRadius);
            setShowRoomModal(false);
          }}
        />
      )}
    </div>
  );
}

/* ============ Building Modal ============ */
function BuildingModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim());
  }

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="card p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-[--text-primary] mb-4">添加楼座</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-[--text-secondary] mb-1 block">楼座名称 *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-[--bg-base] border border-gray-200 text-sm outline-none focus:border-purple-400 transition-colors"
              placeholder="例如：6号楼"
              required
              autoFocus
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-[--text-secondary] hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white text-sm font-semibold shadow-sm shadow-purple-200 hover:shadow-purple-300 transition-all active:scale-[0.98]"
            >
              确定
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============ Room Modal ============ */
function RoomModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (roomNumber: string, floor: number, fenceRadius: number) => void;
}) {
  const [roomNumber, setRoomNumber] = useState("");
  const [floor, setFloor] = useState("1");
  const [fenceRadius, setFenceRadius] = useState("5");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!roomNumber.trim()) return;
    onSubmit(roomNumber.trim(), parseInt(floor) || 1, parseInt(fenceRadius) || 5);
  }

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="card p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-[--text-primary] mb-4">添加房间</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-[--text-secondary] mb-1 block">房间号 *</label>
            <input
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-[--bg-base] border border-gray-200 text-sm outline-none focus:border-purple-400 transition-colors"
              placeholder="例如：101"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[--text-secondary] mb-1 block">楼层 *</label>
            <input
              type="number"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-[--bg-base] border border-gray-200 text-sm outline-none focus:border-purple-400 transition-colors"
              placeholder="例如：1"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[--text-secondary] mb-1 block">围栏半径 (米)</label>
            <input
              type="number"
              value={fenceRadius}
              onChange={(e) => setFenceRadius(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-[--bg-base] border border-gray-200 text-sm outline-none focus:border-purple-400 transition-colors"
              placeholder="默认：5"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-[--text-secondary] hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white text-sm font-semibold shadow-sm shadow-purple-200 hover:shadow-purple-300 transition-all active:scale-[0.98]"
            >
              确定
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
