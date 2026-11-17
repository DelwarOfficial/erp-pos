# ৮. ক্রয়, পণ্য গ্রহণ ও শুরুর স্টক

[সূচিপত্র](README.md)

**উদ্দেশ্য:** ক্রয়াদেশ এবং বাস্তবে পাওয়া পণ্য আলাদা রাখা। **কে ব্যবহার করবেন:** ক্রয় ও warehouse কর্মী।

**শুরুর আগে:** সক্রিয় পণ্য, supplier, branch ও warehouse; receiving-এর অনুমতি; প্রয়োজনীয় হিসাবকাল ও account setup।

## কোথায় পাবেন

`Purchases` → `/dashboard/purchases`; `Stock & Inventory` → `/dashboard/inventory`; opening stock → `/dashboard/inventory/opening-stock`।

## ক্রয় ও পণ্য গ্রহণ: ধাপে ধাপে

1. `New Purchase` খুলে supplier, branch ও warehouse মিলিয়ে নিন।
2. `Order Date *`, currency, product, `Qty Ordered` ও `Unit Cost` লিখুন।
3. প্রয়োজনে `Add Line` দিন। `Create Purchase Order` ক্রয়াদেশ তৈরি করে; এতে নিজে থেকে stock বাড়ে না।
4. তালিকার `View purchase` খুলুন। `Ordered`, `Received`, `Remaining` মিলিয়ে নিন।
5. পণ্য বাস্তবে এলে `Receive stock` খুলুন। `Business date`, `Supplier document`, `Receive now` পূরণ করুন।
6. Serialized পণ্যে `Serial numbers (one per line)` দিন। Batch-tracked হলে batch ও তারিখ মিলিয়ে দিন।
7. বাস্তব পরিমাণ মিললে অনুমোদিতভাবে `Post receiving` ও তার confirmation সম্পন্ন করুন।
8. `Receiving history`, অবশিষ্ট পরিমাণ ও inventory মিলিয়ে নিন।

## শুরুর স্টক

`Post Opening Stock` প্রথম ব্যবহারের পরিমাণ ও unit cost নথিভুক্ত করে। ফর্মে `Reference No *`, `Business Date *`, warehouse ও items থাকে। সোর্সে warehouse-এ আগের stock movement না থাকার শর্ত আছে। নিয়মিত কেনা পণ্য এতে ঢোকাবেন না।

## উদাহরণ

১০টি কেবল, প্রতিটির cost ৩৫০ টাকা। মোট ৩,৫০০ টাকা। আজ ৬টি এলে receiving ৬টি; received cost ২,১০০ টাকা, বাকি ৪টি। পরের দিন বাকি ৪টি আলাদা receiving হবে।

## সফলতার চিহ্ন

Receiving history-তে নথি এবং order-এ received/remaining বদলানোর ব্যবস্থা আছে। বাস্তবে stock ও journal-এর ফল এই পর্যালোচনায় চালিয়ে মেলানো হয়নি।

## সমস্যা ও সতর্কতা

সাপ্লায়ার invoice-এর পরিমাণ কপি করার আগে পণ্য গুনুন। Serial-এর সংখ্যা quantity-এর সঙ্গে মিলতে হবে। Network failure-এর পরে একই পণ্য আবার receive করবেন না; আগে history refresh করুন।

**যাচাইয়ের অবস্থা:** Purchase list, নতুন purchase form, Inventory ও Opening Stock form UI-তে দেখা। Existing receiving detail ও posting শুধু সোর্সে; purchase/stock পরিবর্তন হয়নি।

**প্রমাণ:** [Purchases](<../../../src/app/(erp)/dashboard/purchases/page.tsx>), [Receiving](../../../src/components/purchases/PurchaseDetail.tsx), [Opening stock](<../../../src/app/(erp)/dashboard/inventory/opening-stock/page.tsx>)।
