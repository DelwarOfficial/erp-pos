# Graph Report - erp-pos  (2026-10-04)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2806 nodes · 13799 edges · 98 communities (88 shown, 10 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 59 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fa1daa02`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- codes.ts
- requireIdempotencyKey
- authenticateRequest
- Button
- CardDescription
- ref_react
- DomainError
- apiFetch
- service.ts
- ref_lucide_react
- cn
- FollowThrough.tsx
- sessions.ts
- onboarding/route.ts
- collections.ts
- ref_node_crypto
- gift-cards/route.ts
- runInTenantContext
- postJournalEntry
- users.tsx
- utils.ts
- audit/index.ts
- crypto/index.ts
- enrollment.ts
- reminders.ts
- export-jobs/route.ts
- dashboard/layout.tsx
- ref_prisma_client
- templateSettings.ts
- app/layout.tsx
- use-toast.ts
- campaigns.ts
- checks.ts
- followUps.ts
- recordSecurityEvent
- alert-dialog.tsx
- PostSale.ts
- mocks/index.ts
- workers/index.ts
- providers.ts
- ref_zod
- outboxWorker.ts
- PostStockAdjustment.ts
- CashierShift.ts
- reports/index.ts
- approvals/route.ts
- distributedRateLimiter.ts
- runtime.ts
- tenantClient.ts
- logout/route.ts
- dropdown-menu.tsx
- Service.ts
- slackProvider.ts
- menubar.tsx
- context-menu.tsx
- escpos/index.ts
- CourierProvider
- PaymentProvider
- systemDb
- storage/index.ts
- generate/route.ts
- carousel.tsx
- dec
- ProviderRegistry
- riskProvider.ts
- form.tsx
- middleware.ts
- dueReminders.ts
- chart.tsx
- drawer.tsx
- Transfer.ts
- bank-reconciliations/route.ts
- navigation-menu.tsx
- BankReconciliation.ts
- command.tsx
- toggle-group.tsx
- PostPayrollRun.ts
- periodClose.ts
- dataSubjectRequests.ts
- productActivation.ts
- detailMeta
- reminder-policy/route.ts
- AdjustmentsPage
- dashboard/reports/page.tsx
- transactionContext.ts
- S3StorageAdapter
- ReportSqlScope
- sync/route.ts
- useAuth.ts
- QrErrorBoundary
- calendar/page.tsx
- revaluation.ts
- reportStockAlert

## God Nodes (most connected - your core abstractions)
1. `DomainError` - 500 edges
2. `authenticateRequest()` - 456 edges
3. `requirePermission()` - 436 edges
4. `runInTenantContext()` - 430 edges
5. `errorResponse()` - 411 edges
6. `getCorrelationId()` - 409 edges
7. `requireIdempotencyKey()` - 259 edges
8. `withTenant()` - 233 edges
9. `cn()` - 232 edges
10. `computeRequestHash()` - 220 edges

## Surprising Connections (you probably didn't know these)
- `ExpenseItem` --references--> `BusinessEntity`  [EXTRACTED]
  app/(erp)/dashboard/expenses/page.tsx → components/shared/EntityPicker.tsx
- `postGiftCardRefund()` --calls--> `DomainError`  [EXTRACTED]
  domain/commands/m6/Loyalty.ts → lib/errors/codes.ts
- `AccordionContent()` --calls--> `cn()`  [EXTRACTED]
  components/ui/accordion.tsx → lib/utils.ts
- `AccordionItem()` --calls--> `cn()`  [EXTRACTED]
  components/ui/accordion.tsx → lib/utils.ts
- `AccordionTrigger()` --calls--> `cn()`  [EXTRACTED]
  components/ui/accordion.tsx → lib/utils.ts

## Import Cycles
- None detected.

## Communities (98 total, 10 thin omitted)

### Community 0 - "codes.ts"
Cohesion: 0.07
Nodes (55): GET(), BrandCreateSchema, GET(), CategoryCreateSchema, GET(), CoaSchema, GET(), Body (+47 more)

### Community 1 - "requireIdempotencyKey"
Cohesion: 0.05
Nodes (104): POST(), POST(), POST(), POST(), POST(), GET(), POST(), POST() (+96 more)

