// Content-Security-Policy with a per-request script nonce (F-68).
//
// src/middleware.ts creates a fresh nonce for every page request and sends
// this policy on both the request (Next.js reads the nonce from it while
// rendering and puts it on its own scripts) and the response. Scripts run only
// if they carry the nonce, or were loaded by one that does ('strict-dynamic');
// injected inline script does not run. Pages must be rendered per request for
// this, which the root layout ensures by reading the nonce.
//
// style-src keeps 'unsafe-inline': components set inline style attributes and
// the chart component writes a <style> element. Styles cannot run code.

/** A fresh nonce: 128 random bits, base64. Uses Web Crypto, available in the middleware runtime. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function contentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    // Development only: React uses eval to rebuild server error stacks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "object-src 'none'",
    // The space-z.ai preview gateway frames the app in development only.
    `frame-ancestors 'self'${development ? ' https://*.space-z.ai' : ''}`,
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
