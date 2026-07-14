# Provider Integration Guide

This guide documents how to wire real provider credentials for SMS, email, courier, and payment services in Bangladesh. All credentials are read from environment variables — no code changes required.

## Provider Registry

The `providerRegistry` (in `src/adapters/index.ts`) auto-registers providers on app startup based on which env vars are set. Only providers with credentials are registered — calling an unregistered provider returns a typed error.

```typescript
// src/adapters/providers.ts — registerProviders()
if (process.env.SSL_SMS_API_KEY) providerRegistry.registerSms(new SslSmsProvider());
if (process.env.SENDGRID_API_KEY) providerRegistry.registerEmail(new SendGridEmailProvider());
if (process.env.PATHAO_API_KEY) providerRegistry.registerCourier(new PathaoCourierProvider());
if (process.env.BKASH_APP_KEY) providerRegistry.registerPayment(new BkashPaymentProvider());
providerRegistry.registerRisk(new InternalRiskProvider()); // always available
```

## SMS Providers

### SSL Wireless (recommended)

SSL Wireless is the most popular bulk SMS gateway in Bangladesh. Supports Bangla Unicode.

1. **Sign up**: https://sms.sslwireless.com/
2. **Get credentials**: Dashboard → API → API User/Pass + Sender ID
3. **Configure env**:
   ```bash
   SSL_SMS_API_URL=https://smsapi.sslwireless.com/pushapi
   SSL_SMS_API_KEY=your-api-user
   SSL_SMS_API_PASS=your-api-pass
   SSL_SMS_SENDER_ID=YourBrand  # 11 chars max, alpha-numeric
   ```
4. **Test**:
   ```bash
   curl -X POST http://localhost:3000/api/v1/communications/sms \
     -H "Cookie: erp_access=..." \
     -H "Content-Type: application/json" \
     -d '{"to":"+8801712345678","message":"Test from SSL Wireless"}'
   ```

### Mim SMS (alternative)

```bash
MIM_SMS_API_URL=https://portal.mimsms.com/api/sms/v1/send
MIM_SMS_API_KEY=your-bearer-token
```

## Email Provider

### SendGrid

1. **Sign up**: https://sendgrid.com/
2. **Verify sender**: Sender Authentication → Single Sender Verification
3. **Create API key**: Settings → API Keys → Create Key (Restricted → Mail Send)
4. **Configure env**:
   ```bash
   SENDGRID_API_KEY=SG.xxxxxxxx
   SENDGRID_FROM_EMAIL=noreply@yourdomain.com
   ```
5. **Test**:
   ```bash
   curl -X POST http://localhost:3000/api/v1/communications/email \
     -H "Cookie: erp_access=..." \
     -H "Content-Type: application/json" \
     -d '{"to":"user@example.com","subject":"Test","htmlBody":"<p>Hello</p>"}'
   ```

### AWS SES (alternative)

```bash
SES_REGION=ap-south-1
# Requires @aws-sdk/client-sesv2 (not bundled by default — install if needed)
```

## Courier Providers

### Pathao

1. **Sign up**: https://merchant.pathao.com/
2. **Get API keys**: Dashboard → API → Create API Key
3. **Configure env**:
   ```bash
   PATHAO_API_URL=https://api-qa.pathao.com/v1  # use https://api.pathao.com/v1 for production
   PATHAO_API_KEY=your-client-id
   PATHAO_SECRET_KEY=your-client-secret
   PATHAO_STORE_ID=12345  # your store ID from Pathao dashboard
   ```
4. **Test quote**:
   ```bash
   curl -X POST http://localhost:3000/api/v1/deliveries/quote \
     -H "Cookie: erp_access=..." \
     -H "Content-Type: application/json" \
     -d '{"fromArea":"Dhaka","toArea":"Chittagong","weight":0.5,"codAmount":1500}'
   ```

### RedX (alternative)

