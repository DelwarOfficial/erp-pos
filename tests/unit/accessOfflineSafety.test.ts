import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

for (const path of ['/api/v1/auth/login', '/api/v1/auth/password-reset', '/api/v1/admin/users', '/api/v1/admin/roles/id']) {
  it(`never persists or queues offline credentials/admin changes: ${path}`, async () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const open = vi.fn(() => { throw new Error('Sensitive request reached persistent queue'); });
    const network = vi.fn().mockRejectedValue(new Error('Synthetic offline'));
    runInNewContext(readFileSync('public/sw.js', 'utf8'), {
      self: { location: { origin: 'http://localhost' }, addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler) },
      URL, Response, fetch: network, indexedDB: { open },
    });
    let response: Promise<Response> | undefined;
    handlers.get('fetch')!({ request: new Request(`http://localhost${path}`, { method: 'POST', body: '{}' }),
      respondWith: (value: Promise<Response>) => { response = value; } });
    await expect(response).rejects.toThrow('Synthetic offline');
    expect(network).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
}
