import { FinancialDocument } from '@/components/shared/FinancialDocument';
export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinancialDocument kind="expenses" id={id} />;
}
