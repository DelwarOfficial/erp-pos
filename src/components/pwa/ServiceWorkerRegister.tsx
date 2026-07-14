'use client';

// src/components/pwa/ServiceWorkerRegister.tsx
// Registers /sw.js on the client and listens for updates.
// Per §10 PWA requirements.

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production' && !process.env.NEXT_PUBLIC_ENABLE_SW) return;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('[pwa] Service worker registered', reg.scope);

        // Listen for updates
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available — prompt user to refresh
              console.log('[pwa] New version available — reload to update');
            }
          });
        });
      } catch (e) {
        console.warn('[pwa] Service worker registration failed:', e);
      }
    };

    register();
  }, []);

  return null;
}
