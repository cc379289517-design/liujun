import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-4xl">
        {/* Logo & Title */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-[22px] bg-gradient-to-br from-orange-400 to-orange-600 shadow-lg shadow-orange-200 mb-6">
            <span className="text-3xl text-white font-bold">S</span>
          </div>
          <h1 className="text-3xl font-bold text-[--text-primary] tracking-tight">
            SPAD
          </h1>
          <p className="text-[--text-secondary] mt-2 text-lg">
            摄影助理自动派单系统
          </p>
        </div>

        {/* Entry Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
          {/* 摄影师端 */}
          <Link href="/photographer" className="group">
            <div className="card p-8 text-center transition-all duration-300 group-hover:-translate-y-1">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-orange-50 mb-5 group-hover:bg-orange-100 transition-colors">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-[--text-primary] mb-1">摄影师端</h2>
              <p className="text-sm text-[--text-secondary]">预约 · 地图 · 任务管理</p>
              <div className="mt-5 flex items-center justify-center gap-1.5 text-sm text-orange-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                进入工作台
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </div>
            </div>
          </Link>

          {/* 助理端 */}
          <Link href="/assistant" className="group">
            <div className="card p-8 text-center transition-all duration-300 group-hover:-translate-y-1">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-50 mb-5 group-hover:bg-green-100 transition-colors">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-[--text-primary] mb-1">助理端</h2>
              <p className="text-sm text-[--text-secondary]">接单 · 执行 · 状态切换</p>
              <div className="mt-5 flex items-center justify-center gap-1.5 text-sm text-green-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                进入工作台
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </div>
            </div>
          </Link>

          {/* 组长端 */}
          <Link href="/leader" className="group">
            <div className="card p-8 text-center transition-all duration-300 group-hover:-translate-y-1">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-50 mb-5 group-hover:bg-blue-100 transition-colors">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1"/>
                  <rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/>
                  <rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-[--text-primary] mb-1">组长端</h2>
              <p className="text-sm text-[--text-secondary]">监控 · 审批 · 调度总览</p>
              <div className="mt-5 flex items-center justify-center gap-1.5 text-sm text-blue-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                进入管理台
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </div>
            </div>
          </Link>

          {/* 后台管理 */}
          <Link href="/admin" className="group">
            <div className="card p-8 text-center transition-all duration-300 group-hover:-translate-y-1">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-purple-50 mb-5 group-hover:bg-purple-100 transition-colors">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9333ea" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-[--text-primary] mb-1">后台管理</h2>
              <p className="text-sm text-[--text-secondary]">人员 · 楼座 · 系统配置</p>
              <div className="mt-5 flex items-center justify-center gap-1.5 text-sm text-purple-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                进入管理台
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </div>
            </div>
          </Link>
        </div>

        {/* Bottom Stats */}
        <div className="mt-10 flex justify-center gap-10 text-center">
          {[
            { label: "覆盖楼座", value: "5" },
            { label: "摄影师", value: "80+" },
            { label: "助理", value: "30+" },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-2xl font-bold text-[--text-primary]">{s.value}</p>
              <p className="text-xs text-[--text-muted] mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
