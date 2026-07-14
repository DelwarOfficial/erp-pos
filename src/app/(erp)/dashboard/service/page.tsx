// src/app/(erp)/dashboard/service/page.tsx
// Service requests list + intake form.

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Wrench, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface ServiceRequest {
  id: string;
  reference_no: string;
  status: string;
  service_type: string;
  customer: { name: string; phone: string } | null;
  serial: { serialNumber: string } | null;
  issue_description: string;
  estimated_amount: string;
  warranty_eligible: boolean | null;
  received_at: string;
  part_count: number;
}

const STATUS_COLORS: Record<string, string> = {
  received: 'outline', diagnosing: 'secondary', awaiting_customer_approval: 'secondary',
  approved: 'secondary', in_repair: 'default', awaiting_parts: 'secondary',
  ready: 'default', delivered: 'default', unrepairable: 'destructive', cancelled: 'destructive',
};

export default function ServicePage() {
  const [items, setItems] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [posting, setPosting] = useState(false);
  const [form, setForm] = useState({
    branch_id: '', customer_id: '', serial_id: '',
    service_type: 'paid_repair', issue_description: '',
    intake_condition: '', accessories_received: '',
    estimated_amount: '0',
  });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/service-requests?limit=50');
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPosting(true);
    try {
      const idempotencyKey = `sr-${Date.now()}`;
      const res = await fetch('/api/v1/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          branch_id: form.branch_id,
          customer_id: form.customer_id || undefined,
          serial_id: form.serial_id || undefined,
          service_type: form.service_type,
          issue_description: form.issue_description,
          intake_condition: form.intake_condition || undefined,
          accessories_received: form.accessories_received || undefined,
          estimated_amount: Number(form.estimated_amount),
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      toast.success(`Service request ${data.reference_no} created`);
      setShowForm(false);
      await load();
    } finally { setPosting(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Wrench className="h-6 w-6" /> Service Requests</h1>
          <p className="text-muted-foreground">Device intake, repair, warranty. Feature-flagged per §20.D15.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4 mr-2" /> New Intake</Button>
      </div>

      {showForm && (
        <Card>
          <form onSubmit={handleSubmit}>
            <CardHeader><CardTitle className="text-base">New Service Request</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Branch ID *</Label>
                  <Input value={form.branch_id} onChange={e => setForm({ ...form, branch_id: e.target.value })} required />
                </div>
                <div>
                  <Label>Customer ID</Label>
                  <Input value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })} />
                </div>
                <div>
                  <Label>Serial ID (IMEI)</Label>
                  <Input value={form.serial_id} onChange={e => setForm({ ...form, serial_id: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Service Type *</Label>
                <Select value={form.service_type} onValueChange={v => setForm({ ...form, service_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warranty">Warranty</SelectItem>
                    <SelectItem value="paid_repair">Paid Repair</SelectItem>
                    <SelectItem value="installation">Installation</SelectItem>
                    <SelectItem value="inspection">Inspection</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Issue Description *</Label>
                <Textarea value={form.issue_description} onChange={e => setForm({ ...form, issue_description: e.target.value })} required />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Intake Condition</Label>
                  <Input value={form.intake_condition} onChange={e => setForm({ ...form, intake_condition: e.target.value })} placeholder="e.g. Screen cracked" />
                </div>
                <div>
                  <Label>Accessories</Label>
                  <Input value={form.accessories_received} onChange={e => setForm({ ...form, accessories_received: e.target.value })} placeholder="e.g. Charger, box" />
                </div>
                <div>
                  <Label>Estimate (BDT)</Label>
                  <Input type="number" value={form.estimated_amount} onChange={e => setForm({ ...form, estimated_amount: e.target.value })} />
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" disabled={posting}>{posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Create Intake</Button>
            </CardFooter>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Service Requests ({items.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No service requests yet.</div>
          ) : (
            <div className="space-y-2">
              {items.map(r => (
                <div key={r.id} className="border rounded p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-sm font-medium">{r.reference_no}</code>
                      <Badge variant={STATUS_COLORS[r.status] as any}>{r.status}</Badge>
                      <Badge variant="outline" className="text-xs">{r.service_type}</Badge>
                      {r.warranty_eligible && <Badge variant="secondary" className="text-xs">warranty</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(r.received_at).toLocaleString()}</span>
                  </div>
                  <div className="text-sm mt-1">
                    {r.customer ? `${r.customer.name} (${r.customer.phone})` : 'Walk-in'}
                    {r.serial && ` • IMEI: ${r.serial.serialNumber}`}
                    {` • ${r.part_count} parts used`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{r.issue_description}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
