// Cloudflare Worker: statické súbory z public/ + API na analýzu.
import { onRequestPost, onRequestGet, onQuota } from './analyze.js';
export { Quota } from './quota.js'; // Durable Object: počty rozborov používateľov

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/analyze') {
      if (request.method === 'POST') return onRequestPost({ request, env, ctx });
      if (request.method === 'GET') return onRequestGet({ request, env });
      return new Response('Method not allowed', { status: 405 });
    }
    if (url.pathname === '/api/quota' && request.method === 'GET') return onQuota({ request, env });
    return env.ASSETS.fetch(request);
  },
};
