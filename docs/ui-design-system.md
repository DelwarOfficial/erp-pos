# ERP presentation system

Use the existing Tailwind 4 and Radix/shadcn components. Business commands, API contracts, permissions and financial formatting remain owned by their existing modules.

## Tokens

The source of truth is `src/app/globals.css`. Light and dark modes share semantic names, with different values. Theme preference is stored in `erp-theme`; the default follows the operating system. The provider applies its class before hydration. The theme menu uses stable server/client markup.

| Purpose | Tailwind tokens |
|---|---|
| Application canvas | `bg-background text-foreground` |
| Card or panel | `bg-card text-card-foreground border-border` |
| Menus and overlays | `bg-popover text-popover-foreground` |
| Quiet section | `bg-muted text-muted-foreground` |
| Primary action | `bg-primary text-primary-foreground` |
| Secondary action | `bg-secondary text-secondary-foreground` |
| Hover or selected context | `bg-accent text-accent-foreground` |
| Success | `bg-success text-success-foreground` |
| Warning | `bg-warning text-warning-foreground` |
| Information | `bg-info text-info-foreground` |
| Error or destructive action | `text-destructive`, `bg-destructive/10`, or the destructive Button variant |
| Keyboard focus | `outline-ring`, plus primitive focus-visible rings |
| Navigation | `sidebar`, `sidebar-accent`, `sidebar-primary` and their foreground tokens |

Always pair status color with a label or meaningful icon. Do not replace a failed financial response with zero totals or a balance verdict.

## Typography, spacing and density

- Keep Geist and Geist Mono through the existing Next font integration. Bengali text uses available system fallback glyphs. No new font requests were introduced.
- Page titles: 24px; section titles: 16-18px; body and controls: 14-16px; supporting labels: 12px. Prefer medium/semibold weights and normal sentence case.
- Use the existing 4px spacing scale. Page gaps: 16-24px; field groups: 8-16px; card horizontal padding: 16px on small screens, 24px above `sm`.
- Existing radius scale: 6px small, 8px medium, 10px large. Cards use large radius and a restrained shadow.
- Buttons retain `default`, `secondary`, `outline`, `ghost`, `destructive`, `link`; sizes retain `sm`, `default`, `lg`, `icon`. Desktop controls remain compact; touch input/button/select targets have a 44px minimum height.
- Icons: 16px in controls, 20-24px in contextual headings. Decorative icons should be hidden from assistive technology.
- Content width: 1600px maximum. Desktop sidebar: 240px, increasing to 256px at `lg`. Navigation becomes a drawer below `md` (768px).
- Color transitions use existing Tailwind durations. Reduced-motion preference disables nonessential animation and smooth scrolling.

## Interaction rules

- Preserve the existing navigation permission map and authoritative session. Group labels do not grant access. Platform context must remain textual and visible on phones.
- Use a single interactive element: `<Button asChild><Link ...>...</Link></Button>` for navigation styled as a button.
- Every icon-only action needs an accessible name. Keep visible focus. Dialogs must have a title; use the Radix trigger so closing restores focus.
- Native and Radix form controls must have a label. Connect help/error text with `aria-describedby`; use `aria-invalid` when validation fails. Keep existing required, numeric and domain constraints.
- Shared loading panels announce status; errors explain recovery and offer retry when available. Empty data, denied access, loading and failed requests are distinct states.
- Keep all accounting and stock columns. Put overflow on the table container, not the page. Preserve numerical precision and existing currency/date calculations.
- Use native buttons inside sortable table headers, `aria-sort`, and named pagination controls. Do not hide sorting or row actions from keyboard users.
- Bound dialogs by the dynamic viewport height. Wrap long tab bars and action groups on narrow screens. Use local scrolling only where information requires it.
- POS product selection remains keyboard-operable; cart controls wrap on phones. Checkout, discounts, totals, serial handling and payment posting retain their existing behavior.

## Verification

`playwright.presentation.config.ts` runs isolated response-fixture checks without database access. These cover route rendering, viewport overflow, theme persistence, focus, selected failure/empty/populated states and automated overview accessibility. They do not prove business authorization or successful transaction workflows.

Use the existing `scripts/verify-ui-health.mjs` workflow for authenticated health/access/module checks against its explicitly guarded disposable database. Run independent TypeScript checks: the existing Next configuration skips build-time type errors. Repository-wide lint currently includes generated local artifacts and unrelated legacy issues; scoped UI lint is a separate result, not a replacement for that finding.
