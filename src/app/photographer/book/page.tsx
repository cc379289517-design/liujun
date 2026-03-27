import Link from "next/link";

const glass = "bg-white/55 backdrop-blur-2xl border border-white/40 shadow-lg shadow-black/[0.03]";

export default function BookPage() {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-slate-100 via-blue-50/40 to-slate-50 flex items-start justify-center overflow-y-auto py-10 px-4">
      <div className={`w-full max-w-lg rounded-2xl p-8 ${glass}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-xl font-bold text-[--text-primary]">新建预约任务</h2>
            <p className="text-sm text-[--text-muted] mt-0.5">系统将自动匹配最优助理</p>
          </div>
          <Link
            href="/photographer"
            className="w-9 h-9 rounded-xl bg-white/50 border border-white/60 flex items-center justify-center text-[--text-muted] hover:text-[--text-primary] hover:bg-white/80 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </Link>
        </div>

        <form className="space-y-6">
          {/* Task Type */}
          <div>
            <label className="block text-sm font-medium text-[--text-primary] mb-2">任务类型</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 1, name: "短时手持", p: "P1", border: "border-red-300/50", tag: "bg-red-100/60 text-red-600" },
                { id: 2, name: "服装穿戴", p: "P2", border: "border-orange-300/50", tag: "bg-orange-100/60 text-orange-600" },
                { id: 3, name: "手工DIY协助", p: "P3", border: "border-amber-300/50", tag: "bg-amber-100/60 text-amber-600" },
                { id: 4, name: "短时熨烫", p: "P3", border: "border-amber-300/50", tag: "bg-amber-100/60 text-amber-600" },
                { id: 5, name: "长时熨烫", p: "P4", border: "border-blue-300/50", tag: "bg-blue-100/60 text-blue-600" },
                { id: 6, name: "手工DIY制作", p: "P4", border: "border-blue-300/50", tag: "bg-blue-100/60 text-blue-600" },
                { id: 7, name: "其他长时任务", p: "P4", border: "border-blue-300/50", tag: "bg-blue-100/60 text-blue-600" },
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`flex items-center justify-between px-4 py-3 rounded-xl border ${cat.border} bg-white/30 hover:bg-white/60 transition-all text-sm text-left`}
                >
                  <span className="text-[--text-primary] font-medium">{cat.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${cat.tag}`}>{cat.p}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Room */}
          <div>
            <label className="block text-sm font-medium text-[--text-primary] mb-2">房间号</label>
            <input
              type="text"
              placeholder="例如：101"
              className="w-full rounded-xl border border-white/50 bg-white/30 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/60 focus:bg-white/50 placeholder:text-[--text-muted] transition-all"
            />
          </div>

          {/* Duration */}
          <div>
            <label className="block text-sm font-medium text-[--text-primary] mb-2">预估时长（分钟）</label>
            <input
              type="number"
              placeholder="例如：15"
              className="w-full rounded-xl border border-white/50 bg-white/30 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/60 focus:bg-white/50 placeholder:text-[--text-muted] transition-all"
            />
          </div>

          {/* Toggles */}
          <div className="space-y-3">
            <label className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/30 border border-white/40 cursor-pointer">
              <span className="text-sm text-[--text-primary]">指定特定助理（需组长审批）</span>
              <div className="w-10 h-6 bg-black/10 rounded-full relative">
                <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform" />
              </div>
            </label>
            <label className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/30 border border-white/40 cursor-pointer">
              <span className="text-sm text-[--text-primary]">不可中断（锁定任务）</span>
              <div className="w-10 h-6 bg-black/10 rounded-full relative">
                <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform" />
              </div>
            </label>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-[--text-primary] mb-2">特殊备注</label>
            <textarea
              placeholder="例如：请帮忙带小推车"
              rows={2}
              className="w-full rounded-xl border border-white/50 bg-white/30 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/60 focus:bg-white/50 placeholder:text-[--text-muted] resize-none transition-all"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold text-sm shadow-lg shadow-orange-200/60 hover:shadow-orange-300/60 hover:from-orange-600 hover:to-orange-700 transition-all active:scale-[0.98]"
          >
            提交预约
          </button>
        </form>
      </div>
    </div>
  );
}
