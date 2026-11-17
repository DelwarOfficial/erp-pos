# UI/UX v2: audit, terminology and slice report

Date: 2026-11-17. Scope: presentation layer only. No API contract, schema, domain logic or permission was changed.

Cut-line: dashboard shell and navigation, login/auth, POS and cashier, sales and payments, inventory. Every other module is audited below and left untouched.

## How the audit was done

Source reading of each page, plus counts taken from the source (browser `confirm`/`prompt` calls, raw date and money formatting, native tables, hardcoded strings). The five MVP pages were also opened in the running app. Scores are 0 (missing) to 3 (good) per column, as found **before** this pass.

One finding applies to every page: **no page used the translation system.** `next-intl` was installed and `public/locales/*/common.json` existed, but every dashboard screen had hardcoded English in JSX, and dates used the device locale and time zone instead of Asia/Dhaka.

## Scored gap table

| Page | Language | Consistency | States | A11y | Responsive | Main issues found | Fix |
|---|---:|---:|---:|---:|---:|---|---|
| Dashboard shell | 2 | 2 | 2 | 2 | 3 | Hardcoded strings; error showed raw `HTTP 500` text; `MFA` badge jargon; several icons announced to screen readers | **Done**: catalog strings, plain error, language switcher, decorative icons hidden |
| Home | 2 | 2 | 2 | 3 | 3 | Hardcoded strings | **Done** |
| Login | 2 | 2 | 1 | 2 | 3 | "ERP Sign In"; server error shown verbatim; no inline validation; no show-password; network failure showed the browser's exception text | **Done**: inline errors linked to fields, friendly errors by error code, show/hide password, language and theme controls |
| Sign-in code (MFA) | 1 | 2 | 2 | 2 | 3 | "Two-Factor Authentication", "MFA verified", title not a heading | **Done** |
| POS | 1 | 1 | 2 | 2 | 2 | "POS — Point of Sale", "Financial Account *", "Applied payment amount", "serialized"; 32px quantity buttons; payment method in a small select; cart cleared with no confirmation; "Remove item" did not name the item; device-locale shift time; a network error invited a blind retry of a sale | **Done** (see slice 3) |
| Cashier shifts | 1 | 2 | 1 | 1 | 2 | "Opening Float", "Variance"; closing a shift had no confirmation and no busy state (double-submit possible); counted-cash field was labelled with a UUID; errors were "Failed" | **Done** (see slice 3) |
| Sales | 1 | 1 | 2 | 1 | 2 | Voiding used browser `prompt()` then `confirm()`; "Void", "Biller"; native table; currency code instead of ৳; "No sales in the last 30 days" although the list is not limited to 30 days; "Load older" replaced the table with a spinner | **Done** (see slice 4) |
| Payments | 1 | 2 | 2 | 1 | 2 | "hit the GL", "Counterparty", "Direction", "(rev)"; ৳ shown for non-BDT payments; form options failed silently; direction conveyed by a 12px coloured arrow; page had its own padding and max width | **Done** (see slice 4) |
| Inventory | 1 | 1 | 2 | 2 | 1 | "Warehouse stock projections with moving-average cost", "MAC", "SKUs Tracked"; reserved shown to 4 decimals; low stock shown by colour and the word "low" | **Done** (see slice 5) |
| Sell on credit | 2 | 2 | 2 | 3 | 2 | Hardcoded strings; raw date and money formatting | Not changed (outside the five named screens; next slice candidate) |
| Opening stock / transfers / counts / adjustments | 2 | 2 | 2 | 2 | 2 | Hardcoded strings; "Post" verbs; "Unit Cost (BDT)" | Not changed |
| Accounting | 1 | 2 | 1 | 2 | 3 | "Post operational expenses with GL integration"; hub page has no loading or empty states | Audit only |
| Journal | 2 | 2 | 2 | 2 | 2 | Accounting terms are correct here; needs catalog strings and Dhaka dates | Audit only |
| Collections | 2 | 2 | 3 | 3 | 2 | Best of the unchanged pages; hardcoded strings only | Audit only |
| Repairs & service | 1 | 2 | 1 | 1 | 2 | Browser `confirm()`; no loading state component; raw dates | Audit only |
| HR | 1 | 2 | 1 | 1 | 2 | Two browser `confirm()`/`prompt()` calls; raw dates | Audit only |
| Settings | 2 | 2 | 1 | 1 | 2 | Browser `confirm()`; three raw date formats | Audit only |