### Community 2 - "authenticateRequest"
Cohesion: 0.05
Nodes (97): CreateTransferSchema, GET(), POST(), GET(), GET(), POST(), ReceiveAdvanceSchema, Context (+89 more)

### Community 3 - "Button"
Cohesion: 0.07
Nodes (76): LoginPage(), MfaPage(), MfaSetupPage(), FiscalPeriodsPage(), AccountingPage(), TrialBalanceAccount, TrialBalancePage(), AuditPage() (+68 more)

### Community 4 - "CardDescription"
Cohesion: 0.08
Nodes (83): Applied, CustomerCollectionPage(), METHODS, Option, Receivable, TimelineEvent, CollectionsPage(), Overview (+75 more)

### Community 5 - "ref_react"
Cohesion: 0.07
Nodes (62): Period, AuditLog, Row(), Shift, LeadDetail, LeadStatus, LeadSummary, localDateTime() (+54 more)

### Community 6 - "DomainError"
Cohesion: 0.04
Nodes (78): FIELD_MAP, GET(), POLICY_FIELDS, PUT(), UpdatePolicySchema, GET(), POST(), generateRecommendations() (+70 more)

### Community 7 - "apiFetch"
Cohesion: 0.04
Nodes (83): handleSubmit(), loadEntries(), handleAcquire(), handleDepreciate(), handleDispose(), handleAutoMatch(), handleCreate(), handleFinalize() (+75 more)

### Community 8 - "service.ts"
Cohesion: 0.09
Nodes (52): GET(), GET(), GET(), Context, DELETE(), GET(), PATCH(), GET() (+44 more)

### Community 9 - "ref_lucide_react"
Cohesion: 0.11
Nodes (44): ChartOfAccount, JournalEntry, JournalPage(), Asset, CoaAccount, FinancialAccount, FixedAssetsPage(), STATUS_COLOR (+36 more)

### Community 10 - "cn"
Cohesion: 0.06
Nodes (47): BreadcrumbEllipsis(), BreadcrumbItem(), BreadcrumbLink(), BreadcrumbList(), BreadcrumbPage(), BreadcrumbSeparator(), CardAction(), InputOTP() (+39 more)

### Community 11 - "FollowThrough.tsx"
Cohesion: 0.09
Nodes (49): Campaign, CampaignsPage(), cancel(), create(), send(), post(), Preview, STATUS (+41 more)

### Community 12 - "sessions.ts"
Cohesion: 0.12
Nodes (38): LoginSchema, POST(), ActivateSchema, POST(), GET(), MfaSchema, POST(), POST() (+30 more)

### Community 13 - "onboarding/route.ts"
Cohesion: 0.06
Nodes (35): hasPlatformOnboardPermission(), OnboardSchema, POST(), GET(), Money(), MoneyProps, Quantity(), QuantityProps (+27 more)

### Community 14 - "collections.ts"
Cohesion: 0.11
Nodes (41): openInstallmentsCte(), addDays(), dateFromIso(), daysBetween(), IsoDate, zonedMidnight(), collectionCalendar(), collectionReport() (+33 more)

### Community 15 - "ref_node_crypto"
Cohesion: 0.08
Nodes (31): postLandedCost(), PostLandedCostInput, postExpense(), PostExpenseInput, PostExpenseResult, ALLOWED_TRANSITIONS, CreateDeliveryInput, createDeliveryOrder() (+23 more)

### Community 16 - "gift-cards/route.ts"
Cohesion: 0.08
Nodes (30): POST(), RevaluateSchema, CreateDeliverySchema, GET(), POST(), PATCH(), ToggleSchema, GET() (+22 more)

### Community 17 - "runInTenantContext"
Cohesion: 0.08
Nodes (31): GET(), POST(), GET(), POST(), GET(), GET(), JournalLineSchema, POST() (+23 more)

### Community 18 - "postJournalEntry"
Cohesion: 0.08
Nodes (28): applyCustomerAdvance(), bounceCheque(), cancelCheque(), clearCheque(), postAccountAdjustment(), postAccountTransfer(), reversePayment(), updateChequeStatus() (+20 more)

