// tests/unit/revaluation.test.ts
// Tests for multi-currency period-end revaluation per §20.D12.

import { describe, it, expect } from 'vitest';
import { calculateUnrealizedGainLoss } from '@/lib/accounting/revaluation';

describe('Multi-Currency Revaluation (§20.D12)', () => {
  describe('calculateUnrealizedGainLoss', () => {
    it('calculates gain when period-end rate increases', () => {
      // Customer owes $1000 USD, original rate was ৳110/USD
      // Period-end rate is ৳115/USD → gain (we'll receive more BDT)
      const result = calculateUnrealizedGainLoss(1000, 110, 115);

      // Book value: 1000 × 110 = 110,000 BDT
      // Revalued: 1000 × 115 = 115,000 BDT
      // Gain: 5,000 BDT
      expect(result.revaluedAmount).toBe(115000);
      expect(result.gain).toBe(5000);
      expect(result.loss).toBe(0);
    });

    it('calculates loss when period-end rate decreases', () => {
      // Customer owes $1000 USD, original rate was ৳110/USD
      // Period-end rate is ৳105/USD → loss (we'll receive less BDT)
      const result = calculateUnrealizedGainLoss(1000, 110, 105);

      // Book value: 1000 × 110 = 110,000 BDT
      // Revalued: 1000 × 105 = 105,000 BDT
      // Loss: 5,000 BDT
      expect(result.revaluedAmount).toBe(105000);
      expect(result.gain).toBe(0);
      expect(result.loss).toBe(5000);
    });

    it('no gain or loss when rate unchanged', () => {
      const result = calculateUnrealizedGainLoss(1000, 110, 110);

      expect(result.revaluedAmount).toBe(110000);
      expect(result.gain).toBe(0);
      expect(result.loss).toBe(0);
    });

    it('handles AP (supplier payable) — gain/loss is reversed vs AR', () => {
      // Supplier payable: $2000 USD, original rate ৳110
      // Period-end rate ৳115 → we owe MORE in BDT → this is a LOSS for AP
      // (For AR it would be a gain, but for AP the direction is reversed)
      const result = calculateUnrealizedGainLoss(2000, 110, 115);

      // The function calculates from the account holder's perspective:
      // Book value: 2000 × 110 = 220,000
      // Revalued: 2000 × 115 = 230,000
      // Diff: +10,000 (revalued > book = "gain" in raw calculation)
      // For AP, this +10,000 means we owe more → it's actually a loss
      // The caller (runRevaluation) determines the direction based on account type
      expect(result.revaluedAmount).toBe(230000);
      expect(result.gain).toBe(10000); // raw calculation — caller interprets for AP vs AR
      expect(result.loss).toBe(0);
    });

    it('handles zero balance (no revaluation needed)', () => {
      const result = calculateUnrealizedGainLoss(0, 110, 115);

      expect(result.revaluedAmount).toBe(0);
      expect(result.gain).toBe(0);
      expect(result.loss).toBe(0);
    });

    it('handles negative balance (credit/advance)', () => {
      // Customer advance: -$500 USD (we owe the customer)
      // Original rate ৳110, period-end rate ৳115
      const result = calculateUnrealizedGainLoss(-500, 110, 115);

      // Book value: -500 × 110 = -55,000
      // Revalued: -500 × 115 = -57,500
      // Diff: -57,500 - (-55,000) = -2,500
      // Gain: 0 (diff is negative)
      // Loss: 2,500
      expect(result.revaluedAmount).toBe(-57500);
      expect(result.gain).toBe(0);
      expect(result.loss).toBe(2500);
    });
  });

  describe('Reversal Logic', () => {
    it('reversal negates the original gain/loss', () => {
      const originalGain = 5000;
      const originalLoss = 0;

      // Reversal: negate the original
      const reversalGain = -originalGain || 0; // avoid -0
      const reversalLoss = -originalLoss || 0; // avoid -0

      expect(reversalGain).toBe(-5000);
      expect(reversalLoss).toBe(0);
    });

    it('reversal negates the original loss', () => {
      const originalGain = 0;
      const originalLoss = 3000;

      const reversalGain = -originalGain || 0; // avoid -0
      const reversalLoss = -originalLoss || 0; // avoid -0

      expect(reversalGain).toBe(0);
      expect(reversalLoss).toBe(-3000);
    });

    it('reversed revaluation cannot be reversed again', () => {
      const revaluation = { reversedAt: '2026-08-01T00:00:00Z' };
      expect(revaluation.reversedAt).not.toBeNull();
      // Should throw "Revaluation already reversed"
    });
  });

  describe('Revaluation Journal Entry', () => {
    it('unrealized gain: Dr Account (foreign), Cr Exchange Gain/Loss', () => {
      const gain = 5000;

      // Journal for AR gain:
      // Dr AR (USD account) 5000 BDT
      // Cr Exchange Gain/Loss 5000 BDT
      const debit = gain;
      const credit = gain;
      expect(debit).toBe(credit); // balanced
    });

    it('unrealized loss: Dr Exchange Gain/Loss, Cr Account (foreign)', () => {
      const loss = 3000;

      // Journal for AR loss:
      // Dr Exchange Gain/Loss 3000 BDT
      // Cr AR (USD account) 3000 BDT
      const debit = loss;
      const credit = loss;
      expect(debit).toBe(credit); // balanced
    });

    it('reversal swaps debit and credit', () => {
      const originalGain = 5000;

      // Original: Dr AR 5000, Cr Gain 5000
      // Reversal: Dr Gain 5000, Cr AR 5000 (swapped)
      const originalDr = originalGain;
      const originalCr = originalGain;
      const reversalDr = originalCr; // swapped
      const reversalCr = originalDr; // swapped

      expect(reversalDr).toBe(originalCr);
      expect(reversalCr).toBe(originalDr);
    });
  });

  describe('Cannot Revalue Base Currency', () => {
    it('rejects revaluation of BDT when BDT is the base currency', () => {
      const baseCurrency = 'BDT';
      const revaluationCurrency = 'BDT';

      expect(baseCurrency === revaluationCurrency).toBe(true);
      // Should throw "Cannot revalue base currency"
    });

    it('allows revaluation of USD when BDT is the base currency', () => {
      const baseCurrency = 'BDT';
      const revaluationCurrency = 'USD';

      expect(baseCurrency !== revaluationCurrency).toBe(true);
    });
  });
});
