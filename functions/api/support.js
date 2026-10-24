/* 棍涛舞团 · 应援计数 API（Cloudflare Pages Functions）
   路由: /api/support
   KV 绑定: COUNTERS（项目设置 → Functions → KV 命名空间绑定） */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

export async function onRequest(context) {
  const request = context.request;
  const COUNTERS = context.env.COUNTERS;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method === 'GET') {
    const count = parseInt(await COUNTERS.get('support')) || 0;
    return json({ ok: true, count });
  }

  if (request.method === 'POST') {
    const count = (parseInt(await COUNTERS.get('support')) || 0) + 1;
    await COUNTERS.put('support', String(count));
    return json({ ok: true, count });
  }

  return json({ ok: false, error: 'method not allowed' }, 405);
}
