// Security configuration that must be right before the server accepts a request.
//
// Several controls depended on environment variables with permissive or
// unchecked defaults, so a production deployment could start in a weakened
// state and say nothing:
//
//   F-54  WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN defaulted to 'localhost' and
//         'http://localhost:3000' with no production guard. Passkeys then never
//         worked on the real domain, and the origin binding that makes WebAuthn
//         phishing-resistant was set to a value wrong everywhere but a laptop.
//   F-55  JWT_SECRET was required in production but never checked. It is the
//         HS256 key for every access token, so `JWT_SECRET=secret` made tokens
//         forgeable offline from one captured cookie -- any company_id, any user.
//   F-11  E2E_TESTING or DISABLE_SECURE_COOKIES in the production environment
//         stripped the Secure flag, downgraded SameSite to lax and (E2E_TESTING)
//         bypassed mandatory MFA, from one variable nobody was prompted to check.
//   F-58  APP_ENCRYPTION_KEY, BARCODE_SIGNING_KEY and the S3 credentials fell
//         back to hard-coded values when unset. APP_ENCRYPTION_KEY encrypts
//         every MFA seed and webhook secret; BARCODE_SIGNING_KEY signs QR
//         payloads and the offline catalogue. An unset variable meant a public
//         key, silently.
//
// The checks are pure functions over an environment object so they can be
// tested without mutating process.env, and they collect every problem before
// failing so an operator fixes the configuration in one pass.

import { createHash } from 'node:crypto';

type Env = Record<string, string | undefined>;

const MIN_SECRET_LENGTH = 32;
const MIN_DISTINCT_CHARACTERS = 10;

/**
 * SHA-256 of values that have been published and so can never be secret:
 * the key material committed in .env.production.example (commit 4a7730f),
 * and the development fallback in jwt.ts. Only the hashes live here, so this
 * list does not itself republish them.
 */
const PUBLISHED_SECRET_HASHES: Record<string, string> = {
  '98c15a5e687b7992390384c05d28f2ad1442276445a1cc10151b2deddde5fdc8': 'JWT_SECRET from .env.production.example',
  '1582624464459bdc59ac9d9b68b94c585edd90788d40dda78f9e4b4ddcca92fe': 'APP_ENCRYPTION_KEY from .env.production.example',
  '2346402589163c710799b94cae5a019bad923e2cd49291fbc7b5867e0ee44a5d': 'BARCODE_SIGNING_KEY from .env.production.example',
  'ed3984a8738c622087938c65773af7714ff0ace8239155006359d29b999f6985': 'COURIER_WEBHOOK_TOKEN from .env.production.example',
  '5da0c7c819d23760b97564690a4a2bb7caada4565c005115eda7cfbddbc087b7': 'CRON_API_TOKEN from .env.production.example',
  '8830995c032f5273c155e5961d2b90b0148bbdb732499622e0481bd56b56fb53': 'the development fallback in src/lib/auth/jwt.ts',
  '523d0c34c4e49fe8770474d8fe58ddf9b5f814fd8513605885942dc0a4c53aff': 'the development fallback in src/lib/crypto/index.ts',
  '7343c4d49f4729045775cbb89cb2703a8360e4ba6badaadc0d9271a666e04e09': 'the development fallback in the offline bootstrap route',
  '503fc3fa7ff89e266340d9270350cc7b9dfe54f2a66a2f6a0e4b1ee3eac0934b': 'the development fallback in src/domain/invariants/barcode.ts',
  'ad9858116e63b0c5a4d7dc7f50f034c7247e56838dae22c1832712ffde48e694': 'the MinIO default credential',
};

const PLACEHOLDER = /change[_-]?me|your[_-]|example|placeholder|generate[_-]with|replace[_-]?me|^secret$|^password$|^test$/i;

const SECRETS_CHECKED_FOR_PUBLICATION = [
  'JWT_SECRET', 'APP_ENCRYPTION_KEY', 'BARCODE_SIGNING_KEY', 'COURIER_WEBHOOK_TOKEN', 'CRON_API_TOKEN',
] as const;

/** The explicit second switch required to run the test-mode bypasses on a production build. */
export const INSECURE_TEST_MODE_ACKNOWLEDGEMENT = 'i-understand-this-disables-security-controls';

export function isProduction(env: Env): boolean {
  return env.NODE_ENV === 'production';
}

function publishedAs(value: string): string | undefined {
  return PUBLISHED_SECRET_HASHES[createHash('sha256').update(value).digest('hex')];
}

/** Why this value is unacceptable as a secret key, or null if it is acceptable. */
export function secretProblem(name: string, secret: string | undefined): string | null {
  if (!secret) return `${name} is not set`;
  const published = publishedAs(secret);
  if (published) return `${name} is ${published}, which is public; generate a new one`;
  if (PLACEHOLDER.test(secret)) return `${name} is a placeholder value`;
  if (secret.length < MIN_SECRET_LENGTH) {
    return `${name} is ${secret.length} characters; at least ${MIN_SECRET_LENGTH} are required`;
  }
  // Long but repetitive -- 'aaaa…', '12341234…' -- is still guessable.
  if (new Set(secret).size < MIN_DISTINCT_CHARACTERS) {
    return `${name} has too little variety to be a random key; generate one with \`openssl rand -base64 48\``;
  }
  return null;
}