### Community 19 - "users.tsx"
Cohesion: 0.14
Nodes (24): Page(), Page(), Page(), Page(), Page(), ResetPasswordPage(), submit(), AccessHeading() (+16 more)

### Community 20 - "utils.ts"
Cohesion: 0.06
Nodes (13): AccordionContent(), AccordionItem(), AccordionTrigger(), HoverCardContent(), PopoverContent(), Progress(), RadioGroup(), RadioGroupItem() (+5 more)

### Community 21 - "audit/index.ts"
Cohesion: 0.11
Nodes (26): POST(), mapCourierStatus(), POST(), AuditParams, SecurityEventParams, getTenantContext(), errorMeta(), log() (+18 more)

### Community 22 - "crypto/index.ts"
Cohesion: 0.11
Nodes (22): decrypt(), decryptString(), encrypt(), EncryptedPayload, encryptString(), getMasterKey(), Client, describeSmsAccount() (+14 more)

### Community 23 - "enrollment.ts"
Cohesion: 0.11
Nodes (28): barcodeSigningKey(), generateSignedQrPayload(), Symbology, VALID_SYMBOLOGIES, verifySignedQrPayload(), activateEnrollment(), ActivationResult, EnrollmentContext (+20 more)

### Community 24 - "reminders.ts"
Cohesion: 0.14
Nodes (32): GET(), audience(), latestSmsConsent(), installmentBalances(), isoFromDate(), localDate(), localMinuteOfDay(), rescheduleInstallment() (+24 more)

### Community 25 - "export-jobs/route.ts"
Cohesion: 0.14
Nodes (25): GET(), regenCustomerList(), regenerateExport(), regenInventoryValuation(), regenProductList(), regenSalesSummary(), exportCustomerList(), exportInventoryValuation() (+17 more)

### Community 26 - "dashboard/layout.tsx"
Cohesion: 0.13
Nodes (23): DashboardLayout(), isActiveRoute(), NAV_GROUPS, NAV_ITEMS, NAV_PERMISSIONS, DashboardSession, DashboardUser, Avatar() (+15 more)

### Community 27 - "ref_prisma_client"
Cohesion: 0.11
Nodes (23): postOpeningStock(), PostOpeningStockInput, PostOpeningStockResult, postPurchaseReturn(), PostPurchaseReturnInput, receivePurchase(), ReceivePurchaseInput, ReceivePurchaseResult (+15 more)

### Community 28 - "templateSettings.ts"
Cohesion: 0.13
Nodes (27): renderFor(), DEFAULT_REMINDER_TEMPLATES, formatDueDate(), formatTaka(), REMINDER_PLACEHOLDERS, ReminderKind, ReminderLocale, ReminderValues (+19 more)

### Community 29 - "app/layout.tsx"
Cohesion: 0.11
Nodes (19): geistMono, geistSans, metadata, RootLayout(), viewport, ConnectivityState, deleteOutbox(), getAllOutbox() (+11 more)

### Community 30 - "use-toast.ts"
Cohesion: 0.12
Nodes (24): Toast, ToastAction, ToastActionElement, ToastClose, ToastDescription, ToastProps, ToastTitle, toastVariants (+16 more)

### Community 31 - "campaigns.ts"
Cohesion: 0.10
Nodes (27): CAMPAIGN_AUDIENCE_MAX, CAMPAIGN_PLACEHOLDERS, CAMPAIGN_TEXT_MAX, CampaignPreview, cancelCampaign(), Candidate, checkCampaignText(), companySetup() (+19 more)

### Community 32 - "checks.ts"
Cohesion: 0.08
Nodes (10): ALL_CHECKS, checkGiftCardLiability(), checkReservationProjection(), checkSerialStockCount(), checkStockQtyLedger(), checkStockValueLedger(), ReconciliationCheck, ReconciliationCheckError (+2 more)

### Community 33 - "followUps.ts"
Cohesion: 0.11
Nodes (26): Client, InstallmentBalance, OPEN_SALE_STATUSES, Row, saleOutstanding(), audit(), cancelPromise(), closeFollowUp() (+18 more)

