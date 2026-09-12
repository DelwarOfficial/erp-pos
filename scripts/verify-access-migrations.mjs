// Disposable MariaDB proof only. No production environment files are loaded.
import { PrismaClient } from '@prisma/client';
import { cpSync, mkdtempSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = new URL('mysql://127.0.0.1:43318/readiness_20260912_disposable'); base.username = 'root';
const db = new PrismaClient({ datasources: { db: { url: base.toString() } }, log: [] });
const name = `access_fresh_${Date.now()}`;
if (!/^access_fresh_\d+$/.test(name)) throw new Error('Disposable database name required');
console.log(`Database environment: LOCAL / DISPOSABLE; Host: 127.0.0.1; Port: 43318; Database name: ${name}`);
try {
  const versions = await db.$queryRaw`SELECT VERSION() AS version`;
  if (!versions[0].version.startsWith('11.8.')) throw new Error('MariaDB 11.8 required');
  await db.$executeRawUnsafe(`CREATE DATABASE ${name} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
} finally { await db.$disconnect(); }
mkdirSync(join(root, '.local'), { recursive: true });
const work = mkdtempSync(join(root, '.local', 'access-migration-'));
cpSync(join(root, 'prisma/mariadb/schema.prisma'), join(work, 'schema.prisma'));
cpSync(join(root, 'prisma/mariadb/migrations'), join(work, 'migrations'), { recursive: true });
base.pathname = `/${name}`;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMDATA)$/i.test(key)));
Object.assign(env, { DATABASE_URL: base.toString(), CHECKPOINT_DISABLE: '1' });
async function command(args) {
  const code = await new Promise(resolveExit => {
    const child = spawn(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), ...args, '--schema=schema.prisma'],
      { cwd: work, env, windowsHide: true, stdio: 'inherit' });
    child.on('error', () => resolveExit(1)); child.on('exit', code => resolveExit(code ?? 1));
  });
  if (code) throw new Error('Disposable migration verification failed');
}
await command(['validate']);
await command(['migrate', 'deploy']);
await command(['migrate', 'deploy']);
console.log('Fresh MariaDB migration and repeat deploy: PASS');
