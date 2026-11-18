'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConfirmation } from '@/hooks/useConfirmation';
import { formatDate } from '@/lib/i18n/format';
import { LoadingState, EmptyState } from '@/components/shared/StateList';
import { apiFetch } from '@/lib/api/client';
import { useDashboardSession } from '@/components/dashboard/session';
import { useWorkflowMutation } from '@/hooks/useWorkflowMutation';
import { useDraftProtection } from '@/hooks/useDraftProtection';
import { EntityPicker, type BusinessEntity } from '@/components/shared/EntityPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { FeatureOffError, FeatureOffNotice, throwIfFeatureOff } from '@/components/shared/FeatureOff';
import { PayrollPanel } from '@/components/hr/PayrollPanel';

type Employee = { id: string; employee_no: string; name: string; phone: string | null; email: string | null; branch: BusinessEntity; department: BusinessEntity | null; designation: BusinessEntity | null; employment_status: string; base_salary: string; join_date: string };
type Detail = { id: string; employeeNo: string; name: string; phone: string | null; email: string | null; address: string | null; branch: BusinessEntity; department: BusinessEntity | null; designation: BusinessEntity | null; user: BusinessEntity | null; employmentStatus: string; baseSalary: string; joinDate: string; expenseAccount: BusinessEntity | null; payableAccount: BusinessEntity | null };

export default function HRPage() {
  const session = useDashboardSession();
  const can = (permission: string) => !!(session?.is_global || session?.permissions.includes(permission));
  const [items, setItems] = useState<Employee[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState(''); const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false); const [opening, setOpening] = useState<string | null>(null); const [error, setError] = useState(''); const [featureOff, setFeatureOff] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null); const [editor, setEditor] = useState<Detail | 'new' | null>(null);
  const load = useCallback(async (after?: string) => {
    setLoading(true); setError('');
    try { const params = new URLSearchParams({ limit: '50', search: query }); if (after) params.set('cursor', after);
      const response = await apiFetch(`/api/v1/employees?${params}`); const data = await response.json(); if (!response.ok) { throwIfFeatureOff(data); throw new Error(data.error?.message ?? 'Unable to load employees'); }
      setItems(current => after ? [...current, ...data.items] : data.items); setCursor(data.has_more ? data.next_cursor : null);
    } catch (cause) { if (cause instanceof FeatureOffError) { setFeatureOff(true); return; } setError(cause instanceof Error ? cause.message : 'Unable to load employees'); } finally { setLoading(false); }
  }, [query]);
  useEffect(() => { void load(); }, [load]);
  async function view(id: string) {
    setOpening(id); setError('');
    try { const response = await apiFetch(`/api/v1/employees/${id}`); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message ?? 'Unable to open employee'); setDetail(data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to open employee'); } finally { setOpening(null); }
  }
  return <div className="min-w-0 space-y-6 pb-6 [&_input]:min-h-11 [&_button]:min-h-11">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Employees</h1><p className="text-muted-foreground">Employee records, branch assignments and payroll setup.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={loading} onClick={() => void load()}>Refresh</Button>{can('employee.manage.branch') ? <Button disabled={!!editor} onClick={() => setEditor('new')}>New employee</Button> : null}</div></div>
    <form className="flex flex-col gap-3 rounded-xl border bg-card p-5 sm:flex-row sm:items-end" onSubmit={event => { event.preventDefault(); setQuery(search); }}><div className="grid w-full min-w-0 flex-1 gap-2"><Label htmlFor="employee-search">Search employees</Label><Input id="employee-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or employee number" /></div><Button type="submit" variant="outline">Search</Button></form>
    {featureOff ? <FeatureOffNotice module="HR & Payroll" /> : null}
    {!featureOff && can('payroll.read') ? <PayrollPanel can={can} /> : null}
    {error ? <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><p>{error}</p><Button variant="outline" onClick={() => void load()}>Retry employees</Button></div> : null}
    {editor ? <EmployeeEditor key={editor === 'new' ? 'new' : editor.id} initial={editor === 'new' ? null : editor} canReadAccounts={can('journal.read')} onCancel={() => setEditor(null)} onSaved={async id => { setEditor(null); await load(); await view(id); }} /> : null}
    {detail && !editor ? <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3"><CardTitle><h2>{detail.name}</h2></CardTitle><Button variant="outline" onClick={() => setDetail(null)}>Close employee</Button></CardHeader><CardContent className="space-y-5"><Badge>{detail.employmentStatus.replaceAll('_', ' ')}</Badge><dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 [&>div]:space-y-2">{[['Employee number', detail.employeeNo], ['Branch', detail.branch.name], ['Department', detail.department?.name], ['Designation', detail.designation?.name], ['Linked user', detail.user?.name], ['Phone', detail.phone], ['Email', detail.email], ['Joined', formatDate(detail.joinDate)], ['Base salary', detail.baseSalary], ['Payroll expense account', detail.expenseAccount?.name], ['Payroll payable account', detail.payableAccount?.name]].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="break-words">{value || 'Not set'}</dd></div>)}</dl>{detail.address ? <p className="whitespace-pre-wrap break-words">{detail.address}</p> : null}{can('employee.manage.branch') ? <Button variant="outline" onClick={() => setEditor(detail)}>Edit employee</Button> : null}</CardContent></Card> : null}
    {loading ? <LoadingState label="Loading employees..." /> : null}
    <Card><CardHeader><CardTitle>Employees ({items.length})</CardTitle></CardHeader><CardContent className="space-y-3">{!loading && !items.length ? <EmptyState message="No matching employees. Try another search or add an employee if you have access." /> : items.map(employee => <article key={employee.id} className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="min-w-0 space-y-2"><h2 className="break-words font-medium">{employee.name}</h2><p className="break-words text-sm text-muted-foreground">{employee.employee_no} / {employee.branch.name} / {employee.department?.name ?? 'No department'}</p><Badge variant="secondary">{employee.employment_status.replaceAll('_', ' ')}</Badge></div><Button variant="outline" disabled={!!editor || !!opening} onClick={() => void view(employee.id)}>{opening === employee.id ? 'Opening...' : 'View employee'}</Button></article>)}{cursor ? <Button variant="outline" disabled={loading} onClick={() => void load(cursor)}>Load more employees</Button> : null}</CardContent></Card>
  </div>;
}

