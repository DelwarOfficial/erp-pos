'use client';

import { useEffect, useId, useRef, useState } from 'react';
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
export function EntityPicker<T extends BusinessEntity>({ label, endpoint, value, onChange, disabled, serverSearch = true, searchParam = 'search', minimumSearch = 0, createAction, searchPlaceholder, selectPlaceholder, searchLabel, noResultsLabel, loadingLabel, retryLabel, getOptionDescription, getOptionDisabled }: {
  label: string; endpoint: string; value: T | null; onChange: (entity: T) => void;
  disabled?: boolean; serverSearch?: boolean;
  searchParam?: string; minimumSearch?: number;
  /** Optional "add new" action beside the search and in the no-results state; gets the typed text. */
  createAction?: { label: string; onCreate: (search: string) => void };
  searchPlaceholder?: string;
  selectPlaceholder?: string;
  searchLabel?: string; noResultsLabel?: string; loadingLabel?: string; retryLabel?: string;
  getOptionDescription?: (entity: T) => string | undefined;
  getOptionDisabled?: (entity: T) => boolean;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingCreate = useRef<string | null>(null);
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
    if (search.trim().length < minimumSearch) { setItems([]); setCursor(null); setLoading(false); setError(''); return; }
    let alive = true;
    const controller = new AbortController();
    setLoading(true); setError('');
    if (!page) setItems([]);
    const timer = setTimeout(async () => {
      try {
        const query = new URLSearchParams(endpoint.split('?')[1]);
        query.set('limit', '100');
        if (serverSearch && search) query.set(searchParam, search);
        if (page) query.set('cursor', page);
        const response = await apiFetch(`${endpoint.split('?')[0]}?${query}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? `Unable to load ${label.toLowerCase()}`);
        if (alive) {
          const options = (data.items ?? []).map((item: T & { reference_no?: string; serial_number?: string }) => ({ ...item, name: item.name ?? item.reference_no ?? item.serial_number ?? 'Unnamed record' }));
          setItems(current => page ? [...current, ...options] : options);
          setCursor(data.has_more ? data.next_cursor : null);
        }
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'Unable to load options');
      } finally { if (alive) setLoading(false); }
    }, 200);
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [open, endpoint, serverSearch, search, searchParam, minimumSearch, page, attempt, label]);
  const visible = serverSearch ? items : items.filter(item => `${item.name} ${item.code ?? ''} ${item.branch?.name ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="min-w-0 space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button ref={triggerRef} id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-controls={`${id}-options`} disabled={disabled} className="min-h-11 w-full justify-start overflow-hidden">
        <span className="truncate">{value ? `${value.name}${value.code ? ` (${value.code})` : ''}` : selectPlaceholder ?? `Select ${label.toLowerCase()}`}</span>
      </Button></PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] space-y-2" onCloseAutoFocus={event => {
        if (pendingCreate.current === null) return;
        event.preventDefault();
        const query = pendingCreate.current; pendingCreate.current = null;
        triggerRef.current?.focus();
        requestAnimationFrame(() => createAction?.onCreate(query));
      }}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <Input className="min-h-11 min-w-0 flex-1" aria-label={searchLabel ?? `Search ${label.toLowerCase()}`} value={search} onChange={event => { setSearch(event.target.value); setPage(null); }} placeholder={searchPlaceholder ?? 'Search by name or code'}
            onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); document.getElementById(`${id}-options`)?.querySelector<HTMLElement>('[role="option"]:not(:disabled)')?.focus(); } }} />
          {createAction ? <Button type="button" variant="outline" className="min-h-11 h-auto whitespace-normal sm:max-w-40" onClick={() => { pendingCreate.current = search.trim(); setOpen(false); }}>{createAction.label}</Button> : null}
        </div>
        {error ? <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button type="button" variant="outline" onClick={() => setAttempt(n => n + 1)}>{retryLabel ?? 'Retry'}</Button></div> : null}
        <div id={`${id}-options`} role="listbox" aria-label={label} aria-busy={loading} className="max-h-64 space-y-1 overflow-y-auto"
          onKeyDown={event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)')];
            if (!options.length) return;
            event.preventDefault();
            const index = options.indexOf(document.activeElement as HTMLElement);
            options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
          }}>
          {visible.map(item => <Button key={item.id} type="button" role="option" aria-selected={item.id === value?.id} disabled={getOptionDisabled?.(item)} variant="ghost" className="min-h-11 h-auto w-full justify-start whitespace-normal text-left" onClick={() => { onChange(item); setOpen(false); }}>
            <span className="min-w-0 break-words">{item.name}{item.code ? ` (${item.code})` : ''}{item.branch ? <span className="block text-xs text-muted-foreground">{item.branch.name}</span> : null}{getOptionDescription?.(item) ? <span className="block break-all text-xs text-muted-foreground">{getOptionDescription(item)}</span> : null}</span>
          </Button>)}
        </div>
        {!loading && !error && !visible.length ? <p role="status" className="p-2 text-sm text-muted-foreground">{search.trim().length < minimumSearch ? `Type at least ${minimumSearch} characters to search.` : noResultsLabel ?? 'No matching options.'}</p> : null}
        {createAction && !loading && !error && !visible.length && search.trim().length >= minimumSearch ? <Button type="button" className="min-h-11 h-auto w-full whitespace-normal" onClick={() => { pendingCreate.current = search.trim(); setOpen(false); }}>{createAction.label}</Button> : null}
        {loading ? <p role="status" className="text-sm">{loadingLabel ?? 'Loading options…'}</p> : cursor ? <Button type="button" variant="outline" onClick={() => setPage(cursor)}>Load more options</Button> : null}
      </PopoverContent>
    </Popover>
  </div>;
}
