// src/app/(erp)/dashboard/hr/page.tsx
// HR employee management.

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, UserCog } from 'lucide-react';
import { toast } from 'sonner';

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

  useEffect(() => {
    fetch('/api/v1/employees').then(r => r.json()).then(d => setItems(d.items ?? []))
      .catch(e => toast.error(e.message)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><UserCog className="h-6 w-6" /> HR — Employees</h1>
        <p className="text-muted-foreground">Employee master with departments, designations, payroll accounts.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Employees ({items.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No employees yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2">Emp No</th><th>Name</th><th>Branch</th>
                    <th>Department</th><th>Designation</th><th>Status</th>
                    <th className="text-right">Salary</th><th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(e => (
                    <tr key={e.id} className="border-b hover:bg-slate-50">
                      <td className="py-2 font-mono">{e.employee_no}</td>
                      <td>{e.name}</td>
                      <td>{e.branch.name}</td>
                      <td>{e.department?.name ?? '—'}</td>
                      <td>{e.designation?.name ?? '—'}</td>
                      <td><Badge variant={e.employment_status === 'active' ? 'default' : 'secondary'}>{e.employment_status}</Badge></td>
                      <td className="text-right font-mono">৳ {parseFloat(e.base_salary).toFixed(0)}</td>
                      <td className="text-xs">{new Date(e.join_date).toLocaleDateString()}</td>
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
