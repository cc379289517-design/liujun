export type IroningMachineIconTone = "busy" | "queue" | "moderate" | "idle" | "maintenance";

export default function IroningMachineIcon({
  tone = "idle",
  className = "h-5 w-5",
}: {
  tone?: IroningMachineIconTone;
  className?: string;
}) {
  const color = tone === "busy"
    ? "#ef4444"
    : tone === "queue"
      ? "#ef4444"
    : tone === "moderate"
      ? "#f59e0b"
      : tone === "maintenance"
        ? "#94a3b8"
        : "#22c55e";
  const steamColor = tone === "busy"
    ? "#fca5a5"
    : tone === "queue"
      ? "#fca5a5"
    : tone === "moderate"
      ? "#fdba74"
      : tone === "maintenance"
        ? "#cbd5e1"
        : "#86efac";
  return (
    <svg className={className} viewBox="0 0 96 96" fill="none" aria-hidden="true">
      <path d="M17 31c6-8-5-13 1-22" stroke={steamColor} strokeWidth="6" strokeLinecap="round" />
      <path d="M30 31c6-8-5-13 1-22" stroke={steamColor} strokeWidth="6" strokeLinecap="round" />
      <path d="M45 31h10" stroke={color} strokeWidth="7" strokeLinecap="round" />
      <path d="M20 70h59v9H18c-4 0-7-3-7-7 0-21 16-38 38-38h29c8 0 13 5 14 12l3 17c1 4-2 7-6 7H20Z" stroke={color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 48h19c4 0 7 3 8 7l1 6H40c1-8 5-13 10-13Z" stroke={color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 62h69" stroke={color} strokeWidth="5" strokeLinecap="round" />
      <path d="M48 64h.1M59 64h.1M70 64h.1" stroke={steamColor} strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}
