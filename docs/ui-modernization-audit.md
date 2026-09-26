# UI modernization audit - started 2026-09-23

## Scope and evidence

Repository main; 46 page routes. Initial source audit, not a claim of complete live UAT. Existing untracked skills/INDEX.md and tests/unit/paymentReversalAccounting.test.ts are unrelated and preserved. Applied skills: caveman, graphify (corpus detection; extraction awaiting scope), bundled ui-ux-pro-max. Read installed Next.js server/client and viewport guides before edits.

## Verified architecture

The architecture and inventory below describe the initial audit baseline. See the implementation and verification record at the end for subsequent changes.

Root server layout mounts OfflineSyncProvider, Radix toaster and service-worker registration. Dashboard client layout fetches /api/v1/me and provides DashboardSession; navigation uses is_global plus existing permission maps. Modules mostly own fetch/state/form handlers. Radix/shadcn primitives cover dialogs, drawers, tabs, dropdowns, inputs, cards and tables. Shared StateList is used by many lists. Shared DataTable and FilterBar are not currently consumed by module pages. Access Control has separate native form/table patterns. Root CSS defines light/dark semantic colors but root lacks a theme provider. next-themes and Sonner already installed.

## Verified findings before changes

| Class | Finding | Source |
|---|---|---|
| Functional | Overview active for every dashboard child path | dashboard/layout.tsx active startsWith check |
| Functional | Most features call Sonner; root mounts only Radix toaster | app/layout.tsx, components/ui/sonner.tsx |
| Functional | Accounting Expenses points to absent /dashboard/accounting/expenses | dashboard/accounting/page.tsx |
| Functional | Inventory links to absent /dashboard/inventory/movements | dashboard/inventory/page.tsx |
| Responsive/security context | GLOBAL badge hidden below sm | dashboard/layout.tsx |
| Accessibility | Browser zoom explicitly disabled; English UI marked bn | app/layout.tsx |
| Accessibility | Shared sorting headers mouse-only, pagination icons unnamed | shared/DataTable.tsx |
| Accessibility | Shared loading/error panels lack live-region roles; filter fields lack names | shared/StateList.tsx, FilterBar.tsx |
| Responsive | Shared dialogs lack viewport-height bound | ui/dialog.tsx, alert-dialog.tsx |
| Visual | Hardcoded light surfaces and status palettes across modules | route inventory below |
| UX | Authentication and other descriptions expose development phase labels | login, accounting and other module pages |
| UX | Platform overview has no administration shortcuts | dashboard/page.tsx |
| Inconsistency | Native tables alongside Table primitive; native controls alongside Input/Select | access, sales, inventory, purchases, HR |
| Verification | Build configured to ignore TypeScript errors | next.config.ts; independent tsc required |

Potential domain issue, NOT changed: POS calculates simplified 15% tax locally. Financial correctness must be reviewed separately against authoritative posting rules. Browser confirm/prompt flows in access, sales, settings, reconciliation are retained pending feature-specific workflow verification. Existing inventory ledger route is absent; do not invent a ledger implementation or API contract.

## Protected boundaries

No changes authorized here to prisma/, migrations/, src/app/api/, src/middleware.ts, src/workers/, src/commands/, src/lib/db*, auth/, access/, permissions/, accounting/, inventory/, idempotency/, reconciliation/, queue/, audit/, or financial/domain calculations. Presentation handlers keep existing payloads, permission decisions, MFA and idempotency behavior. No database commands or live mutations for visual testing.

## Target design system (recommendations)

Retain installed components and font assets. Neutral application background, white/dark elevated cards, restrained blue primary, semantic success/warning/information/danger with readable foreground/background pairs. Existing 4px spacing rhythm; 12/14px supporting text, 16px body, 24px page headings. Standard 36px desktop controls, 32px compact controls, 44px touch minimum. 6-10px radii; restrained shadows. Focus ring visible; reduced motion honored. Keep full financial columns with local horizontal scrolling. Font choices: existing Geist + Geist Mono (selected); system sans + system monospace (fallback); Noto Sans Bengali is an alternative if glyph testing establishes a need. No new fonts added.

## Phased implementation and acceptance

1. Foundations: theme provider and control, semantic colors, notifications, zoom, motion.
2. Shell: permission-preserving grouped navigation, exact Overview state, responsive context, skip link, scrolling.
3. Primitives: bounded dialogs, status announcements, named keyboard controls, readable dense tables.
4. Authentication/overview: clean descriptions, platform links from existing authorized destinations; no fabricated metrics.
5. Feature presentation: inspect each module before targeted style/microcopy edits; retain API payloads, calculation and mutation handlers. Feature workflow redesign remains gated by real behavior verification.

## Verification strategy

