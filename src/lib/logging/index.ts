// src/lib/logging/index.ts
// Structured JSON logging with correlation_id per §7 rule 11.

import { getTenantContext } from '../db/transaction';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string; level: LogLevel; message: string;
  correlation_id?: string; company_id?: string; user_id?: string;
  environment: string; release: string; [key: string]: unknown;
}

const ENV = process.env.NODE_ENV ?? 'development';
const RELEASE = process.env.APP_VERSION ?? '0.1.0';

function shouldRedact(key: string): boolean {
  const sensitive = ['password', 'token', 'secret', 'pin', 'hash', 'pan', 'cvv'];
  return sensitive.some(s => key.toLowerCase().includes(s));
}

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (shouldRedact(key)) result[key] = '[REDACTED]';
    else if (typeof value === 'object' && value !== null && !Array.isArray(value))
      result[key] = redact(value as Record<string, unknown>);
    else result[key] = value;
  }
  return result;
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = { timestamp: new Date().toISOString(), level, message, environment: ENV, release: RELEASE };
  const ctx = getTenantContext();
  if (ctx) { entry.correlation_id = ctx.correlationId; entry.company_id = ctx.companyId; entry.user_id = ctx.userId; }
  if (meta) Object.assign(entry, redact(meta));
  if (ENV === 'production') process.stdout.write(JSON.stringify(entry) + '\n');
  else {
    const c = level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : level === 'info' ? '\x1b[36m' : '\x1b[90m';
    process.stdout.write(`${c}[${entry.timestamp}] ${level.toUpperCase()}\x1b[0m ${message}\n`);
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
