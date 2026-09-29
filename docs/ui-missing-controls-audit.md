# Missing controls and workflow audit

Date: 2026-09-28. Scope: all 41 dashboard route entrypoints, shared navigation, shared access/catalogue components, and supporting API/print routes. This is a source and interaction audit, not a claim that every business workflow has received populated end-to-end UAT. Prior layout/accessibility passes did not establish feature completeness.

## Fixed during this review

| Finding | Change |
|---|---|
| Home was discoverable only as Overview inside navigation; mobile users had to open the drawer | Added an explicitly labelled Home link to the persistent header, visible on desktop and mobile, with keyboard focus and a 44px touch target. |
| Create/report pages lacked a consistent direct route back to their parent | Added parent-page links for product creation and nested inventory/accounting pages. Product details keep their existing return control. Links use explicit destinations, not browser history, so direct entry works. Existing access navigation remains unchanged to avoid dropping company context through a new generic link. |
| Journal form could add lines but could not remove an accidental extra line | Added named Remove line buttons. At least two lines remain, matching the existing API minimum. Removal only changes the local draft and does not submit. |
| Purchase form could add lines but could not remove an accidental extra line | Added named Remove line buttons, retaining at least one line. Payload structure and submission remain unchanged. |
| Failed checkout-option reads left POS blocked without a retry control | Added Retry checkout options, using the same read endpoints and preserving the existing cart. |

## High-priority missing workflows

### Implementation progress — 2026-09-29

The following changes are **implemented, verification pending** unless explicitly stated otherwise. They are not yet a completed audit. Remaining rows below remain authoritative; none is waived by this progress note.

| Work item | Current evidence / next gate |
|---|---|
| Purchase branch/warehouse identity | Form now uses selected warehouse's `branch.id` and warehouse `id`; searchable supplier/warehouse/product controls. Real browser creation still pending. |
| Purchase detail / receiving | Detail quantities, partial receiving, serial/batch/date fields, confirmation, retry-stable idempotency key and history implemented. Serialized-product and duplicate-line domain validation added. Disposable MariaDB ledger suite **5/5 passed**, including partial serialized receipt; browser UAT pending. |
| Purchase history access | Server cursor pagination, reference/supplier search and validated date range; UI filters and Load older purchases implemented. Browser pagination checks pending. |
| Print authorization | Invoice/receipt now use normal session authentication, `sale.read`, tenant context and branch authorization. Arbitrary network-printer target disabled; download/browser printing retained. Receipt allocation/method mapping corrected. Permission and document browser tests pending. |
| Transfer workflow | Create/detail/dispatch/receive/cancel UI and tenant-scoped detail API implemented. Existing commands reused. Serialized transfer handling and populated browser lifecycle still require verification/remediation. |
| Cashier / opening stock entity fields | Warehouse picker added; cashier branch derived from warehouse and cash-account picker filtered by branch/type/active status. Browser transactions pending. |

Shared additions: searchable `EntityPicker` with paginated options/error recovery; `useWorkflowMutation` retains idempotency keys across ambiguous failures. Stock count save/review/post endpoints and service state-transition endpoint were confirmed absent and remain implementation work, not external blockers.

P1 means a core operating task is blocked or error-prone. P2 means important usability or coverage is missing. No P0 outage was established by this review.

