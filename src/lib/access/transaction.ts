import { withTenant, type TenantContext, type TransactionClient } from '@/lib/db/transaction';
import { Prisma } from '@prisma/client';

// MariaDB can abort a Serializable read with 1020 after waiting for another
// transaction. Retry the whole atomic unit, never just its final query.
export async function withAccessTransaction<T>(ctx: TenantContext, work: (tx: TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await withTenant(ctx, work); }
    catch (error) {
      const failure = error as { code?: string; meta?: { code?: string; message?: string } };
      const retryable = failure.code === 'P2034' || (failure.code === 'P2010' && failure.meta?.code === '1020')
        || (failure.code === 'P2010' && failure.meta?.message?.includes('Record has changed since last read'))
        || (error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes('code: 1020,')
          && error.message.includes('Record has changed since last read'));
      if (!retryable || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}
