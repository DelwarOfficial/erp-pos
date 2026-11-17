# ৯. স্টক গণনা, সমন্বয় ও ট্রান্সফার

[সূচিপত্র](README.md)

**উদ্দেশ্য:** পণ্য কোথায় এবং কোন অবস্থায় আছে তা ঠিক রাখা। **কে ব্যবহার করবেন:** inventory কর্মী ও প্রয়োজনীয় স্বাধীন অনুমোদনদাতা।

**শুরুর আগে:** সক্রিয় পণ্য, গুদাম, কারণের code এবং কাজ অনুযায়ী create/approve/post অনুমতি।

## কোথায় পাবেন

Inventory থেকে সংশ্লিষ্ট link: `/dashboard/inventory/transfers`, `/dashboard/inventory/counts`, `/dashboard/inventory/adjustments`।

## গুদাম বদল: ধাপে ধাপে

1. `New transfer` খুলুন। source ও destination warehouse মিলিয়ে নিন।
2. product, quantity এবং প্রয়োজনীয় `Serial numbers` দিন।
3. `Create transfer` source-এর পরিমাণ reserve করে। এটিকে destination-এ পাওয়া বলে ধরবেন না।
4. বাস্তবে পাঠানোর সময় `Dispatch transfer` ব্যবহার করুন।
5. destination-এ সব dispatched item এসেছে নিশ্চিত করে `Receive transfer` ব্যবহার করুন।
6. `Requested`, `Dispatched`, `Received` ও serial custody মিলিয়ে নিন।

বর্তমান UI সব dispatched পণ্য গ্রহণের confirmation দেয়। আংশিক আসা বা হারানোর ঘটনা এলে অনুমান করে “সব পেয়েছি” বলবেন না।

## বাস্তব গুনতি

1. `New stock count`-এ warehouse ও `Scope` ঠিক করুন।
2. `Stock movement policy` এবং blind count-এর সিদ্ধান্ত নিন।
3. `Create snapshot`, তারপর উপলব্ধ `Start counting` দিয়ে গণনার ধাপ অনুসরণ করুন।
4. বাস্তব quantity, প্রয়োজনীয় serial ও count note লিখে `Save counts` দিন।
5. `Review count`-এ পার্থক্য যাচাই করুন। অনুমোদন লাগলে স্বাধীন reviewer দেখবেন।
6. অনুমোদিত হলে `Post variances` ব্যবহার করুন। Snapshot-এর পরে stock নড়লে আগে মিলিয়ে নিন।

## কারণভিত্তিক সমন্বয়

`New adjustment`-এ type, warehouse, business date, reason, quantity ও `Explanation` দিন। Reason অনুযায়ী `Submit for approval` বা `Post adjustment` আসে। Pending record stock নড়েছে—এমন প্রমাণ নয়।

## উদাহরণ

সিস্টেমে ১০টি কেবল, বাস্তবে ৯টি। পার্থক্য −১। গুনতি ও কারণ যাচাই ছাড়া সরাসরি নতুন purchase লিখে ঘাটতি ঢাকবেন না। ২টি damage হলে মোট পণ্য, বিক্রয়যোগ্য অংশ এবং damaged অংশ আলাদা করে দেখুন।

## সমস্যা ও সতর্কতা

Damaged, remove, recovery ও signed correction এক নয়। Transfer-এ না পাওয়া পণ্যকে sellable ভাববেন না। মূল sale ফেরত এলে [Return workflow](12-returns-refunds.md) দেখুন।

**যাচাইয়ের অবস্থা:** Transfers, Counts, Adjustments ও তাদের নতুন form UI-তে দেখা। Reserve/dispatch/receive/approval/posting শুধু সোর্সে; চালানো হয়নি।

**প্রমাণ:** [Transfer](<../../../src/app/(erp)/dashboard/inventory/transfers/page.tsx>), [Count](<../../../src/app/(erp)/dashboard/inventory/counts/page.tsx>), [Adjustment](<../../../src/app/(erp)/dashboard/inventory/adjustments/page.tsx>)।
