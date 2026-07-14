// src/app/(erp)/dashboard/gift-cards/page.tsx
// Gift card management.

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Gift, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface GiftCard {
  id: string;
  code: string;
  status: string;
  face_value: string;
  issued_at: string;
  expires_at: string | null;
}

export default function GiftCardsPage() {
  const [items, setItems] = useState<GiftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [faceValue, setFaceValue] = useState('1000');
  const [posting, setPosting] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/gift-cards');
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }

  async function handleIssue(e: React.FormEvent) {
    e.preventDefault();
    setPosting(true);
    try {
      const idempotencyKey = `gc-${Date.now()}`;
      const res = await fetch('/api/v1/gift-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ face_value: Number(faceValue) }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      toast.success(`Gift card ${data.code} issued — ৳ ${data.face_value}`);
      setShowForm(false);
      await load();
    } finally { setPosting(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Gift className="h-6 w-6" /> Gift Cards</h1>
          <p className="text-muted-foreground">Issue and track gift card liability.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4 mr-2" /> Issue Card</Button>
      </div>

      {showForm && (
        <Card>
          <form onSubmit={handleIssue}>
            <CardHeader><CardTitle className="text-base">Issue New Gift Card</CardTitle></CardHeader>
            <CardContent>
              <Label>Face Value (BDT)</Label>
              <Input type="number" min="1" step="0.01" value={faceValue} onChange={e => setFaceValue(e.target.value)} required />
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={posting}>{posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Issue</Button>
            </CardFooter>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Cards ({items.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No gift cards yet.</div>
          ) : (
            <div className="space-y-2">
              {items.map(c => (
                <div key={c.id} className="flex items-center justify-between border rounded p-3">
                  <div className="flex items-center gap-3">
                    <code className="font-mono text-sm font-medium">{c.code}</code>
                    <Badge variant={c.status === 'active' ? 'default' : c.status === 'redeemed' ? 'secondary' : 'destructive'}>
                      {c.status}
                    </Badge>
                  </div>
                  <div className="text-right">
                    <div className="font-mono">৳ {parseFloat(c.face_value).toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">{new Date(c.issued_at).toLocaleDateString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
