// src/app/(erp)/dashboard/cashier/page.tsx
// Cashier shift management — open/close.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Clock, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/StateList';

interface Shift {
  id: string;
  status: string;
  cashier: { id: string; name: string; email: string };
  branch: { id: string; name: string; code: string };
  opened_at: string;
  closed_at: string | null;
  opening_float: string;
  expected_closing_cash: string | null;
  counted_closing_cash: string | null;
  variance: string | null;
  variance_reason: string | null;
  sale_count: number;
  payment_count: number;
}

export default function CashierPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState({ branchId: '', warehouseId: '', cashAccountId: '', openingFloat: '0' });
  const [closeForm, setCloseForm] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState(false);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/cashier-shifts?limit=20');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load shifts');
      setShifts(data.items ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadShifts(); }, [loadShifts]);

  async function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    setOpening(true);
    try {
      const idempotencyKey = `shift-open-${Date.now()}`;
      const res = await fetch('/api/v1/cashier-shifts/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          branch_id: openForm.branchId,
          warehouse_id: openForm.warehouseId,
          cash_account_id: openForm.cashAccountId,
          opening_float: Number(openForm.openingFloat),
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      toast.success('Shift opened');
      setOpenForm({ branchId: '', warehouseId: '', cashAccountId: '', openingFloat: '0' });
      await loadShifts();
    } finally { setOpening(false); }
  }

  async function handleClose(shiftId: string) {
    const counted = closeForm[shiftId];
    if (!counted) { toast.error('Enter counted cash'); return; }
    try {
      const idempotencyKey = `shift-close-${shiftId}-${Date.now()}`;
      const res = await fetch(`/api/v1/cashier-shifts/${shiftId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ counted_closing_cash: Number(counted) }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      toast.success(`Shift closed — variance: ৳ ${data.variance.toFixed(2)}`);
      await loadShifts();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Network error'); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Clock className="h-6 w-6" /> Cashier Shifts</h1>
        <p className="text-muted-foreground">Open/close cashier shifts with cash reconciliation.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open New Shift</CardTitle>
          <CardDescription>A cashier can have one open shift per cash account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleOpen} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Branch ID</Label>
              <Input placeholder="UUID" value={openForm.branchId} onChange={e => setOpenForm({ ...openForm, branchId: e.target.value })} required className="min-h-[40px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Warehouse ID</Label>
              <Input placeholder="UUID" value={openForm.warehouseId} onChange={e => setOpenForm({ ...openForm, warehouseId: e.target.value })} required className="min-h-[40px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Cash Account ID</Label>
              <Input placeholder="UUID" value={openForm.cashAccountId} onChange={e => setOpenForm({ ...openForm, cashAccountId: e.target.value })} required className="min-h-[40px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Opening Float (BDT)</Label>
              <Input type="number" step="0.01" value={openForm.openingFloat} onChange={e => setOpenForm({ ...openForm, openingFloat: e.target.value })} required className="min-h-[40px]" />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit" disabled={opening} className="min-h-[44px]">
                {opening ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Open Shift
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Shifts ({shifts.length})</CardTitle>
          {!loading && !error && <Button size="sm" variant="ghost" onClick={loadShifts}>Refresh</Button>}
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingState label="Loading shifts…" />
          ) : error ? (
            <ErrorState message={error} onRetry={loadShifts} />
          ) : shifts.length === 0 ? (
            <EmptyState
              icon={<Clock className="h-8 w-8 text-muted-foreground/50" />}
              message="No shifts yet."
            />
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {shifts.map(s => (
                <div key={s.id} className="border rounded p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={s.status === 'open' ? 'default' : 'secondary'}>{s.status}</Badge>
                      <span className="font-medium text-sm">{s.cashier.name}</span>
                      <span className="text-xs text-muted-foreground">{s.branch.name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Opened: {new Date(s.opened_at).toLocaleString()}
                      {s.closed_at && ` • Closed: ${new Date(s.closed_at).toLocaleString()}`}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-1">
                      <span>Float: ৳ {parseFloat(s.opening_float).toFixed(2)}</span>
                      {s.expected_closing_cash && <span>Expected: ৳ {parseFloat(s.expected_closing_cash).toFixed(2)}</span>}
                      {s.variance && (
                        <span className={parseFloat(s.variance) < 0 ? 'text-red-600' : 'text-green-600'}>
                          Variance: ৳ {parseFloat(s.variance).toFixed(2)}
                        </span>
                      )}
                      <span>Sales: {s.sale_count}</span>
                      <span>Payments: {s.payment_count}</span>
                    </div>
                  </div>
                  {s.status === 'open' && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Counted cash"
                        value={closeForm[s.id] ?? ''}
                        onChange={e => setCloseForm({ ...closeForm, [s.id]: e.target.value })}
                        className="w-32 min-h-[40px]"
                        aria-label={`Counted cash for shift ${s.id}`}
                      />
                      <Button size="sm" onClick={() => handleClose(s.id)} className="min-h-[40px]">
                        <DollarSign className="h-3 w-3 mr-1" /> Close
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
