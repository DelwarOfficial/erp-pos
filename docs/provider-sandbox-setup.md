# Provider Sandbox Credentials Setup Guide

This guide explains how to obtain sandbox credentials for each Bangladesh
payment, SMS, email, and courier provider, and how to configure them in
your local `.env.staging` file for UAT testing.

## Quick Start

```bash
# 1. Copy the staging template
cp .env.staging.example .env.staging

# 2. Edit .env.staging — replace all CHANGE_ME_* and sandbox-* placeholders
#    with real sandbox credentials (see sections below)

# 3. Activate staging env
cp .env.staging .env

# 4. Verify all providers are configured
bun run scripts/smoke-test-providers.ts

# 5. Start the staging server
bun run staging:dev
```

## Provider Mode

Set `PROVIDER_MODE` in `.env.staging`:

| Value | Use When | Behavior |
|-------|----------|----------|
| `mock` | Development, unit tests | All providers return success without API calls |
| `sandbox` | UAT / staging | Real provider sandbox/test endpoints |
| `live` | Production | Real production endpoints (never use in .env.staging) |

---

## Payment Gateways

### bKash (Tokenized Checkout)

1. **Apply for sandbox access:**
   - Visit https://developer.bka.sh/
   - Click "Sign Up" and create a developer account
   - Apply for "Tokenized Checkout" API access
   - Wait for approval (usually 1-2 business days)

2. **Get your credentials:**
   - After approval, log in to the developer portal
   - Navigate to "Apps" → "Create App"
   - Select "Sandbox" environment
   - Copy: `APP_KEY`, `APP_SECRET`, `Username`, `Password`

3. **Configure in `.env.staging`:**
   ```bash
   BKASH_API_URL="https://tokenized.sandbox.bka.sh/v1.2.0-beta"
   BKASH_USERNAME="your-sandbox-username"
   BKASH_PASSWORD="your-sandbox-password"
   BKASH_APP_KEY="your-sandbox-app-key"
   BKASH_APP_SECRET="your-sandbox-app-secret"
   ```

4. **Test the integration:**
   - Use bKash sandbox test numbers: `01777777777` / `01619777777`
   - OTP for sandbox: `123456`
   - Reference: https://developer.bka.sh/api-info/Direct-API

### Nagad

1. **Apply for sandbox access:**
   - Visit https://developer.nagad.com.bd/
   - Click "Register" and create a merchant developer account
   - Apply for "Integration Sandbox" access
   - Contact Nagad developer support: developer@nagad.com.bd

2. **Get your credentials:**
   - After approval, log in to the developer portal
   - Navigate to "API Keys" → "Sandbox"
   - Copy: `MERCHANT_ID`, `API_KEY`
   - Download: `public_key.pem`, `private_key.pem`

3. **Configure in `.env.staging`:**
   ```bash
   NAGAD_API_URL="https://sandbox-ssl.mynagad.com/api/dfs"
   # For sandbox, Nagad uses a fixed keypair provided by developer support.
   # Store the keys in files and set the paths:
   # NAGAD_PUBLIC_KEY_PATH="/path/to/public_key.pem"
   # NAGAD_PRIVATE_KEY_PATH="/path/to/private_key.pem"
   ```

4. **Test the integration:**
   - Use Nagad sandbox test numbers: `01812345678`
   - OTP for sandbox: `123456`

---

## SMS Providers

### SSL Wireless

1. **Apply for sandbox access:**
   - Visit https://sms.sslwireless.com/
   - Click "Sign Up" and create an account
   - Contact sales@sslwireless.com for sandbox/test credentials
   - Purchase a sender ID (e.g., `ERP POS`)

2. **Get your credentials:**
   - Log in to the SMS panel
   - Navigate to "API Settings"
   - Copy: `API_KEY`, `API_PASSWORD`, `SENDER_ID`

3. **Configure in `.env.staging`:**
   ```bash
   SSL_SMS_API_URL="https://sms.sslwireless.com/pushapi/dynamic/server.php"
   SSL_SMS_API_KEY="your-api-key"
   SSL_SMS_API_PASS="your-api-password"
   SSL_SMS_SENDER_ID="YourSenderID"
   ```

4. **Test:** Send a test SMS to your own phone number.

### Mim SMS

1. **Apply for access:**
   - Visit https://mimsms.com/
   - Sign up and contact support@mimsms.com for API access
   - Purchase credits (minimum 100 BDT)

2. **Get your credentials:**
   - Log in to the panel
   - Navigate to "API Settings"
   - Copy: `API_KEY`

3. **Configure in `.env.staging`:**
   ```bash
   MIM_SMS_API_URL="https://api.mimsms.com/api/SmsSending/SMS"
   MIM_SMS_API_KEY="your-api-key"
   ```

---

## Email Providers

### SendGrid

1. **Apply for access:**
   - Visit https://sendgrid.com/
   - Sign up for a free account (100 emails/day free)
   - Verify your sender email address

2. **Get your API key:**
   - Navigate to Settings → API Keys → Create API Key
   - Select "Restricted Access" → Mail Send
   - Copy the API key (starts with `SG.`)

