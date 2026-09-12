'use client';
import { createContext, useContext } from 'react';

export interface DashboardUser {
  id: string; name: string; email: string; company_code: string; company_name: string;
  access_scope: string; is_global: boolean; mfa_enabled: boolean; mfa_verified: boolean;
  branch_ids: string[]; branches?: { id: string; name: string; code: string }[];
  roles: { id: string; name: string; is_system: boolean }[]; permissions: string[];
}
export const DashboardSession = createContext<DashboardUser | null>(null);
export function useDashboardSession() { return useContext(DashboardSession); }
