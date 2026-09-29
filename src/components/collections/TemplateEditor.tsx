// Due reminder texts: the built-in ones and the company's own, per stage
// (before due, due today, overdue) and language. Only the listed
// {{placeholders}} are accepted; the server checks every save.
// Consumes: GET /api/v1/communications/templates, POST /api/v1/communications/templates/preview,
//           PUT|DELETE /api/v1/communications/templates/{code}.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api/client';
import { newIdempotencyKey, readError } from './common';

interface Rendered { text: string; encoding: 'gsm7' | 'ucs2'; segments: number }
interface Template {
  code: string; kind: 'upcoming' | 'due_today' | 'overdue'; locale: 'bn' | 'en'; default_text: string;
  custom_text: string | null; custom_active: boolean; version: number; effective_text: string; preview: Rendered;
}
const KIND_LABEL = { upcoming: 'Before the due date', due_today: 'On the due date', overdue: 'After the due date' } as const;

export function TemplateEditor() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [placeholders, setPlaceholders] = useState<string[]>([]);
  const [code, setCode] = useState('due_reminder.upcoming.bn');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Rendered | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch('/api/v1/communications/templates');
    if (!r.ok) { toast.error(await readError(r)); return; }
    const data = await r.json();
    setTemplates(data.items); setPlaceholders(data.placeholders);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const current = templates?.find(t => t.code === code) ?? null;
  useEffect(() => { if (current) setText(current.effective_text); }, [current]);

  // Live preview, debounced; the server is the only judge of what is valid.
  useEffect(() => {
    if (!current || !text.trim()) { setPreview(null); return; }
    const timer = setTimeout(async () => {
      const r = await apiFetch('/api/v1/communications/templates/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey('template-preview') },
        body: JSON.stringify({ text, locale: current.locale }),
      });
      if (r.ok) { setPreview(await r.json()); setPreviewError(null); } else { setPreview(null); setPreviewError(await readError(r)); }
    }, 400);
    return () => clearTimeout(timer);
  }, [text, current]);

  async function save() {
    setSaving(true);
    try {
      const r = await apiFetch(`/api/v1/communications/templates/${code}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newIdempotencyKey('template-save') },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(await readError(r));
      toast.success('Text saved. New reminders use it.');
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
    finally { setSaving(false); }
  }
  async function reset() {
    const r = await apiFetch(`/api/v1/communications/templates/${code}`, { method: 'DELETE' });
    if (!r.ok) { toast.error(await readError(r)); return; }
    toast.success('Back to the built-in text');
    void load();
  }

  if (!templates) return <Skeleton className="h-64" />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reminder texts</CardTitle>
        <CardDescription>What customers receive. Amounts and dates are filled in when each SMS is sent. Bangla text is sent as Unicode: 70 characters per SMS part instead of 160.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="template-choice">Text</Label>
          <Select value={code} onValueChange={setCode}>
            <SelectTrigger id="template-choice" className="w-80"><SelectValue /></SelectTrigger>
            <SelectContent>
              {templates.map(t => (
                <SelectItem key={t.code} value={t.code}>{KIND_LABEL[t.kind]} · {t.locale === 'bn' ? 'বাংলা' : 'English'}{t.custom_active ? ' · custom' : ''}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {current && (
          <p className="text-xs text-muted-foreground">
            {current.custom_active ? <Badge variant="secondary">Custom, version {current.version}</Badge> : <Badge variant="outline">Built-in</Badge>}
          </p>
        )}
        <div className="space-y-1">
          <Label htmlFor="template-text">Message</Label>
          <Textarea id="template-text" rows={4} value={text} onChange={e => setText(e.target.value)} maxLength={700} lang={current?.locale} />
          <div className="flex flex-wrap gap-1">
            {placeholders.map(p => (
              <Button key={p} type="button" size="sm" variant="outline" className="h-6 px-2 font-mono text-xs"
                onClick={() => setText(t => `${t}{{${p}}}`)}>{`{{${p}}}`}</Button>
            ))}
          </div>
        </div>
        {previewError ? <Alert variant="destructive"><AlertDescription>{previewError}</AlertDescription></Alert> : preview && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Example with sample values:</p>
            <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm" lang={current?.locale}>{preview.text}</p>
            <p className="text-xs text-muted-foreground">{preview.encoding === 'ucs2' ? 'Unicode' : 'Standard'} · {preview.text.length} characters · {preview.segments} SMS {preview.segments === 1 ? 'part' : 'parts'} each</p>
          </div>
        )}
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving || Boolean(previewError) || !text.trim() || text === current?.effective_text}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save text
          </Button>
          {current?.custom_active && <Button variant="outline" onClick={reset}><RotateCcw className="mr-2 h-4 w-4" />Use built-in text</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
