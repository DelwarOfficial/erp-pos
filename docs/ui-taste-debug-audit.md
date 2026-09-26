# UI/UX debugging with taste-skill guidelines

Date: 2026-09-26. Scope: existing ERP/POS presentation, forms, responsive layout, accessibility and recovery states. This is a follow-up to `ui-modernization-audit.md`.

## Design direction

Applied `redesign-existing-projects`: scan, diagnose, then targeted fixes using the existing stack. `design-taste-frontend` explicitly excludes dashboards, so its landing-page layout and motion prescriptions were not applied. Retained Geist, Tailwind 4, Radix/shadcn, semantic light/dark colors and permission-filtered navigation. Dense operational screens need readable forms and predictable actions rather than marketing effects.

## Confirmed defects and changes

| Finding | Change |
|---|---|
| Visible labels did not name or focus their controls | Connected 59 labels across 11 modules. Repeated rows use index-qualified IDs; existing IDs are preserved. |
| Journal, opening-stock, purchase and service forms retained desktop column counts on phones | Added responsive field grids and sufficient space for product/account selectors, quantities and costs. |
| Opening-stock removal action lacked an accessible name | Added a numbered remove-line label. |
| Long select values could exceed their container | Bounded the shared select trigger. |
| Touch icon buttons had 44px height but narrower hit areas | Added 44px minimum button width on coarse pointers and readable 16px native form controls. |
| Financial table digits used proportional spacing | Enabled tabular numerals in the shared table. No values or formatting calculations changed. |
| Failed webhook list requests appeared to be an empty list | Added distinct loading, error, retry and empty states, including response-shape validation. |
| Webhook creation showed only the first 16 secret characters in a transient toast | Added a complete, masked, in-memory secret with reveal, copy and explicit dismissal. No persistence or secret logging was added. New creation is disabled until the current secret is dismissed. |
| An unused GET request targeted the POST-only offline-sync route | Removed this request and replaced misleading availability text. The POST API is unchanged. |
| Catalogue fields lacked unique associations; edit/delete actions only showed unavailable toasts | Added instance-specific IDs with `useId`, connected all generated labels, exposed read failures with retry and replaced nonfunctional editing/deletion with an availability notice. Creation requests remain unchanged. |
| Security severity filter and repeated risk outcome controls lacked accessible names | Named the severity filter and connected outcome type, amount and notes labels using each alert ID. |
| POS global Enter shortcut intercepted keyboard activation of buttons and dropdowns | Preserve focused controls' Enter behavior, handled events, composition and held keys. Extended populated-cart coverage to remove an item with keyboard activation. Checkout request and calculation logic are unchanged. |
| Product setup and opening-stock option failures were silent | Added explicit loading/error/retry states for existing read endpoints. |
| Shared Retry buttons inherited form-submit behavior | Set their type to button and added a retry-with-filled-stock-fields regression check. |
| Missing routes and unexpected dashboard rendering failures lacked useful recovery | Added a 404 destination link and a dashboard error boundary with retry and transaction-status guidance. Used installed Next 16 documentation for `unstable_retry`. |

## Verification and limits

- Final TypeScript and scoped source lint checks passed (exit 0); `git diff --check` passed. Logs: `.local/taste-types-complete.log` and `.local/taste-lint-complete.log`.
- The completed 68-check browser sweep passed 60 checks. Two failures identified unnamed catalogue and security controls, now fixed. Six routes timed out during navigation before assertions: POS, products, purchases, reports, risk tuning and sales. The two fixed routes, six timed-out routes and two newly added checks (catalogue creation and coarse-pointer touch targets) still require successful final browser verification. Subsequent reruns stalled during preview compilation/navigation; they are not counted as passes.
- A source-level request/payload comparison reviewed 52 changed TSX files against the modernization baseline. Only integrations differed: removal of the unused offline-sync GET. Mutation request bodies remained unchanged. This is a source check, not backend execution coverage.
- Expanded `tests/e2e/presentation.spec.ts` from 57 to 70 checks. The suite now opens key forms, checks named controls and usable field widths, verifies complete one-time secret handling and non-submitting retries, checks catalogue creation, touch targets and the 404, and runs axe on each dashboard route in both themes in addition to eight-width overflow checks.
- All API traffic in these tests uses fixtures. No real financial, inventory, access or webhook mutations occur. These tests do not prove authorization or backend transaction behavior.
- The temporary preview uses a nonfunctional database target and no copied `.env` files. During diagnosis it uses installed Geist font fixtures and disables telemetry only in its temporary copy.
- Browser traces identified a development-only verification conflict: production CSP disallows the `eval` used by webpack development bundles. Pages rendered server HTML but could not hydrate. The temporary preview permits development evaluation; the repository's production CSP is unchanged. Development fixture passes are not a production CSP or telemetry validation.
- Existing Prisma/schema/index changes belong to concurrent work and were preserved. This task authored no backend, authorization, schema, migration or financial-calculation changes. A concurrent session committed presentation changes during this audit; this task did not issue a commit.

## Remaining coverage

### Sequential follow-up (2026-09-26)

1. **Preview / build:** reproduced compiler stalls with webpack production compilation and a fresh UI-only development copy. The UI-only copy excludes API routes and middleware and cannot validate their runtime behavior. Production build completion remains unverified.
2. **Browser checks:** final route/accessibility reruns remain pending. The populated POS keyboard regression also needs a successful browser run; the earlier populated-cart pass predates this change.
3. **Workflow integrity:** user selected the existing disposable test environment. Ran `scripts/verify-access-tests.mjs` with `generalLedgerCoverage`, `postSale`, `paymentRefundIdempotency`, `paymentReversalAccounting` and `inventoryValuationIntegrity`: **5 files / 26 tests passed**. The guarded target was local MariaDB `127.0.0.1:43318/readiness_20260912_disposable`. The first two suites exercise real disposable database transactions; the remaining checks do not substitute for browser UAT. Production invariants intentionally prevented some fixture teardown; synthetic test records remain in the disposable database. Evidence: `.local/taste-workflow-validation.log`.
4. **Keyboard:** fixed POS Enter interception; TypeScript and scoped lint passed after this change. Evidence: `.local/taste-step-types.log`, `.local/taste-step-lint.log`.
5. **Catalogue workflow:** available workflow is list and create. Edit/delete APIs are absent. The UI now communicates this without nonfunctional actions. Implementing edit/delete requires a separately defined backend feature (permission, reference handling, audit and deletion semantics); no unverified endpoint was added.

Full populated and destructive workflow UAT, assistive-technology testing and current production build/integration checks remain separate from the fixture suite. Existing first-200-product lookups and unavailable workflows have not been replaced by invented endpoints. Graphify extraction remains pending the previously requested folder scope; it is not a prerequisite for these source-verified UI fixes.
