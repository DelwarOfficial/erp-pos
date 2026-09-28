# Due reminders — operations runbook

Customer due reminders by SMS (blueprint §5.11A, ADR 0008). Everything here runs in the worker process (`bun run worker` / `Dockerfile.worker`); the web process only records sales, collections and settings.

## Turning it on for a company

1. **MiMSMS account** (the company's own). In the MiMSMS panel (sms.mimsms.com):
   - Utility → Developer: **activate** the API key.
   - Utility → Developer: **whitelist the worker server's static public IP and the domain.** Requests from anywhere else are refused. A dynamic IP will not work reliably.
   - Utility → Sender ID: note the exact registered Sender ID.
2. `PUT /api/v1/communications/sms-account` with `user_name` (panel login email), `api_key`, `sender_name`. The key and login are stored encrypted and can never be read back; to change them, PUT again.
3. `PUT /api/v1/communications/reminder-policy` with `enabled: true` and the stages, window and limits. Nothing is sent while it is off (the default).
4. Credit sales need the `credit_sales` feature flag and customers with a credit limit.

No environment variables are involved: accounts are per company. The worker needs `REDIS_URL`, `DATABASE_URL` and `APP_ENCRYPTION_KEY` (the same key as the web process, or stored credentials cannot be decrypted).

## Queues

| Queue | Job | Schedule | Attempts |
|---|---|---|---|
| `due-reminders` | `tick` | every 5 minutes (repeatable, id `due-reminder-tick`) | 1 |
| `sms-send` | `send` `{ companyId, messageId }` | enqueued by the tick | 1 (the engine decides retries) |

A tick, per company: plan today's stages → queue messages inside the sending window → mark sends interrupted for over 10 minutes as `unknown` → poll delivery reports → enqueue sends. A failure for one company is logged and reported to Sentry, and does not stop the others.

## Message states

| State | Meaning | Action |
|---|---|---|
| `queued` | waiting to send (maybe backing off: `next_attempt_at`) | none |
| `sending` | claimed by a worker | none; becomes `unknown` if stuck >10 min |
| `sent` | MiMSMS accepted it (`provider_message_id` = tracking ID) | none |
| `delivered` / `failed` (`failure_category = delivery`) | from the delivery report | none |
| `failed` (`permanent`) | refused: bad credentials, Sender ID, number, or `sms_account_not_configured` | fix the account or number; the message is not retried |
| `dead_letter` | temporary refusals exhausted the retries | check MiMSMS availability and IP whitelisting |
| `skipped` / `cancelled` | revalidation stopped it (`last_error_code`: `paid`, `due_date_changed`, `opted_out`, `customer_daily_limit`, `stage_passed`, …) | none |
| **`unknown`** | **the provider may or may not have sent it** | **see below** |

## `unknown` messages — never replay blindly

A timeout, a connection lost mid-request, an unreadable response, or a worker crash during a send leaves the outcome unknown. MiMSMS offers no idempotency key or lookup by our reference, so a retry could send the customer the same reminder twice and bill twice. These are never retried automatically.

To resolve one: find the destination number and the `claimed_at` time, check the MiMSMS panel's sent-SMS report for that number around that time, and record the outcome in **SMS & Reminders → History**, filtered by status `unknown`: "It was sent" or "Not sent" (needs `communication.sms_provider.manage.company`; audited as `sms_message.resolve_unknown`). Neither resends anything; if unsure, leave it `unknown` — the next stage will remind the customer if they still owe. The Collections page shows a banner while any message from the last 7 days is unknown.

## Troubleshooting

- **Every send `failed` with an authentication error:** the API key is not activated, or was regenerated in the panel. PUT the account again.
- **Every send `dead_letter` / network errors:** the worker's outbound IP is not whitelisted, or MiMSMS is down.
- **Nothing queued:** the policy is off, it is outside the sending window (company local time), or no installment is at a stage today. Occurrences with `skip_reason` say why a specific one was skipped.
- **A customer got no reminder:** check `reminder_occurrences` for the installment: `missing_phone` / `invalid_phone` (fix the customer's number or the sale's reminder number), `opted_out`, `paid`, `below_minimum`.

## Failure and rollback

- The migration `20260928000100_receivables_reminders` is additive. If the application must be rolled back, leave the schema; the older code ignores the new tables and columns.
- Worker down: nothing is sent; stages missed on the days it was down are cancelled, not sent late. Health (`/api/v1/health`) reports the worker as failed.
- To stop all sending for a company immediately: set its policy `enabled: false`. Queued messages are then cancelled at their next send attempt (`policy_disabled`).
