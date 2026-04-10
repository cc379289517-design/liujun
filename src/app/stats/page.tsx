"use client";

import { useRouter } from "next/navigation";
import StatsTab from "../admin/StatsTab";

function ChromeTab({ fill }: { fill: string }) {
  return (
    <svg
      viewBox="0 0 200 40"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full"
    >
      <path
        d="M 0 40 L 0 40 C 4 40, 8 36, 12 10 C 14 2, 18 0, 24 0 L 176 0 C 182 0, 186 2, 188 10 C 192 36, 196 40, 200 40 L 200 40 Z"
        fill={fill}
      />
    </svg>
  );
}

export default function StatsPage() {
  const router = useRouter();

  return (
    <div className="h-screen overflow-y-scroll bg-gray-50/50 px-8 py-6">
      <div className="flex flex-col max-w-[1200px] mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => router.push("/photographer")}
            className="flex items-center gap-1.5 text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span className="text-sm font-semibold">返回工作台</span>
          </button>
        </div>

        {/* Chrome-style tab + content */}
        <div className="relative">
          {/* Single active tab */}
          <div className="relative flex items-end" style={{ height: "72px", zIndex: 1 }}>
            <div
              className="absolute bottom-0 flex items-center justify-center"
              style={{ left: 0, width: 240, height: 72, zIndex: 20, transform: "translateX(12px) scale(1.02)", transformOrigin: "bottom center" }}
            >
              <ChromeTab fill="#ffffff" />
              <span
                className="relative z-10 font-extrabold select-none whitespace-nowrap"
                style={{ color: "#ef4444", fontSize: "28px" }}
              >
                数据统计
              </span>
            </div>
          </div>

          {/* Content area */}
          <div
            className="relative bg-white rounded-2xl shadow-sm p-6"
            style={{ minHeight: "calc(100vh - 200px)" }}
          >
            <StatsTab />
          </div>
        </div>
      </div>
    </div>
  );
}
