# 模块化个人家庭应用 · 系统架构设计

> 版本：v1.0.0 ｜ 场景：本地服务器后端 + 多连接方式 + 可组合看板
> 核心目标：一套**可离线、可多端、可组合模块**的家庭数据中心，部署在用户自有服务器上，数据主权归用户。

---

## 项目门户

**HomeFrame** 是一个模块化个人家庭应用：后端部署在你自家的服务器（NAS / 迷你主机 / 树莓派），前端是组合式看板，家庭成员多设备实时同步，断网也能用。

### ✨ 核心特性
- **自托管、数据主权归你**：后端跑在自己机器，不在任何第三方云。
- **四种连接自由切换**：局域网直连 / Cloudflare 隧道 / VPS 反代 / 离线本地——差异只在「连哪个 URL」，同步协议统一。
- **多设备实时同步**：登录即同步，每 10 秒持续同步，离线写入本地队列，恢复后自动回放。
- **组合式看板**：自由搭模块（看板+账本、+备忘录、+任务…），新增模块零侵入核心。
- **五大模块**：家庭 / 账本（个人+家庭）/ 备忘录（个人+家庭）/ 任务（定时+重复+分配）/ 推送。
- **多形态客户端**：可装成 PWA，也能打包成手机原生 App（Capacitor）。

### 🚀 快速开始

**① Web 版（看效果，零依赖）**
```bash
cd app
node server.js          # 打开 http://localhost:8787
```
> Windows 可直接双击 `app/start-web.cmd`。

**② 装成 PWA（桌面 / 手机「添加到主屏幕」）**
手机需用 **HTTPS** 访问（如 Cloudflare 隧道）才能注册 Service Worker 实现离线；局域网纯 HTTP 下 PWA 离线不可用。

**③ 打包手机原生 App（真正离线可用，推荐手机使用）**
```bash
cd app/mobile
node build.js           # 一键出 APK（或双击 build.cmd）
```
首次需装 **JDK 17+** 与 **Android SDK**（脚本检测到缺哪个会停下给链接）。详见 [`app/mobile/README.md`](app/mobile/README.md)。

### 📁 目录结构
```
.
├── design/架构设计.md        # 详细架构设计（同步引擎、权限、模块框架）
├── app/
│   ├── server.js             # 后端 HTTP 服务 + 同步引擎 + 路由（零外部依赖）
│   ├── lib/                  # store / auth / permissions / sync / modules
│   ├── modules/              # family / ledger / memo / task / push
│   ├── public/               # 看板前端 SPA（含 PWA manifest + service worker）
│   ├── mobile/               # Capacitor 手机原生壳 + 一键构建脚本
│   └── README.md             # 后端与前端运行说明
└── README.md                 # 本文件（项目门户 + 架构总览）
```

