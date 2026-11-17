# পর্যালোচনার পরিকল্পনা, প্রমাণ ও সীমাবদ্ধতা

[সূচিপত্র](README.md) · [Coverage](COVERAGE.md)

## পরিসর ও পরিকল্পনা

পর্যালোচনা: ১৭ নভেম্বর ২০২৬। প্রাথমিক সোর্স সংস্করণ `b55feec` ও তখনকার working tree। পুরোনো audit ও blueprint শুধু অনুসন্ধানের সূত্র। বর্তমান ব্যবহারকারী লোকাল পরিবেশকে অনুমোদিত ডেমো বলেছেন এবং লগইন তথ্য নিশ্চিত করেছেন।

পরিকল্পনা ছিল বর্তমান navigation/source পড়া, পৃষ্ঠা ও form দেখা, ২০ অধ্যায় ও ছয়টি journey লেখা, coverage/link/label/অঙ্ক যাচাই এবং আলাদা পাঠক-পর্যালোচনা। পৃথক `/plan` ও `/verify` command পাওয়া যায়নি; সরাসরি পরিকল্পনা ও validation ব্যবহার করা হয়েছে।

## বর্তমান runtime-এ যা দেখা হয়েছে

| বিষয় | এই সেশনের প্রমাণ | সীমা |
|---|---|---|
| লোকাল ডেমো | ব্যবহারকারীর স্পষ্ট অনুমোদন; শুধু `http://localhost:3000` ব্যবহার | অন্য কোনো পরিবেশে সংযোগ হয়নি। |
| Login | Browser-এর `Sign In`-এর পরে HTTP 200 ও `/dashboard` | অন্য role, MFA বা login-failure journey পরীক্ষা নয়। |
| পরিচয় ও scope | `/api/v1/me` HTTP 200; global administrator session | সাধারণ tenant/cashier-এর permission isolation পরীক্ষা নয়। |
| MFA | বর্তমান session-এ enabled/verified দুটোই false | সুরক্ষিত পরিবর্তনের MFA readiness দাবি নেই; কোনো setup করা হয়নি। |
| পৃষ্ঠা | ৪৮টি dashboard route শুধু খুলে দেখা | Existing নথির dynamic detail এবং posting ফল দেখা হয়নি। |
| Form | ১৮টি distinct form দেখা; তথ্য ভরা বা submit করা হয়নি | Save, validation-on-submit বা হিসাবের ফল পরীক্ষা নয়। |
| Reset | খালি reset form ও one-time link requirement দেখা | বৈধ token দিয়ে reset হয়নি। |
| Database | Local System Health check-এ `database: ok` | সরাসরি SQL, migration, data integrity বা report reconciliation হয়নি। |
| Redis | একই health response-এ `redis: fail` | Redis মেরামত, provider বা queue কাজ চালানো হয়নি। |
| Storage ও Queue workers | Health response-এ দুটো `skipped` | সচল বা অচল—কোনোটিই প্রমাণ নয়। |
| Overall health | HTTP 503, `status: unavailable` | পৃষ্ঠা দেখা গেলেও পূর্ণ service readiness নেই। |
| Import jobs | `/api/v1/import-jobs` HTTP 500 | Root cause নির্ণয়/মেরামত বা import চালানো হয়নি। |

১৮টি form: New Product, নতুন User, নতুন Role, Purchase, Service intake, Employee, Lead, Payment, Expense, Transfer, Stock count, Adjustment, Journal, Fiscal period, Asset acquisition, Bank reconciliation, Gift card issuance এবং Campaign draft। Onboarding-এর খালি form-ও page পর্যবেক্ষণে দেখা হয়েছে; এই ১৮টির সংখ্যায় সেটি আলাদা করে যোগ করা হয়নি।

প্রথম form-inspection-এ Payments-এর একই নামের দুই control এবং Campaign-এর শিরোনামকে button ভাবায় automation selector মেলেনি। Targeted পুনঃপর্যবেক্ষণে payment form এবং inline campaign form দেখা হয়েছে। এটি app-এর form অচল হওয়ার প্রমাণ নয়।

## নিরাপত্তা ও read-only সীমা

Login করার প্রয়োজনীয় authentication POST ছাড়া অন্য সব non-GET/HEAD request browser interception-এ block করা হয়েছে। External network-ও block করা হয়েছে। Password masked terminal input দিয়ে দেওয়া হয়েছে; command, guide, screenshot বা report-এ লেখা হয়নি। Cookie/token সংরক্ষণ বা প্রকাশ করা হয়নি।

Login সফল হওয়ায় স্বাভাবিক session/audit পরিবর্তন হতে পারে। তার বাইরে কোনো business record ইচ্ছাকৃতভাবে তৈরি বা পরিবর্তন করা হয়নি। Logout, MFA setup, pricing Preview, Save, Post, Delete, Refund, Close, Send, Mark read, import/export job বা report run করা হয়নি। শুধু নতুন form খোলার control ব্যবহার করা হয়েছে।

এই কাজের জন্য app code, API, schema, migrations, configuration ও permissions পরিবর্তন হয়নি। DB reset, seed, migration, install, deploy, commit বা push হয়নি। অস্থায়ী inspection/validation script `.local/`-এ; deliverable `docs/user-guide/bn/`।

## অবস্থার অর্থ

