// src/lib/http/index.ts
// Shared HTTP helpers for API routes.

import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';

export function getCorrelationId(req: NextRequest): string {
  return req.headers.get('x-correlation-id') ?? randomUUID();
}

export function getClientIp(req: NextRequest): string | undefined {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    undefined
  );
}

export function getUserAgent(req: NextRequest): string | undefined {
  return req.headers.get('user-agent') ?? undefined;
}

export function ok(body: unknown, status: number = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers });
}

export function noContent() {
  return new Response(null, { status: 204 });
}

export async function readJsonBody<T = unknown>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error('Invalid JSON body');
  }
}