```bash
REDX_API_URL=https://sandbox.redx.com.bd/v1  # use https://api.redx.com.bd/v1 for production
REDX_API_KEY=your-access-token
```

### Courier Webhook Receiver

Both Pathao and RedX send status callbacks to your server. Configure the webhook URL in the provider dashboard:

```
https://your-domain.com/api/v1/webhooks/courier/pathao
https://your-domain.com/api/v1/webhooks/courier/redx
```

Set a shared secret for webhook auth:
```bash
COURIER_WEBHOOK_TOKEN=your-random-secret  # at least 32 chars
```

The provider must send `X-Courier-Token: <your-secret>` header. The receiver verifies and updates the delivery order status.

## Payment Providers

### bKash (Tokenized Checkout)

1. **Sign up**: https://developer.bka.sh/ (sandbox) or contact bKash for production
2. **Create app**: Dashboard → Sandbox → Create App → get App Key, App Secret, Username, Password
3. **Configure env**:
   ```bash
   BKASH_API_URL=https://tokenized.sandbox.bka.sh/v1.2.0-beta  # production: https://tokenized.pay.bka.sh/v1.2.0-beta
   BKASH_APP_KEY=your-app-key
   BKASH_APP_SECRET=your-app-secret
   BKASH_USERNAME=your-username
   BKASH_PASSWORD=your-password
   ```
4. **Initiate payment**:
   ```bash
   curl -X POST http://localhost:3000/api/v1/payments/initiate \
     -H "Cookie: erp_access=..." \
     -H "Content-Type: application/json" \
     -d '{"amount":1500,"currency":"BDT","reference":"INV-001","returnUrl":"https://yourdomain.com/payment/callback"}'
   # Returns: { gatewayUrl, gatewayTxnId }
   ```
5. **Receive webhook**: bKash calls your callback URL after payment completes. The receiver at `/api/v1/webhooks/payment/bkash` verifies and updates the Payment record.

### Nagad (alternative)

```bash
NAGAD_API_URL=https://sandbox-ssl.mynagad.com/api/dfs  # production: https://api.mynagad.com/api/dfs
NAGAD_MERCHANT_ID=your-merchant-id
# Nagad uses RSA encryption for sensitive data — full integration requires additional setup
```

### Payment Webhook Receiver

```
https://your-domain.com/api/v1/webhooks/payment/bkash
https://your-domain.com/api/v1/webhooks/payment/nagad
```

The receiver verifies the provider signature, looks up the local Payment by `providerReference`, and updates status to `completed` or `failed`. If the sale total is now covered, the Sale is marked `paid`.

## Risk Provider

The `InternalRiskProvider` (in `src/adapters/riskProvider.ts`) runs 8 rule-based checks using local data — no external API call required. It's always registered.

Rules:
1. Subject-type base score (lead +5)
2. Customer outstanding AR (> ৳1L → +50, > ৳50K → +15)
3. Order velocity (count > 20 in 24h → +30, amount > ৳2L in 24h → +30)
4. Return ratio (> 0.4 → +25, > 0.2 → +10)
5. Failed payments (> 3 → +20)
6. Inactive customer → BLOCK (score 100)
7. Credit limit exceeded → +40
8. Sale amount tier (> ৳5L → +20, > ৳1L → +10)

Decision thresholds: score ≥ 70 → block, ≥ 35 → review, else allow.

All thresholds are configurable via env vars (see `src/adapters/riskProvider.ts`).

## Credential Encryption at Rest

Provider credentials stored in the `integration_credentials` table are encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY`. Never commit the encryption key — rotate it via the admin UI (TODO: not yet implemented).

## Verifying Registration

After setting env vars and restarting the app, check the server log for:
```
[providers] Registered providers: [ 'sms', 'email', 'courier', 'payment', 'risk' ]
```

Or query the registry programmatically:
```typescript
import { providerRegistry } from '@/adapters';
providerRegistry.getSms('ssl_wireless'); // SslSmsProvider | undefined
```
