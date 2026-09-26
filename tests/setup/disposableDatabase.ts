// Fail-closed database guard for the whole Vitest suite.
//
// Integration suites commit real rows, and several unit suites construct a
// PrismaClient. Only some files checked the target themselves, and a plain
// `vitest run` from the repository root would let Prisma read DATABASE_URL from
// a local .env -- whatever database that names, production included.
//
// This runs before every test file (vitest.config.ts setupFiles). Unless
// DATABASE_URL names the approved local disposable MariaDB, the run stops
// before a single test executes. Because DATABASE_URL is then set in the
// process environment, Prisma uses it and never falls back to a .env file.
//
// The approved target is the one scripts/verify-access-tests.mjs provides.
// Change it there and here together; never widen it to accept remote hosts.

export const APPROVED_TEST_DATABASE = {
  protocol: 'mysql:',
  hosts: ['127.0.0.1', 'localhost', '[::1]'],
  port: '43318',
  database: 'readiness_20260912_disposable',
} as const;

export function assertDisposableDatabaseUrl(value: string | undefined): URL {
  if (!value) throw new Error('TEST_DATABASE_REFUSED: DATABASE_URL is not set. Run the suite with `node scripts/verify-access-tests.mjs`.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_REFUSED: DATABASE_URL is not a valid URL.');
  }
  // Report where it points, never the credentials.
  const where = `${url.protocol}//${url.hostname}:${url.port || '(default)'}${url.pathname}`;
  const ok = url.protocol === APPROVED_TEST_DATABASE.protocol
    && (APPROVED_TEST_DATABASE.hosts as readonly string[]).includes(url.hostname)
    && url.port === APPROVED_TEST_DATABASE.port
    && url.pathname === `/${APPROVED_TEST_DATABASE.database}`;
  if (!ok) throw new Error(`TEST_DATABASE_REFUSED: ${where} is not the approved local disposable MariaDB.`);
  return url;
}

assertDisposableDatabaseUrl(process.env.DATABASE_URL);
