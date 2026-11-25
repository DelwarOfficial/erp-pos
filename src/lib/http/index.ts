// src/lib/http/index.ts
// Shared HTTP helpers for API routes.

import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

export function getCorrelationId(req: NextRequest): string {
  return req.headers.get('x-correlation-id') ?? randomUUID();
}

/*
 * Client IP for rate limits and audit rows.
 *
 * Route handlers cannot see the TCP peer, so the client IP comes from
 * X-Forwarded-For. Each proxy appends the address it received the request
 * from, so only the RIGHT end of the header is trustworthy: anything to the
 * left may have been sent by the client itself (red-team finding 9).
 *
 * The header is read from right to left. Entries inside TRUSTED_PROXY_CIDRS
 * (comma-separated IPs or CIDRs) are skipped as our own proxies; the first
 * entry outside the list is the client.
 *
 * Trusted proxies, by deployment:
 * - docker/docker-compose.prod.yml: Caddy is the only proxy and replaces any
 *   client-sent X-Forwarded-For with the peer address. Leave the list empty.
 * - nginx behind Cloudflare without nginx real_ip: list Cloudflare's published
 *   ranges (https://www.cloudflare.com/ips/), so the Cloudflare edge hop
 *   that nginx appends is skipped.
 * - nginx with real_ip: nginx must trust only Cloudflare's ranges
 *   (set_real_ip_from <cloudflare ranges>, never 0.0.0.0/0). Otherwise nginx
 *   itself takes a client-supplied address and no app setting can recover.
 */
let trustedCache: { raw: string; list: BlockList } | undefined;

function trustedProxies(): BlockList {
  const raw = process.env.TRUSTED_PROXY_CIDRS ?? '';
  if (trustedCache?.raw === raw) return trustedCache.list;
  const list = new BlockList();
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [addr, bits] = entry.split('/');
    const version = isIP(addr);
    try {
      if (!version) throw new Error('not an IP');
      const family = version === 6 ? 'ipv6' : 'ipv4';
      if (bits === undefined) list.addAddress(addr, family);
      else list.addSubnet(addr, Number(bits), family);
    } catch {
      // Skipping an invalid entry trusts less, never more.
      console.warn(`[http] TRUSTED_PROXY_CIDRS: ignoring invalid entry "${entry}"`);
    }
  }
  trustedCache = { raw, list };
  return list;
}

/** "[::1]:443" → "::1", "1.2.3.4:80" → "1.2.3.4", "::ffff:1.2.3.4" → "1.2.3.4". */
function normalizeHop(hop: string): string {
  let h = hop.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(h);
  if (bracketed) h = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(h)) h = h.slice(0, h.lastIndexOf(':'));
  if (/^::ffff:\d{1,3}(\.\d{1,3}){3}$/i.test(h)) h = h.slice(7);
  return h;
}

function isTrusted(list: BlockList, ip: string): boolean {
  const version = isIP(ip);
  return version !== 0 && list.check(ip, version === 6 ? 'ipv6' : 'ipv4');
}

export function getClientIp(req: NextRequest): string | undefined {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map(normalizeHop).filter(Boolean);
    const list = trustedProxies();
    for (let i = hops.length - 1; i >= 0; i--) {
      if (!isTrusted(list, hops[i])) return hops[i];
    }
    // Every hop is one of our proxies: the request came from inside.
    if (hops.length > 0) return hops[0];
  }
  return req.headers.get('x-real-ip')?.trim() || undefined;
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
