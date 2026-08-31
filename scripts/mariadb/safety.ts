import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';

export function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('end', resolve).on('error', reject);
  });
  return hash.digest('hex');
}

export async function verifiedSourceCopy(): Promise<{ path: string; sha256: string }> {
  const source = option('--source-copy');
  const expected = option('--source-sha256')?.toLowerCase();
  if (!source || !expected || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error('Require --source-copy and --source-sha256=<64 lowercase hex characters>');
  }
  const resolved = path.resolve(source);
  if (path.basename(resolved).toLowerCase() === 'prod.db') {
    throw new Error('Refusing direct prisma/prod.db access; provide a verified copy');
  }
  const actual = await sha256File(resolved);
  if (actual !== expected) throw new Error('SOURCE_COPY_SHA256_MISMATCH');
  return { path: resolved, sha256: actual };
}

export function verifiedDryRunUrl(): { url: string; database: string } {
  const raw = process.env.MARIADB_DRYRUN_URL;
  if (!raw) throw new Error('MARIADB_DRYRUN_URL is required');
  const parsed = new URL(raw);
  if (!['mysql:', 'mariadb:', 'mysql2:'].includes(parsed.protocol)) throw new Error('Dry-run URL must use MySQL/MariaDB');
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const normalized = database.toLowerCase();
  if (!normalized || normalized === 'rangpurt_erp' || normalized.endsWith('_rangpurt_erp') || !normalized.includes('dryrun')) {
    throw new Error('Refusing non-dry-run database target');
  }
  return { url: raw, database };
}

export function safeError(error: unknown): { code?: string; message: string } {
  const candidate = error as { code?: string; message?: string };
  return {
    code: candidate?.code,
    message: (candidate?.message ?? 'Unknown database error')
      .replace(/(mysql|mariadb):\/\/[^\s@]+@/gi, '$1://[REDACTED]@')
      .slice(0, 300),
  };
}
