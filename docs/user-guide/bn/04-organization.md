# ৪. কোম্পানি, শাখা ও গুদাম

[সূচিপত্র](README.md)

**উদ্দেশ্য:** অন্য দোকান বা গুদামের রেকর্ডে ভুল কাজ এড়ানো। **কে ব্যবহার করবেন:** সবাই ধারণাটি জানবেন; onboarding শুধু অনুমোদিত platform কর্মীর কাজ।

## শুরুর আগে

কোম্পানি ব্যবসার সীমানা। শাখা কার্যস্থল। গুদাম পণ্যের অবস্থান। ক্যাশ বা ব্যাংক অ্যাকাউন্ট গুদাম নয়।

## কোথায় পাবেন

মেনুর `Add a Company`, route `/dashboard/onboarding`। Access Control-এ global ব্যবহারকারীর company picker আছে। Stock/POS ফর্মে warehouse নির্বাচন থাকে। সাধারণ branch/warehouse তৈরির পূর্ণাঙ্গ dashboard সম্পাদক এই পর্যালোচনায় পাওয়া যায়নি।

## ধাপে ধাপে

1. নিজের কোম্পানি ও শাখার নাম ব্যবস্থাপকের সঙ্গে মিলিয়ে নিন।
2. পণ্য নেওয়ার আগে নির্বাচিত warehouse মিলিয়ে নিন।
3. Platform administrator onboarding খুললে `Company`, `First Branch + Warehouse`, `First Admin (Owner)` অংশের তথ্য যাচাই করবেন।
4. Legal Name, Code, branch/warehouse-এর নাম ও code এবং owner-এর পরিচয় পূরণ করতে হয়।
5. প্রাথমিক পর্যবেক্ষণে submit করবেন না। প্রকৃত onboarding আলাদা অনুমোদিত কাজ।

## উদাহরণ

“আলো ইলেকট্রনিকস” কোম্পানির “ধানমন্ডি” শাখায় “বিক্রয় গুদাম” ও “মেরামত গুদাম” আলাদা হতে পারে। সার্ভিসের পণ্যকে বিক্রয়যোগ্য মজুত ভাববেন না।

## সফল হলে কী দেখবেন

সোর্সে `Onboarded Successfully` এবং তৈরি হওয়া পরিচিতি দেখানোর ব্যবস্থা আছে। কোম্পানি `suspended` অবস্থায় তৈরি হওয়ার বার্তাও আছে। সৃষ্টি হওয়া মানেই লগইন ও বিক্রয় প্রস্তুত নয়।

## সমস্যা ও সতর্কতা

Activation, owner-এর MFA, fiscal period ও accounting setup প্রস্তুত কি না platform কর্মী নিশ্চিত করবেন। Suspended অবস্থা থেকে সক্রিয় করার সম্পূর্ণ UI পথ এই পর্যালোচনায় নিশ্চিত হয়নি। নতুন প্রতিষ্ঠানের প্রথম বিক্রয় সফল হবে ধরে নেবেন না।

**যাচাইয়ের অবস্থা:** Onboarding-এর খালি form UI-তে দেখা; company সৃষ্টি, activation বা setup সম্পন্ন করা হয়নি।

**প্রমাণ:** [onboarding form](<../../../src/app/(erp)/dashboard/onboarding/page.tsx>), [onboarding API](../../../src/app/api/v1/onboarding/route.ts)।
