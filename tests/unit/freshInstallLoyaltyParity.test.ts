// A freshly onboarded company must end up where the 2026-11 data migrations
// leave an upgraded one (20261118000300_loyalty_accounts_coupon_permission):
//   - chart accounts 2500 (reward_points_liability) and 5700 (reward_expense),
//     with 5700 linked as the policy's reward expense account;
//   - coupon.manage on every system role that can issue gift cards.
// Onboarding builds both from code (seedDefaultCoa, SYSTEM_ROLES), so this is
// checked here; the migrations themselves were replayed on a fresh database.
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { seedDefaultCoa } from '@/lib/accounting/seedCoa';
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions/catalogue';

/** Expand a role's grants exactly as POST /api/v1/onboarding does. */
function expand(grants: readonly string[]): Set<string> {
  if (grants.includes('*')) return new Set(PERMISSIONS.map(p => p.code));
  return new Set(grants.flatMap(g => g.endsWith('.*') ? PERMISSIONS.filter(p => p.code.startsWith(g.slice(0, -1))).map(p => p.code) : PERMISSIONS.filter(p => p.code === g).map(p => p.code)));
}

describe('fresh install matches an upgraded install for loyalty', () => {
  it('every system role that can issue gift cards can manage coupons', () => {
    const roles = SYSTEM_ROLES.filter(r => r.name !== 'platform_operations').map(r => ({ name: r.name, perms: expand(r.permissions as readonly string[]) }));
    const issuers = roles.filter(r => r.perms.has('gift_card.issue'));
    expect(issuers.map(r => r.name)).toEqual(expect.arrayContaining(['owner', 'global_admin']));
    expect(issuers.filter(r => !r.perms.has('coupon.manage')).map(r => r.name)).toEqual([]);
    expect(PERMISSIONS.some(p => p.code === 'coupon.manage')).toBe(true);
  });

  it('the default chart has the points accounts and links the expense account', async () => {
    const created: Array<{ model: string; data: Record<string, unknown>; id: string }> = [];
    const model = (name: string) => new Proxy({}, { get: () => async (args: { data?: Record<string, unknown>; create?: Record<string, unknown> }) => {
      const id = randomUUID(); created.push({ model: name, data: args?.data ?? args?.create ?? {}, id }); return { id, ...(args?.data ?? {}) };
    } });
    const tx = new Proxy({}, { get: (_t, name: string) => model(name) }) as never;
    await seedDefaultCoa(tx, 'company-fresh');
    const account = (code: string) => created.find(c => c.model === 'chartOfAccount' && c.data.code === code);
    expect(account('2500')?.data).toMatchObject({ accountClass: 'liability', accountSubtype: 'reward_points_liability' });
    expect(account('5700')?.data).toMatchObject({ accountClass: 'expense', accountSubtype: 'reward_expense' });
    const policy = created.find(c => c.model === 'accountingPolicy');
    expect(policy?.data.rewardExpenseAccountId).toBe(account('5700')!.id);
  });
});
