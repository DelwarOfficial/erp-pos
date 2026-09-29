'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Document {
  reference_no: string; status?: string; payment_status?: string; currency_code: string;
  amount?: string; grand_total?: string; tax_total?: string; subtotal?: string;
  business_date?: string; expense_date?: string; payment_method?: string; payment_type?: string;
  direction?: string; description?: string; notes?: string; payee_name?: string;
  customer?: { name: string }; supplier?: { name: string }; branch?: { name: string };
  financial_account?: { name: string }; requester?: { name: string }; approver?: { name: string };
  journal_entry?: { entryNo: string };
  items?: { id: string; expense_category: { name: string }; description?: string; amount: string; tax_amount: string }[];
  allocations?: { id: string; sale: { id: string; referenceNo: string } | null; allocation_source: string; allocated_amount: string; allocated_at: string }[];
}
export function FinancialDocument({ id, kind }: { id: string; kind: 'payments' | 'expenses' }) {
  const [document, setDocument] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await apiFetch(`/api/v1/${kind}/${id}`); const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? 'Document unavailable');
      setDocument(data.item ?? data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Document unavailable'); }
    finally { setLoading(false); }
  }, [id, kind]);
  useEffect(() => { void load(); }, [load]);
  const money = (value?: string) => `${document?.currency_code ?? ''} ${Number(value ?? 0).toFixed(2)}`;
  return <div className="space-y-5"><Button asChild variant="outline"><Link href={`/dashboard/${kind}`}>Back to {kind}</Link></Button>
    <h1 className="text-2xl font-bold">{kind === 'payments' ? 'Payment' : 'Expense'} details</h1>
    {loading ? <p role="status">Loading document…</p> : error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={() => void load()}>Retry</Button></div> : document ? <Card>
      <CardHeader><CardTitle>{document.reference_no}</CardTitle><div><Badge>{(document.status ?? document.payment_status ?? '').replaceAll('_', ' ')}</Badge></div></CardHeader>
      <CardContent className="space-y-5"><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          ['Date', new Date(document.business_date ?? document.expense_date ?? '').toLocaleDateString()],
          ['Total', money(document.amount ?? document.grand_total)], ['Party', document.customer?.name ?? document.supplier?.name ?? document.payee_name ?? 'Not specified'],
          ['Branch', document.branch?.name], ['Financial account', document.financial_account?.name],
          ['Method', document.payment_method?.replaceAll('_', ' ')], ['Direction', document.direction],
          ['Requested by', document.requester?.name], ['Approved by', document.approver?.name], ['Journal', document.journal_entry?.entryNo],
        ].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}
      </dl>{document.description ? <p className="whitespace-pre-wrap">{document.description}</p> : null}{document.notes ? <p className="whitespace-pre-wrap text-sm">{document.notes}</p> : null}
      {document.items ? <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="text-left font-semibold">Expense lines</caption><thead><tr className="border-b text-left"><th>Category</th><th>Description</th><th>Amount</th><th>Tax</th></tr></thead><tbody>{document.items.map(item => <tr key={item.id} className="border-b"><td className="py-3 pr-3">{item.expense_category.name}</td><td>{item.description || '—'}</td><td>{money(item.amount)}</td><td>{money(item.tax_amount)}</td></tr>)}</tbody></table></div> : null}
      {document.allocations ? <section className="space-y-2"><h2 className="font-semibold">Allocations</h2>{document.allocations.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th>Document</th><th>Source</th><th>Amount</th><th>Date</th></tr></thead><tbody>{document.allocations.map(item => <tr key={item.id} className="border-b"><td className="py-3 pr-3">{item.sale?.referenceNo ?? 'Unlinked allocation'}</td><td>{item.allocation_source.replaceAll('_', ' ')}</td><td>{money(item.allocated_amount)}</td><td>{new Date(item.allocated_at).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No allocations recorded.</p>}</section> : null}
      </CardContent></Card> : null}
  </div>;
}
