import { DomainError } from '@/lib/errors/codes';
import { requireTenantContext, type TenantContext } from './transactionContext';

export function assertBranchAccess(branchId: string, ctx: TenantContext = requireTenantContext()): void {
  if (ctx.isGlobal || ctx.allBranches) return;
  if (!ctx.branchIds.includes(branchId)) {
    throw new DomainError('FORBIDDEN_SCOPE', 'Branch access denied', {}, 403);
  }
}
