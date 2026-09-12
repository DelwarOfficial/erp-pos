import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@/lib/errors/codes';
import type { AuthResult } from '@/lib/auth/middleware';
import { buildTenantContext } from '@/lib/db/transaction';
import { withAccessTransaction } from './transaction';
import { hashPassword } from '@/lib/auth/password';
import { accessMutation, accessAudit, targetUser } from './service';
import { assertGrantAuthority } from './policy';

const purpose = 'admin_password_reset';
const ttl = 15 * 60 * 1000;
const payloadSchema = z.object({ purpose: z.literal(purpose), id: z.string().uuid(), userId: z.string().uuid(), companyId: z.string().uuid(),
  nonce: z.string().regex(/^[a-f0-9]{64}$/), expires: z.number().int() }).strict();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function signature(body: string) {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) throw new Error('Reset signing configuration is unavailable');
  return createHmac('sha256', key).update(`${purpose}:${body}`).digest();
}
function invalid(): never { throw new DomainError('UNAUTHORIZED', 'Reset link is invalid, expired, or already used', {}, 401); }

export async function issuePasswordReset(auth: AuthResult, companyId: string, userId: string) {
  const payload = { purpose, id: randomUUID(), companyId, userId, nonce: randomBytes(32).toString('hex'), expires: Date.now() + ttl };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = `${body}.${signature(body).toString('base64url')}`;
  await accessMutation(auth, companyId, ['user.reset_password'], async (tx, authority) => {
    await targetUser(tx, auth, companyId, userId);
    const user = await tx.user.findFirst({ where: { id: userId, companyId, isActive: true, deletedAt: null },
      select: { roles: { select: { role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } } } } });
    if (!user) invalid();
    assertGrantAuthority(user.roles.flatMap(item => item.role.permissions.map(value => value.permission.code)), authority, auth.isGlobal);
    await tx.webAuthnChallenge.updateMany({ where: { companyId, userId, action: purpose, consumedAt: null }, data: { consumedAt: new Date() } });
    await tx.webAuthnChallenge.create({ data: { id: payload.id, companyId, userId, action: purpose,
      challenge: hash(payload.nonce), expiresAt: new Date(payload.expires) } });
    await accessAudit(tx, auth, companyId, 'access.password_reset.initiated', userId, {});
  });
  return { token, expires_at: new Date(payload.expires).toISOString() };
}

export async function redeemPasswordReset(raw: unknown) {
  const input = z.object({ token: z.string().min(1).max(2048), password: z.string().min(12).max(200) }).strict().parse(raw);
  const [body, mac, extra] = input.token.split('.');
  if (!body || !mac || extra) invalid();
  const expected = signature(body), supplied = Buffer.from(mac, 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) invalid();
  let decoded: unknown; try { decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { invalid(); }
  const parsed = payloadSchema.safeParse(decoded); if (!parsed.success || parsed.data.expires <= Date.now()) invalid();
  const payload = parsed.data;
  const passwordHash = await hashPassword(input.password);
  // Signature proves a server-issued capability. Scope is established only after
  // validation, and every database predicate binds its company/user/challenge.
  const ctx = buildTenantContext({ companyId: payload.companyId, userId: payload.userId, branchIds: [] });
  return withAccessTransaction(ctx, async tx => {
    await tx.$queryRaw`SELECT id FROM companies WHERE id = ${payload.companyId} FOR UPDATE`;
    const user = await tx.user.findFirst({ where: { id: payload.userId, companyId: payload.companyId, isActive: true, deletedAt: null, company: { status: 'active' } }, select: { id: true } });
    if (!user) invalid();
    const now = new Date();
    const consumed = await tx.webAuthnChallenge.updateMany({ where: { id: payload.id, companyId: payload.companyId,
      userId: payload.userId, action: purpose, challenge: hash(payload.nonce), consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (consumed.count !== 1) invalid();
    await tx.user.update({ where: { id: user.id, companyId: payload.companyId }, data: { passwordHash, passwordChangedAt: now } });
    await tx.refreshToken.updateMany({ where: { companyId: payload.companyId, userId: user.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.webAuthnChallenge.updateMany({ where: { companyId: payload.companyId, userId: user.id, consumedAt: null }, data: { consumedAt: now } });
    await tx.auditLog.create({ data: { companyId: payload.companyId, userId: user.id, correlationId: ctx.correlationId,
      action: 'access.password_reset.completed', entityType: 'user', entityId: user.id } });
    return { reset: true };
  });
}
