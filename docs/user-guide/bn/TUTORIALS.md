# ছয়টি ব্যবসায়িক পরিস্থিতির টিউটোরিয়াল

[সূচিপত্র](README.md) · [দৈনিক চেকলিস্ট](20-daily-checklist.md)

**এগুলো কাগজে শেখার অনুশীলন। এই সেশনে কোনো লেনদেন চালানো হয়নি।** নিচের কাজ বাস্তবে করতে অনুমোদিত পৃথক demo data, প্রয়োজনীয় permission এবং supervisor-এর স্পষ্ট অনুমতি লাগবে। পরিবেশ নিশ্চিত না হলে শুধু form পড়ুন।

পরবর্তী read-only পর্যালোচনায় login করে ৪৮টি পৃষ্ঠা ও ১৮টি form দেখা হয়েছে। নিচের লেনদেন, Preview, Post, Send বা closing তবুও চালানো হয়নি। “প্রত্যাশিত ফল” সোর্স ও উদাহরণের অঙ্কের ভিত্তিতে লেখা।

উদাহরণে BDT এবং tax/discount ছাড়া অঙ্ক ব্যবহার করা হয়েছে। বাস্তব app-এর server-calculated tax ও total-ই প্রযোজ্য। নমুনা reference নিজের দোকানের নথির সঙ্গে মিশিয়ে ফেলবেন না।

## ১. নতুন পণ্য থেকে স্টক

**কে:** catalogue ও inventory কর্মী। **ঘটনা:** ১০টি USB-C কেবল, unit cost ৩৫০ টাকা।

**আগে লাগবে:** category, non-fractional unit, supplier, warehouse, product activation ও receiving permission।

1. [Products](06-products.md)-এ নতুন “USB-C কেবল”, code `CAB-01`, price ৫০০ ও reference cost ৩৫০ প্রস্তুত করুন। বাস্তবে অনুমতি ছাড়া Create নয়।
2. Detail-এ barcode ও active state দেখুন। Default sale/purchase unit option না থাকলে এখানেই থামুন। Barcode যোগ করলেই সব শর্ত মেটে না।
3. Product সক্রিয় হলে [Purchases](08-purchases-stock.md)-এ `New Purchase` থেকে ১০টি × ৩৫০ = ৩,৫০০ টাকার order প্রস্তুত করা যায়।
4. `View purchase`-এ Ordered ১০, Received ০, Remaining ১০ হবে—এটি প্রত্যাশিত ফল, live পরীক্ষা নয়।
5. বাস্তবে ৬টি পেলে `Receive stock`-এ ৬ দিন। `Post receiving`-এর পরে received ৬, remaining ৪ প্রত্যাশিত।
6. পরে বাকি ৪টি গ্রহণ করলে মোট received ১০; receiving cost মোট ৩,৫০০ টাকা। Inventory-তে সঠিক warehouse মিলিয়ে দেখুন।

**সীমা:** বর্তমান product UI-তে unit option তৈরির পূর্ণ পথ নেই। তাই নতুন standard পণ্যের journey সম্পূর্ণ করার নিশ্চয়তা নেই। বিদ্যমান অনুমোদিত active product থাকলে শুধু তার receiving শেখা যায়। নতুন DB row বানাতে বলা হচ্ছে না।

**যাচাই:** শুধু সোর্সে পর্যবেক্ষিত; create/activate/receive/post চালানো হয়নি।

## ২. শিফট, নগদ sale ও closing

**কে:** ক্যাশিয়ার। **ঘটনা:** opening cash ১,০০০ টাকা; একটি ৫০০ টাকার কেবল বিক্রি।

**আগে লাগবে:** sellable stock, warehouse, cash account ও shift/sale permission। Serialized device নিলে সঠিক serial লাগবে।

