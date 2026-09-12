# Live-readiness remediation work record

Baseline: main, `97a860794f0248e51f4aeecedae802a8726c7a34`; no change from audited commit. Existing untracked relation/model inventories preserved. Node 24.12.0; Next 16.3.3; Prisma/client 6.19.3; Bun unavailable on PATH. Production remains out of scope. No deployment/push authorized.

Status describes baseline, not completion. All checks require post-change evidence.

| ID | Severity | Current state | Affected areas | Required proof | Migration | Impact |
|---|---|---|---|---|---|---|
| AUTH-01 | P1 | CONFIRMED | API handlers, permissions | Per-method allowed/denied/401 matrix | Permission seed only | Unauthorized business writes |
| AUTH-02 | P1 | CONFIRMED | Auth, stock/money routes | Same-tenant denied branch and two tenants | No | Branch stock/money access |
| Tenant context | P1 gate | NEEDS EXECUTABLE PROOF | Every authenticateRequest caller, nested services | Context absence, isolation, concurrent requests | No | Fail-closed isolation |
| AUTH-03 | P1 | CONFIRMED | sessions, login, MFA verify, enrollment | Forgery, purpose, expiry, atomic replay rejection | Likely challenge storage | Password-factor bypass |
| AUTH-04 | P1 | CONFIRMED | sessions, refresh, logout | Exact cookie path, revoked-family refresh, browser logout | Review family state | Session persistence |
| FIN-03 | P1 | CONFIRMED | PostJournalEntry, PostSale | Exact quantized balance, missing policy/period/account | Guarded posting review | Missing/unequal GL |
| FIN-02 | P1 | CONFIRMED | Money commands | BDT + foreign currency base amounts | Contract review | Material FX misposting |
| FIN-01 | P1 | CONFIRMED | VoidSale, PostSaleReturn, Payments | Original/correction GL, partial/mixed tender, repeat | Provenance review | GL/subledger divergence |
| PAY-01 | P1 | CONFIRMED | POS tender, Loyalty | Reject unsupported value or atomic redemption | If enabled | Unfunded stock release |
| Store credit | P1 | CONFIRMED | POS tender | Reject unsupported value or atomic consumption | If enabled | Unfunded tender |
| INV-01 | P1 | CONFIRMED | stockMovement | Intervening receipt reversal: qty/value/MAC | Review reversal uniqueness | Stock valuation divergence |
| Batch/combo | P1 gate | NEEDS EXECUTABLE PROOF | Sale/receive/return | Component/batch/serial invariants; disable unsupported | Review | Inventory correctness |
| DB-01 | P1 | CONFIRMED | AuditLog schema | >191, >1KB, Bangla JSON on MariaDB | YES forward only | Transaction failure/truncation |
| Provenance | P1 gate | CONFIRMED | Depreciation and scalar FK inventory | Orphan scan, parent delete rejection | YES forward only | Financial history loss |
| M1 | Wiring | CONFIRMED | Purchase page | Warehouse's actual branch in UI/API | No | Purchase creation dead end |
| M2 | Financial | CONFIRMED | Account transfers | FX/fees/base equality and journal link | Review | Posting/traceability |
| M3 | Wiring | CONFIRMED | Campaign UI/domain | Sandbox delivery or explicit unavailable | Review if implemented | Advertised incomplete flow |
| M4 | Wiring | CONFIRMED | Integrations/offline | GET status + durable offline replay | Review | Invisible sync failures |
| M5 | Wiring | CONFIRMED | Webhook page/API | Complete one-time reveal, no later leak | No | Setup dead end |
| A/B/C Admin | Required | CONFIRMED | User/role UI/API/navigation absent | Persona E2E, escalation prevention | Review | Admin control plane missing |
| D Support | Required | NEEDS EXECUTABLE PROOF | Support page/models | Server-backed two-tenant tickets/messages | Existing models | Persistence/security |
| E Coupons/rewards | Required | CONFIRMED | Loyalty/schema | Real ledgers, bounds, concurrency | Review | Schema/domain drift |
| F Model use | Required | NEEDS EXECUTABLE PROOF | 50 zero-direct-reference models | Nested/raw/dynamic/reserved/unwired classification | No deletion | Coverage |
| G PWA | Required | CONFIRMED | public/sw.js | node syntax check currently fails line 23; browser/offline E2E | No | Offline unavailable |
| H Context redesign | Required | NEEDS EXECUTABLE PROOF | Explicit ALS run helpers | Never restore enterWith; every caller covered | No | Tenant safety |
| I Docs | Required | CONFIRMED | README/provider descriptions | Update after executable verification | No | Operational accuracy |
| Journal >200 | Financial | CONFIRMED source | Journal list API | List/detail/DB aggregates agree >200 lines | No | Truncated financial totals |
| TypeScript | Gate | CONFIRMED | N+1 mock tuple types | Zero compiler errors | No | Release check failure |

Implementation order: security; financial integrity; stored value/inventory; database; workflow wiring; admin; certification. Mock tests do not establish database/concurrency certification. Score and readiness remain unassigned until executable gates are measured.