## Terminology cheat-sheet

One word per thing, one verb per action. Used in every string written in this pass.

| Use | Not | Notes |
|---|---|---|
| Sale | Invoice, transaction, order | "Invoice" only for the printed document |
| Complete sale | Checkout, post, submit | The one verb for finishing a sale |
| Cancel sale | Void | The dialog explains that stock and payments are reversed |
| Save | Post, submit, create | For payments and records |
| Payment account | Financial account | Explained as "the cash drawer, bank or wallet" |
| Warehouse | Location, store | Kept; explained as "where the stock comes from" |
| Cashier shift / Open shift / Close shift | Session, till session | |
| Opening cash in drawer | Opening float | |
| Short by / Over by / Drawer balanced | Variance | |
| Customer or supplier | Counterparty, party | |
| Money in / Money out | Incoming, outgoing, direction | |
| Average cost | MAC, moving-average cost | |
| On hand / Reserved / Available | Projections | |
| Needs serial number | Serialized | |
| VAT | Tax | Bangladesh retail term |
| Sold by | Biller | |
| Sign-in code | MFA, two-factor authentication | |
| Activity history | Audit log | Navigation label |
| Try again | Retry | Except where an e2e selector depends on the old word |

Tone by surface: POS, cashier and collections are warm ("let's ring this up", "You are ready to sell"). Accounting, audit, security and admin stay plain and calm, with no exclamation marks.

Error pattern: what happened, then what to do. "We couldn't save this sale — {server reason}". The server's own message is kept as the reason because it is the only accurate cause available; rewriting those messages is backend work and outside this engagement.

## Bengali glossary

Used for the bn-BD catalog. Every bn-BD string added in this pass is machine-written and **needs review by a native speaker before release**; see `public/locales/bn-BD/ui.json`.

| English | বাংলা |
|---|---|
| Sale | বিক্রয় |
| Customer | গ্রাহক |
| Supplier | সরবরাহকারী |
| Product | পণ্য |
| Warehouse | গুদাম |
| Branch | শাখা |
| Cashier shift | ক্যাশিয়ার শিফট |
| Cash drawer | ক্যাশ ড্রয়ার |
| Payment | পেমেন্ট |
| Payment account | পেমেন্ট অ্যাকাউন্ট |
| Installment | কিস্তি |
| Credit limit | বাকির সীমা |
| Stock | মজুদ |
| Serial number | সিরিয়াল নম্বর |
| VAT | ভ্যাট |
| Receipt | রসিদ |
| Invoice | চালান |
| Change (cash) | ফেরত টাকা |

## What changed, by slice

### Design system (before the slices)
- `src/components/i18n/I18nProvider.tsx`, `LanguageControl.tsx`: next-intl provider and a language switcher. The locale is a display preference stored in the `erp-locale` cookie; English is the default and Bengali falls back to English for any missing key.
- `src/lib/i18n/format.ts`: client-safe money (`৳ 1,25,000.00`), quantity and date formatters. Dates and times always use Asia/Dhaka.
- `public/locales/{en-BD,bn-BD}/ui.json`: the new catalog (436 keys).
- `src/components/shared/PageHeader.tsx`: one page-title anatomy. `StateList` loading/error text now comes from the catalog.
- Noto Sans Bengali added through `next/font` as a fallback after Geist.

### Slice 1: shell and navigation
Strings moved: 94 (`shell.*`, `home.*`). Behaviour unchanged: permission-filtered navigation, session loading, sign-out.

### Slice 2: login and sign-in code
Strings moved: 32 (`auth.*`). Request body and endpoint unchanged.

