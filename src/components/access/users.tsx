'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { AccessHeading, CompanyPicker, control, date, request, useAccess, type User, type Role, type Branch } from './common';

export function UsersList() {
  const access = useAccess();
  const [rows, setRows] = useState<User[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [search, setSearch] = useState(''), [status, setStatus] = useState('all'), [sort, setSort] = useState('name');
  const [role, setRole] = useState(''), [branch, setBranch] = useState('');
  const [roles, setRoles] = useState<Role[]>([]), [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const allowed = access.can('user.read');
  useEffect(() => { setPage(1); setRows([]); setRole(''); setBranch(''); }, [access.company]);
  useEffect(() => {
    if (!allowed || !access.company) return;
    const controller = new AbortController(); setLoading(true); setError('');
    const query = new URLSearchParams({ company_id: access.company, page: String(page), search, status, sort, role_id: role, branch_id: branch });
    const timer = setTimeout(() => request<{ data: User[]; total: number }>(`/api/v1/admin/users?${query}`, { signal: controller.signal })
      .then(result => { setRows(result.data); setTotal(result.total); }).catch(() => { if (!controller.signal.aborted) { setRows([]); setError('User list unavailable. Please retry.'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); }), 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [allowed, access.company, page, search, status, sort, role, branch]);
  useEffect(() => {
    if (!allowed || !access.company) return;
    const controller = new AbortController(); setRoles([]); setBranches([]);
    if (access.can('role.read')) request<{ data: Role[] }>(`/api/v1/admin/roles?company_id=${access.company}`, { signal: controller.signal }).then(value => setRoles(value.data)).catch(() => {});
    if (access.can('branch.read')) request<{ data: Branch[] }>(`/api/v1/admin/branches?company_id=${access.company}`, { signal: controller.signal }).then(value => setBranches(value.data)).catch(() => {});
    return () => controller.abort();
  }, [allowed, access.company]);
  if (!allowed) return <p role="alert">Access Control access denied.</p>;
  return <div className="space-y-5"><AccessHeading title="Users" /><CompanyPicker access={access} />
    {access.error && <p role="alert">{access.error}</p>}
    {access.can('user.create') && access.can('role.assign') && access.can('user.deactivate') && <Link className={control} href={`/dashboard/access/users/new?company_id=${access.company}`}>Add User</Link>}
    <div className="flex flex-wrap gap-3"><Input aria-label="Search users" placeholder="Search name or email" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
      <select aria-label="Status filter" className={control} value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Suspended</option></select>
      <select aria-label="Role filter" className={control} value={role} onChange={event => { setRole(event.target.value); setPage(1); }}><option value="">All roles</option>{roles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select aria-label="Branch filter" className={control} value={branch} onChange={event => { setBranch(event.target.value); setPage(1); }}><option value="">All branches</option>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select aria-label="Sort users" className={control} value={sort} onChange={event => setSort(event.target.value)}><option value="name">Name</option><option value="email">Email</option><option value="createdAt">Created date</option><option value="lastLoginAt">Last login</option></select></div>
    {loading ? <p role="status">Loading users…</p> : error ? <p role="alert">{error}</p> : !rows.length ? <p>No users match these filters.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Company users</caption><thead><tr>{['Name', 'Email', 'Company', 'Roles', 'Branch access', 'Status', 'MFA', 'Last login', 'Created'].map(label => <th className="p-2 text-left" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(user => <tr key={user.id} className="border-t">
      <td className="p-2"><Link className="underline" href={`/dashboard/access/users/${user.id}?company_id=${access.company}`}>{user.name}</Link></td><td>{user.email}</td><td>{user.company.displayName}</td>
      <td>{user.roles.map(item => item.role.name).join(', ') || 'None'}</td><td>{user.accessScope === 'global' ? 'All company branches' : user.branchAccess.map(item => item.branch.name).join(', ') || 'None'}</td>
      <td>{user.isActive ? 'Active' : 'Suspended'}</td><td>{user.mfaEnabled ? 'Enabled' : 'Not enrolled'}</td><td>{date(user.lastLoginAt)}</td><td>{date(user.createdAt)}</td></tr>)}</tbody></table></div>}
    {!error && <div className="flex gap-3 items-center"><Button disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page}{!loading && ` · ${total} users`}</span><Button disabled={loading || page * 25 >= total} onClick={() => setPage(page + 1)}>Next</Button></div>}
  </div>;
}

export function UserEditor({ id, companyId }: { id: string; companyId?: string }) {
  const access = useAccess(companyId), creating = id === 'new';
  const [user, setUser] = useState<User | null>(null), [roles, setRoles] = useState<Role[]>([]), [branches, setBranches] = useState<Branch[]>([]);
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]), [branchIds, setBranchIds] = useState<string[]>([]), [scope, setScope] = useState('single_branch'), [active, setActive] = useState(true);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [resetLink, setResetLink] = useState('');
  const allowed = access.can(creating ? 'user.create' : 'user.read');
  const editable = access.can(creating ? 'user.create' : 'user.update') && access.can('role.assign') && access.can('user.deactivate') && access.assured;
  useEffect(() => {
    if (!allowed || !access.company) return;
    const controller = new AbortController(); setLoading(true); setError(''); setResetLink(''); setUser(null); setRoleIds([]); setBranchIds([]);
    Promise.all([
      access.can('role.read') ? request<{ data: Role[] }>(`/api/v1/admin/roles?company_id=${access.company}`, { signal: controller.signal }) : Promise.resolve({ data: [] }),
      access.can('branch.read') ? request<{ data: Branch[] }>(`/api/v1/admin/branches?company_id=${access.company}`, { signal: controller.signal }) : Promise.resolve({ data: [] }),
      creating ? Promise.resolve(null) : request<{ data: User }>(`/api/v1/admin/users/${id}?company_id=${access.company}`, { signal: controller.signal }),
    ]).then(([roleResult, branchResult, result]) => { setRoles(roleResult.data); setBranches(branchResult.data);
      if (result) { const value = result.data; setUser(value); setName(value.name); setEmail(value.email); setScope(value.accessScope); setActive(value.isActive); setRoleIds(value.roles.map(item => item.role.id)); setBranchIds(value.branchAccess.map(item => item.branch.id)); }
    }).catch(() => { if (!controller.signal.aborted) setError('User or assignment options unavailable.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [allowed, access.company, creating, id]);
  function toggle(values: string[], value: string) { return values.includes(value) ? values.filter(item => item !== value) : [...values, value]; }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!window.confirm('Save access changes? Existing sessions for this user will be signed out.')) return;
    setBusy(true); setError(''); setMessage('');
    try { const result = await request<{ data: User }>(creating ? '/api/v1/admin/users' : `/api/v1/admin/users/${id}`, { method: creating ? 'POST' : 'PATCH', body: JSON.stringify({ company_id: access.company,
      name, email, role_ids: roleIds, branch_ids: branchIds, access_scope: scope, is_active: active, ...(creating ? { password } : {}) }) });
      setPassword(''); setUser(result.data); setMessage(creating ? 'User created. Share initial credentials through a secure channel.' : 'User updated. Previous sessions revoked.');
      if (creating) window.location.assign(`/dashboard/access/users/${result.data.id}?company_id=${access.company}`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Save failed.'); } finally { setBusy(false); }
  }
  async function reset() {
    if (!window.confirm('Issue a one-time password reset link? Deliver it securely to this user. MFA remains required.')) return;
    setBusy(true); setError(''); setResetLink('');
    try { const result = await request<{ token: string }>(`/api/v1/admin/users/${id}/password-reset`, { method: 'POST', body: JSON.stringify({ company_id: access.company }) });
      setResetLink(`${window.location.origin}/reset-password#${result.token}`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Reset failed.'); } finally { setBusy(false); }
  }
  if (!allowed) return <p role="alert">Access Control access denied.</p>;
  return <div className="space-y-5"><AccessHeading title={creating ? 'Add User' : 'User details'} /><CompanyPicker access={access} disabled={!creating} />
    {!access.assured && <p role="alert">Verified MFA session required to change access.</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {loading ? <p role="status">Loading user…</p> : <Card><CardContent><form className="grid gap-4 pt-5" onSubmit={save}>
      <label>Full name<Input value={name} onChange={event => setName(event.target.value)} required maxLength={150} disabled={!editable} /></label>
      <label>Email<Input type="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={150} disabled={!editable} /></label>
      {creating && <label>Initial password<Input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={12} maxLength={200} disabled={!editable} /></label>}
      <label>Branch access scope<select className={`${control} block`} value={scope} onChange={event => setScope(event.target.value)} disabled={!editable}><option value="single_branch">Single branch</option><option value="multi_branch">Multiple branches</option>{(access.user?.is_global || access.user?.access_scope === 'global') && <option value="global">All company branches</option>}</select></label>
      <fieldset disabled={!editable} className="border rounded p-3"><legend>Allowed branches</legend>{branches.map(branch => <label key={branch.id} className="block"><input type="checkbox" checked={branchIds.includes(branch.id)} onChange={() => setBranchIds(toggle(branchIds, branch.id))} /> {branch.name}</label>)}{!branches.length && <p>No branch options available.</p>}</fieldset>
      <fieldset disabled={!editable} className="border rounded p-3"><legend>Roles</legend>{roles.map(role => <label key={role.id} className="block"><input type="checkbox" checked={roleIds.includes(role.id)} onChange={() => setRoleIds(toggle(roleIds, role.id))} /> {role.name}{role.isSystemRole ? ' (protected role)' : ''}</label>)}{!roles.length && <p>No role options available.</p>}</fieldset>
      <label><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} disabled={!editable} /> Active account (uncheck to suspend)</label>
      {user && <p>MFA: {user.mfaEnabled ? 'Enabled' : 'Not enrolled'} · Account locked: {user.lockedUntil && new Date(user.lockedUntil) > new Date() ? 'Yes' : 'No'} · Last login: {date(user.lastLoginAt)}</p>}
      {editable && <Button type="submit" disabled={busy || Boolean(error && !user && !creating)}>{busy ? 'Saving…' : 'Save User'}</Button>}
    </form></CardContent></Card>}
    {!creating && access.can('user.reset_password') && access.assured && <Button disabled={busy || !user?.isActive} onClick={reset}>Issue password reset link</Button>}
    {resetLink && <div role="status" className="space-y-2"><p>Shown once. Expires in 15 minutes. Share securely; never paste into public messages.</p><textarea aria-label="One-time reset link" className={`${control} w-full`} readOnly value={resetLink} /><Button onClick={() => setResetLink('')}>Dismiss reset link</Button></div>}
  </div>;
}
