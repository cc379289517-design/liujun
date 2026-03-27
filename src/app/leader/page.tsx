import Link from "next/link";

export default function LeaderPage() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left Sidebar */}
      <aside className="w-[72px] flex flex-col items-center py-6 gap-2 shrink-0">
        <Link
          href="/"
          className="w-11 h-11 rounded-[14px] bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-md shadow-blue-200 mb-4"
        >
          <span className="text-white font-bold text-sm">SP</span>
        </Link>

        <div className="sidebar-icon active" title="仪表盘">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
        </div>
        <div className="sidebar-icon" title="审批">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
        </div>
        <div className="sidebar-icon" title="人员">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <div className="sidebar-icon" title="设置">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
        </div>

        <div className="flex-1" />
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-200 to-blue-300 flex items-center justify-center text-blue-700 text-sm font-medium cursor-pointer">
          周
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-4">
          {/* Header Row */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-[--text-primary]">调度总览</h1>
              <p className="text-sm text-[--text-muted]">2026年3月26日 · 周组长</p>
            </div>
            <div className="flex items-center gap-3">
              <button className="px-4 py-2 rounded-[var(--radius-btn)] bg-[--bg-card] shadow-sm text-sm text-[--text-secondary] hover:bg-gray-100 transition-colors flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                通知
                <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">2</span>
              </button>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "等待中任务", value: "3", icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              ), accent: "text-orange-600", bg: "bg-orange-50", trend: "+2", trendUp: true },
              { label: "执行中任务", value: "5", icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              ), accent: "text-blue-600", bg: "bg-blue-50", trend: "稳定", trendUp: false },
              { label: "空闲助理", value: "4", icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
              ), accent: "text-green-600", bg: "bg-green-50", trend: "4/8", trendUp: false },
              { label: "今日完成", value: "12", icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              ), accent: "text-gray-600", bg: "bg-gray-50", trend: "+5", trendUp: true },
            ].map((s) => (
              <div key={s.label} className="card p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-[--text-muted] font-medium">{s.label}</span>
                  <span className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center`}>
                    {s.icon}
                  </span>
                </div>
                <div className="flex items-end justify-between">
                  <p className={`text-3xl font-bold ${s.accent}`}>{s.value}</p>
                  <span className={`text-xs font-medium ${s.trendUp ? "text-orange-500" : "text-[--text-muted]"}`}>
                    {s.trend}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Middle Row: Approvals + Assistants */}
          <div className="grid grid-cols-5 gap-4">
            {/* Approval Queue */}
            <div className="col-span-2 card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-[--text-primary]">
                  待审批 <span className="text-orange-500 ml-1">2</span>
                </h3>
                <button className="text-xs text-[--accent-blue] font-medium hover:underline">查看全部</button>
              </div>
              <div className="space-y-3">
                {[
                  { type: "指定助理", desc: "张摄影 申请指定 小红 协助服装穿戴", time: "3分钟前", urgent: true },
                  { type: "延时审批", desc: "小明 申请延时 15 分钟（手工DIY）", time: "8分钟前", urgent: false },
                ].map((item, i) => (
                  <div key={i} className={`p-4 rounded-2xl ${item.urgent ? "bg-orange-50/60 border border-orange-100" : "bg-[--bg-base]"}`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[--text-primary]">{item.type}</span>
                          {item.urgent && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-600">紧急</span>
                          )}
                        </div>
                        <p className="text-xs text-[--text-secondary] mt-1 leading-relaxed">{item.desc}</p>
                      </div>
                      <span className="text-[10px] text-[--text-muted] shrink-0 ml-3">{item.time}</span>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button className="flex-1 py-2 rounded-xl bg-gradient-to-r from-green-500 to-green-600 text-white text-xs font-semibold shadow-sm shadow-green-200 hover:shadow-green-300 transition-all active:scale-[0.98]">
                        通过
                      </button>
                      <button className="flex-1 py-2 rounded-xl bg-white border border-gray-200 text-xs font-medium text-[--text-secondary] hover:bg-gray-50 transition-colors">
                        拒绝
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Assistant Status Grid */}
            <div className="col-span-3 card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-[--text-primary]">助理状态一览</h3>
                <div className="flex items-center gap-3 text-[10px] text-[--text-muted]">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />空闲</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-300" />在忙</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500" />进行中</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-300" />快结束</span>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { name: "小红", building: "1号楼", room: "101", status: "idle" },
                  { name: "小明", building: "1号楼", room: "103", status: "executing" },
                  { name: "小华", building: "2号楼", room: "202", status: "busy" },
                  { name: "小丽", building: "2号楼", room: "204", status: "finishing" },
                  { name: "小强", building: "3号楼", room: "302", status: "idle" },
                  { name: "小芳", building: "3号楼", room: "306", status: "idle" },
                  { name: "小军", building: "4号楼", room: "402", status: "idle" },
                  { name: "小燕", building: "5号楼", room: "503", status: "executing" },
                ].map((a) => {
                  const statusConfig: Record<string, { dot: string; ring: string; bg: string; label: string }> = {
                    idle: { dot: "bg-green-500", ring: "ring-green-300", bg: "bg-green-50", label: "空闲" },
                    busy: { dot: "bg-orange-300", ring: "ring-orange-200", bg: "bg-orange-50", label: "在忙" },
                    executing: { dot: "bg-orange-500", ring: "ring-orange-300", bg: "bg-orange-50", label: "执行中" },
                    finishing: { dot: "bg-green-300", ring: "ring-green-200", bg: "bg-green-50", label: "快结束" },
                  };
                  const cfg = statusConfig[a.status];
                  return (
                    <div key={a.name} className={`p-3 rounded-2xl ${cfg.bg} text-center cursor-pointer hover:scale-[1.02] transition-transform`}>
                      <div className={`w-10 h-10 rounded-full bg-white ring-2 ${cfg.ring} flex items-center justify-center mx-auto mb-2 shadow-sm`}>
                        <span className="text-sm font-semibold text-[--text-primary]">{a.name[1]}</span>
                      </div>
                      <p className="text-xs font-semibold text-[--text-primary]">{a.name}</p>
                      <p className="text-[10px] text-[--text-muted] mt-0.5">{a.building} {a.room}</p>
                      <div className="flex items-center justify-center gap-1 mt-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} pulse-dot`} />
                        <span className="text-[10px] text-[--text-secondary]">{cfg.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Bottom Row: Task Queue + Building Overview */}
          <div className="grid grid-cols-5 gap-4">
            {/* Task Queue */}
            <div className="col-span-3 card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-[--text-primary]">任务队列</h3>
                <div className="flex gap-1">
                  {["全部", "等待中", "执行中"].map((tab, i) => (
                    <button
                      key={tab}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                        i === 0
                          ? "bg-blue-500 text-white shadow-sm shadow-blue-200"
                          : "text-[--text-muted] hover:bg-gray-100"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>
              {/* Task Table */}
              <div className="space-y-2">
                <div className="grid grid-cols-6 gap-3 px-3 text-[10px] text-[--text-muted] font-medium uppercase tracking-wider">
                  <span>优先级</span><span>类型</span><span>房间</span><span>摄影师</span><span>助理</span><span>状态</span>
                </div>
                {[
                  { p: "P1", pColor: "bg-red-50 text-red-600", type: "短时手持", room: "101", photographer: "张摄影", assistant: "小红", status: "执行中", sBg: "bg-orange-50 text-orange-600" },
                  { p: "P2", pColor: "bg-orange-50 text-orange-600", type: "服装穿戴", room: "201", photographer: "王摄影", assistant: "小华", status: "执行中", sBg: "bg-orange-50 text-orange-600" },
                  { p: "P3", pColor: "bg-amber-50 text-amber-600", type: "手工DIY", room: "302", photographer: "刘摄影", assistant: "—", status: "等待中", sBg: "bg-gray-100 text-gray-500" },
                  { p: "P3", pColor: "bg-amber-50 text-amber-600", type: "短时熨烫", room: "103", photographer: "李摄影", assistant: "小明", status: "执行中", sBg: "bg-orange-50 text-orange-600" },
                  { p: "P4", pColor: "bg-blue-50 text-blue-600", type: "长时熨烫", room: "503", photographer: "黄摄影", assistant: "小燕", status: "执行中", sBg: "bg-orange-50 text-orange-600" },
                ].map((t, i) => (
                  <div key={i} className="grid grid-cols-6 gap-3 px-3 py-3 rounded-xl bg-[--bg-base] hover:bg-gray-100 transition-colors items-center">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md w-fit ${t.pColor}`}>{t.p}</span>
                    <span className="text-xs text-[--text-primary] font-medium">{t.type}</span>
                    <span className="text-xs text-[--text-secondary]">{t.room}</span>
                    <span className="text-xs text-[--text-secondary]">{t.photographer}</span>
                    <span className="text-xs text-[--text-secondary]">{t.assistant}</span>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md w-fit ${t.sBg}`}>{t.status}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Building Overview */}
            <div className="col-span-2 card p-5">
              <h3 className="text-sm font-semibold text-[--text-primary] mb-4">楼座概览</h3>
              <div className="space-y-3">
                {[
                  { name: "1号楼", assistants: 2, tasks: 3, idle: 1 },
                  { name: "2号楼", assistants: 2, tasks: 2, idle: 0 },
                  { name: "3号楼", assistants: 2, tasks: 1, idle: 2 },
                  { name: "4号楼", assistants: 1, tasks: 1, idle: 1 },
                  { name: "5号楼", assistants: 1, tasks: 1, idle: 0 },
                ].map((b) => (
                  <div key={b.name} className="p-3 rounded-2xl bg-[--bg-base] flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                      <span className="text-blue-600 text-sm font-bold">{b.name[0]}</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-[--text-primary]">{b.name}</p>
                      <div className="flex gap-3 mt-1">
                        <span className="text-[10px] text-[--text-muted]">助理 <strong className="text-[--text-secondary]">{b.assistants}</strong></span>
                        <span className="text-[10px] text-[--text-muted]">任务 <strong className="text-[--text-secondary]">{b.tasks}</strong></span>
                        <span className="text-[10px] text-[--text-muted]">空闲 <strong className="text-green-600">{b.idle}</strong></span>
                      </div>
                    </div>
                    {/* Mini bar */}
                    <div className="w-20 h-2 rounded-full bg-gray-200 overflow-hidden shrink-0">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-500"
                        style={{ width: `${(b.tasks / (b.assistants || 1)) * 50}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