### 🔗 文档
- 详细架构设计 → [`design/架构设计.md`](design/架构设计.md)
- 后端 / 前端运行 → [`app/README.md`](app/README.md)
- 手机原生打包 → [`app/mobile/README.md`](app/mobile/README.md)
- 版本发布：**[`v1.0.0`](https://github.com/Waazaka/xiaohuangzhijia2/releases/tag/v1.0.0)**

---

## 1. 总体定位与需求映射

| 需求 | 设计要点 |
|------|----------|
| 后端部署在本地服务器 | 单进程 Node 服务跑在家庭 NAS / 迷你主机 / 树莓派；数据落本地磁盘 |
| 四种连接方式 | 统一**同步协议**，差异只在「客户端连接哪个 URL」：局域网直连 / Cloudflare 隧道 / VPS 反代 / 离线本地 |
| 多家庭成员 | `family` 实体 + 成员关系 + 角色；家庭级集合按 `familyId` 共享 |
| 登录即同步 + 每 10 秒持续同步 | 登录后立刻 `pull`；前端 `setInterval(10000)` 轮询；离线时本地落盘，恢复连接自动 `push`+`pull` |
| 同账户多设备 | 设备表 + `deviceId`；同步按账户维度，所有设备共享同一条操作流 |
| 可自定义应用看板 | **模块注册表** + 每用户 `dashboard.layout`；核心 `AppBoard` 组件按布局渲染 |
| 可扩展新增模块 | 模块即「声明式插件」：定义集合、可见性 scope、权限、UI 组件即可接入 |

---

## 2. 部署拓扑与四种连接方式

所有连接方式的本质区别**只是客户端连的地址不同**，后端同步协议完全一致。客户端持有一份「连接配置」，可排序/手动切换：

```
┌────────────┐   ① LAN        ┌──────────────────────┐
│  手机/PC   │ ──────────────▶│  家庭服务器 (局域网IP) │
│  (客户端)  │                │  192.168.x.x:8787     │
├────────────┤   ② Cloudflare ├──────────────────────┤
│            │ ──────────────▶│  cloudflared 隧道      │──▶ 本地服务
│            │  home.example  │  (无公网IP也能用)      │
├────────────┤   ③ VPS 反代   ├──────────────────────┤
│            │ ──────────────▶│  VPS:Nginx/如 Caddy   │──▶ 本地服务
│            │  vps.example   │   (有公网IP/域名)      │
├────────────┤   ④ 离线       ├──────────────────────┤
│            │  本地落盘 +队列 │  仅本地存储，停同步    │
└────────────┘                └──────────────────────┘
```

- **① 局域网同步**：客户端直连 `http://<lan-ip>:8787`。延迟最低，家中首选。
- **② Cloudflare + 个人域名中转**：家庭服务器装 `cloudflared`，建立到 Cloudflare 的**出站**隧道，域名 `home.example.com` 指向隧道。优点：**无需公网 IP、无需开放端口、自带 TLS**。
- **③ 代理 VPS 直连**：自有 VPS 上 Nginx/Caddy 反向代理到家庭服务器（可用 `frp` / `wireguard` 打通，或家庭服务器主动建隧道）。适合需要固定公网入口、可加 WAF 的场景。
- **④ 离线**：客户端检测所有端点不可达 → 切「离线模式」，所有写操作进**本地队列 + 本地库**；任一端点恢复 → 自动 `push` 队列并 `pull` 增量。

> 传输层统一用 HTTPS（②/③ 天然 TLS；① 局域网建议自签证书或仅内网使用）。客户端 `transport` 抽象：`connect(endpoint)` 返回统一请求函数，四种方式只是 endpoint 不同。

---

## 3. 同步引擎（系统心脏）

采用 **操作日志（Operation Log）+ 服务端权威状态 + 客户端乐观更新** 模型，天然支持离线、多设备、冲突合并。

### 3.1 数据基石：实体（Entity）

每个业务记录是一个 Entity：

```jsonc
{
  "id": "uuid",            // 全局唯一，客户端生成
  "rev": 1,                // 修订号，每次变更 +1
  "data": { ... },         // 业务字段（看板/记账/备忘录…）
  "deleted": false,        // 软删除，便于同步传播
  "createdBy": "accountId",
  "ts": 1710000000000,     // 最后修改时间戳（冲突裁决依据）
  "scope": "personal|family|global",
  "scopeId": "ownerId | familyId | entityId"
}
```

### 3.2 操作（Op）—— 同步的最小单位

任何写操作都转化为一条 Op 并追加到服务端 `ops` 日志：

```jsonc
{
  "opId": "uuid",
  "entityId": "uuid",
  "collection": "ledger_family",   // 所属集合（=模块决定）
  "scope": "family",
  "scopeId": "familyId",
  "baseRev": 2,                     // 客户端基于的版本（冲突检测）
  "entity": { "rev":3, "data":{...}, "ts":..., "deleted":false },
  "serverSeq": 0,                   // 服务端落库时分配，单调递增
  "deviceId": "uuid"
}
```

### 3.3 三态存储

- **服务端权威状态库**：`state[collection][entityId] = entity`（最新快照）。
- **服务端操作日志**：`ops[]`，每条带 `serverSeq`（`since` 游标靠它）。
- **客户端本地库 + 出站队列**：本地即时可读可写；未确认 Op 进 `outbox`。

### 3.4 同步流程

```
客户端                                 服务端
  │                                      │
  │── push(outbox ops) ────────────────▶│ 逐条校验权限(baseRev/scope)
  │                                      │   • 通过 → 写入 state + ops(serverSeq++)
  │                                      │   • 冲突 → 按 LWW(ts) 裁决 / 退回 conflict
  │◀──────── 返回 {applied, conflicts} ─│  清空已确认 outbox
  │                                      │
  │── pull(since=lastSeq) ─────────────▶│ 取 ops where serverSeq > since
  │◀──────── 返回 {ops, serverSeq} ─────│  且 scope 对该用户可见
  │ 合并到本地库（同样 LWW），刷新 lastSeq │
```

- **登录即同步**：登录成功后立刻执行一次 `pull`（并 `push` 离线队列）。
- **每 10 秒持续同步**：`setInterval(push+pull, 10000)`。
- **离线**：探测端点失败 → 暂停同步，写只进 `outbox` + 本地库；定时器继续尝试，一旦成功即触发完整 `push`+`pull`。
- **同账户多设备**：同步按 `accountId` 维度；设备只是 `outbox` 的来源标记。设备 A 的写经服务端广播给设备 B（B 的 `pull` 拿到该 Op）。

### 3.5 冲突策略

默认 **LWW（Last-Write-Wins）按 `ts` 裁决**，`deviceId` 作决胜。各模块可覆盖：
- 账本/备忘录：整实体 LWW（少见冲突，因多为追加）。
- 任务：字段级合并可后续增强（如「完成状态」与「描述编辑」互不覆盖）。
- 计数器类（如家庭账本余额）建议设计为**追加明细**而非覆盖余额，从根本上避免冲突。

---

## 4. 模块框架（可扩展性的关键）

模块是**声明式插件**，注册即用，核心看板不感知具体业务。

```js
// modules/ledger.js
module.exports = {
  id: 'ledger',
  name: '账本',
  icon: '💰',
  collections: ['ledger_personal', 'ledger_family'],
  // 权限：个人集合仅本人，家庭集合仅家庭成员
  visibility: { ledger_personal: 'personal', ledger_family: 'family' },
  // 客户端组件（看板内渲染）
  client: { render(container, ctx) { /* ... */ } },
  // 服务端钩子（如：个人账本共享时，复制一份到家庭账本）
  hooks: { afterWrite(op, ctx) { /* 若 shareToFamily，写一条 ledger_family op */ } }
};
```

- **注册表** `ModuleRegistry`：`register(module)`，`list(currentUser)` 返回可见模块。
- **看板组合**：每用户存 `dashboard.layout = ['ledger','memo']`；`AppBoard` 按序渲染。增删模块 = 改布局数组。
- **新增模块步骤**：① 在 `modules/` 新建文件声明集合/scope/权限/UI；② `register`；③ 前端组件挂载。核心代码零改动。

---

## 5. 五大模块规格

### 5.1 家庭模块 `family`
- 集合：`family`（scope=family，但创建者/成员可读取自己所在的 family）。
- 能力：创建家庭（生成 `inviteCode`）、通过邀请码加入、成员列表/角色（owner/member）、退出。
- 一个家庭 = 一个共享 `scopeId`，家庭级集合据此共享。

### 5.2 账本模块 `ledger`
- 两个集合：
  - `ledger_personal`（scope=personal，仅本人）：支持**批量导入**（粘贴 CSV/多行文本 → 解析成多条 Entity 进 outbox）。
  - `ledger_family`（scope=family，成员共享）。
- 每笔个人明细字段含 `shareToFamily: true`（默认）。`shareToFamily=true` 时，服务端钩子自动在 `ledger_family` 写入一条**关联副本**（`sourceEntryId` 指向个人条目）。
- 可见性：个人账本绝对私有；家庭账本仅家庭成员可见。

### 5.3 备忘录模块 `memo`
- 两个集合：`memo_personal`（仅本人）、`memo_family`（家庭共享），相互独立。
- 个人备忘录不经过家庭集合，确保私密。

### 5.4 任务管理模块 `task`
- 集合：`task`（scope=family 或 personal，由创建者选择）。
- 字段：`dueAt`（定时）、`repeat`（重复规则：每天/每周/每月，存 cron 或语义化配置）、`assignee`（家庭成员 accountId）、`done`。
- 服务端/定时 worker 在到期时生成**推送提醒** Op，并可在重复任务到期时自动生成下一周期实例。

### 5.5 推送消息模块 `push`
- 集合：`push_<recipientAccountId>`（scope=personal，仅接收者可见）——天然保证「只推给该用户」。
- 触发：任务分配给自己/到期、家庭备忘录或任务清单变更等，由相关模块 `hooks.afterWrite` 产生 push Op。
- 客户端：浏览器 `Notification API` + 应用内消息列表；离线期间消息进队列，恢复后随同步送达。

---

## 6. 安全与权限

- **认证**：账户密码 bcrypt/argon2 哈希；登录发 `token`（JWT 或随机串存服务端会话）。
- **设备**：登录登记 `deviceId`+设备名，支持同账户多设备，可吊销。
- **授权（核心在 scope）**：`pull` 时只返回 `(scope=personal ∧ scopeId=我) ∨ (scope=family ∧ scopeId∈我的家庭) ∨ (scope=global ∧ 我是参与者)` 的 Op；`push` 时校验该用户对该 `scopeId` 有写权。
- **传输**：②/③ 全程 TLS；① 局域网建议内网或自签证书。token 走 `Authorization` 头。
- **隐私**：个人集合永不进入家庭集合，服务端强制隔离（不靠前端隐藏）。

---

## 7. 技术栈建议（参考实现）

- 后端：Node.js（零外部依赖即可跑：内置 `http`/`crypto`），存储用本地 JSON/SQLite。
- 客户端：原生 JS SPA（无构建步骤），`localStorage`/IndexedDB 作本地库与 outbox。
- 隧道：cloudflared（②）；VPS 用 Nginx/Caddy（③）。
- 后续可升级：把 JSON 存储换 SQLite/Postgres，同步协议加增量压缩、WebSocket 长连替代轮询（仍保留 10s 兜底）。

---

## 8. 扩展性路线图

1. **模块市场**：`modules/` 目录即插件，社区可贡献。
2. **实时同步**：轮询 → WebSocket/SSE，事件即时推送。
3. **端到端加密**：客户端加密个人/家庭敏感集合，服务端只存密文。
4. **备份**：定期把 `ops` 日志打包上传到对象存储 / 私有云。
5. **AI 助手**：基于家庭数据做记账分类、任务提醒摘要。

---

> 配套参考实现见 `app/`：可直接 `node app/server.js` 启动，验证上述架构（同步引擎、四种连接抽象、模块组合、五大模块）。
