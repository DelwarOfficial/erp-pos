// src/components/shared/OfflineStatus.tsx
// Shows online/offline status indicator + pending sync count.

'use client';
import { useOfflineSync } from '@/components/pwa/OfflineSyncProvider';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';

export function OfflineStatus() {
  const { status, pendingCount, flushOutbox } = useOfflineSync();

  if (status === 'online' && pendingCount === 0) {
    return (
      <Badge className="bg-green-100 text-green-800">
        <Wifi className="h-3 w-3 mr-1" /> Online
      </Badge>
    );
  }

  if (status === 'offline') {
    return (
      <Badge className="bg-red-100 text-red-800">
        <WifiOff className="h-3 w-3 mr-1" /> Offline
      </Badge>
    );
  }

  if (status === 'syncing') {
    return (
      <Badge className="bg-blue-100 text-blue-800">
        <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Syncing...
      </Badge>
    );
  }

  // Online with pending items
  return (
    <button onClick={flushOutbox} className="cursor-pointer">
      <Badge className="bg-yellow-100 text-yellow-800">
        <Wifi className="h-3 w-3 mr-1" /> Online ({pendingCount} pending)
      </Badge>
    </button>
  );
}
