// src/app/(erp)/dashboard/hr/page.tsx
// HR employee management.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';

interface Employee {
  id: string;
  employee_no: string;
  name: string;
  phone: string | null;
  email: string | null;
  branch: { name: string; code: string };
  department: { name: string } | null;
  designation: { name: string } | null;
  employment_status: string;
  base_salary: string;
  join_date: string;
}

export default function HRPage() {
  const [items, setItems] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/employees');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load employees');
      setItems(data.items ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><UserCog className="h-6 w-6" /> HR — Employees</h1>
        <p className="text-muted-foreground">Employee master with departments, designations, payroll accounts.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Employees ({items.length})</CardTitle>
          {!loading && !error && <Button size="sm" variant="ghost" onClick={load}>Refresh</Button>}
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingState label="Loading employees…" />
          ) : error ? (
            <ErrorState message={error} onRetry={load} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<UserCog className="h-8 w-8 text-muted-foreground/50" />}
              message="No employees yet."
            />
          ) : (
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3">Emp No</th>
                    <th className="pr-3">Name</th>
                    <th className="pr-3">Branch</th>
                    <th className="pr-3">Department</th>
                    <th className="pr-3">Designation</th>
                    <th className="pr-3">Status</th>
                    <th className="pr-3 text-right">Salary</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(e => (
                    <tr key={e.id} className="border-b hover:bg-slate-50">
                      <td className="py-2 pr-3 font-mono whitespace-nowrap">{e.employee_no}</td>
                      <td className="pr-3 font-medium">{e.name}</td>
                      <td className="pr-3 whitespace-nowrap">{e.branch.name}</td>
                      <td className="pr-3">{e.department?.name ?? '—'}</td>
                      <td className="pr-3">{e.designation?.name ?? '—'}</td>
                      <td className="pr-3"><Badge variant={e.employment_status === 'active' ? 'default' : 'secondary'}>{e.employment_status}</Badge></td>
                      <td className="pr-3 text-right font-mono whitespace-nowrap">৳ {parseFloat(e.base_salary).toFixed(0)}</td>
                      <td className="text-xs whitespace-nowrap">{new Date(e.join_date).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
