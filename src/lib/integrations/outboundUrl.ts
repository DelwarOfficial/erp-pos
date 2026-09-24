// Outbound requests to tenant-supplied URLs.
//
// Webhook endpoint URLs were validated only as `z.string().url()` plus an
// `https://` prefix, and delivery used fetch(), which follows redirects. A
// tenant administrator could register https://127.0.0.1:8080/ or a host that
// redirects to http://169.254.169.254/, and the server would then issue signed
// POSTs to internal services or the cloud metadata endpoint on a schedule --
// and store the first 500 bytes of each response on the delivery row, where the
// tenant can read it. That is a full server-side request forgery read
// primitive, latent only while nothing produced outbox events (F-39).
//
// Two layers:
//
//   assertSafeOutboundUrl  at registration, so the administrator is told at
//                          once. Resolves the host and checks every address.
//   postToOutboundUrl      at delivery. Validation at registration alone is
//                          not enough: DNS can change between registration and
//                          delivery, or between a check and a connect
//                          ("rebinding"). The check therefore runs inside the
//                          socket's own lookup, so the address validated is the
//                          address connected to. Redirects are never followed.

import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { lookup as dnsLookupAll } from 'node:dns/promises';
import https from 'node:https';
import { DomainError } from '@/lib/errors/codes';

const blocked = new BlockList();

// IPv4: unspecified, private, carrier-grade NAT, loopback, link-local
// (which includes 169.254.169.254, the cloud metadata service), IETF protocol
// assignments, documentation, benchmarking, multicast, reserved, broadcast.
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(network, prefix, 'ipv4');
blocked.addAddress('255.255.255.255', 'ipv4');

// IPv6: unspecified, loopback, unique-local, link-local, multicast,
// documentation, and the NAT64 prefix (which can map onto private IPv4).
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['2001:db8::', 32], ['64:ff9b::', 96],
] as const) blocked.addSubnet(network, prefix, 'ipv6');

const BLOCKED_HOSTNAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa)$/i;

/** True when the address must never be contacted from the server. */
export function isForbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    // IPv4-mapped (::ffff:a.b.c.d) is the IPv4 address in disguise.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return true; // not an address at all: refuse rather than guess
}

function parse(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'Webhook URL is not a valid URL', {}, 400);
  }
  if (url.protocol !== 'https:') {
    throw new DomainError('VALIDATION_FAILED', 'Webhook URL must use https', {}, 400);
  }
  if (url.username || url.password) {
    throw new DomainError('VALIDATION_FAILED', 'Webhook URL must not embed credentials', {}, 400);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.test(host)) {
    throw new DomainError('VALIDATION_FAILED', 'Webhook URL must point to a public host', {}, 400);
  }
  if (isIP(host) && isForbiddenAddress(host)) {
    throw new DomainError('VALIDATION_FAILED', 'Webhook URL must point to a public address', {}, 400);
  }
  return url;
}

/**
 * Registration-time check: the URL is well formed, https, and every address its
 * host currently resolves to is public.
 */
export async function assertSafeOutboundUrl(raw: string): Promise<URL> {
  const url = parse(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return url;

  let addresses: LookupAddress[];
  try {
    addresses = await dnsLookupAll(host, { all: true, verbatim: true });
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'Webhook host does not resolve', { host }, 400);
  }
  // Every address, not just the first: a host with one public and one private
  // record would otherwise pass here and connect to the private one later.
  if (addresses.length === 0 || addresses.some(entry => isForbiddenAddress(entry.address))) {
    throw new DomainError('VALIDATION_FAILED', 'Webhook host resolves to a non-public address', { host }, 400);
  }
  return url;
}

/** A dns.lookup that refuses to hand a forbidden address to the socket. */
function guardedLookup(
  hostname: string,
  options: object,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as LookupAddress[];
    const forbidden = list.find(entry => isForbiddenAddress(entry.address));
    if (list.length === 0 || forbidden) {
      const refusal = Object.assign(new Error(`Refusing to connect to non-public address for ${hostname}`), {
        code: 'EFORBIDDENADDR',
      });
      return callback(refusal, '', 0);
    }
    if ((options as { all?: boolean }).all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

export interface OutboundResponse {
  status: number;
  ok: boolean;
  /** At most maxBodyBytes of the response body. */
  body: string;
}

/**
 * Delivery-time POST. Validates the URL again, checks the address inside the
 * connect path, never follows a redirect, and bounds both time and body size.
 */
export async function postToOutboundUrl(raw: string, init: {
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  maxBodyBytes: number;
}): Promise<OutboundResponse> {
  // Inside an async function, so an invalid URL rejects like every other
  // failure instead of throwing synchronously at the call site.
  const url = parse(raw);
  return new Promise<OutboundResponse>((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST',
      headers: { ...init.headers, 'Content-Length': Buffer.byteLength(init.body).toString() },
      lookup: guardedLookup as never,
      timeout: init.timeoutMs,
    }, response => {
      const status = response.statusCode ?? 0;
      const chunks: Buffer[] = [];
      let received = 0;
      response.on('data', (chunk: Buffer) => {
        if (received >= init.maxBodyBytes) return;
        chunks.push(chunk.subarray(0, init.maxBodyBytes - received));
        received += chunk.length;
        if (received >= init.maxBodyBytes) response.destroy();
      });
      const finish = () => resolve({
        status,
        // A redirect is a failure, never a hop: following one is exactly how a
        // public host bounces the request onto the metadata service.
        ok: status >= 200 && status < 300,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.on('end', finish);
      response.on('close', finish);
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error(`Webhook delivery timed out after ${init.timeoutMs}ms`)));
    request.on('error', reject);
    request.end(init.body);
  });
}
