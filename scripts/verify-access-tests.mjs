// Run the full suite with synthetic local data and no inherited application secrets.
import { cpSync, existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, '.local'), { recursive: true });
const work = mkdtempSync(join(root, '.local', 'access-tests-'));
for (const input of ['src', 'tests', 'prisma', 'scripts', 'package.json', 'tsconfig.json', 'vitest.config.ts', 'next.config.ts']) {
  if (existsSync(join(root, input))) cpSync(join(root, input), join(work, input), { recursive: true,
    filter: path => !/(?:^|[\\/])\.env(?:[.\\/]|$)|\.(?:db|sqlite|sqlite3)(?:[-.]|$)/i.test(path) });
}
symlinkSync(join(root, 'node_modules'), join(work, 'node_modules'), 'junction');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMDATA)$/i.test(key)));
const target = new URL('mysql://127.0.0.1:43318/readiness_20260912_disposable'); target.username = 'root';
Object.assign(env, { DATABASE_URL: target.toString(), NODE_ENV: 'test', JWT_SECRET: randomBytes(32).toString('hex'),
  APP_ENCRYPTION_KEY: randomBytes(32).toString('hex'), DISABLE_S3_HEALTH: 'true' });
console.log('Database environment: LOCAL / DISPOSABLE; Host: 127.0.0.1; Port: 43318; Database name: readiness_20260912_disposable');
const code = await new Promise(resolveExit => {
  const child = spawn(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--maxWorkers=1', '--no-file-parallelism', '--reporter=dot'],
    { cwd: work, env, windowsHide: true, stdio: 'inherit' });
  child.on('error', () => resolveExit(1)); child.on('exit', code => resolveExit(code ?? 1));
});
process.exitCode = code;