| Priority | Missing control / element | Evidence and impact | Required completion |
|---|---|---|---|
| P1 | **Receive stock / purchase details** | `src/app/(erp)/dashboard/purchases/page.tsx` lists orders and receiving counts but has no detail/receive action. `/api/v1/purchases/[id]` and `/api/v1/purchases/[id]/receivings` exist. A visible purchase order cannot be received through this screen. | Detail view, remaining quantities, serial capture where required, receiving confirmation and partial/full receiving feedback. Verify permission and transaction contracts before wiring actions. |
| P1 | **Branch/warehouse/account/customer pickers** | Purchase, cashier, opening-stock, expense and service forms ask operators for UUIDs. Purchase submission currently sets `branch_id: warehouseId` alongside `warehouse_id: warehouseId`. A warehouse ID is not a branch selector. | Replace internal-ID entry with scoped entity pickers and derive identifiers from authoritative option records. Verify branch/warehouse associations with real transactions; do not merely rename labels. |
| P1 | **Return / refund workflow** | Sales has Refresh and Void, but no Return action. `/api/v1/sale-returns` exists. Returning sold items is not the same operation as voiding an invoice. | Sale/item selection, eligible quantities, condition/restock choices, refund handling and confirmation using existing business rules. |
| P1 | **Invoice / receipt access after checkout** | POS clears the cart after a transient success toast; Sales has no invoice/receipt links. `/print/invoice/[id]` and `/print/receipt/[id]` exist and both take a **sale ID**, not a payment ID. | Persistent posted-sale confirmation and reprint access. First review print-route authorization: inspected routes verify JWT and company but do not use the normal session/permission/branch authorization path. Do not expose them through new controls before that review. |
| P1 | **Inventory transfers, adjustments and counts** | Inventory exposes opening stock, stock listing and refresh; no dashboard entrypoints implement transfer dispatch/receive, stock adjustments or counts. Corresponding API routes exist. | Permission-filtered entrypoints plus full forms/status/history; explicit confirmation for stock-changing operations. Buttons alone would not implement these workflows. |
| P1 | **Service parts / work actions** | Service provides intake and read-only request cards. No action opens a request or consumes parts even though `/api/v1/service-requests/[id]/parts` exists. | Request detail, parts selection and quantities, relevant state transitions, completion/delivery feedback. Confirm which transitions the backend actually supports. |
| P1 | **POS customer and split-payment controls** | POS offers one payment method/account, creates a one-element `payments` array and has no customer selector in its submitted payload. | Customer selection and multiple tender rows with validation against authoritative sale totals. This changes workflow behavior and needs dedicated transaction tests. |
| P2 | **Older sales/purchases, search and date filters** | These screens fetch `limit=50` without paging controls. Operators cannot reliably reach older records from the current UI. | Search/date filters and pagination matched to verified API contracts; do not imply that a partial list is all records. |
| P2 | **Business detail views instead of raw JSON** | Payment and expense View links open API endpoints; Fiscal Periods opens the API directly. | Readable detail pages or drawers with safe back navigation, status and permitted actions. |
| P2 | **Create/edit actions in CRM and HR** | CRM lead cards and the HR employee table are largely read-only; no create/detail/action entrypoints in those pages. | Define supported actions from API/permission contracts, then provide complete forms and recovery states. |
| P2 | **Catalogue edit/delete, access Cancel, draft protection** | Catalogue explicitly lacks editing/deletion; access editors lack an explicit Cancel control; navigation has no general unsaved-draft warning. | Separate catalogue lifecycle design; company-preserving cancel links; selective draft-loss confirmation for populated forms. Avoid automatic destructive actions or storing sensitive drafts without a design. |

These are confirmed UI gaps, not implementations delivered by this audit. No business API, accounting calculation, stock mutation, authorization rule or schema was modified in this pass.

## Verification

The full presentation suite passed **75/75 checks** in 6.2 minutes (`.local/control-audit-browser.log`). After the final duplicate-Back exclusion and defensive minimum-line guards, all **6 affected checks passed** again (`.local/control-audit-final-browser.log`). These checks include mobile Home, direct-entry parent navigation, line removal retaining other draft values, theme/viewport coverage and product error recovery. POS checkout-option retry also passed with a populated cart and zero sale submissions.

Final TypeScript and scoped lint checks both passed (exit 0); `git diff --check` passed. Logs: `.local/control-audit-final-types.log` and `.local/control-audit-final-lint.log`. Request/payload comparison found no new differences from the preceding UI work. All browser API traffic in this suite is synthetic; none of these tests post real transactions. A fresh production build was not run for this review. Concurrent Prisma/domain changes were preserved and are not part of this audit's fixes.

