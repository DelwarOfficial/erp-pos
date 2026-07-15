// src/hooks/useAuth.ts
// Client-side auth hook — returns current user from /api/v1/me.
// Used by PermissionGate and other shared components.

'use client';
import { useEffect, useState } from 'react';

interface AuthUser {
  id: string;
  name: string;
  email: string;
  is_global: boolean;
  mfa_enabled: boolean;
  branch_ids: string[];
  roles: Array<{ id: string; name: string; is_system: boolean }>;
  permissions: string[];
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => setUser(d?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  return { user, loading };
}
