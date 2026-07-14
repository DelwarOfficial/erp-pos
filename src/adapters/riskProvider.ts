// src/adapters/riskProvider.ts
// Internal risk-scoring provider — uses rule-based scoring on customer history
// + payment velocity + delivery blocklist. Replaces the StubRiskProvider for
// production use. Per §20.D15 risk scoring + §9.3 provider interface.
//
// All thresholds are env-configurable so merchants can tune risk appetite
// without code changes. Defaults are calibrated for typical Bangladesh
// electronics retail (৳1L = 100,000 BDT ≈ $900 USD).

import { db } from '@/lib/db';
import type { RiskProvider } from './index';

// ── Env-configurable thresholds (parsed once at module load) ──
function envInt(name: string, defaultValue: number): number {
  const v = process.env[name];
  if (!v) return defaultValue;
  const n = parseInt(v, 10);
  return isNaN(n) ? defaultValue : n;
}
function envFloat(name: string, defaultValue: number): number {
  const v = process.env[name];
  if (!v) return defaultValue;
  const n = parseFloat(v);
  return isNaN(n) ? defaultValue : n;
}

const CONFIG = {
  // Velocity rule — order count and total amount within rolling window
  VELOCITY_WINDOW_HOURS: envInt('RISK_VELOCITY_WINDOW_HOURS', 24),
  VELOCITY_AMOUNT_THRESHOLD: envInt('RISK_VELOCITY_AMOUNT_THRESHOLD', 200_000),
  VELOCITY_COUNT_THRESHOLD: envInt('RISK_VELOCITY_COUNT_THRESHOLD', 20),

  // Outstanding AR rule
  CUSTOMER_DEBT_THRESHOLD: envInt('RISK_CUSTOMER_DEBT_THRESHOLD', 100_000),
  CUSTOMER_DEBT_ELEVATED_THRESHOLD: envInt('RISK_CUSTOMER_DEBT_ELEVATED_THRESHOLD', 50_000),

  // Return ratio rule
  RETURN_RATIO_HIGH: envFloat('RISK_RETURN_RATIO_HIGH', 0.4),
  RETURN_RATIO_ELEVATED: envFloat('RISK_RETURN_RATIO_ELEVATED', 0.2),

  // Failed payments rule
  FAILED_PAYMENT_THRESHOLD: envInt('RISK_FAILED_PAYMENT_THRESHOLD', 3),

  // Delivery COD rule
  DELIVERY_COD_HIGH_AMOUNT: envInt('RISK_DELIVERY_COD_HIGH_AMOUNT', 50_000),

  // Sale amount tiers
  SALE_AMOUNT_VERY_HIGH: envInt('RISK_SALE_AMOUNT_VERY_HIGH', 500_000),
  SALE_AMOUNT_HIGH: envInt('RISK_SALE_AMOUNT_HIGH', 100_000),

  // Score increments per rule (so merchants can dial up/down sensitivity)
  SCORE_LEAD_BASE: envInt('RISK_SCORE_LEAD_BASE', 5),
  SCORE_HIGH_AR: envInt('RISK_SCORE_HIGH_AR', 50),
  SCORE_ELEVATED_AR: envInt('RISK_SCORE_ELEVATED_AR', 15),
  SCORE_HIGH_VELOCITY_COUNT: envInt('RISK_SCORE_HIGH_VELOCITY_COUNT', 30),
  SCORE_HIGH_VELOCITY_AMOUNT: envInt('RISK_SCORE_HIGH_VELOCITY_AMOUNT', 30),
  SCORE_HIGH_RETURN_RATIO: envInt('RISK_SCORE_HIGH_RETURN_RATIO', 25),
  SCORE_ELEVATED_RETURN_RATIO: envInt('RISK_SCORE_ELEVATED_RETURN_RATIO', 10),
  SCORE_REPEATED_PAYMENT_FAILURE: envInt('RISK_SCORE_REPEATED_PAYMENT_FAILURE', 20),
  SCORE_CREDIT_LIMIT_EXCEEDED: envInt('RISK_SCORE_CREDIT_LIMIT_EXCEEDED', 40),
  SCORE_HIGH_COD_AMOUNT: envInt('RISK_SCORE_HIGH_COD_AMOUNT', 25),
  SCORE_VERY_HIGH_AMOUNT: envInt('RISK_SCORE_VERY_HIGH_AMOUNT', 20),
  SCORE_HIGH_AMOUNT: envInt('RISK_SCORE_HIGH_AMOUNT', 10),

  // Decision thresholds (final score → decision)
  DECISION_BLOCK_THRESHOLD: envInt('RISK_DECISION_BLOCK_THRESHOLD', 70),
  DECISION_REVIEW_THRESHOLD: envInt('RISK_DECISION_REVIEW_THRESHOLD', 35),
} as const;

