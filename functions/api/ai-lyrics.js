/* 棍涛舞团 · AI 歌词代理（Cloudflare Pages Functions）
   路由: /api/ai-lyrics
   作用：浏览器直连 token.sensenova.cn 时，其 OPTIONS 预检返回 404（CORS 预检失败，
   导致前端 fetch 报 "Failed to fetch"）。此函数在服务端代发请求，彻底避开浏览器 CORS 预检，
   AI Key 也只存服务端，不再暴露到前端代码里。
   请求体: { name, artist }
   返回:   { ok: true, content } 或 { ok: false, error } */

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

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed' }, 405);
  }

  let body;
  try { body = await request.json(); } catch (e) {
    return json({ ok: false, error: 'bad request' }, 400);
  }

  const name = String(body.name || '').trim().slice(0, 120);
  const artist = String(body.artist || '').trim().slice(0, 120);
  if (!name) return json({ ok: false, error: 'missing song name' }, 400);

  // 优先读环境变量 AI_API_KEY；未配置时回退到内置值
  const AI_API_KEY = context.env.AI_API_KEY || 'sk-MJWr35l77exhpEW3bNb6x2eosbRxFY9M';
  const AI_MODEL = 'sensenova-6.8-flash-lite';

  const prompt = [
    '你是一名专业的歌词转写助手。',
    '请为歌曲《' + name + '》' + (artist ? '（演唱者：' + artist + '）' : '') + '输出完整歌词，',
    '并严格按 LRC 歌词格式逐行输出，每行形如 [mm:ss.xx] 歌词文本。',
    '时间轴要均匀分布（约每行 3~6 秒），尽量贴合原曲演唱顺序。',
    '只输出 LRC 内容本身，不要任何解释、标题、代码块标记。',
    '若不确定具体歌词，请根据歌名与风格生成通顺、贴合意境的歌词，仍按 LRC 格式输出。'
  ].join('');

  try {
    const r = await fetch('https://token.sensenova.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + AI_API_KEY,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.6,
        max_tokens: 4096,
        // 关键：关闭推理（此模型默认把 token 花在内部思考上，导致 content 为空）
        reasoning_effort: 'none',
      }),
    });

    if (!r.ok) {
      let detail = 'HTTP ' + r.status;
      try { const j = await r.json(); detail = (j && (j.error && j.error.message || j.message)) || detail; } catch (e) {}
      return json({ ok: false, error: detail }, r.status);
    }

    const data = await r.json();
    // 兼容不同模型返回结构：优先 content，其次 reasoning（有些模型把文本放 reasoning）
    const msg = (data && data.choices && data.choices[0] && data.choices[0].message) || {};
    const content = (msg.content || '').trim();
    if (!content) return json({ ok: false, error: 'AI 返回为空' }, 502);

    return json({ ok: true, content });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 502);
  }
}
