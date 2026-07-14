// src/adapters/telegramProvider.ts
// Telegram Bot provider — sends alerts via Telegram Bot API.
// Per §16 monitoring — real-time alerting for ops team (Slack alternative).
//
// Setup:
//   1. Create a bot via @BotFather on Telegram (https://t.me/BotFather)
//   2. Get the bot token (format: <bot_id>:<secret>)
//   3. Get your chat ID (message @userinfobot to get it, or use the bot's own ID
//      for self-messages)
//   4. Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in .env
//   5. Send a /start message to your bot first (bots can't initiate conversations)
//
// API: https://core.telegram.org/bots/api#sendmessage

import type { NotificationProvider } from './index';

const SEVERITY_EMOJI: Record<string, string> = {
  info: '✅',
  warning: '⚠️',
  critical: '🚨',
};

export class TelegramBotProvider implements NotificationProvider {
  code = 'telegram';
  private botToken: string;
  private chatId: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
    this.chatId = process.env.TELEGRAM_CHAT_ID ?? '';
  }

  async sendNotification(params: {
    severity: 'info' | 'warning' | 'critical';
    title: string;
    message: string;
    fields?: Array<{ label: string; value: string }>;
    url?: string;
  }): Promise<{ delivered: boolean; providerMessageId?: string; error?: string }> {
    if (!this.botToken || !this.chatId) {
      return { delivered: false, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured' };
    }

    // Build HTML-formatted message
    const emoji = SEVERITY_EMOJI[params.severity] ?? '';
    const lines: string[] = [
      `${emoji} <b>${escapeHtml(params.title)}</b>`,
      '',
      escapeHtml(params.message),
    ];

    if (params.fields && params.fields.length > 0) {
      lines.push('');
      for (const f of params.fields) {
        lines.push(`<b>${escapeHtml(f.label)}:</b> ${escapeHtml(f.value)}`);
      }
    }

    if (params.url) {
      lines.push('');
      lines.push(`🔗 <a href="${escapeHtml(params.url)}">View Dashboard</a>`);
    }

    const text = lines.join('\n');

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        return {
          delivered: false,
          error: `Telegram API error: ${data.description ?? response.statusText ?? 'Unknown'}`,
        };
      }

      return {
        delivered: true,
        providerMessageId: String(data.result?.message_id ?? ''),
      };
    } catch (e) {
      return {
        delivered: false,
        error: e instanceof Error ? e.message : 'Network error',
      };
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
