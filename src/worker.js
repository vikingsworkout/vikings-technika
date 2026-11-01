// Cloudflare Worker: statické súbory z public/ + API na analýzu.
import { onRequestPost, onRequestGet, onQuota, onUsage, usageCors } from './analyze.js';
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
    // správca: spotreba AI a mesačný limit (appka Viking's Workout → Nastavenia → Hrazda)
    if (url.pathname === '/api/usage') {
      if (request.method === 'OPTIONS') return usageCors(request, new Response(null, { status: 204 }));
      if (request.method === 'GET' || request.method === 'POST') return onUsage({ request, env });
      return new Response('Method not allowed', { status: 405 });
    }
    return env.ASSETS.fetch(request);
  },
};
