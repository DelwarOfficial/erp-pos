# পৃষ্ঠা ও মডিউলের coverage তালিকা

[সূচিপত্র](README.md) · [যাচাইয়ের সীমা](VERIFICATION.md)

এই তালিকা বর্তমান `src/app/**/page.tsx` ও dashboard navigation থেকে তৈরি। অনুমোদিত লোকাল ডেমোয় global administrator হিসেবে ৪৮টি dashboard route দেখা হয়েছে। অন্য role-এর access আলাদা করে পরীক্ষা হয়নি। `[id]` route-এর existing নথি এই পর্যালোচনায় খোলা হয়নি।

**মোট page file: 59।** সবগুলোর entry নিচে আছে। Inline editor, printer route ও অসম্পূর্ণ module আলাদা তালিকায় আছে।

Source link বোঝায় সংশ্লিষ্ট page পড়া হয়েছে; chapter-এর evidence link-এ গুরুত্বপূর্ণ component/guard-এর প্রমাণ আছে। UI-তে দেখা মানে page/form পর্যবেক্ষণ; কোনো business transaction পরীক্ষা হয়নি।

| পৃষ্ঠা / route | কার জন্য | প্রমাণ ও অধ্যায় | অবস্থা | সীমা |
|---|---|---|---|---|
| Sign in to ERP POS<br>`/login` | সব ব্যবহারকারী | [সোর্স](<../../../src/app/(auth)/login/page.tsx>) · [অধ্যায়](02-login-security.md) | UI-তে দেখা; login ও dashboard navigation সফল | অনুমোদিত login POST HTTP 200; MFA/reset/logout পরীক্ষা হয়নি। |
| Enter your sign-in code<br>`/mfa` | সব ব্যবহারকারী | [সোর্স](<../../../src/app/(auth)/mfa/page.tsx>) · [অধ্যায়](02-login-security.md) | শুধু সোর্সে পর্যবেক্ষিত | Login-পরবর্তী UI ও ফল runtime যাচাই করা যায়নি। |
| প্রথম MFA setup<br>`/mfa/setup` | সব ব্যবহারকারী | [সোর্স](<../../../src/app/(auth)/mfa/setup/page.tsx>) · [অধ্যায়](02-login-security.md) | শুধু সোর্সে পর্যবেক্ষিত | Login-পরবর্তী UI ও ফল runtime যাচাই করা যায়নি। |
| Access Control — Permissions<br>`/dashboard/access/permissions` | অনুমোদিত administrator | [সোর্স](<../../../src/app/(erp)/dashboard/access/permissions/page.tsx>) · [অধ্যায়](05-access.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Role editor; new form একই route ব্যবহার করে<br>`/dashboard/access/roles/[id]` | অনুমোদিত administrator | [সোর্স](<../../../src/app/(erp)/dashboard/access/roles/[id]/page.tsx>) · [অধ্যায়](05-access.md) | নতুন form UI-তে দেখা; existing detail সোর্সে | সংশ্লিষ্ট /new route খুলে form দেখা; কোনো user/role save হয়নি। |
| Access Control — Roles<br>`/dashboard/access/roles` | অনুমোদিত administrator | [সোর্স](<../../../src/app/(erp)/dashboard/access/roles/page.tsx>) · [অধ্যায়](05-access.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| User editor; new form একই route ব্যবহার করে<br>`/dashboard/access/users/[id]` | অনুমোদিত administrator | [সোর্স](<../../../src/app/(erp)/dashboard/access/users/[id]/page.tsx>) · [অধ্যায়](05-access.md) | নতুন form UI-তে দেখা; existing detail সোর্সে | সংশ্লিষ্ট /new route খুলে form দেখা; কোনো user/role save হয়নি। |
| Access Control — Users<br>`/dashboard/access/users` | অনুমোদিত administrator | [সোর্স](<../../../src/app/(erp)/dashboard/access/users/page.tsx>) · [অধ্যায়](05-access.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Fiscal periods<br>`/dashboard/accounting/fiscal-periods` | হিসাবরক্ষক | [সোর্স](<../../../src/app/(erp)/dashboard/accounting/fiscal-periods/page.tsx>) · [অধ্যায়](13-accounting-reports.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Journal Entries<br>`/dashboard/accounting/journal` | হিসাবরক্ষক | [সোর্স](<../../../src/app/(erp)/dashboard/accounting/journal/page.tsx>) · [অধ্যায়](13-accounting-reports.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Accounting<br>`/dashboard/accounting` | হিসাবরক্ষক | [সোর্স](<../../../src/app/(erp)/dashboard/accounting/page.tsx>) · [অধ্যায়](13-accounting-reports.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Trial Balance<br>`/dashboard/accounting/trial-balance` | হিসাবরক্ষক | [সোর্স](<../../../src/app/(erp)/dashboard/accounting/trial-balance/page.tsx>) · [অধ্যায়](13-accounting-reports.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Equipment & Assets<br>`/dashboard/assets` | Asset হিসাবরক্ষক | [সোর্স](<../../../src/app/(erp)/dashboard/assets/page.tsx>) · [অধ্যায়](13-accounting-reports.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Activity History<br>`/dashboard/audit` | অনুমতিপ্রাপ্ত administrator | [সোর্স](<../../../src/app/(erp)/dashboard/audit/page.tsx>) · [অধ্যায়](17-administration.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Match Bank Statements<br>`/dashboard/bank-reconciliation` | হিসাবরক্ষক | [সোর্স](<../../../src/app/(erp)/dashboard/bank-reconciliation/page.tsx>) · [অধ্যায়](13-accounting-reports.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | Statement line যোগের UI নেই; API নির্ভর। |
| Cashier Shifts<br>`/dashboard/cashier` | ক্যাশিয়ার ও supervisor | [সোর্স](<../../../src/app/(erp)/dashboard/cashier/page.tsx>) · [অধ্যায়](10-pos-cashier.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Categories & Brands<br>`/dashboard/catalogue` | Catalogue কর্মী | [সোর্স](<../../../src/app/(erp)/dashboard/catalogue/page.tsx>) · [অধ্যায়](06-products.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Payment Due Dates<br>`/dashboard/collections/calendar` | Collection কর্মী ও ম্যানেজার | [সোর্স](<../../../src/app/(erp)/dashboard/collections/calendar/page.tsx>) · [অধ্যায়](11-credit-collections.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Customer collection profile<br>`/dashboard/collections/customers/[id]` | Collection কর্মী ও ম্যানেজার | [সোর্স](<../../../src/app/(erp)/dashboard/collections/customers/[id]/page.tsx>) · [অধ্যায়](11-credit-collections.md) | শুধু সোর্সে পর্যবেক্ষিত | Login-পরবর্তী UI ও ফল runtime যাচাই করা যায়নি। |
| Collect Payments<br>`/dashboard/collections` | Collection কর্মী ও ম্যানেজার | [সোর্স](<../../../src/app/(erp)/dashboard/collections/page.tsx>) · [অধ্যায়](11-credit-collections.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Payment Collection Reports<br>`/dashboard/collections/reports` | Collection কর্মী ও ম্যানেজার | [সোর্স](<../../../src/app/(erp)/dashboard/collections/reports/page.tsx>) · [অধ্যায়](11-credit-collections.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| SMS Campaigns<br>`/dashboard/communications/campaigns` | Collection/marketing administrator | [সোর্স](<../../../src/app/(erp)/dashboard/communications/campaigns/page.tsx>) · [অধ্যায়](16-optional-modules.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Messages<br>`/dashboard/communications` | Collection/marketing administrator | [সোর্স](<../../../src/app/(erp)/dashboard/communications/page.tsx>) · [অধ্যায়](16-optional-modules.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | Inbox/templates আছে; এই hub-এর Campaigns tab placeholder। |
| SMS & Reminders<br>`/dashboard/communications/sms` | Collection/marketing administrator | [সোর্স](<../../../src/app/(erp)/dashboard/communications/sms/page.tsx>) · [অধ্যায়](16-optional-modules.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| CRM — Leads<br>`/dashboard/crm` | CRM কর্মী | [সোর্স](<../../../src/app/(erp)/dashboard/crm/page.tsx>) · [অধ্যায়](16-optional-modules.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | Lead UI আছে; বর্তমান flag enablement registry বাধা। |
| Deliveries<br>`/dashboard/deliveries` | Delivery কর্মী ও হিসাবরক্ষক | [সোর্স](<../../../src/app/(erp)/dashboard/deliveries/page.tsx>) · [অধ্যায়](14-delivery.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | Read/list UI; পূর্ণ settlement editor নেই; feature registry বাধা। |
| Expense details<br>`/dashboard/expenses/[id]` | অনুমোদিত কর্মী ও approver | [সোর্স](<../../../src/app/(erp)/dashboard/expenses/[id]/page.tsx>) · [অধ্যায়](13-accounting-reports.md) | শুধু সোর্সে পর্যবেক্ষিত | Login-পরবর্তী UI ও ফল runtime যাচাই করা যায়নি। |
| Expenses<br>`/dashboard/expenses` | অনুমোদিত কর্মী ও approver | [সোর্স](<../../../src/app/(erp)/dashboard/expenses/page.tsx>) · [অধ্যায়](13-accounting-reports.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Optional Features<br>`/dashboard/feature-flags` | অনুমতিপ্রাপ্ত administrator | [সোর্স](<../../../src/app/(erp)/dashboard/feature-flags/page.tsx>) · [অধ্যায়](17-administration.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | বাস্তবায়িত module registry-তে অনুপস্থিত module enable করা যায় না। |
| Gift Cards<br>`/dashboard/gift-cards` | অনুমোদিত cashier/manager | [সোর্স](<../../../src/app/(erp)/dashboard/gift-cards/page.tsx>) · [অধ্যায়](16-optional-modules.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | Issue UI আছে; POS redemption অক্ষম ও flag বাধা। |
| HR — Employees<br>`/dashboard/hr` | HR কর্মী | [সোর্স](<../../../src/app/(erp)/dashboard/hr/page.tsx>) · [অধ্যায়](16-optional-modules.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | Employee form আছে; পূর্ণ payroll UI নেই; enablement registry বাধা। |
| Import / Export<br>`/dashboard/imports` | অনুমতিপ্রাপ্ত administrator | [সোর্স](<../../../src/app/(erp)/dashboard/imports/page.tsx>) · [অধ্যায়](17-administration.md) | UI-তে দেখা; বর্তমান সীমা পাওয়া গেছে | Import jobs API HTTP 500; import/export job তৈরি হয়নি। |
| Connected Apps<br>`/dashboard/integrations` | অনুমতিপ্রাপ্ত administrator | [সোর্স](<../../../src/app/(erp)/dashboard/integrations/page.tsx>) · [অধ্যায়](17-administration.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | Webhook UI আছে; offline conflict/history editor নেই। |
| Stock adjustments<br>`/dashboard/inventory/adjustments` | Inventory কর্মী ও approver | [সোর্স](<../../../src/app/(erp)/dashboard/inventory/adjustments/page.tsx>) · [অধ্যায়](09-stock-workflows.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Stock counts<br>`/dashboard/inventory/counts` | Inventory কর্মী ও approver | [সোর্স](<../../../src/app/(erp)/dashboard/inventory/counts/page.tsx>) · [অধ্যায়](09-stock-workflows.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Post Opening Stock<br>`/dashboard/inventory/opening-stock` | Inventory supervisor | [সোর্স](<../../../src/app/(erp)/dashboard/inventory/opening-stock/page.tsx>) · [অধ্যায়](08-purchases-stock.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Stock & Inventory<br>`/dashboard/inventory` | Inventory কর্মী ও approver | [সোর্স](<../../../src/app/(erp)/dashboard/inventory/page.tsx>) · [অধ্যায়](09-stock-workflows.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Stock transfers<br>`/dashboard/inventory/transfers` | Inventory কর্মী ও approver | [সোর্স](<../../../src/app/(erp)/dashboard/inventory/transfers/page.tsx>) · [অধ্যায়](09-stock-workflows.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Add a Company<br>`/dashboard/onboarding` | Platform administrator | [সোর্স](<../../../src/app/(erp)/dashboard/onboarding/page.tsx>) · [অধ্যায়](04-organization.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | Suspended company তৈরি; activation journey অনিশ্চিত। |
| Home<br>`/dashboard` | সব অনুমোদিত ব্যবহারকারী | [সোর্স](<../../../src/app/(erp)/dashboard/page.tsx>) · [অধ্যায়](03-navigation.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Customers & Suppliers<br>`/dashboard/parties` | বিক্রয়/ক্রয় কর্মী | [সোর্স](<../../../src/app/(erp)/dashboard/parties/page.tsx>) · [অধ্যায়](07-parties.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Payment details<br>`/dashboard/payments/[id]` | ক্যাশিয়ার ও হিসাবরক্ষক | [সোর্স](<../../../src/app/(erp)/dashboard/payments/[id]/page.tsx>) · [অধ্যায়](13-accounting-reports.md) | শুধু সোর্সে পর্যবেক্ষিত | Login-পরবর্তী UI ও ফল runtime যাচাই করা যায়নি। |
| Payments<br>`/dashboard/payments` | ক্যাশিয়ার ও হিসাবরক্ষক | [সোর্স](<../../../src/app/(erp)/dashboard/payments/page.tsx>) · [অধ্যায়](13-accounting-reports.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| New Sale<br>`/dashboard/pos` | ক্যাশিয়ার | [সোর্স](<../../../src/app/(erp)/dashboard/pos/page.tsx>) · [অধ্যায়](10-pos-cashier.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Product detail / Barcodes / Activate<br>`/dashboard/products/[id]` | পণ্য ব্যবস্থাপক | [সোর্স](<../../../src/app/(erp)/dashboard/products/[id]/page.tsx>) · [অধ্যায়](06-products.md) | সীমিত বা অক্ষম; সোর্সে পর্যবেক্ষিত | Activate validation আছে; unit-option setup UI সীমিত। |
| New Product<br>`/dashboard/products/new` | পণ্য ব্যবস্থাপক | [সোর্স](<../../../src/app/(erp)/dashboard/products/new/page.tsx>) · [অধ্যায়](06-products.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | Inactive product; default unit-option editor পাওয়া যায়নি। |
| Products<br>`/dashboard/products` | পণ্য ব্যবস্থাপক | [সোর্স](<../../../src/app/(erp)/dashboard/products/page.tsx>) · [অধ্যায়](06-products.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Purchases<br>`/dashboard/purchases` | ক্রয় ও warehouse কর্মী | [সোর্স](<../../../src/app/(erp)/dashboard/purchases/page.tsx>) · [অধ্যায়](08-purchases-stock.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Reports<br>`/dashboard/reports` | ম্যানেজার ও হিসাবরক্ষক | [সোর্স](<../../../src/app/(erp)/dashboard/reports/page.tsx>) · [অধ্যায়](13-accounting-reports.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Risk Settings<br>`/dashboard/risk-tuning` | অনুমতিপ্রাপ্ত administrator | [সোর্স](<../../../src/app/(erp)/dashboard/risk-tuning/page.tsx>) · [অধ্যায়](17-administration.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Sell on Credit<br>`/dashboard/sales/credit` | Salesperson ও collection কর্মী | [সোর্স](<../../../src/app/(erp)/dashboard/sales/credit/page.tsx>) · [অধ্যায়](11-credit-collections.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | Serialized item-এর serial input নেই; payment/SMS চালানো হয়নি। |
| Sales<br>`/dashboard/sales` | ক্যাশিয়ার ও return approver | [সোর্স](<../../../src/app/(erp)/dashboard/sales/page.tsx>) · [অধ্যায়](12-returns-refunds.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Security Alerts<br>`/dashboard/security` | অনুমতিপ্রাপ্ত administrator | [সোর্স](<../../../src/app/(erp)/dashboard/security/page.tsx>) · [অধ্যায়](17-administration.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | পৃষ্ঠা/তালিকা দেখা; save/post বা existing detail workflow চালানো হয়নি। |
| Repairs & Service<br>`/dashboard/service` | Intake কর্মী ও technician | [সোর্স](<../../../src/app/(erp)/dashboard/service/page.tsx>) · [অধ্যায়](15-service.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | Intake/detail/parts UI আছে; module default বন্ধ ও registry বাধা। |
| Settings<br>`/dashboard/settings` | নিজের Settings: সব অনুমোদিত ব্যবহারকারী | [সোর্স](<../../../src/app/(erp)/dashboard/settings/page.tsx>) · [অধ্যায়](17-administration.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | Passkeys section দেখা; registration/revocation করা হয়নি। |
| Support<br>`/dashboard/support` | অনুমতিপ্রাপ্ত administrator | [সোর্স](<../../../src/app/(erp)/dashboard/support/page.tsx>) · [অধ্যায়](17-administration.md) | UI-তে দেখা; লেনদেন অযাচাইকৃত | Ticket শুধু browser-local; backend queue নয়। |
| System Health<br>`/dashboard/system` | অনুমতিপ্রাপ্ত administrator | [সোর্স](<../../../src/app/(erp)/dashboard/system/page.tsx>) · [অধ্যায়](17-administration.md) | UI ও read-only health check পরীক্ষিত | HTTP 503; Database ok, Redis fail, Storage/worker skipped। |
| শুরুর redirect<br>`/` | সব ব্যবহারকারী | [সোর্স](<../../../src/app/page.tsx>) · [অধ্যায়](02-login-security.md) | শুধু সোর্সে পর্যবেক্ষিত | Cookie অনুযায়ী redirect সোর্সে আছে; root runtime দেখা হয়নি। |
| Reset password<br>`/reset-password` | সব ব্যবহারকারী | [সোর্স](<../../../src/app/reset-password/page.tsx>) · [অধ্যায়](02-login-security.md) | UI-তে দেখা; read-only navigation পরীক্ষিত | খালি reset form দেখা; reset submit করা হয়নি। |

## Inline কাজ ও page file-বহির্ভূত surface

| কাজ | কার জন্য | প্রমাণ | অবস্থা / গাইড |
|---|---|---|---|
| Product category/brand/unit/tax editor | Catalogue কর্মী | [InlineCrudList](../../../src/components/catalogue/InlineCrudList.tsx) | সোর্সে; [পণ্য](06-products.md) |
| Purchase receiving | Warehouse কর্মী | [PurchaseDetail](../../../src/components/purchases/PurchaseDetail.tsx) | সোর্সে; [গ্রহণ](08-purchases-stock.md) |
| Sale return ও refund | Return/refund permission-ধারী | [SaleDetail](../../../src/components/sales/SaleDetail.tsx) | সোর্সে; [ফেরত](12-returns-refunds.md) |
| Service status, parts ও approval | Technician/approver | [ServiceDetail](../../../src/components/service/ServiceDetail.tsx) | সোর্সে, feature সীমা; [সার্ভিস](15-service.md) |
| Collection follow-up, promise, reminder | Collection কর্মী | [FollowThrough](../../../src/components/collections/FollowThrough.tsx), [ReminderDialog](../../../src/components/collections/ReminderDialog.tsx) | সোর্সে; পাঠানো/পরিবর্তন পরীক্ষা হয়নি; [আদায়](11-credit-collections.md) |
| Print receipt / invoice | ক্যাশিয়ার | [POS source](<../../../src/app/(erp)/dashboard/pos/page.tsx>) | `/print/receipt/[id]` ও `/print/invoice/[id]` link আছে; print runtime যাচাই হয়নি। |
| SMS audience preview/send | Marketing administrator | [Campaigns](<../../../src/app/(erp)/dashboard/communications/campaigns/page.tsx>) | সোর্সে; provider delivery অযাচাইকৃত; [SMS](16-optional-modules.md) |

## নাম বা backend আছে, কিন্তু পূর্ণ ব্যবহারিক UI নিশ্চিত নয়

| বিষয় | পর্যবেক্ষণ | গাইডে অবস্থান |
|---|---|---|
| Product unit options | Activation guard চায়; product editor পাওয়া যায়নি। | [পণ্য](06-products.md) |
| Company activation; branch/warehouse management | Onboarding ও selectors আছে; স্বাধীন পূর্ণ setup journey অযাচাইকৃত। | [প্রতিষ্ঠান](04-organization.md) |
| Payroll run / salary bank file | Employee/account assignment UI আছে; payroll dashboard নেই। | [HR](16-optional-modules.md) |
| Warranty replacement | Warranty intake আছে; স্বাধীন claim/replacement dashboard পাওয়া যায়নি। | [সার্ভিস](15-service.md) |
| Quotation | Flag catalogue-এ নাম আছে; dedicated dashboard পাওয়া যায়নি। | [প্রশাসন](17-administration.md) |
| Reward points / gift-card redemption | Card issuance UI আছে; POS stored-value tender প্রত্যাখ্যাত। | [ঐচ্ছিক module](16-optional-modules.md) |
| Offline POS ও conflict resolution | Pilot-only message; registry ও UI সীমা আছে। | [প্রশাসন](17-administration.md) |
| Courier settlement editor | Report/card/API থাকলেও delivery page-এ পূর্ণ settlement form নেই। | [ডেলিভারি](14-delivery.md) |
| Bank statement line import | Reconciliation page API দিয়ে line যোগের কথা বলে। | [হিসাব](13-accounting-reports.md) |

## Runtime-এ অযাচাইকৃত সাধারণ বিষয়

Global administrator login ও পৃষ্ঠা দেখা হয়েছে। Health-এ Database ok এবং Redis fail পাওয়া গেছে; Storage/worker skipped। অন্য persona-এর permission, tenant flag পরিবর্তন, provider delivery, report accuracy, physical printer এবং end-to-end business workflows যাচাই হয়নি। পুরোনো test result বর্তমান পরীক্ষার বিকল্প নয়।
