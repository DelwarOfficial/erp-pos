// src/app/(erp)/dashboard/settings/page.tsx
// User settings — includes WebAuthn credential management.

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Fingerprint, Key, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  startRegistration,
  startAuthentication,
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
      const res = await fetch('/api/v1/webauthn/credentials');
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
      const beginRes = await fetch('/api/v1/webauthn/registration/begin', { method: 'POST' });
      const beginData = await beginRes.json();
      if (!beginRes.ok) throw new Error(beginData?.error?.message ?? 'Begin failed');

      // 2. Call the browser WebAuthn API
      const credential = await startRegistration(beginData.options as any);

      // 3. Finish registration
      const finishRes = await fetch('/api/v1/webauthn/registration/finish', {
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
    if (!confirm('Revoke this passkey? You will need to use another MFA method.')) return;
    try {
      const res = await fetch(`/api/v1/webauthn/credentials?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Revoke failed');
      toast.success('Passkey revoked');
      await loadCreds();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Revoke failed');
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Key className="h-6 w-6" /> Settings
        </h1>
        <p className="text-muted-foreground">Manage your account security and preferences.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5" /> WebAuthn Passkeys
          </CardTitle>
          <CardDescription>
            Register a passkey (Face ID, Touch ID, security key) for passwordless MFA.
            Per §6 rule 2, WebAuthn is mandatory for owners/global_admins in addition to TOTP.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!hasWebAuthnSupport && (
            <div className="text-sm text-amber-700 bg-amber-50 p-3 rounded border border-amber-200">
              Your browser does not support WebAuthn. Use a modern browser (Chrome, Safari, Firefox, Edge) to register passkeys.
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : creds.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No passkeys registered yet.
            </div>
          ) : (
            <div className="space-y-2">
              {creds.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 border rounded-md">
                  <div>
                    <div className="font-medium">{c.name ?? 'Unnamed passkey'}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      <code>{c.credentialId}...</code>
                      {c.deviceType && ` • ${c.deviceType}`}
                      {c.backedUp && <Badge variant="secondary" className="ml-2 text-xs">synced</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Created: {new Date(c.createdAt).toLocaleDateString()}
                      {c.lastUsedAt && ` • Last used: ${new Date(c.lastUsedAt).toLocaleString()}`}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleRevoke(c.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Button onClick={handleRegister} disabled={registering || !hasWebAuthnSupport} className="w-full">
            {registering ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Register New Passkey
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
