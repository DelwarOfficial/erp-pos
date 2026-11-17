# ১৬. CRM, HR, গিফট কার্ড ও SMS

[সূচিপত্র](README.md)

**উদ্দেশ্য:** মূল বিক্রয় ও স্টকের বাইরের কাজের সীমা বোঝা। **কে ব্যবহার করবেন:** সংশ্লিষ্ট module-এর অনুমতিপ্রাপ্ত কর্মী।

**শুরুর আগে:** মেনু, permission, tenant feature flag ও backend/provider readiness আলাদা করে মিলতে হবে। নতুন module চালু করতে বলা হচ্ছে না।

## CRM: সম্ভাব্য ক্রেতা

**কোথায়:** `CRM — Leads` → `/dashboard/crm`।

1. `Search leads` দিয়ে আগে খুঁজুন।
2. `New lead` ফর্মে পরিচয়, branch, যোগাযোগ ও follow-up দিন।
3. `View lead`-এ `Recent activity` ও follow-up দেখুন।
4. প্রকৃত customer হলে অনুমোদিতভাবে `Convert to customer` ব্যবহার করা যায়। একই customer দুইবার তৈরি না হয় নিশ্চিত করুন।

**উদাহরণ:** কাল্পনিক একজন ফ্রিজের দাম জানতে এসেছেন; তিনি এখনও sale customer নন। Lead conversion টাকা পাওয়া বা বিক্রয় সম্পন্ন হওয়ার সমার্থক নয়।

## HR: কর্মী

**কোথায়:** `HR — Employees` → `/dashboard/hr`।

1. `Search employees` দিয়ে খুঁজুন।
2. `View employee`-এ branch, employment status ও উপলব্ধ পরিচয় দেখুন।
3. অনুমতি থাকলে `New employee` বা `Edit employee` ব্যবহার করুন। Employee branch, join date, base salary এবং payroll accounts মিলিয়ে নিন।
4. Salary/branch/account বদলালে confirmation ভবিষ্যৎ payroll-এর প্রভাব জানায়।

**সীমা:** কর্মী রেকর্ডের form পাওয়া গেছে। Payroll run, bank salary file বা বেতন প্রদানের পূর্ণ user UI পাওয়া যায়নি। `Base salary` লেখা মানেই বেতন দেওয়া হয়নি।

## গিফট কার্ড ও loyalty

**কোথায়:** `Gift Cards` → `/dashboard/gift-cards`।

**আগে সীমাটি জানুন:** বর্তমান POS এই card দিয়ে payment গ্রহণ করে না। Card বিক্রি বা issue শেখার আগে administrator কার্যকর ব্যবহারের পরিকল্পনা নিশ্চিত করবেন।

`Issue Card`-এ `Sold — cash received` বা `Promotional — marketing expense`, branch, face value ও account নির্বাচন আছে। Sold card-এ অর্থ ইতিমধ্যে পাওয়া নিশ্চিত করতে হয়। উদাহরণ: ১,০০০ টাকার card ইস্যু দোকানের ১,০০০ টাকার ভবিষ্যৎ দায় হতে পারে; তা লাভ নয়।

**গুরুত্বপূর্ণ সীমা:** `loyalty_enabled` default বন্ধ; সফটওয়্যারের বাস্তবায়িত মডিউলের তালিকায় `loyalty` নেই। POS gift-card/store-credit payment প্রত্যাখ্যান করে। Card issue form থাকা মানেই card-এর balance খরচ করা বা reward points ব্যবহার কার্যকর নয়। এই গাইডে loyalty redemption tutorial নেই।

## SMS ও reminders

**কোথায়:** `SMS & Reminders` → `/dashboard/communications/sms`; `SMS Campaigns` → `/dashboard/communications/campaigns`।

1. SMS পৃষ্ঠায় `Overview`, `History`, `Texts`, `Settings` অংশ দেখুন।
2. Administrator `MiMSMS account` ও reminder policy প্রস্তুত করবেন। API key গাইড, screenshot বা ticket-এ দেবেন না।
3. Customer-এর সম্মত mobile যাচাই করুন। Automatic reminder-এর stage ও সময়ের সীমা policy অনুযায়ী হয়।
4. Marketing campaign-এর `New campaign` অংশে message ও audience দিয়ে `Save draft` করা যায়। `New campaign` এখানে form-এর শিরোনাম; আলাদা বোতাম নয়।
5. `Preview & send` audience পরীক্ষা করে। `Send` বাস্তব customer-কে বার্তা পাঠানোর কাজ; আলাদা অনুমতি ছাড়া চাপবেন না।
6. `unknown` status হলে provider-এর sent report মিলিয়ে দায়িত্বপ্রাপ্ত ব্যক্তি ফল নির্ধারণ করবেন। অন্ধভাবে আবার SMS পাঠাবেন না।

`Messages` (`/dashboard/communications`)-এর পুরোনো `Campaigns` tab placeholder। আলাদা `/dashboard/communications/campaigns`-এ draft/preview/send implementation আছে। দুটি পৃষ্ঠা এক নয়। Inbox-এর `Mark read`-ও তথ্য পরিবর্তন করে।

**সফলতার চিহ্ন:** সংশ্লিষ্ট reference/status/history; SMS-এ sent ও delivered আলাদা। **সমস্যা:** module disabled, provider configuration, worker বা permission প্রস্তুত না থাকলে supervisor-কে জানান।

**যাচাইয়ের অবস্থা:** CRM/HR-এর নতুন form, Gift Card issuance form, Communications/SMS এবং Campaign draft form UI-তে দেখা। কোনো lead/employee/card/draft/message তৈরি বা পাঠানো হয়নি; enablement শুধু সোর্সে যাচাই।

**প্রমাণ:** [CRM](<../../../src/app/(erp)/dashboard/crm/page.tsx>), [HR](<../../../src/app/(erp)/dashboard/hr/page.tsx>), [Gift cards](<../../../src/app/(erp)/dashboard/gift-cards/page.tsx>), [SMS](<../../../src/app/(erp)/dashboard/communications/sms/page.tsx>), [Campaigns](<../../../src/app/(erp)/dashboard/communications/campaigns/page.tsx>), [POS command](../../../src/domain/commands/m3/PostSale.ts)।
