// tests/unit/slackProvider.test.ts
// Tests the Slack webhook provider + mock notification provider.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

describe('SlackWebhookProvider', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.example.com/services/TEST/TEST/TESTTEST';
  });

  it('sends notification to Slack webhook with correct payload', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('ok') });
    const { SlackWebhookProvider } = await import('@/adapters/slackProvider');
    const provider = new SlackWebhookProvider();
    const result = await provider.sendNotification({
      severity: 'critical',
      title: 'Risk Alert: LOW_RECALL',
      message: 'Recall is 80% (below 90% threshold)',
      fields: [
        { label: 'Precision', value: '95.0%' },
        { label: 'Recall', value: '80.0%' },
      ],
      url: 'http://localhost:3000/dashboard/risk-tuning',
    });

    expect(result.delivered).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(opts.body);
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].color).toBe('#ff0000'); // critical = red
    expect(body.attachments[0].title).toContain('Risk Alert: LOW_RECALL');
    expect(body.attachments[0].fields).toHaveLength(2);
    expect(body.attachments[0].actions[0].url).toBe('http://localhost:3000/dashboard/risk-tuning');
  });

  it('returns error when SLACK_WEBHOOK_URL is not set', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    const { SlackWebhookProvider } = await import('@/adapters/slackProvider');
    const provider = new SlackWebhookProvider();
    const result = await provider.sendNotification({
      severity: 'warning',
      title: 'Test',
      message: 'Test',
    });
    expect(result.delivered).toBe(false);
    expect(result.error).toContain('not configured');
  });

  it('returns error when Slack API returns non-200', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, text: () => Promise.resolve('Bad request') });
    const { SlackWebhookProvider } = await import('@/adapters/slackProvider');
    const provider = new SlackWebhookProvider();
    const result = await provider.sendNotification({
      severity: 'warning',
      title: 'Test',
      message: 'Test',
    });
    expect(result.delivered).toBe(false);
    expect(result.error).toContain('400');
  });

  it('uses correct color for warning severity', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('ok') });
    const { SlackWebhookProvider } = await import('@/adapters/slackProvider');
    const provider = new SlackWebhookProvider();
    await provider.sendNotification({
      severity: 'warning',
      title: 'Test',
      message: 'Test',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.attachments[0].color).toBe('#ffae42'); // warning = orange
  });

  it('uses correct color for info severity', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('ok') });
    const { SlackWebhookProvider } = await import('@/adapters/slackProvider');
    const provider = new SlackWebhookProvider();
    await provider.sendNotification({
      severity: 'info',
      title: 'Test',
      message: 'Test',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.attachments[0].color).toBe('#36a64f'); // info = green
  });
});

describe('MockNotificationProvider', () => {
  it('always delivers and logs to console', async () => {
    const { MockNotificationProvider } = await import('@/adapters/slackProvider');
    const provider = new MockNotificationProvider();
    const result = await provider.sendNotification({
      severity: 'warning',
      title: 'Test Alert',
      message: 'This is a test',
      fields: [{ label: 'Count', value: '5' }],
    });
    expect(result.delivered).toBe(true);
    expect(result.providerMessageId).toMatch(/^mock-notif-/);
  });

  it('tracks calls in getCalls()', async () => {
    const { MockNotificationProvider } = await import('@/adapters/slackProvider');
    const provider = new MockNotificationProvider();
    provider.clearCalls();
    await provider.sendNotification({ severity: 'info', title: 'A', message: 'msg' });
    await provider.sendNotification({ severity: 'critical', title: 'B', message: 'msg' });
    const calls = provider.getCalls();
    expect(calls.length).toBe(2);
  });
});
