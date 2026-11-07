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

### 两种进入入口

- **入口 A（推荐）**：按 `Ctrl + K` 打开命令面板 → 输入 `同步` 或 `云同步` → 选 **Sync server settings**
- **入口 B**：设置页 → **选项（Options）** → 往下找 **同步 / Sync** 这一组

### 填写步骤

1. 打开 `https://music.guntaodance.cc.cd`
2. 打开 **Sync server settings**（同步服务器设置）
3. 把 **开关（Enable）** 打开 —— *只有打开后，下面两个输入框才会出现*
4. 填：
   - **Server URL**（输入框里的灰字提示是 `https://folia-sync.example.workers.dev`）：
     ```
     https://guntaodance.pages.dev/api/sync
     ```
   - **Auth token**（密码框）：
     ```
     tVSNEUra-1xMKUcsROQsvuLIl4jRUThY
     ```
5. 点面板里的 **Test**（测试）按钮 —— 应提示 "Sync test succeeded"
6. 点 **Save**（保存）—— *注意：不点 Save 不会生效*
7. 之后用这两个按钮：
   - **Sync now**（立即同步）→ 只同步主题
   - **Sync visual settings**（同步可视化设置）→ 同步那 44 项设置（会双向：拉取云端 + 推送本地）

> 💡 填完记得 **Save**，然后建议先点 **Sync visual settings** 做第一次全量同步。

> 配置存在浏览器 localStorage 的 `folia_sync_config_v1` 里，格式：
> ```json
> {"provider":"sync-server","enabled":true,"workerBaseUrl":"https://guntaodance.pages.dev/api/sync","authToken":"..."}
> ```

### 想验证服务器通不通？（浏览器直接打开）

把下面两条地址粘到浏览器地址栏，看到 JSON 就说明服务器正常：

- 健康检查：
  `https://guntaodance.pages.dev/api/sync/health?token=tVSNEUra-1xMKUcsROQsvuLIl4jRUThY`
  → `{"ok":true,"service":"folia-sync","schemaVersion":1,...}`
- 当前云端状态：
  `https://guntaodance.pages.dev/api/sync/state?token=tVSNEUra-1xMKUcsROQsvuLIl4jRUThY`
  → `{"schemaVersion":1,"settingsUpdatedAt":...,...,"themeCount":N}`

> `settingsUpdatedAt` 是 `null` 表示云端还没存过设置；同步一次后就会变成时间戳。

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

### 端到端联调（按 Folia 客户端真实逻辑复刻，17 项全通过）

| 测试项 | 说明 | 结果 |
|---|---|---|
| 连接测试 `Rie()` | health + state 组合校验 | ✅ |
| 读取 `/state` | 解析出 `schemaVersion/settingsUpdatedAt/themesUpdatedAt/themeCount` | ✅ |
| 空库 `/settings` | 返回 204，客户端解析为 `null` | ✅ |
| 推送 44 项设置 | `PUT /settings` | ✅ |
| 回读设置 | `updatedAt` 一致、44 项逐一比对全一致 | ✅ |
| 上传 3 个主题 | `POST /themes/put` | ✅ |
| `themeCount` | 服务端计数正确 = 3 | ✅ |
| `/themes/manifest` | 解析成功，`bucketCount=256` | ✅ |
| 分桶 hash | 服务端算法与客户端 FNV-1a 逐桶比对**完全一致** | ✅ |
| 桶内主题合计 | 3 个非空桶，合计 3 | ✅ |
| 按桶下载 | `POST /themes/bucket` 拉到 3 条 | ✅ |
| `themes/list` 分页 | limit=2 → 返回 2 条 + cursor=2 | ✅ |
| 第二页 | 取到剩余 1 条 | ✅ |
| 错误令牌 | 返回 401 | ✅ |
| CORS 预检 | 从 `music.guntaodance.cc.cd` 跨域，OPTIONS→204，ACAO=`*` | ✅ |
| 跨域真实请求 | 带 Origin 头 GET 各端点，均 200 + ACAO=`*` | ✅ |
| 直连稳定性 | `guntaodance.pages.dev` 连续 5 次，5/5 成功，热身后 400~600ms | ✅ |

> 测试数据已全部清除，KV 已恢复为空（`settingsUpdatedAt: null`、`themeCount: 0`）。

### 已知注意事项

- **KV 最终一致性**：删除/写入后各边缘节点有几秒延迟。用 API 手工清空 KV 后，立刻读 `/state` 可能还看到旧值，等 5~10 秒即可。
- **`guntaodance.cc.cd` 不可用**：该 zone 开了 *I'm Under Attack*，跨域会 403。要用这个域名，需去 Cloudflare 把 Security Level 调回 High/Medium。
