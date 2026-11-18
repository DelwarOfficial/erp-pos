# Project documentation

Maintain all project documentation in this `docs/` directory. Use the existing subject folders; keep one canonical document for each topic and link to it instead of copying its contents. Markdown, guides, tutorials, exported PDFs and other documentation assets belong here.

## Start here

- [Project overview, setup, architecture and verification](overview.md)
- [ERP/POS Blueprint v4.2](master-plan/ERP_Pos_Blueprint_v4.2.md)
- [Bengali user guide](user-guide/bn/README.md)
- [Bengali quick-guide PDF](user-guide/bn/ERP-POS-Bangla-Quick-Guide.pdf)
- [UAT scenarios](testing/uat-scenarios.md)

## Where to maintain documents

| Folder | Contents |
| --- | --- |
| [master-plan/](master-plan/) | Product blueprint and master review prompts |
| [adr/](adr/) | Architecture decisions; MariaDB authority is defined in [ADR 0007](adr/0007-mariadb-production-database.md) |
| [audits/](audits/) | Dated findings, evidence and review prompts |
| [runbooks/](runbooks/) | Operational procedures, deployment, recovery and go-live checks |
| [testing/](testing/) | Human verification and acceptance scenarios; executable tests stay in `tests/` |
| [user-guide/bn/](user-guide/bn/) | Bengali chapters, tutorials, verification notes and e-book exports |
| `docs/` | Cross-cutting setup, integration and UI documentation |

Existing cross-cutting references include the [UI design system](ui-design-system.md), [UI debugging audit](ui-taste-debug-audit.md), [inline customer checkout](inline-customer-checkout.md), [provider integrations](provider-integration-guide.md) and [MariaDB migration runbook](mariadb-migration-runbook.md).

## Required location exceptions

- The root [README](../README.md) is only an entry point to this directory.
- Root [AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md) are tool-discovered instruction files.
- `.agents/skills/` and `.codex/skills/` contain installed skill packages, including their required `SKILL.md` and bundled references. Maintain them with their packages.
- `graphify-out/` contains generated graph artifacts whose paths are used by Graphify. Regenerate those artifacts instead of moving or manually duplicating them.
- `public/robots.txt` is a web protocol file, not project documentation.

Dependencies, vendored tools, ignored local files and build outputs are not maintained project documentation. Do not move their bundled documentation into this directory.

## Maintenance check

Run `node scripts/docs/check-location.mjs` from any directory to check tracked and unignored new documentation files. New maintained documents outside `docs/` are rejected except for the required locations above. After moving a document, update incoming references and rebase its relative links. Keep dated evidence historical; do not rewrite old observations as current verification results.