Capture baseline and final TypeScript/lint. Run focused existing access/tenant/domain tests and production build. Use isolated browser response fixtures for shell, themes, status states, overflow (320,375,430,768,1024,1280,1440,1920), long English/Bangla text, keyboard/focus and axe. Fixtures test presentation only; do not label them integration or tenant-isolation proof. Existing database E2E suites require verified disposable MariaDB plus credentials and are not run against production. Preserve current test failures; report exact limitations.

## Complete route inventory

Counts are static source signals, not runtime coverage. Access pages delegate into components/access. API strings are preserved in .local/ui-route-inventory.json for local audit.

| Route | Source lines | Shared StateList | Tables | Raw palette references |
|---|---:|---|---:|---:|
| `/login` | 131 | no | 0 | 0 |
| `/mfa` | 89 | no | 0 | 0 |
| `/mfa/setup` | 212 | no | 0 | 0 |
| `/dashboard/access/permissions` | 2 | no | 0 | 0 |
| `/dashboard/access/roles/[id]` | 4 | no | 0 | 0 |
| `/dashboard/access/roles` | 2 | no | 0 | 0 |
| `/dashboard/access/users/[id]` | 4 | no | 0 | 0 |
| `/dashboard/access/users` | 2 | no | 0 | 0 |
| `/dashboard/accounting/journal` | 227 | yes | 0 | 0 |
| `/dashboard/accounting` | 66 | no | 0 | 0 |
| `/dashboard/accounting/trial-balance` | 89 | no | 1 | 3 |
| `/dashboard/assets` | 447 | yes | 1 | 1 |
| `/dashboard/audit` | 205 | yes | 0 | 5 |
| `/dashboard/bank-reconciliation` | 450 | yes | 0 | 12 |
| `/dashboard/cashier` | 205 | yes | 0 | 2 |
| `/dashboard/catalogue` | 153 | no | 0 | 0 |
| `/dashboard/communications` | 368 | yes | 1 | 0 |
| `/dashboard/crm` | 116 | yes | 0 | 1 |
| `/dashboard/deliveries` | 156 | yes | 0 | 0 |
| `/dashboard/expenses` | 436 | yes | 1 | 0 |
| `/dashboard/feature-flags` | 109 | no | 0 | 0 |
| `/dashboard/gift-cards` | 182 | no | 0 | 0 |
| `/dashboard/hr` | 111 | yes | 1 | 1 |
| `/dashboard/imports` | 291 | no | 2 | 27 |
| `/dashboard/integrations` | 155 | no | 0 | 2 |
| `/dashboard/inventory/opening-stock` | 165 | no | 0 | 0 |
| `/dashboard/inventory` | 178 | yes | 1 | 3 |
| `/dashboard/onboarding` | 232 | no | 0 | 4 |
| `/dashboard` | 41 | no | 0 | 0 |
| `/dashboard/parties` | 215 | yes | 0 | 0 |
| `/dashboard/payments` | 505 | yes | 1 | 1 |
| `/dashboard/pos` | 589 | no | 0 | 6 |
| `/dashboard/products/[id]` | 237 | no | 0 | 0 |
| `/dashboard/products/new` | 209 | no | 0 | 0 |
| `/dashboard/products` | 173 | yes | 0 | 1 |
| `/dashboard/purchases` | 275 | no | 1 | 1 |
| `/dashboard/reports` | 247 | yes | 0 | 0 |
| `/dashboard/risk-tuning` | 734 | no | 3 | 54 |
| `/dashboard/sales` | 144 | yes | 1 | 1 |
| `/dashboard/security` | 141 | no | 0 | 8 |
| `/dashboard/service` | 189 | no | 0 | 0 |
| `/dashboard/settings` | 166 | no | 0 | 3 |
| `/dashboard/support` | 254 | yes | 1 | 0 |
| `/dashboard/system` | 60 | no | 0 | 0 |
| `/` | 10 | no | 0 | 0 |
| `/reset-password` | 25 | no | 0 | 0 |

## Implementation record (2026-09-26)

- Added persistent Light/Dark/System appearance, semantic status colors, visible focus, reduced-motion support and browser zoom. Mounted the existing Sonner host so feature feedback is visible.
- Grouped the existing permission-filtered navigation, corrected Overview's active state, retained mobile company/branch or platform context, added a skip link and restored drawer-trigger focus after closing.
- Updated shared cards, buttons, dialogs, loading/error states, filters and table keyboard controls. Shared DataTable improvements do not imply that every module now uses it.
- Replaced hardcoded surfaces/status colors in targeted features, improved small-screen wrapping, removed internal phase wording and corrected the accounting Expenses link. The absent inventory-movement destination is presented as unavailable.
- Added actual search retry to POS without changing checkout calculations or request payloads. Trial Balance now distinguishes failed/malformed responses from valid zero totals. Product detail now exits loading on failure, offers retry and reports unavailable records honestly. Risk Tuning reports partial loading failures.
- Added presentation fixtures covering navigation, themes, keyboard focus, axe checks, responsive routes and selected populated/error states. Fixtures intercept APIs; they do not establish server authorization or transaction correctness.

