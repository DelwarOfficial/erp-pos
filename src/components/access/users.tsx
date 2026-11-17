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
  const [rolePage, setRolePage] = useState(1), [roleTotal, setRoleTotal] = useState(0);
  const [roles, setRoles] = useState<Role[]>([]), [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const allowed = access.can('user.read');
  useEffect(() => { setPage(1); setRolePage(1); setRows([]); setRole(''); setBranch(''); }, [access.company]);
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
    if (access.can('role.read')) request<{ data: Role[]; total: number }>(`/api/v1/admin/roles?company_id=${access.company}&page=${rolePage}`, { signal: controller.signal }).then(value => { setRoles(value.data); setRoleTotal(value.total); }).catch(() => {});
    if (access.can('branch.read')) request<{ data: Branch[] }>(`/api/v1/admin/branches?company_id=${access.company}`, { signal: controller.signal }).then(value => setBranches(value.data)).catch(() => {});
    return () => controller.abort();
  }, [allowed, access.company, rolePage]);
  if (!allowed) return <p role="alert">Access Control access denied.</p>;
  return <div className="min-w-0 space-y-6 pb-6"><AccessHeading company={access.company} title="Users" /><section className="rounded-xl border bg-card p-5"><h2 className="mb-3 text-sm font-semibold">Company scope</h2><CompanyPicker access={access} /></section>
    {access.error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{access.error}</p>}
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">User directory</h2><p className="mt-1 text-sm text-muted-foreground">Review accounts, role assignments, and sign-in security.</p></div>{access.can('user.create') && access.can('role.assign') && access.can('user.deactivate') && <Link className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring" href={`/dashboard/access/users/new?company_id=${access.company}`}>Add User</Link>}</div>
    <div className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2 xl:grid-cols-4"><label className="grid gap-2 text-sm font-medium sm:col-span-2 xl:col-span-4">Search users<Input className="min-h-11" aria-label="Search users" placeholder="Search name or email" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
      <label className="grid gap-2 text-sm font-medium">Account status<select aria-label="Status filter" className={control} value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Suspended</option></select></label>
      <label className="grid gap-2 text-sm font-medium">Role<select aria-label="Role filter" className={control} value={role} onChange={event => { setRole(event.target.value); setPage(1); }}><option value="">All roles</option>{roles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {roleTotal > 25 && <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-4"><Button disabled={rolePage === 1} onClick={() => { setRole(''); setRolePage(rolePage - 1); }}>Previous role options</Button><Button disabled={rolePage * 25 >= roleTotal} onClick={() => { setRole(''); setRolePage(rolePage + 1); }}>Next role options</Button></div>}
      <label className="grid gap-2 text-sm font-medium">Branch<select aria-label="Branch filter" className={control} value={branch} onChange={event => { setBranch(event.target.value); setPage(1); }}><option value="">All branches</option>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="grid gap-2 text-sm font-medium">Sort by<select aria-label="Sort users" className={control} value={sort} onChange={event => setSort(event.target.value)}><option value="name">Name</option><option value="email">Email</option><option value="createdAt">Created date</option><option value="lastLoginAt">Last login</option></select></label></div>
    {loading ? <p role="status" className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">Loading users…</p> : error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p> : !rows.length ? <div className="rounded-xl border bg-card p-10 text-center"><h2 className="font-semibold">No users match these filters.</h2><p className="mt-2 text-sm text-muted-foreground">Try a different name or adjust the filters above.</p></div> : <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[1120px] text-sm [&_td]:px-5 [&_td]:py-4 [&_td]:align-top"><caption className="sr-only">Company users</caption><thead className="border-b bg-muted/40 text-xs text-muted-foreground"><tr>{['Name', 'Email', 'Company', 'Roles', 'Branch access', 'Status', 'MFA', 'Last login', 'Created'].map(label => <th scope="col" className="whitespace-nowrap px-5 py-3 text-left font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(user => <tr key={user.id} className="border-t hover:bg-muted/30">
      <td className="p-2"><Link className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" href={`/dashboard/access/users/${user.id}?company_id=${access.company}`}>{user.name}</Link></td><td>{user.email}</td><td>{user.company.displayName}</td>
      <td>{user.roles.map(item => item.role.name).join(', ') || 'None'}</td><td>{user.accessScope === 'global' ? 'All company branches' : user.branchAccess.map(item => item.branch.name).join(', ') || 'None'}</td>
      <td><span className={user.isActive ? 'inline-flex whitespace-nowrap rounded-md border bg-primary/10 px-2 py-1 text-xs font-medium text-primary' : 'inline-flex whitespace-nowrap rounded-md border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground'}>{user.isActive ? 'Active' : 'Suspended'}</span></td><td><span className="inline-flex whitespace-nowrap rounded-md border bg-muted/40 px-2 py-1 text-xs font-medium">{user.mfaEnabled ? 'Enabled' : 'Not enrolled'}</span></td><td>{date(user.lastLoginAt)}</td><td>{date(user.createdAt)}</td></tr>)}</tbody></table></div>}
    {!error && <div className="flex flex-wrap items-center justify-end gap-3 rounded-xl border bg-card p-4 text-sm"><Button disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page}{!loading && ` · ${total} users`}</span><Button disabled={loading || page * 25 >= total} onClick={() => setPage(page + 1)}>Next</Button></div>}
  </div>;
}

