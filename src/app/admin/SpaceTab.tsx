"use client";

import { useState, useRef, useEffect } from "react";
import MapEditor from "./components/MapEditor";
import type { IroningMachine, Venue, VenuePoint } from "./components/MapEditor";
import { WORKBENCH_PAGE_BACKGROUND_CONFIG_KEY } from "@/lib/workbenchBackground";

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
  ironingMachines: IroningMachine[];
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
  config: Record<string, { value: string; label: string | null }>;
  onRefresh: () => void;
}

export default function SpaceTab({ buildings: buildingsProp, config, onRefresh }: SpaceTabProps) {
  const [localBuildings, setLocalBuildings] = useState<Building[]>(buildingsProp);
  const [selectedBuildingId, setSelectedBuildingId] = useState<number | null>(null);
  const [showBuildingModal, setShowBuildingModal] = useState(false);
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [backgroundUploading, setBackgroundUploading] = useState(false);
  const [pageBackgroundUrl, setPageBackgroundUrl] = useState(config[WORKBENCH_PAGE_BACKGROUND_CONFIG_KEY]?.value ?? "");
  const [newVenue, setNewVenue] = useState("");
  const [newVenueType, setNewVenueType] = useState<"实景棚" | "无影棚">("实景棚");
  const [newMachineCount, setNewMachineCount] = useState("1");
  const [cropMode, setCropMode] = useState(false);
  const [areaEditVenueName, setAreaEditVenueName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const venuePalette = ["#3b82f6", "#14b8a6", "#f97316", "#a855f7", "#22c55e", "#ec4899", "#06b6d4", "#f59e0b"];

  // Sync from parent when prop changes (e.g. initial load or tab switch)
  useEffect(() => {
    setLocalBuildings(buildingsProp);
  }, [buildingsProp]);

  useEffect(() => {
    setPageBackgroundUrl(config[WORKBENCH_PAGE_BACKGROUND_CONFIG_KEY]?.value ?? "");
  }, [config]);

  // Auto-select the first building when list loads and nothing is selected
  useEffect(() => {
    if (selectedBuildingId === null && localBuildings.length > 0) {
      setSelectedBuildingId(localBuildings[0].id);
    }
  }, [localBuildings, selectedBuildingId]);

  useEffect(() => {
    setAreaEditVenueName(null);
  }, [selectedBuildingId]);

  const selectedBuilding = localBuildings.find((b) => b.id === selectedBuildingId) || null;

  // Helper to update a single building's rooms locally
  function updateBuildingRooms(buildingId: number, updater: (rooms: Room[]) => Room[]) {
    setLocalBuildings((prev) =>
      prev.map((b) => (b.id === buildingId ? { ...b, rooms: updater(b.rooms) } : b))
    );
  }

  function updateBuildingMachines(buildingId: number, updater: (machines: IroningMachine[]) => IroningMachine[]) {
    setLocalBuildings((prev) =>
      prev.map((b) =>
        b.id === buildingId
          ? { ...b, ironingMachines: updater(b.ironingMachines ?? []) }
          : b
      )
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

  async function createIroningMachines(buildingId: number, count: number) {
    const safeCount = Math.min(20, Math.max(1, Math.round(count) || 1));
    const res = await fetch(`/api/buildings/${buildingId}/ironing-machines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: safeCount }),
    });
    if (res.ok) {
      const data = await res.json();
      const machines = Array.isArray(data) ? data : [data];
      updateBuildingMachines(buildingId, (prev) => [...prev, ...machines]);
    }
  }

  async function updateIroningMachine(
    buildingId: number,
    machineId: number,
    patch: Partial<Pick<IroningMachine, "name" | "status" | "xPosition" | "yPosition" | "sortRank">>
  ) {
    updateBuildingMachines(buildingId, (machines) =>
      machines.map((machine) => (machine.id === machineId ? { ...machine, ...patch } : machine))
    );
    await fetch(`/api/buildings/${buildingId}/ironing-machines`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machineId, ...patch }),
    });
  }

  async function deleteIroningMachine(buildingId: number, machineId: number) {
    if (!confirm("确定删除这台熨烫机？")) return;
    const res = await fetch(`/api/buildings/${buildingId}/ironing-machines?machineId=${machineId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      updateBuildingMachines(buildingId, (machines) => machines.filter((machine) => machine.id !== machineId));
    }
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
        return (parsed as string[]).map((name, index) => ({ name, x: 50, y: 50, color: venuePalette[index % venuePalette.length] }));
      }
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item, index): Venue | null => {
          if (!item || typeof item !== "object" || !("name" in item)) return null;
          const raw = item as Partial<Venue>;
          const name = String(raw.name ?? "");
          if (!name) return null;
          return {
            name,
            x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : 50,
            y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : 50,
            type: raw.type,
            color: raw.color || venuePalette[index % venuePalette.length],
            polygon: Array.isArray(raw.polygon)
              ? raw.polygon
                  .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
                  .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
              : undefined,
          };
        })
        .filter((venue): venue is Venue => venue !== null);
    } catch { return []; }
  }

  function makeVenue(name: string, type: "实景棚" | "无影棚", existingCount: number): Venue {
    return {
      name,
      x: 50,
      y: 50,
      type,
      color: venuePalette[existingCount % venuePalette.length],
    };
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

  function saveVenueArea(building: Building, venueName: string, polygon: VenuePoint[]) {
    const venues = getExtraVenues(building);
    void updateExtraVenues(
      building.id,
      venues.map((venue) => (venue.name === venueName ? { ...venue, polygon } : venue))
    );
    setAreaEditVenueName(null);
  }

  function clearVenueArea(building: Building, venueName: string) {
    const venues = getExtraVenues(building);
    void updateExtraVenues(
      building.id,
      venues.map((venue) => {
        if (venue.name !== venueName) return venue;
        const { polygon: _polygon, ...rest } = venue;
        return rest;
      })
    );
    if (areaEditVenueName === venueName) setAreaEditVenueName(null);
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

  async function savePageBackground(dataUrl: string) {
    await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [WORKBENCH_PAGE_BACKGROUND_CONFIG_KEY]: dataUrl }),
    });
    setPageBackgroundUrl(dataUrl);
    onRefresh();
  }

  async function uploadPageBackground(file: File) {
    if (!file.type.startsWith("image/")) return;
    setBackgroundUploading(true);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await savePageBackground(dataUrl);
    } catch (err) {
      console.error("Page background upload failed", err);
    } finally {
      setBackgroundUploading(false);
      if (backgroundInputRef.current) backgroundInputRef.current.value = "";
    }
  }

  function handlePageBackgroundSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void uploadPageBackground(file);
  }

  function handlePageBackgroundDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void uploadPageBackground(file);
  }

  async function clearPageBackground() {
    await savePageBackground("");
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

  const buildingListPanel = (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-[--text-primary]">
          楼座列表 ({localBuildings.length})
        </h3>
        <button
          onClick={() => setShowBuildingModal(true)}
          className="rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-purple-200 transition-all hover:shadow-purple-300 active:scale-[0.98]"
        >
          + 添加楼座
        </button>
      </div>

      <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1 task-scroll">
        {localBuildings.map((b) => (
          <div
            key={b.id}
            onClick={() => setSelectedBuildingId(b.id)}
            className={`rounded-2xl border p-3 cursor-pointer transition-all ${
              selectedBuildingId === b.id
                ? "border-indigo-200 bg-white/82 ring-2 ring-indigo-300/80 shadow-md"
                : "border-white/60 bg-white/56 hover:bg-white/76 hover:shadow-md"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                  <span className="text-xs font-bold text-blue-600">{b.name[0]}</span>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-[--text-primary]">{b.name}</p>
                  <p className="text-[10px] text-[--text-muted]">{b.rooms.length} 个房间</p>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteBuilding(b.id); }}
                className="rounded-lg bg-red-50 px-2 py-1 text-[10px] font-medium text-red-600 transition-colors hover:bg-red-100"
              >
                删除
              </button>
            </div>
          </div>
        ))}

        {localBuildings.length === 0 && (
          <div className="py-12 text-center text-sm text-[--text-muted]">暂无楼座</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="card overflow-hidden p-4">
        <input
          ref={backgroundInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePageBackgroundSelect}
        />
        <div className="flex items-stretch gap-4">
          <div
            className={`relative h-24 w-40 shrink-0 overflow-hidden rounded-xl border border-white/70 bg-white/45 ${
              backgroundUploading ? "ring-2 ring-orange-300" : ""
            }`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handlePageBackgroundDrop}
          >
            {pageBackgroundUrl ? (
              <img src={pageBackgroundUrl} alt="页面背景预览" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/70 to-slate-100/70">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-[--text-primary]">页面背景素材</h3>
              <p className="mt-1 text-xs font-medium leading-relaxed text-[--text-muted]">
                上传后会作为摄影师/助理工作台的整页背景，自动居中铺满页面。
              </p>
              <p className="mt-1 text-[10px] font-semibold text-gray-400">支持 JPG / PNG / WebP，建议使用横向高清素材。</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {pageBackgroundUrl && (
                <button
                  type="button"
                  onClick={() => void clearPageBackground()}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-500 transition-colors hover:bg-gray-50"
                >
                  清除背景
                </button>
              )}
              <button
                type="button"
                onClick={() => backgroundInputRef.current?.click()}
                disabled={backgroundUploading}
                className="rounded-xl bg-orange-500 px-4 py-2 text-xs font-bold text-white shadow-sm shadow-orange-200 transition-all hover:bg-orange-600 active:scale-[0.98] disabled:opacity-60"
              >
                {backgroundUploading ? "上传中..." : pageBackgroundUrl ? "更换素材" : "上传素材"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden">
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
                  uploading ? "border-purple-300 bg-purple-50/70" : "border-white/70 bg-white/30 hover:border-purple-300"
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
              <div className="grid items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_280px] lg:grid-cols-[minmax(0,1fr)_260px]">
                {/* Map Editor — takes remaining space */}
                <div className="min-w-0">
                  <MapEditor
                    building={selectedBuilding}
                    rooms={selectedBuilding.rooms}
                    venues={getExtraVenues(selectedBuilding)}
                    ironingMachines={selectedBuilding.ironingMachines ?? []}
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
                    onIroningMachineUpdate={(machineId, x, y) =>
                      updateIroningMachine(selectedBuilding.id, machineId, { xPosition: x, yPosition: y })
                    }
                    areaEditVenueName={areaEditVenueName}
                    onVenueAreaSave={(venueName, polygon) => saveVenueArea(selectedBuilding, venueName, polygon)}
                    onVenueAreaCancel={() => setAreaEditVenueName(null)}
                    onCropUpdate={(crop) => updateBuildingCrop(selectedBuilding.id, crop)}
                    onCropModeChange={setCropMode}
                  />
                </div>

                {/* Right Sidebar — all actions */}
                <div className="flex min-h-full flex-col gap-2">
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
                    {areaEditVenueName && (
                      <p className="mt-2 text-[10px] font-semibold leading-relaxed text-blue-600">
                        正在编辑公共区域范围
                      </p>
                    )}
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

                  {/* 4. 熨烫机管理 */}
                  <div className="card p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-[--text-primary]">
                        熨烫机管理 ({(selectedBuilding.ironingMachines ?? []).length})
                      </h3>
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-bold text-red-500">
                        可拖拽定位
                      </span>
                    </div>
                    <div className="mb-2 flex gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={newMachineCount}
                        onChange={(e) => setNewMachineCount(e.target.value)}
                        className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-[--bg-base] px-2 py-1.5 text-[11px] outline-none transition-colors focus:border-red-400"
                        placeholder="新增台数"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          createIroningMachines(selectedBuilding.id, Number(newMachineCount));
                          setNewMachineCount("1");
                        }}
                        className="shrink-0 rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-600"
                      >
                        添加
                      </button>
                    </div>
                    {(selectedBuilding.ironingMachines ?? []).length > 0 ? (
                      <div className="max-h-36 space-y-1 overflow-y-auto pr-1 task-scroll">
                        {(selectedBuilding.ironingMachines ?? []).map((machine) => (
                          <div
                            key={machine.id}
                            className="admin-table-row flex items-center gap-1.5 rounded-lg px-2 py-1.5"
                          >
                            <div className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-red-200 bg-white/80">
                              <svg width="16" height="16" viewBox="0 0 96 96" fill="none" aria-hidden="true">
                                <path d="M21 52c0-12 8-22 20-22h20c8 0 14 6 14 14v8" stroke={machine.status === "maintenance" ? "#94a3b8" : "#f05b51"} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M19 55h58c4 0 7 3 7 7v4c0 5-4 9-9 9H24c-6 0-10-4-10-10v-3c0-4 2-7 5-7Z" stroke={machine.status === "maintenance" ? "#94a3b8" : "#f05b51"} strokeWidth="8" strokeLinejoin="round" />
                                <path d="M36 30V20h24c7 0 12 5 12 12" stroke={machine.status === "maintenance" ? "#94a3b8" : "#f05b51"} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[11px] font-bold text-slate-700">{machine.name}</p>
                              <p className="text-[9px] font-semibold text-gray-400">
                                X {machine.xPosition.toFixed(1)}% · Y {machine.yPosition.toFixed(1)}%
                              </p>
                            </div>
                            <select
                              value={machine.status}
                              onChange={(e) =>
                                updateIroningMachine(selectedBuilding.id, machine.id, {
                                  status: e.target.value as IroningMachine["status"],
                                })
                              }
                              className="rounded-lg border border-gray-200 bg-white/70 px-1.5 py-1 text-[10px] font-bold text-slate-600 outline-none"
                            >
                              <option value="normal">正常运行</option>
                              <option value="maintenance">维修不可用</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => deleteIroningMachine(selectedBuilding.id, machine.id)}
                              className="shrink-0 text-sm leading-none text-red-300 transition-colors hover:text-red-500"
                              aria-label={`删除${machine.name}`}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-lg bg-gray-50/80 px-2 py-2 text-center text-[10px] font-semibold text-[--text-muted]">
                        暂无熨烫机
                      </p>
                    )}
                  </div>

                  {/* 5. 添加额外场地 */}
                  <div className="card flex min-h-0 flex-1 flex-col p-3">
                    <div className="flex gap-1.5 mb-2">
                      <input
                        value={newVenue}
                        onChange={(e) => setNewVenue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newVenue.trim()) {
                            const venues = getExtraVenues(selectedBuilding);
                            if (!venues.some((v) => v.name === newVenue.trim())) {
                              updateExtraVenues(selectedBuilding.id, [...venues, makeVenue(newVenue.trim(), newVenueType, venues.length)]);
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
                            updateExtraVenues(selectedBuilding.id, [...venues, makeVenue(newVenue.trim(), newVenueType, venues.length)]);
                          }
                          setNewVenue("");
                        }}
                        className="px-2 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-semibold hover:bg-blue-600 transition-colors shrink-0"
                      >
                        +
                      </button>
                    </div>
                    {getExtraVenues(selectedBuilding).length > 0 && (
                      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 task-scroll">
                        {getExtraVenues(selectedBuilding).map((venue) => (
                          <div
                            key={venue.name}
                            className={`admin-table-row flex flex-col gap-1 px-2 py-1.5 rounded-lg group ${areaEditVenueName === venue.name ? "ring-2 ring-blue-300" : ""}`}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <div className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: venue.color || "#3b82f6", transform: "rotate(45deg)" }} />
                                <span className="truncate text-[11px] font-bold text-slate-700">{venue.name}</span>
                                <span className="shrink-0 text-[9px] font-semibold text-gray-400">{venue.type || "实景棚"}</span>
                              </div>
                              <button
                                onClick={() => {
                                  const venues = getExtraVenues(selectedBuilding).filter((v) => v.name !== venue.name);
                                  updateExtraVenues(selectedBuilding.id, venues);
                                }}
                                className="shrink-0 text-sm leading-none text-blue-300 opacity-0 transition-colors hover:text-red-500 group-hover:opacity-100"
                              >
                                ×
                              </button>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setCropMode(false);
                                  setAreaEditVenueName((prev) => (prev === venue.name ? null : venue.name));
                                }}
                                className={`rounded-lg px-2 py-1 text-[10px] font-bold transition-colors ${
                                  areaEditVenueName === venue.name
                                    ? "bg-blue-500 text-white"
                                    : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                                }`}
                              >
                                {venue.polygon && venue.polygon.length >= 3 ? "重画范围" : "框选范围"}
                              </button>
                              {venue.polygon && venue.polygon.length >= 3 && (
                                <button
                                  type="button"
                                  onClick={() => clearVenueArea(selectedBuilding, venue.name)}
                                  className="rounded-lg bg-red-50 px-2 py-1 text-[10px] font-bold text-red-500 transition-colors hover:bg-red-100"
                                >
                                  清除
                                </button>
                              )}
                              {venue.polygon && venue.polygon.length >= 3 && (
                                <span className="ml-auto shrink-0 rounded-full bg-green-50 px-1.5 py-0.5 text-[9px] font-bold text-green-600">
                                  {venue.polygon.length}点
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-[320px_minmax(0,1fr)] items-start gap-3">
              {buildingListPanel}

              {/* Room List — below the map */}
              <div className="card p-4">
                <h3 className="mb-2 text-xs font-semibold text-[--text-primary]">
                  房间列表 ({selectedBuilding.rooms.length})
                </h3>
                {selectedBuilding.rooms.length > 0 ? (
                  <div className="space-y-1">
                    <div className="admin-table-head grid grid-cols-6 gap-2 px-2 py-1.5 rounded-xl text-[10px] text-[--text-muted] font-medium uppercase tracking-wider">
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
                        className="admin-table-row grid grid-cols-6 gap-2 px-2 py-2 rounded-xl bg-[--bg-base] hover:bg-gray-100 transition-colors items-center"
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
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/70 bg-white/40 py-10 text-center text-sm font-semibold text-[--text-muted]">
                    当前楼座暂无房间
                  </div>
                )}
              </div>
            </div>
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
    <div className="admin-modal fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="admin-dialog card p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
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
    <div className="admin-modal fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="admin-dialog card p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
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
