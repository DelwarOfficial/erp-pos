// tests/unit/mfaEnrollment.test.ts
// Initial MFA enrollment for privileged users without MFA (bootstrap).
// Route-level tests with an in-memory next/headers cookie store and a
// disposable SQLite database (DATABASE_URL).

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { authenticator } from '@otplib/preset-default';
import { hashPassword } from '../../src/lib/auth/password';
import { decryptString } from '../../src/lib/crypto';

const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (n: string) => (cookieStore.has(n) ? { value: cookieStore.get(n) } : undefined),
    set: (n: string, v: string) => { cookieStore.set(n, v); },
    delete: (n: string) => { cookieStore.delete(n); },
  })),
}));

import { POST as loginPost } from '../../src/app/api/v1/auth/login/route';
import { GET as setupGet } from '../../src/app/api/v1/auth/mfa/setup/route';
import { POST as activatePost } from '../../src/app/api/v1/auth/mfa/setup/activate/route';

const db = new PrismaClient();
const SETUP_COOKIE = 'erp_mfa_setup';

let companyId: string;
let privUserId: string;
let plainUserId: string;
const PRIV_EMAIL = 'mfa-priv-' + Date.now() + '@test.local';
const PLAIN_EMAIL = 'mfa-plain-' + Date.now() + '@test.local';
const PASSWORD = 'EnrollMe123!';

function loginReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authedSetupCookie(): string | undefined {
  return cookieStore.get(SETUP_COOKIE);
}

function setupReq(): NextRequest {
  return new NextRequest('http://localhost/api/v1/auth/mfa/setup');
}

beforeAll(async () => {
  await db.$connect();
  // PLATFORM stub for login's unknown-user audit path (find-or-create).
  const platform = await db.company.findFirst({ where: { code: 'PLATFORM' } });
  if (!platform) {
    await db.company.create({
      data: {
        code: 'PLATFORM',
        legalName: 'Platform',
        displayName: 'Platform',
        baseCurrencyCode: 'BDT',
        status: 'active',
      },
    });
  }
  const company = await db.company.create({
    data: {
      code: 'TEST-MFA-' + Date.now(),
      legalName: 'MFA Enroll Co',
      displayName: 'MFA Enroll',
      baseCurrencyCode: 'BDT',
      status: 'active',
    },
  });
  companyId = company.id;
  const hash = await hashPassword(PASSWORD);
  // Privileged (global access) WITHOUT MFA — the bootstrap case.
  const priv = await db.user.create({
    data: {
      companyId, name: 'Privileged', email: PRIV_EMAIL, passwordHash: hash,
      accessScope: 'global', mfaEnabled: false,
    },
  });
  privUserId = priv.id;
  // Ordinary user WITHOUT MFA — unchanged behavior expected.
  const plain = await db.user.create({
    data: {
      companyId, name: 'Ordinary', email: PLAIN_EMAIL, passwordHash: hash,
      accessScope: 'single_branch', mfaEnabled: false,
    },
  });
  plainUserId = plain.id;
});

afterAll(async () => {
  cookieStore.clear();
  if (companyId) {
    await db.refreshToken.deleteMany({ where: { companyId } });
    await db.securityEvent.deleteMany({ where: { companyId } });
    await db.auditLog.deleteMany({ where: { companyId } });
  }
  for (const id of [privUserId, plainUserId]) {
    if (id) await db.user.deleteMany({ where: { id } }).catch(() => undefined);
  }
  if (companyId) await db.company.deleteMany({ where: { id: companyId } }).catch(() => undefined);
  await db.$disconnect();
});

