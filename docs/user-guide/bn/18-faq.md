# ১৮. সাধারণ সমস্যা, সতর্কতা ও FAQ

[সূচিপত্র](README.md)

**উদ্দেশ্য:** ভুল কাজ না বাড়িয়ে সমস্যা শনাক্ত করা। **কে ব্যবহার করবেন:** সবাই। **শুরুর আগে:** বর্তমান page, সময় ও reference মনে রাখুন।

## মেনু বা বোতাম নেই কেন?

Role/permission, company scope, document status বা feature flag-এর কারণে নাও থাকতে পারে। অন্যের account নেবেন না। [Access](05-access.md) ও [সীমাবদ্ধতা](VERIFICATION.md) দেখুন।

## নতুন product তৈরি হলেও বিক্রি হচ্ছে না কেন?

Inactive অবস্থা, unit options, category, stock বা serial-এর শর্ত দেখুন। শুধু product record তৈরি করা stock receiving নয়। [পণ্য](06-products.md) ও [গ্রহণ](08-purchases-stock.md) আলাদা ধাপ।

## পরিমাণ আছে, তবু বিক্রি করা যাচ্ছে না?

ভুল warehouse, reserved/in-transit/damaged stock বা ভুল serial হতে পারে। সব quantity sellable নয়। প্রয়োজন হলে inventory কর্মীর সাহায্য নিন।

## Save/Post-এর পরে network error এলে আবার চাপব?

1. নতুন নথি তৈরি করা থামান।
2. তালিকা refresh করে reference, amount ও সময় মিলিয়ে নিন।
3. provider payment হলে provider-এর ফলও দায়িত্বপ্রাপ্ত ব্যক্তি মিলিয়ে দেখবেন।
4. নিশ্চিত ফল না পাওয়া পর্যন্ত নতুন করে টাকা নেবেন বা ফেরত দেবেন না।

উদাহরণ: ৫০০ টাকার sale-এর result অজানা। দ্বিতীয়বার sale করলে ১,০০০ টাকার record হওয়ার ঝুঁকি থাকে। সফটওয়্যারের retry protection থাকলেও নিজেরা নতুন transaction তৈরি করবেন না।

## শিফট ছাড়া sale করা যায়?

বর্তমান POS shift বাদ দিতে পারে। তখন drawer হিসাবের সঙ্গে sale যুক্ত না হওয়ার সতর্কতা আছে। দোকানের নিয়ম মেনে [শিফট](10-pos-cashier.md) ব্যবহার করুন।

## Return দিলে কি টাকা ফেরত যায়?

না। Return credit ও টাকা ফেরত আলাদা। Card/mobile provider-এর refund আগে সত্যি হয়েছে কি না নিশ্চিত করতে হবে। [ফেরতের অধ্যায়](12-returns-refunds.md) দেখুন।

## SMS unknown মানে কি ব্যর্থ?

অবশ্যই নয়। Provider-এর ফল নিশ্চিত নয়। আবার পাঠানোর আগে provider report ও message history মিলতে হবে। এখানে কোনো SMS পাঠিয়ে পরীক্ষা করা হয়নি।

## রিপোর্টে কম তথ্য কেন?

Filter, scope, pagination, date range ও detail limit দেখুন। বর্তমান report code-এ detail truncation metadata আছে। Summary এবং প্রদর্শিত detail-এর যোগফল সবসময় একই scope নাও বোঝাতে পারে। [রিপোর্ট](13-accounting-reports.md) দেখুন।

## পাসওয়ার্ড ভুলে গেলে কী করব?

Administrator-এর one-time reset link নিন। Ticket-এ পাসওয়ার্ড বা token দেবেন না। [লগইন](02-login-security.md) দেখুন।

## কীভাবে সহায়তা চাইব?

Page/route, কাজের নাম, সময়, reference এবং গোপন তথ্য মুছে error text দিন। ফোন, customer address, salary, cookie, credential বা API key দেবেন না। Support page এখনও local-only; প্রতিষ্ঠানের নির্ধারিত যোগাযোগমাধ্যম ব্যবহার করুন।

**সফলতার চিহ্ন:** মূল রেকর্ড না বদলে সমস্যার অবস্থান বোঝা এবং সঠিক দায়িত্বপ্রাপ্ত ব্যক্তিকে জানানো। **যাচাইয়ের অবস্থা:** পৃষ্ঠাগুলো UI-তে দেখা; FAQ-এর business troubleshooting সোর্সভিত্তিক। Import list ও Redis health-এর সমস্যা ছাড়া অন্য error ইচ্ছাকৃতভাবে তৈরি করা হয়নি।
