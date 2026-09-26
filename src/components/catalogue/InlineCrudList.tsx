// src/components/catalogue/InlineCrudList.tsx
// Reusable inline CRUD list for simple master data (categories, brands, units, tax components).

'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api/client';
import { ErrorState, LoadingState } from '@/components/shared/StateList';

export interface FieldSpec {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  step?: string;
  min?: number;
}

export interface ListItem {
  id: string;
  [key: string]: unknown;
}

interface Props {
  endpoint: string;
  label: string;
  fields: FieldSpec[];
  renderItem: (item: ListItem) => React.ReactNode;
  idempotencyPrefix: string;
}

export function InlineCrudList({ endpoint, label, fields, renderItem, idempotencyPrefix }: Props) {
  const formId = useId();
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(endpoint);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load');
      if (!Array.isArray(data.items)) throw new Error('The list response could not be read. Try again.');
      setItems(data.items);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The list could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const idempotencyKey = `${idempotencyPrefix}-create-${Date.now()}`;
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Create failed');
      toast.success(`${label} created`);
      setCreateForm({});
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally {
      setCreating(false);
    }
  }

  function renderField(field: FieldSpec, value: unknown, onChange: (v: unknown) => void) {
    const id = `${formId}-${field.name}`;
    switch (field.type) {
      case 'boolean':
        return (
            <Switch
              id={id}
              checked={Boolean(value)}
              onCheckedChange={onChange}
            />
        );
      case 'select':
        return (
          <select
            id={id}
            required={field.required}
            className="border border-input bg-background rounded-md px-3 py-2 text-sm w-full min-w-0"
            value={String(value ?? '')}
            onChange={e => onChange(e.target.value)}
          >
            <option value="">Select...</option>
            {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
      case 'number':
        return (
          <Input
            id={id}
            type="number"
            step={field.step}
            min={field.min}
            placeholder={field.placeholder}
            value={String(value ?? '')}
            onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            required={field.required}
          />
        );
      default:
        return (
          <Input
            id={id}
            type="text"
            placeholder={field.placeholder}
            value={String(value ?? '')}
            onChange={e => onChange(e.target.value)}
            required={field.required}
          />
        );
    }
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <LoadingState label={`Loading ${label.toLowerCase()} records...`} />
      ) : loadError ? <ErrorState message={loadError} onRetry={load} /> : items.length === 0 ? (
        <div className="text-center py-4 text-sm text-muted-foreground">No {label.toLowerCase()} records yet.</div>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {items.map(item => (
            <div key={item.id} className="min-w-0 break-words p-2 border rounded text-sm">
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Editing and deletion are not available here.</p>

      <form onSubmit={handleCreate} className="border-t pt-3 space-y-2">
        <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Plus className="h-3 w-3" /> New {label}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {fields.map(f => (
            <div key={f.name} className="min-w-0 space-y-1">
              <Label htmlFor={`${formId}-${f.name}`} className="text-xs">{f.label}</Label>
              {renderField(f, createForm[f.name], v => setCreateForm({ ...createForm, [f.name]: v }))}
            </div>
          ))}
        </div>
        <Button type="submit" size="sm" disabled={creating}>
          {creating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
          Add {label}
        </Button>
      </form>
    </div>
  );
}
