'use client';

import { useEffect, useId, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface BusinessEntity {
  id: string;
  name: string;
  code?: string;
  branch?: { id: string; name: string; code?: string };
}

/** Searches server-supported lists; reference lists can filter the loaded page locally. */
export function EntityPicker<T extends BusinessEntity>({ label, endpoint, value, onChange, disabled, serverSearch = true }: {
  label: string; endpoint: string; value: T | null; onChange: (entity: T) => void;
  disabled?: boolean; serverSearch?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const query = new URLSearchParams(endpoint.split('?')[1]);
        query.set('limit', '100');
        if (serverSearch && search) query.set('search', search);
        if (page) query.set('cursor', page);
        const response = await apiFetch(`${endpoint.split('?')[0]}?${query}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? `Unable to load ${label.toLowerCase()}`);
        if (alive) {
          setItems(current => page ? [...current, ...(data.items ?? [])] : data.items ?? []);
          setCursor(data.has_more ? data.next_cursor : null);
        }
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'Unable to load options');
      } finally { if (alive) setLoading(false); }
    }, 200);
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [open, endpoint, serverSearch, search, page, attempt, label]);
  const visible = serverSearch ? items : items.filter(item => `${item.name} ${item.code ?? ''} ${item.branch?.name ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="min-w-0 space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="w-full justify-start overflow-hidden">
        <span className="truncate">{value ? `${value.name}${value.code ? ` (${value.code})` : ''}` : `Select ${label.toLowerCase()}`}</span>
      </Button></PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] space-y-2">
        <Input aria-label={`Search ${label.toLowerCase()}`} value={search} onChange={event => { setSearch(event.target.value); setPage(null); }} placeholder="Search by name or code" />
        {error ? <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button type="button" variant="outline" onClick={() => setAttempt(n => n + 1)}>Retry</Button></div> : null}
        <div role="listbox" aria-label={label} aria-busy={loading} className="max-h-64 space-y-1 overflow-y-auto">
          {visible.map(item => <Button key={item.id} type="button" role="option" aria-selected={item.id === value?.id} variant="ghost" className="h-auto w-full justify-start whitespace-normal text-left" onClick={() => { onChange(item); setOpen(false); }}>
            <span>{item.name}{item.code ? ` (${item.code})` : ''}{item.branch ? <span className="block text-xs text-muted-foreground">{item.branch.name}</span> : null}</span>
          </Button>)}
          {!loading && !error && !visible.length ? <p className="p-2 text-sm text-muted-foreground">No matching options.</p> : null}
        </div>
        {loading ? <p role="status" className="text-sm">Loading options…</p> : cursor ? <Button type="button" variant="outline" onClick={() => setPage(cursor)}>Load more options</Button> : null}
      </PopoverContent>
    </Popover>
  </div>;
}
