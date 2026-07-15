// src/components/shared/PermissionGate.tsx
// Conditionally renders children only if the user has the required permission.
// Per §6 rule 11 — sensitive fields (cost, margin) require separate field-level permission.

'use client';
import { useAuth } from '@/hooks/useAuth';

interface PermissionGateProps {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
  const { user } = useAuth();
  if (!user) return <>{fallback}</>;
  const hasPermission = user.is_global || user.permissions?.includes(permission);
  return hasPermission ? <>{children}</> : <>{fallback}</>;
}
