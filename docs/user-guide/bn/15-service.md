# ১৫. সার্ভিস, যন্ত্রাংশ ও ওয়ারেন্টি

[সূচিপত্র](README.md)

**উদ্দেশ্য:** গ্রহণ করা ডিভাইস, সমস্যা, খরচ, ব্যবহৃত যন্ত্রাংশ ও হস্তান্তরের ইতিহাস রাখা। **কে ব্যবহার করবেন:** service intake কর্মী, technician ও approver।

**শুরুর আগে:** service permission, repair warehouse, প্রয়োজন হলে customer ও device serial, module availability।

## কোথায় পাবেন

`Repairs & Service` → `/dashboard/service`; তালিকা থেকে `View service request`।

## গ্রহণের ধাপ

**আগে প্রস্তুতি নিশ্চিত করুন:** service module default বন্ধ এবং সাধারণভাবে enable করার বাধা আছে। Administrator কার্যকর service পরিবেশ নিশ্চিত না করলে নিচের ধাপ শুধু পড়ে শিখুন।

1. `New Intake` খুলুন। `Repair warehouse` বেছে নিন। এর branch intake-এ ব্যবহৃত হয়।
2. অনুমতি থাকলে `Service customer` এবং `Device serial / IMEI` নির্বাচন করুন। Customer না নিলে walk-in হতে পারে।
3. `Service Type *`, `Issue Description *`, `Intake Condition`, `Accessories`, `Estimate (BDT)` দিন।
4. পণ্য গ্রহণের লিখিত সম্মতি ও serial মিলিয়ে অনুমোদিতভাবে `Create Intake` ব্যবহার করুন।
5. Reference লিখে রাখুন। `View service request`-এ বর্তমান status ও `Service history` দেখুন।

## কাজের অবস্থা ও যন্ত্রাংশ

1. `Action note / diagnosis / approval evidence`-এ কাজের ব্যাখ্যা দিন।
2. বর্তমান অবস্থায় যে action দেখায় সেটিই ব্যবহার করুন; যেমন `Start diagnosis`, `Save diagnosis`, `Save estimate`, `Request customer approval`।
3. প্রয়োজনীয় approval ছাড়া customer বা internal approval সম্পন্ন ধরে নেবেন না।
4. অনুমোদিত অবস্থায় `Consume parts` খুলে product, quantity, unit charge ও প্রয়োজনে serial/batch দিন।
5. `Post parts consumption` stock ও cost-এর কাজ। ডিভাইস মেরামত ছাড়াই এটি অনুশীলনে চাপবেন না।
6. বাস্তব কাজ শেষ হলে উপলব্ধ `Mark ready` ও `Deliver device` ধাপ অনুসরণ করুন। Handover confirmation-এর আগে বাস্তবে customer-কে ডিভাইস দিন।

## বিল ও উদাহরণ

কাল্পনিক screen charge ১,২০০ ও labour ৩০০ হলে মোট ১,৫০০ টাকা; tax থাকলে server-এর total আলাদা হতে পারে। ইতিমধ্যে consumed part আবার stock item হিসেবে দ্বিতীয়বার বিক্রি করবেন না। Detail panel service-only POS invoice তৈরি করে `Link service invoice` দেওয়ার নির্দেশনা দেয়।

## সীমাবদ্ধতা ও সমস্যা

Service type-এ `Warranty` আছে; এটি সব warranty claim/replacement workflow সম্পূর্ণ প্রমাণ করে না। স্বাধীন claim বা replacement dashboard পাওয়া যায়নি। সিরিয়াল বদলে নতুন replacement দেওয়া সম্ভব ধরে নেবেন না।

`service_warranty_enabled` default বন্ধ এবং registry-তে `service` নেই। বর্তমান API create/detail/parts-এ flag check আছে। Feature disabled হলে administrator-এর প্রস্তুতি ছাড়া এগোবেন না।

**সফলতার চিহ্ন:** reference, status, service history ও parts history। **যাচাইয়ের অবস্থা:** Service list ও New Intake form UI-তে দেখা। Existing detail, parts, approval, invoice ও handover শুধু সোর্সে; module activation/posting পরীক্ষা হয়নি।

**প্রমাণ:** [Service page](<../../../src/app/(erp)/dashboard/service/page.tsx>), [ServiceDetail](../../../src/components/service/ServiceDetail.tsx), [service API](../../../src/app/api/v1/service-requests/route.ts), [feature registry](../../../src/lib/featureFlags/index.ts)।
