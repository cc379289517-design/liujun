"use client";

import { useEffect, useRef, useState } from "react";

export default function AvatarModal({
  currentAvatar,
  onClose,
  onSave,
}: {
  currentAvatar: string | null;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(currentAvatar);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState({ panX: 0, panY: 0, zoom: 1 });
  const [dragging, setDragging] = useState<{ startX: number; startY: number; origPanX: number; origPanY: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const VIEWPORT = 220;

  // Base scale: make image cover the viewport at zoom=1
  const baseScale = imgEl ? Math.max(VIEWPORT / imgEl.width, VIEWPORT / imgEl.height) : 1;
  const baseW = imgEl ? imgEl.width * baseScale : 0;
  const baseH = imgEl ? imgEl.height * baseScale : 0;

  // Load image element when src changes
  useEffect(() => {
    if (!imgSrc) { setImgEl(null); return; }
    const img = new Image();
    img.onload = () => {
      setImgEl(img);
      setView({ panX: 0, panY: 0, zoom: 1 });
    };
    img.src = imgSrc;
  }, [imgSrc]);

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => setImgSrc(reader.result as string);
    reader.readAsDataURL(file);
  }

  // Drag to reposition
  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      setView((v) => ({
        ...v,
        panX: dragging.origPanX + e.clientX - dragging.startX,
        panY: dragging.origPanY + e.clientY - dragging.startY,
      }));
    };
    const handleUp = () => setDragging(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => { window.removeEventListener("mousemove", handleMove); window.removeEventListener("mouseup", handleUp); };
  }, [dragging]);

  function handleSave() {
    if (!imgEl) return;
    setSaving(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = 512;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const ratio = size / VIEWPORT;
    // Compute where the image visually sits relative to the viewport
    const effScale = baseScale * view.zoom;
    const imgLeft = VIEWPORT / 2 + view.panX - (imgEl.width * effScale) / 2;
    const imgTop = VIEWPORT / 2 + view.panY - (imgEl.height * effScale) / 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(imgEl, imgLeft * ratio, imgTop * ratio, imgEl.width * effScale * ratio, imgEl.height * effScale * ratio);
    onSave(canvas.toDataURL("image/jpeg", 0.85));
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[200]" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-[320px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-800">更换头像</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-black/5 flex items-center justify-center transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Circular preview */}
        <div className="flex justify-center mb-4">
          <div
            className="relative rounded-full overflow-hidden border-2 border-gray-200"
            style={{ width: VIEWPORT, height: VIEWPORT, cursor: imgEl ? "grab" : "default" }}
            onMouseDown={(e) => {
              if (!imgEl) return;
              e.preventDefault();
              setDragging({ startX: e.clientX, startY: e.clientY, origPanX: view.panX, origPanY: view.panY });
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            {imgEl ? (
              <img
                src={imgSrc!}
                alt="preview"
                draggable={false}
                style={{
                  position: "absolute",
                  left: (VIEWPORT - baseW) / 2,
                  top: (VIEWPORT - baseH) / 2,
                  width: baseW,
                  height: baseH,
                  transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
                  transformOrigin: "center center",
                  pointerEvents: "none",
                }}
              />
            ) : (
              <div
                className="w-full h-full bg-gray-50 flex flex-col items-center justify-center text-gray-400 cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span className="text-xs">拖拽或点击上传图片</span>
              </div>
            )}
          </div>
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

        {/* Scale slider */}
        {imgEl && (
          <div className="flex items-center gap-2 mb-4 px-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
            <input
              type="range"
              min={100}
              max={400}
              value={Math.round(view.zoom * 100)}
              onChange={(e) => {
                const newZoom = parseInt(e.target.value) / 100;
                setView((v) => ({ ...v, zoom: newZoom }));
              }}
              className="flex-1 accent-purple-500"
            />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /><line x1="11" y1="8" x2="11" y2="14" /></svg>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 py-2 rounded-xl border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {imgEl ? "重新选择" : "选择图片"}
          </button>
          <button
            onClick={handleSave}
            disabled={!imgEl || saving}
            className="flex-1 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white text-xs font-semibold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}