## Route inventory

The inventory below counts local Button/button/Link/a JSX elements and extracts static text. Dynamic controls, shared components and conditional permissions mean counts are not runtime button totals. A zero does **not** mean a screen has no actions. The shared Home control applies to every authenticated dashboard page. This inventory supports coverage; findings above come from tracing actual handlers and endpoints.

| Route | Local action elements | Static action text found |
|---|---:|---|
| /dashboard | 1 | Shared components or dynamic controls |
| /dashboard/access/permissions | 0 | Shared components or dynamic controls |
| /dashboard/access/roles | 0 | Shared components or dynamic controls |
| /dashboard/access/roles/[id] | 0 | Shared components or dynamic controls |
| /dashboard/access/users | 0 | Shared components or dynamic controls |
| /dashboard/access/users/[id] | 0 | Shared components or dynamic controls |
| /dashboard/accounting | 7 | View Journal →; View Trial Balance →; View Expenses →; View Fiscal Periods API → |
| /dashboard/accounting/journal | 6 | New Entry; Remove line; Add Line; Cancel; Post Entry; Refresh |
| /dashboard/accounting/trial-balance | 0 | Shared components or dynamic controls |
| /dashboard/assets | 6 | Refresh; Acquire Asset; Cancel |
| /dashboard/audit | 3 | Refresh; • •; Load more |
| /dashboard/bank-reconciliation | 10 | Refresh; New Reconciliation; Create; Cancel; · matched: / sys: / stmt: System: ৳ Stmt: ৳ Var: ৳; Auto Match; Finalize; Clear; · ৳ |
| /dashboard/cashier | 3 | Open Shift; Refresh; Close |
| /dashboard/catalogue | 2 | Go to Products → |
| /dashboard/communications | 6 | Refresh; All ( ); Open; Mark read |
| /dashboard/crm | 2 | Today&rsquo;s Actions ( ); Refresh |
| /dashboard/deliveries | 2 | Refresh |
| /dashboard/expenses | 9 | New Expense; Add Line; x; Cancel; Submit Expense; Refresh; View; Approve |
| /dashboard/feature-flags | 0 | Shared components or dynamic controls |
| /dashboard/gift-cards | 2 | Issue Card |
| /dashboard/hr | 1 | Refresh |
| /dashboard/imports | 4 | Errors; Download |
| /dashboard/integrations | 5 | Add; Copy secret; I have saved it; Create |
| /dashboard/inventory | 6 | Post Opening Stock; Low Stock ( ); Refresh |
| /dashboard/inventory/opening-stock | 4 | Add Line; Cancel; Post Opening Stock |
| /dashboard/onboarding | 1 | Shared components or dynamic controls |
| /dashboard/parties | 4 | Shared components or dynamic controls |
| /dashboard/payments | 6 | New Payment; Cancel; Record Payment; Refresh; View |
| /dashboard/pos | 10 | Retry; Clear search; ৳; Retry checkout options; Complete Sale — ৳; Clear; Checkout |
| /dashboard/products | 6 | New Product; ৳; Load more |
| /dashboard/products/[id] | 4 | Back to products; Activate; Add Barcode |
| /dashboard/products/new | 2 | Cancel |
| /dashboard/purchases | 5 | New Purchase; Add Line; Remove line; Cancel; Create Purchase Order |
| /dashboard/reports | 3 | Run Report; CSV; PDF |
| /dashboard/risk-tuning | 4 | Refresh; Save Outcome; Cancel |
| /dashboard/sales | 3 | Refresh; POS; Void |
| /dashboard/security | 1 | Load more |
| /dashboard/service | 3 | New Intake; Cancel; Create Intake |
| /dashboard/settings | 2 | Register New Passkey |
| /dashboard/support | 2 | Submit Ticket; Close |
| /dashboard/system | 0 | Shared components or dynamic controls |
