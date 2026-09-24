// F-54 / F-55 / F-11 regression: production must refuse to start with unsafe
// security configuration, and each control must hold at the point of use too.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  INSECURE_TEST_MODE_ACKNOWLEDGEMENT,
  assertProductionSecurityConfig,
  jwtSecretProblem,
  productionSecurityProblems,
  resolveWebAuthnConfig,
} from '@/lib/config/productionGuards';

const STRONG = randomBytes(48).toString('base64');

/** A production environment that passes every check; tests break one thing at a time. */
function goodProduction(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: STRONG,
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BARCODE_SIGNING_KEY: randomBytes(32).toString('hex'),
    WEBAUTHN_RP_ID: 'erp.example.com',
    WEBAUTHN_ORIGIN: 'https://erp.example.com',
    ...overrides,
  };
}

describe('the baseline is accepted', () => {
  it('passes a correctly configured production environment', () => {
    expect(productionSecurityProblems(goodProduction())).toEqual([]);
    expect(() => assertProductionSecurityConfig(goodProduction())).not.toThrow();
  });

  it('does not apply production rules outside production', () => {
    expect(productionSecurityProblems({ NODE_ENV: 'development' })).toEqual([]);
    expect(productionSecurityProblems({ NODE_ENV: 'test', E2E_TESTING: 'true' })).toEqual([]);
  });
});

describe('F-55: the token-signing key', () => {
  it.each([
    ['unset', undefined],
    ['the bare word', 'secret'],
    ['short', 'abc123def456'],
    ['31 characters', 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p'],
    ['repetitive', 'ab'.repeat(40)],
    ['a placeholder', 'GENERATE_WITH_OPENSSL_RAND_BASE64_48'],
    ['the development fallback', 'sandbox-dev-secret-override-in-prod'],
  ])('refuses a key that is %s', (_label, secret) => {
    expect(jwtSecretProblem(secret)).not.toBeNull();
  });

  it('refuses the key published in .env.production.example', () => {
    // The committed example contained a real-looking key. Anyone who copied the
    // example unchanged would be running on a public signing key.
    const published = 'sIsd6PEtTE0LZUDESx1j8Gw6jzn0m7DMH+FPJg2uHlYln4tLhqrPzMAhZUAXmO5A';
    expect(jwtSecretProblem(published)).toMatch(/public/);
  });

  it('accepts a random 48-byte key', () => {
    expect(jwtSecretProblem(STRONG)).toBeNull();
  });

  it('refuses to sign in production with a weak key, not just at boot', async () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, { NODE_ENV: 'production', JWT_SECRET: 'secret' });
      const { issueAccessToken } = await import('@/lib/auth/jwt');
      await expect(issueAccessToken({
        sub: 'u', company_id: 'c', scope: 'branch', is_global: false,
        branch_ids: [], session_id: 's', family_id: 'f', mfa_verified: true,
      })).rejects.toThrow(/JWT_SECRET/);
    } finally {
      process.env = saved;
    }
  });
});

