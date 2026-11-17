# ১১. বাকিতে বিক্রি, কিস্তি ও আদায়

[সূচিপত্র](README.md)

**উদ্দেশ্য:** পণ্য দেওয়ার সময় এবং টাকা পাওয়ার সময় আলাদা রাখা। **কে ব্যবহার করবেন:** অনুমোদিত salesperson, collection কর্মী ও হিসাবরক্ষক।

**শুরুর আগে:** চিহ্নিত customer, credit অনুমোদন, branch/warehouse, প্রয়োজনীয় account; reminder হলে যাচাই করা mobile ও SMS readiness।

## কোথায় পাবেন

`Sell on Credit` → `/dashboard/sales/credit`; `Collect Payments` → `/dashboard/collections`; `Payment Due Dates` → `/dashboard/collections/calendar`; `Payment Collection Reports` → `/dashboard/collections/reports`।

## বাকিতে বিক্রি: ধাপে ধাপে

1. Customer খুঁজে নির্বাচন করুন। Credit limit ও বর্তমান বকেয়ার নিয়ম মিলিয়ে নিন।
2. branch, warehouse, products, `Qty`, `Unit price` পূরণ করুন।
3. `Paid now (৳)`-এ এখন নেওয়া টাকা দিন। টাকা নিলে `Method` ও `Into account` নির্বাচন করুন।
4. `All on one date`, `Equal installments` বা `Custom installments` বেছে তারিখ ও পরিমাণ দিন।
5. SMS চাইলে `Mobile for reminders` কাস্টমারের সঙ্গে মিলিয়ে নিন। `Send SMS due reminders` চালু মানেই provider কার্যকর নয়।
6. `Preview` দিয়ে server-এর total, unpaid ও schedule পড়ুন। এটি final sale নয়।
7. অনুমোদিত কাজ হলে `Post sale` দিন। Reference এবং collection profile-এর link মিলিয়ে নিন।

## পরে টাকা আদায়

1. Collections-এর `Due today`, `Overdue`, `Upcoming` বা `All open` দেখুন।
2. সঠিক invoice/customer-এর `Collect` খুলুন।
3. `Collect a payment`-এ amount, `Method`, `Branch`, `Into account` দিন।
4. প্রয়োজন হলে নির্দিষ্ট invoice tick করুন। না করলে সোর্সে oldest due installment আগে allocation করার নিয়ম আছে।
5. বাস্তবে টাকা পাওয়া নিশ্চিত করে `Record payment` ব্যবহার করুন।
6. `Where the last payment went`, `Owed now`, installment ও `History` মিলিয়ে নিন।

## উদাহরণ

Tax ছাড়া কাল্পনিক বিক্রয় ১২,০০০ টাকা। এখন ৩,০০০; বাকি ৯,০০০। তিন সমান কিস্তি ৩,০০০ টাকা করে। পরে ২,০০০ আদায় হলে মোট বাকি ৭,০০০। প্রথম কিস্তিতে তখন ১,০০০ বাকি থাকতে পারে।

## ক্যালেন্ডার, অনুসরণ ও আদায়ের রিপোর্ট

- Calendar-এ `Previous month`, `Next month` দিয়ে মাস বদলানো যায়। দিন নির্বাচন করলে সেই দিনের worklist খোলে। Customer-এর promised date মূল due date বাতিল করে না।
- Collection profile-এর promise মানে “কাস্টমার অমুক দিনে টাকা দেওয়ার কথা বলেছেন”; অর্থ পাওয়া নয়। `Follow-ups`-এ call/visit-এর কাজ ও `Add follow-up` আছে। Completion লিখলেও payment তৈরি হয় না।
- Installment-এর `Change date` original due date বদলায়। কারণ ও প্রয়োজনীয় অনুমতি ছাড়া ব্যবহার করবেন না। শুধু ফোনে “পরের সপ্তাহে দেবেন” বললে due date নিজের মতো বদলাবেন না।
- Collection Reports-এ `From`, `To` দিয়ে `Update` ব্যবহার করুন। Period-এর collected amount এবং বর্তমানে outstanding amount-এর অর্থ আলাদা করে পড়ুন।

## সমস্যা ও সীমা

বকেয়ার বেশি collection প্রত্যাখ্যান করার UI ব্যাখ্যা আছে; advance হিসেবে আলাদা হিসাব প্রয়োজন। Date বদলানো, promise বা reminder-ও তথ্য বদলায়; অনুমতি ছাড়া অনুশীলন করবেন না।

Credit-sale form-এর items-এ serial সংগ্রহের ক্ষেত্র পাওয়া যায়নি, অথচ sale command serialized item-এ serial চায়। তাই serialized ফোন/টিভির credit sale এই form দিয়ে সম্পূর্ণ হবে ধরে নেবেন না। অনুশীলনে অনুমোদিত non-serialized পণ্য নিন।

**যাচাইয়ের অবস্থা:** Credit form, Collections, Calendar ও Collection Reports UI-তে দেখা। Customer-এর existing collection profile, quote, sale, allocation, reminder ও SMS চালানো হয়নি।

**প্রমাণ:** [Credit form](<../../../src/app/(erp)/dashboard/sales/credit/page.tsx>), [Collections](<../../../src/app/(erp)/dashboard/collections/page.tsx>), [Customer collection](<../../../src/app/(erp)/dashboard/collections/customers/[id]/page.tsx>)।
