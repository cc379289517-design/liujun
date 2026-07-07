import type { DockAssistant } from "./AssistantDock";
import type { BuiltCategory } from "./types";

type MobileQuickBookingPanelProps = {
  categories: BuiltCategory[];
  selectedCategory: BuiltCategory | null;
  selectedAssistant: DockAssistant | null;
  selectedAssistantCanSubmit: boolean;
  selectedAssistantId: string | null;
  pickerOpen: boolean;
  onlineAssistants: DockAssistant[];
  workbenchLocationText: string;
  glassPanelClassName: string;
  softPanelClassName: string;
  isDark: boolean;
  onTogglePicker: () => void;
  onClearAssistant: () => void;
  onSelectAssistant: (assistantId: string) => void;
  onToggleCategory: (categoryName: string) => void;
  onCreateTask: (categoryName: string, duration: BuiltCategory["durations"][number]) => void;
  canSpecifyAssistant: (assistant: DockAssistant) => boolean;
  assistantStatusText: (assistant: DockAssistant) => string;
  assistantDotColor: (assistant: DockAssistant) => string;
};

export default function MobileQuickBookingPanel({
  categories,
  selectedCategory,
  selectedAssistant,
  selectedAssistantCanSubmit,
  selectedAssistantId,
  pickerOpen,
  onlineAssistants,
  workbenchLocationText,
  glassPanelClassName,
  softPanelClassName,
  isDark,
  onTogglePicker,
  onClearAssistant,
  onSelectAssistant,
  onToggleCategory,
  onCreateTask,
  canSpecifyAssistant,
  assistantStatusText,
  assistantDotColor,
}: MobileQuickBookingPanelProps) {
  return (
    <div className={`rounded-[24px] border p-4 backdrop-blur-2xl ${glassPanelClassName}`}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-[17px] font-extrabold text-[--text-primary]">快捷发单</h2>
          <p className="mt-1 text-[12px] font-semibold text-[--text-muted]">{workbenchLocationText}</p>
        </div>
        <button
          type="button"
          onClick={onTogglePicker}
          className={`flex min-h-[34px] max-w-[132px] items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-extrabold ${
            selectedAssistant
              ? selectedAssistantCanSubmit
                ? "border-orange-300/70 bg-orange-500/12 text-orange-600"
                : "border-gray-300/70 bg-gray-400/12 text-gray-500"
              : isDark
                ? "border-white/[0.12] bg-white/[0.07] text-orange-200"
                : "border-white/70 bg-white/60 text-orange-600"
          }`}
        >
          {selectedAssistant ? (
            <>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-orange-100 text-[9px] text-orange-600">
                {selectedAssistant.avatar ? (
                  <img src={selectedAssistant.avatar} alt={selectedAssistant.name} className="h-full w-full object-cover" />
                ) : selectedAssistant.name.slice(0, 1)}
              </span>
              <span className="min-w-0 truncate">{selectedAssistant.name}</span>
            </>
          ) : (
            <span>指定助理</span>
          )}
        </button>
      </div>
      {selectedAssistant && (
        <div className={`mb-2 flex items-center justify-between rounded-2xl border px-3 py-2 ${
          selectedAssistantCanSubmit
            ? isDark ? "border-orange-300/20 bg-orange-400/10" : "border-orange-200/70 bg-orange-50/80"
            : isDark ? "border-white/[0.10] bg-white/[0.06]" : "border-gray-200/80 bg-gray-50/80"
        }`}>
          <span className={`min-w-0 truncate text-[12px] font-extrabold ${selectedAssistantCanSubmit ? "text-orange-500" : "text-gray-500"}`}>
            本次指定：{selectedAssistant.name}
          </span>
          <button
            type="button"
            onClick={onClearAssistant}
            className="ml-2 shrink-0 rounded-full px-2 py-1 text-[11px] font-extrabold text-[--text-muted]"
          >
            清除
          </button>
        </div>
      )}
      {pickerOpen && (
        <div className={`mb-3 rounded-[20px] border p-2 ${softPanelClassName}`}>
          {onlineAssistants.length === 0 ? (
            <p className="rounded-2xl bg-white/32 px-3 py-4 text-center text-[12px] font-semibold text-[--text-muted]">当前区域暂无在线助理</p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5">
              {onlineAssistants.map((assistant) => {
                const selectable = canSpecifyAssistant(assistant);
                const selected = selectedAssistantId === assistant.id;
                return (
                  <button
                    type="button"
                    key={`mobile-quick-assistant-${assistant.id}`}
                    disabled={!selectable}
                    onClick={() => onSelectAssistant(assistant.id)}
                    className={`flex min-h-[44px] items-center gap-2 rounded-2xl px-3 text-left ${
                      selected
                        ? "bg-orange-500 text-white"
                        : selectable
                          ? isDark ? "bg-white/[0.07] text-slate-100" : "bg-white/58 text-slate-700"
                          : isDark ? "bg-white/[0.035] text-slate-500" : "bg-slate-100/70 text-slate-400"
                    } disabled:opacity-70`}
                  >
                    <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-visible">
                      <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-[12px] font-extrabold text-white">
                        {assistant.avatar ? <img src={assistant.avatar} alt={assistant.name} className="h-full w-full object-cover" /> : assistant.name.slice(0, 1)}
                      </span>
                      <span className="absolute -bottom-0.5 -right-0.5 z-10 h-3 w-3 rounded-full ring-2 ring-white" style={{ backgroundColor: assistantDotColor(assistant) }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-extrabold">{assistant.name}</span>
                      <span className={`block text-[10px] font-bold ${selected ? "text-white/75" : "text-[--text-muted]"}`}>{assistantStatusText(assistant)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {categories.map((category) => (
          <button
            type="button"
            key={category.name}
            onClick={() => onToggleCategory(category.name)}
            className={`min-h-[46px] rounded-2xl px-3 text-[14px] font-extrabold active:scale-[0.99] ${
              selectedCategory?.name === category.name
                ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20"
                : `${isDark ? category.darkBg : category.bg} ${isDark ? category.darkText : category.text}`
            }`}
          >
            {category.name}
          </button>
        ))}
      </div>
      {selectedCategory && (
        <div className="mt-3 grid grid-cols-1 gap-2">
          {selectedCategory.durations.map((duration) => (
            <button
              type="button"
              key={`${selectedCategory.name}-${duration.priority}`}
              onClick={() => onCreateTask(selectedCategory.name, duration)}
              className="flex min-h-[44px] items-center justify-between rounded-2xl bg-white/60 px-4 text-[13px] font-extrabold text-[--text-primary] shadow-sm active:scale-[0.99]"
            >
              <span>{duration.label}</span>
              <span className={`rounded-lg px-2 py-1 text-[11px] ${duration.cls}`}>{duration.priority}</span>
            </button>
          ))}
          {selectedCategory.specialActions?.map((action) => (
            <button
              type="button"
              key={`${selectedCategory.name}-special-${action.title}`}
              onClick={() => onCreateTask(action.title, action)}
              className="flex min-h-[44px] items-center justify-between rounded-2xl bg-purple-500 px-4 text-[13px] font-extrabold text-white shadow-sm shadow-purple-500/20 active:scale-[0.99]"
            >
              <span>{action.title}</span>
              <span className="rounded-lg bg-white/18 px-2 py-1 text-[11px]">{action.priority}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