## Verification record

Evidence is stored locally under `.local/`; these files are intentionally not repository artifacts. Results below distinguish prior passing checks from the changing shared working tree.

| Check | Observed result | Evidence |
|---|---|---|
| Presentation routes | All 57 checks passed in one standalone snapshot run (1.7 minutes), including 40 dashboard routes at eight widths in both themes (640 route/theme/width combinations), populated MFA and POS | `ui-presentation-standalone.log`; earlier evidence: `ui-browser-all-widths.log`, `ui-presentation-final-fixes.log`, `ui-mfa-final.log` |
| Target widths | 320, 375, 430, 768, 1024, 1280, 1440, 1920 pixels | `tests/e2e/presentation.spec.ts` |
| Focused unit tests | 269 passed across access policy, tenant isolation, permission coverage, API client, financial integrity and stock movement; stock tests used the verified disposable MariaDB | `ui-unit-tests.log`, `ui-stock-disposable.log` |
| Production build | Prior isolated production snapshot passed; this is not proof that later concurrent backend edits build | `ui-isolated-build-current.log`, snapshot `ui-health-app-T4t44L` |
| TypeScript | Prior check passed. September 26 rerun found errors in concurrently edited accounting/report code, including readonly Prisma filter arrays and report result types | `ui-types-current.log`, `ui-types-latest.log` |
| Lint | Prior source/UI checks passed. Whole-repository lint failed on generated local snapshots and existing legacy test issues; no blanket lint-pass claim | `ui-lint-current.log`, `ui-final-lint.log` |
| Request/payload guard | 43 changed TSX files compared with the pre-modernization baseline; no changed fetch/request/JSON.stringify call expressions | `.local/ui-contract-check.cjs` |
| Authenticated suites | Initial final attempt refused a stale snapshot after concurrent source changes. The source fingerprint guard remains enabled | `ui-authenticated-health-final.log` |

Two additional populated MFA/POS checks initially could not connect to the stopped development preview. Both subsequently passed in the complete 57-check standalone run. The production snapshot contains matching UI source, with separate backend/configuration limitations described below.

### September 26 continuation

- `eslint src tests/e2e/presentation.spec.ts` passed (exit 0); log: `ui-lint-verification.log`.
- The database identity check again verified the existing local disposable database and workspace-owned data directory. No migration or reset was performed.
- A fresh isolated build stalled during optimized compilation without further progress for over ten minutes and was stopped. It is not counted as a successful build (`ui-isolated-build-latest.log`).
- The latest authenticated health attempt rejected changed application fingerprints. Access and module suites were consequently not run; none are reported as passing.
- A separate presentation-only attempt confirmed matching UI source (normalizing Windows line endings), but the earlier snapshot differs in package/Next/Sentry configuration. Its initial preview announced readiness yet `/login` timed out, including an explicit 10-second HTTP probe with network access. The initial sandbox explanation was not established; root cause remains unverified. Next's generated standalone server subsequently became responsive and started the fixture suite. Results below apply to that identified snapshot, not current backend integration.
- `git diff --check` passed. The request/payload AST comparison again reported no changed expressions in 43 TSX files. Concurrent changes in API, accounting, reconciliation and report files remain untouched by this task.
- Final standalone fixture run passed all 57 tests (exit 0, 1.7 minutes), including populated MFA enrollment controls and POS quantity controls at 320 pixels. Its owned server shut down after the suite. This completes presentation verification for the identified UI snapshot; it does not remove the current-source TypeScript or authenticated integration blockers.

## Protected boundaries and remaining work

This UI work authored no API handlers, domain commands, Prisma schema/migrations, authorization rules or financial calculations. Another session committed UI files alongside unrelated backend work and continues editing accounting/report files. Its changes were preserved; a clean working tree or broad historical diff must not be used to attribute those backend changes to this audit.

Full populated and destructive workflow UAT remains outside the verified presentation coverage. Product detail still relies on the existing first-200-products endpoint. Missing workflows and the existing POS tax model were not replaced with invented behavior. Automated axe checks on selected surfaces are not a whole-application WCAG certification.

Graphify detection found 1,560 files and no completed graph. Extraction remains pending the already-requested corpus scope. The installed graphify skill explicitly requires asking which subfolder to run on above 500 files and waiting for the answer. No graph-based architectural claims are made.
