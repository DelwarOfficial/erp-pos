import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { DomainError } from '@/lib/errors/codes';

export const privateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
export function accessResponse(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: privateHeaders }); }
export function accessError(error: unknown) {
  if (error instanceof DomainError) return accessResponse(error.toJSON(), error.httpStatus);
  if (error instanceof ZodError || error instanceof SyntaxError) return accessResponse({ error: { message: 'Invalid input. Check required fields and allowed values.' } }, 400);
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : '';
  if (code === 'P2002') return accessResponse({ error: { message: 'Email or role name already exists in this company.' } }, 409);
  if (code === 'P2034') return accessResponse({ error: { message: 'Access changed concurrently. Reload and try again.' } }, 409);
  return accessResponse({ error: { message: 'Administration request failed. No change was confirmed.' } }, 500);
}
