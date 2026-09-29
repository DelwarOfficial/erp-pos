// MiMSMS adapter, from the official API v2.1 documentation
// (https://apidoc.mimsms.com, retrieved 2026-09-28).
//
// Documented and used here:
//   POST https://api.mimsms.com/api/V2/SMS          send; JSON body
//        { userName, apiKey, senderName, transactionType: "T", mobileNumber, message }
//        -> { statusCode: "200", status: "Success", trxnId, responseResult,
//             success_Data: [{ mobNumber, trackingId, sms_Count, lang_Type }],
//             error_Data: [{ res_Code, error, failedNumbers, errorParm }] }
//        Transactional ("T") allows one recipient per request and is
//        delivered regardless of DND. Promotional ("P", marketing; optional
//        campaignName) is subject to DND and allows up to 1000 comma-separated
//        numbers; we still send one number per request so each message has
//        its own tracking ID and outcome.
//   POST https://api.mimsms.com/api/V2/DlrApi       delivery report
//        { userName, apiKey, mobileNumber, trackingId }
//        -> { statusCode, status, trackingId, dlrCode, operatorStatus, mobileNumber }
//        available about five minutes after sending.
//   POST https://api.mimsms.com/api/V2/BalanceCheck { userName, apiKey }
//        -> { statusCode, status, data: [{ balance, expair_Date }] }
//
// Credentials go in the request body, not a header. The account's server IP
// and domain must be whitelisted in the MiMSMS panel (Utility -> Developer),
// and senderName must be a Sender ID registered there.
//
// NOT documented, so not assumed: delivery callbacks/webhooks, an idempotency
// key or any lookup by our own reference, rate limits, a sandbox, and the list
// of send error codes. Without an idempotency key a timed-out send cannot be
// checked, which is why it is reported as ambiguous and never retried.

import type { SmsDeliveryStatus, SmsGateway, SmsSendOutcome, SmsSendRequest } from './gateway';

export const MIMSMS_BASE_URL = 'https://api.mimsms.com/api/V2';
const TIMEOUT_MS = 15_000;

export interface MimSmsCredentials {
  userName: string;
  apiKey: string;
  senderName: string;
}

type Fetch = typeof fetch;

/** Errors raised before any byte reached MiMSMS: safe to retry. */
const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

function causeCode(error: unknown): string {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return cause?.code ?? (error as { name?: string })?.name ?? 'network_error';
}

/** Error text without any credential that might be echoed back. */
function scrub(text: string, credentials: MimSmsCredentials): string {
  let out = text.slice(0, 500);
  for (const secret of [credentials.apiKey, credentials.userName]) if (secret) out = out.split(secret).join('***');
  return out;
}

export class MimSmsGateway implements SmsGateway {
  readonly providerCode = 'mimsms';

  constructor(private readonly credentials: MimSmsCredentials, private readonly fetchImpl: Fetch = fetch) {}

  private async post(path: string, body: Record<string, string>) {
    return this.fetchImpl(`${MIMSMS_BASE_URL}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ userName: this.credentials.userName, apiKey: this.credentials.apiKey, ...body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  async send(request: SmsSendRequest): Promise<SmsSendOutcome> {
    let response: Response;
    try {
      response = await this.post('SMS', {
        senderName: this.credentials.senderName, transactionType: request.kind === 'promotional' ? 'P' : 'T',
        mobileNumber: request.to, message: request.text,
        ...(request.kind === 'promotional' && request.campaignName ? { campaignName: request.campaignName.slice(0, 100) } : {}),
      });
    } catch (error) {
      const code = causeCode(error);
      // Refused or unresolvable: nothing was sent. Anything else -- a timeout,
      // a reset mid-request -- may have been accepted.
      return NOT_SENT.has(code)
        ? { kind: 'retryable', code: `network:${code}`, raw: '' }
        : { kind: 'ambiguous', code: `network:${code}`, raw: '' };
    }

    let text = '';
    try { text = await response.text(); } catch { /* body lost after a response began */ }
    const raw = scrub(text, this.credentials);
    if (response.status === 429 || response.status >= 500) return { kind: 'retryable', code: `http:${response.status}`, raw };

    let data: {
      statusCode?: string; status?: string;
      success_Data?: Array<{ trackingId?: string; sms_Count?: number }>;
      error_Data?: Array<{ res_Code?: string; error?: string }>;
    };
    try { data = JSON.parse(text); } catch {
      // A 200 we cannot read may still have sent the message.
      return response.ok ? { kind: 'ambiguous', code: 'unreadable_response', raw } : { kind: 'permanent', code: `http:${response.status}`, raw };
    }
    const accepted = data.success_Data?.[0];
    if (response.ok && String(data.statusCode) === '200' && accepted?.trackingId) {
      return { kind: 'accepted', providerMessageId: accepted.trackingId, segments: typeof accepted.sms_Count === 'number' ? accepted.sms_Count : undefined, raw };
    }
    if (response.ok && String(data.statusCode) === '200') {
      // "Success" without a tracking ID: the documented shape was not met.
      return { kind: 'ambiguous', code: 'no_tracking_id', raw };
    }
    const failure = data.error_Data?.find(e => e.res_Code && e.res_Code !== '200');
    return { kind: 'permanent', code: `mimsms:${failure?.res_Code ?? data.statusCode ?? response.status}`, raw };
  }

  async deliveryStatus(providerMessageId: string, to: string): Promise<SmsDeliveryStatus> {
    let data: { statusCode?: string; operatorStatus?: string; dlrCode?: string };
    try {
      const response = await this.post('DlrApi', { mobileNumber: to, trackingId: providerMessageId });
      if (!response.ok) return { kind: 'unavailable', reason: `http:${response.status}` };
      data = await response.json();
    } catch (error) {
      return { kind: 'unavailable', reason: `network:${causeCode(error)}` };
    }
    const status = (data.operatorStatus ?? '').trim();
    if (String(data.statusCode) !== '200' || !status) return { kind: 'unavailable', reason: `no_report:${data.statusCode ?? ''}` };
    const upper = status.toUpperCase();
    if (upper === 'DELIVERED') return { kind: 'delivered', providerStatus: status };
    // The documented failure statuses (absent/busy/barred/unidentified
    // subscriber, SMS failed, system failure, SMSC timeout) are final for this
    // message; anything that reads as in-flight is left pending.
    // Whole words: "ABSENT subscriber" is a final failure, not "SENT".
    if (/\b(PENDING|SUBMITTED|ACCEPTED|ENROUTE|PROCESSING|QUEUED|SENT)\b/.test(upper)) return { kind: 'pending', providerStatus: status };
    return { kind: 'failed', providerStatus: status };
  }

  async balance() {
    try {
      const response = await this.post('BalanceCheck', {});
      if (!response.ok) return null;
      const data = await response.json() as { statusCode?: string; data?: Array<{ balance?: string; expair_Date?: string }> };
      const row = data.data?.[0];
      return String(data.statusCode) === '200' && row?.balance !== undefined ? { balance: String(row.balance), expiresOn: row.expair_Date } : null;
    } catch {
      return null;
    }
  }
}
