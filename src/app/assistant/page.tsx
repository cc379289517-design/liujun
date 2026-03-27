export default function AssistantPage() {
  return (
    <div className="flex flex-col gap-4 pt-3">
      {/* Status Control Card */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <span className="text-sm font-semibold text-[--text-primary]">自动接单</span>
            <p className="text-xs text-[--text-muted] mt-0.5">开启后系统自动派单给你</p>
          </div>
          <div className="w-12 h-7 bg-green-500 rounded-full relative cursor-pointer shadow-inner">
            <div className="absolute right-0.5 top-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {["正常", "上厕所", "请假", "身体不适", "用餐中"].map((tag, i) => (
            <button
              key={tag}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                i === 0
                  ? "bg-green-500 text-white shadow-md shadow-green-200"
                  : "bg-[--bg-base] text-[--text-muted] hover:bg-gray-200"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Today's Highlight - Stats */}
      <div>
        <h2 className="text-sm font-semibold text-[--text-primary] mb-3 px-1">今日概览</h2>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "待处理", value: "1", color: "text-orange-600", bg: "bg-orange-50" },
            { label: "已完成", value: "3", color: "text-green-600", bg: "bg-green-50" },
            { label: "总时长", value: "47", unit: "min", color: "text-blue-600", bg: "bg-blue-50" },
          ].map((s) => (
            <div key={s.label} className="card p-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>
                {s.value}
                {s.unit && <span className="text-xs font-normal ml-0.5">{s.unit}</span>}
              </p>
              <p className="text-[10px] text-[--text-muted] mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Current Task */}
      <div>
        <h2 className="text-sm font-semibold text-[--text-primary] mb-3 px-1">当前任务</h2>

        {/* Active Task Card */}
        <div className="card p-5 border-l-4 border-l-orange-500">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 rounded-md bg-red-50 text-red-600 text-xs font-semibold">P1</span>
                <span className="text-xs text-[--text-muted]">2分钟前</span>
              </div>
              <h3 className="text-base font-semibold text-[--text-primary]">短时手持</h3>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-orange-50 text-orange-600 text-xs font-medium">执行中</span>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: "房间", value: "1号楼 101" },
              { label: "摄影师", value: "张摄影" },
              { label: "预估", value: "5 分钟" },
            ].map((d) => (
              <div key={d.label} className="bg-[--bg-base] rounded-xl p-2.5 text-center">
                <p className="text-[10px] text-[--text-muted]">{d.label}</p>
                <p className="text-xs font-semibold text-[--text-primary] mt-0.5">{d.value}</p>
              </div>
            ))}
          </div>

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="flex justify-between text-[10px] text-[--text-muted] mb-1">
              <span>进度</span>
              <span>3:00 / 5:00</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full w-[60%] rounded-full bg-gradient-to-r from-orange-400 to-orange-500" />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button className="flex-1 py-2.5 rounded-[var(--radius-btn)] bg-gradient-to-r from-green-500 to-green-600 text-white text-sm font-semibold shadow-md shadow-green-200 hover:shadow-green-300 transition-all active:scale-[0.98]">
              完成
            </button>
            <button className="py-2.5 px-5 rounded-[var(--radius-btn)] bg-[--bg-base] text-[--text-secondary] text-sm font-medium hover:bg-gray-200 transition-colors">
              延时
            </button>
            <button className="py-2.5 px-5 rounded-[var(--radius-btn)] bg-[--bg-base] text-[--text-secondary] text-sm font-medium hover:bg-gray-200 transition-colors">
              暂停
            </button>
          </div>
        </div>
      </div>

      {/* Waiting Queue */}
      <div>
        <h2 className="text-sm font-semibold text-[--text-primary] mb-3 px-1">等待队列</h2>
        <div className="card p-4">
          <div className="flex items-center gap-4 py-2">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center shrink-0">
              <span className="text-amber-600 text-xs font-bold">P3</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[--text-primary] truncate">手工DIY协助</p>
              <p className="text-xs text-[--text-muted]">2号楼 202 · 王摄影</p>
            </div>
            <span className="text-xs text-[--text-muted] shrink-0">5分钟前</span>
          </div>
        </div>
      </div>

      {/* Completed Today */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-[--text-primary] mb-3 px-1">今日已完成</h2>
        <div className="space-y-2">
          {[
            { name: "服装穿戴", room: "1号楼 103", time: "14:20", dur: "15min" },
            { name: "短时手持", room: "1号楼 101", time: "13:05", dur: "5min" },
            { name: "短时熨烫", room: "1号楼 105", time: "11:30", dur: "20min" },
          ].map((t, i) => (
            <div key={i} className="card px-4 py-3 flex items-center gap-4 opacity-70">
              <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M20 6 9 17l-5-5"/></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[--text-primary] truncate">{t.name}</p>
                <p className="text-xs text-[--text-muted]">{t.room}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-[--text-muted]">{t.time}</p>
                <p className="text-[10px] text-[--text-muted]">{t.dur}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
