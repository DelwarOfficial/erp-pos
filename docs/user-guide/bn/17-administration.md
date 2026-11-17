# ১৭. সেটিংস ও প্রশাসনিক কাজ

[সূচিপত্র](README.md)

**উদ্দেশ্য:** নিরাপত্তা, ঐচ্ছিক সুবিধা ও প্রশাসনিক কাজের সীমা বোঝা। **কে ব্যবহার করবেন:** নিজের Settings সবাই; বাকি কাজ সংশ্লিষ্ট অনুমতিপ্রাপ্ত administrator।

## বর্তমান লোকাল ডেমোর সতর্কতা

১৭ নভেম্বর ২০২৬-এর read-only পর্যবেক্ষণে `Import Jobs` তালিকার API HTTP 500 ফিরিয়েছে। `System Health` HTTP 503 দেখিয়েছে: Database `ok`, Redis `fail`, Storage ও Queue workers `skipped`। App-এ login ও form খোলা গেলেও import, background queue বা SMS delivery প্রস্তুত বলে ধরে নেবেন না।

বর্তমান login session global administrator হলেও MFA enabled/verified নয়। MFA-সুরক্ষিত কাজের জন্য প্রয়োজনীয় প্রস্তুতি আলাদা করে করতে হবে। এই পর্যালোচনায় MFA setup বা কোনো feature/configuration বদলানো হয়নি।

## পাসকি

**কোথায়:** `Settings` → `/dashboard/settings`।

1. `Passkeys`-এ নিজের registered key-এর নাম ও dates দেখুন।
2. প্রয়োজন হলে `Credential details` খুলুন; এটি অন্যকে পাঠানোর জন্য নয়।
3. নিজের অনুমোদিত ডিভাইসে `Register New Passkey` দিয়ে browser-এর ধাপ অনুসরণ করা যায়। বর্তমান পর্যালোচনায় registration করা হয়নি।
4. `Revoke`-এর আগে অন্য sign-in verification method আছে নিশ্চিত করুন। Confirmation cancel করলে key বাতিল হয় না।

**উদাহরণ:** অফিসের security key বদলালে পুরোনো key revoke করা লাগতে পারে। বিকল্প ব্যবস্থা ছাড়া নিজের একমাত্র প্রবেশপথ বাতিল করবেন না। Registration/revocation এই পর্যালোচনায় চালানো হয়নি।

## ঐচ্ছিক ফিচার

`Optional Features` → `/dashboard/feature-flags`। Default বন্ধ flag-কে কার্যকর capability ধরে নেবেন না। বর্তমান `IMPLEMENTED_MODULES`-এ CRM, HR, delivery, service, loyalty ও offline module নেই। তাদের সাধারণ enable action `MODULE_NOT_IMPLEMENTED` ফিরিয়ে দিতে পারে।

Multi-currency, quotation বা multilingual flag-এর নাম থাকা মানেই সংশ্লিষ্ট সব workflow-এর dashboard আছে নয়। এই পর্যালোচনায় quotation editor পাওয়া যায়নি। Permission ও flag দুটি আলাদা শর্ত।

## কার্যকলাপ, নিরাপত্তা ও health

| মেনু / route | কী দেখতে পারবেন | সীমা |
|---|---|---|
| Activity History `/dashboard/audit` | Action, Entity Type, User ID filter; selected entry-এর before/after | User ID-তে নাম নয়; displayed তথ্য গোপন হতে পারে। |
| Security Alerts `/dashboard/security` | Authentication ও security event | Metadata public করবেন না। |
| Risk Settings `/dashboard/risk-tuning` | Assessment, outcome ও threshold তথ্য | `Save Outcome` তথ্য বদলায়; সাধারণ কর্মীর কাজ নয়। |
| System Health `/dashboard/system` | অনুমতি থাকলে database/Redis/storage check | Health দেখা ব্যবসায়িক workflow সফল হওয়ার প্রমাণ নয়। |

## Import/Export ও সংযুক্ত অ্যাপ

`Import / Export` (`/dashboard/imports`)-এ CSV upload, dry-run, row error ও export job তালিকা আছে। সর্বোচ্চ ১০,০০০ row-এর কথা UI-তে লেখা। Upload বা dry-run-ও job তৈরি করতে পারে; read-only পর্যবেক্ষণে ফাইল দেবেন না। `Download` নিজের অনুমোদিত নথির জন্য ব্যবহার করুন।

`Connected Apps` (`/dashboard/integrations`)-এ webhook endpoint, signing secret ও delivery তথ্য আছে। Signing secret একবার দেখানো হতে পারে; screen capture করবেন না। Offline sync-এর batch history/conflict editor এখানে নেই। Offline POS শুধু approved pilot; অনলাইনের বিকল্প হিসেবে নিশ্চয়তা নেই।

## Support-এর বাস্তব সীমা

`Support` (`/dashboard/support`) ticket শুধু বর্তমান browser-এর local storage-এ রাখে। `Submit Ticket` মানেই support team পেয়েছে নয়। Browser storage মুছলে ticket হারাতে পারে। জরুরি সমস্যায় প্রতিষ্ঠানের নির্ধারিত যোগাযোগমাধ্যম ব্যবহার করুন।

**সফলতার চিহ্ন:** সংশ্লিষ্ট page-এর status/history; backend delivery নিজে যাচাই ছাড়া ধরে নেওয়া যাবে না। **সমস্যা:** access denied বা feature disabled হলে দায়িত্বপ্রাপ্ত administrator-এর কাছে reference দিন।

**যাচাইয়ের অবস্থা:** Settings, Flags, Audit, Security, Risk, System, Imports, Integrations ও Support UI-তে দেখা। Import list HTTP 500; health-এ database ok, Redis fail। কোনো প্রশাসনিক পরিবর্তন করা হয়নি।

**প্রমাণ:** [Settings](<../../../src/app/(erp)/dashboard/settings/page.tsx>), [Flags](../../../src/lib/featureFlags/index.ts), [Imports](<../../../src/app/(erp)/dashboard/imports/page.tsx>), [Integrations](<../../../src/app/(erp)/dashboard/integrations/page.tsx>), [Support](<../../../src/app/(erp)/dashboard/support/page.tsx>)।
