import { describe, expect, it } from 'vitest';
import { BRANCH_PARENTS, branchScopeFor, modelByName } from '@/lib/db/modelBranchScope';

describe('explicit branch ownership filters', () => {
  for (const model of Object.keys(BRANCH_PARENTS)) {
    it(`${model} has valid schema ownership paths ending at branch predicates`, () => {
      expect(modelByName.has(model)).toBe(true);
      const filter = branchScopeFor(model, ['allowed-a']);
      expect(filter).not.toBeNull();
      expect(JSON.stringify(filter)).toContain('allowed-a');
      expect(JSON.stringify(filter)).not.toContain('denied-b');
    });
  }
  it('requires both transfer endpoints to be accessible', () => {
    const filter = JSON.stringify(branchScopeFor('Transfer', ['allowed-a']));
    expect(filter).toContain('fromWarehouse'); expect(filter).toContain('toWarehouse');
  });
  it('keeps journals indivisible across branch scope', () => {
    expect(branchScopeFor('JournalEntry', ['allowed-a'])).toEqual({ AND: [
      { lines: { every: { AND: [{ OR: [{ branchId: null }, { branchId: { in: ['allowed-a'] } }] }] } } },
    ] });
  });
  it('does not pretend company-wide identity records are branch-owned', () => {
    expect(branchScopeFor('User', ['allowed-a'])).toBeNull();
  });
});