### Community 34 - "recordSecurityEvent"
Cohesion: 0.13
Nodes (22): FinishSchema, POST(), recordSecurityEvent(), beginRegistration(), finishAuthentication(), finishRegistration(), getOrigin(), getRpId() (+14 more)

### Community 35 - "alert-dialog.tsx"
Cohesion: 0.10
Nodes (19): AlertDialogAction(), AlertDialogCancel(), AlertDialogContent(), AlertDialogDescription(), AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay(), AlertDialogPortal() (+11 more)

### Community 36 - "PostSale.ts"
Cohesion: 0.11
Nodes (23): postSale(), PostSaleInput, PostSaleResult, SaleProduct, PaymentArrangement, applicableComponents(), applySequence(), ComputedComponentTax (+15 more)

### Community 37 - "mocks/index.ts"
Cohesion: 0.13
Nodes (9): logCall(), MockCall, mockCallLog, MockCourierProvider, MockEmailProvider, MockPaymentProvider, MockRiskProvider, MockSmsProvider (+1 more)

### Community 38 - "workers/index.ts"
Cohesion: 0.15
Nodes (18): assertProductionSecurityConfig(), buildTenantContext(), clearWorkerHeartbeat(), HeartbeatWriter, WORKER_HEARTBEAT_INTERVAL_MS, WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_STALE_MS, writeWorkerHeartbeat() (+10 more)

### Community 39 - "providers.ts"
Cohesion: 0.15
Nodes (11): EmailProvider, RiskProvider, SmsProvider, MimSmsProvider, registerProviders(), ResendEmailProvider, SendGridEmailProvider, SesEmailProvider (+3 more)

### Community 40 - "ref_zod"
Cohesion: 0.13
Nodes (16): Context, GET(), POST(), GET(), POST(), EDITABLE_STATUSES, ExpenseUpdateSchema, GET() (+8 more)

### Community 41 - "outboxWorker.ts"
Cohesion: 0.15
Nodes (18): assertSafeOutboundUrl(), blocked, guardedLookup(), isForbiddenAddress(), OutboundResponse, parse(), postToOutboundUrl(), generateDeliveryId() (+10 more)

### Community 42 - "PostStockAdjustment.ts"
Cohesion: 0.14
Nodes (17): createStockCount(), CreateStockCountInput, STOCK_COUNT_INSERT_BATCH, STOCK_COUNT_TRANSACTION_TIMEOUT_MS, StockCountLineInput, actOnStockAdjustment(), postStockAdjustment(), PostStockAdjustmentInput (+9 more)

### Community 43 - "CashierShift.ts"
Cohesion: 0.13
Nodes (15): closeCashierShift(), CloseShiftInput, openCashierShift(), OpenShiftInput, applyOfflineCommand(), CashSalePayload, OfflineCommandOutcome, parse() (+7 more)

### Community 44 - "reports/index.ts"
Cohesion: 0.12
Nodes (17): computeTrialBalance(), LEDGER_STATUSES, TrialBalance, TrialBalanceAccount, Tx, accountTotals(), BUCKET, partyLedger() (+9 more)

### Community 45 - "approvals/route.ts"
Cohesion: 0.13
Nodes (14): POST(), ResolveSchema, CreateSchema, GET(), POST(), APPROVABLE_STATUSES, ApproveSchema, POST() (+6 more)

### Community 46 - "distributedRateLimiter.ts"
Cohesion: 0.19
Nodes (16): POST(), POST(), checkDistributedRateLimit(), digest(), resetDistributedRateLimit(), withRedis(), checkRateLimit(), DEFAULT_LOGIN_LIMIT (+8 more)

### Community 47 - "runtime.ts"
Cohesion: 0.16
Nodes (16): GET(), CheckState, checkStateSchema, HealthResponse, healthResponseSchema, overallHealth(), parseHealth(), timing (+8 more)

### Community 48 - "tenantClient.ts"
Cohesion: 0.12
Nodes (13): assertBranchAccess(), globalForPrisma, tenantDb, BRANCH_PARENTS, branchScopeFor(), modelByName, applyTenantIsolation(), DIRECT_TENANT_MODELS (+5 more)