function EmployeeEditor({ initial, canReadAccounts, onCancel, onSaved }: { initial: Detail | null; canReadAccounts: boolean; onCancel: () => void; onSaved: (id: string) => Promise<void> }) {
  const { confirm, confirmation } = useConfirmation();
  const mutation = useWorkflowMutation();
  const defaults = { employee_no: initial?.employeeNo ?? '', name: initial?.name ?? '', phone: initial?.phone ?? '', email: initial?.email ?? '', address: initial?.address ?? '', join_date: initial?.joinDate.slice(0, 10) ?? '', base_salary: initial?.baseSalary ?? '0' };
  const [form, setForm] = useState(defaults); const [branch, setBranch] = useState(initial?.branch ?? null); const [department, setDepartment] = useState(initial?.department ?? null); const [designation, setDesignation] = useState(initial?.designation ?? null); const [user, setUser] = useState(initial?.user ?? null); const [expense, setExpense] = useState(initial?.expenseAccount ?? null); const [payable, setPayable] = useState(initial?.payableAccount ?? null);
  const dirty = JSON.stringify(form) !== JSON.stringify(defaults) || branch?.id !== initial?.branch.id || department?.id !== initial?.department?.id || designation?.id !== initial?.designation?.id || user?.id !== initial?.user?.id || expense?.id !== initial?.expenseAccount?.id || payable?.id !== initial?.payableAccount?.id;
  useDraftProtection(dirty);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!branch || !expense || !payable) { mutation.setError('Select a branch and both payroll accounts.'); return; }
    if (initial && (Number(form.base_salary) !== Number(initial.baseSalary) || branch.id !== initial.branch.id || expense.id !== initial.expenseAccount?.id || payable.id !== initial.payableAccount?.id) && !await confirm({ title: 'Save payroll changes?', description: 'Changes to branch, salary, or payroll accounts apply to future payroll. Existing posted payroll remains unchanged.', action: 'Save changes' })) return;
    const body = { ...form, join_date: new Date(form.join_date + 'T00:00:00.000Z').toISOString(), base_salary: Number(form.base_salary), branch_id: branch.id, department_id: department?.id ?? null, designation_id: designation?.id ?? null, user_id: user?.id ?? null, payroll_expense_account_id: expense.id, payroll_payable_account_id: payable.id };
    const result = await mutation.mutate<{ id: string }>(initial ? `/api/v1/employees/${initial.id}` : '/api/v1/employees', body);
    if (result) { toast.success(initial ? 'Employee updated.' : 'Employee created.'); await onSaved(result.id); }
  }
  return <Card>{confirmation}<CardHeader className="border-b bg-muted/20"><CardTitle>{initial ? 'Edit employee' : 'New employee'}</CardTitle><p className="text-sm text-muted-foreground">Manage personal details, branch assignments, and payroll accounts.</p></CardHeader><CardContent><form onSubmit={save}><fieldset disabled={mutation.pending} className="space-y-5">
    {mutation.error ? <p role="alert" className="text-destructive">{mutation.error}</p> : null}
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 [&>div]:space-y-2">
      {(['employee_no', 'name', 'phone', 'email', 'join_date', 'base_salary'] as const).map(key => <div key={key}><Label htmlFor={`employee-${key}`}>{({ employee_no: 'Employee number', name: 'Employee name', phone: 'Phone', email: 'Email', join_date: 'Join date', base_salary: 'Base salary' })[key]}</Label><Input id={`employee-${key}`} required={['employee_no', 'name', 'join_date', 'base_salary'].includes(key)} type={key === 'email' ? 'email' : key === 'join_date' ? 'date' : key === 'base_salary' ? 'number' : 'text'} min={key === 'base_salary' ? '0' : undefined} step={key === 'base_salary' ? '0.01' : undefined} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} /></div>)}
      <EntityPicker label="Employee branch" endpoint="/api/v1/branches" serverSearch={false} value={branch} onChange={setBranch} />
      {[{ label: 'Employee department', kind: 'department', value: department, change: setDepartment }, { label: 'Employee designation', kind: 'designation', value: designation, change: setDesignation }, { label: 'Linked employee user', kind: 'user', value: user, change: setUser }].map(option => <div key={option.kind}><EntityPicker label={option.label} endpoint={`/api/v1/employees/options?kind=${option.kind}`} value={option.value} onChange={option.change} />{option.value ? <Button type="button" variant="ghost" onClick={() => option.change(null)}>Clear {option.kind}</Button> : null}</div>)}
      <EntityPicker label="Payroll expense account" endpoint="/api/v1/chart-of-accounts?account_class=expense&is_active=true" value={expense} onChange={setExpense} disabled={!canReadAccounts} />
      <EntityPicker label="Payroll payable account" endpoint="/api/v1/chart-of-accounts?account_class=liability&is_active=true" value={payable} onChange={setPayable} disabled={!canReadAccounts} />
    </div>
    {!canReadAccounts ? <p className="text-sm text-muted-foreground">Selecting payroll accounts requires journal read permission. Existing account assignments can be retained when editing.</p> : null}
    <div><Label htmlFor="employee-address">Address</Label><Textarea id="employee-address" value={form.address} onChange={event => setForm(current => ({ ...current, address: event.target.value }))} /></div>
    <div className="flex flex-wrap gap-3 border-t pt-5"><Button type="submit" disabled={!initial && !canReadAccounts}>{mutation.pending ? 'Saving...' : initial ? 'Save employee' : 'Create employee'}</Button><Button type="button" variant="outline" onClick={async () => { if (!dirty || await confirm({ title: 'Discard employee changes?', description: 'Your unsaved changes to this employee will be lost.', action: 'Discard changes', destructive: true })) onCancel(); }}>Cancel employee</Button></div>
  </fieldset></form></CardContent></Card>;
}
