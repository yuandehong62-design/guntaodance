/**
 * Folia 云同步服务器（Cloudflare Pages Functions 实现）
 *
 * 路由: /api/sync/*
 *   建议把 Folia 的 workerBaseUrl 填成: https://guntaodance.cc.cd/api/sync
 *
 * 实现 Folia 原生 Sync Server 协议（7 个端点）:
 *   GET  /health            健康检查
 *   GET  /state             同步状态 { schemaVersion, settingsUpdatedAt, themesUpdatedAt, themeCount }
 *   GET  /settings          读取云端设置（无数据返回 204）
 *   PUT  /settings          写入云端设置
 *   GET  /themes/manifest   主题分桶清单（256 桶，含 count / hash / updatedAt）
 *   POST /themes/put        上传主题（数组，最多 100 个/批）
 *   POST /themes/list       分页列出主题
 *   POST /themes/bucket     按桶取主题
 *
 * 存储: 复用 Pages 项目的 COUNTERS KV 命名空间
 *   sync:settings   -> { schemaVersion, updatedAt, data }
 *   sync:themes     -> [{ fingerprint, theme, source, updatedAt }, ...]
 *
 * 鉴权: 请求头 Authorization: Bearer <env.FOLIA_SYNC_TOKEN>
 *       （也支持 ?token=xxx 便于浏览器直接调试）
 */

const SCHEMA_VERSION = 1;
const BUCKET_COUNT = 256;
const MAX_THEMES = 2000;
const KEY_SETTINGS = 'sync:settings';
const KEY_THEMES = 'sync:themes';
const VALID_SOURCES = ['auto', 'fallback', 'edited', 'manual'];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
  'Access-Control-Max-Age': '86400'
};

/* ---------------- 基础工具 ---------------- */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS
    }
  });
}

function emptyResponse() {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ ok: false, error: message }, status);
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isIsoDate(v) {
  return typeof v === 'string' && v.length > 0 && !Number.isNaN(Date.parse(v));
}

/** FNV-1a 32 位哈希，与 Folia 客户端保持一致 */
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ---------------- 存储层 ---------------- */

function store(env) {
  const kv = env.COUNTERS;
  if (!kv) throw new Error('KV 命名空间 COUNTERS 未绑定');
  return kv;
}

async function readSettings(env) {
  const raw = await store(env).get(KEY_SETTINGS);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!isPlainObject(v) || v.schemaVersion !== SCHEMA_VERSION) return null;
    if (!isIsoDate(v.updatedAt) || !isPlainObject(v.data)) return null;
    return v;
  } catch (e) {
    return null;
  }
}

async function writeSettings(env, record) {
  await store(env).put(KEY_SETTINGS, JSON.stringify(record));
}