### Slice 3: POS and cashier
Strings moved: 150 (`pos.*`, `cashier.*`).
- POS: barcode field focused on load and 48px tall; 44px quantity and remove buttons; payment method as six large buttons; "Cash received" shows the change to give back (display only, not sent); cart clear asks first and says nothing has been charged; serial-number field has its own label, help and duplicate warning; success panel leads with Print receipt and Start next sale.
- Cashier: closing a shift asks for confirmation naming the cashier and the counted amount, shows a busy state, and reports short/over in words.
- The sale payload and both shift payloads are byte-for-byte the same fields as before.

### Slice 4: sales and payments
Strings moved: 117 (`sales.*`, `payments.*`).
- Sales: cancel-sale dialog with a required reason replaces `prompt()`/`confirm()`; shared table; correct empty states; "Load older sales" keeps the rows on screen.
- Payments: plain labels, currency shown per payment, form-option failures are reported in the form.

### Slice 5: inventory
Strings moved: 36 (`inventory.*`). The table keeps every stock and cost column and scrolls inside its own container on phones (the existing design-system rule); average cost keeps its 6-decimal precision. Search over the loaded rows; status shown with icon and words.

## Deliberately not changed

- **Server error messages.** They arrive in English from the API and are shown as the reason. Translating them means changing the API or mapping every code, which is backend scope.
- **Print views (invoice, receipt, ESC-POS).** They render their own documents and were not restyled; nothing in this pass changes their markup or data.
- **Sell on credit, opening stock, transfers, counts, adjustments, `SaleDetail`, `EntityPicker`.** Inside the sales and inventory areas but beyond the five named screens. `EntityPicker` is shared with out-of-scope modules, so changing its strings would change them too.
- **Role-adaptive density.** POS and cashier use large controls; tables keep the existing compact density. No per-role switch was added because the session carries permissions, not a role profile, and inventing one would be a fake gate.
- **Idempotency keys** on shift open/close and payment save are still time-based per click. That is a behaviour question, not presentation.
- **The 30-item sidebar.** Regrouping or hiding entries by role is a navigation redesign that needs a decision on information architecture.

## Defects noticed and not fixed (outside presentation scope)

- **Company onboarding fails.** `POST /api/v1/onboarding` returns 500 with `Unique constraint failed` at `tx.rolePermission.create()` (`src/app/api/v1/onboarding/route.ts`, role seeding loop). A system role lists a permission more than once after wildcard expansion, so the second insert collides. Seen on the local MariaDB 11.8 database on 2026-11-17. Until it is fixed no company can be created through the product, which is why the cashier journey below could not be walked with real data.
- **That 500 response exposes internals.** The body carries the raw Prisma error, including a server file path. Error bodies should be generic.
- **Geist is not applied.** The font is loaded and `--font-sans` points at it, but the body renders in the system font stack.
- **Two presentation tests are stale against the committed source.** `catalogue creation keeps named fields…` expects the text "Editing and deletion are not available here." and `retrying product options preserves form values…` expects a field labelled "Warehouse *" on the opening-stock page. Neither string exists anywhere in `src`. Both fail before and after this pass.

## Verification

- TypeScript: `npx tsc --noEmit` clean (the only errors are the existing `graphify/tests/fixtures` files).
- ESLint: clean on every file changed in this pass.
- Unit: `tests/unit/uiCatalog.test.ts` (new) checks that both locales have the same keys and placeholders, that the flat keys nest safely, taka formatting, and Asia/Dhaka dates.
- Browser: `tests/e2e/presentation.spec.ts` run against the local dev server with the installed Chromium (the Playwright version in the repo expects a browser build that is not installed, so a local config in `.local/` points at the installed one). Final run on 2026-11-17: 73 of 75 passed. The two failures are the stale tests listed above.
- Manual: shell, home, POS, cashier, sales, payments and inventory opened at 1280px as the platform admin; POS opened at 375px in Bengali with no horizontal overflow.
- **Not done:** the full cashier journey (login → POS → serial product → cash payment → close shift) with real data, because onboarding fails as described above. `tests/e2e/ui-health.spec.ts`, `accessibility.spec.ts` and `ui-workflows.spec.ts` need a seeded tenant and were not run; their selectors were updated for the renamed controls but are unverified.
