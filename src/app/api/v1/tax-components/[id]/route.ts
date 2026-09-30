import { NextRequest } from 'next/server';
import { catalogueMutation } from '@/lib/api/catalogueMutation';
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return catalogueMutation(req, (await params).id, 'tax-components');
}
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return catalogueMutation(req, (await params).id, 'tax-components');
}
