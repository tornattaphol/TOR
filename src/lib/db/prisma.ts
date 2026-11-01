import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { requireDatabaseUrl } from "../config/env";

const g = globalThis as unknown as { __prisma?: PrismaClient };

/** Singleton PrismaClient (survives Next.js dev hot reloads). Credentials come only from DATABASE_URL. */
export function getPrisma(connectionString: string = requireDatabaseUrl()): PrismaClient {
  if (!g.__prisma) {
    const adapter = new PrismaPg({ connectionString });
    g.__prisma = new PrismaClient({ adapter });
  }
  return g.__prisma;
}

export function createPrisma(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
