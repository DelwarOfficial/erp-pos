import { describe, expect, it } from 'vitest';
import { CustomerSchema } from '../../src/lib/customers/schema';

describe('shared customer-create contract', () => {
  it('requires only name and retains the zero-credit default', () => {
    expect(CustomerSchema.parse({ name: 'Fixture' })).toEqual({ name: 'Fixture', credit_limit: 0 });
    expect(CustomerSchema.safeParse({ name: '' }).success).toBe(false);
    expect(CustomerSchema.safeParse({ name: 'x'.repeat(200) }).success).toBe(true);
    expect(CustomerSchema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
  });
  it('keeps optional phone length rules without imposing SMS mobile validation', () => {
    expect(CustomerSchema.parse({ name: 'Fixture', phone: '02-1234567' }).phone).toBe('02-1234567');
    expect(CustomerSchema.safeParse({ name: 'Fixture', phone: 'x'.repeat(30) }).success).toBe(true);
    expect(CustomerSchema.safeParse({ name: 'Fixture', phone: 'x'.repeat(31) }).success).toBe(false);
  });
});