### Community 49 - "logout/route.ts"
Cohesion: 0.16
Nodes (14): POST(), getRefreshCookieName(), ACCESS_TOKEN_TTL_MS, AccessClaims, getSecret(), issueAccessToken(), REFRESH_TOKEN_TTL_MS, verifyAccessToken() (+6 more)

### Community 50 - "dropdown-menu.tsx"
Cohesion: 0.15
Nodes (12): ThemeControl(), DropdownMenu(), DropdownMenuCheckboxItem(), DropdownMenuContent(), DropdownMenuItem(), DropdownMenuLabel(), DropdownMenuRadioItem(), DropdownMenuSeparator() (+4 more)

### Community 51 - "Service.ts"
Cohesion: 0.17
Nodes (15): fulfillWarrantyClaim(), FulfillWarrantyClaimInput, ALLOWED_SERVICE_TRANSITIONS, ConsumeServicePartInput, createServiceRequest(), CreateServiceRequestInput, postServicePartConsumption(), validateServiceTransition() (+7 more)

### Community 52 - "slackProvider.ts"
Cohesion: 0.14
Nodes (8): NotificationProvider, MockNotificationProvider, SEVERITY_COLORS, SEVERITY_EMOJI, SlackWebhookProvider, escapeHtml(), SEVERITY_EMOJI, TelegramBotProvider

### Community 53 - "menubar.tsx"
Cohesion: 0.12
Nodes (12): Menubar(), MenubarCheckboxItem(), MenubarContent(), MenubarItem(), MenubarLabel(), MenubarPortal(), MenubarRadioItem(), MenubarSeparator() (+4 more)

### Community 54 - "context-menu.tsx"
Cohesion: 0.12
Nodes (9): ContextMenuCheckboxItem(), ContextMenuContent(), ContextMenuItem(), ContextMenuLabel(), ContextMenuRadioItem(), ContextMenuSeparator(), ContextMenuShortcut(), ContextMenuSubContent() (+1 more)

### Community 55 - "escpos/index.ts"
Cohesion: 0.21
Nodes (14): align(), bold(), buildReceiptBytes(), cut(), feed(), init(), padLine(), ReceiptData (+6 more)

### Community 56 - "CourierProvider"
Cohesion: 0.12
Nodes (3): CourierProvider, PathaoCourierProvider, RedxCourierProvider

### Community 57 - "PaymentProvider"
Cohesion: 0.14
Nodes (3): PaymentProvider, BkashPaymentProvider, NagadPaymentProvider

### Community 58 - "systemDb"
Cohesion: 0.17
Nodes (14): systemDb, DEFAULT_AUDIT_RETENTION_DAYS, DEFAULT_CUSTOMER_ANONYMIZE_DAYS, RetentionCompanyResult, retentionDaysFor(), RetentionPolicy, RetentionResult, runForCompany() (+6 more)

### Community 60 - "generate/route.ts"
Cohesion: 0.24
Nodes (13): POST(), amountInWords(), generateMushak61(), generateMushak63(), generateMushak91(), generateWithholdingCertificate(), Mushak61Data, Mushak63Data (+5 more)

### Community 61 - "carousel.tsx"
Cohesion: 0.17
Nodes (13): Carousel(), CarouselApi, CarouselContent(), CarouselContext, CarouselContextProps, CarouselItem(), CarouselNext(), CarouselOptions (+5 more)

### Community 62 - "dec"
Cohesion: 0.24
Nodes (15): agingTotals(), controlAccountBalance(), count(), dec(), payableSql(), receivableSql(), reportApAging(), reportArAging() (+7 more)

### Community 64 - "riskProvider.ts"
Cohesion: 0.21
Nodes (4): CONFIG, InternalRiskProvider, RISK_CONFIG, RuleResult

### Community 65 - "form.tsx"
Cohesion: 0.19
Nodes (10): FormControl(), FormDescription(), FormFieldContext, FormFieldContextValue, FormItem(), FormItemContext, FormItemContextValue, FormLabel() (+2 more)

### Community 66 - "middleware.ts"
Cohesion: 0.22
Nodes (10): ACCESS_COOKIE_NAME, getAccessCookieName(), REFRESH_COOKIE_NAME, contentSecurityPolicy(), newNonce(), config, EXEMPT_PATHS, middleware() (+2 more)

