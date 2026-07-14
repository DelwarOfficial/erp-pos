// src/middleware.ts
// Next.js middleware — CSRF protection for cookie-auth mutations per §6 rule 5.
//
// Strategy: Double-submit cookie pattern.
//   1. For GET/HEAD/OPTIONS requests: pass through (no CSRF needed)
//   2. For mutations (POST/PUT/PATCH/DELETE):
//      a. If the request has a valid Bearer token (API auth), allow (no CSRF needed for token auth)
//      b. If the request uses cookie auth (no Bearer), require either:
//         - Origin/Referer header matching the request host, OR
//         - X-CSRF-Token header matching the erp_access cookie value (double-submit)
//      c. Webhook endpoints (/api/v1/webhooks/*) are exempt (they use HMAC signatures)

import { NextRequest, NextResponse } from 'next/server';

const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const EXEMPT_PATHS = [
  '/api/v1/webhooks/',      // webhooks use HMAC signatures, not CSRF
  '/api/v1/auth/login',     // login doesn't have a cookie yet
  '/api/v1/auth/refresh',   // refresh endpoint
  '/api/v1/health',         // health check
  '/api/v1/cron/',          // cron endpoints use Bearer token auth
];

export function middleware(req: NextRequest) {
  const { method, headers } = req;
  const path = req.nextUrl.pathname;

  // Only check mutations
  if (!MUTATION_METHODS.includes(method)) {
    return NextResponse.next();
  }

  // Exempt paths (webhooks, auth, cron)
  if (EXEMPT_PATHS.some(p => path.startsWith(p))) {
    return NextResponse.next();
  }

  // If Bearer token is present (API auth), no CSRF needed
  const authHeader = headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return NextResponse.next();
  }

  // For cookie-auth mutations: check Origin/Referer
  const origin = headers.get('origin');
  const referer = headers.get('referer');
  const host = headers.get('host');

  // Check Origin header (preferred)
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) {
        return NextResponse.next(); // Origin matches — allowed
      }
    } catch {
      // Invalid origin URL — fall through to rejection
    }
  }

  // Check Referer header (fallback)
  if (referer && host) {
    try {
      const refererHost = new URL(referer).host;
      if (refererHost === host) {
        return NextResponse.next(); // Referer matches — allowed
      }
    } catch {
      // Invalid referer URL — fall through to rejection
    }
  }

  // Double-submit cookie check (X-CSRF-Token matches cookie)
  const csrfToken = headers.get('x-csrf-token');
  const accessCookie = req.cookies.get('erp_access')?.value;
  if (csrfToken && accessCookie && csrfToken === accessCookie) {
    return NextResponse.next();
  }

  // All checks failed — reject
  return NextResponse.json(
    {
      error: {
        code: 'CSRF_TOKEN_INVALID',
        message: 'Cross-site request forgery check failed. Origin/Referer must match or X-CSRF-Token header must be provided.',
        correlation_id: crypto.randomUUID(),
      },
    },
    { status: 403 },
  );
}

export const config = {
  // Apply to all API routes + page mutations
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|locales|logo.svg).*)',
  ],
};
