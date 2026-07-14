// src/app/(erp)/dashboard/integrations/page.tsx
// Integrations hub: webhook endpoints, offline sync, import jobs.

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Webhook, Upload, RefreshCw, Plus, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface WebhookEndpoint {
  id: string; url: string; status: string;
  subscribed_events: string[]; delivery_count: number;
}

interface OfflineSyncBatch {
  id: string; batchNumber: number; commandCount: number;
  syncedCount: number; conflictCount: number; status: string;
  startedAt: string; completedAt: string | null;
}

export default function IntegrationsPage() {
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [batches, setBatches] = useState<OfflineSyncBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [webhookForm, setWebhookForm] = useState({ url: '', events: 'sale.posted,payment.posted' });
  const [posting, setPosting] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [wh, sync] = await Promise.all([
        fetch('/api/v1/webhook-endpoints').then(r => r.json()),
        fetch('/api/v1/offline/sync', { method: 'GET' }).then(r => r.json()).catch(() => ({ items: [] })),
      ]);
      setWebhooks(wh.items ?? []);
      // Offline sync batches aren't exposed via GET — show placeholder
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }

  async function handleCreateWebhook(e: React.FormEvent) {
    e.preventDefault();
    setPosting(true);
    try {
      const idempotencyKey = `wh-${Date.now()}`;
      const res = await fetch('/api/v1/webhook-endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          url: webhookForm.url,
          subscribed_events: webhookForm.events.split(',').map(s => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      toast.success(`Webhook created — secret shown once: ${data.secret_shown_once?.slice(0, 16)}...`);
      setShowWebhookForm(false);
      await load();
    } finally { setPosting(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Webhook className="h-6 w-6" /> Integrations</h1>
        <p className="text-muted-foreground">Webhook endpoints, offline sync, import jobs (M7).</p>
      </div>

      {/* Webhook Endpoints */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Webhook Endpoints ({webhooks.length})</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowWebhookForm(!showWebhookForm)}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </CardHeader>
        <CardContent>
          {showWebhookForm && (
            <form onSubmit={handleCreateWebhook} className="border rounded p-3 mb-3 space-y-2">
              <div>
                <Label>HTTPS URL *</Label>
                <Input type="url" placeholder="https://example.com/webhook" value={webhookForm.url}
                  onChange={e => setWebhookForm({ ...webhookForm, url: e.target.value })} required />
              </div>
              <div>
                <Label>Subscribed Events (comma-separated)</Label>
                <Input value={webhookForm.events} onChange={e => setWebhookForm({ ...webhookForm, events: e.target.value })} />
              </div>
              <Button type="submit" size="sm" disabled={posting}>{posting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}Create</Button>
            </form>
          )}

          {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : webhooks.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground text-sm">No webhook endpoints yet.</div>
          ) : (
            <div className="space-y-2">
              {webhooks.map(w => (
                <div key={w.id} className="flex items-center justify-between border rounded p-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs truncate">{w.url}</div>
                    <div className="flex gap-1 mt-1">
                      {w.subscribed_events.map(e => <Badge key={e} variant="outline" className="text-xs">{e}</Badge>)}
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant={w.status === 'active' ? 'default' : 'secondary'}>{w.status}</Badge>
                    <div className="text-xs text-muted-foreground mt-1">{w.delivery_count} deliveries</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Offline Sync */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><RefreshCw className="h-4 w-4" /> Offline Sync</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Offline sync batches are managed via the <code className="font-mono text-xs">POST /api/v1/offline/sync</code> API.
            Conflict resolution is handled through the admin dashboard.
          </div>
          <div className="mt-3 p-3 border rounded bg-amber-50 text-sm">
            <AlertTriangle className="h-4 w-4 inline mr-1 text-amber-600" />
            Offline POS is pilot-only per §20.D07. Feature flag <code className="font-mono text-xs">offline_pos_enabled</code> must be enabled by platform operations.
          </div>
        </CardContent>
      </Card>

      {/* Import Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4" /> Import Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            CSV imports for products, customers, sales (drafts only). Use the <code className="font-mono text-xs">POST /api/v1/import-jobs</code> API to upload.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
