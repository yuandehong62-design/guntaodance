/* 点播音乐代理 · 七牛对象转发
   路由: GET /api/music-file?key=music/xxxx.mp3

   为什么要代理：七牛测试域名（tn3b3bcgf.hn-bkt.clouddn.com）只支持 HTTP，
   在 HTTPS 页面里直接引用会被浏览器按混合内容拦截；且 Audio 拖动进度条需要 Range 支持。
   这里做同域转发，并把 Range 头透传给七牛，返回 206 让浏览器可以 seek。

   环境变量: QINIU_DOMAIN（可选，默认 tn3b3bcgf.hn-bkt.clouddn.com） */

const QINIU_DEFAULT_DOMAIN = 'tn3b3bcgf.hn-bkt.clouddn.com';
const KEY_RE = /^[A-Za-z0-9_.\-\/]{1,300}$/;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges'
};

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const key = String(url.searchParams.get('key') || '').replace(/^\/+/, '');
    if (!KEY_RE.test(key) || key.indexOf('..') >= 0) {
        return new Response('bad key', { status: 400, headers: CORS_HEADERS });
    }

    const DOMAIN = ((context.env && context.env.QINIU_DOMAIN) || '').trim() || QINIU_DEFAULT_DOMAIN;

    const init = {};
    const range = context.request.headers.get('Range');
    if (range) init.headers = { Range: range };

    let resp;
    try {
        resp = await fetch('http://' + DOMAIN + '/' + key, init);
    } catch (err) {
        return new Response('proxy error: ' + err.message, { status: 502, headers: CORS_HEADERS });
    }
    if (!resp.ok && resp.status !== 206) {
        return new Response('file not found', { status: 404, headers: CORS_HEADERS });
    }

    const headers = new Headers(CORS_HEADERS);
    headers.set('Content-Type', resp.headers.get('Content-Type') || 'audio/mpeg');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=86400');

    const copy = ['Content-Length', 'Content-Range', 'ETag', 'Last-Modified'];
    for (const h of copy) {
        const v = resp.headers.get(h);
        if (v) headers.set(h, v);
    }

    return new Response(resp.body, { status: resp.status, headers });
}

export async function onRequest(context) {
    const method = context.request.method;
    if (method === 'OPTIONS') return onRequestOptions();
    if (method === 'GET') return onRequestGet(context);
    return new Response('method not allowed', { status: 405, headers: CORS_HEADERS });
}
