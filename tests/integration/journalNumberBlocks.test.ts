// F-46: journal entry numbers come from reserved blocks, not a row lock held
// until the posting commits. Disposable MariaDB.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { withTenant } from '@/lib/db/transaction';
import { nextJournalNumber, resetJournalNumberBlocks } from '@/lib/numbering';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const A: string = randomUUID();
const ctx = () => ({ companyId: A, branchIds: [], allBranches: true, isGlobal: false, userId: undefined, correlationId: randomUUID(), requestId: randomUUID() }) as never;
const YEAR = 2031;
const take = () => withTenant(ctx(), tx => nextJournalNumber(tx, { companyId: A, fiscalYear: YEAR, prefix: 'JE-' }));

beforeAll(async () => {
  await ensureSyntheticIssuerTenant(db, { companyId: A, label: 'JN', code: `SYN-JN-${A.slice(0, 8)}` });
  resetJournalNumberBlocks();
}, 120_000);
afterAll(() => db.$disconnect());

describe('journal numbers from reserved blocks', () => {
  it('issues unique numbers to concurrent postings without holding the sequence row', async () => {
    const numbers = await Promise.all(Array.from({ length: 60 }, () => take()));
    const issued = numbers.map(n => n.documentNumber);
    expect(new Set(issued).size).toBe(60);
    expect(issued.every(n => /^JE-\d{6}$/.test(n))).toBe(true);
    // Reserved in blocks: the sequence row moved by whole blocks, at least 60.
    const row = await db.documentSequence.findFirstOrThrow({ where: { companyId: A, documentType: 'JOURNAL', fiscalYear: YEAR } });
    expect(Number(row.nextNumber) - 1).toBeGreaterThanOrEqual(60);
    expect((Number(row.nextNumber) - 1) % 20).toBe(0);
  });

  it('keeps issuing while another transaction holds the sequence row open', async () => {
    resetJournalNumberBlocks();
    const first = await take(); // reserves a block
    // A long transaction locks the sequence row; the block in memory is unaffected.
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const holder = db.$transaction(async tx => {
      await tx.$executeRaw`SELECT id FROM document_sequences WHERE company_id = ${A} AND document_type = 'JOURNAL' AND fiscal_year = ${YEAR} FOR UPDATE`;
      await held;
    }, { timeout: 20_000 });
    const started = Date.now();
    const second = await take();
    expect(Date.now() - started).toBeLessThan(500);
    expect(second.documentNumber).not.toBe(first.documentNumber);
    release();
    await holder;
  });

  it('falls back to the in-transaction number when a block cannot be reserved', async () => {
    resetJournalNumberBlocks();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let locked!: () => void;
    const isLocked = new Promise<void>(resolve => { locked = resolve; });
    const holder = db.$transaction(async tx => {
      await tx.$executeRaw`SELECT id FROM document_sequences WHERE company_id = ${A} AND document_type = 'JOURNAL' AND fiscal_year = ${YEAR} FOR UPDATE`;
      locked();
      await held;
    }, { timeout: 20_000 });
    await isLocked;
    // The block reservation times out after about a second; the fallback then
    // waits for the row like the old path did, and gets it once released.
    const pending = take();
    setTimeout(() => release(), 1_500);
    const number = await pending;
    await holder;
    expect(number.documentNumber).toMatch(/^JE-\d{6}$/);
  }, 20_000);
});
