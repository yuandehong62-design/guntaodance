/* 棍涛舞团 · 购票余票 API（Cloudflare Pages Functions）
   路由: /api/stock
   KV 绑定: COUNTERS，key 'ticket_stock' 存 JSON { [showId]: { normal, premium, vip } }，默认各 80
   GET  — 读取全部场次余票（公开，无密码）
   POST — 购票扣减 { showId, type, qty }（type ∈ normal|premium|vip） */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const DEFAULT_STOCK = 80;
const TYPES = ['normal', 'premium', 'vip'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

/* 把 KV 里的原始值规整成合法结构（负数归零、缺字段补 0） */
function normalize(stock) {
  const out = {};
  if (stock && typeof stock === 'object') {
    for (const [id, t] of Object.entries(stock)) {
      if (!t || typeof t !== 'object') continue;
      out[id] = {
        normal: Math.max(0, parseInt(t.normal, 10) || 0),
        premium: Math.max(0, parseInt(t.premium, 10) || 0),
        vip: Math.max(0, parseInt(t.vip, 10) || 0),
      };
    }
  }
  return out;
}

async function readStock(COUNTERS) {
  let raw = null;
  try { raw = await COUNTERS.get('ticket_stock', 'json'); } catch (e) { raw = null; }
  return normalize(raw);
}

export async function onRequest(context) {
  const request = context.request;
  const COUNTERS = context.env.COUNTERS;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method === 'GET') {
    return json({ ok: true, stock: await readStock(COUNTERS) });
  }

  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) {
      return json({ ok: false, error: 'bad request' }, 400);
    }
    const showId = String(body.showId || '').trim();
    const type = String(body.type || '').trim();
    const qty = parseInt(body.qty, 10);
    if (!showId || !TYPES.includes(type) || !Number.isFinite(qty) || qty < 1) {
      return json({ ok: false, error: '参数错误' }, 400);
    }

    const stock = await readStock(COUNTERS);
    if (!stock[showId]) {
      stock[showId] = { normal: DEFAULT_STOCK, premium: DEFAULT_STOCK, vip: DEFAULT_STOCK };
    }
    if (qty > stock[showId][type]) {
      return json({ ok: false, error: '余票不足', stock }, 409);
    }
    stock[showId][type] -= qty;
    await COUNTERS.put('ticket_stock', JSON.stringify(stock));
    return json({ ok: true, stock, show: stock[showId] });
  }

  return json({ ok: false, error: 'method not allowed' }, 405);
}
