# ১২. বিক্রয় ফেরত ও টাকা ফেরত

[সূচিপত্র](README.md)

**উদ্দেশ্য:** ফেরত পণ্য, তার অবস্থা এবং ফেরত টাকা আলাদাভাবে সঠিক রাখা। **কে ব্যবহার করবেন:** অনুমোদিত return/refund কর্মী ও supervisor।

**শুরুর আগে:** মূল sale reference, ফেরতযোগ্য quantity, আসল serial, পণ্যের অবস্থা, ফেরত দেওয়ার account ও দোকানের অনুমোদন।

## কোথায় পাবেন

`Sales` → `/dashboard/sales` → সংশ্লিষ্ট sale-এর বিস্তারিত। এখানকার `Returns and refunds` অংশ প্রাসঙ্গিক।

## ধাপে ধাপে

1. মূল sale reference দিয়ে খুঁজে customer, product ও আগের returned quantity মিলিয়ে নিন।
2. বিস্তারিত পৃষ্ঠার `Return items` খুলুন। Reason এবং ফেরত quantity দিন।
3. `Resalable — restock` শুধু আবার বিক্রয়যোগ্য পণ্যের জন্য। ক্ষতিগ্রস্ত হলে `Damaged — quarantine` বেছে নিন।
4. Serialized হলে `Select returned serials` থেকে আসল বিক্রিত unit নির্বাচন করুন।
5. অনুমোদিতভাবে `Post return` ও confirmation দিন। এতে return credit ও inventory-এর কাজ হয়; টাকা ফেরত আলাদা।
6. `Returns and refunds`-এ Credit, Refunded, Remaining দেখুন।
7. টাকা ফেরতের অনুমতি থাকলে `Record refund` খুলুন। `Refund account`, `Refund method`, `Refund amount` মিলিয়ে নিন।
8. বাস্তবে টাকা দেওয়া নিশ্চিত করেই `Confirm refund` ব্যবহার করুন। আবার Remaining পরীক্ষা করুন।

## উদাহরণ

Tax/discount ছাড়া ৫০০ টাকার একটি কেবল ফেরত। Return credit ৫০০। ইতিমধ্যে ২০০ ফেরত হলে বাকি ৩০০। আবার পুরো ৫০০ দেওয়া যাবে না।

## গুরুত্বপূর্ণ পার্থক্য

**বাকিতে বা আংশিক পরিশোধিত sale হলে:** পুরো return credit-ই নগদ ফেরতযোগ্য ধরে নেবেন না। আগে হিসাবরক্ষক মূল payment, বকেয়া এবং return credit কীভাবে সমন্বয় হবে তা যাচাই করবেন। এই পরিস্থিতির live হিসাব পরীক্ষা হয়নি। নিশ্চয়তা ছাড়া cash refund দেবেন না।

- Return: পণ্য ও credit-এর রেকর্ড।
- Refund: অর্থ ফেরত দেওয়া ও তার রেকর্ড।
- Cancel sale: সম্পূর্ণ sale বাতিলের আলাদা action; partial return-এর বিকল্প নয়।

বর্তমান refund form-এর লেখা অনুযায়ী card/mobile provider refund আগে provider-এর মাধ্যমে সম্পন্ন করতে হয়। এই UI ইতিমধ্যে দেওয়া অর্থ রেকর্ড করে। `Confirm refund` চাপলেই কাস্টমারের মোবাইলে টাকা যাবে ধরে নেবেন না।

## সমস্যা ও সতর্কতা

ভুল serial, অতিরিক্ত quantity বা refund balance-এর বেশি amount হলে থামুন। Sale return থাকলে damaged product নতুন receiving দিয়ে যোগ করবেন না। Gateway refund-এর API আছে মানেই dashboard-এর প্রতিটি refund একই provider workflow ব্যবহার করে না।

**যাচাইয়ের অবস্থা:** Sales তালিকা UI-তে দেখা। Existing sale-এর return/refund detail ও কার্যপ্রবাহ শুধু সোর্সে; কোনো ফেরত/refund হয়নি।

**প্রমাণ:** [SaleDetail](../../../src/components/sales/SaleDetail.tsx), [Sales](<../../../src/app/(erp)/dashboard/sales/page.tsx>), [provider refund API](<../../../src/app/api/v1/payments/[id]/refund/route.ts>)।
