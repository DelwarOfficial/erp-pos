'use client';

import { useRef, useState } from 'react';
import { apiFetch } from '@/lib/api/client';

/** Retain a command's idempotency key after ambiguous network failures. */
export function useWorkflowMutation() {
  const keys = useRef(new Map<string, string>());
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function mutate<T>(url: string, body: unknown, method = 'POST'): Promise<T | null> {
    if (busy.current) return null;
    busy.current = true; setPending(true); setError('');
    const payload = JSON.stringify(body);
    const identity = `${method}:${url}:${payload}`;
    const key = keys.current.get(identity) ?? crypto.randomUUID();
    keys.current.set(identity, key);
    try {
      const response = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: payload });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? 'Action failed. Review the form and retry.');
      keys.current.delete(identity);
      return data as T;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Network error. Retry the same action.'); return null; }
    finally { busy.current = false; setPending(false); }
  }
  return { mutate, pending, error, setError };
}
