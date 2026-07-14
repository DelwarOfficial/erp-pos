// src/components/catalogue/InlineCrudList.tsx
// Reusable inline CRUD list for simple master data (categories, brands, units, tax components).

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';

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
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, unknown>>({});
  const [createForm, setCreateForm] = useState<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(endpoint);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to load');
      setItems(data.items ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
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
      const res = await fetch(endpoint, {
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

  function startEdit(item: ListItem) {
    const form: Record<string, unknown> = {};
    for (const f of fields) {
      form[f.name] = item[f.name];
    }
    setEditForm(form);
    setEditingId(item.id);
  }

  function handleSaveEdit() {
    toast.info('Inline edit requires a PATCH endpoint — coming in a future iteration. Use delete + recreate for now.');
    setEditingId(null);
  }

  function handleDelete() {
    toast.info('Delete requires a PATCH/DELETE endpoint — coming in a future iteration.');
  }

  function renderField(field: FieldSpec, value: unknown, onChange: (v: unknown) => void) {
    switch (field.type) {
      case 'boolean':
        return (
          <div className="flex items-center gap-2">
            <Switch
              id={`field-${field.name}`}
              checked={Boolean(value)}
              onCheckedChange={onChange}
            />
            <Label htmlFor={`field-${field.name}`} className="text-xs">{field.label}</Label>
          </div>
        );
      case 'select':
        return (
          <select
            className="border rounded px-2 py-1 text-sm w-full"
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
        <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-4 text-sm text-muted-foreground">No {label.toLowerCase()}s yet.</div>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {items.map(item => (
            <div key={item.id} className="flex items-center justify-between p-2 border rounded text-sm">
              {editingId === item.id ? (
                <div className="flex-1 grid grid-cols-2 gap-2">
                  {fields.map(f => (
                    <div key={f.name}>
                      <Label className="text-xs">{f.label}</Label>
                      {renderField(f, editForm[f.name], v => setEditForm({ ...editForm, [f.name]: v }))}
                    </div>
                  ))}
                  <div className="col-span-2 flex gap-2">
                    <Button size="sm" onClick={handleSaveEdit}><Check className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}><X className="h-3 w-3" /></Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex-1">{renderItem(item)}</div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => startEdit(item)} title="Edit">
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={handleDelete} title="Delete">
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleCreate} className="border-t pt-3 space-y-2">
        <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Plus className="h-3 w-3" /> New {label}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {fields.map(f => (
            <div key={f.name}>
              <Label className="text-xs">{f.label}</Label>
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
