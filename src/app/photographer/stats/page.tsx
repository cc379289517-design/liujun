"use client";

import Link from "next/link";

const glass = "bg-white/55 backdrop-blur-2xl border border-white/40 shadow-lg shadow-black/[0.03]";

const stats = [
  { label: "今日完成", value: 12, unit: "单", color: "text-green-600", bg: "bg-green-400/15" },
  { label: "进行中", value: 3, unit: "单", color: "text-orange-600", bg: "bg-orange-400/15" },
  { label: "等待中", value: 5, unit: "单", color: "text-gray-600", bg: "bg-gray-400/15" },
  { label: "已取消", value: 1, unit: "单", color: "text-red-500", bg: "bg-red-400/15" },
];

const weeklyData = [
  { day: "周一", count: 15 },
  { day: "周二", count: 18 },
  { day: "周三", count: 12 },
  { day: "周四", count: 20 },
  { day: "周五", count: 16 },
  { day: "周六", count: 22 },
  { day: "周日", count: 8 },
];
const maxCount = Math.max(...weeklyData.map((d) => d.count));

const recentTasks = [
  { name: "手持", room: "401", time: "09:12", duration: "4分钟", status: "已完成", cls: "text-green-600 bg-green-100/60" },
  { name: "穿戴对角度", room: "403", time: "09:30", duration: "18分钟", status: "已完成", cls: "text-green-600 bg-green-100/60" },
  { name: "熨烫", room: "409", time: "10:05", duration: "12分钟", status: "已完成", cls: "text-green-600 bg-green-100/60" },
  { name: "手工DIY", room: "425", time: "10:40", duration: "35分钟", status: "已完成", cls: "text-green-600 bg-green-100/60" },
  { name: "手持", room: "411", time: "11:20", duration: "3分钟", status: "已完成", cls: "text-green-600 bg-green-100/60" },
  { name: "穿戴对角度", room: "418", time: "11:45", duration: "—", status: "执行中", cls: "text-orange-600 bg-orange-100/60" },
  { name: "手工DIY", room: "426", time: "12:00", duration: "—", status: "等待中", cls: "text-gray-500 bg-gray-100/60" },
  { name: "熨烫", room: "420", time: "12:15", duration: "—", status: "等待中", cls: "text-gray-500 bg-gray-100/60" },
  { name: "手持", room: "405", time: "12:30", duration: "—", status: "等待中", cls: "text-gray-500 bg-gray-100/60" },
  { name: "其他", room: "431", time: "13:00", duration: "—", status: "已取消", cls: "text-red-500 bg-red-100/60" },
];

const typeBreakdown = [
  { name: "手持", count: 8, pct: 38, color: "bg-red-400" },
  { name: "穿戴对角度", count: 5, pct: 24, color: "bg-orange-400" },
  { name: "手工DIY", count: 4, pct: 19, color: "bg-amber-400" },
  { name: "熨烫", count: 3, pct: 14, color: "bg-emerald-400" },
  { name: "其他", count: 1, pct: 5, color: "bg-blue-400" },
];

export default function StatsPage() {
  return (
    <div className="relative w-full h-full overflow-y-auto bg-[#f2f2f4] p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/photographer"
            className={`w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/70 transition ${glass}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <h1 className="text-lg font-bold text-[--text-primary]">我的任务统计</h1>
        </div>
        <div className="flex items-center gap-2">
          <img src="/avatars/zhang.jpg" alt="张三" className="w-8 h-8 rounded-full object-cover" />
          <span className="text-sm font-medium text-[--text-primary]">张三</span>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {stats.map((s) => (
          <div key={s.label} className={`rounded-2xl px-4 py-4 ${glass}`}>
            <p className="text-[11px] text-[--text-muted] mb-1">{s.label}</p>
            <div className="flex items-end gap-1">
              <span className={`text-2xl font-extrabold ${s.color}`}>{s.value}</span>
              <span className="text-[11px] text-[--text-muted] mb-0.5">{s.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Weekly Chart */}
        <div className={`rounded-2xl px-5 py-4 ${glass}`}>
          <h2 className="text-[13px] font-bold text-[--text-primary] mb-4">本周完成趋势</h2>
          <div className="flex items-end gap-3 h-32">
            {weeklyData.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] font-bold text-[--text-primary]">{d.count}</span>
                <div className="w-full rounded-t-md bg-gradient-to-t from-orange-500 to-orange-300" style={{ height: `${(d.count / maxCount) * 100}%` }} />
                <span className="text-[10px] text-[--text-muted]">{d.day}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Type Breakdown */}
        <div className={`rounded-2xl px-5 py-4 ${glass}`}>
          <h2 className="text-[13px] font-bold text-[--text-primary] mb-4">任务类型占比</h2>
          <div className="space-y-2.5">
            {typeBreakdown.map((t) => (
              <div key={t.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] font-medium text-[--text-primary]">{t.name}</span>
                  <span className="text-[11px] text-[--text-muted]">{t.count}单 · {t.pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-black/[0.04] overflow-hidden">
                  <div className={`h-full rounded-full ${t.color}`} style={{ width: `${t.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Tasks Table */}
      <div className={`rounded-2xl px-5 py-4 ${glass}`}>
        <h2 className="text-[13px] font-bold text-[--text-primary] mb-3">今日任务明细</h2>
        <div className="space-y-1.5">
          <div className="flex items-center text-[10px] text-[--text-muted] font-semibold px-3 py-1">
            <span className="w-[20%]">类型</span>
            <span className="w-[15%]">房间</span>
            <span className="w-[15%]">时间</span>
            <span className="w-[20%]">用时</span>
            <span className="w-[15%]">状态</span>
          </div>
          {recentTasks.map((t, i) => (
            <div
              key={i}
              className="flex items-center text-[11px] px-3 py-2 rounded-lg hover:bg-white/30 transition-colors"
            >
              <span className="w-[20%] font-medium text-[--text-primary]">{t.name}</span>
              <span className="w-[15%] text-[--text-muted]">{t.room}室</span>
              <span className="w-[15%] text-[--text-muted] tabular-nums">{t.time}</span>
              <span className="w-[20%] text-[--text-muted]">{t.duration}</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${t.cls}`}>{t.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
