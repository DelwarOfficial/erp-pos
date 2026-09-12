import { RoleEditor } from '@/components/access/roles';
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ company_id?: string }> }) {
  return <RoleEditor id={(await params).id} companyId={(await searchParams).company_id} />;
}
