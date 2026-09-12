import { DomainError } from '@/lib/errors/codes';

export const ADMIN_GRANTS = ['user.read', 'user.update', 'user.deactivate', 'role.read', 'role.update', 'role.assign'] as const;
export function forbidden(message: string): never { throw new DomainError('FORBIDDEN_SCOPE', message, {}, 403); }
export function platformOnly(code: string) {
  return code.startsWith('platform.') || code.startsWith('backup.restore');
}
export function assertGrantAuthority(codes: string[], actorCodes: Set<string>, platform: boolean) {
  if (!platform && codes.some(code => platformOnly(code) || !actorCodes.has(code))) forbidden('Cannot grant permissions outside your authority');
}
export function assertCompanyScope(actor: { companyId: string; isGlobal: boolean }, companyId: string) {
  if (!companyId || (!actor.isGlobal && companyId !== actor.companyId)) forbidden('Company access denied');
}
export function assertBranchAssignment(ids: string[], allowed: string[], allBranches: boolean) {
  if (!allBranches && ids.some(id => !allowed.includes(id))) forbidden('Branch assignment outside your access');
}
