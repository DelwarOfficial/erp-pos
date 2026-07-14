#!/usr/bin/env python3
"""Update README.md with current stats and Asset Management / Bank Reconciliation sections."""
import re
from pathlib import Path

README = Path("/home/z/my-project/README.md")
text = README.read_text(encoding="utf-8")

# ── 1. Replace stale stats table ────────────────────────────────────────────
old_stats_block = """| Metric | Count |
|--------|-------|
| Prisma models | 176 |
| PostgreSQL tables (migrations) | 184 |
| RLS-enabled tables | 170 |
| SQL functions (SECURITY DEFINER) | 352 |
| SQL triggers | 38 |
| CHECK constraints | 1,687 |
| EXCLUDE constraints | 2 |
| SQL views | 13 |
| Domain commands | 37 (prompt rule 8) |
| API routes | 118 |
| UI pages | 32 |
| Reports | 28 |
| Reconciliation checks | 20 |
| Permission codes | 130 |
| System roles | 8 |
| Feature flags | 10 |
| Test files | 45 |
| Tests passing | 395 |
| Translation keys (per locale) | 150+ |
| Migrations | 19 (forward-only) |
| ADRs | 6 |
| Runbooks | 4 |"""

new_stats_block = """| Metric | Count |
|--------|-------|
| Prisma models | 181 |
| PostgreSQL tables (migrations) | 201 |
| RLS-enabled tables | 175 |
| SQL functions (SECURITY DEFINER) | 352 |
| SQL triggers | 62 |
| CHECK constraints | 1,700+ |
| EXCLUDE constraints | 2 |
| SQL views | 13 |
| Domain commands | 26 (across M2–M6) |
| API routes | 132 |
| UI pages | 38 |
| Reports | 28 |
| Reconciliation checks | 22 |
| Permission codes | 134 |
| System roles | 13 |
| Feature flags | 12 |
| Test files | 45 |
| Tests passing | 395 |
| Translation keys (per locale) | 150+ |
| Migrations | 20 (forward-only) |
| ADRs | 6 |
| Runbooks | 4 |"""

if old_stats_block in text:
    text = text.replace(old_stats_block, new_stats_block)
    print("OK: stats table updated")
else:
    print("WARN: stats table not matched, leaving as-is")

# ── 2. Update folder structure block ──────────────────────────────────────
text = text.replace("│   ├── schema.prisma                    # 176 Prisma models",
                    "│   ├── schema.prisma                    # 181 Prisma models")
text = text.replace("│   ├── migrations/                      # 19 forward-only SQL migrations",
                    "│   ├── migrations/                      # 20 forward-only SQL migrations")
text = text.replace("│   │   └── 0019_required_views.sql      # 13 SQL views (§11.2)",
                    "│   │   ├── 0019_required_views.sql      # 13 SQL views (§11.2)\n│   │   └── 0020_asset_management_banking.sql  # §21.1 Fixed Assets + §21.2 Bank Rec")

# ── 3. Update ASCII architecture diagram ──────────────────────────────────
text = text.replace("│  184 tables │", "│  201 tables │")
text = text.replace("│  170 RLS    │", "│  175 RLS    │")
text = text.replace("│ 28 types │  │ 20 checks │", "│ 28 types │  │ 22 checks │")

# ── 4. Insert Asset Management + Bank Reconciliation sections ─────────────
# Find a good insertion point: right before "## Multi-Tenant Architecture" or "## Security"
anchor_options = ["## Security", "## Localization", "## Reports & Reconciliation",
                  "## Reports & Exports", "## Backup & DR", "## Production Checklist"]
anchor = None
for a in anchor_options:
    if a in text:
        anchor = a
        break

am_br_section = """
## Fixed Asset Management (§21.1)

Feature-flagged module (`asset_management_enabled`, default OFF) for capitalising fixed assets,
running depreciation (straight-line or declining-balance), and recording disposals with gain/loss
accounting. All asset events post through `post_journal_entry()` so the GL stays in sync with the
asset register.

| Layer | File / Object |
|-------|---------------|
| Prisma models | `FixedAsset`, `FixedAssetCategory`, `FixedAssetDepreciation` |
| Migration | `prisma/migrations/0020_asset_management_banking.sql` |
| Domain commands | `src/domain/commands/m4/AssetManagement.ts` → `postAssetAcquisition`, `postDepreciation`, `postAssetDisposal` |
| API routes | `POST /api/v1/fixed-assets`, `GET /api/v1/fixed-assets/[id]`, `POST /api/v1/fixed-assets/[id]/depreciate`, `POST /api/v1/fixed-assets/[id]/dispose` |
| UI page | `/dashboard/assets` |
| Reconciliation | `FIXED_ASSET_NBV` (NBV = cost − accumulated depreciation) |
| Permissions | `asset.view.branch`, `asset.view.global`, `asset.manage.branch`, `asset.depreciate.company` |
| CoA accounts | 1800 (control), 1810 Office Equipment, 1820 Vehicles, 1830 Furniture, 1840 Computers, 1850 Accumulated Depreciation (contra), 1860 Depreciation Expense, 1870 Gain/Loss on Disposal |
| Trigger | `trg_fixed_asset_dep_immutable` prevents mutation of posted depreciation rows |

---

## Bank Reconciliation (§21.2)

Feature-flagged module (`bank_reconciliation_enabled`, default OFF) for matching system payment
lines to bank statement lines with auto-match (amount + ±3 day tolerance) and manual match.
Variance posting creates an adjustment journal entry so the GL bank account equals the bank
statement closing balance.

| Layer | File / Object |
|-------|---------------|
| Prisma models | `BankReconciliation`, `BankReconciliationLine` |
| Migration | `prisma/migrations/0020_asset_management_banking.sql` |
| Domain commands | `src/domain/commands/m4/BankReconciliation.ts` → `createBankReconciliation`, `addStatementLinesBulk`, `autoMatchTransactions`, `manualMatch`, `postReconciliationVariance` |
| API routes | `POST /api/v1/bank-reconciliations`, `GET /api/v1/bank-reconciliations/[id]`, `POST /api/v1/bank-reconciliations/[id]/statement-lines`, `POST /api/v1/bank-reconciliations/[id]/auto-match`, `POST /api/v1/bank-reconciliations/[id]/manual-match`, `POST /api/v1/bank-reconciliations/[id]/finalize` |
| UI page | `/dashboard/bank-reconciliation` |
| Reconciliation | `BANK_RECONCILIATION_VARIANCE` (flags reconciliations with unresolved variance) |
| Permissions | `bank.reconciliation.view.company`, `bank.reconciliation.manage.company` |
| Note | The `payments` table is partitioned by `business_date` with composite PK `(id, business_date)`. The FK from `bank_reconciliation_lines.payment_id` is therefore enforced at the application layer (matches the pattern used by `payment_allocations` and `return_refund_allocations`). |

---

"""

if anchor:
    text = text.replace(anchor, am_br_section + anchor, 1)
    print(f"OK: AM/BR section inserted before {anchor}")
else:
    # Append to end if no anchor found
    text += "\n" + am_br_section
    print("OK: AM/BR section appended to end")

README.write_text(text, encoding="utf-8")
print(f"\nFinal README size: {len(text)} bytes")
