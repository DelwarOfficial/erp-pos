// src/app/(erp)/dashboard/sales/credit/page.tsx
// Credit sales are made on the one New Sale page ("Pay later" or "Pay part
// now", with the schedule beside the cart). Old links and bookmarks to this
// page land there with "Pay later" already chosen.

import { redirect } from 'next/navigation';

export default function CreditSaleRedirect() {
  redirect('/dashboard/pos?pay=later');
}
