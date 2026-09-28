# ADR 0008 — Customer dues, collections and SMS due reminders

- Status: Accepted (Phase 1 implemented 2026-09-28)
- Scope: credit sales, installment schedules, collections, the due reminder engine, the SMS gateway

## Context

Credit sales booked their unpaid part to accounts receivable, but nothing said when it was due: the `installments` table existed and no code wrote to it. Collections through `POST /payments` credited AR in the ledger without linking the money to any sale, so no sale or installment could be shown as paid. The `outbound_messages` table existed unused, and the MiMSMS adapter called an endpoint and authentication scheme the provider does not document.

## Decisions

### 1. The ledger stays the only financial truth; schedules are derived
Nothing about what a customer owes is stored. An installment's outstanding amount is its amount less the installment allocations of payments still `posted`, capped by what the whole sale still owes (the AR-aging formula: grand total − live payment allocations − posted return credits + refunds paid against them). Credits that reach a sale without passing through an installment — a return, an applied advance — come off the oldest outstanding installment first. Reminder rows are never financial truth. Code: `src/domain/receivables/balances.ts`.

### 2. Every credit sale has a schedule
`PostSale` accepts a payment arrangement: one due date, or installments that must add up to the unpaid amount exactly, in Decimal, to the paisa — a schedule that does not is refused, not adjusted. A credit sale without an arrangement (older API, offline and import callers) gets one installment due after `DEFAULT_CREDIT_DAYS` (30). Code: `schedule.ts`.

### 3. Collections are applied oldest due first
`CollectCustomerPayment` (`POST /customers/{id}/collections`) applies the amount to the customer's open installments by due date, then sale, then installment number — or to the sales the cashier picks. Each installment touched gets one payment allocation and one installment allocation, in the same transaction as the payment and its journal (Dr cash/bank, Cr AR, tagged with the customer and branch). The customer row is locked first, so concurrent collections for one customer are serialised.

- **Partial payment** reduces the oldest installment; the remainder stays owed.
- **Overpayment** is refused, pointing to the customer-advance flow; it is never booked as negative AR.
- **Reversal** needs no special handling: a reversed payment stops counting, so its installments reopen and reminders resume.
- **Refunds** follow the existing return semantics through the sale-level cap.

### 4. Promise-to-pay does not rewrite the due date *(planned, Phase 3)*
The contractual due date stays on the installment; a promise will be its own record, so aging stays truthful.

### 5. Reminders are asynchronous and idempotent by construction
- A **reminder occurrence** is unique on (company, installment, stage offset, due date). Scheduler reruns and concurrent schedulers insert it once (`INSERT IGNORE` on the unique key). A changed due date is a new identity; the old occurrence is cancelled when checked.
- A **message** is unique per occurrence (`outbound_messages.reminder_occurrence_id UNIQUE`).
- A send **claims** the message with a conditional update (`queued → sending`); only one worker can win. Every later status change is conditional on the expected current status, so a duplicate or late job can never move a message backwards.
- MariaDB aborts one of two conflicting transactions; the engine treats that as "another run owns this" and gives way.

### 6. Revalidate immediately before sending
After claiming and before calling the provider, the sender re-reads the installment, the sale, the balance, the policy and the customer's SMS consent, and renders the text with the amount owed *now*. Paid in full: skipped. Partly paid: the current remainder. Due date moved, sale voided, reminders turned off, stage day passed: cancelled. The provider call happens outside any database transaction.

### 7. Ambiguous outcomes are never retried
MiMSMS documents no idempotency key and no lookup by our own reference. A send that times out, loses its connection mid-request, or returns an unreadable success cannot be verified, so it becomes `unknown` and is never resent automatically. A message left in `sending` by a crash becomes `unknown` after 10 minutes, for the same reason. Only outcomes that prove nothing was sent (connection refused, DNS failure, HTTP 5xx or 429) are retried, with backoff (1, 5, 15, 60 minutes), then `dead_letter`.

### 8. SMS providers sit behind a gateway; each company uses its own account
`SmsGateway` (`src/lib/sms/gateway.ts`) is the only surface the reminder engine uses. `MimSmsGateway` implements the documented MiMSMS v2.1 API. Each company stores its own MiMSMS login, API key and Sender ID, encrypted, in `integration_credentials` (provider `mimsms`); no company can send or spend on another's account. Credentials are write-only through the API and never logged or audited.

### 9. Tenant context in workers
The worker lists company ids (the one read outside a tenant context) and does all of each company's work inside that company's tenant context (`userId: system:due-reminders`, all branches). Raw SQL states the company explicitly.

### 10. Dates are company-local calendar dates
A due date is a calendar date in the company's time zone, stored as that date at 00:00 UTC. "Today", stage days, sending windows and daily limits use the company's time zone, never the server's.

## Consequences

- Credit exposure and overdue checks in `PostSale` now come from installment balances. The previous check refused credit to any customer with any sale older than 30 days, including sales paid in full.
- An `unknown` message needs a person: check the MiMSMS panel's send history for the number and time, then mark the message accordingly (Phase 2 UI). Never replay it blindly.
- A reminder stage missed because the worker was down all day is not sent late; it is cancelled as `stage_passed`.
