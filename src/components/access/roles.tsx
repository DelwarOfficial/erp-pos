'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AccessHeading, CompanyPicker, control, date, request, useAccess, type Permission, type Role, type User } from './common';

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
  return <div className="space-y-5"><AccessHeading title="Roles" /><CompanyPicker access={access} />
    {access.can('role.create') && <Link className={control} href={`/dashboard/access/roles/new?company_id=${access.company}`}>Create Role</Link>}
    <Input aria-label="Search roles" placeholder="Search roles" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
    {loading ? <p role="status">Loading roles…</p> : error ? <p role="alert">{error}</p> : !roles.length ? <p>No roles found.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Role', 'Scope', 'Users', 'Permissions', 'Protection', 'Created'].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{roles.map(role => <tr className="border-t" key={role.id}>
      <td className="p-2"><Link className="underline" href={`/dashboard/access/roles/${role.id}?company_id=${access.company}`}>{role.name}</Link></td><td>Selected company</td><td>{role._count.users}</td><td>{role.permissions.length}</td><td>{role.isSystemRole ? 'Protected system role' : 'Custom'}</td><td>{date(role.createdAt)}</td></tr>)}</tbody></table></div>}
    {!error && <div className="flex gap-3 items-center"><Button disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page}</span><Button disabled={loading || page * 25 >= total} onClick={() => setPage(page + 1)}>Next</Button></div>}
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
    try { await request(`/api/v1/admin/roles/${id}?company_id=${access.company}`, { method: 'DELETE' }); window.location.assign('/dashboard/access/roles'); }
    catch (error) { setError(error instanceof Error ? error.message : 'Delete failed.'); } finally { setBusy(false); }
  }
  if (!allowed) return <p role="alert">Access Control access denied.</p>;
  return <div className="space-y-5"><AccessHeading title={creating ? 'Create Role' : 'Role details'} /><CompanyPicker access={access} disabled={!creating} />
    {!access.assured && <p role="alert">Verified MFA session required to change access.</p>}{role?.isSystemRole && <p>This system role is protected and cannot be changed or deleted.</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {loading ? <p role="status">Loading role…</p> : <form onSubmit={save} className="space-y-4"><label className="block">Role name<Input required maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={!editable} /></label>
      <label className="block">Description<Input maxLength={191} value={description} onChange={event => setDescription(event.target.value)} disabled={!editable} /></label>
      <p>Assign only permissions needed for this role. Server checks your granting authority.</p>
      {[...new Set(permissions.map(permission => permission.module))].map(module => <fieldset className="border rounded p-3" disabled={!editable} key={module}><legend className="font-semibold">{module}</legend>
        {permissions.filter(permission => permission.module === module).map(permission => <label className="block py-1" key={permission.id}><input type="checkbox" checked={selected.includes(permission.id)} onChange={() => setSelected(selected.includes(permission.id) ? selected.filter(item => item !== permission.id) : [...selected, permission.id])} /> {permission.description} <span className="text-xs text-muted-foreground">({permission.code})</span></label>)}</fieldset>)}
      {editable && <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Role'}</Button>}</form>}
    {!creating && <section><h2 className="font-semibold">Assigned users</h2>{users.length ? <ul>{users.map(user => <li key={user.id}><Link href={`/dashboard/access/users/${user.id}?company_id=${access.company}`}>{user.name}</Link></li>)}</ul> : <p>No visible assigned users.</p>}
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
  return <div className="space-y-5"><AccessHeading title="Permissions" /><p>Permissions are assigned through roles, not directly to users.</p>
    {loading ? <p role="status">Loading permissions…</p> : error ? <p role="alert">{error}</p> : !rows.length ? <p>No permissions available.</p> : [...new Set(rows.map(item => item.module))].map(module => <section key={module}><h2 className="font-semibold">{module}</h2><ul>{rows.filter(item => item.module === module).map(item => <li className="border-b py-2" key={item.id}>{item.description} <code className="text-xs">{item.code}</code></li>)}</ul></section>)}
  </div>;
}
