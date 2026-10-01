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
import { apiFetch } from '@/lib/api/client';
import { EntityPicker, type BusinessEntity } from '@/components/shared/EntityPicker';
import { ServiceDetail } from '@/components/service/ServiceDetail';
import { useDashboardSession } from '@/components/dashboard/session';
import { useWorkflowMutation } from '@/hooks/useWorkflowMutation';
import { useDraftProtection } from '@/hooks/useDraftProtection';

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

const STATUS_COLORS: Record<string, 'outline' | 'secondary' | 'default' | 'destructive'> = {
  received: 'outline', diagnosing: 'secondary', awaiting_customer_approval: 'secondary',
  approved: 'secondary', in_repair: 'default', awaiting_parts: 'secondary',
  ready: 'default', delivered: 'default', unrepairable: 'destructive', cancelled: 'destructive',
};

export default function ServicePage() {
  const [items, setItems] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const command = useWorkflowMutation(); const posting = command.pending;
  const session = useDashboardSession(); const can = (permission: string) => !!(session?.is_global || session?.permissions.includes(permission));
  const [warehouse, setWarehouse] = useState<BusinessEntity | null>(null);
  const [customer, setCustomer] = useState<BusinessEntity | null>(null);
  const [serial, setSerial] = useState<BusinessEntity | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState(''); const [cursor, setCursor] = useState<string | null>(null);
  const [form, setForm] = useState({
    service_type: 'paid_repair', issue_description: '',
    intake_condition: '', accessories_received: '',
    estimated_amount: '0',
  });
  useDraftProtection(showForm && !!(warehouse || customer || serial || form.issue_description));

  useEffect(() => { load(); }, []);

  async function load(next?: string) {
    setLoading(true); setError('');
    try {
      const res = await apiFetch(`/api/v1/service-requests?limit=50${next ? `&cursor=${encodeURIComponent(next)}` : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? 'Unable to load service requests');
      setItems(current => next ? [...current, ...(data.items ?? [])] : data.items ?? []); setCursor(data.has_more ? data.next_cursor : null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load service requests'); }
    finally { setLoading(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!warehouse?.branch) { command.setError('Select the repair warehouse. Its branch will be used for intake.'); return; }
    const data = await command.mutate<{ serviceRequestId: string; referenceNo: string }>('/api/v1/service-requests', {
          branch_id: warehouse.branch.id, repair_warehouse_id: warehouse.id,
          customer_id: customer?.id,
          serial_id: serial?.id,
          service_type: form.service_type,
          issue_description: form.issue_description,
          intake_condition: form.intake_condition || undefined,
          accessories_received: form.accessories_received || undefined,
          estimated_amount: Number(form.estimated_amount),
    });
    if (data) { toast.success(`Service request ${data.referenceNo} created`); setShowForm(false); setSelected(data.serviceRequestId); setForm({ service_type: 'paid_repair', issue_description: '', intake_condition: '', accessories_received: '', estimated_amount: '0' }); setSerial(null); await load(); }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Wrench className="h-6 w-6" /> Service Requests</h1>
          <p className="text-muted-foreground">Manage device intake, repairs and warranty service.</p>
        </div>
        <div className="flex gap-2"><Button variant="outline" disabled={loading || posting} onClick={() => void load()}>Refresh</Button>{can('service.intake') ? <Button disabled={showForm || posting} onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-2" /> New Intake</Button> : null}</div>
      </div>

      {error || command.error ? <div role="alert" className="rounded-md border p-3">{error || command.error}{error ? <Button variant="outline" onClick={() => void load()}>Retry</Button> : null}</div> : null}
      {selected ? <ServiceDetail key={selected} id={selected} onClose={() => setSelected(null)} onChanged={() => void load()} /> : null}
      {showForm && (
        <Card>
          <form onSubmit={handleSubmit}><fieldset disabled={posting}>
            <CardHeader><CardTitle className="text-base">New Service Request</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <EntityPicker label="Repair warehouse" endpoint="/api/v1/warehouses" serverSearch={false} value={warehouse} onChange={setWarehouse} />
                {can('customer.read') ? <div><EntityPicker label="Service customer" endpoint="/api/v1/customers" value={customer} onChange={setCustomer} />{customer ? <Button type="button" variant="ghost" onClick={() => setCustomer(null)}>Use walk-in customer</Button> : null}</div> : <p className="text-sm text-muted-foreground">Walk-in intake. Customer selection requires customer read permission.</p>}
                {can('inventory.read') ? <div><EntityPicker label="Device serial / IMEI" endpoint="/api/v1/serials/search" searchParam="q" minimumSearch={2} value={serial} onChange={setSerial} />{serial ? <Button type="button" variant="ghost" onClick={() => setSerial(null)}>Clear device</Button> : null}</div> : null}
              </div>
              <div>
                <Label htmlFor="field-app-erp-dashboard-service-page-4">Service Type *</Label>
                <Select value={form.service_type} onValueChange={v => setForm({ ...form, service_type: v })}>
                  <SelectTrigger id="field-app-erp-dashboard-service-page-4"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warranty">Warranty</SelectItem>
                    <SelectItem value="paid_repair">Paid Repair</SelectItem>
                    <SelectItem value="installation">Installation</SelectItem>
                    <SelectItem value="inspection">Inspection</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="field-app-erp-dashboard-service-page-5">Issue Description *</Label>
                <Textarea id="field-app-erp-dashboard-service-page-5" value={form.issue_description} onChange={e => setForm({ ...form, issue_description: e.target.value })} required />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="field-app-erp-dashboard-service-page-6">Intake Condition</Label>
                  <Input id="field-app-erp-dashboard-service-page-6" value={form.intake_condition} onChange={e => setForm({ ...form, intake_condition: e.target.value })} placeholder="e.g. Screen cracked" />
                </div>
                <div>
                  <Label htmlFor="field-app-erp-dashboard-service-page-7">Accessories</Label>
                  <Input id="field-app-erp-dashboard-service-page-7" value={form.accessories_received} onChange={e => setForm({ ...form, accessories_received: e.target.value })} placeholder="e.g. Charger, box" />
                </div>
                <div>
                  <Label htmlFor="field-app-erp-dashboard-service-page-8">Estimate (BDT)</Label>
                  <Input id="field-app-erp-dashboard-service-page-8" type="number" value={form.estimated_amount} onChange={e => setForm({ ...form, estimated_amount: e.target.value })} />
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button type="button" variant="ghost" onClick={() => { if (window.confirm('Discard this service intake draft?')) setShowForm(false); }}>Cancel</Button>
              <Button type="submit" disabled={posting}>{posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Create Intake</Button>
            </CardFooter>
          </fieldset></form>
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
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-sm font-medium">{r.reference_no}</code>
                      <Badge variant={STATUS_COLORS[r.status] ?? 'outline'}>{r.status.replaceAll('_', ' ')}</Badge>
                      <Badge variant="outline" className="text-xs">{r.service_type}</Badge>
                      {r.warranty_eligible && <Badge variant="secondary" className="text-xs">warranty</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(r.received_at).toLocaleString()}</span>
                  </div>
                  <div className="text-sm mt-1">
                    {r.customer ? `${r.customer.name}${r.customer.phone ? ` (${r.customer.phone})` : ''}` : 'Walk-in'}
                    {r.serial && ` • IMEI: ${r.serial.serialNumber}`}
                    {` • ${r.part_count} parts used`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{r.issue_description}</div>
                  <Button variant="outline" className="mt-3" disabled={posting} onClick={() => setSelected(r.id)}>View service request</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {cursor ? <Button variant="outline" disabled={loading} onClick={() => void load(cursor)}>Load older requests</Button> : null}
    </div>
  );
}
