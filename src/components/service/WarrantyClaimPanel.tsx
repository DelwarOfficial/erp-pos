'use client';

// Warranty claim on a service request: raise it, decide it, fulfil it.
// Raise: POST /api/v1/warranty-claims (warranty.fulfill). Decide: someone
// else with approval.resolve. Fulfil: POST /api/v1/warranty-claims/{id}
// with action 'fulfill' -- a replacement leaves stock and is expensed; a
// refund or supplier claim names its posted return.

import { useState } from 'react';
import { toast } from 'sonner';
import { useWorkflowMutation } from '@/hooks/useWorkflowMutation';
import { useConfirmation } from '@/hooks/useConfirmation';
import { EntityPicker, type BusinessEntity } from '@/components/shared/EntityPicker';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

export interface WarrantyClaimView {
  id: string; claim_type: string; status: string; eligibility_reason: string;
  replacement_serial: { id: string; serialNumber: string } | null; reference: string | null;
  approved_at: string | null; fulfilled_at: string | null;
}

const TYPES: Record<string, string> = {
  repair: 'Repair under warranty', replace: 'Replace with another unit',
  refund: 'Refund the customer', supplier_claim: 'Claim from the supplier',
};

export function WarrantyClaimPanel({ serviceRequestId, claim, can, onChanged }: {
  serviceRequestId: string; claim: WarrantyClaimView | null; can: (permission: string) => boolean; onChanged: () => Promise<void> | void;
}) {
  const mutation = useWorkflowMutation();
  const { confirm, confirmation } = useConfirmation();
  const [type, setType] = useState('repair');
  const [reason, setReason] = useState('');
  const [serial, setSerial] = useState<BusinessEntity | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [reference, setReference] = useState<BusinessEntity | null>(null);

  async function raise(event: React.FormEvent) {
    event.preventDefault();
    if (!reason.trim()) { mutation.setError('Say why this device is covered by warranty.'); return; }
    if (type === 'replace' && !serial) { mutation.setError('Choose the replacement unit from stock.'); return; }
    const result = await mutation.mutate('/api/v1/warranty-claims', { service_request_id: serviceRequestId, claim_type: type,
      eligibility_reason: reason.trim(), ...(type === 'replace' ? { replacement_serial_id: serial!.id } : {}) });
    if (result) { toast.success('Warranty claim raised. A manager decides it next.'); setReason(''); setSerial(null); await onChanged(); }
  }

  async function decide(action: 'approve' | 'reject') {
    if (!claim) return;
    if (!decisionNote.trim()) { mutation.setError('Write a short reason for the decision.'); return; }
    if (!await confirm({ title: action === 'approve' ? 'Approve this warranty claim?' : 'Reject this warranty claim?',
      description: 'Your decision and reason are recorded against the claim.', action: action === 'approve' ? 'Approve claim' : 'Reject claim', destructive: action === 'reject' })) return;
    const result = await mutation.mutate(`/api/v1/warranty-claims/${claim.id}`, { action, reason: decisionNote.trim() });
    if (result) { toast.success(action === 'approve' ? 'Claim approved.' : 'Claim rejected.'); setDecisionNote(''); await onChanged(); }
  }

  async function fulfil() {
    if (!claim) return;
    const needsReference = claim.claim_type === 'refund' || claim.claim_type === 'supplier_claim';
    if (needsReference && !reference) { mutation.setError(claim.claim_type === 'refund' ? 'Choose the posted sale return for this refund.' : 'Choose the posted purchase return to the supplier.'); return; }
    if (!await confirm({ title: 'Fulfil this warranty claim?',
      description: claim.claim_type === 'replace' ? `Replacement unit ${claim.replacement_serial?.serialNumber ?? ''} leaves stock and its cost is recorded as a warranty expense. The faulty unit is written off.` : 'The claim is closed against the document you chose.',
      action: 'Fulfil claim' })) return;
    const result = await mutation.mutate<{ replacement_cost: string | null }>(`/api/v1/warranty-claims/${claim.id}`, { action: 'fulfill', ...(needsReference ? { reference_document_id: reference!.id } : {}) });
    if (result) { toast.success(result.replacement_cost ? `Claim fulfilled. Replacement cost ৳${result.replacement_cost} recorded.` : 'Claim fulfilled.'); await onChanged(); }
  }

  return (
    <section aria-labelledby="warranty-claim-title" className="space-y-3 rounded-lg border p-4">
      {confirmation}
      <h3 id="warranty-claim-title" className="font-semibold">Warranty claim</h3>
      {mutation.error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive">{mutation.error}</p> : null}
      {claim ? (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><Badge>{claim.status}</Badge><span>{TYPES[claim.claim_type] ?? claim.claim_type}</span>
            {claim.replacement_serial ? <span className="text-muted-foreground">· replacement {claim.replacement_serial.serialNumber}</span> : null}
            {claim.reference ? <span className="text-muted-foreground">· {claim.reference}</span> : null}</div>
          <p className="whitespace-pre-wrap break-words">{claim.eligibility_reason}</p>
          {claim.status === 'submitted' && can('approval.resolve') ? (
            <div className="space-y-2">
              <Label htmlFor="claim-decision">Reason for your decision</Label>
              <Textarea id="claim-decision" value={decisionNote} onChange={e => setDecisionNote(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button disabled={mutation.pending} onClick={() => void decide('approve')}>Approve claim</Button>
                <Button variant="outline" disabled={mutation.pending} onClick={() => void decide('reject')}>Reject claim</Button>
              </div>
              <p className="text-xs text-muted-foreground">Someone other than the person who raised the claim must decide it.</p>
            </div>
          ) : null}
          {claim.status === 'approved' && can('warranty.fulfill') ? (
            <div className="space-y-2">
              {claim.claim_type === 'refund' ? <EntityPicker label="Posted sale return" endpoint="/api/v1/sale-returns" value={reference} onChange={setReference} /> : null}
              {claim.claim_type === 'supplier_claim' ? <EntityPicker label="Posted purchase return" endpoint="/api/v1/purchase-returns" value={reference} onChange={setReference} /> : null}
              <Button disabled={mutation.pending} onClick={() => void fulfil()}>Fulfil claim</Button>
            </div>
          ) : null}
        </div>
      ) : can('warranty.fulfill') ? (
        <form onSubmit={raise} className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="claim-type">What the warranty covers</Label>
            <select id="claim-type" className="h-11 w-full rounded-md border bg-background px-2" value={type} onChange={e => setType(e.target.value)}>
              {Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></div>
          {type === 'replace' ? <EntityPicker label="Replacement unit (in stock)" endpoint="/api/v1/serials/search?status=in_stock" searchParam="q" value={serial} onChange={setSerial} /> : null}
          <div className="space-y-1.5"><Label htmlFor="claim-reason">Why it is covered</Label>
            <Textarea id="claim-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Within 24-month warranty; panel fault, no physical damage" /></div>
          <Button type="submit" disabled={mutation.pending}>Raise warranty claim</Button>
        </form>
      ) : <p className="text-sm text-muted-foreground">No warranty claim on this request.</p>}
    </section>
  );
}
