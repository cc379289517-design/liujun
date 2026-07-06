import type { AssistantRankingRow } from "./types";

function assistantRankingCrownMeta(index: number): { color: string; sizeCls: string; offsetCls: string } | null {
  if (index === 0) return { color: "#fde047", sizeCls: "h-[22px] w-[22px]", offsetCls: "-left-2.5 -top-2.5" };
  if (index === 1) return { color: "#e2e8f0", sizeCls: "h-[17px] w-[17px]", offsetCls: "-left-2 -top-2" };
  if (index === 2) return { color: "#f59e0b", sizeCls: "h-3.5 w-3.5", offsetCls: "-left-1.5 -top-1.5" };
  return null;
}

export default function AssistantRankingAvatar({
  row,
  index,
  sizeCls = "h-7 w-7",
}: {
  row: AssistantRankingRow;
  index: number;
  sizeCls?: string;
}) {
  const crown = assistantRankingCrownMeta(index);
  const ringCls =
    index === 0 ? "ring-2 ring-amber-300/80" :
    index === 1 ? "ring-2 ring-slate-300/80" :
    index === 2 ? "ring-2 ring-orange-300/70" :
    "ring-1 ring-white/90";

  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-visible rounded-full bg-slate-200 text-[10px] font-extrabold text-white shadow-sm ${sizeCls} ${ringCls}`}>
      {row.avatar ? (
        <span className="h-full w-full overflow-hidden rounded-full">
          <img src={row.avatar} alt={row.assistantName} className="h-full w-full object-cover" />
        </span>
      ) : (
        <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-slate-300 to-slate-500">
          {row.assistantName.slice(0, 1)}
        </span>
      )}
      {crown && (
        <svg
          className={`absolute ${crown.offsetCls} ${crown.sizeCls} -rotate-[22deg] overflow-visible`}
          viewBox="0 0 24 24"
          fill="none"
          stroke={crown.color}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ filter: "drop-shadow(0 0 2px rgba(255,255,255,0.95)) drop-shadow(0 1px 1px rgba(15,23,42,0.22))" }}
        >
          <path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 10H5L3 8Z" />
          <path d="M5 18h14" />
        </svg>
      )}
    </span>
  );
}