/** Why this value is unacceptable as the token-signing key, or null if it is acceptable. */
export function jwtSecretProblem(secret: string | undefined): string | null {
  return secretProblem('JWT_SECRET', secret);
}

/** Keys that must be present and strong in production, and what each protects. */
const REQUIRED_PRODUCTION_SECRETS = ['JWT_SECRET', 'APP_ENCRYPTION_KEY', 'BARCODE_SIGNING_KEY'] as const;

export interface WebAuthnConfig {
  rpId: string;
  origin: string;
}

/**
 * The relying-party configuration. Outside production an unset value falls back
 * to localhost for development; in production an unset or inconsistent value
 * is an error, never a silent default.
 */
export function resolveWebAuthnConfig(env: Env): { config: WebAuthnConfig; problems: string[] } {
  const production = isProduction(env);
  const problems: string[] = [];
  const rpId = env.WEBAUTHN_RP_ID ?? (production ? '' : 'localhost');
  const origin = env.WEBAUTHN_ORIGIN ?? (production ? '' : 'http://localhost:3000');

  if (production) {
    if (!env.WEBAUTHN_RP_ID) problems.push('WEBAUTHN_RP_ID is not set');
    if (!env.WEBAUTHN_ORIGIN) problems.push('WEBAUTHN_ORIGIN is not set');
  }

  if (origin) {
    let host: string | undefined;
    try {
      const url = new URL(origin);
      host = url.hostname;
      if (production && url.protocol !== 'https:') problems.push('WEBAUTHN_ORIGIN must use https in production');
      if (url.pathname !== '/' || url.search || url.hash) {
        problems.push('WEBAUTHN_ORIGIN must be an origin (scheme, host and port only), not a URL with a path');
      }
    } catch {
      problems.push('WEBAUTHN_ORIGIN is not a valid URL');
    }
    if (production && host && /^(localhost|127\.|\[?::1\]?$)/i.test(host)) {
      problems.push('WEBAUTHN_ORIGIN points at localhost in production');
    }
    // The browser only accepts an RP ID equal to the origin's host or one of
    // its registrable parents; anything else makes every ceremony fail.
    if (host && rpId && host !== rpId && !host.endsWith(`.${rpId}`)) {
      problems.push(`WEBAUTHN_RP_ID "${rpId}" is not the origin's host "${host}" or a parent domain of it`);
    }
  }

  return { config: { rpId, origin }, problems };
}

/** True when the test-mode bypasses are explicitly and deliberately enabled. */
export function insecureTestModeAcknowledged(env: Env): boolean {
  return env.ERP_ALLOW_INSECURE_TEST_MODE === INSECURE_TEST_MODE_ACKNOWLEDGEMENT;
}

/** Every production security misconfiguration found, in one list. */
export function productionSecurityProblems(env: Env): string[] {
  if (!isProduction(env)) return [];
  const problems: string[] = [];

  for (const name of REQUIRED_PRODUCTION_SECRETS) {
    const problem = secretProblem(name, env[name]);
    if (problem) problems.push(problem);
  }

  // Optional integration tokens: absent is fine, published is not.
  for (const name of SECRETS_CHECKED_FOR_PUBLICATION) {
    if ((REQUIRED_PRODUCTION_SECRETS as readonly string[]).includes(name)) continue;
    const value = env[name];
    const published = value ? publishedAs(value) : undefined;
    if (published) problems.push(`${name} is ${published}, which is public; generate a new one`);
  }

  // Object storage is optional, but once a bucket is configured its credentials
  // must be real: they used to fall back to the MinIO default 'minioadmin'.
  if (env.S3_BUCKET) {
    for (const name of ['S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
      const value = env[name];
      if (!value) problems.push(`${name} is not set but S3_BUCKET is`);
      else if (publishedAs(value) || PLACEHOLDER.test(value)) problems.push(`${name} is a default or placeholder value`);
    }
  }

  problems.push(...resolveWebAuthnConfig(env).problems);

  // One of these alone used to disable Secure cookies, SameSite=Strict and
  // mandatory MFA. The e2e scripts legitimately need them against a production
  // build, so they are allowed only alongside a second, unmistakable switch.
  for (const name of ['E2E_TESTING', 'DISABLE_SECURE_COOKIES'] as const) {
    if (env[name] === 'true' && !insecureTestModeAcknowledged(env)) {
      problems.push(`${name}=true disables security controls and is refused in production `
        + `unless ERP_ALLOW_INSECURE_TEST_MODE=${INSECURE_TEST_MODE_ACKNOWLEDGEMENT} is also set`);
    }
  }

  return problems;
}

/** Throws, listing every problem, if production security configuration is unsafe. */
export function assertProductionSecurityConfig(env: Env = process.env): void {
  const problems = productionSecurityProblems(env);
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start: production security configuration is unsafe.\n  - ${problems.join('\n  - ')}`,
    );
  }
}
