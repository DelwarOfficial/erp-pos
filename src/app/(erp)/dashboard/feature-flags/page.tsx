// src/app/(erp)/dashboard/feature-flags/page.tsx
// Feature flag toggles — per §20.D02.

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Loader2, Flag } from 'lucide-react';
import { toast } from 'sonner';

interface FeatureFlag {
  flagKey: string;
  module: string;
  description: string;
  enabled: boolean;
  defaultValue: boolean;
  updatedAt: string;
}

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/feature-flags')
      .then(r => r.json())
      .then(d => setFlags(d.items ?? []))
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(flag: FeatureFlag, newEnabled: boolean) {
    setToggling(flag.flagKey);
    try {
      const idempotencyKey = `flag-${flag.flagKey}-${Date.now()}`;
      const res = await fetch(`/api/v1/feature-flags/${flag.flagKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ enabled: newEnabled, reason: 'manual_toggle' }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message ?? 'Failed to toggle flag');
        return;
      }
      setFlags(prev => prev.map(f => f.flagKey === flag.flagKey ? { ...f, enabled: newEnabled } : f));
      toast.success(`${flag.flagKey} ${newEnabled ? 'enabled' : 'disabled'}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error');
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Flag className="h-6 w-6" /> Feature Flags
        </h1>
        <p className="text-muted-foreground">
          Per §20.D02 — optional modules are disabled by default. Core modules are always enabled and not listed here.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Optional Modules</CardTitle>
          <CardDescription>
            Toggling a flag audited. Enabling a flag for an unimplemented module returns 409 MODULE_NOT_IMPLEMENTED.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div className="space-y-3">
              {flags.map(f => (
                <div key={f.flagKey} className="flex items-center justify-between p-3 border rounded-md">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-sm font-medium">{f.flagKey}</code>
                      <Badge variant="outline" className="text-xs">{f.module}</Badge>
                      {f.enabled !== f.defaultValue && (
                        <Badge variant="secondary" className="text-xs">
                          default: {f.defaultValue ? 'on' : 'off'}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{f.description}</p>
                  </div>
                  <Switch
                    checked={f.enabled}
                    onCheckedChange={(v) => handleToggle(f, v)}
                    disabled={toggling === f.flagKey}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
