# ৫. ব্যবহারকারী, ভূমিকা ও অনুমতি

[সূচিপত্র](README.md)

**উদ্দেশ্য:** প্রয়োজনীয় কর্মীকে প্রয়োজনীয় কাজ দেওয়া। **কে ব্যবহার করবেন:** access ব্যবস্থাপনার অনুমতিপ্রাপ্ত administrator।

**শুরুর আগে:** সঠিক কোম্পানি, প্রয়োজনীয় permission এবং পরিবর্তনের জন্য যাচাইকৃত MFA session লাগতে পারে।

## কোথায় পাবেন

`Access Control — Users` → `/dashboard/access/users`; `Roles` → `/dashboard/access/roles`; `Permissions` → `/dashboard/access/permissions`।

## ধাপে ধাপে

1. `Users`-এ কোম্পানি মিলিয়ে `Search users`, `Account status`, `Role`, `Branch` দিয়ে তালিকা দেখুন।
2. অনুমতি থাকলে `Add User` খুলুন। কর্মীর পরিচয়, branch access ও role নির্বাচন করুন। প্রাথমিক password নিরাপদ মাধ্যমে দিন।
3. `Roles`-এ `Create Role` ব্যবহার করে কাজভিত্তিক ভূমিকা তৈরি করা যায়। `Role name`, `Description` ও module অনুযায়ী permission থাকে।
4. প্রয়োজনীয় checkbox-গুলোই নির্বাচন করুন। `Save Role` পরিবর্তনের কাজ; প্রশিক্ষণে অনুমতি ছাড়া চাপবেন না।
5. `Permissions` শুধু catalogue। এখানে ব্যবহারকারীকে সরাসরি permission দেওয়া হয় না।
6. পরিবর্তন শেষে assigned users এবং protection state দেখুন।

## উদাহরণ

কাল্পনিক ক্যাশিয়ারের বিক্রয় ও শিফটের কাজ প্রয়োজন। তাকে সব কোম্পানির access, payroll বা role মুছে ফেলার অধিকার দেওয়ার প্রয়োজন নেই। দোকানের অনুমোদিত role ব্যবহার করুন।

## সফল হলে কী দেখবেন

সোর্সে `Role saved.` ও user update-এর feedback আছে। Role ও user access বদলালে সংশ্লিষ্ট session বাতিল বা পুনরায় sign-in প্রয়োজন হওয়ার বার্তা আছে।

## সমস্যা ও সীমা

System role সুরক্ষিত; পরিবর্তন বা delete করা যায় না। Assigned user থাকা custom role-এর delete অক্ষম থাকে। MFA সতর্কতা এলে তা পাশ কাটাবেন না। মেনু দেখা আর create/update অনুমতি এক নয়।

**যাচাইয়ের অবস্থা:** Users/Roles তালিকা, Permissions catalogue ও নতুন User/Role form UI-তে দেখা। Session-এর MFA verified নয়; কোনো role/user বদলানো হয়নি। Existing record editor-এর save/source flow শুধু সোর্সে।

**প্রমাণ:** [Users](../../../src/components/access/users.tsx), [Roles ও Permissions](../../../src/components/access/roles.tsx), [shared access](../../../src/components/access/common.tsx)।
