// Real-browser checks in an isolated source snapshot and the approved disposable DB.
// Never inherit application secrets or load the workspace .env.
import { cpSync, existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 43305;
await new Promise((done, fail) => {
  const probe = createServer(); probe.once('error', fail);
  probe.listen(port, '127.0.0.1', () => probe.close(done));
});
mkdirSync(join(root, '.local'), { recursive: true });
const snapshot = mkdtempSync(join(root, '.local', 'workflow-browser-'));
for (const name of ['src', 'public', 'prisma', 'package.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.ts', 'postcss.config.mjs',
  'instrumentation.ts', 'instrumentation-client.ts', 'sentry.client.config.ts', 'sentry.server.config.ts', 'sentry.edge.config.ts']) {
  if (existsSync(join(root, name))) cpSync(join(root, name), join(snapshot, name), { recursive: true,
    filter: source => !/(?:^|[\\/])\.env(?:[.\\/]|$)|\.(?:db|sqlite|sqlite3)(?:[-.]|$)/i.test(source) });
}
symlinkSync(join(root, 'node_modules'), join(snapshot, 'node_modules'), 'junction');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\))$/i.test(key)));
Object.assign(env, { NODE_ENV: 'development', DATABASE_URL: 'mysql://root@127.0.0.1:43318/readiness_20260912_disposable',
  JWT_SECRET: randomBytes(32).toString('hex'), APP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  NEXT_TELEMETRY_DISABLED: '1', DISABLE_S3_HEALTH: 'true', UI_HEALTH_LOCAL_VERIFICATION: '1', E2E_BASE_URL: `http://127.0.0.1:${port}` });
console.log('Real browser / disposable database / isolated snapshot:', snapshot);
const server = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '-H', '127.0.0.1', '-p', String(port)],
  { cwd: snapshot, env, windowsHide: true, stdio: 'inherit' });
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error('Preview process exited');
    try { const response = await fetch(`${env.E2E_BASE_URL}/api/v1/health`, { signal: AbortSignal.timeout(3000) }); ready = [200, 503].includes(response.status); } catch { /* startup */ }
    if (ready) break;
    await new Promise(done => setTimeout(done, 500));
  }
  if (!ready) throw new Error('Preview readiness timeout');
  process.exitCode = await new Promise(done => {
    const test = spawn(process.execPath, [join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config=playwright.workflows.config.ts', ...process.argv.slice(2)],
      { cwd: root, env, windowsHide: true, stdio: 'inherit' });
    test.on('error', () => done(1)); test.on('exit', code => done(code ?? 1));
  });
} finally { server.kill(); }
