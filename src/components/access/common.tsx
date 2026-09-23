'use client';
import { apiFetch } from '@/lib/api/client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useDashboardSession } from '@/components/dashboard/session';

export type Company = { id: string; displayName: string; code: string };
export type Branch = { id: string; name: string; code: string };
export type Permission = { id: string; code: string; module: string; description: string };
export type Role = { id: string; name: string; description: string | null; companyId: string; isSystemRole: boolean; createdAt: string;
  permissions: { permission: Permission }[]; _count: { users: number } };
export type User = { id: string; name: string; email: string; companyId: string; company: Company; accessScope: string; isActive: boolean;
  mfaEnabled: boolean; lockedUntil: string | null; lastLoginAt: string | null; createdAt: string;
  roles: { role: Pick<Role, 'id' | 'name' | 'isSystemRole'> }[]; branchAccess: { branch: Branch }[] };
export const control = 'rounded-md border border-input bg-background px-3 py-2 min-h-10 max-w-full text-sm disabled:opacity-50';
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const result = await response.json().catch(() => null);
  if (!response.ok || response.status === 202 || result?.error) throw new Error(result?.error?.message || 'Request failed. Please retry.');
  if (!result) throw new Error('Unexpected response. Please retry.');
  return result as T;
}
export function useAccess(companyOverride?: string) {
  const user = useDashboardSession();
  const [company, setCompany] = useState(companyOverride || '');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [error, setError] = useState('');
  const [companySearch, setCompanySearch] = useState('');
  const can = (permission: string) => Boolean(user && (user.is_global || user.permissions.includes(permission)));
  useEffect(() => { if (!company && user) setCompany(companyOverride || user.company_id); }, [company, companyOverride, user]);
  useEffect(() => {
    if (!user?.is_global) return;
    const controller = new AbortController();
    const query = companySearch ? `?search=${encodeURIComponent(companySearch)}` : '';
    request<{ data: Company[] }>(`/api/v1/admin/companies${query}`, { signal: controller.signal }).then(result => setCompanies(result.data))
      .catch(() => { if (!controller.signal.aborted) setError('Company list unavailable.'); });
    return () => controller.abort();
  }, [user?.is_global, companySearch]);
  return { user, company, setCompany, companies, companySearch, setCompanySearch, error, can, assured: Boolean(user?.mfa_enabled && user.mfa_verified) };
}
export function AccessHeading({ title }: { title: string }) {
  const user = useDashboardSession();
  const can = (permission: string) => user?.is_global || user?.permissions.includes(permission);
  return <header className="space-y-3"><h1 className="text-2xl font-bold">{title}</h1><nav aria-label="Access Control" className="flex flex-wrap gap-2 border-b pb-3 [&>a]:rounded-md [&>a]:px-3 [&>a]:py-2 [&>a]:text-sm [&>a]:font-medium [&>a:hover]:bg-accent">
    {can('user.read') && <Link href="/dashboard/access/users">Users</Link>}
    {can('role.read') && <><Link href="/dashboard/access/roles">Roles</Link><Link href="/dashboard/access/permissions">Permissions</Link></>}
  </nav></header>;
}
export function CompanyPicker({ access, disabled = false }: { access: ReturnType<typeof useAccess>; disabled?: boolean }) {
  return access.user?.is_global ? <label className="grid gap-1">Company<input aria-label="Search companies" className={control} placeholder="Search companies" value={access.companySearch} onChange={event => access.setCompanySearch(event.target.value)} disabled={disabled} /><select aria-label="Company" className={control} value={access.company} disabled={disabled}
    onChange={event => access.setCompany(event.target.value)}><option value="">Select company</option>
    {access.companies.map(company => <option key={company.id} value={company.id}>{company.displayName} ({company.code})</option>)}</select></label>
    : <p>Company: {access.user?.company_name}</p>;
}
export function date(value: string | null) { return value ? new Date(value).toLocaleString() : 'Never'; }
