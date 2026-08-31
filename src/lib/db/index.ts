// src/lib/db/index.ts
// Prisma client. Singleton to avoid connection exhaustion in dev.

import { PrismaClient } from '@prisma/client';
import { applyTenantIsolation } from './tenantClient';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const systemDb =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = systemDb;

// Keep public type compatible with Prisma.TransactionClient consumers while
// retaining extension behavior at runtime.
export const tenantDb: PrismaClient = applyTenantIsolation(systemDb) as unknown as PrismaClient;
export const db: PrismaClient = tenantDb;

export type { PrismaClient } from '@prisma/client';
