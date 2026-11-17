# ১৯. ভূমিকা অনুযায়ী দ্রুত নির্দেশিকা

[সূচিপত্র](README.md)

এখানকার ভূমিকা কাজ শেখার জন্য। এগুলো স্বয়ংক্রিয়ভাবে তৈরি role বা নির্দিষ্ট permission bundle-এর নিশ্চয়তা নয়।

## ক্যাশিয়ার

**প্রয়োজন:** নিজের পরিচয়, warehouse, payment account ও দোকানের নিয়ম অনুযায়ী shift permission।

1. ক্যাশ ড্রয়ার ব্যবহার করলে বা দোকানের নিয়মে লাগলে [শিফট খুলুন](10-pos-cashier.md); opening cash বাস্তবে গুনুন।
2. [POS](10-pos-cashier.md)-এ product, quantity, serial, total ও payment account মিলিয়ে নিন।
3. Sale saved-এর reference দেখে receipt দিন।
4. খোলা শিফট থাকলে দিনের শেষে cash গুনে shift মিলিয়ে বন্ধ করুন।

**উদাহরণ:** ৫০০ টাকার sale, ১,০০০ received, ৫০০ change। **সফলতা:** সঠিক reference ও drawer হিসাব। **সমস্যা:** uncertain payment হলে supervisor; manual journal দিয়ে ঢাকবেন না।

## Inventory কর্মী

**প্রয়োজন:** সঠিক warehouse, product/serial পরিচয় ও receiving/transfer/count-এর অনুমতি।

1. [ক্রয়াদেশের সঙ্গে বাস্তব receiving](08-purchases-stock.md) মিলিয়ে নিন।
2. [Transfer](09-stock-workflows.md)-এ reserve, dispatch ও receive আলাদা রাখুন।
3. [Count](09-stock-workflows.md)-এ গুনতি ও variance-এর কারণ যাচাই করুন।
4. Damage ও customer return-এর পার্থক্য বুঝুন।

**উদাহরণ:** ১০টি অর্ডার, ৬টি পাওয়া; remaining ৪। **সফলতা:** গুদাম, serial ও quantity মেলে। **সমস্যা:** আংশিক transfer বা serial mismatch হলে receive confirm করবেন না।

## হিসাবরক্ষক

**প্রয়োজন:** chart of accounts, policy, fiscal period ও অনুমোদিত financial account।

1. [বকেয়া আদায়](11-credit-collections.md)-এর allocation মিলিয়ে নিন।
2. [Expense](13-accounting-reports.md)-এর approval ও journal দেখুন।
3. Trial Balance ও relevant ledger মেলান।
4. Bank reconciliation-এর statement-line UI সীমা জেনে কাজ করুন।

**উদাহরণ:** ৯,০০০ বাকি থেকে ২,০০০ আদায়; অবশিষ্ট ৭,০০০। **সফলতা:** amount, allocation ও ledger একই ঘটনা বোঝায়। **সমস্যা:** এক খরচ দুইবার পোস্ট করবেন না।

## ম্যানেজার

**প্রয়োজন:** নিজের branch/company-এর report ও প্রয়োজনে independent approval permission।

1. [দিনের বিক্রয় ও stock report](13-accounting-reports.md) দেখুন।
2. [Overdue](11-credit-collections.md), low stock ও shift difference খুঁজুন।
3. Approval থাকলে নথির কারণ ও supporting তথ্য যাচাই করুন।
4. [Access](05-access.md)-এ কর্মীকে প্রয়োজনের বেশি অধিকার দেবেন না।

**উদাহরণ:** ১০ থেকে ২ sale হলে sellable ৮ হওয়ার কথা, অন্য movement না থাকলে। **সফলতা:** পার্থক্যের কারণ ও reference বোঝা। **সমস্যা:** শুধু report total দেখে কাজ সম্পূর্ণ বলবেন না।

**যাচাইয়ের অবস্থা:** Global administrator session-এ পৃষ্ঠা দেখা। আলাদা cashier/inventory/accountant/manager persona দিয়ে workflow পরীক্ষা হয়নি।
