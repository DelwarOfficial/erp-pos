import { FinancialDocument } from '@/components/shared/FinancialDocument';
export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinancialDocument kind="payments" id={id} />;
}
