import { describe, expect, it } from 'vitest';
import { buildSetupRequests, COMMAND_MENU } from '../src/setup.js';

const input = { workerUrl: 'https://money-bot.example.workers.dev/', appUrl: 'https://example.github.io/money/', secret: 'abc_DEF-123' };

describe('buildSetupRequests', () => {
  it('registers the webhook with the secret, without a double slash', () => {
    const [webhook] = buildSetupRequests(input);
    expect(webhook).toEqual({
      method: 'setWebhook',
      payload: {
        url: 'https://money-bot.example.workers.dev/telegram/webhook',
        secret_token: 'abc_DEF-123',
        allowed_updates: ['message', 'callback_query']
      }
    });
  });

  it('publishes the command menu and the Web App menu button', () => {
    const [, commands, menu] = buildSetupRequests(input);
    expect(commands).toEqual({ method: 'setMyCommands', payload: { commands: COMMAND_MENU } });
    expect(menu).toEqual({
      method: 'setChatMenuButton',
      payload: { menu_button: { type: 'web_app', text: 'Открыть', web_app: { url: 'https://example.github.io/money/' } } }
    });
  });

  it('the command menu covers every bot command with a Russian description', () => {
    expect(COMMAND_MENU.map(c => c.command)).toEqual(['spent', 'income', 'balance', 'month', 'last', 'undo', 'statement', 'deleteall', 'help']);
    for (const { command, description } of COMMAND_MENU) {
      expect(command).toMatch(/^[a-z_]{1,32}$/);
      expect(description.length).toBeGreaterThan(3);
      expect(description.length).toBeLessThanOrEqual(256);
    }
  });

  it.each([
    [{ ...input, secret: '' }],
    [{ ...input, secret: 'has space' }],
    [{ ...input, secret: 'x'.repeat(257) }],
    [{ ...input, workerUrl: 'http://insecure.example' }],
    [{ ...input, appUrl: 'not a url' }]
  ])('refuses unusable input %j', bad => {
    expect(() => buildSetupRequests(bad)).toThrow();
  });
});
