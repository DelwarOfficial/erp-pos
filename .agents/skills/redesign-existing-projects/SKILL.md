---
name: redesign-existing-projects
description: Improve the existing ERP/POS interface through targeted UI reviews and redesigns, including forms, tables, navigation, responsive layouts, accessibility, and recovery states. Use for presentation work in this project.
---

# Redesign existing ERP/POS screens

This project skill was reconstructed from the repository's UI audits; it is not a recovered copy of the original skill.

## Inspect and diagnose

Read the applicable AGENTS.md instructions. Before writing Next.js code, read the relevant installed guides in `node_modules/next/dist/docs/`. If dependencies are absent, resolve that documentation requirement before making framework-dependent changes.

Inspect the requested screens, their shared components, and their existing handlers. Trace permissions, API payloads, loading states, and mutation behavior before proposing a workflow change. Prioritize observable usability defects and the user's requested design outcome.

Consult [the modernization audit](../../../docs/ui-modernization-audit.md) and [the follow-up UI audit](../../../docs/ui-taste-debug-audit.md) when relevant. Their findings and verification describe historical states; confirm current behavior before relying on them. Their past task-specific authorization boundaries do not replace the current user's instructions.

## Make targeted improvements

Prefer the project's existing Geist fonts, Tailwind styles, Radix/shadcn components, and semantic light/dark colors. Inspect current implementations rather than assuming the audit's architecture still applies. Keep dense operational screens readable, with clear hierarchy and restrained decoration.

For presentation-only requests, preserve accounting and tax calculations, inventory effects, permission checks, MFA, idempotency, API contracts, and transaction handlers. Report domain defects separately unless the user has authorized fixing them. Do not invent operational metrics, destinations, or working actions where no underlying capability exists.

Address relevant usability details:

- Associate visible labels with unique controls; name icon buttons and preserve keyboard activation and visible focus.
- Keep forms usable on narrow screens, dialogs within the viewport, and wide financial tables locally scrollable without hiding essential columns.
- Use readable theme-aware status colors, tabular financial digits, and appropriately sized touch controls. Preserve browser zoom and honor reduced motion.
- Distinguish loading, failed requests, empty results, and successful actions. Keep retry controls from submitting forms accidentally.
- Preserve permission-filtered navigation and make unavailable actions and error recovery truthful. For uncertain transaction outcomes, guide users to verify status before repeating a mutation.

Keep changes within the requested scope. Reuse shared primitives where that improves consistency, and inspect their callers before changing behavior across modules.

## Verify and report

Run checks appropriate to the changes and the repository's available tooling. A successful build may not establish type safety; inspect build configuration and run a separate type check when needed. For UI changes, verify the affected workflows, responsive behavior, keyboard access, and applicable themes when browser tooling is available.

Use safe fixtures for workflows that mutate data. Do not execute live financial or inventory mutations solely to demonstrate visual changes.

Report the concrete changes, checks performed, and any material verification gaps. Distinguish static inspection from browser verification and completed checks from historical audit results.
