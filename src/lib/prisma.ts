import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaSqlitePragmaReady: Promise<void> | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL!,
    timeout: 5000,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

export async function ensureSqliteRuntimePragmas(): Promise<void> {
  if (globalForPrisma.prismaSqlitePragmaReady) return globalForPrisma.prismaSqlitePragmaReady;

  globalForPrisma.prismaSqlitePragmaReady = (async () => {
    if (!process.env.DATABASE_URL?.startsWith("file:")) return;
    await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL");
    await prisma.$executeRawUnsafe("PRAGMA synchronous = NORMAL");
    await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000");
  })().catch((error) => {
    globalForPrisma.prismaSqlitePragmaReady = undefined;
    console.warn("[sqlite pragmas]", error);
  });

  return globalForPrisma.prismaSqlitePragmaReady;
}

if (process.env.NEXT_PHASE !== "phase-production-build") {
  void ensureSqliteRuntimePragmas();
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
