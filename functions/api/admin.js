/* 棍涛舞团 · 统一管理后台 API（Cloudflare Pages Functions）
   路由: /api/admin（POST JSON，需请求头 X-Admin-Password）
   环境变量（在 Cloudflare 后台 → guntaodance 项目 → Settings → Environment variables 添加）:
     ADMIN_PASSWORD  — 管理密码（必填，未配置时后台整体停用）
     QINIU_AK / QINIU_SK / QINIU_BUCKET — 七牛云密钥（投稿墙管理用，与导航页项目一致）
     QINIU_DOMAIN    — 七牛下载域名（可选，默认 tn3b3bcgf.hn-bkt.clouddn.com）
   功能:
     留言管理  listMessages / editMessage(改昵称/改内容) / deleteMessage —— 存 KV 绑定 MESSAGES
     投稿墙    listFiles / renameFile(改名) / deleteFile —— 调七牛云 rs 管理接口 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
  'Access-Control-Max-Age': '86400',
};

const QINIU_DEFAULT_DOMAIN = 'tn3b3bcgf.hn-bkt.clouddn.com';
const MSG_KEY_RE = /^msg:\d+:[a-z0-9]+$/;
const FILE_KEY_RE = /^[A-Za-z0-9_.\-]{1,200}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed' }, 405);
  }

  // ---- 密码校验 ----
  const pwd = (env.ADMIN_PASSWORD || '').trim();
  if (!pwd) {
    return json({
      ok: false,
      error: '管理密码未配置：请在 Cloudflare 后台 → Workers & Pages → guntaodance → Settings → Environment variables → Production 添加 ADMIN_PASSWORD（以及 QINIU_AK / QINIU_SK / QINIU_BUCKET 用于投稿墙管理）后重新部署。',
      setup: true,
    }, 503);
  }
  if ((request.headers.get('X-Admin-Password') || '') !== pwd) {
    return json({ ok: false, error: '密码错误' }, 401);
  }

  let body;
  try { body = await request.json(); } catch (e) {
    return json({ ok: false, error: 'bad request' }, 400);
  }
  const action = String(body.action || '');

  try {
    switch (action) {
      case 'ping': return json({ ok: true, time: Date.now() });
      case 'listMessages': return await listMessages(env);
      case 'editMessage': return await editMessage(env, body);
      case 'deleteMessage': return await deleteMessage(env, body);
      case 'listFiles': return await listFiles(env);
      case 'renameFile': return await renameFile(env, body);
      case 'deleteFile': return await deleteFile(env, body);
      case 'getStock': return await getStock(env);
      case 'setStock': return await setStock(env, body);
      default: return json({ ok: false, error: '未知操作: ' + action }, 400);
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}

/* ================= 留言管理（KV: MESSAGES） ================= */

async function listMessages(env) {
  const list = await env.MESSAGES.list({ limit: 500 });
  const keys = list.keys.map(k => k.name).sort().reverse(); // 新 → 旧
  const messages = [];
  for (const name of keys.slice(0, 200)) {
    const item = await env.MESSAGES.get(name, 'json');
    if (item && typeof item === 'object' && item.text) messages.push({ key: name, ...item });
  }
  return json({ ok: true, messages });
}

async function editMessage(env, body) {
  const key = String(body.key || '');
  if (!MSG_KEY_RE.test(key)) return json({ ok: false, error: '非法留言标识' }, 400);
  const item = await env.MESSAGES.get(key, 'json');
  if (!item || typeof item !== 'object') return json({ ok: false, error: '留言不存在（可能已被自动裁剪）' }, 404);

  if (body.name !== undefined) item.name = String(body.name).trim().slice(0, 16) || '匿名';
  if (body.text !== undefined) item.text = String(body.text).trim().slice(0, 200);
  if (!item.text) return json({ ok: false, error: '内容不能为空' }, 400);

  await env.MESSAGES.put(key, JSON.stringify(item));
  return json({ ok: true, message: { key, ...item } });
}

async function deleteMessage(env, body) {
  const key = String(body.key || '');
  if (!MSG_KEY_RE.test(key)) return json({ ok: false, error: '非法留言标识' }, 400);
  await env.MESSAGES.delete(key);
  return json({ ok: true });
}

/* ================= 余票管理（KV: COUNTERS，key ticket_stock） ================= */

const TICKET_TYPES = ['normal', 'premium', 'vip'];
const STOCK_KEY = 'ticket_stock';
const DEFAULT_STOCK = 80;

