// Onboarding inserts one role_permissions row per catalogue entry a system
// role is granted. A code listed twice in the catalogue made the second
// insert collide on the primary key, so every company onboarding failed.

import { describe, expect, it } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES } from '../../src/lib/permissions/catalogue';

describe('permission catalogue', () => {
  it('lists every permission code once', () => {
    const codes = PERMISSIONS.map(p => p.code);
    expect(codes.filter((code, i) => codes.indexOf(code) !== i)).toEqual([]);
  });

  it('expands each system role to distinct permissions', () => {
    for (const spec of SYSTEM_ROLES) {
      const raw = spec.permissions as readonly string[];
      const perms = raw.includes('*') ? PERMISSIONS : raw.flatMap(p => p.endsWith('.*')
        ? PERMISSIONS.filter(x => x.code.startsWith(p.slice(0, -1))) : PERMISSIONS.filter(x => x.code === p));
      const codes = perms.map(p => p.code);
      expect(new Set(codes).size, spec.name).toBe(codes.length);
    }
  });
});