export function UserEditor({ id, companyId }: { id: string; companyId?: string }) {
  const access = useAccess(companyId), creating = id === 'new';
  const [user, setUser] = useState<User | null>(null), [roles, setRoles] = useState<Role[]>([]), [branches, setBranches] = useState<Branch[]>([]);
  const [branchSearch, setBranchSearch] = useState('');
  const [rolePage, setRolePage] = useState(1), [roleTotal, setRoleTotal] = useState(0), [roleLoading, setRoleLoading] = useState(false), [roleError, setRoleError] = useState('');
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]), [branchIds, setBranchIds] = useState<string[]>([]), [scope, setScope] = useState('single_branch'), [active, setActive] = useState(true);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [resetLink, setResetLink] = useState('');
  const allowed = access.can(creating ? 'user.create' : 'user.read');
  const editable = access.can(creating ? 'user.create' : 'user.update') && access.can('role.assign') && access.can('user.deactivate') && access.assured;
  useEffect(() => {
    if (!allowed || !access.company) return;
    const controller = new AbortController(); setLoading(true); setError(''); setResetLink(''); setUser(null); setRoleIds([]); setBranchIds([]); setRolePage(1);
    Promise.all([
      creating ? Promise.resolve(null) : request<{ data: User }>(`/api/v1/admin/users/${id}?company_id=${access.company}`, { signal: controller.signal }),
    ]).then(([result]) => { if (controller.signal.aborted) return;
      if (result) { const value = result.data; setUser(value); setName(value.name); setEmail(value.email); setScope(value.accessScope); setActive(value.isActive); setRoleIds(value.roles.map(item => item.role.id)); setBranchIds(value.branchAccess.map(item => item.branch.id)); }
    }).catch(() => { if (!controller.signal.aborted) setError('User or assignment options unavailable.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [allowed, access.company, creating, id]);
  useEffect(() => {
    if (!allowed || !access.company || !access.can('branch.read')) return;
    const controller = new AbortController();
    request<{ data: Branch[] }>(`/api/v1/admin/branches?company_id=${access.company}&search=${encodeURIComponent(branchSearch)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setBranches(result.data); }).catch(() => {});
    return () => controller.abort();
  }, [allowed, access.company, branchSearch]);
  useEffect(() => {
    if (!allowed || !access.company || !access.can('role.read')) return;
    const controller = new AbortController(); setRoleLoading(true); setRoleError('');
    request<{ data: Role[]; total: number }>(`/api/v1/admin/roles?company_id=${access.company}&page=${rolePage}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setRoles(result.data); setRoleTotal(result.total); } })
      .catch(() => { if (!controller.signal.aborted) setRoleError('Role options unavailable. Retry or reload before saving.'); })
      .finally(() => { if (!controller.signal.aborted) setRoleLoading(false); });
    return () => controller.abort();
  }, [allowed, access.company, rolePage]);
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
  return <div className="space-y-5"><AccessHeading company={access.company} title={creating ? 'Add User' : 'User details'} /><CompanyPicker access={access} disabled={!creating} />
    {!access.assured && <p role="alert">Verified MFA session required to change access.</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {loading ? <p role="status">Loading user…</p> : <Card><CardContent><form className="grid gap-4 pt-5" onSubmit={save}>
      <label>Full name<Input value={name} onChange={event => setName(event.target.value)} required maxLength={150} disabled={!editable} /></label>
      <label>Email<Input type="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={150} disabled={!editable} /></label>
      {creating && <label>Initial password<Input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={12} maxLength={200} disabled={!editable} /></label>}
      <label>Branch access scope<select aria-label="Branch access scope" className={`${control} block`} value={scope} onChange={event => setScope(event.target.value)} disabled={!editable}><option value="single_branch">Single branch</option><option value="multi_branch">Multiple branches</option>{(access.user?.is_global || access.user?.access_scope === 'global') && <option value="global">All company branches</option>}</select></label>
      <fieldset disabled={!editable} className="border rounded p-3"><legend>Allowed branches</legend><Input aria-label="Search branches" placeholder="Search branches" value={branchSearch} onChange={event => setBranchSearch(event.target.value)} />{branches.map(branch => <label key={branch.id} className="block"><input type="checkbox" checked={branchIds.includes(branch.id)} onChange={() => setBranchIds(toggle(branchIds, branch.id))} /> {branch.name}</label>)}{!branches.length && <p>No branch options available.</p>}</fieldset>
      <fieldset disabled={!editable} className="border rounded p-3"><legend>Roles</legend>{roles.map(role => <label key={role.id} className="block"><input type="checkbox" checked={roleIds.includes(role.id)} onChange={() => setRoleIds(toggle(roleIds, role.id))} /> {role.name}{role.isSystemRole ? ' (protected role)' : ''}</label>)}{!roles.length && <p>No role options available.</p>}</fieldset>
      {roleError && <p role="alert">{roleError}</p>}
      <p>{roleIds.length} roles selected across all pages.</p>
      {roleTotal > 25 && <div><Button type="button" disabled={roleLoading || rolePage === 1} onClick={() => setRolePage(rolePage - 1)}>Previous role options</Button><span>Role page {rolePage}</span><Button type="button" disabled={roleLoading || rolePage * 25 >= roleTotal} onClick={() => setRolePage(rolePage + 1)}>Next role options</Button></div>}
      <label><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} disabled={!editable} /> Active account (uncheck to suspend)</label>
      {user && <p>MFA: {user.mfaEnabled ? 'Enabled' : 'Not enrolled'} · Account locked: {user.lockedUntil && new Date(user.lockedUntil) > new Date() ? 'Yes' : 'No'} · Last login: {date(user.lastLoginAt)}</p>}
      {editable && <Button type="submit" disabled={busy || roleLoading || Boolean(roleError) || Boolean(error && !user && !creating)}>{busy ? 'Saving…' : 'Save User'}</Button>}
      <Button type="button" variant="outline" disabled={busy} asChild><Link href={`/dashboard/access/users?company_id=${encodeURIComponent(access.company)}`}>Cancel</Link></Button>
    </form></CardContent></Card>}
    {!creating && access.can('user.reset_password') && access.assured && <Button disabled={busy || !user?.isActive} onClick={reset}>Issue password reset link</Button>}
    {resetLink && <div role="status" className="space-y-2"><p>Shown once. Expires in 15 minutes. Share securely; never paste into public messages.</p><textarea aria-label="One-time reset link" className={`${control} w-full`} readOnly value={resetLink} /><Button onClick={() => setResetLink('')}>Dismiss reset link</Button></div>}
  </div>;
}
