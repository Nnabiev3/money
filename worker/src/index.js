import { handleApi } from './api.js';
import { handleWebhook } from './webhook.js';

function configFrom(env) {
  return {
    db: env.DB,
    botToken: env.BOT_TOKEN,
    webhookSecret: env.WEBHOOK_SECRET,
    appUrl: env.APP_URL,
    allowedOrigin: env.ALLOWED_ORIGIN,
    allowlist: env.ALLOWLIST
  };
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/telegram/webhook' && request.method === 'POST') {
        return await handleWebhook(request, configFrom(env), ctx);
      }
      if (pathname.startsWith('/api/')) return await handleApi(request, configFrom(env));
      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('Необработанная ошибка', error);
      return new Response('Internal error', { status: 500 });
    }
  }
};
