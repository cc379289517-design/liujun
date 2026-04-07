export default function AssistantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col max-w-lg mx-auto">
      {/* Top Bar */}
      <header className="px-5 pt-5 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[14px] bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shadow-md shadow-green-200">
            <span className="text-white font-bold text-sm">SP</span>
          </div>
          <div>
            <h1 className="text-base font-semibold text-[--text-primary]">助理工作台</h1>
            <p className="text-xs text-[--text-muted]">1号楼 · 小红</p>
          </div>
        </div>
      </header>

      <main className="flex-1 px-5 pb-24">{children}</main>

      {/* Bottom Tab Bar */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg px-5 pb-5 pt-2 z-20">
        <div className="card flex justify-around py-2 px-2 !rounded-2xl">
          {[
            { name: "任务", icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            ), active: true },
            { name: "状态", icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            ), active: false },
            { name: "消息", icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            ), active: false },
            { name: "我的", icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            ), active: false },
          ].map((tab) => (
            <button
              key={tab.name}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-4 rounded-xl transition-colors ${
                tab.active
                  ? "text-green-600 bg-green-50"
                  : "text-[--text-muted] hover:text-[--text-primary]"
              }`}
            >
              {tab.icon}
              <span className="text-[10px] font-medium">{tab.name}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
