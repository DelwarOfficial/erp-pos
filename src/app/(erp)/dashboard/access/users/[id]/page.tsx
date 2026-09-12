import { UserEditor } from '@/components/access/users';
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ company_id?: string }> }) {
  return <UserEditor id={(await params).id} companyId={(await searchParams).company_id} />;
}
