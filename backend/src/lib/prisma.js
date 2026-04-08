import { PrismaClient } from "@prisma/client";

/**
 * Single PrismaClient per Node process. Each `new PrismaClient()` creates its own pool;
 * many modules doing that exhausts session-mode poolers (e.g. MaxClientsInSessionMode).
 * Reuse `globalThis` in all environments so the same process never attaches more than one pool.
 */
const globalForPrisma = globalThis;

if (!globalForPrisma.__prismaSingleton) {
  globalForPrisma.__prismaSingleton = new PrismaClient();
}

export const prisma = globalForPrisma.__prismaSingleton;
