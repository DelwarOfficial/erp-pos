// src/app/(erp)/dashboard/settings/page.tsx
// User settings — includes WebAuthn credential management.

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Fingerprint, Key, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirmation } from '@/hooks/useConfirmation';
import { formatDate, formatDateTime } from '@/lib/i18n/format';
import { LoadingState, EmptyState } from '@/components/shared/StateList';
import { apiFetch } from '@/lib/api/client';
import {
  startRegistration,
} from '@simplewebauthn/browser';

interface Credential {
  id: string;
  name: string | null;
  credentialId: string;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function SettingsPage() {
  const { confirm, confirmation } = useConfirmation();
  const [creds, setCreds] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [hasWebAuthnSupport, setHasWebAuthnSupport] = useState(false);

  useEffect(() => {
    setHasWebAuthnSupport(
      typeof window !== 'undefined' &&
      typeof window.PublicKeyCredential !== 'undefined'
    );
    loadCreds();
  }, []);

  async function loadCreds() {
    setLoading(true);
    try {
      const res = await apiFetch('/api/v1/webauthn/credentials');
      const data = await res.json();
      setCreds(data.items ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load credentials');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    setRegistering(true);
    try {
      // 1. Begin registration
      const beginRes = await apiFetch('/api/v1/webauthn/registration/begin', { method: 'POST' });
      const beginData = await beginRes.json();
      if (!beginRes.ok) throw new Error(beginData?.error?.message ?? 'Begin failed');

      // 2. Call the browser WebAuthn API
      const credential = await startRegistration(beginData.options as any);

      // 3. Finish registration
      const finishRes = await apiFetch('/api/v1/webauthn/registration/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: credential, name: 'Passkey ' + new Date().toLocaleDateString() }),
      });
      const finishData = await finishRes.json();
      if (!finishRes.ok) throw new Error(finishData?.error?.message ?? 'Finish failed');

      toast.success('Passkey registered');
      await loadCreds();
    } catch (e) {
      // User cancellation is a DOMException with name='AbortError'
      if (e instanceof Error && e.name === 'AbortError') {
        toast.info('Registration cancelled');
      } else {
        toast.error(e instanceof Error ? e.message : 'Registration failed');
      }
    } finally {
      setRegistering(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!await confirm({ title: 'Revoke this passkey?', description: 'You will need another sign-in verification method to access your account. This passkey will no longer work.', action: 'Revoke passkey', destructive: true })) return;
    try {
      const res = await apiFetch(`/api/v1/webauthn/credentials?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Revoke failed');
      toast.success('Passkey revoked');
      await loadCreds();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Revoke failed');
    }
  }

  return (
    <div className="min-w-0 space-y-6 pb-6">
      {confirmation}
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Key aria-hidden="true" className="h-6 w-6" /> Settings
        </h1>
        <p className="text-muted-foreground">Manage your account security and preferences.</p>
      </div>

      <Card className="min-w-0 rounded-xl shadow-none">
        <CardHeader className="border-b bg-muted/20">
          <CardTitle className="flex items-center gap-2">
            <Fingerprint aria-hidden="true" className="h-5 w-5" /> Passkeys
          </CardTitle>
          <CardDescription>
            Use Face ID, Touch ID, or a security key to verify your sign-in. Owners and global administrators also need an authenticator app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!hasWebAuthnSupport && (
            <div className="text-sm text-warning-foreground bg-warning p-3 rounded border border-warning-foreground/20">
              Your browser does not support WebAuthn. Use a modern browser (Chrome, Safari, Firefox, Edge) to register passkeys.
            </div>
          )}

          {loading ? (
            <LoadingState label="Loading passkeys..." />
          ) : creds.length === 0 ? (
            <EmptyState icon={<Fingerprint aria-hidden="true" className="size-8 text-muted-foreground" />} message="No passkeys registered yet. Add one to verify your sign-in using your device." />
          ) : (
            <div className="space-y-2">
              {creds.map(c => (
                <div key={c.id} className="flex min-w-0 flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="break-words font-medium">{c.name ?? 'Unnamed passkey'}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      <span>Credential: <code className="break-all">{c.credentialId}...</code></span>
                      {c.deviceType && ` • ${c.deviceType}`}
                      {c.backedUp && <Badge variant="secondary" className="ml-2 text-xs">synced</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Created: {formatDate(c.createdAt)}
                      {c.lastUsedAt && ` • Last used: ${formatDateTime(c.lastUsedAt)}`}
                    </div>
                  </div>
                  <Button variant="outline" className="min-h-11 shrink-0 self-start text-destructive hover:text-destructive" aria-label={`Revoke ${c.name ?? 'unnamed passkey'}`} onClick={() => handleRevoke(c.id)}>
                    <Trash2 aria-hidden="true" className="size-4" />Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Button onClick={handleRegister} disabled={registering || !hasWebAuthnSupport} className="min-h-11 w-full sm:w-auto">
            {registering ? <Loader2 aria-hidden="true" className="h-4 w-4 mr-2 animate-spin motion-reduce:animate-none" /> : <Plus aria-hidden="true" className="h-4 w-4 mr-2" />}
            {registering ? 'Registering passkey...' : 'Register New Passkey'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
