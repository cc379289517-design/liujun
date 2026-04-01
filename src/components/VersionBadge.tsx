import { APP_VERSION } from "@/lib/version";

export function VersionBadge() {
  return (
    <span className="fixed bottom-4 right-4 z-50 text-[15px] text-gray-500 font-medium select-none pointer-events-none">
      {APP_VERSION}
    </span>
  );
}
