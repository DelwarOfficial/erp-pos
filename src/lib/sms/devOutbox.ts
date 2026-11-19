// Development-only SMS "gateway": instead of sending, it appends each message
// to .local/sms-outbox.jsonl (git-ignored), so a developer or a browser test
// on this machine can read a code that a real phone would have received.
//
// Never used in production: transactionalSmsGateway() returns it only when
// NODE_ENV is not 'production'. Nothing is printed to the console.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { SmsGateway, SmsSendOutcome, SmsSendRequest } from './gateway';

const OUTBOX = join(process.cwd(), '.local', 'sms-outbox.jsonl');

export class DevOutboxSmsGateway implements SmsGateway {
  readonly providerCode = 'dev-outbox';
  async send(request: SmsSendRequest): Promise<SmsSendOutcome> {
    if (process.env.NODE_ENV === 'production') return { kind: 'permanent', code: 'DEV_OUTBOX_IN_PRODUCTION', raw: '' };
    mkdirSync(join(process.cwd(), '.local'), { recursive: true });
    const id = randomUUID();
    appendFileSync(OUTBOX, JSON.stringify({ id, to: request.to, text: request.text, at: new Date().toISOString() }) + '\n');
    return { kind: 'accepted', providerMessageId: id, raw: '' };
  }
}

/** The last message written for a number (tests and local use only). */
export function lastDevMessage(to: string): { text: string; at: string } | null {
  try {
    const lines = readFileSync(OUTBOX, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { to: string; text: string; at: string });
    return lines.filter(l => l.to === to).pop() ?? null;
  } catch { return null; }
}