3. **Configure in `.env.staging`:**
   ```bash
   SENDGRID_API_KEY="SG.your-real-api-key"
   SENDGRID_FROM_EMAIL="staging-no-reply@yourdomain.com"
   ```

### Resend

1. **Apply for access:**
   - Visit https://resend.com/
   - Sign up (3,000 emails/month free)
   - Verify your sender domain

2. **Get your API key:**
   - Navigate to API Keys → Create API Key
   - Copy the API key (starts with `re_`)

3. **Configure in `.env.staging`:**
   ```bash
   RESEND_API_KEY="re_your-real-api-key"
   RESEND_FROM_EMAIL="staging-no-reply@resend.dev"
   ```

### AWS SES

1. **Apply for access:**
   - Visit https://aws.amazon.com/ses/
   - Sign in to AWS Console
   - Verify your email address (SES sandbox mode)

2. **Get your credentials:**
   - Navigate to SES → SMTP Settings → Create SMTP credentials
   - Copy: `ACCESS_KEY`, `SECRET_KEY`

3. **Configure in `.env.staging`:**
   ```bash
   SES_REGION="ap-south-1"
   # SES_ACCESS_KEY and SES_SECRET_KEY are loaded from AWS credentials
   # (environment or ~/.aws/credentials)
   ```

---

## Courier Providers

### Pathao

1. **Apply for sandbox access:**
   - Visit https://merchant.pathao.com/developer
   - Sign up for a merchant account
   - Apply for "API Access" → "Sandbox"

2. **Get your credentials:**
   - After approval, log in to the merchant panel
   - Navigate to "Developer Settings"
   - Copy: `API_KEY`, `SECRET_KEY`, `STORE_ID`

3. **Configure in `.env.staging`:**
   ```bash
   PATHAO_API_URL="https://courier-api-sandbox.pathao.com"
   PATHAO_API_KEY="your-sandbox-api-key"
   PATHAO_SECRET_KEY="your-sandbox-secret-key"
   PATHAO_STORE_ID="your-sandbox-store-id"
   ```

### RedX

1. **Apply for access:**
   - Visit https://redx.com.bd/business-api
   - Sign up and contact business@redx.com.bd for API access
   - Request sandbox credentials

2. **Get your credentials:**
   - After approval, log in to the business panel
   - Navigate to "API Settings"
   - Copy: `API_KEY`

3. **Configure in `.env.staging`:**
   ```bash
   REDX_API_URL="https://sandbox.redx.com.bd/v1"
   REDX_API_KEY="your-sandbox-api-key"
   ```

---

## Notification Channels

### Slack

1. **Create a Slack app:**
   - Visit https://api.slack.com/apps
   - Click "Create New App" → "From scratch"
   - Name it "ERP Staging Alerts"
   - Select your workspace

2. **Enable incoming webhooks:**
   - Navigate to "Incoming Webhooks" → toggle ON
   - Click "Add New Webhook to Workspace"
   - Select the `#erp-staging-alerts` channel
   - Copy the webhook URL (starts with `https://hooks.slack.com/services/`)

3. **Configure in `.env.staging`:**
   ```bash
   SLACK_WEBHOOK_URL="https://hooks.slack.com/services/Txxxx/Bxxxx/xxxx"
   SLACK_CHANNEL="#erp-staging-alerts"
   ```

### Telegram

1. **Create a Telegram bot:**
   - Open Telegram and message @BotFather
   - Send `/newbot` and follow the prompts
   - Copy the bot token (format: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

2. **Get your chat ID:**
   - Create a channel or use an existing one
   - Add the bot as an administrator
   - Send a message to the channel
   - Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` to find the chat ID

3. **Configure in `.env.staging`:**
   ```bash
   TELEGRAM_BOT_TOKEN="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
   TELEGRAM_CHAT_ID="-1001234567890"
   ```

---

## Verification

After configuring all providers, run the smoke test:

```bash
bun run scripts/smoke-test-providers.ts
```

Expected output (with all real sandbox keys configured):

```
PASS: 44   WARN: 0   FAIL: 0   TOTAL: 44
RESULT: READY for staging deployment.
```

If you see WARN items, those are providers with placeholder values —
replace them before live UAT testing.

---

## Security Notes

- **Never commit `.env.staging`** — it's in `.gitignore`
- **Rotate sandbox keys** every 90 days
- **Use a secrets manager** (AWS Secrets Manager / Doppler / Vault) in production
- **Restrict sandbox keys** to test endpoints only (not production)
- **Monitor sandbox usage** — providers may rate-limit or charge for sandbox calls

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| bKash returns 401 | Verify `BKASH_APP_KEY` and `BKASH_APP_SECRET` are from the sandbox portal, not production |
| SendGrid returns 403 | Verify your sender email is verified in the SendGrid dashboard |
| Pathao returns 404 | Verify `PATHAO_STORE_ID` is correct for the sandbox environment |
| SSL SMS returns "OK" but no SMS received | Check sender ID is approved for your account |
| Smoke test shows 0 providers registered | Set `PROVIDER_MODE=sandbox` and ensure at least one provider's env vars are set |
