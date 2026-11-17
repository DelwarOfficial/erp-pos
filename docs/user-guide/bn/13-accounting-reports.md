# ১৩. হিসাব, খরচ ও রিপোর্ট

[সূচিপত্র](README.md)

**উদ্দেশ্য:** পণ্য ও টাকার পরিবর্তন হিসাবের সঙ্গে মিলিয়ে দেখা। **কে ব্যবহার করবেন:** হিসাবরক্ষক ও অনুমতিপ্রাপ্ত ম্যানেজার।

**শুরুর আগে:** chart of accounts, accounting policy, payment account, fiscal period এবং সংশ্লিষ্ট কাজের permission প্রস্তুত থাকতে হবে। সেটআপ সম্পূর্ণ হয়েছে ধরে নেবেন না।

## কোথায় পাবেন

`Accounting` → `/dashboard/accounting`; Journal → `/dashboard/accounting/journal`; Trial Balance → `/dashboard/accounting/trial-balance`; Fiscal Periods → `/dashboard/accounting/fiscal-periods`; `Expenses` → `/dashboard/expenses`; `Reports` → `/dashboard/reports`।

## আলাদা পেমেন্ট রেকর্ড

**কোথায়:** `Payments` → `/dashboard/payments`। এটি sale-এর বাইরে পাওয়া বা দেওয়া অর্থের জন্য। POS sale-এর payment আবার এখানে লিখবেন না।

1. `Record a payment` খুলুন।
2. `What is this payment for?` এবং `Money in or out?`-এ অর্থের উদ্দেশ্য ও দিক মিলিয়ে নিন।
3. `Branch`, `Payment account`, `Payment method`, `Amount (৳)` এবং প্রয়োজনে `Transaction reference (optional)` দিন।
4. Customer/supplier বা সংশ্লিষ্ট নথির যোগসূত্র form-এ যথাযথভাবে দেওয়া যাচ্ছে কি না যাচাই করুন। কোনো selector না থাকলে নিজের মতো relationship ধরে নেবেন না।
5. প্রকৃত অর্থপ্রাপ্তি/প্রদান নিশ্চিত করে অনুমোদিত `Save payment` ব্যবহার করুন।
6. `View payment`-এ reference, status, account এবং দেখানো allocation মিলিয়ে নিন।

**উদাহরণ:** সাপ্লায়ারকে ২,০০০ টাকা দেওয়া একটি outgoing payment; এটি নতুন purchase receiving নয়। বকেয়া sale-এর collection করতে [Collections](11-credit-collections.md) ব্যবহার করুন। Sale-return refund-এর নথি সংযুক্ত রাখতে [Return detail](12-returns-refunds.md) ব্যবহার করুন। সাধারণ payment form-এ নাম থাকলেই সব ধরনের payment সম্পূর্ণ রেকর্ড হবে না।

## খরচ: ধাপে ধাপে

1. `New Expense` খুলে expense date, branch, payee ও description দিন।
2. Line item-এর category, amount ও প্রযোজ্য tax মিলিয়ে নিন।
3. অনুমোদিত হলে `Submit Expense` ব্যবহার করুন।
4. Category অনুযায়ী `pending_approval` হতে পারে। Approver `Approve` দেখবেন।
5. `View` খুলে status, evidence ও journal reference মিলিয়ে নিন।

## Journal ও হিসাবকাল

Journal-এ `New Entry`, `Description *`, `Entry Date *`, Account, Debit, Credit ও Memo আছে। অন্তত দুই line রাখতে হয়। `Post Entry`-এর আগে মোট debit ও credit সমান কিনা নিশ্চিত করুন। সাধারণ ক্যাশিয়ারকে manual journal করতে বলা হচ্ছে না।

Fiscal period-এ `New fiscal period`, Name, Start date, End date ও `Create period` আছে। Closed/locked period পাশ কাটাতে তারিখ পাল্টাবেন না। Period lock/unlock-এর পূর্ণ user journey এই পর্যালোচনায় যাচাই হয়নি।

## রিপোর্ট পড়া

1. `Reports`-এ `Daily Sales`, `Product Inventory`, `Stock Alert`, `Inventory Ledger` বা প্রয়োজনীয় card খুঁজুন।
2. `Run Report` নতুন tab-এ report API খুলতে পারে। সেটি JSON তথ্যও হতে পারে; সবসময় সাজানো dashboard নয়।
3. `CSV` বা `PDF` export job তৈরি করে। `Import / Export`-এর export তালিকায় ফল/Download দেখার ব্যবস্থা আছে।
4. সময়সীমা, company/branch scope এবং detail truncation আছে কি না দেখুন।
5. Trial Balance-এ debit/credit ও control account দায়িত্বপ্রাপ্ত হিসাবরক্ষক মিলিয়ে দেখবেন।

## অতিরিক্ত হিসাবের পৃষ্ঠা

- `Equipment & Assets` (`/dashboard/assets`): `Acquire Asset`, cost, useful life, depreciation method ও GL account-এর form আছে। Depreciation/disposal-এর পূর্ণ কাজ পরীক্ষা হয়নি।
- `Match Bank Statements` (`/dashboard/bank-reconciliation`): `New Reconciliation`, `Auto Match`, `Finalize` আছে। কিন্তু statement line যোগের UI নেই; পৃষ্ঠা API দিয়ে যোগ করার কথা বলে। তাই একে পূর্ণ bank-import tutorial ধরা যাবে না।

## উদাহরণ ও সতর্কতা

কাল্পনিক ১,০০০ টাকা ভাড়া: rent expense debit ১,০০০; cash credit ১,০০০। Manual entry বুঝতে উদাহরণটি দেওয়া। একই খরচ Expenses দিয়ে পোস্ট হয়ে থাকলে আবার journal দেবেন না। সমান debit/credit হলেই ব্যবসায়িক হিসাব সঠিক হয় না।

**সফলতার চিহ্ন:** reference, status ও সংশ্লিষ্ট journal/report পাওয়া। **সমস্যা:** permission, fiscal period বা account mapping error হলে হিসাবরক্ষককে জানান।

**যাচাইয়ের অবস্থা:** Payments, Accounting, Journal, Fiscal Periods, Trial Balance, Expenses, Assets, Bank Reconciliation ও Reports UI-তে দেখা। নতুন form খোলা হয়েছে; কোনো payment/journal/expense/export/report run করা হয়নি।

**প্রমাণ:** [Accounting](<../../../src/app/(erp)/dashboard/accounting/page.tsx>), [Expenses](<../../../src/app/(erp)/dashboard/expenses/page.tsx>), [Reports UI](<../../../src/app/(erp)/dashboard/reports/page.tsx>), [report calculations](../../../src/reports/index.ts), [bank reconciliation](<../../../src/app/(erp)/dashboard/bank-reconciliation/page.tsx>)।
