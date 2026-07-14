// Root page — redirect to /login (unauthenticated) or /dashboard (authenticated).

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function Home() {
  const cookieStore = await cookies();
  const hasAccess = cookieStore.has('erp_access');
  redirect(hasAccess ? '/dashboard' : '/login');
}