### Community 67 - "dueReminders.ts"
Cohesion: 0.24
Nodes (12): completeFinishedCampaigns(), planDueReminders(), pollDeliveryReports(), recoverInterruptedSends(), sendableMessageIds(), SMS_PROVIDER, companiesWithSms(), reminderContext() (+4 more)

### Community 68 - "chart.tsx"
Cohesion: 0.24
Nodes (10): ChartConfig, ChartContainer(), ChartContext, ChartContextProps, ChartLegendContent(), ChartStyle(), ChartTooltipContent(), getPayloadConfigFromPayload() (+2 more)

### Community 69 - "drawer.tsx"
Cohesion: 0.20
Nodes (7): DrawerContent(), DrawerDescription(), DrawerFooter(), DrawerHeader(), DrawerOverlay(), DrawerPortal(), DrawerTitle()

### Community 70 - "Transfer.ts"
Cohesion: 0.29
Nodes (10): cancelTransfer(), createTransfer(), CreateTransferInput, dispatchTransfer(), DispatchTransferInput, moveTransferSerial(), receiveTransfer(), ReceiveTransferInput (+2 more)

### Community 71 - "bank-reconciliations/route.ts"
Cohesion: 0.24
Nodes (9): BulkSchema, POST(), StatementLineSchema, CreateReconciliationSchema, GET(), POST(), StatementLineSchema, addStatementLinesBulk() (+1 more)

### Community 72 - "navigation-menu.tsx"
Cohesion: 0.22
Nodes (9): NavigationMenu(), NavigationMenuContent(), NavigationMenuIndicator(), NavigationMenuItem(), NavigationMenuLink(), NavigationMenuList(), NavigationMenuTrigger(), navigationMenuTriggerStyle (+1 more)

### Community 73 - "BankReconciliation.ts"
Cohesion: 0.25
Nodes (10): addStatementLine(), AutoMatchResult, autoMatchTransactions(), CreateBankReconciliationInput, CreateBankReconciliationResult, manualMatch(), postReconciliationVariance(), PostVarianceResult (+2 more)

### Community 74 - "command.tsx"
Cohesion: 0.20
Nodes (7): Command(), CommandGroup(), CommandInput(), CommandItem(), CommandList(), CommandSeparator(), CommandShortcut()

### Community 75 - "toggle-group.tsx"
Cohesion: 0.29
Nodes (5): ToggleGroup(), ToggleGroupContext, ToggleGroupItem(), Toggle(), toggleVariants

### Community 76 - "PostPayrollRun.ts"
Cohesion: 0.25
Nodes (5): PayrollItemInput, postPayrollRun(), PostPayrollRunInput, BEFTNEntry, BEFTNFileOptions

### Community 77 - "periodClose.ts"
Cohesion: 0.33
Nodes (8): controlBackdating(), PeriodCloseProgress, PeriodCloseResult, PeriodStatus, reviewDrafts(), runPeriodCloseWorkflow(), runReconciliationForClose(), runReconciliation()

### Community 78 - "dataSubjectRequests.ts"
Cohesion: 0.36
Nodes (8): buildSubjectExport(), fulfilDataSubjectRequest(), loadOpenRequest(), requireSubject(), Subject, subjectOf(), Tx, isUnderLegalHold()

### Community 80 - "productActivation.ts"
Cohesion: 0.36
Nodes (6): ComboEdge, detectComboCycle(), dfs(), validateComboGraph(), ProductActivationParams, validateProductActivation()

### Community 81 - "detailMeta"
Cohesion: 0.29
Nodes (8): detailMeta(), inventoryTotals(), reportCashFlow(), reportInventoryLedger(), reportInventoryValuation(), reportProductInventory(), reportSalesSummary(), reportStockCountVariance()

### Community 82 - "reminder-policy/route.ts"
Cohesion: 0.48
Nodes (6): DEFAULTS, GET(), PolicySchema, present(), PUT(), parseStageOffsets()

### Community 83 - "AdjustmentsPage"
Cohesion: 0.48
Nodes (6): AdjustmentsPage(), action(), create(), resolve(), view(), emptyLine()

