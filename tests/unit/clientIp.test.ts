// Red-team finding 9: a client-supplied X-Forwarded-For must not choose the
// rate-limit identity. Only hops appended by trusted proxies are skipped.
import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getClientIp } from '@/lib/http';

const CLOUDFLARE_SAMPLE = '173.245.48.0/20,2400:cb00::/32';

function req(headers: Record<string, string>) {
  return new NextRequest('https://erp.example.test/api/v1/auth/mfa/verify', { headers });
}

afterEach(() => {
  delete process.env.TRUSTED_PROXY_CIDRS;
});

describe('getClientIp', () => {
  it('ignores a spoofed first entry: the proxy-appended hop wins', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('gives a rotating spoofed header the same rate-limit identity', () => {
    const seen = new Set(
      ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((fake) =>
        getClientIp(req({ 'x-forwarded-for': `${fake}, 203.0.113.9` })),
      ),
    );
    expect([...seen]).toEqual(['203.0.113.9']);
  });

  it('skips trusted proxy hops and takes the next one to the left', () => {
    process.env.TRUSTED_PROXY_CIDRS = CLOUDFLARE_SAMPLE;
    expect(getClientIp(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9, 173.245.48.7' }))).toBe('203.0.113.9');
    expect(getClientIp(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9, 2400:cb00::1' }))).toBe('203.0.113.9');
  });

  it('never returns the client-supplied entry left of an untrusted hop', () => {
    process.env.TRUSTED_PROXY_CIDRS = CLOUDFLARE_SAMPLE;
    // The client claims to be a Cloudflare address; it is still left of the real hop.
    expect(getClientIp(req({ 'x-forwarded-for': '173.245.48.1, 198.51.100.4' }))).toBe('198.51.100.4');
  });

  it('normalizes ports, brackets and IPv4-mapped addresses', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.9:51234' }))).toBe('203.0.113.9');
    expect(getClientIp(req({ 'x-forwarded-for': '[2001:db8::5]:443' }))).toBe('2001:db8::5');
    expect(getClientIp(req({ 'x-forwarded-for': '::ffff:203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('ignores invalid trusted entries instead of trusting more', () => {
    process.env.TRUSTED_PROXY_CIDRS = 'not-an-ip, 10.0.0.0/abc';
    expect(getClientIp(req({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('10.0.0.1');
  });

  it('falls back to x-real-ip only when there is no X-Forwarded-For', () => {
    expect(getClientIp(req({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(getClientIp(req({ 'x-forwarded-for': '198.51.100.4', 'x-real-ip': '1.2.3.4' }))).toBe('198.51.100.4');
    expect(getClientIp(req({}))).toBeUndefined();
  });
});
