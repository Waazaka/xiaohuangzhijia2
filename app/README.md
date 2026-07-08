# HomeFrame · 模块化个人家庭应用（参考实现）

本地部署、数据自有的模块化家庭应用参考实现。**零外部依赖**，仅需 Node.js 即可运行。

> 配套设计文档见 `../design/架构设计.md`（部署拓扑、同步协议、模块框架、五大模块规格、安全与扩展性）。

## 运行

```bash
cd app
node server.js            # 默认端口 8787，可用 PORT=9000 node server.js 修改
```

浏览器打开 `http://localhost:8787` → 注册账号 → 创建/加入家庭 → 使用各模块。

## 已实现能力（对照需求）

| 需求 | 实现 |
|------|------|
| 本地服务器后端 | Node 内置 `http`，JSON 持久化（`app/data/store.json`） |
| 四种连接方式 | 前端连接地址可切换（局域网 / Cloudflare 域名 / VPS 反代 / 离线），同步协议统一，差异仅在 URL |
| 登录即同步 + 每 10 秒持续同步 | 登录后 `triggerSync()`；`setInterval(...,10000)` 轮询 pull+push |
| 离线本地保存 + 恢复后自动同步 | 离线模式写入本地库与 `outbox` 队列，恢复连接自动 push+pull |
| 同账户多设备 | 设备表 + `deviceId`，同步按账户维度广播 |
| 可组合应用看板 | 模块注册表 + 每用户 `dashboard.layout`，「⚙ 看板」自由增删模块 |
| 家庭模块 | 创建家庭、邀请码加入、成员列表 |
| 账本模块 | 个人账本（批量导入）+ 家庭账本；每笔明细 `shareToFamily`（默认 true）自动同步到家庭账本；个人仅本人可见 |
| 备忘录模块 | 个人 / 家庭相互独立，个人私密 |
| 任务模块 | 定时(`due`)、重复(`repeat`：每天/每周/每月)、分配给家庭成员 |
| 推送模块 | 任务分配、家庭备忘录/任务变更自动生成仅接收者可见的推送；支持浏览器通知 |
| 良好扩展性 | 新增模块 = 在 `app/modules/` 声明集合/scope/权限/UI，核心零改动 |

## 目录结构

```
app/
  server.js          HTTP 服务与路由（含 PWA 资源路由）
  lib/store.js       本地存储
  lib/auth.js        账户/会话/设备/密码哈希
  lib/permissions.js 基于 scope 的读写权限
  lib/sync.js        同步引擎（操作日志 + LWW 冲突）
  lib/modules.js     模块注册表
  modules/           family / ledger / memo / task / push
  public/            index.html / styles.css / app.js（看板前端）
    manifest.webmanifest   PWA 清单
    service-worker.js      离线应用壳缓存
    icon.svg               PWA 图标
  test_smoke.js      端到端冒烟测试
  data/              运行时数据（自动生成，可删除）
```

## 打包为可安装应用（PWA）

已内置 PWA 支持，零原生构建即可安装到桌面与手机主屏：

- `public/manifest.webmanifest`：应用名、图标、`standalone` 全屏展示。
- `public/service-worker.js`：缓存应用壳（首页/JS/CSS/图标），**断网也能打开**；API 读取网络优先、失败回退缓存。
- `public/icon.svg`：单一 SVG 图标（同时用于 `any` 与 `maskable`）。

**安装方式：**
- 桌面 Chrome / Edge：地址栏右侧「安装应用」图标，或菜单 → 应用 → 安装 HomeFrame。
- 手机：浏览器打开后「添加到主屏幕」，即生成可离线启动的 App 图标。

> 图标目前是 SVG。如需上架应用商店或追求最大兼容性，可用工具（如 `pwa-asset-generator`）把 `icon.svg` 转成 192/512 的 PNG，并补充到 manifest 的 `icons` 数组。

## 手机原生壳（Capacitor，真离线）

PWA 的离线依赖 Service Worker，而 SW 只在 `https://` / `localhost` 注册；纯局域网 HTTP 下离线打不开。要"零网络首次启动即可用"，用 Capacitor 把前端打进原生 App 包：UI 与本地数据随包安装，不依赖 SW/HTTPS。详见 `app/mobile/README.md`。

```bash
cd app/mobile && npm install && npx cap add android && npx cap sync && npx cap open android
```

前端已做原生适配：`window.Capacitor` 存在时不再把 `location.origin` 当服务器（那是 App 本地地址），而改用「连接设置」里填写的家庭服务器地址；并自动感知网络断/通。

## CORS

`server.js` 已对 API 与静态资源加 `Access-Control-Allow-Origin`（回显请求方 Origin），支持原生 App / 跨域前端调用。生产如需收紧，可把 `corsHeaders()` 改为固定白名单。

## API 摘要

- `POST /api/auth/register|login` · `GET /api/me`
- `POST /api/family/create|join`
- `GET /api/modules` · `POST /api/dashboard/layout`
- `POST /api/sync/pull {since}` · `POST /api/sync/push {ops}`

## 如何新增一个模块

1. 在 `app/modules/` 新建 `myplugin.js`：
   ```js
   module.exports = {
     id: 'myplugin', name: '我的模块', icon: '🌟',
     collections: ['my_personal', 'my_family'],
     visibility: { my_personal: 'personal', my_family: 'family' },
     serverOnlyCollections: [],
     hooks: { /* 可选：写入后触发其他操作（如推送） */ }
   };
   ```
2. 在 `app/lib/modules.js` 注册：`const my = require('../modules/myplugin');` 并加入 `all`。
3. 前端 `app/public/app.js` 增加 `renderMyplugin(c)` 并在 `renderCurrent()` 分发。
4. 无需改动同步/权限/存储核心。

## 说明与边界

- 参考实现以**清晰演示架构**为目标：使用 JSON 文件存储、LWW 整实体冲突、推送走服务端钩子生成。
- 生产化建议（详见设计文档）：存储换 SQLite/Postgres；轮询换 WebSocket/SSE；个人/家庭敏感集合做端到端加密；家庭关系建议通过同步集合统一管理（本实现用 `/api/me` 返回家庭元信息以简化）。
- 推送目前为应用内消息 + 浏览器通知；如需系统级推送，可在服务端接 Web Push / 各平台推送网关。
