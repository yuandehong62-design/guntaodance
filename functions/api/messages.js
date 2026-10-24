/* 棍涛舞团 · 留言 API（Cloudflare Pages Functions）
   路由: /api/messages
   KV 绑定: MESSAGES（项目设置 → Functions → KV 命名空间绑定） */

const MAX_MESSAGES = 100; // 服务器最多保留的留言条数

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
  const MESSAGES = context.env.MESSAGES;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method === 'GET') {
    const list = await MESSAGES.list({ limit: MAX_MESSAGES + 100 });
    const keys = list.keys.map(k => k.name).sort().reverse(); // 新 → 旧
    const messages = [];
    for (const name of keys.slice(0, MAX_MESSAGES)) {
      const item = await MESSAGES.get(name, 'json');
      if (item && typeof item === 'object' && item.text) messages.push(item);
    }
    return json({ ok: true, messages });
  }

  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) {
      return json({ ok: false, error: 'bad request' }, 400);
    }
    const name = String(body.name || '').trim().slice(0, 16) || '匿名';
    const text = String(body.text || '').trim().slice(0, 200);
    if (!text) return json({ ok: false, error: 'empty message' }, 400);

    const message = { name, text, time: new Date().toISOString() };
    const key = 'msg:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
    await MESSAGES.put(key, JSON.stringify(message));

    // 超出上限时裁剪最旧的留言
    const all = await MESSAGES.list({ limit: 600 });
    if (all.keys.length > MAX_MESSAGES) {
      const sorted = all.keys.map(k => k.name).sort(); // 旧 → 新
      const toDelete = sorted.slice(0, all.keys.length - MAX_MESSAGES);
      await Promise.all(toDelete.map(n => MESSAGES.delete(n)));
    }
    return json({ ok: true, message });
  }

  return json({ ok: false, error: 'method not allowed' }, 405);
}