describe('F-54: the WebAuthn relying party', () => {
  it('refuses to start in production without either value', () => {
    const problems = productionSecurityProblems(goodProduction({ WEBAUTHN_RP_ID: undefined, WEBAUTHN_ORIGIN: undefined }));
    expect(problems.join('\n')).toMatch(/WEBAUTHN_RP_ID is not set/);
    expect(problems.join('\n')).toMatch(/WEBAUTHN_ORIGIN is not set/);
  });

  it('never falls back to localhost in production', () => {
    const { config } = resolveWebAuthnConfig({ NODE_ENV: 'production' });
    // The old code returned 'localhost' and 'http://localhost:3000' here.
    expect(config.rpId).not.toBe('localhost');
    expect(config.origin).not.toMatch(/localhost/);
  });

  it('still defaults to localhost for development', () => {
    expect(resolveWebAuthnConfig({ NODE_ENV: 'development' })).toEqual({
      config: { rpId: 'localhost', origin: 'http://localhost:3000' }, problems: [],
    });
  });

  it.each([
    ['plain http', { WEBAUTHN_ORIGIN: 'http://erp.example.com' }, /https/],
    ['a localhost origin', { WEBAUTHN_ORIGIN: 'https://localhost', WEBAUTHN_RP_ID: 'localhost' }, /localhost/],
    ['an RP ID unrelated to the origin', { WEBAUTHN_RP_ID: 'other.com' }, /not the origin's host/],
    ['an origin with a path', { WEBAUTHN_ORIGIN: 'https://erp.example.com/app' }, /origin/],
  ])('refuses %s', (_label, overrides, pattern) => {
    expect(productionSecurityProblems(goodProduction(overrides)).join('\n')).toMatch(pattern);
  });

  it('accepts a parent domain as the RP ID', () => {
    expect(productionSecurityProblems(goodProduction({ WEBAUTHN_RP_ID: 'example.com' }))).toEqual([]);
  });
});

describe('F-58: keys that used to fall back to public constants', () => {
  it.each(['APP_ENCRYPTION_KEY', 'BARCODE_SIGNING_KEY'])('refuses to start without %s', name => {
    expect(productionSecurityProblems(goodProduction({ [name]: undefined })).join('\n'))
      .toMatch(new RegExp(`${name} is not set`));
  });

  it.each([
    ['APP_ENCRYPTION_KEY', 'sandbox-default-key-please-override-in-production'],
    ['BARCODE_SIGNING_KEY', 'sandbox-barcode-key-override-in-prod'],
    ['BARCODE_SIGNING_KEY', 'sandbox-signing-key-override'],
  ])('refuses %s set to its own development fallback', (name, fallback) => {
    expect(productionSecurityProblems(goodProduction({ [name]: fallback })).join('\n')).toMatch(/public/);
  });

  it('refuses the MinIO default once a bucket is configured', () => {
    const problems = productionSecurityProblems(goodProduction({
      S3_BUCKET: 'erp-docs', S3_ACCESS_KEY: 'minioadmin', S3_SECRET_KEY: 'minioadmin',
    }));
    expect(problems.join('\n')).toMatch(/S3_ACCESS_KEY/);
    expect(problems.join('\n')).toMatch(/S3_SECRET_KEY/);
  });

  it('does not require S3 credentials when no bucket is configured', () => {
    expect(productionSecurityProblems(goodProduction())).toEqual([]);
  });

  it('refuses to encrypt in production without the key, at the point of use', async () => {
    const saved = { ...process.env };
    try {
      vi.resetModules();
      process.env = { ...saved, NODE_ENV: 'production' } as NodeJS.ProcessEnv;
      delete process.env.APP_ENCRYPTION_KEY;
      const { encrypt } = await import('@/lib/crypto');
      // Previously this encrypted MFA seeds under a constant in the source.
      expect(() => encrypt('totp-seed')).toThrow(/APP_ENCRYPTION_KEY/);
    } finally {
      process.env = saved;
      vi.resetModules();
    }
  });

  it('uses one signing key for barcodes and the offline catalogue', async () => {
    const { readFileSync } = await import('node:fs');
    const bootstrap = readFileSync('src/app/api/v1/offline/bootstrap/route.ts', 'utf8');
    // The two sites used different fallbacks, so they could disagree.
    expect(bootstrap).toMatch(/barcodeSigningKey\(\)/);
    expect(bootstrap).not.toMatch(/BARCODE_SIGNING_KEY \?\?/);
  });
});

describe('F-11: test-mode bypasses in production', () => {
  it.each(['E2E_TESTING', 'DISABLE_SECURE_COOKIES'])('refuses %s=true on its own', name => {
    expect(productionSecurityProblems(goodProduction({ [name]: 'true' })).join('\n')).toMatch(name);
  });

  it('allows them only with the explicit acknowledgement the e2e scripts set', () => {
    expect(productionSecurityProblems(goodProduction({
      E2E_TESTING: 'true', ERP_ALLOW_INSECURE_TEST_MODE: INSECURE_TEST_MODE_ACKNOWLEDGEMENT,
    }))).toEqual([]);
  });

  it('is not satisfied by a merely truthy acknowledgement', () => {
    expect(productionSecurityProblems(goodProduction({
      E2E_TESTING: 'true', ERP_ALLOW_INSECURE_TEST_MODE: 'true',
    }))).not.toEqual([]);
  });
});

describe('other published secrets', () => {
  it('reports every problem at once so it can be fixed in one pass', () => {
    const problems = productionSecurityProblems(goodProduction({
      JWT_SECRET: 'secret', WEBAUTHN_ORIGIN: undefined, E2E_TESTING: 'true',
    }));
    expect(problems.length).toBeGreaterThanOrEqual(3);
    expect(() => assertProductionSecurityConfig(goodProduction({ JWT_SECRET: 'secret' })))
      .toThrow(/Refusing to start/);
  });
});

describe('F-11: cookie flags follow the guard', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; vi.resetModules(); });

  async function cookieOptions(env: Record<string, string | undefined>) {
    vi.resetModules();
    vi.doMock('next/headers', () => ({ cookies: async () => ({ set: () => undefined }) }));
    process.env = { ...saved, ...env } as NodeJS.ProcessEnv;
    for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key];
    const { setMfaSetupCookie } = await import('@/lib/auth/sessions');
    return (await setMfaSetupCookie('probe')).options;
  }

  it('keeps Secure and SameSite=Strict in production when only E2E_TESTING is set', async () => {
    // Previously this one variable stripped Secure and downgraded SameSite.
    const options = await cookieOptions({ NODE_ENV: 'production', E2E_TESTING: 'true', ERP_ALLOW_INSECURE_TEST_MODE: undefined });
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe('strict');
  });

  it('keeps them with DISABLE_SECURE_COOKIES alone too', async () => {
    const options = await cookieOptions({ NODE_ENV: 'production', DISABLE_SECURE_COOKIES: 'true', ERP_ALLOW_INSECURE_TEST_MODE: undefined });
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe('strict');
  });

  it('relaxes them only with the explicit acknowledgement', async () => {
    const options = await cookieOptions({
      NODE_ENV: 'production', E2E_TESTING: 'true', ERP_ALLOW_INSECURE_TEST_MODE: INSECURE_TEST_MODE_ACKNOWLEDGEMENT,
    });
    expect(options.secure).toBe(false);
    expect(options.sameSite).toBe('lax');
  });
});
