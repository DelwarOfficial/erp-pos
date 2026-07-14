# M8 — Go-Live Checklist

Per Appendix E — production go-live checklist.

## Pre-Go-Live

### Code Quality
- [ ] All 111+ unit tests pass
- [ ] Lint clean (0 errors, 0 warnings)
- [ ] No console.log in production code
- [ ] No hardcoded secrets in source
- [ ] All TODOs documented or resolved

### Security
- [ ] RLS penetration test passes (scripts/security/rls-penetration-test.sh)
- [ ] JWT_SECRET set in production env
- [ ] APP_ENCRYPTION_KEY set in production env
- [ ] BARCODE_SIGNING_KEY set in production env
- [ ] Argon2id password hashing (memory≥64MB, time≥3) — verified
- [ ] Access JWT 15min HttpOnly+Secure+SameSite=Strict — verified
- [ ] Refresh token rotation + family revocation — verified
- [ ] TOTP MFA for owners/global_admins — verified
- [ ] WebAuthn passkey support — implemented
- [ ] Idempotency-Key required on all mutations — verified
- [ ] Audit log append-only (UPDATE/DELETE blocked) — verified
- [ ] Stock movements immutable — verified
- [ ] Negative-stock CHECK enforced — verified

### Database
- [ ] PostgreSQL 16+ provisioned
- [ ] All migrations run successfully (0001-0010)
- [ ] RLS enabled + forced on all tenant tables
- [ ] 4 DB roles created (app/migration/backup/reporting)
- [ ] Partitioning active for stock_movements, journal_entries, payments
- [ ] Partial unique indexes in place
- [ ] EXCLUDE constraint on document_number_leases

### Infrastructure
- [ ] TLS configured on DB connection
- [ ] Encrypted disk storage
- [ ] WAL archiving to encrypted S3 with object-lock
- [ ] Backup credential separate from app role
- [ ] First backup restore test passed
- [ ] Recovery epoch table initialized

### Feature Flags
- [ ] crm_enabled = false (default)
- [ ] hr_payroll_enabled = false (default)
- [ ] delivery_courier_enabled = false (default)
- [ ] service_warranty_enabled = false (default)
- [ ] loyalty_enabled = false (default)
- [ ] multi_currency_enabled = false (default)
- [ ] import_csv_enabled = false (default)
- [ ] offline_pos_enabled = false (default)
- [ ] quotation_enabled = true (core)
- [ ] multilingual_ui_enabled = true (core)

### Accounting
- [ ] Default CoA seeded (44 accounts)
- [ ] Accounting policies configured (23 GL mappings)
- [ ] Financial accounts created (cash, bank, mobile wallet)
- [ ] Fiscal periods created for current + next quarter
- [ ] Tax components configured (VAT/SD/RD/ATV — rates pending tax adviser)

### Load Testing
- [ ] POS sale p95 ≤ 2s (k6: tests/load/pos-sale.k6.js)
- [ ] Product search p95 ≤ 800ms (k6: tests/load/product-search.k6.js)
- [ ] Dashboard p95 ≤ 3s
- [ ] No p99 > 10s

### Accessibility
- [ ] axe scan on all critical routes
- [ ] Keyboard-only POS test passed
- [ ] Responsive tests (mobile/tablet/desktop)
- [ ] bn-BD + en-BD locale switch tested

## Deployment

- [ ] Deploy to production with manual migration approval
- [ ] Post-deploy health check (GET /api/v1/health)
- [ ] RLS isolation verification (cross-tenant access fails)
- [ ] Post-deploy reconciliation run
- [ ] Monitor alerts for 72h stabilization

## External Sign-Offs (Appendix B)

- [ ] Tax professional (§20.D08) — rates, thresholds, Mushak forms
- [ ] Legal counsel (§20.D09) — privacy notice, retention, DSR
- [ ] Labour counsel (§20.D18) — payroll deductions, BEFTN
- [ ] PCI DSS QSA (§20.D20) — payment card handling boundary
- [ ] Accounting owner (§20.D08) — CoA mappings, opening balances
- [ ] Forex advisor (§20.D12) — Bangladesh Bank forex regulations (if multi-currency)

## Stakeholder Sign-Off

- [ ] Production owner
- [ ] Finance owner
- [ ] Inventory owner
- [ ] Security owner
- [ ] Operations owner
- [ ] Tax owner
