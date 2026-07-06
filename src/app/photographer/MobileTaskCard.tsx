import type { ReactNode } from "react";
import type { MobileTaskStatusMeta } from "./mobileWorkflows";
import type { TaskFromAPI } from "./types";
import { formatRoomOrVenue } from "./locationDisplay";

type MobileTaskPrimaryAction = "start" | "complete" | "resume";

type MobileTaskCardProps = {
  task: TaskFromAPI;
  meta: MobileTaskStatusMeta;
  title: string;
  subtitle: string;
  timeLine: string | null;
  actionLabel: string;
  glassPanelClassName: string;
  compact?: boolean;
  featured?: boolean;
  note?: string | null;
  specifiedName: string | null;
  subtitleHint?: string | null;
  primaryAction?: MobileTaskPrimaryAction | null;
  showCancel?: boolean;
  escalationBadge?: ReactNode;
  footer?: ReactNode;
  onPrimaryAction?: () => void;
  onPause?: () => void;
  onCancel?: () => void;
};

export default function MobileTaskCard({
  task,
  meta,
  title,
  subtitle,
  timeLine,
  actionLabel,
  glassPanelClassName,
  compact = false,
  featured = false,
  note,
  specifiedName,
  subtitleHint,
  primaryAction = null,
  showCancel = false,
  escalationBadge,
  footer,
  onPrimaryAction,
  onPause,
  onCancel,
}: MobileTaskCardProps) {
  const specifiedTask = Boolean(task.isSpecified);
  const canComplete = primaryAction === "complete";

  return (
    <div className={`rounded-[20px] border backdrop-blur-2xl ${featured ? "p-5 shadow-lg shadow-lime-500/10" : "p-4"} ${glassPanelClassName} ${compact ? "" : meta.panel}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: meta.dot }} />
            <h3 className="truncate text-[18px] font-extrabold leading-tight text-[--text-primary]">
              {formatRoomOrVenue(task.roomNumber)} {title}
            </h3>
            {specifiedTask && (
              <span
                className="shrink-0 rounded-md bg-orange-500/10 px-1.5 py-0.5 text-[9px] font-extrabold text-orange-500"
                title={specifiedName ? `指定 ${specifiedName}` : "指定助理"}
              >
                指定
              </span>
            )}
            {escalationBadge}
          </div>
          <p className={`mt-1 truncate font-semibold text-[--text-secondary] ${featured ? "text-[13px]" : "text-[12px]"}`}>
            {subtitle}
            {subtitleHint && <span className="ml-1 font-extrabold text-lime-600">{subtitleHint}</span>}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-right text-[10px] font-extrabold leading-tight ${meta.badge}`}>
          <span className="block">{meta.label}</span>
        </span>
      </div>
      {timeLine && (
        <p className="mt-3 text-[12px] font-bold text-[--text-muted]">
          {timeLine}
        </p>
      )}
      {!compact && note?.trim() && (
        <p className="mt-3 rounded-2xl bg-white/44 px-3 py-2 text-[11px] font-semibold leading-relaxed text-orange-600">
          {note.trim()}
        </p>
      )}
      {footer && <div className="mt-3">{footer}</div>}
      {(primaryAction || showCancel) && (
        <div className="mt-4 flex gap-2">
          {primaryAction && (
            <button
              type="button"
              onClick={onPrimaryAction}
              className="min-h-[44px] flex-1 rounded-2xl bg-orange-500 px-4 text-[14px] font-extrabold text-white shadow-lg shadow-orange-500/20 active:scale-[0.99]"
            >
              {actionLabel}
            </button>
          )}
          {canComplete && (
            <button
              type="button"
              onClick={onPause}
              className="min-h-[44px] rounded-2xl bg-red-500/90 px-4 text-[13px] font-extrabold text-white shadow-lg shadow-red-500/15 active:scale-[0.99]"
            >
              短暂离开
            </button>
          )}
          {showCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="min-h-[44px] rounded-2xl border border-red-200/80 bg-white/54 px-4 text-[13px] font-extrabold text-red-500 active:scale-[0.99]"
            >
              取消
            </button>
          )}
        </div>
      )}
    </div>
  );
}
