/* ============================================================
   棍涛舞团 · csy.html 后端 API
   Cloudflare Workers + KV
   ------------------------------------------------------------
   【部署步骤】(dash.cloudflare.com，约5分钟)

   1. 登录 Cloudflare 控制台 → 左侧 Workers 和 Pages → KV
      创建两个 KV 命名空间，名字随意，例如：
         GUNTAO_MESSAGES  （存留言）
         GUNTAO_COUNTERS  （存应援计数）

   2. Workers 和 Pages → 创建 → 创建 Worker
      把本文件全部代码粘贴进去

   3. 在 Worker 编辑页 → 设置(Setting) → 变量和机密 / 绑定(Bindings)
      点"添加绑定"，选 KV 命名空间，添加两个：
         Variable name 填 MESSAGES → 选择 GUNTAO_MESSAGES
         Variable name 填 COUNTERS → 选择 GUNTAO_COUNTERS

   4. 点部署(Deploy)，记下地址，形如：
         https://guntaodance-api.你的账号.workers.dev

   5. 打开 csy.html，搜索 "API_BASE"，
      把 const API_BASE = '';
      改成 const API_BASE = 'https://guntaodance-api.你的账号.workers.dev';
      （不要带结尾的斜杠 /）

   6. 保存 csy.html 并 git 提交推送即可。

   【接口说明】
     GET  /api/messages   获取留言列表（新→旧）
     POST /api/messages   提交留言，JSON: { "name": "昵称", "text": "内容" }
     GET  /api/support    获取应援总数
     POST /api/support    应援数 +1

   【说明】未部署后端时页面自动使用本地保存模式，功能不受影响。
   ============================================================ */

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

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  /* ---------- 留言 ---------- */
  if (url.pathname === '/api/messages') {
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
  }

  /* ---------- 应援计数 ---------- */
  if (url.pathname === '/api/support') {
    if (request.method === 'GET') {
      const count = parseInt(await COUNTERS.get('support')) || 0;
      return json({ ok: true, count });
    }
    if (request.method === 'POST') {
      const count = (parseInt(await COUNTERS.get('support')) || 0) + 1;
      await COUNTERS.put('support', String(count));
      return json({ ok: true, count });
    }
  }

  return json({ ok: false, error: 'not found' }, 404);
}
