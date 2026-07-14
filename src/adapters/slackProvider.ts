// src/adapters/slackProvider.ts
// Slack incoming webhook provider — posts alerts to a Slack channel.
// Per §16 monitoring — real-time alerting for ops team.
//
// Setup:
//   1. Create a Slack app at https://api.slack.com/apps
//   2. Enable Incoming Webhooks
//   3. Create a webhook URL for your channel (e.g. #ops-alerts)
//   4. Set SLACK_WEBHOOK_URL in .env
//
// Color coding by severity:
//   info → #36a64f (green)
//   warning → #ffae42 (orange)
//   critical → #ff0000 (red)

import type { NotificationProvider } from './index';

const SEVERITY_COLORS: Record<string, string> = {
  info: '#36a64f',
  warning: '#ffae42',
  critical: '#ff0000',
};

const SEVERITY_EMOJI: Record<string, string> = {
  info: '✅',
  warning: '⚠️',
  critical: '🚨',
};

export class SlackWebhookProvider implements NotificationProvider {
  code = 'slack';
  private webhookUrl: string;
  private channel: string | undefined;

  constructor() {
    this.webhookUrl = process.env.SLACK_WEBHOOK_URL ?? '';
    this.channel = process.env.SLACK_CHANNEL; // optional override
  }

  async sendNotification(params: {
    severity: 'info' | 'warning' | 'critical';
    title: string;
    message: string;
    fields?: Array<{ label: string; value: string }>;
    url?: string;
  }): Promise<{ delivered: boolean; providerMessageId?: string; error?: string }> {
    if (!this.webhookUrl) {
      return { delivered: false, error: 'SLACK_WEBHOOK_URL not configured' };
    }

    const attachment: Record<string, unknown> = {
      color: SEVERITY_COLORS[params.severity] ?? '#cccccc',
      title: `${SEVERITY_EMOJI[params.severity] ?? ''} ${params.title}`,
      text: params.message,
      ts: Math.floor(Date.now() / 1000),
      fields: params.fields?.map(f => ({
        title: f.label,
        value: f.value,
        short: f.value.length < 30,
      })),
    };

    if (params.url) {
      attachment.actions = [{
        type: 'button',
        text: 'View Dashboard',
        url: params.url,
      }];
    }

    const payload: Record<string, unknown> = {
      attachments: [attachment],
    };
    if (this.channel) payload.channel = this.channel;

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        return { delivered: false, error: `Slack API ${response.status}: ${text}` };
      }

      // Slack returns "ok" on success — no message ID
      return { delivered: true };
    } catch (e) {
      return {
        delivered: false,
        error: e instanceof Error ? e.message : 'Network error',
      };
    }
  }
}

// Mock notification provider for dev/test — logs to in-memory call log
export class MockNotificationProvider implements NotificationProvider {
  code = 'mock_notification';
  private callLog: Array<{ params: unknown; result: unknown; timestamp: number }> = [];

  async sendNotification(params: {
    severity: 'info' | 'warning' | 'critical';
    title: string;
    message: string;
    fields?: Array<{ label: string; value: string }>;
    url?: string;
  }): Promise<{ delivered: boolean; providerMessageId?: string; error?: string }> {
    const result = {
      delivered: true,
      providerMessageId: `mock-notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };
    this.callLog.push({ params, result, timestamp: Date.now() });
    console.log(`[mock:notification] ${params.severity.toUpperCase()} ${params.title}: ${params.message.slice(0, 80)}`);
    if (params.fields) {
      for (const f of params.fields) {
        console.log(`  ${f.label}: ${f.value}`);
      }
    }
    return result;
  }

  getCalls() { return [...this.callLog]; }
  clearCalls() { this.callLog.length = 0; }
}
