# ১৪. ডেলিভারি ও কুরিয়ার

[সূচিপত্র](README.md)

**উদ্দেশ্য:** বিক্রির সঙ্গে সংযুক্ত ডেলিভারির অবস্থা দেখা। **কে ব্যবহার করবেন:** delivery কর্মী ও হিসাবরক্ষক।

**শুরুর আগে:** posted sale, delivery permission, কোম্পানিতে সংশ্লিষ্ট module-এর প্রস্তুতি এবং courier/COD configuration।

## কোথায় পাবেন

`Deliveries` → `/dashboard/deliveries`; report catalogue-এ `Delivery Status` ও `Courier COD Reconciliation`।

## ধাপে ধাপে: বর্তমানে দেখা সম্ভব এমন পথ

1. Deliveries খুলে order তালিকা দেখুন।
2. Sale reference, customer, status, courier তথ্য, item count ও COD amount মিলিয়ে নিন।
3. Report permission থাকলে `Reports` থেকে প্রাসঙ্গিক delivery report-এর `Run Report` দেখুন।
4. না মেলা delivery reference ও তারিখ দায়িত্বপ্রাপ্ত ব্যক্তিকে দিন। ব্যক্তিগত customer ঠিকানা প্রশিক্ষণ নথিতে লিখবেন না।

## উদাহরণ

কাল্পনিক ১৫,০০০ টাকার ডেলিভারি। কুরিয়ার ১০০ টাকা fee রেখে ১৪,৯০০ টাকা দিলে sale-এর total, COD collection, remittance এবং fee আলাদা বিষয়। UI-তে যে কোনোটিকে অন্যটির সমান ধরে settlement দেবেন না।

## সফল হলে কী দেখবেন

বর্তমান পৃষ্ঠার সোর্সে delivery status, COD ও item count দেখানোর ব্যবস্থা আছে। এটি নিজে settlement সম্পন্ন হওয়ার প্রমাণ নয়।

## সীমাবদ্ধতা

বর্তমান dashboard page মূলত তালিকা ও refresh। নতুন delivery তৈরি, dispatch বা courier settlement করার পূর্ণ form এই পৃষ্ঠায় পাওয়া যায়নি। তাই কল্পিত `Settle` বা `Dispatch` বোতামের নির্দেশনা নেই।

`delivery_courier_enabled` default বন্ধ। বর্তমান implementation registry-তে `delivery` নেই; সাধারণ toggle দিয়ে enable করতে `MODULE_NOT_IMPLEMENTED` আসতে পারে। প্রকৃত tenant flag ও provider readiness পরীক্ষা করা হয়নি।

## সমস্যা ও সতর্কতা

`FEATURE_NOT_ENABLED` এলে অনুমতি বাড়িয়ে পাশ কাটাবেন না। Delivered status এবং কুরিয়ারের টাকা পাওয়া এক ঘটনা নয়। Live settlement পরীক্ষা করতে আলাদা অনুমতি প্রয়োজন।

**যাচাইয়ের অবস্থা:** Deliveries তালিকা UI-তে দেখা। Settlement editor-এর সীমা সোর্সে; delivery/COD/provider workflow চালানো হয়নি।

**প্রমাণ:** [Deliveries](<../../../src/app/(erp)/dashboard/deliveries/page.tsx>), [delivery API](../../../src/app/api/v1/deliveries/route.ts), [feature registry](../../../src/lib/featureFlags/index.ts)।