describe('MFA enrollment bootstrap', () => {
  it('unknown email -> generic 401 without disclosing existence', async () => {
    const res = await loginPost(loginReq({ email: 'nobody-' + Date.now() + '@test.local', password: 'x' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(JSON.stringify(body)).not.toContain('nobody-');
  });

  it('bad password -> 401 and increments failure counter', async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: privUserId } });
    const res = await loginPost(loginReq({ email: PRIV_EMAIL, password: 'WrongPass1!' }));
    expect(res.status).toBe(401);
    const after = await db.user.findUniqueOrThrow({ where: { id: privUserId } });
    expect(after.failedLoginCount).toBe(before.failedLoginCount + 1);
    expect(after.mfaEnabled).toBe(false);
  });

  it('privileged user + valid password + no MFA -> setup required, no session', async () => {
    cookieStore.clear();
    const res = await loginPost(loginReq({ email: PRIV_EMAIL, password: PASSWORD }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mfa_setup_required).toBe(true);
    expect(body.mfa_required).toBe(false);
    // Enrollment state issued, but NO authenticated session cookies.
    expect(authedSetupCookie()).toBeTruthy();
    const setCookies = res.headers.getSetCookie?.() ?? [];
    expect(setCookies.some((c) => c.startsWith('erp_access='))).toBe(false);
    const user = await db.user.findUniqueOrThrow({ where: { id: privUserId } });
    expect(user.mfaEnabled).toBe(false);
    expect(user.failedLoginCount).toBe(0);
  });

  it('setup challenge requires the password-bound cookie', async () => {
    cookieStore.clear();
    const res = await setupGet(setupReq());
    expect(res.status).toBe(401);
  });

  it('challenge returns one-time material; secret encrypted, never plaintext at rest', async () => {
    cookieStore.clear();
    await loginPost(loginReq({ email: PRIV_EMAIL, password: PASSWORD }));
    const res = await setupGet(setupReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.otpauth_url).toContain('otpauth://totp/');
    expect(typeof body.manual_key).toBe('string');
    // Server persists nothing yet.
    const user = await db.user.findUniqueOrThrow({ where: { id: privUserId } });
    expect(user.mfaEnabled).toBe(false);
    expect(user.mfaSecretCiphertext).toBeNull();
  });

  it('wrong enrollment code -> rejected, mfaEnabled stays false', async () => {
    cookieStore.clear();
    await loginPost(loginReq({ email: PRIV_EMAIL, password: PASSWORD }));
    await setupGet(setupReq());
    const req = new NextRequest('http://localhost/api/v1/auth/mfa/setup/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '000000' }),
    });
    const res = await activatePost(req);
    expect(res.status).toBe(401);
    const user = await db.user.findUniqueOrThrow({ where: { id: privUserId } });
    expect(user.mfaEnabled).toBe(false);
    expect(user.mfaSecretCiphertext).toBeNull();
  });

  it('correct enrollment code -> mfaEnabled true, secret encrypted, state single-use', async () => {
    cookieStore.clear();
    await loginPost(loginReq({ email: PRIV_EMAIL, password: PASSWORD }));
    const ch = await setupGet(setupReq());
    const { manual_key } = await ch.json();
    const code = authenticator.generate(manual_key as string);
    const req = new NextRequest('http://localhost/api/v1/auth/mfa/setup/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const res = await activatePost(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mfa_setup_completed).toBe(true);
    expect(body.user.email).toBe(PRIV_EMAIL);

    const user = await db.user.findUniqueOrThrow({ where: { id: privUserId } });
    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaSecretCiphertext).not.toBeNull();
    // Encrypted at rest: stored bytes decrypt to the enrolled secret.
    const stored = Buffer.from(user.mfaSecretCiphertext as Uint8Array);
    expect(stored.toString('utf8')).not.toContain(manual_key as string);
    expect(decryptString(stored, 1)).toBe(manual_key as string);

    // Setup cookie cleared by the handler.
    expect(cookieStore.has(SETUP_COOKIE)).toBe(false);

    // Replay with a forged/restored cookie is rejected (no session issued).
    cookieStore.set(SETUP_COOKIE, 'forged.value');
    const replay = new NextRequest('http://localhost/api/v1/auth/mfa/setup/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: authenticator.generate(manual_key as string) }),
    });
    const replayRes = await activatePost(replay);
    expect(replayRes.status).toBe(401);
  });

  it('privileged user WITH MFA gets the existing challenge flow', async () => {
    cookieStore.clear();
    const res = await loginPost(loginReq({ email: PRIV_EMAIL, password: PASSWORD }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mfa_required).toBe(true);
    expect(body.mfa_setup_required ?? false).toBe(false);
  });

  it('non-privileged user without MFA logs in normally', async () => {
    cookieStore.clear();
    const res = await loginPost(loginReq({ email: PLAIN_EMAIL, password: PASSWORD }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mfa_required).toBe(false);
    expect(body.mfa_setup_required ?? false).toBe(false);
    expect(body.user.email).toBe(PLAIN_EMAIL);
  });

  it('account lockout still applies after repeated bad passwords', async () => {
    const hash = await hashPassword(PASSWORD);
    const target = await db.user.create({
      data: {
        companyId, name: 'Lockout', email: 'mfa-lock-' + Date.now() + '@test.local',
        passwordHash: hash, accessScope: 'single_branch', mfaEnabled: false,
      },
    });
    try {
      for (let i = 0; i < 5; i++) {
        await loginPost(loginReq({ email: target.email, password: 'WrongPass1!' }));
      }
      const locked = await loginPost(loginReq({ email: target.email, password: 'WrongPass1!' }));
      expect([423, 401]).toContain(locked.status);
      const row = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(row.failedLoginCount).toBeGreaterThanOrEqual(5);
      expect(row.lockedUntil).not.toBeNull();
    } finally {
      await db.user.deleteMany({ where: { id: target.id } }).catch(() => undefined);
    }
  });
});

