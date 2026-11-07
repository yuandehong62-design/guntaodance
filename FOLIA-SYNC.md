# Folia 云同步服务器 · 配置说明

> 让 Folia 的播放器设置（主题 / 字体 / 可视化 / 布局等 44 项）在所有设备间保持一致。

---

## 一、服务器地址（二选一）

| 地址 | 状态 | 说明 |
|---|---|---|
| `https://guntaodance.pages.dev/api/sync` | ✅ **可用，推荐** | 实测直连稳定（5/5 成功，400~600ms） |
| `https://guntaodance.cc.cd/api/sync` | ⚠️ 暂不可用 | 该域名开了 **"I'm Under Attack" 模式**，跨域请求会被 Cloudflare 质询拦截（返回 403） |

> 如果你想用 `guntaodance.cc.cd` 这个地址，需要先去 Cloudflare → 该域名 → **Security → Settings**，把 **Security Level** 从 `I'm Under Attack` 改回 `High` 或 `Medium`（除非你现在真的正在被攻击）。

## 二、访问令牌

```
tVSNEUra-1xMKUcsROQsvuLIl4jRUThY
```

- 存放在 Cloudflare Pages 项目 `guntaodance` 的环境变量 `FOLIA_SYNC_TOKEN`（类型 secret_text）
- 想换令牌：改这个环境变量后重新部署，然后在 Folia 里填新令牌

## 三、在 Folia 里怎么填

1. 打开 `https://music.guntaodance.cc.cd`
2. 进入 **设置（Settings）**
3. 找到 **Sync server settings**（同步服务器设置）
4. 填：
   - **Server URL / workerBaseUrl**：`https://guntaodance.pages.dev/api/sync`
   - **Auth token**：`tVSNEUra-1xMKUcsROQsvuLIl4jRUThY`
5. 打开 **启用（Enabled）** 开关
6. 点 **Test connection** / 同步测试，应显示连接成功

> 配置会存在浏览器 localStorage 的 `folia_sync_config_v1` 里，格式：
> ```json
> {"provider":"sync-server","enabled":true,"workerBaseUrl":"https://guntaodance.pages.dev/api/sync","authToken":"..."}
> ```

## 四、同步什么

**同步的（44 项设置）**：
跟随系统主题、可视化模式、随机可视化、背景模式、背景不透明度、可视化不透明度、
歌词字体（字体/字号/字重/回退字体）、字幕相关设置、各种可视化调音参数（classic / cadenza /
partita / fume / claddagh / cappella / tilt / diorama / monet / nomand / latent / sora /
pendolo / sonnet / tempera / lumiere）、智能节拍、URL 背景列表、首页布局、3D 卡片样式。

**另外同步**：自定义主题（256 个分桶存储）。

**不同步**：音乐源账号登录（Navidrome 等第三方音乐服务）、本地歌曲库、播放历史。

## 五、接口一览（服务器已实现的 7 个端点）

| 端点 | 方法 | 用途 |
|---|---|---|
| `/health` | GET | 健康检查，返回 `{ok:true}` |
| `/state` | GET | 返回 `{schemaVersion, settingsUpdatedAt, themesUpdatedAt, themeCount}` |
| `/settings` | GET | 读取云端设置；无数据返回 **204** |
| `/settings` | PUT | 写入设置 `{schemaVersion, updatedAt, data}` |
| `/themes/manifest` | GET | 256 个分桶的 `{bucketId, count, hash, updatedAt}` |
| `/themes/put` | POST | 上传主题 `{themes:[...]}` |
| `/themes/list` | POST | 分页列出主题 `{cursor, limit}` |
| `/themes/bucket` | POST | 按桶取主题 `{bucketIds:[...]}` |

- 鉴权：`Authorization: Bearer <FOLIA_SYNC_TOKEN>`
- CORS：全开（`Access-Control-Allow-Origin: *`），支持跨域

## 六、存储

复用 Pages 项目已绑定的 **COUNTERS** KV 命名空间（`5cbd30d1b17842728a89f5248db0a1a4`）：

| KV key | 内容 |
|---|---|
| `sync:settings` | `{schemaVersion:1, updatedAt, data:{44个字段}}` |
| `sync:themes` | `[{fingerprint, theme, source, updatedAt}, ...]`（上限 2000 条） |

## 七、代码位置

- `functions/api/sync/[[path]].js` —— Cloudflare Pages Functions 实现（catch-all 路由，处理 `/api/sync/*`）
- 提交：`bf18136 新增Folia云同步服务器(Cloudflare Pages Functions)`

## 八、实测记录

| 测试项 | 结果 |
|---|---|
| `GET /health` | ✅ `{"ok":true,"service":"folia-sync","schemaVersion":1}` |
| `GET /state`（空） | ✅ `{"schemaVersion":1,"settingsUpdatedAt":null,"themesUpdatedAt":null,"themeCount":0}` |
| `GET /settings`（空） | ✅ HTTP 204 |
| `PUT /settings` → `GET /settings` | ✅ 写入读出数据一致 |
| `POST /themes/put` ×2 | ✅ `{"ok":true,"stored":2,"themeCount":2}` |
| `GET /themes/manifest` | ✅ 256 桶，命中桶 186 / 189，hash 正确 |
| `POST /themes/list` | ✅ 返回 2 条，cursor=null |
| `POST /themes/bucket` | ✅ 按桶返回对应主题 |
| 无令牌访问 | ✅ HTTP 401 |
| CORS 预检 OPTIONS | ✅ 204 + 完整 CORS 头 |
| 根路径 `/api/sync` | ✅ 返回端点清单 |

> 测试数据已全部清除，KV 已恢复为空（`settingsUpdatedAt: null`、`themeCount: 0`）。
