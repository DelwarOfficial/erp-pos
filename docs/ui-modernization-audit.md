# UI modernization audit - started 2026-09-23

## Scope and evidence

Repository main; 46 page routes. Initial source audit, not a claim of complete live UAT. Existing untracked skills/INDEX.md and tests/unit/paymentReversalAccounting.test.ts are unrelated and preserved. Applied skills: caveman, graphify (corpus detection; extraction awaiting scope), bundled ui-ux-pro-max. Read installed Next.js server/client and viewport guides before edits.

## Verified architecture

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