async function readThemes(env) {
  const raw = await store(env).get(KEY_THEMES);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

async function writeThemes(env, themes) {
  await store(env).put(KEY_THEMES, JSON.stringify(themes));
}

/* ---------------- 主题记录规范化 ---------------- */

function normalizeTheme(input) {
  if (!isPlainObject(input)) return null;
  const fingerprint = typeof input.fingerprint === 'string' ? input.fingerprint.trim() : '';
  if (!fingerprint) return null;
  if (!isIsoDate(input.updatedAt)) return null;
  const theme = isPlainObject(input.theme) ? input.theme : null;
  if (!theme) return null;
  const source = VALID_SOURCES.indexOf(input.source) >= 0 ? input.source : 'manual';
  return { fingerprint, theme, source, updatedAt: input.updatedAt };
}

/* ---------------- 状态 / 清单计算 ---------------- */

function computeState(settings, themes) {
  let themesUpdatedAt = null;
  for (const t of themes) {
    if (themesUpdatedAt === null || Date.parse(t.updatedAt) > Date.parse(themesUpdatedAt)) {
      themesUpdatedAt = t.updatedAt;
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    settingsUpdatedAt: settings ? settings.updatedAt : null,
    themesUpdatedAt,
    themeCount: themes.length
  };
}

/** 生成 256 个分桶的清单，算法与 Folia 客户端 lv() 一致 */
function computeManifest(themes) {
  const buckets = new Array(BUCKET_COUNT);
  for (let i = 0; i < BUCKET_COUNT; i += 1) {
    buckets[i] = { bucketId: i, count: 0, hash: 0, updatedAt: null };
  }
  for (const t of themes) {
    const id = fnv1a(t.fingerprint) % BUCKET_COUNT;
    const b = buckets[id];
    b.count += 1;
    if (!b.updatedAt || Date.parse(t.updatedAt) > Date.parse(b.updatedAt)) {
      b.updatedAt = t.updatedAt;
    }
    b.hash ^= fnv1a(`${t.fingerprint}\u0000${t.updatedAt}`);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    bucketCount: BUCKET_COUNT,
    buckets: buckets.map((b) => ({
      bucketId: b.bucketId,
      count: b.count,
      hash: b.count > 0 ? String(b.hash >>> 0) : '0',
      updatedAt: b.updatedAt
    }))
  };
}

/* ---------------- 请求处理 ---------------- */

function getToken(request, url) {
  const header = request.headers.get('Authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  const q = url.searchParams.get('token');
  return q ? q.trim() : '';
}

async function readJsonBody(request) {
  const text = await request.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // CORS 预检
  if (request.method === 'OPTIONS') return emptyResponse();

  // 鉴权
  const expected = typeof env.FOLIA_SYNC_TOKEN === 'string' ? env.FOLIA_SYNC_TOKEN.trim() : '';
  if (!expected) {
    return errorResponse('服务端未配置 FOLIA_SYNC_TOKEN 环境变量', 503);
  }
  if (getToken(request, url) !== expected) {
    return errorResponse('未授权：authToken 不正确', 401);
  }

  // 解析子路径: /api/sync/themes/put -> "themes/put"
  let sub = url.pathname.replace(/^\/api\/sync\/?/, '').replace(/\/+$/, '');
  if (sub === 'api/sync') sub = '';
  const seg = sub === '' ? [] : sub.split('/').filter(Boolean);

  try {
    // /health
    if (seg.length === 1 && seg[0] === 'health') {
      if (request.method !== 'GET') return errorResponse('方法不允许', 405);
      return jsonResponse({ ok: true, service: 'folia-sync', schemaVersion: SCHEMA_VERSION, time: new Date().toISOString() });
    }

    // /state
    if (seg.length === 1 && seg[0] === 'state') {
      if (request.method !== 'GET') return errorResponse('方法不允许', 405);
      const settings = await readSettings(env);
      const themes = await readThemes(env);
      return jsonResponse(computeState(settings, themes));
    }

    // /settings
    if (seg.length === 1 && seg[0] === 'settings') {
      if (request.method === 'GET') {
        const settings = await readSettings(env);
        if (!settings) return emptyResponse();
        return jsonResponse(settings);
      }
      if (request.method === 'PUT' || request.method === 'POST') {
        const body = await readJsonBody(request);
        if (!isPlainObject(body)) return errorResponse('请求体必须是 JSON 对象');
        const updatedAt = isIsoDate(body.updatedAt) ? body.updatedAt : new Date().toISOString();
        const data = isPlainObject(body.data) ? body.data : null;
        if (!data) return errorResponse('缺少 data 对象');
        await writeSettings(env, { schemaVersion: SCHEMA_VERSION, updatedAt, data });
        return jsonResponse({ ok: true, updatedAt });
      }
      return errorResponse('方法不允许', 405);
    }

    // /themes/*
    if (seg.length === 2 && seg[0] === 'themes') {
      const action = seg[1];

      if (action === 'manifest') {
        if (request.method !== 'GET') return errorResponse('方法不允许', 405);
        const themes = await readThemes(env);
        return jsonResponse(computeManifest(themes));
      }

      if (action === 'put') {
        if (request.method !== 'POST' && request.method !== 'PUT') return errorResponse('方法不允许', 405);
        const body = await readJsonBody(request);
        if (!isPlainObject(body) || !Array.isArray(body.themes)) {
          return errorResponse('请求体格式应为 { themes: [...] }');
        }
        const incoming = body.themes.map(normalizeTheme).filter(Boolean);
        if (incoming.length === 0) return jsonResponse({ ok: true, stored: 0 });

        const existing = await readThemes(env);
        const map = new Map(existing.map((t) => [t.fingerprint, t]));
        for (const t of incoming) {
          const prev = map.get(t.fingerprint);
          if (!prev || Date.parse(t.updatedAt) >= Date.parse(prev.updatedAt)) {
            map.set(t.fingerprint, t);
          }
        }
        let merged = Array.from(map.values());
        if (merged.length > MAX_THEMES) {
          merged.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
          merged = merged.slice(0, MAX_THEMES);
        }
        await writeThemes(env, merged);
        return jsonResponse({ ok: true, stored: incoming.length, themeCount: merged.length });
      }

      if (action === 'list') {
        if (request.method !== 'POST') return errorResponse('方法不允许', 405);
        const body = (await readJsonBody(request)) || {};
        const limitRaw = Number(body.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 1000) : 500;
        const cursorRaw = body.cursor;
        const start = typeof cursorRaw === 'string' ? parseInt(cursorRaw, 10) : 0;
        const from = Number.isFinite(start) && start > 0 ? start : 0;
        const themes = await readThemes(env);
        const page = themes.slice(from, from + limit);
        const next = from + limit < themes.length ? String(from + limit) : null;
        return jsonResponse({ themes: page, cursor: next });
      }

      if (action === 'bucket') {
        if (request.method !== 'POST') return errorResponse('方法不允许', 405);
        const body = (await readJsonBody(request)) || {};
        const ids = Array.isArray(body.bucketIds) ? body.bucketIds.filter((n) => Number.isInteger(n)) : [];
        if (ids.length === 0) return jsonResponse({ themes: [] });
        const wanted = new Set(ids.map((n) => n % BUCKET_COUNT));
        const themes = await readThemes(env);
        const picked = themes.filter((t) => wanted.has(fnv1a(t.fingerprint) % BUCKET_COUNT));
        return jsonResponse({ themes: picked });
      }

      return errorResponse('未知的 /themes 子路径: ' + action, 404);
    }

    // 根路径：给出用法提示
    if (seg.length === 0) {
      return jsonResponse({
        ok: true,
        service: 'folia-sync',
        schemaVersion: SCHEMA_VERSION,
        endpoints: ['GET /health', 'GET /state', 'GET|PUT /settings', 'GET /themes/manifest', 'POST /themes/put', 'POST /themes/list', 'POST /themes/bucket']
      });
    }

    return errorResponse('未知路径: ' + url.pathname, 404);
  } catch (err) {
    return jsonResponse({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