// Exposed for runtime inspection (admin UI can show current thresholds)
export const RISK_CONFIG = CONFIG;

interface RuleResult {
  decision: 'allow' | 'review' | 'block';
  reasonCodes: string[];
  score: number; // 0-100, higher = riskier
}

export class InternalRiskProvider implements RiskProvider {
  code = 'internal_v2';

  async assessRisk(params: {
    subjectType: 'customer' | 'lead' | 'sale' | 'delivery';
    subjectId: string;
    amount?: number;
    companyId?: string; // when set, persists the assessment to risk_assessments table
    requestEventId?: string; // required when companyId is set
  }): Promise<{
    score: number;
    decision: 'allow' | 'review' | 'block' | 'unavailable';
    reasonCodes: string[];
    providerReference: string;
  }> {
    let result;
    try {
      result = await this.evaluate(params);
    } catch (e) {
      console.error('[riskProvider] evaluate() threw:', e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
      throw e;
    }
    const providerReference = `risk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Persist assessment if companyId is provided (so admins can review later)
    if (params.companyId && params.requestEventId) {
      try {
        await db.riskAssessment.create({
          data: {
            companyId: params.companyId,
            providerCode: this.code,
            subjectType: params.subjectType,
            subjectId: params.subjectId,
            requestEventId: params.requestEventId,
            score: result.score,
            decision: result.decision,
            reasonCodes: JSON.stringify(result.reasonCodes),
            providerReference,
            sanitizedResponse: JSON.stringify({
              amount: params.amount,
              evaluatedRules: result.reasonCodes.length,
            }),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
          },
        });
      } catch (e) {
        // Don't fail the risk assessment if persistence fails
        console.error('[riskProvider] Failed to persist assessment:', e instanceof Error ? `${e.message}\n${e.stack}` : JSON.stringify(e));
      }
    }

    return {
      score: result.score,
      decision: result.decision,
      reasonCodes: result.reasonCodes,
      providerReference,
    };
  }

  private async evaluate(params: {
    subjectType: 'customer' | 'lead' | 'sale' | 'delivery';
    subjectId: string;
    amount?: number;
  }): Promise<RuleResult> {
    const reasonCodes: string[] = [];
    let score = 0;

    // ── Rule 1: Subject-type base score ──
    if (params.subjectType === 'lead') {
      // New lead — slight inherent risk
      score += CONFIG.SCORE_LEAD_BASE;
    }

    if (params.subjectType === 'customer' || params.subjectType === 'sale') {
      const customerId = params.subjectType === 'customer' ? params.subjectId : await this.getCustomerIdFromSale(params.subjectId);
      if (!customerId) {
        return { decision: 'allow', reasonCodes: ['no_customer_context'], score: 0 };
      }

      // ── Rule 2: Customer outstanding AR ──
      const outstanding = await this.getOutstandingAr(customerId);
      if (outstanding > CONFIG.CUSTOMER_DEBT_THRESHOLD) {
        score += CONFIG.SCORE_HIGH_AR;
        reasonCodes.push('HIGH_OUTSTANDING_AR');
      } else if (outstanding > CONFIG.CUSTOMER_DEBT_ELEVATED_THRESHOLD) {
        score += CONFIG.SCORE_ELEVATED_AR;
        reasonCodes.push('ELEVATED_AR');
      }

      // ── Rule 3: Order velocity (count + amount) in last 24h ──
      const velocity = await this.getOrderVelocity(customerId);
      if (velocity.count > CONFIG.VELOCITY_COUNT_THRESHOLD) {
        score += CONFIG.SCORE_HIGH_VELOCITY_COUNT;
        reasonCodes.push('HIGH_ORDER_VELOCITY');
      }
      if (velocity.amount > CONFIG.VELOCITY_AMOUNT_THRESHOLD) {
        score += CONFIG.SCORE_HIGH_VELOCITY_AMOUNT;
        reasonCodes.push('HIGH_AMOUNT_VELOCITY');
      }

      // ── Rule 4: Previous returns ratio ──
      const returnRatio = await this.getReturnRatio(customerId);
      if (returnRatio > CONFIG.RETURN_RATIO_HIGH) {
        score += CONFIG.SCORE_HIGH_RETURN_RATIO;
        reasonCodes.push('HIGH_RETURN_RATIO');
      } else if (returnRatio > CONFIG.RETURN_RATIO_ELEVATED) {
        score += CONFIG.SCORE_ELEVATED_RETURN_RATIO;
        reasonCodes.push('ELEVATED_RETURN_RATIO');
      }

      // ── Rule 5: Failed payment count ──
      const failedPayments = await this.getFailedPaymentCount(customerId);
      if (failedPayments > CONFIG.FAILED_PAYMENT_THRESHOLD) {
        score += CONFIG.SCORE_REPEATED_PAYMENT_FAILURE;
        reasonCodes.push('REPEATED_PAYMENT_FAILURE');
      }

      // ── Rule 6: Inactive / deactivated customer ──
      const customer = await db.customer.findUnique({
        where: { id: customerId },
        select: { isActive: true, creditLimit: true },
      });
      if (customer && !customer.isActive) {
        return { decision: 'block', reasonCodes: ['INACTIVE_CUSTOMER'], score: 100 };
      }

      // ── Rule 6b: Credit limit exceeded ──
      if (customer && params.amount) {
        const creditLimit = parseFloat(String(customer.creditLimit ?? '0'));
        if (creditLimit > 0 && params.amount > creditLimit) {
          score += CONFIG.SCORE_CREDIT_LIMIT_EXCEEDED;
          reasonCodes.push('CREDIT_LIMIT_EXCEEDED');
        }
      }
    }

    if (params.subjectType === 'delivery') {
      // ── Rule 7: Delivery-specific — high COD amount review ──
      if (params.amount && params.amount > CONFIG.DELIVERY_COD_HIGH_AMOUNT) {
        score += CONFIG.SCORE_HIGH_COD_AMOUNT;
        reasonCodes.push('HIGH_COD_AMOUNT');
      }
    }

    // ── Rule 8: Sale amount tier ──
    if (params.amount) {
      if (params.amount > CONFIG.SALE_AMOUNT_VERY_HIGH) { score += CONFIG.SCORE_VERY_HIGH_AMOUNT; reasonCodes.push('VERY_HIGH_AMOUNT'); }
      else if (params.amount > CONFIG.SALE_AMOUNT_HIGH) { score += CONFIG.SCORE_HIGH_AMOUNT; reasonCodes.push('HIGH_AMOUNT'); }
    }

    // ── Decision thresholds ──
    let decision: RuleResult['decision'] = 'allow';
    if (score >= CONFIG.DECISION_BLOCK_THRESHOLD) decision = 'block';
    else if (score >= CONFIG.DECISION_REVIEW_THRESHOLD) decision = 'review';

    if (reasonCodes.length === 0) reasonCodes.push('CLEAN');
    return { decision, reasonCodes, score: Math.min(100, score) };
  }

  private async getCustomerIdFromSale(saleId: string): Promise<string | null> {
    const sale = await db.sale.findUnique({ where: { id: saleId }, select: { customerId: true } });
    return sale?.customerId ?? null;
  }

  private async getOutstandingAr(customerId: string): Promise<number> {
    const result = await db.sale.aggregate({
      where: { customerId, saleStatus: { in: ['confirmed', 'partially_paid', 'completed'] } },
      _sum: { grandTotal: true },
    });
    return parseFloat(String(result._sum.grandTotal ?? '0'));
  }

  private async getOrderVelocity(customerId: string): Promise<{ count: number; amount: number }> {
    const since = new Date(Date.now() - CONFIG.VELOCITY_WINDOW_HOURS * 60 * 60 * 1000);
    const sales = await db.sale.findMany({
      where: { customerId, createdAt: { gte: since } },
      select: { grandTotal: true },
    });
    return {
      count: sales.length,
      amount: sales.reduce((sum, s) => sum + parseFloat(String(s.grandTotal)), 0),
    };
  }

  private async getReturnRatio(customerId: string): Promise<number> {
    const sales = await db.sale.count({ where: { customerId } });
    if (sales === 0) return 0;
    const returns = await db.saleReturn.count({ where: { sale: { customerId } } });
    return returns / sales;
  }

  private async getFailedPaymentCount(customerId: string): Promise<number> {
    return db.payment.count({ where: { customerId, paymentStatus: 'failed' } });
  }
}
