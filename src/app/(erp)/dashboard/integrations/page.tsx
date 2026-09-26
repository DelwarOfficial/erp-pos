// src/app/(erp)/dashboard/integrations/page.tsx
// Integrations hub: webhook endpoints, offline sync, import jobs.

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Webhook, Upload, RefreshCw, Plus, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api/client';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/StateList';

interface WebhookEndpoint {
  id: string; url: string; status: string;
  subscribed_events: string[]; delivery_count: number;
}

export default function IntegrationsPage() {
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [webhookForm, setWebhookForm] = useState({ url: '', events: 'sale.posted,payment.posted' });
  const [posting, setPosting] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await apiFetch('/api/v1/webhook-endpoints');
      if (!response.ok) throw new Error('Webhook endpoints could not be loaded. Check your access and try again.');
      const data = await response.json();
      if (!Array.isArray(data.items)) throw new Error('The webhook list response could not be read. Try again.');
      setWebhooks(data.items);
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Webhook endpoints could not be loaded.'); }
    finally { setLoading(false); }
  }

  async function handleCreateWebhook(e: React.FormEvent) {
    e.preventDefault();
    setPosting(true);
    try {
      const idempotencyKey = `wh-${Date.now()}`;
      const res = await apiFetch('/api/v1/webhook-endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          url: webhookForm.url,
          subscribed_events: webhookForm.events.split(',').map(s => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data?.error?.message ?? 'Failed'); return; }
      setCreatedSecret(typeof data.secret_shown_once === 'string' ? data.secret_shown_once : null);
      setShowSecret(false);
      toast.success('Webhook created');
      setShowWebhookForm(false);
      await load();
    } catch {
      toast.error('Creation could not be confirmed. Refresh the list before trying again.');
    } finally { setPosting(false); }
  }

  async function copySecret() {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret);
      toast.success('Signing secret copied');
    } catch {
      toast.error('Copy was blocked. Show the secret and copy it manually.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Webhook className="h-6 w-6" /> Integrations</h1>
        <p className="text-muted-foreground">Manage webhook endpoints and review integration availability.</p>
      </div>

      {/* Webhook Endpoints */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap gap-3 items-center justify-between">
          <CardTitle className="text-base">Webhook Endpoints ({webhooks.length})</CardTitle>
          <Button size="sm" variant="outline" aria-expanded={showWebhookForm} aria-controls="webhook-form" disabled={!!createdSecret} onClick={() => setShowWebhookForm(!showWebhookForm)}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </CardHeader>
        <CardContent>
          {createdSecret && (
            <section aria-labelledby="webhook-secret-title" className="mb-4 space-y-3 rounded-md border bg-muted/40 p-4">
              <h2 id="webhook-secret-title" className="font-medium">Save your signing secret</h2>
              <p className="text-sm text-muted-foreground">Save this in your receiving application before dismissing. It cannot be retrieved again here.</p>
              <Label htmlFor="webhook-signing-secret">Signing secret</Label>
              <Input id="webhook-signing-secret" readOnly type={showSecret ? 'text' : 'password'} value={createdSecret} autoComplete="off" className="font-mono" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setShowSecret(!showSecret)}>{showSecret ? 'Hide secret' : 'Show secret'}</Button>
                <Button type="button" onClick={copySecret}>Copy secret</Button>
                <Button type="button" variant="ghost" onClick={() => { setCreatedSecret(null); setShowSecret(false); }}>I have saved it</Button>
              </div>
            </section>
          )}
          {showWebhookForm && (
            <form id="webhook-form" onSubmit={handleCreateWebhook} className="border rounded p-3 mb-3 space-y-2">
              <div>
                <Label htmlFor="field-app-erp-dashboard-integrations-page-1">HTTPS URL *</Label>
                <Input id="field-app-erp-dashboard-integrations-page-1" type="url" placeholder="https://example.com/webhook" value={webhookForm.url}
                  onChange={e => setWebhookForm({ ...webhookForm, url: e.target.value })} required />
              </div>
              <div>
                <Label htmlFor="field-app-erp-dashboard-integrations-page-2">Subscribed Events (comma-separated)</Label>
                <Input id="field-app-erp-dashboard-integrations-page-2" value={webhookForm.events} onChange={e => setWebhookForm({ ...webhookForm, events: e.target.value })} />
              </div>
              <Button type="submit" size="sm" disabled={posting}>{posting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}Create</Button>
            </form>
          )}

          {loading ? <LoadingState label="Loading webhook endpoints…" /> : loadError ? <ErrorState message={loadError} onRetry={load} /> : webhooks.length === 0 ? (
            <EmptyState message="No webhook endpoints yet." />
          ) : (
            <div className="space-y-2">
              {webhooks.map(w => (
                <div key={w.id} className="flex items-center justify-between border rounded p-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs truncate">{w.url}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
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
            Batch history and conflict resolution are not available on this page. Contact your administrator for sync support.
          </div>
          <div className="mt-3 p-3 border rounded bg-warning text-sm">
            <AlertTriangle className="h-4 w-4 inline mr-1 text-warning-foreground" />
            Offline POS is available only to approved pilot workspaces. Platform operations manages access.
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