1. [Cashier Shifts](10-pos-cashier.md)-এ warehouse ও cash drawer account নির্বাচন করুন। গুনে opening cash ১,০০০ দিন।
2. অনুমোদিত অনুশীলনে `Open shift` দিন। POS-এ সেই `Cashier shift` নির্বাচন করুন।
3. `Search products` দিয়ে কেবল খুঁজে cart-এ যোগ করুন। Quantity ১ ও total ৫০০ মিলিয়ে নিন।
4. `Cash`, সঠিক `Payment account` এবং full amount নিশ্চিত করুন।
5. Customer ১,০০০ দিলে change ৫০০। Server-এর amount ও VAT নিশ্চিত করে অনুমোদিতভাবে `Complete sale` দিন।
6. `Sale saved` ও reference দেখলে `Print receipt` খুলুন। Browser-এর print control ব্যবহার করতে হয়; physical printer সংযোগ আলাদা বিষয়।
7. আর কোনো cash movement না থাকলে expected drawer: ১,০০০ + ১,০০০ − ৫০০ = ১,৫০০ টাকা।
8. বাস্তবে ১,৫০০ গুনে counted amount দিয়ে `Close shift` ও confirmation দিন। `Drawer balanced` প্রত্যাশিত।

**সমস্যা:** current POS shift ছাড়াও sale করতে পারে; তখন drawer-এ sale অন্তর্ভুক্ত না-ও হবে। অনিশ্চিত sale result হলে দ্বিতীয় sale নয়—Sales list মিলিয়ে নিন।

**যাচাই:** শুধু সোর্সে পর্যবেক্ষিত। Cash movement, sale, receipt ও closing বাস্তবে পরীক্ষা হয়নি।

## ৩. বাকিতে sale ও পরে আদায়

**কে:** salesperson ও collection কর্মী। **ঘটনা:** ১২,০০০ টাকার non-serialized পণ্য, এখন ৩,০০০, বাকি তিন কিস্তি।

**আগে লাগবে:** verified customer, উপযুক্ত credit limit, stock ও payment account। Serialized credit item-এর form limitation এড়ান।

1. [Credit sale](11-credit-collections.md)-এ customer, branch ও warehouse নিন।
2. Items মোট ১২,০০০ করুন। `Paid now (৳)` ৩,০০০ এবং তার method/account দিন।
3. `Equal installments`-এ count ৩ এবং সঠিক first due/interval দিন।
4. `Preview`-তে total ১২,০০০, paid now ৩,০০০, on credit ৯,০০০ এবং ৩ × ৩,০০০ schedule প্রত্যাশিত।
5. SMS অনুশীলন করতে আলাদা অনুমতি না থাকলে reminder পাঠাবেন না। বাস্তব test-এ সঠিক policy ও consent ছাড়া reminder চালু রাখবেন না।
6. অনুমোদিত হলে `Post sale`; পরে Collections থেকে সংশ্লিষ্ট `Collect` খুলুন।
7. Customer সত্যি ২,০০০ দিলে amount ২,০০০, method, branch ও `Into account` দিন। `Record payment` ব্যবহার করুন।
8. নতুন owed ৭,০০০। Oldest installment প্রথমে allocation হলে প্রথম কিস্তিতে ১,০০০ বাকি। History মিলিয়ে নিন।

**সমস্যা:** একাধিক invoice থাকলে কোনটিতে allocation হচ্ছে দেখুন। নতুন sale করে পুরোনো টাকা আদায় দেখাবেন না।

**যাচাই:** source-based; quote, sale, schedule, allocation এবং SMS কোনোটি runtime পরীক্ষা হয়নি।

## ৪. ক্ষতিগ্রস্ত বা customer-এর ফেরত পণ্য

**কে:** return permission-ধারী কর্মী ও inventory supervisor।

প্রথমে ঘটনার ধরন ঠিক করুন। সব ক্ষতিগ্রস্ত পণ্য একই workflow নয়।

### আগে বিক্রি হয়েছিল এবং customer ফেরত দিয়েছেন

1. [Sales](12-returns-refunds.md)-এ মূল reference খুলুন।
2. `Return items` action-এ ফেরতযোগ্য quantity ও reason দিন।
3. আবার বিক্রয়যোগ্য হলে `Resalable — restock`; damaged হলে `Damaged — quarantine`।
4. Serialized হলে মূল বিক্রির serial মিলিয়ে নির্বাচন করুন।
5. অনুমোদিত `Post return`-এর পরে credit দেখুন। টাকা ফেরত আলাদা `Record refund` ও `Confirm refund`।

### দোকানে থাকা stock ক্ষতিগ্রস্ত হয়েছে; sale হয়নি

