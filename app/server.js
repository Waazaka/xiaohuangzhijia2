// HTTP 服务：零依赖。提供认证、家庭、模块看板、以及核心同步 API。
// 静态前端在 public/，可直接同端口访问（演示四种连接方式时换 URL 即可）。
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const store = require('./lib/store');
const auth = require('./lib/auth');
const sync = require('./lib/sync');
const reg = require('./lib/modules');
const familyMod = require('./modules/family');

store.load();
const PORT = process.env.PORT || 8787;
const PUBLIC_DIR = path.join(__dirname, 'public');

let _req = null;
function corsHeaders(req) {
  const origin = (req && req.headers && req.headers.origin) || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}
function send(res, code, obj) {
  const h = { 'Content-Type': 'application/json; charset=utf-8' };
  if (_req) Object.assign(h, corsHeaders(_req));
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); }
    });
  });
}

function authCtx(req) {
  const h = req.headers['authorization'] || '';
  const t = h.replace(/^Bearer /, '');
  return auth.ctxFromToken(t);
}

function familyView(accountId) {
  return Object.values(store.db.families)
    .filter((f) => f.members.includes(accountId))
    .map((f) => ({
      id: f.id,
      name: f.name,
      inviteCode: f.inviteCode,
      ownerId: f.ownerId,
      members: f.members.map((id) => ({ id, name: auth.nameOf(id) }))
    }));
}

const server = http.createServer(async (req, res) => {
  _req = req;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  let pathname;
  try { pathname = decodeURIComponent(url.parse(req.url).pathname); }
  catch { pathname = url.parse(req.url).pathname; }

  // ---- 静态资源 + PWA ----
  if (req.method === 'GET' && (pathname === '/' || pathname.startsWith('/public/') ||
      pathname === '/manifest.webmanifest' || pathname === '/service-worker.js' ||
      ['/app.js', '/styles.css', '/icon.svg'].includes(pathname))) {
    const rel = pathname === '/' ? 'index.html'
      : pathname.startsWith('/public/') ? pathname.replace(/^\/public\//, '')
      : pathname.replace(/^\//, '');
    const f = path.join(PUBLIC_DIR, rel);
    if (!f.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
    fs.readFile(f, (e, data) => {
      if (e) return send(res, 404, { error: 'not found' });
      const ext = path.extname(f);
      const ct = {
        '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
        '.json': 'application/json', '.webmanifest': 'application/manifest+json',
        '.svg': 'image/svg+xml'
      }[ext] || 'text/plain';
      const headers = { 'Content-Type': ct + '; charset=utf-8' };
      Object.assign(headers, corsHeaders(req));
      if (pathname === '/service-worker.js') headers['Service-Worker-Allowed'] = '/';
      res.writeHead(200, headers);
      res.end(data);
    });
    return;
  }

  let body = {};
  if (req.method === 'POST' || req.method === 'PUT') {
    try { body = await readBody(req); } catch { return send(res, 400, { error: 'bad json' }); }
  }

  // ---- 认证 ----
  if (req.method === 'POST' && pathname === '/api/auth/register') {
    const r = auth.register(body.username, body.password, body.displayName);
    if (r.error) return send(res, 400, r);
    return send(res, 200, { id: r.id });
  }
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const r = auth.login(body.username, body.password, body.deviceName);
    if (r.error) return send(res, 401, r);
    const acc = Object.values(store.db.accounts).find((a) => a.id === r.accountId);
    return send(res, 200, {
      token: r.token,
      accountId: r.accountId,
      username: acc.username,
      displayName: acc.displayName,
      deviceId: r.deviceId,
      families: familyView(r.accountId)
    });
  }

  const ctx = authCtx(req);
  if (!ctx) return send(res, 401, { error: '未认证' });

  // ---- 当前用户 ----
  if (req.method === 'GET' && pathname === '/api/me') {
    const acc = Object.values(store.db.accounts).find((a) => a.id === ctx.accountId);
    return send(res, 200, {
      accountId: ctx.accountId,
      username: acc.username,
      displayName: acc.displayName,
      families: familyView(ctx.accountId),
      devices: store.db.devices[ctx.accountId] || []
    });
  }

  // ---- 家庭 ----
  if (req.method === 'POST' && pathname === '/api/family/create') {
    familyMod.createFamily(ctx.accountId, body.name);
    return send(res, 200, familyView(ctx.accountId));
  }
  if (req.method === 'POST' && pathname === '/api/family/join') {
    const r = familyMod.joinFamily(body.inviteCode, ctx.accountId);
    if (r.error) return send(res, 400, r);
    return send(res, 200, familyView(ctx.accountId));
  }

  // ---- 模块看板 ----
  if (req.method === 'GET' && pathname === '/api/modules') {
    const layout = store.db.dashboard[ctx.accountId] || reg.list().map((m) => m.id);
    return send(res, 200, { modules: reg.list(), layout });
  }
  if (req.method === 'POST' && pathname === '/api/dashboard/layout') {
    if (!Array.isArray(body.modules)) return send(res, 400, { error: 'modules 必须为数组' });
    store.mutate((db) => { db.dashboard[ctx.accountId] = body.modules; });
    return send(res, 200, { layout: store.db.dashboard[ctx.accountId] });
  }

  // ---- 同步核心 ----
  if (req.method === 'POST' && pathname === '/api/sync/pull') {
    return send(res, 200, sync.pull(body.since || 0, ctx));
  }
  if (req.method === 'POST' && pathname === '/api/sync/push') {
    return send(res, 200, sync.push(body.ops || [], ctx));
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log('HomeFrame 已启动: http://localhost:' + PORT);
});
