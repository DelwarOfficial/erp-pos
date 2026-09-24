// F-53 regression: tenant-supplied webhook URLs must not reach internal
// addresses, at registration or at delivery.
//
// Endpoint URLs were checked only as a URL starting with https://, and delivery
// used fetch(), which follows redirects. https://127.0.0.1:8080/ or a host
// redirecting to http://169.254.169.254/ was accepted, and the first 500 bytes
// of each response were stored where the tenant could read them.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dns = vi.hoisted(() => ({ lookup: vi.fn(), lookupAll: vi.fn() }));

vi.mock('node:dns', async importOriginal => ({
  ...(await importOriginal<typeof import('node:dns')>()),
  lookup: dns.lookup,
}));
vi.mock('node:dns/promises', async importOriginal => ({
  ...(await importOriginal<typeof import('node:dns/promises')>()),
  lookup: dns.lookupAll,
}));

import { assertSafeOutboundUrl, isForbiddenAddress, postToOutboundUrl } from '@/lib/integrations/outboundUrl';

describe('address classification', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', // cloud metadata service
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fd00::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:169.254.169.254', // IPv4 in IPv6 clothing
    '64:ff9b::a9fe:a9fe', // NAT64 mapping of 169.254.169.254
  ])('refuses %s', address => {
    expect(isForbiddenAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])('allows public %s', address => {
    expect(isForbiddenAddress(address)).toBe(false);
  });

  it('refuses something that is not an address rather than guessing', () => {
    expect(isForbiddenAddress('not-an-ip')).toBe(true);
  });
});

describe('registration', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    'https://127.0.0.1:8080/hook',
    'https://[::1]/hook',
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost/hook',
    'https://billing.internal/hook',
    'https://printer.local/hook',
  ])('rejects %s', async url => {
    await expect(assertSafeOutboundUrl(url)).rejects.toMatchObject({ httpStatus: 400 });
  });

  it('rejects plain http and embedded credentials', async () => {
    await expect(assertSafeOutboundUrl('http://example.com/hook')).rejects.toMatchObject({ httpStatus: 400 });
    await expect(assertSafeOutboundUrl('https://user:pass@example.com/hook')).rejects.toMatchObject({ httpStatus: 400 });
  });

  it('rejects a public-looking hostname that resolves to a private address', async () => {
    dns.lookupAll.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(assertSafeOutboundUrl('https://hooks.example.com/x')).rejects.toMatchObject({ httpStatus: 400 });
  });

  it('rejects a host where any one of several records is private', async () => {
    // A host with one public and one private record would otherwise pass and
    // later connect to the private one.
    dns.lookupAll.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.0.10', family: 4 },
    ]);
    await expect(assertSafeOutboundUrl('https://hooks.example.com/x')).rejects.toMatchObject({ httpStatus: 400 });
  });

  it('accepts a host whose every record is public', async () => {
    dns.lookupAll.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(assertSafeOutboundUrl('https://hooks.example.com/x')).resolves.toBeInstanceOf(URL);
  });
});

describe('delivery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses at connect time when DNS has been rebound to the metadata service', async () => {
    // Registration saw a public address; by delivery the record points at the
    // metadata endpoint. The check runs inside the socket's own lookup, so the
    // connection is refused before it is made.
    dns.lookup.mockImplementation((_host: string, _opts: unknown, callback: (err: null, addresses: Array<{ address: string; family: number }>) => void) =>
      callback(null, [{ address: '169.254.169.254', family: 4 }]));

    await expect(postToOutboundUrl('https://rebinding.example.com/hook', {
      headers: {}, body: '{}', timeoutMs: 2000, maxBodyBytes: 500,
    })).rejects.toMatchObject({ code: 'EFORBIDDENADDR' });

    expect(dns.lookup).toHaveBeenCalled();
  });

  it('refuses a literal private address without resolving anything', async () => {
    await expect(postToOutboundUrl('https://10.0.0.1/hook', {
      headers: {}, body: '{}', timeoutMs: 2000, maxBodyBytes: 500,
    })).rejects.toMatchObject({ httpStatus: 400 });
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('is what the outbox worker delivers through', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/workers/outboxWorker.ts', 'utf8');
    // fetch() follows redirects and resolves DNS apart from the connect.
    expect(source).toMatch(/postToOutboundUrl\(endpoint\.url/);
    expect(source).not.toMatch(/await fetch\(endpoint\.url/);
  });
});