1. [Stock adjustments](09-stock-workflows.md)-এ `New adjustment` দেখুন।
2. damage-এর উপযুক্ত type, reason, warehouse ও quantity দিন।
3. Independent approval লাগলে `Submit for approval`; stock নড়েছে ধরে নেবেন না।

**উদাহরণ:** ৫০০ টাকায় বিক্রি কেবল ফেরত এলে credit ৫০০; ইতিমধ্যে ২০০ refund হলে remaining ৩০০। কিন্তু sale না হওয়া একটি cable damage হলে customer refund তৈরি করবেন না।

**সীমা:** card/mobile refund UI নিজে provider transfer করে না। Quarantine unit sellable নয়।

**যাচাই:** source-based; return, damage, approval ও refund চালানো হয়নি।

## ৫. সার্ভিস intake থেকে অবস্থা অনুসরণ

**কে:** intake কর্মী ও technician। **ঘটনা:** customer-এর display মেরামত।

**আগে লাগবে:** কার্যকর service module, repair warehouse, permission ও device handover-এর নিয়ম।

1. [Repairs & Service](15-service.md)-এ `New Intake` খুলুন।
2. Warehouse, customer, serial/IMEI, issue, intake condition ও accessories মিলিয়ে দিন।
3. অনুমোদিত `Create Intake`-এর reference customer-এর গ্রহণপত্রে ব্যবহার করুন। গাইডে আসল customer data লিখবেন না।
4. `View service request`-এ history দেখুন। `Start diagnosis` ও note-এর মাধ্যমে উপলব্ধ ধাপ অনুসরণ করুন।
5. Estimate ১,৫০০ হলে তা customer/internal approver-এর সম্মতি ছাড়া approved ধরে নেবেন না।
6. প্রয়োজনীয় part consumption ও invoice linking আলাদা কাজ। [সার্ভিস অধ্যায়ের](15-service.md) নিয়ম মানুন।
7. প্রস্তুত হলে উপলব্ধ `Mark ready`; বাস্তব handover-এর সময় `Deliver device`।

**সীমা:** service flag default বন্ধ; registry enablement বাধা আছে। Feature disabled হলে ধাপ ১-এই থামতে হতে পারে। Warranty intake মানেই replacement workflow সম্পূর্ণ নয়।

**যাচাই:** শুধু সোর্সে; intake, approval, repair part, invoice ও handover পরীক্ষা হয়নি।

## ৬. ম্যানেজারের দিনের বিক্রয় ও stock দেখা

**কে:** নিজের company/branch-এর report permission-ধারী ম্যানেজার।

1. [Sales](03-navigation.md)-এ দিনের `From`/`To` দিয়ে `Apply filters` দিন। Scope ও timezone-boundary সম্পর্কে সন্দেহ থাকলে হিসাবরক্ষকের সঙ্গে মিলিয়ে নিন।
2. [Reports](13-accounting-reports.md)-এ `Daily Sales` এবং `Sales Summary` card দেখুন। `Run Report` নতুন tab-এ তথ্য খুলতে পারে।
3. `Stock & Inventory`-এ warehouse অনুযায়ী পরিমাণ দেখুন।
4. `Product Inventory`, `Stock Alert` বা `Inventory Ledger` দিয়ে পরিমাণ ও movement-এর ব্যাখ্যা খুঁজুন।
5. `Collect Payments`-এর overdue ও দিনের collection মিলিয়ে দেখুন।
6. Shift difference থাকলে cashier-এর বাস্তব cash count ও related payment দেখুন।

**উদাহরণ:** শুরু ১০টি, sale ২টি, অন্য movement নেই—শেষ sellable ৮টি প্রত্যাশিত। মোট sale ২ × ৫০০ = ১,০০০ টাকা; সবটাই cash collection হয়েছে ধরে নেওয়া যাবে না।

**সীমা:** Reports card-এ arbitrary date filter form নেই। API default range-কে “শুধু আজ” ধরে নেবেন না। CSV/PDF export job তৈরি করে; অনুমতি ছাড়া যাচাইয়ের জন্য export তৈরি করা হয়নি।

**যাচাই:** শুধু সোর্সে; live business records বা report totals মিলিয়ে দেখা হয়নি।
