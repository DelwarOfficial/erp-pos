// tests/unit/m5DeliveryService.test.ts
// Tests for M5 — delivery transitions, service part consumption, warranty replacement validation.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { validateDeliveryTransition, validateServiceTransition } from '../../src/domain/commands/m5/Delivery';
import { validateServiceTransition as validateSvcTransition, validateWarrantyReplacement } from '../../src/domain/commands/m5/Service';
import { DomainError } from '../../src/lib/errors/codes';

// Re-export to avoid duplicate import
export { validateDeliveryTransition };

describe('M5 — Delivery transition validation', () => {
  it('allows pending → packing', () => {
    expect(() => validateDeliveryTransition('pending', 'packing')).not.toThrow();
  });

  it('allows ready → dispatched', () => {
    expect(() => validateDeliveryTransition('ready', 'dispatched')).not.toThrow();
  });

  it('allows dispatched → in_transit', () => {
    expect(() => validateDeliveryTransition('dispatched', 'in_transit')).not.toThrow();
  });

  it('allows in_transit → delivered', () => {
    expect(() => validateDeliveryTransition('in_transit', 'delivered')).not.toThrow();
  });

  it('allows in_transit → failed', () => {
    expect(() => validateDeliveryTransition('in_transit', 'failed')).not.toThrow();
  });

  it('allows in_transit → returned', () => {
    expect(() => validateDeliveryTransition('in_transit', 'returned')).not.toThrow();
  });

  it('rejects delivered → pending (terminal state)', () => {
    expect(() => validateDeliveryTransition('delivered', 'pending')).toThrow(/Invalid delivery transition/);
  });

  it('rejects cancelled → ready (terminal state)', () => {
    expect(() => validateDeliveryTransition('cancelled', 'ready')).toThrow(/Invalid delivery transition/);
  });

  it('rejects pending → delivered (must go through dispatched/in_transit)', () => {
    expect(() => validateDeliveryTransition('pending', 'delivered')).toThrow(/Invalid delivery transition/);
  });
});

describe('M5 — Service transition validation', () => {
  it('allows received → diagnosing', () => {
    expect(() => validateSvcTransition('received', 'diagnosing')).not.toThrow();
  });

  it('allows diagnosing → awaiting_customer_approval', () => {
    expect(() => validateSvcTransition('diagnosing', 'awaiting_customer_approval')).not.toThrow();
  });

  it('allows in_repair → ready', () => {
    expect(() => validateSvcTransition('in_repair', 'ready')).not.toThrow();
  });

  it('allows ready → delivered', () => {
    expect(() => validateSvcTransition('ready', 'delivered')).not.toThrow();
  });

  it('rejects delivered → in_repair (terminal)', () => {
    expect(() => validateSvcTransition('delivered', 'in_repair')).toThrow(/Invalid service transition/);
  });

  it('rejects received → in_repair (must diagnose first)', () => {
    expect(() => validateSvcTransition('received', 'in_repair')).toThrow(/Invalid service transition/);
  });
});

describe('M5 — Warranty replacement validation', () => {
  it('accepts in_stock serial for replacement', () => {
    expect(() => validateWarrantyReplacement({ status: 'in_stock' })).not.toThrow();
  });

  it('rejects sold serial for replacement', () => {
    expect(() => validateWarrantyReplacement({ status: 'sold' })).toThrow(/must be in_stock/);
  });

  it('rejects damaged serial for replacement', () => {
    expect(() => validateWarrantyReplacement({ status: 'damaged' })).toThrow(/must be in_stock/);
  });

  it('rejects scrapped serial for replacement', () => {
    expect(() => validateWarrantyReplacement({ status: 'scrapped' })).toThrow(/must be in_stock/);
  });
});