### Community 84 - "dashboard/reports/page.tsx"
Cohesion: 0.29
Nodes (6): Category, CATEGORY_DESCRIPTIONS, CATEGORY_ORDER, ExportJobResponse, REPORT_CATALOG, ReportEntry

### Community 85 - "transactionContext.ts"
Cohesion: 0.43
Nodes (3): requireTenantContext(), TenantContext, tenantStorage

### Community 87 - "ReportSqlScope"
Cohesion: 0.43
Nodes (6): periodTotals(), reportDailyPurchases(), reportDailySales(), reportMonthlyPurchases(), reportMonthlySales(), ReportSqlScope

### Community 88 - "sync/route.ts"
Cohesion: 0.40
Nodes (4): OfflineCommandSchema, POST(), SyncSchema, OFFLINE_SYNC_MAX_COMMANDS

### Community 89 - "useAuth.ts"
Cohesion: 0.47
Nodes (4): PermissionGate(), PermissionGateProps, AuthUser, useAuth()

### Community 91 - "calendar/page.tsx"
Cohesion: 0.40
Nodes (4): addMonths(), Calendar, Day, WEEKDAYS

### Community 94 - "reportStockAlert"
Cohesion: 1.00
Nodes (3): lowStockCount(), lowStockFrom(), reportStockAlert()

## Knowledge Gaps
- **587 isolated node(s):** `ListPage`, `UnitOfWork`, `ErrorCode`, `IdempotencyResult`, `SidebarContextProps` (+582 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 868 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DomainError` connect `DomainError` to `codes.ts`, `requireIdempotencyKey`, `authenticateRequest`, `service.ts`, `sessions.ts`, `onboarding/route.ts`, `collections.ts`, `ref_node_crypto`, `gift-cards/route.ts`, `runInTenantContext`, `postJournalEntry`, `crypto/index.ts`, `enrollment.ts`, `reminders.ts`, `export-jobs/route.ts`, `ref_prisma_client`, `templateSettings.ts`, `campaigns.ts`, `followUps.ts`, `recordSecurityEvent`, `PostSale.ts`, `ref_zod`, `outboxWorker.ts`, `PostStockAdjustment.ts`, `CashierShift.ts`, `reports/index.ts`, `approvals/route.ts`, `distributedRateLimiter.ts`, `tenantClient.ts`, `logout/route.ts`, `Service.ts`, `generate/route.ts`, `Transfer.ts`, `bank-reconciliations/route.ts`, `BankReconciliation.ts`, `PostPayrollRun.ts`, `periodClose.ts`, `dataSubjectRequests.ts`, `productActivation.ts`, `reminder-policy/route.ts`, `transactionContext.ts`, `sync/route.ts`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **Why does `cn()` connect `cn` to `Button`, `CardDescription`, `ref_react`, `apiFetch`, `ref_lucide_react`, `FollowThrough.tsx`, `utils.ts`, `dashboard/layout.tsx`, `use-toast.ts`, `alert-dialog.tsx`, `dropdown-menu.tsx`, `menubar.tsx`, `context-menu.tsx`, `carousel.tsx`, `form.tsx`, `chart.tsx`, `drawer.tsx`, `navigation-menu.tsx`, `command.tsx`, `toggle-group.tsx`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **Why does `apiFetch()` connect `apiFetch` to `Button`, `CardDescription`, `ref_react`, `ref_lucide_react`, `FollowThrough.tsx`, `AdjustmentsPage`, `dashboard/reports/page.tsx`, `users.tsx`, `useAuth.ts`, `dashboard/layout.tsx`, `calendar/page.tsx`, `app/layout.tsx`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **What connects `ListPage`, `UnitOfWork`, `ErrorCode` to the rest of the system?**
  _587 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `codes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07399794450154162 - nodes in this community are weakly interconnected._
- **Should `requireIdempotencyKey` be split into smaller, more focused modules?**
  _Cohesion score 0.049317068084662706 - nodes in this community are weakly interconnected._
- **Should `authenticateRequest` be split into smaller, more focused modules?**
  _Cohesion score 0.04769001490312966 - nodes in this community are weakly interconnected._