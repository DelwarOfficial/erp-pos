// public/sw.js — Service Worker for PWA offline POS capabilities.
// Per §10 PWA requirements:
//   - Caches app shell for offline navigation
//   - Queues non-GET mutations when offline and replays on reconnect
//   - Network-first for navigation, cache-first for static assets

const CACHE_VERSION = 'erp-pos-v2';
const APP_SHELL = [
  '/',
  '/login',
  '/dashboard',
  '/dashboard/pos',
  '/manifest.json',
  '/logo.svg',
];

// ── Install: pre-cache app shell ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => {/* skip failed */})))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches + claim clients ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Background Sync: replay queued mutations ──
self.addEventListener('sync', (event) => {
  if (event.tag === 'erp-pos-outbox') {
    event.waitUntil(replayOutbox());
  }
});

// ── Fetch handler ──
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Non-GET, same-origin: queue when offline (Background Sync API)
  if (request.method !== 'GET' && url.origin === self.location.origin) {
    event.respondWith(
      fetch(request).catch(async () => {
        // Offline — queue in IndexedDB and register for background sync
        await queueMutation(request);
        if (self.registration && 'sync' in self.registration) {
          try { await self.registration.sync.register('erp-pos-outbox'); }
          catch { /* Background Sync not supported — will retry on next navigation */ }
        }
        return new Response(JSON.stringify({
          error: { code: 'OFFLINE_QUEUED', message: 'Mutation queued — will sync when online' },
        }), { status: 202, headers: { 'Content-Type': 'application/json' } });
      })
    );
    return;
  }

  // API GET requests: network-first with offline JSON fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({
        error: { code: 'OFFLINE', message: 'You are offline' },
      }), { status: 503, headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }

  // Navigation: network-first, fall back to cached /dashboard for offline POS
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/dashboard').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const c = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, c));
      }
      return response;
    }))
  );
});

// ── IndexedDB mutation queue ──
function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('erp-pos-sw-queue', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('mutations')) {
        db.createObjectStore('mutations', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueMutation(request) {
  const body = await request.clone().text();
  const entry = { url: request.url, method: request.method, body, headers: Object.fromEntries(request.headers), ts: Date.now() };
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    tx.objectStore('mutations').add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function replayOutbox() {
  const db = await openQueueDB();
  const entries = await new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readonly');
    const req = tx.objectStore('mutations').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  for (const entry of entries) {
    try {
      const res = await fetch(entry.url, {
        method: entry.method,
        headers: entry.headers,
        body: entry.body,
        credentials: 'include',
      });
      if (res.ok || res.status === 409 || res.status === 422) {
        // 409/422 = server processed but rejected — don't retry
        const delTx = db.transaction('mutations', 'readwrite');
        delTx.objectStore('mutations').delete(entry.id);
        await new Promise((r) => { delTx.oncomplete = () => r(); });
      }
    } catch {
      // Network still down — leave in queue for next sync
      break;
    }
  }

  // Notify clients
  const clients = await self.clients.matchAll();
  for (const c of clients) c.postMessage({ type: 'OUTBOX_SYNCED' });
}
