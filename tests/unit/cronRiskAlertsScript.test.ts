// The daily risk-alert cron script authenticates with the cron token only:
// no administrator password, no built-in default credential, and it refuses
// to run without its settings.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SCRIPT = 'scripts/cron-evaluate-risk-alerts.sh';
const source = readFileSync(SCRIPT, 'utf8');
const bash = spawnSync('bash', ['--version']).status === 0;

describe('cron-evaluate-risk-alerts.sh', () => {
  it('uses the token endpoint and carries no password or default credential', () => {
    expect(source).toContain('/api/v1/cron/risk-alerts');
    expect(source).not.toMatch(/ChangeMe|ADMIN_PASSWORD|auth\/login|admin\/risk-alerts/);
    expect(source).not.toMatch(/CRON_API_TOKEN:-[^}]/); // no fallback value
    expect(source).not.toMatch(/echo[^\n]*\$\{?CRON_API_TOKEN/); // never echoed
  });

  it.skipIf(!bash)('stops with a clear message when the token or URL is missing', () => {
    const env = { PATH: process.env.PATH ?? '' } as unknown as NodeJS.ProcessEnv;
    const noUrl = spawnSync('bash', [SCRIPT], { env: { ...env, CRON_API_TOKEN: 'synthetic-token' }, encoding: 'utf8' });
    expect(noUrl.status).toBe(2);
    expect(noUrl.stderr).toContain('ERP_POS_BASE_URL is not set');
    const noToken = spawnSync('bash', [SCRIPT], { env: { ...env, ERP_POS_BASE_URL: 'http://127.0.0.1:9' }, encoding: 'utf8' });
    expect(noToken.status).toBe(2);
    expect(noToken.stderr).toContain('CRON_API_TOKEN is not set');
  });
});
