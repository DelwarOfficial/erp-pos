// Provider-neutral SMS gateway.
//
// The receivables and reminder code never talks to a provider; it asks the
// gateway for a company, and the gateway's outcome says what happened in terms
// the reminder engine can act on. One adapter per provider owns everything
// provider-specific (src/lib/sms/mimsms.ts).

export interface SmsSendRequest {
  /** Canonical 8801XXXXXXXXX (src/domain/receivables/phone.ts). */
  to: string;
  text: string;
}

/**
 * - accepted:   the provider took the message; providerMessageId tracks it.
 * - retryable:  the provider certainly did not take it, and may later
 *               (it refused temporarily, or the request never reached it).
 * - permanent:  it did not take it and will not without a change here
 *               (credentials, sender ID, number).
 * - ambiguous:  it may or may not have taken it (timeout, connection lost
 *               after sending, unreadable success response). Never retried
 *               automatically: a retry could send the message twice.
 */
export type SmsSendOutcome =
  | { kind: 'accepted'; providerMessageId: string; segments?: number; raw: string }
  | { kind: 'retryable'; code: string; raw: string }
  | { kind: 'permanent'; code: string; raw: string }
  | { kind: 'ambiguous'; code: string; raw: string };

export type SmsDeliveryStatus =
  | { kind: 'delivered'; providerStatus: string }
  | { kind: 'failed'; providerStatus: string }
  | { kind: 'pending'; providerStatus: string }
  | { kind: 'unavailable'; reason: string };

export interface SmsGateway {
  readonly providerCode: string;
  send(request: SmsSendRequest): Promise<SmsSendOutcome>;
  /** Only where the provider documents a status lookup. */
  deliveryStatus?(providerMessageId: string, to: string): Promise<SmsDeliveryStatus>;
  /** Only where the provider documents a balance lookup. */
  balance?(): Promise<{ balance: string; expiresOn?: string } | null>;
}
