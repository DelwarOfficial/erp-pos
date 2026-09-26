// The suite-wide guard (tests/setup/disposableDatabase.ts) must refuse every
// database except the approved local disposable MariaDB.
import { describe, expect, it } from 'vitest';
import { assertDisposableDatabaseUrl } from '../setup/disposableDatabase';

describe('disposable database guard', () => {
  it('accepts the approved local disposable MariaDB', () => {
    expect(assertDisposableDatabaseUrl('mysql://root@127.0.0.1:43318/readiness_20260912_disposable').hostname).toBe('127.0.0.1');
    expect(() => assertDisposableDatabaseUrl('mysql://root:pw@localhost:43318/readiness_20260912_disposable')).not.toThrow();
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['malformed', 'not a url'],
    ['a remote host', 'mysql://app:secret@db.example.com:43318/readiness_20260912_disposable'],
    ['the production host', 'mysql://rangpurt:secret@host.zhostbd.com:3306/rangpurt_erp'],
    ['a production database name on localhost', 'mysql://root@127.0.0.1:43318/erp_production'],
    ['another local port', 'mysql://root@127.0.0.1:3306/readiness_20260912_disposable'],
    ['the default port', 'mysql://root@127.0.0.1/readiness_20260912_disposable'],
    ['a similar database name', 'mysql://root@127.0.0.1:43318/readiness_20260912_disposable_prod'],
    ['another engine', 'postgresql://root@127.0.0.1:43318/readiness_20260912_disposable'],
    ['a host that only starts like localhost', 'mysql://root@127.0.0.1.evil.test:43318/readiness_20260912_disposable'],
  ])('refuses %s', (_label, url) => {
    expect(() => assertDisposableDatabaseUrl(url)).toThrow(/TEST_DATABASE_REFUSED/);
  });

  it('never echoes credentials in its refusal', () => {
    expect(() => assertDisposableDatabaseUrl('mysql://app:hunter2@db.example.com:3306/prod')).toThrow(/^(?!.*hunter2).*$/);
  });
});
