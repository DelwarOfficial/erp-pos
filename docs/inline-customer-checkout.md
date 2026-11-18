# Inline customers in New Sale

New Sale reuses `GET /api/v1/customers` for name/phone searches and `POST /api/v1/customers` for creation. Both existing permission checks remain server-authoritative. The customer-create schema is shared between the route and inline form; its fields, validation and defaults are unchanged.

The dialog requires name and accepts optional phone according to the existing create API: up to 30 characters. Bangladesh mobile validation remains specific to reminders. Credit limits are not edited during checkout; a new customer retains the API's zero-credit default, and the existing sale quote rechecks credit eligibility after selection.

The current customer model has no unique name or phone constraint. Matches are advisory, never merged or silently selected. Operators can select an active existing customer or explicitly create a separate record. Saving waits for the current match search; a failed search offers retry instead of silently skipping the check.

`useWorkflowMutation` provides the in-flight lock and retained idempotency key. Failed data is kept, including when a failed dialog is closed and reopened. Retrying unchanged details reuses the key. API failures expose their status to the form without changing existing mutation callers.

Opening or completing the dialog changes only the selected customer and dialog state. Cart lines, serials, discounts, payment drafts and installment drafts stay in the New Sale component. Walk-in remains available in fully paid mode; credit requires a saved customer.

## Verification

Run `npx playwright test --config playwright.inline-customer.config.ts` against a running local app. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` only when using an existing Chromium installation instead of Playwright's default.

The browser suite mocks every API request, blocks external traffic, and requires no login, database, seeding, customer writes, sale posting or provider calls. It covers search, creation, advisory duplicates, read/create denials, match-search recovery, uncertain-save retry, keyboard/focus, English/Bengali rendering, light/dark accessibility, and checkout draft preservation with credit revalidation.

`tests/unit/customerCreateSchema.test.ts` verifies the existing contract and defaults. Run it with the repository's disposable-database guard as configured; these schema tests make no database calls. Browser fixtures do not establish backend idempotency, authorization or database integrity beyond the pre-existing server implementation.
