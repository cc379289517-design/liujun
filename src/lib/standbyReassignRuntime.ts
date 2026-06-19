import { prisma } from "@/lib/prisma";
import {
  STANDBY_REASSIGN_TIMEOUT_MIN_CONFIG_KEY,
  parseStandbyReassignTimeoutMin,
} from "@/lib/standbyReassignRules";

export async function getStandbyReassignRuntimeConfig(): Promise<{
  timeoutMinutes: number;
}> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: STANDBY_REASSIGN_TIMEOUT_MIN_CONFIG_KEY },
    select: { value: true },
  });

  return {
    timeoutMinutes: parseStandbyReassignTimeoutMin(row?.value),
  };
}
