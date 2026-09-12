import { describe, expect, it } from 'vitest';
import { assertBranchAssignment, assertCompanyScope, assertGrantAuthority } from '@/lib/access/policy';
import { userInput, roleInput } from '@/lib/access/service';
describe('Access Control fail-closed policy', () => {
  it('rejects tenant escape', () => expect(() => assertCompanyScope({ companyId: 'A', isGlobal: false }, 'B')).toThrow('Company access denied'));
  it('allows explicit authorized platform selection', () => expect(() => assertCompanyScope({ companyId: 'P', isGlobal: true }, 'B')).not.toThrow());
  it('rejects foreign branch IDs', () => expect(() => assertBranchAssignment(['B'], ['A'], false)).toThrow('Branch assignment'));
  it('accepts assigned multiple branches', () => expect(() => assertBranchAssignment(['A', 'B'], ['A', 'B'], false)).not.toThrow());
  it('cannot grant unowned permission', () => expect(() => assertGrantAuthority(['sale.post'], new Set(['sale.read']), false)).toThrow('authority'));
  it('cannot grant platform permissions even when legacy role contains them', () => expect(() => assertGrantAuthority(['platform.onboarding.execute'], new Set(['platform.onboarding.execute']), false)).toThrow('authority'));
  it('rejects mass assignment', () => expect(() => userInput.parse({ company_id: 'A', name: 'Test', email: 'test@example.invalid', role_ids: [], branch_ids: ['A'], access_scope: 'single_branch', is_active: true, mfaEnabled: true })).toThrow());
  it('rejects system-role creation flags', () => expect(() => roleInput.parse({ company_id: 'A', name: 'Test', permission_ids: [], isSystemRole: true })).toThrow());
});
