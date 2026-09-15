// Local-only UI verification. Never loads .env or targets an existing server.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = join(root, '.local', 'ui-health-snapshot.json');
const mode = process.argv[2];
const suite = process.argv[3] ?? 'health';
if (!['health', 'access', 'modules'].includes(suite)) throw new Error('Unknown local verification suite');
if (!['build', 'e2e'].includes(mode)) throw new Error('Expected build or e2e');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\))$/i.test(key)));
const target = new URL('mysql://127.0.0.1:43318/readiness_20260912_disposable');
target.username = 'root';
Object.assign(env, { NODE_ENV: 'production', DATABASE_URL: target.toString(), JWT_SECRET: randomBytes(32).toString('hex'),
  APP_ENCRYPTION_KEY: randomBytes(32).toString('hex'), NEXT_TELEMETRY_DISABLED: '1', DISABLE_S3_HEALTH: 'true',
  E2E_BASE_URL: `http://127.0.0.1:${process.env.UI_HEALTH_PORT ?? '43300'}`, UI_HEALTH_LOCAL_VERIFICATION: '1' });
const verificationPort = Number(process.env.UI_HEALTH_PORT ?? '43300');
console.log('Database environment: LOCAL / DISPOSABLE; Host: 127.0.0.1; Port: 43318; Database name: readiness_20260912_disposable');

function execute(args, cwd) {
  return new Promise(resolveExit => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.on('error', () => resolveExit(1)); child.on('exit', code => resolveExit(code ?? 1));
  });
}
function applicationFingerprint(directory) {
  const hash = createHash('sha256');
  function visit(relative) {
    const path = join(directory, relative);
    if (!existsSync(path) || /(?:^|[\\/])\.env(?:[.\\/]|$)|\.(?:db|sqlite|sqlite3)(?:[-.]|$)/i.test(path)) return;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(relative, name));
    } else { hash.update(relative); hash.update('\0'); hash.update(readFileSync(path)); hash.update('\0'); }
  }
  // Exclude Next-generated next-env/tsconfig files. Include all authored runtime
  // inputs so a successful stale build cannot masquerade as current-source E2E.
  for (const input of ['src', 'public', 'prisma', 'package.json', 'next.config.ts', 'postcss.config.mjs', 'tailwind.config.ts',
    'components.json', 'sentry.client.config.ts', 'sentry.server.config.ts', 'sentry.edge.config.ts']) visit(input);
  return hash.digest('hex');
}
if (mode === 'build') {
  mkdirSync(join(root, '.local'), { recursive: true });
  const snapshot = mkdtempSync(join(root, '.local', 'ui-health-app-'));
  const inputs = ['src', 'public', 'prisma', 'package.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.ts',
    'postcss.config.mjs', 'tailwind.config.ts', 'components.json', 'sentry.client.config.ts', 'sentry.server.config.ts', 'sentry.edge.config.ts'];
  for (const input of inputs) if (existsSync(join(root, input))) cpSync(join(root, input), join(snapshot, input), {
    recursive: true,
    filter: source => !/(?:^|[\\/])\.env(?:[.\\/]|$)|\.(?:db|sqlite|sqlite3)(?:[-.]|$)/i.test(source),
  });
  symlinkSync(join(root, 'node_modules'), join(snapshot, 'node_modules'), 'junction');
  // Reuse only webpack's content-validated cache, never old source or build output.
  if (existsSync(state)) {
    const previous = JSON.parse(readFileSync(state, 'utf8'));
    if (typeof previous.snapshot === 'string' && resolve(previous.snapshot).startsWith(join(root, '.local', 'ui-health-app-'))
      && existsSync(join(previous.snapshot, '.next', 'cache', 'webpack'))) {
      cpSync(join(previous.snapshot, '.next', 'cache', 'webpack'), join(snapshot, '.next', 'cache', 'webpack'), { recursive: true });
    }
  }
  mkdirSync(dirname(state), { recursive: true });
  writeFileSync(state, JSON.stringify({ snapshot, buildPassed: false }));
  const code = await execute([join(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], snapshot);
  writeFileSync(state, JSON.stringify({ snapshot, buildPassed: code === 0 }));
  process.exitCode = code;
} else {
  const saved = JSON.parse(readFileSync(state, 'utf8'));
  if (!saved.buildPassed || !resolve(saved.snapshot).startsWith(join(root, '.local', 'ui-health-app-'))) throw new Error('Successful isolated build required');
  if (applicationFingerprint(root) !== applicationFingerprint(saved.snapshot)) throw new Error('Application changed since build; rebuild before E2E');
  await new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.once('error', () => rejectPort(new Error('Verification port already in use; refusing to reuse server')));
    probe.listen(verificationPort, '127.0.0.1', () => probe.close(resolvePort));
  });
  const server = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(verificationPort), '-H', '127.0.0.1'],
    { cwd: saved.snapshot, env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (server.exitCode !== null) throw new Error('Local verification server could not start');
      try { ready = (await fetch(`${env.E2E_BASE_URL}/login`)).ok; } catch { /* wait for our process */ }
      if (ready) break;
      await new Promise(resolveWait => setTimeout(resolveWait, 500));
    }
    if (!ready) throw new Error('Local verification server readiness timeout');
    process.exitCode = await execute([join(root, 'node_modules/@playwright/test/cli.js'), 'test',
      `--config=${suite === 'access' ? 'playwright.access.config.ts' : suite === 'modules' ? 'playwright.module-smoke.config.ts' : 'playwright.ui-health.config.ts'}`], root);
  } finally { server.kill(); }
}
