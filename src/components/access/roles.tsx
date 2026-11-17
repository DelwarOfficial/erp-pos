'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, BookKey, Layers3, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AccessHeading, CompanyPicker, date, request, useAccess, type Permission, type Role, type User } from './common';

export function RolesList() {
  const access = useAccess(); const [roles, setRoles] = useState<Role[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1), [total, setTotal] = useState(0), [search, setSearch] = useState('');
  const allowed = access.can('role.read');
  useEffect(() => {
    if (!allowed || !access.company) return;
    const controller = new AbortController(); setLoading(true); setError(''); setRoles([]);
    request<{ data: Role[]; total: number }>(`/api/v1/admin/roles?company_id=${access.company}&page=${page}&search=${encodeURIComponent(search)}`, { signal: controller.signal }).then(result => { setRoles(result.data); setTotal(result.total); })
      .catch(() => { if (!controller.signal.aborted) setError('Role list unavailable.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [allowed, access.company, page, search]);
  if (!allowed) return <p role="alert">Access Control access denied.</p>;
  return <div className="min-w-0 space-y-6 pb-6"><AccessHeading company={access.company} title="Roles" /><section className="rounded-xl border bg-card p-5"><h2 className="mb-3 text-sm font-semibold">Company scope</h2><CompanyPicker access={access} /></section>
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-base font-semibold">Role directory</h2><p className="mt-1 text-sm text-muted-foreground">Manage roles and review their assigned access.</p></div>{access.can('role.create') && <Link className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring" href={`/dashboard/access/roles/new?company_id=${access.company}`}>Create Role</Link>}</div>
    <label className="grid max-w-lg gap-2 text-sm font-medium">Search roles<Input className="min-h-11" aria-label="Search roles" placeholder="Search roles" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
    {loading ? <p role="status" className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">Loading roles…</p> : error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p> : !roles.length ? <div className="rounded-xl border bg-card p-10 text-center"><h2 className="font-semibold">No roles found.</h2><p className="mt-2 text-sm text-muted-foreground">Try another search or create a role if you have access.</p></div> : <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[720px] text-left text-sm [&_td]:px-5 [&_td]:py-4"><caption className="sr-only">Company roles</caption><thead className="border-b bg-muted/40 text-xs text-muted-foreground"><tr>{['Role', 'Scope', 'Users', 'Permissions', 'Protection', 'Created'].map(label => <th scope="col" className="px-5 py-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{roles.map(role => <tr className="border-t hover:bg-muted/30" key={role.id}>
      <td className="p-2"><Link className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" href={`/dashboard/access/roles/${role.id}?company_id=${access.company}`}>{role.name}</Link></td><td>Selected company</td><td>{role._count.users}</td><td>{role.permissions.length}</td><td><span className="inline-flex rounded-md border bg-muted/40 px-2 py-1 text-xs font-medium">{role.isSystemRole ? 'Protected system role' : 'Custom'}</span></td><td>{date(role.createdAt)}</td></tr>)}</tbody></table></div>}
    {!error && <div className="flex flex-wrap items-center justify-end gap-3 rounded-xl border bg-card p-4 text-sm"><Button disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-muted-foreground">Page {page}{!loading && ` / ${total} roles`}</span><Button disabled={loading || page * 25 >= total} onClick={() => setPage(page + 1)}>Next</Button></div>}
  </div>;
}

export function RoleEditor({ id, companyId }: { id: string; companyId?: string }) {
  const access = useAccess(companyId), creating = id === 'new';
  const [role, setRole] = useState<Role | null>(null), [permissions, setPermissions] = useState<Permission[]>([]), [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const allowed = access.can(creating ? 'role.create' : 'role.read');
  const editable = access.can(creating ? 'role.create' : 'role.update') && access.assured && !role?.isSystemRole;
  useEffect(() => {
    if (!allowed || !access.company) return;
    const controller = new AbortController(); setLoading(true); setError(''); setRole(null); setSelected([]); setUsers([]);
    Promise.all([request<{ data: Permission[] }>('/api/v1/admin/permissions', { signal: controller.signal }),
      creating ? Promise.resolve(null) : request<{ data: Role }>(`/api/v1/admin/roles/${id}?company_id=${access.company}`, { signal: controller.signal }),
      !creating && access.can('user.read') ? request<{ data: User[] }>(`/api/v1/admin/users?company_id=${access.company}&role_id=${id}`, { signal: controller.signal }) : Promise.resolve({ data: [] }),
    ]).then(([catalogue, result, assignments]) => { setPermissions(catalogue.data); setUsers(assignments.data);
      if (result) { setRole(result.data); setName(result.data.name); setDescription(result.data.description || ''); setSelected(result.data.permissions.map(item => item.permission.id)); }
    }).catch(() => { if (!controller.signal.aborted) setError('Role details unavailable.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [allowed, access.company, creating, id]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!window.confirm('Save permission changes? Assigned users will need to sign in again.')) return;
    setBusy(true); setError('');
    try { const result = await request<{ data: { id: string } }>(creating ? '/api/v1/admin/roles' : `/api/v1/admin/roles/${id}`, { method: creating ? 'POST' : 'PATCH',
      body: JSON.stringify({ company_id: access.company, name, description, permission_ids: selected }) });
      setMessage('Role saved.'); if (creating) window.location.assign(`/dashboard/access/roles/${result.data.id}?company_id=${access.company}`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Save failed.'); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm('Delete this unassigned custom role? This action cannot be undone.')) return;
    setBusy(true); setError('');
    try { await request(`/api/v1/admin/roles/${id}?company_id=${access.company}`, { method: 'DELETE' }); window.location.assign(`/dashboard/access/roles?company_id=${encodeURIComponent(access.company)}`); }
    catch (error) { setError(error instanceof Error ? error.message : 'Delete failed.'); } finally { setBusy(false); }
  }
  if (!allowed) return <p role="alert">Access Control access denied.</p>;
  return <div className="min-w-0 space-y-6 pb-6"><AccessHeading company={access.company} title={creating ? 'Create Role' : 'Role details'} /><section className="rounded-xl border bg-card p-5"><h2 className="mb-3 text-sm font-semibold">Company scope</h2><CompanyPicker access={access} disabled={!creating} /></section>
    {!access.assured && <p role="alert" className="rounded-lg border bg-muted/40 p-4 text-sm">Verified MFA session required to change access.</p>}{role?.isSystemRole && <p className="rounded-lg border bg-muted/40 p-4 text-sm">This system role is protected and cannot be changed or deleted.</p>}
    {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}{message && <p role="status" className="rounded-lg border bg-muted/40 p-4 text-sm">{message}</p>}
    {loading ? <p role="status" className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">Loading role…</p> : <form onSubmit={save} className="space-y-5"><section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6"><div><h2 className="font-semibold">Role information</h2><p className="mt-1 text-sm text-muted-foreground">Give this role a clear name and description.</p></div><label className="grid gap-2 text-sm font-medium">Role name<Input required maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={!editable} /></label>
      <label className="grid gap-2 text-sm font-medium">Description<Input maxLength={191} value={description} onChange={event => setDescription(event.target.value)} disabled={!editable} /></label>
      </section><div><h2 className="font-semibold">Permission assignments <span className="ml-2 text-sm font-normal text-muted-foreground">{selected.length} selected</span></h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Assign only the permissions needed for this role.</p></div>
      {[...new Set(permissions.map(permission => permission.module))].map(module => <fieldset className="min-w-0 rounded-xl border bg-card px-4 pb-3 pt-2 sm:px-6 disabled:opacity-70" disabled={!editable} key={module}><legend className="px-2 text-sm font-semibold capitalize">{module.replace(/[_-]/g, ' ')}</legend>
        {permissions.filter(permission => permission.module === module).map(permission => <label className="flex min-h-11 cursor-pointer items-start gap-3 border-b py-3 last:border-0 has-[:disabled]:cursor-default" key={permission.id}><input className="mt-1 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-ring" type="checkbox" checked={selected.includes(permission.id)} onChange={() => setSelected(selected.includes(permission.id) ? selected.filter(item => item !== permission.id) : [...selected, permission.id])} /><span className="min-w-0 text-sm leading-6">{permission.description}<code className="mt-1 block break-all text-xs text-muted-foreground">{permission.code}</code></span></label>)}</fieldset>)}
      <div className="flex flex-wrap gap-3 rounded-xl border bg-card p-4">{editable && <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Role'}</Button>}
      <Button type="button" variant="outline" disabled={busy} asChild><Link href={`/dashboard/access/roles?company_id=${encodeURIComponent(access.company)}`}>Cancel</Link></Button></div></form>}
    {!creating && <section className="space-y-3 rounded-xl border bg-card p-5 sm:p-6"><h2 className="font-semibold">Assigned users</h2>{users.length ? <ul className="divide-y">{users.map(user => <li className="py-3 text-sm" key={user.id}><Link className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline" href={`/dashboard/access/users/${user.id}?company_id=${access.company}`}>{user.name}</Link></li>)}</ul> : <p>No visible assigned users.</p>}
      {role && role._count.users > users.length && <p>Additional assignments exist. Use the Users role filter to paginate.</p>}</section>}
    {!creating && editable && <Button variant="destructive" disabled={busy || Boolean(role?._count.users)} onClick={remove}>Delete custom role</Button>}
  </div>;
}

export function PermissionsPage() {
  const access = useAccess(); const [rows, setRows] = useState<Permission[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const allowed = access.can('role.read');
  useEffect(() => { if (!allowed) return; const controller = new AbortController();
    request<{ data: Permission[] }>('/api/v1/admin/permissions', { signal: controller.signal }).then(result => setRows(result.data))
      .catch(() => { if (!controller.signal.aborted) setError('Permission catalogue unavailable.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort(); }, [allowed]);
  if (!allowed) return <p role="alert">Access Control access denied.</p>;
  return <div className="min-w-0 space-y-6 pb-6">
    <div className="[&_nav_a]:min-h-11 [&_nav_a[href*='/access/permissions']]:bg-primary/10 [&_nav_a[href*='/access/permissions']]:text-primary">
      <AccessHeading company={access.company} title="Permissions" />
    </div>

    <section aria-label="About permissions" className="flex flex-col gap-5 rounded-xl border bg-card p-5 text-card-foreground sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><ShieldCheck aria-hidden="true" className="size-5" /></div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Permission catalogue</h2>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">Review the actions available across your workspace. Permissions are assigned through roles, not directly to users.</p>
        </div>
      </div>
      <span className="inline-flex w-fit shrink-0 items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs font-medium"><LockKeyhole aria-hidden="true" className="size-3.5" />Read-only catalogue</span>
    </section>

    {loading ? <div role="status" className="flex min-h-48 items-center justify-center gap-3 rounded-xl border bg-card text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />Loading permissions…</div>
      : error ? <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive"><AlertCircle aria-hidden="true" className="size-5 shrink-0" /><div><p className="font-medium">Unable to load permissions</p><p className="mt-1">{error}</p></div></div>
      : !rows.length ? <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border bg-card p-6 text-center"><BookKey aria-hidden="true" className="mb-2 size-7 text-muted-foreground" /><h2 className="font-semibold">No permissions available.</h2><p className="text-sm text-muted-foreground">Permissions will appear here when they are available.</p></div>
      : <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">All permissions</h2><p className="text-xs text-muted-foreground">{rows.length} permissions <span aria-hidden="true" className="mx-1">·</span> {new Set(rows.map(item => item.module)).size} modules</p></div>
        {[...new Set(rows.map(item => item.module))].map(module => <section aria-label={`${module} permissions`} key={module} className="overflow-hidden rounded-xl border bg-card text-card-foreground">
          <header className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-4 sm:px-6">
            <h3 className="flex min-w-0 items-center gap-3 text-sm font-semibold"><Layers3 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /><span className="break-words capitalize">{module.replace(/[_-]/g, ' ')}</span></h3>
            <span className="shrink-0 rounded-md border bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{rows.filter(item => item.module === module).length} permissions</span>
          </header>
          <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 border-b px-6 py-2.5 text-xs font-medium text-muted-foreground md:grid"><span>Permission</span><span>Permission code</span></div>
          <ul className="divide-y">{rows.filter(item => item.module === module).map(item => <li className="grid min-w-0 gap-2 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-6 sm:px-6" key={item.id}>
            <p className="min-w-0 break-words text-sm leading-6">{item.description}</p>
            <code className="w-fit max-w-full break-all rounded-md border bg-muted/40 px-2 py-1 text-xs leading-5 text-muted-foreground">{item.code}</code>
          </li>)}</ul>
        </section>)}
      </div>}
  </div>;
}
