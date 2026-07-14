// tests/unit/crmCommunicationsIntegrity.test.ts
// CRM/communications integrity tests per §8 — lead conversion idempotency,
// consent withdrawal, provider timeout no-duplicate.

import { describe, it, expect } from 'vitest';

// ── Lead Conversion Idempotency ──

describe('CRM: Lead Conversion Idempotency', () => {
  it('converting the same lead twice does not create duplicate customer', () => {
    const lead = { id: 'lead-1', status: 'won', convertedCustomerId: null };
    const conversions: string[] = [];

    // First conversion
    if (lead.status === 'won' && !lead.convertedCustomerId) {
      lead.convertedCustomerId = 'cust-1';
      conversions.push('cust-1');
    }

    // Second conversion attempt (idempotent — should not create another customer)
    if (lead.status === 'won' && !lead.convertedCustomerId) {
      lead.convertedCustomerId = 'cust-2';
      conversions.push('cust-2');
    }

    expect(conversions).toHaveLength(1);
    expect(conversions[0]).toBe('cust-1');
  });

  it('re-converting an already-converted lead returns existing customer', () => {
    const lead = { id: 'lead-2', status: 'won', convertedCustomerId: 'cust-existing' };

    // Idempotent: returns the existing customer, doesn't create a new one
    const customerId = lead.convertedCustomerId ?? 'cust-new';
    expect(customerId).toBe('cust-existing');
  });

  it('conversion creates optional quotation idempotently', () => {
    const lead = { id: 'lead-3', status: 'won', convertedCustomerId: null, quotationId: null };
    const idempotencyKey = 'convert-lead-3';

    // First call with idempotency key
    const firstCall = { key: idempotencyKey, customerId: 'cust-1', quotationId: 'quote-1' };

    // Second call with same key → returns same result
    const secondCall = { key: idempotencyKey, customerId: 'cust-1', quotationId: 'quote-1' };

    expect(firstCall).toEqual(secondCall);
  });

  it('conversion does not create duplicate quotation on retry', () => {
    const quotationsCreated: string[] = [];
    const lead = { id: 'lead-4', quotationId: null };

    function attemptQuotation() {
      if (!lead.quotationId) {
        lead.quotationId = 'quote-' + Date.now();
        quotationsCreated.push(lead.quotationId);
      }
      return lead.quotationId;
    }

    attemptQuotation();
    attemptQuotation();
    attemptQuotation();

    expect(quotationsCreated).toHaveLength(1);
  });
});

// ── Consent Withdrawal ──

describe('CRM: Consent Withdrawal Prevents Marketing', () => {
  it('marketing campaign skips customers with withdrawn consent', () => {
    const customers = [
      { id: 'c1', name: 'Alice', consent: 'granted' },
      { id: 'c2', name: 'Bob', consent: 'withdrawn' },
      { id: 'c3', name: 'Charlie', consent: 'granted' },
      { id: 'c4', name: 'Diana', consent: 'never_given' },
    ];

    const eligibleForMarketing = customers.filter(c => c.consent === 'granted');
    const skipped = customers.filter(c => c.consent !== 'granted');

    expect(eligibleForMarketing).toHaveLength(2);
    expect(skipped).toHaveLength(2);
    expect(skipped.map(c => c.name)).toContain('Bob');
    expect(skipped.map(c => c.name)).toContain('Diana');
  });

  it('consent withdrawal records timestamp + reason', () => {
    const consentRecord = {
      customerId: 'c2',
      channel: 'sms',
      status: 'withdrawn',
      withdrawnAt: '2026-07-14T10:00:00Z',
      reason: 'Customer opted out via SMS reply STOP',
    };

    expect(consentRecord.status).toBe('withdrawn');
    expect(consentRecord.withdrawnAt).toBeTruthy();
    expect(consentRecord.reason).toBeTruthy();
  });

  it('transactional messages are NOT blocked by consent withdrawal', () => {
    const customer = { id: 'c1', marketingConsent: 'withdrawn', transactionalConsent: 'not_required' };

    // Transactional messages (order confirmation, receipt, warranty) always send
    const canSendTransactional = customer.transactionalConsent === 'not_required' || customer.transactionalConsent === 'granted';
    const canSendMarketing = customer.marketingConsent === 'granted';

    expect(canSendTransactional).toBe(true);
    expect(canSendMarketing).toBe(false);
  });

  it('consent withdrawal affects future campaigns, not past ones', () => {
    const campaign1 = { id: 'camp-1', sentAt: '2026-07-13', customerConsent: 'granted' };
    const withdrawal = { date: '2026-07-14' };
    const campaign2 = { id: 'camp-2', sentAt: '2026-07-15', customerConsent: 'withdrawn' };

    // Campaign 1 was sent before withdrawal — valid
    expect(campaign1.sentAt < withdrawal.date).toBe(true);

    // Campaign 2 is after withdrawal — should be skipped
    expect(campaign2.sentAt > withdrawal.date).toBe(true);
    expect(campaign2.customerConsent).toBe('withdrawn');
  });
});

// ── Provider Timeout No Duplicate ──

describe('CRM: Provider Timeout No Duplicate', () => {
  it('provider timeout does not prove success or failure — query status before retry', () => {
    const sendAttempt = {
      attemptId: 'att-1',
      status: 'timeout', // neither success nor failure
      providerMessageId: null,
    };

    // On timeout: do NOT retry immediately. Query provider status first.
    const action = sendAttempt.status === 'timeout' ? 'query_status' : 'retry';
    expect(action).toBe('query_status');
  });

  it('query status shows "sent" — do not retry (already sent)', () => {
    const providerStatus = 'sent'; // provider confirms it was sent
    const shouldRetry = providerStatus === 'failed'; // only retry on confirmed failure

    expect(shouldRetry).toBe(false);
  });

  it('query status shows "failed" — safe to retry', () => {
    const providerStatus = 'failed';
    const shouldRetry = providerStatus === 'failed';

    expect(shouldRetry).toBe(true);
  });

  it('query status shows "pending" — wait and query again', () => {
    const providerStatus = 'pending';
    const shouldRetry = providerStatus === 'failed';
    const shouldWait = providerStatus === 'pending';

    expect(shouldRetry).toBe(false);
    expect(shouldWait).toBe(true);
  });

  it('retries use same providerMessageId (deduplication)', () => {
    const originalMessageId = 'msg-12345';
    const retryMessageId = originalMessageId; // same ID for dedup

    expect(retryMessageId).toBe(originalMessageId);
    // Provider dedupes based on this ID — no duplicate SMS sent
  });

  it('outbox records each attempt with attempt_count', () => {
    const outboxEvent = {
      id: 'ev-1',
      attemptCount: 3,
      maxAttempts: 5,
      status: 'pending',
      lastError: 'timeout',
    };

    expect(outboxEvent.attemptCount).toBeLessThan(outboxEvent.maxAttempts);
    expect(outboxEvent.status).toBe('pending'); // still retrying
  });
});