- **UI-তে দেখা:** পৃষ্ঠা, তালিকা বা খালি form browser-এ দৃশ্যমান। লেনদেনের ফল পরীক্ষা নয়।
- **নিরাপদে পরীক্ষিত navigation:** নির্দিষ্ট route/redirect বা form খোলা পর্যবেক্ষণ। Coverage-এ সীমা লেখা আছে।
- **শুধু সোর্সে পর্যবেক্ষিত:** control, business rule বা posting path বর্তমান code-এ পাওয়া গেছে; live ফল নেই।
- **সীমিত বা অক্ষম:** placeholder, অনুপস্থিত UI বা source guard/registry limitation। শুধু page খোলা দিয়ে readiness প্রমাণ হয় না।
- **যাচাই করা যায়নি:** সংশ্লিষ্ট role, document, provider, worker বা business journey-এর যথেষ্ট প্রমাণ নেই।

## বর্তমান গুরুত্বপূর্ণ সীমা

1. Product activation standard/combo-তে default sale ও purchase unit option চায়। পর্যালোচিত UI-তে editor নেই।
2. Onboarding suspended company তৈরি করে। Company সৃষ্টি, activation ও MFA-সহ journey পরীক্ষা হয়নি।
3. POS shift optional; দোকানের cash-control নিয়মে নির্বাচিত shift প্রয়োজন হতে পারে।
4. Credit-sale form-এ serialized item-এর serial input পাওয়া যায়নি। Serialized credit journey সম্পূর্ণ ধরা যাবে না।
5. Gift-card/store-credit POS payment domain-এ প্রত্যাখ্যাত। Issuance form দেখা redemption readiness নয়।
6. CRM, HR, delivery, service, loyalty ও offline বর্তমান implementation registry-তে নেই। সাধারণ enablement ব্যর্থ হতে পারে। এই সেশনে page/form দেখা হয়েছে, flag বদলানো বা posting নয়।
7. Delivery page তালিকাভিত্তিক; পূর্ণ courier settlement editor নেই।
8. Bank reconciliation-এ statement line যোগের UI নেই।
9. HR employee form আছে; পূর্ণ payroll/bank salary UI পাওয়া যায়নি।
10. Reports-এর `Run Report` API output খুলতে পারে। Page-এ arbitrary date filter নেই। Report run, export বা business total মিলিয়ে পরীক্ষা হয়নি।
11. Communications hub-এর Campaigns tab placeholder; আলাদা SMS Campaigns পৃষ্ঠায় inline draft form আছে।
12. Support ticket browser-local; backend queue-তে পৌঁছায় না বলে বর্তমান UI জানায়।
13. Offline conflict editor, পৃথক quotation editor ও warranty-replacement dashboard পাওয়া যায়নি।
14. Import Jobs HTTP 500 এবং Redis health failure বাস্তবে পাওয়া গেছে। ফলে import/queue/SMS-নির্ভর কাজ প্রস্তুত বলে ধরা যাবে না।

## Screenshot

একটি বাস্তব খালি login screenshot অন্তর্ভুক্ত। কোনো account/password value পূরণ করা হয়নি। Placeholder sample text ব্যবহারকারীর তথ্য নয়।

Authenticated page-এর screenshot এই সংস্করণে অন্তর্ভুক্ত হয়নি। পৃষ্ঠার label ও কাঠামো browser-এ মিলিয়ে text instructions হালনাগাদ হয়েছে। পুরোনো synthetic fixture-এর ছবি গাইডে ব্যবহার করা হয়নি।

## নথির মান যাচাই

- ২০ অধ্যায়সহ ২৬ Markdown ফাইল; ৫৯টি page file-এর coverage।
- ৩০৫টি স্থানীয় Markdown/source/image link বিদ্যমান লক্ষ্যের সঙ্গে মিলেছে।
- ৩৩টি নির্বাচিত control label বর্তমান source/translation catalogue-এর সঙ্গে মিলেছে।
- উদাহরণের ১৩টি গাণিতিক সম্পর্ক Decimal দিয়ে পরীক্ষা করা হয়েছে।
- বাংলা নথি NFC-তে স্বাভাবিক করা হয়েছে; replacement character, BOM বা অপ্রয়োজনীয় zero-width space নেই।
- পৃথক পাঠক-পর্যালোচনায় shift, product/stock, refund, collection, optional module ও Support delivery নিয়ে ছয়টি প্রশ্ন ব্যবহার হয়েছে।
- পর্যালোচনার পর shift-এর শর্ত, module readiness, active-product handoff, credit-return cash warning ও নিজের Settings-এর audience স্পষ্ট করা হয়েছে।

## প্রমাণের উৎস

- [বর্তমান navigation](<../../../src/app/(erp)/dashboard/layout.tsx>)
- [Feature registry](../../../src/lib/featureFlags/index.ts)
- [Product activation validation](../../../src/domain/invariants/productActivation.ts)
- [Sale command](../../../src/domain/commands/m3/PostSale.ts)
- [Runtime health contract](../../../src/lib/health/contract.ts)
- [Reports calculation](../../../src/reports/index.ts)

প্রতিটি অধ্যায় ও Coverage-এ সংশ্লিষ্ট source link আছে। Browser evidence-এর ব্যক্তিগত অংশ গাইডে কপি করা হয়নি। এই পর্যালোচনা পূর্ণ runtime acceptance, production certification বা হিসাব reconciliation নয়।
