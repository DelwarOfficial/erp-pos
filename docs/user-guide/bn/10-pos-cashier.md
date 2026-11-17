# ১০. POS, ক্যাশিয়ার শিফট ও রসিদ

[সূচিপত্র](README.md)

**উদ্দেশ্য:** পণ্য বিক্রয় এবং নেওয়া টাকা নথিভুক্ত করা। **কে ব্যবহার করবেন:** অনুমোদিত ক্যাশিয়ার।

**শুরুর আগে:** সক্রিয় ও স্টকযুক্ত পণ্য, সঠিক warehouse, payment account, হিসাবের প্রস্তুতি এবং প্রয়োজনে serial।

## কোথায় পাবেন

`Cashier Shifts` → `/dashboard/cashier`; `New Sale` → `/dashboard/pos`; আগের বিক্রয় `Sales` → `/dashboard/sales`।

## শিফট খোলা

1. `Open a shift` অংশে `Warehouse` ও `Cash drawer account` নির্বাচন করুন।
2. বাস্তবে গুনে `Opening cash in drawer (৳)` লিখুন।
3. অনুমোদিত কাজ হলে `Open shift` দিন।
4. POS-এর `Cashier shift`-এ সঠিক খোলা শিফট বেছে নিন।

**শিফটের বাস্তব নিয়ম:** বর্তমান POS-এ shift নির্বাচন বাধ্যতামূলক নয়। শিফট না থাকলে বিক্রয় cash drawer-এ গণনা হবে না—এমন helper text আছে। তাই দোকানের cash-control নিয়মে shift প্রয়োজন হলে বাদ দেবেন না। “শিফট ছাড়া কোনো sale সম্ভব নয়” বলা সঠিক নয়।

## নগদ বিক্রয়: ধাপে ধাপে

1. `Search products`-এ অন্তত দুই অক্ষর দিন বা barcode scan করুন। পণ্য বেছে cart-এ যোগ করুন।
2. quantity ও unit price পরীক্ষা করুন। Serialized হলে প্রতিটি unit-এর আলাদা serial লিখুন।
3. `Warehouse`, প্রয়োজনে `Customer (optional)` ও `Cashier shift` মিলিয়ে নিন।
4. `How is the customer paying?` থেকে `Cash` বেছে `Payment account` দিন।
5. server-এর price/VAT calculation শেষ হওয়া পর্যন্ত অপেক্ষা করুন। প্রদর্শিত `Total to pay` মেনে কাজ করুন।
6. `Cash received from customer` দিলে ফেরত টাকার হিসাব দেখায়। এটি রেকর্ডকৃত sale amount-এর বিকল্প নয়।
7. সব মিললে `Complete sale` ব্যবহার করুন। Reference-সহ `Sale saved` নিশ্চিত করুন।
8. `Print receipt` বা `Print invoice` খুলুন। তারপর `Start next sale`।

## পেমেন্টের সীমা

POS-এ Cash, Card, bKash, Nagad, Rocket ও Bank নির্বাচন আছে। `Add split payment`-এ একাধিক অংশ দেওয়া যায়। পদ্ধতি নির্বাচন মানেই ব্যাংক/provider থেকে টাকা সফল এসেছে নয়। Gift card ও store credit tender domain-এ অক্ষম।

## উদাহরণ ও শিফট বন্ধ

Tax ছাড়া কাল্পনিক ৫০০ টাকার কেবলে ১,০০০ টাকা দিলে change ৫০০ টাকা। Opening cash ১,০০০ এবং এই এক নগদ sale ছাড়া কিছু না থাকলে drawer expected ১,৫০০ টাকা।

কাজ শেষে বাস্তব cash গুনে counted amount দিন। `Close shift` এবং confirmation ব্যবহার করুন। এরপর `Drawer balanced`, shortage বা overage দেখার ব্যবস্থা আছে। পার্থক্য হলে supervisor-কে জানান।

## সতর্কতা

Enter shortcut sale সম্পন্ন করতে পারে। অনিশ্চিত ফল এলে আবার sale করবেন না; `Sales` refresh করে reference মিলিয়ে নিন।

**যাচাইয়ের অবস্থা:** POS-এর খালি cart/payment form ও Cashier-এর opening form UI-তে দেখা। Sale, payment, receipt ও shift open/close চালানো হয়নি।

**প্রমাণ:** [POS](<../../../src/app/(erp)/dashboard/pos/page.tsx>), [Cashier](<../../../src/app/(erp)/dashboard/cashier/page.tsx>), [sale command](../../../src/domain/commands/m3/PostSale.ts), [ইংরেজি labels](../../../public/locales/en-BD/ui.json)।
