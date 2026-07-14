'use client';

// src/components/pwa/OfflineSyncProvider.tsx
// Provides a React context that:
//   1. Tracks online/offline status
//   2. Exposes an outbox queue for offline mutations (queued to IndexedDB)
//   3. Flushes the outbox when connectivity returns
//
// Per §10 PWA offline POS — must support sale posting while offline,
// sync when reconnected. Uses IndexedDB (not localStorage) to survive
// browser restarts.

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

type ConnectivityState = 'online' | 'offline' | 'syncing';

interface OutboxEntry {
  id: string;
  url: string;
  method: string;
  body: unknown;
  createdAt: number;
  attempts: number;
}

interface OfflineSyncContextValue {
  status: ConnectivityState;
  pendingCount: number;
  enqueue(url: string, method: string, body: unknown): Promise<void>;
  flushOutbox(): Promise<{ sent: number; failed: number }>;
}

const OfflineSyncContext = createContext<OfflineSyncContextValue | null>(null);

const DB_NAME = 'erp-pos-pwa';
const DB_VERSION = 1;
const STORE_NAME = 'outbox';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllOutbox(): Promise<OutboxEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as OutboxEntry[]);
    req.onerror = () => reject(req.error);
  });
}

async function putOutbox(entry: OutboxEntry): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteOutbox(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function OfflineSyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectivityState>('online');
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPending = useCallback(async () => {
    try {
      const entries = await getAllOutbox();
      setPendingCount(entries.length);
    } catch { /* IndexedDB may be unavailable in private browsing */ }
  }, []);

  useEffect(() => {
    refreshPending();
    const onOnline = () => {
      setStatus('online');
      // Auto-flush on reconnect
      flushOutboxInternal();
    };
    const onOffline = () => setStatus('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (typeof navigator !== 'undefined' && !navigator.onLine) setStatus('offline');
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refreshPending]);

  const enqueue = useCallback(async (url: string, method: string, body: unknown) => {
    const entry: OutboxEntry = {
      id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url, method, body, createdAt: Date.now(), attempts: 0,
    };
    await putOutbox(entry);
    await refreshPending();
    // If we're online, try to flush immediately
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      flushOutboxInternal();
    }
  }, [refreshPending]);

  const flushOutboxInternal = async (): Promise<{ sent: number; failed: number }> => {
    setStatus('syncing');
    let sent = 0, failed = 0;
    try {
      const entries = await getAllOutbox();
      for (const entry of entries) {
        try {
          const res = await fetch(entry.url, {
            method: entry.method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry.body),
            credentials: 'include',
          });
          if (res.ok) {
            await deleteOutbox(entry.id);
            sent++;
          } else {
            failed++;
            // Bump attempts; give up after 5
            await putOutbox({ ...entry, attempts: entry.attempts + 1 });
            if (entry.attempts >= 5) await deleteOutbox(entry.id);
          }
        } catch {
          failed++;
        }
      }
    } finally {
      await refreshPending();
      setStatus(typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline');
    }
    return { sent, failed };
  };

  const flushOutbox = useCallback(flushOutboxInternal, [refreshPending]);

  return (
    <OfflineSyncContext.Provider value={{ status, pendingCount, enqueue, flushOutbox }}>
      {children}
    </OfflineSyncContext.Provider>
  );
}

export function useOfflineSync(): OfflineSyncContextValue {
  const ctx = useContext(OfflineSyncContext);
  if (!ctx) throw new Error('useOfflineSync must be used within OfflineSyncProvider');
  return ctx;
}
