// src/adapters/index.ts
// Provider adapter interfaces per §9.3.
// Provider-neutral interfaces for SMS, Email, Courier, Risk, Payment.

// ── SMS Provider ──
export interface SmsProvider {
  code: string;
  sendSms(params: { to: string; message: string; senderId?: string }): Promise<{ providerMessageId: string; status: 'sent' | 'failed' }>;
  checkStatus?(providerMessageId: string): Promise<'sent' | 'delivered' | 'failed'>;
}

// ── Email Provider ──
export interface EmailProvider {
  code: string;
  sendEmail(params: { to: string; subject: string; htmlBody: string; textBody?: string }): Promise<{ providerMessageId: string; status: 'sent' | 'failed' }>;
}

// ── Courier Provider ──
export interface CourierProvider {
  code: string;
  quote(params: { fromArea: string; toArea: string; weight?: number; codAmount?: number }): Promise<{ charge: number; estimatedDays: number }>;
  createShipment(params: { deliveryOrderId: string; recipientName: string; recipientPhone: string; address: string; codAmount: number }): Promise<{ providerShipmentId: string; trackingCode: string; labelUrl?: string }>;
  cancelShipment(providerShipmentId: string): Promise<{ cancelled: boolean }>;
  track(providerShipmentId: string): Promise<{ status: string; location?: string; timestamp: Date }>;
}

// ── Risk Provider ──
export interface RiskProvider {
  code: string;
  assessRisk(params: {
    subjectType: 'customer' | 'lead' | 'sale' | 'delivery';
    subjectId: string;
    amount?: number;
    companyId?: string; // when set, persists the assessment to risk_assessments table
    requestEventId?: string; // required when companyId is set
  }): Promise<{ score?: number; decision: 'allow' | 'review' | 'block' | 'unavailable'; reasonCodes: string[]; providerReference?: string }>;
}

// ── Payment Provider ──
export interface PaymentProvider {
  code: string;
  initiatePayment(params: { amount: number; currency: string; reference: string; returnUrl: string }): Promise<{ gatewayUrl: string; gatewayTxnId: string }>;
  verifyWebhook(params: { rawBody: string; signature: string; timestamp: string }): Promise<{ verified: boolean; paymentId?: string; status?: 'success' | 'failed' }>;
  refund(params: { gatewayTxnId: string; amount: number }): Promise<{ refundId: string; status: 'pending' | 'completed' | 'failed' }>;
  getSettlements(params: { fromDate: Date; toDate: Date }): Promise<Array<{ settlementDate: Date; grossAmount: number; feeAmount: number; netAmount: number; txnIds: string[] }>>;
}

// ── Notification Provider (Slack, Teams, Discord, etc.) ──
// Used for ops alerts (risk alerts, reconciliation failures, etc.)
export interface NotificationProvider {
  code: string;
  sendNotification(params: {
    severity: 'info' | 'warning' | 'critical';
    title: string;
    message: string;
    fields?: Array<{ label: string; value: string }>;
    url?: string; // optional link back to the dashboard
  }): Promise<{ delivered: boolean; providerMessageId?: string; error?: string }>;
}

// ── Provider Registry ──
export class ProviderRegistry {
  private sms = new Map<string, SmsProvider>();
  private email = new Map<string, EmailProvider>();
  private courier = new Map<string, CourierProvider>();
  private risk = new Map<string, RiskProvider>();
  private payment = new Map<string, PaymentProvider>();
  private notification = new Map<string, NotificationProvider>();

  registerSms(p: SmsProvider) { this.sms.set(p.code, p); }
  registerEmail(p: EmailProvider) { this.email.set(p.code, p); }
  registerCourier(p: CourierProvider) { this.courier.set(p.code, p); }
  registerRisk(p: RiskProvider) { this.risk.set(p.code, p); }
  registerPayment(p: PaymentProvider) { this.payment.set(p.code, p); }
  registerNotification(p: NotificationProvider) { this.notification.set(p.code, p); }

  getSms(code: string) { return this.sms.get(code); }
  getEmail(code: string) { return this.email.get(code); }
  getCourier(code: string) { return this.courier.get(code); }
  getRisk(code: string) { return this.risk.get(code); }
  getPayment(code: string) { return this.payment.get(code); }
  getNotification(code: string) { return this.notification.get(code); }
  getAllNotifications(): NotificationProvider[] { return Array.from(this.notification.values()); }
}

export const providerRegistry = new ProviderRegistry();