describe('login UI + seed contract (static)', () => {
  it('login page surfaces API errors accessibly and offers setup redirect', () => {
    const page = readFileSync('src/app/(auth)/login/page.tsx', 'utf8');
    expect(page).toContain('role="alert"');
    expect(page).toContain('mfa_setup_required');
    expect(page).toContain('/mfa/setup');
  });

  it('production login UI has no default credential hint', () => {
    const page = readFileSync('src/app/(auth)/login/page.tsx', 'utf8');
    expect(page).not.toContain('ChangeMe!2026');
    expect(page).not.toContain('Default platform admin');
    expect(page).not.toContain("useState('admin@erp-platform.local')");
  });

  it('setup page guides QR/manual-key/code without logging secrets', () => {
    const page = readFileSync('src/app/(auth)/mfa/setup/page.tsx', 'utf8');
    // Client-side QR from the otpauth URI; raw URI never displayed.
    expect(page).toContain('react-qr-code');
    expect(page).toContain('Scan this QR code');
    expect(page).toContain('Manual setup key');
    expect(page).toContain('Preparing QR code');
    expect(page).toContain('one-time-code');
    // The raw URI is never shown in a text field: every otpauthUrl reference
    // must be state plumbing, a guard, the startsWith check, or the local
    // QR encoder input — never an <Input> value.
    expect(page).not.toMatch(/<Input[^>]*otpauth/i);
    const refs = page.split('\n').filter((l) => l.includes('otpauthUrl'));
    expect(refs.length).toBeGreaterThan(0);
    for (const line of refs) {
      expect(line).toMatch(/useState|setOtpauthUrl|otpauthUrl &&|!otpauthUrl|startsWith|QRCode value/);
    }
    expect(page).not.toMatch(/console\.log/);
    // No external QR service may receive the secret.
    expect(page).not.toMatch(/api\.qrserver|qr-code.*http|https.*qr/i);
  });

  it('seed requires explicit password in production and never prints it', () => {
    const seed = readFileSync('scripts/seed.ts', 'utf8');
    expect(seed).toContain('PLATFORM_ADMIN_PASSWORD must be set in production');
    expect(seed).not.toContain('${adminPassword}');
  });

  it('login route issues enrollment state instead of a dead-end 403', () => {
    const route = readFileSync('src/app/api/v1/auth/login/route.ts', 'utf8');
    expect(route).toContain('mfa_setup_required');
    expect(route).toContain('issueEnrollment');
    expect(route).toContain('setMfaSetupCookie');
  });
});
