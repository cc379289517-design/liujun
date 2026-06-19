import { prisma } from "@/lib/prisma";
import {
  IRONING_CONFIRM_TIMEOUT_SEC_CONFIG_KEY,
  IRONING_MACHINE_CLAIM_TTL_MIN_CONFIG_KEY,
  IRONING_PREP_WINDOW_MIN_CONFIG_KEY,
  parseIroningConfirmTimeoutSec,
  parseIroningMachineClaimTtlMin,
  parseIroningPrepWindowMin,
} from "@/lib/ironingRules";

export async function getIroningRuntimeConfig(): Promise<{
  prepWindowMinutes: number;
  confirmTimeoutSeconds: number;
  machineClaimTtlMinutes: number;
}> {
  const rows = await prisma.systemConfig.findMany({
    where: {
      key: {
        in: [
          IRONING_PREP_WINDOW_MIN_CONFIG_KEY,
          IRONING_CONFIRM_TIMEOUT_SEC_CONFIG_KEY,
          IRONING_MACHINE_CLAIM_TTL_MIN_CONFIG_KEY,
        ],
      },
    },
    select: { key: true, value: true },
  });

  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    prepWindowMinutes: parseIroningPrepWindowMin(map.get(IRONING_PREP_WINDOW_MIN_CONFIG_KEY)),
    confirmTimeoutSeconds: parseIroningConfirmTimeoutSec(map.get(IRONING_CONFIRM_TIMEOUT_SEC_CONFIG_KEY)),
    machineClaimTtlMinutes: parseIroningMachineClaimTtlMin(map.get(IRONING_MACHINE_CLAIM_TTL_MIN_CONFIG_KEY)),
  };
}
