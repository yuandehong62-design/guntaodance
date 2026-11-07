/* 点播歌单 · 公开只读接口
   路由: GET /api/music

   数据来源: COUNTERS KV，key = music_list
   结构: { version:1, updatedAt:ISO, tracks:[ { id, name, artist, src, type, lrc } ] }
     type = 'repo'  时 src 为站点内相对路径，例如 '13.mp3'
     type = 'qiniu' 时 src 为七牛对象 key，例如 'music/1752_abcd.mp3'

   管理入口: https://funthing.me/admin → 🎵 音乐管理
   若 KV 为空，返回 tracks:null，前端使用 csy.html 内置清单兜底。 */

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges'
};

const MUSIC_KEY = 'music_list';
const MAX_TRACKS = 300;

function json(data, status) {
    return new Response(JSON.stringify(data), {
        status: status || 200,
        headers: Object.assign({
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        }, CORS_HEADERS)
    });
}

function normalizeTrack(t) {
    if (!t || typeof t !== 'object') return null;
    const src = String(t.src || '').trim();
    if (!src || src.length > 300) return null;
    return {
        id: String(t.id || src).slice(0, 160),
        name: String(t.name || '').trim().slice(0, 120),
        artist: String(t.artist || '').trim().slice(0, 120),
        src: src,
        type: t.type === 'qiniu' ? 'qiniu' : 'repo',
        lrc: String(t.lrc || '').trim().slice(0, 300)
    };
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
    const env = context.env || {};
    if (!env.COUNTERS) {
        return json({ ok: false, error: 'COUNTERS KV 未绑定' }, 503);
    }

    let data = null;
    try {
        data = await env.COUNTERS.get(MUSIC_KEY, 'json');
    } catch (e) {
        data = null;
    }

    if (!data || !Array.isArray(data.tracks)) {
        return json({ ok: true, tracks: null, updatedAt: null });
    }

    const tracks = data.tracks.slice(0, MAX_TRACKS).map(normalizeTrack).filter(Boolean);
    return json({ ok: true, tracks: tracks, updatedAt: data.updatedAt || null });
}

export async function onRequest(context) {
    const method = context.request.method;
    if (method === 'OPTIONS') return onRequestOptions();
    if (method === 'GET') return onRequestGet(context);
    return json({ ok: false, error: 'method not allowed' }, 405);
}
