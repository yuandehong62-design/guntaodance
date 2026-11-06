/* 管理后台 · 投稿墙文件预览/下载代理
   路由: /api/admin-file?key=<文件名>
   与导航页 sharewall-file.js 同理：七牛测试域名仅 HTTP，经同域 HTTPS 代理展示/下载
   环境变量: QINIU_DOMAIN（可选，默认 tn3b3bcgf.hn-bkt.clouddn.com） */

const QINIU_DEFAULT_DOMAIN = 'tn3b3bcgf.hn-bkt.clouddn.com';
const KEY_RE = /^[A-Za-z0-9_.\-]{1,200}$/;

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const key = String(url.searchParams.get('key') || '');
  if (!KEY_RE.test(key)) {
    return new Response('bad key', { status: 400 });
  }

  const DOMAIN = (context.env.QINIU_DOMAIN || '').trim() || QINIU_DEFAULT_DOMAIN;
  try {
    const resp = await fetch('http://' + DOMAIN + '/' + key);
    if (!resp.ok) {
      return new Response('file not found', { status: 404 });
    }

    const headers = new Headers();
    const ct = resp.headers.get('Content-Type');
    if (ct) headers.set('Content-Type', ct);
    headers.set('Content-Disposition', 'inline; filename="' + key + '"');
    headers.set('Cache-Control', 'public, max-age=3600');
    headers.set('Access-Control-Allow-Origin', '*');
    const cl = resp.headers.get('Content-Length');
    if (cl) headers.set('Content-Length', cl);

    return new Response(resp.body, { status: resp.status, headers });
  } catch (err) {
    return new Response('proxy error: ' + err.message, { status: 502 });
  }
}
