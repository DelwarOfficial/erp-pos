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
| Radix triggers replaced Button's `data-slot`, bypassing touch sizing | Added coarse-pointer minimum dimensions to shared Button classes; the real touch navigation check now passes. |
| Automatic stylesheet scanning stalled isolated builds | Scoped Tailwind detection to `src` with `source("../")`, using the [documented source base path](https://tailwindcss.com/docs/detecting-classes-in-source-files#setting-your-base-path). Dashboard compilation then completed in 6.6 seconds; the full production build subsequently passed. |
| Risk-tuning error text failed automated contrast checks | Kept the error border/background and alert role, and used the theme's high-contrast foreground for its message. |
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
- The initial 68-check browser sweep passed 60 checks. Two failures identified unnamed catalogue and security controls; six routes timed out before assertions. Follow-up testing found the touch-target and risk-banner contrast defects listed above. Final verification below supersedes these initial results; stalled attempts are not counted as passes.
- A source-level request/payload comparison reviewed 52 changed TSX files against the modernization baseline. Only integrations differed: removal of the unused offline-sync GET. Mutation request bodies remained unchanged. This is a source check, not backend execution coverage.
- Expanded `tests/e2e/presentation.spec.ts` from 57 to 70 checks. The suite now opens key forms, checks named controls and usable field widths, verifies complete one-time secret handling and non-submitting retries, checks catalogue creation, touch targets and the 404, and runs axe on each dashboard route in both themes in addition to eight-width overflow checks.
- All API traffic in the presentation suite uses fixtures. No real financial, inventory, access or webhook mutations occur in that suite. Separate guarded database checks are identified below; fixture tests alone do not prove authorization or backend transaction behavior.
- The temporary preview uses a nonfunctional database target and no copied `.env` files. During diagnosis it uses installed Geist font fixtures and disables telemetry only in its temporary copy.
- Browser traces identified a development-only verification conflict: production CSP disallows the `eval` used by webpack development bundles. Pages rendered server HTML but could not hydrate. The temporary preview permits development evaluation; the repository's production CSP is unchanged. Development fixture passes are not a production CSP or telemetry validation.
- Existing Prisma/schema/index changes belong to concurrent work and were preserved. This task changed no authorization, schema, migration or financial calculations. A later build-compatibility fix relocated the unchanged offline-sync batch constant from a route export to `src/lib/offline/syncLimits.ts` and updated its test import; Next rejects arbitrary value exports from route files. A concurrent session committed presentation changes during this audit; this task did not issue a commit.

## Remaining coverage

### Sequential follow-up (2026-09-26 through 2026-09-27)

1. **Preview / build:** resolved the stylesheet scanning stall. The final full application production build passed with the real configuration, fonts and instrumentation (exit 0; compile 64s, TypeScript 2.1min, 141 static pages). It includes the contrast correction and route-export compatibility fix. Evidence: `.local/taste-production-verified-build.log`. Public sourcemap check found zero maps. The separate UI-only development copy excludes API routes and middleware and cannot validate their runtime behavior.
2. **Browser checks:** **70/70 passed in one full run (6.9 minutes)** after the shared styling and contrast fixes. Includes 40 dashboard routes across eight widths and two themes (640 layout combinations), route-level axe checks in both themes, keyboard actions, touch targets, expanded forms, retry safety and one-time secret handling. Evidence: `.local/taste-step-all-browser.log`. Source comparison confirmed the preview's dashboard/auth pages, components, globals and 404 match the workspace; fixture-only root font/config changes remain as documented above.
3. **Workflow integrity:** user selected the existing disposable test environment. Ran `scripts/verify-access-tests.mjs` with `generalLedgerCoverage`, `postSale`, `paymentRefundIdempotency`, `paymentReversalAccounting` and `inventoryValuationIntegrity`: **5 files / 26 tests passed**. The guarded target was local MariaDB `127.0.0.1:43318/readiness_20260912_disposable`. The first two suites exercise real disposable database transactions; the remaining checks do not substitute for browser UAT. Production invariants intentionally prevented some fixture teardown; synthetic test records remain in the disposable database. Evidence: `.local/taste-workflow-validation.log`.
4. **Keyboard:** fixed POS Enter interception; TypeScript and scoped lint passed after this change. Evidence: `.local/taste-step-types.log`, `.local/taste-step-lint.log`.
5. **Catalogue workflow:** available workflow is list and create. Edit/delete APIs are absent. The UI now communicates this without nonfunctional actions. Implementing edit/delete requires a separately defined backend feature (permission, reference handling, audit and deletion semantics); no unverified endpoint was added.
6. **Production runtime:** **16/16 authenticated smoke checks passed (8.4 seconds)** against the final production build and guarded disposable MariaDB. Includes real company/branch isolation, denied health access, accurate dependency states, recovery rendering and service-worker navigation without response interception. Some error-state checks deliberately mock responses. Evidence: `.local/taste-production-runtime.log`. The harness verified the current application fingerprint matches the built snapshot before starting tests.
7. **Visual review:** inspected mobile and dark desktop journal captures; mobile has no horizontal overflow. Theme switching preserved the entered draft. Evidence: `.local/taste-journal-mobile.png`, `.local/taste-journal-dark.png` and `.local/taste-final-screens.log`.
8. **Offline regression after build fix:** the existing 200-sale batch/replay/conflict test passed when run alone: 11,693ms for the batch, within its unchanged 30,000ms assertion. Evidence: `.local/taste-offline-idle-regression.log`. The earlier run concurrent with compilation took 96,232ms and failed that timing assertion (`.local/taste-offline-build-regression.log`); the idle pass does not establish capacity under competing load. The limit, payloads, transaction settings and financial behavior were not changed. Together with item 3, **27 workflow checks passed**.

Full operator-led transaction UAT and assistive-technology testing remain beyond these automated checks; domain/database verification is not a substitute for every populated browser workflow. Existing first-200-product lookups and unavailable workflows have not been replaced by invented endpoints. Graphify extraction remains pending the previously requested folder scope; it is not a prerequisite for these source-verified UI fixes.
