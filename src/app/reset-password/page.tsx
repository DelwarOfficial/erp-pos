'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { request } from '@/components/access/common';
export default function ResetPasswordPage() {
  const [token, setToken] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState('');
  useEffect(() => { setToken(window.location.hash.slice(1)); window.history.replaceState(null, '', '/reset-password'); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true); setError('');
    try { await request('/api/v1/auth/password-reset', { method: 'POST', body: JSON.stringify({ token, password }) }); setDone(true); setToken(''); setPassword(''); setConfirm(''); }
    catch (error) { setError(error instanceof Error ? error.message : 'Reset failed.'); } finally { setBusy(false); }
  }
  return <main className="max-w-md mx-auto p-6 space-y-4"><h1 className="text-2xl font-bold">Reset password</h1>
    {done ? <p role="status">Password changed. Previous sessions ended. <Link href="/login">Sign in</Link>; existing MFA remains required.</p>
      : <form className="space-y-4" onSubmit={submit}>{error && <p role="alert">{error}</p>}
        {!token && <p role="alert">Open a valid one-time reset link from your administrator.</p>}
        <label className="block">New password<Input type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={password} onChange={event => setPassword(event.target.value)} /></label>
        <label className="block">Confirm password<Input type="password" autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
        <Button disabled={busy || !token} type="submit">{busy ? 'Resetting…' : 'Reset password'}</Button></form>}
  </main>;
}
