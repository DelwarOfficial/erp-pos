# ৬. পণ্য, ক্যাটাগরি, বারকোড ও সিরিয়াল

[সূচিপত্র](README.md)

**উদ্দেশ্য:** পণ্যের সঠিক পরিচয়, একক ও মূল্য রাখা। **কে ব্যবহার করবেন:** catalogue/পণ্য ব্যবস্থাপনার অনুমতিপ্রাপ্ত কর্মী।

**শুরুর আগে:** category, unit, প্রয়োজনে brand; পণ্য serialized বা batch-tracked হবে কি না তার সিদ্ধান্ত।

## কোথায় পাবেন

`Categories & Brands` → `/dashboard/catalogue`; `Products` → `/dashboard/products`; নতুন পণ্য `/dashboard/products/new`; বিস্তারিত `/dashboard/products/[id]`। `[id]`-এর বদলে তালিকার পণ্য খুলুন।

## ধাপে ধাপে

1. Catalogue-এ `Categories`, `Brands`, `Units` ও `Tax Components` অংশ দেখুন। অনুমোদিত তথ্য আগে তৈরি করুন।
2. নতুন পণ্যে `Name *`, `Code *`, `Category *`, `Unit *`, `Type *` পূরণ করুন।
3. `Default Price (BDT)`, `Reference Cost (BDT)`, `Alert Quantity`, `Warranty (months)` প্রয়োজন অনুযায়ী দিন।
4. ডিভাইস আলাদা নম্বরে অনুসরণ করতে হলে `Serialized (IMEI/tracked)` বুঝে নির্বাচন করুন।
5. তৈরি পণ্য inactive হতে পারে। বিস্তারিত পৃষ্ঠার `Barcodes`-এ barcode type ও primary নির্বাচন করে `Add Barcode` ব্যবহার করা যায়।
6. `Activate`-এর আগে activation-এর শর্ত প্রস্তুত কি না administrator নিশ্চিত করবেন।

## গুরুত্বপূর্ণ সীমা

Standard/combo পণ্যে default sale ও purchase unit option activation validation-এ প্রয়োজন। পর্যালোচিত product UI-তে সেই unit option তৈরির সম্পাদক পাওয়া যায়নি। শুধু barcode যোগ করলেই activation নিশ্চিত নয়। সমস্যা হলে থামুন; DB সম্পাদনা করে সমাধান করতে বলা হচ্ছে না।

সমর্থিত activation পথ প্রস্তুত না হওয়া পর্যন্ত নতুন কর্মী administrator-এর নিশ্চিত করা বিদ্যমান active product দিয়ে শিখবেন। নিজে activation-এর বিকল্প পথ বানাবেন না।

Service/digital পণ্যে serial/batch-এর নিয়ম আলাদা। SKU একই ধরনের পণ্য চেনে; serial একটি নির্দিষ্ট ডিভাইস চেনে।

## উদাহরণ

“USB-C কেবল”, code `CAB-01`, unit “পিস”, বিক্রয়মূল্য ৫০০ টাকা, reference cost ৩৫০ টাকা। ১০টি গ্রহণের মূল্য ৩,৫০০ টাকা। পণ্য তৈরি করলেই এই ১০টি স্টকে যোগ হয় না।

## সফলতার চিহ্ন ও সমস্যা

Product detail-এ active/inactive ও barcode তালিকা দেখার ব্যবস্থা আছে। Activation error এলে বার্তা সংরক্ষণ করুন। অনুমোদন ছাড়া নতুন code দিয়ে একই পণ্য আবার বানাবেন না।

**যাচাইয়ের অবস্থা:** Products তালিকা ও New Product-এর খালি form UI-তে দেখা। Existing product detail, barcode/activation এবং stock যোগের ফল শুধু সোর্সে।

**প্রমাণ:** [নতুন পণ্য](<../../../src/app/(erp)/dashboard/products/new/page.tsx>), [বিস্তারিত](<../../../src/app/(erp)/dashboard/products/[id]/page.tsx>), [activation validation](../../../src/domain/invariants/productActivation.ts)।