function normalizeStock(stock) {
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

async function readStock(env) {
  let raw = null;
  try { raw = await env.COUNTERS.get(STOCK_KEY, 'json'); } catch (e) { raw = null; }
  return normalizeStock(raw);
}

async function getStock(env) {
  return json({ ok: true, stock: await readStock(env), default: DEFAULT_STOCK });
}

async function setStock(env, body) {
  const showId = String(body.showId || '').trim();
  if (!showId) return json({ ok: false, error: '缺少场次 id' }, 400);
  const stock = await readStock(env);
  if (!stock[showId]) {
    stock[showId] = { normal: DEFAULT_STOCK, premium: DEFAULT_STOCK, vip: DEFAULT_STOCK };
  }

  // 允许单独设置某票种余量，也允许整体重设
  let changed = false;
  for (const type of TICKET_TYPES) {
    if (body[type] === undefined) continue;
    let n = parseInt(body[type], 10);
    if (!Number.isFinite(n)) return json({ ok: false, error: '余票必须是数字' }, 400);
    n = Math.max(0, Math.min(99999, n));
    stock[showId][type] = n;
    changed = true;
  }
  if (!changed) return json({ ok: false, error: '没有要修改的票种' }, 400);

  await env.COUNTERS.put(STOCK_KEY, JSON.stringify(stock));
  return json({ ok: true, stock, show: stock[showId] });
}

/* ================= 投稿墙管理（七牛云 rs 接口） ================= */

function qiniuEnv(env) {
  const AK = (env.QINIU_AK || '').trim();
  const SK = (env.QINIU_SK || '').trim();
  const BUCKET = (env.QINIU_BUCKET || '').trim();
  if (!AK || !SK || !BUCKET) {
    const err = new Error('七牛云环境变量未配置：请在 Cloudflare 后台给 guntaodance 项目添加 QINIU_AK / QINIU_SK / QINIU_BUCKET（与导航页项目一致）后重新部署');
    err.status = 500;
    throw err;
  }
  return { AK, SK, BUCKET, DOMAIN: (env.QINIU_DOMAIN || '').trim() || QINIU_DEFAULT_DOMAIN };
}

/* URL-safe Base64：二进制 → 保留 = 填充 */
function b64url(bytesOrString) {
  let bin = '';
  const bytes = typeof bytesOrString === 'string'
    ? new TextEncoder().encode(bytesOrString)
    : bytesOrString;
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');
}

/* 七牛条目编码：urlsafe_base64("bucket:key")，保留 = 填充（实测去掉 = 会报 InvalidArgs） */
function entry(bucket, key) {
  return b64url(bucket + ':' + key);
}

/* 七牛管理凭证（rs.qbox.me）：signingStr = "METHOD path?query\nHost: host\n\n"，HMAC-SHA1，保留 = */
async function qiniuAuth(AK, SK, method, pathAndQuery, host) {
  const signingStr = method + ' ' + pathAndQuery + '\nHost: ' + host + '\n\n';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SK),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingStr));
  return 'Qiniu ' + AK + ':' + b64url(new Uint8Array(sig));
}

async function listFiles(env) {
  const { AK, SK, BUCKET } = qiniuEnv(env);
  const all = [];
  let marker = '';
  for (let i = 0; i < 100; i++) {
    let path = '/list?bucket=' + encodeURIComponent(BUCKET) + '&limit=1000';
    if (marker) path += '&marker=' + encodeURIComponent(marker);
    const auth = await qiniuAuth(AK, SK, 'GET', path, 'rsf.qbox.me');
    const resp = await fetch('https://rsf.qbox.me' + path, { headers: { Authorization: auth } });
    if (!resp.ok) throw new Error('七牛列表失败 HTTP ' + resp.status);
    const data = await resp.json();
    if (data.items) all.push(...data.items);
    if (!data.marker) break;
    marker = data.marker;
  }
  const items = all
    .map(f => ({
      key: f.key,
      size: f.fsize || 0,
      mimeType: f.mimeType || '',
      putTime: f.putTime || 0,
      url: '/api/admin-file?key=' + encodeURIComponent(f.key),
    }))
    .sort((a, b) => b.putTime - a.putTime);
  return json({ ok: true, items });
}

async function deleteFile(env, body) {
  const { AK, SK, BUCKET } = qiniuEnv(env);
  const key = String(body.key || '');
  if (!FILE_KEY_RE.test(key)) return json({ ok: false, error: '非法文件名' }, 400);

  const path = '/delete/' + entry(BUCKET, key);
  const auth = await qiniuAuth(AK, SK, 'POST', path, 'rs.qbox.me');
  const resp = await fetch('https://rs.qbox.me' + path, {
    method: 'POST',
    headers: { Authorization: auth },
  });
  if (!resp.ok) {
    let msg = 'HTTP ' + resp.status;
    try { const d = await resp.json(); if (d && d.error) msg += ': ' + d.error; } catch (e) {}
    throw new Error('删除失败（' + msg + '）');
  }
  return json({ ok: true });
}

async function renameFile(env, body) {
  const { AK, SK, BUCKET } = qiniuEnv(env);
  const key = String(body.key || '');
  const newKey = String(body.newKey || '').trim();
  if (!FILE_KEY_RE.test(key) || !FILE_KEY_RE.test(newKey)) return json({ ok: false, error: '文件名只能包含字母、数字、下划线、点和短横线' }, 400);
  if (key === newKey) return json({ ok: true, newKey });

  const path = '/move/' + entry(BUCKET, key) + '/' + entry(BUCKET, newKey);
  const auth = await qiniuAuth(AK, SK, 'POST', path, 'rs.qbox.me');
  const resp = await fetch('https://rs.qbox.me' + path, {
    method: 'POST',
    headers: { Authorization: auth },
  });
  if (!resp.ok) {
    let msg = 'HTTP ' + resp.status;
    try { const d = await resp.json(); if (d && d.error) msg += ': ' + d.error; } catch (e) {}
    throw new Error('改名失败（' + msg + '），注意新文件名不能与已有文件重名');
  }
  return json({ ok: true, newKey });
}
