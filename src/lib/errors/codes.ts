// src/lib/errors/codes.ts
// Domain error codes per §13.1 of the blueprint. EXACT codes — do not rename.

export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN_SCOPE: 'FORBIDDEN_SCOPE',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  CONCURRENT_MODIFICATION: 'CONCURRENT_MODIFICATION',
  INVENTORY_INSUFFICIENT: 'INVENTORY_INSUFFICIENT',
  SERIAL_NOT_AVAILABLE: 'SERIAL_NOT_AVAILABLE',
  ALLOCATION_EXCEEDS_BALANCE: 'ALLOCATION_EXCEEDS_BALANCE',
  FISCAL_PERIOD_LOCKED: 'FISCAL_PERIOD_LOCKED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  OFFLINE_LEASE_INVALID: 'OFFLINE_LEASE_INVALID',
  GIFT_CARD_INSUFFICIENT: 'GIFT_CARD_INSUFFICIENT',
  COUPON_INVALID: 'COUPON_INVALID',
  REWARD_POINTS_INSUFFICIENT: 'REWARD_POINTS_INSUFFICIENT',
  CREDIT_LIMIT_EXCEEDED: 'CREDIT_LIMIT_EXCEEDED',
  CHEQUE_STATUS_INVALID: 'CHEQUE_STATUS_INVALID',
  DELIVERY_TRANSITION_INVALID: 'DELIVERY_TRANSITION_INVALID',
  SERVICE_TRANSITION_INVALID: 'SERVICE_TRANSITION_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  PROVIDER_STATUS_UNKNOWN: 'PROVIDER_STATUS_UNKNOWN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  FEATURE_NOT_ENABLED: 'FEATURE_NOT_ENABLED',
  PUBLIC_SIGNUP_DISABLED: 'PUBLIC_SIGNUP_DISABLED',
  SELF_APPROVAL_PROHIBITED: 'SELF_APPROVAL_PROHIBITED',
  REPLAY_OUTSIDE_TOLERANCE: 'REPLAY_OUTSIDE_TOLERANCE',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  EXCHANGE_RATE_MISSING: 'EXCHANGE_RATE_MISSING',
  LEGAL_HOLD_ACTIVE: 'LEGAL_HOLD_ACTIVE',
  STATUTORY_RETENTION_REQUIRED: 'STATUTORY_RETENTION_REQUIRED',
  NO_OPEN_SHIFT: 'NO_OPEN_SHIFT',
  INVALID_PIN: 'INVALID_PIN',
  INVALID_MFA: 'INVALID_MFA',
  CUSTOMER_OVERDUE: 'CUSTOMER_OVERDUE',
  GIFT_CARD_EXPIRED: 'GIFT_CARD_EXPIRED',
  VERIFICATION_REQUIRED: 'VERIFICATION_REQUIRED',
  MODULE_NOT_IMPLEMENTED: 'MODULE_NOT_IMPLEMENTED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  COMPANY_SUSPENDED: 'COMPANY_SUSPENDED',
  EXTERNAL_PROVIDER_ERROR: 'EXTERNAL_PROVIDER_ERROR',
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly httpStatus: number = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }

  toJSON(correlationId?: string) {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        correlation_id: correlationId,
      },
    };
  }
}

export function toDomainError(e: unknown, correlationId?: string) {
  if (e instanceof DomainError) return e;
  const message = e instanceof Error ? e.message : 'Unknown error';
  return new DomainError(
    'INTERNAL_ERROR',
    message,
    {},
    500,
  );
}

export function errorResponse(e: unknown, correlationId?: string) {
  const err = e instanceof DomainError ? e : toDomainError(e, correlationId);
  return Response.json(err.toJSON(correlationId), { status: err.httpStatus });
}
