// 认证：账户、会话、设备。密码用 scrypt 哈希。
const crypto = require('crypto');
const store = require('./store');

function hash(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32);
  return salt.toString('hex') + ':' + h.toString('hex');
}

function verify(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, h] = stored.split(':');
  const hh = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  try {
    return crypto.timingSafeEqual(hh, Buffer.from(h, 'hex'));
  } catch {
    return false;
  }
}

function genId() {
  return crypto.randomUUID();
}

function register(username, password, displayName) {
  return store.mutate((db) => {
    if (db.accounts[username]) return { error: '用户名已存在' };
    const id = genId();
    db.accounts[username] = {
      id,
      username,
      passwordHash: hash(password),
      displayName: displayName || username,
      createdAt: Date.now()
    };
    return { id };
  });
}

function login(username, password, deviceName) {
  const db = store.db;
  const a = db.accounts[username];
  if (!a || !verify(password, a.passwordHash)) return { error: '用户名或密码错误' };
  const token = crypto.randomBytes(24).toString('hex');
  const deviceId = genId();
  db.sessions[token] = {
    accountId: a.id,
    deviceId,
    deviceName: deviceName || '未命名设备',
    createdAt: Date.now()
  };
  db.devices[a.id] = db.devices[a.id] || [];
  if (!db.devices[a.id].find((d) => d.deviceId === deviceId)) {
    db.devices[a.id].push({ deviceId, deviceName: deviceName || '未命名设备' });
  }
  store.save();
  return { token, accountId: a.id, deviceId };
}

function logout(token) {
  store.mutate((db) => { delete db.sessions[token]; });
}

// 由 token 推导请求上下文（含可见家庭列表）
function ctxFromToken(token) {
  const s = store.db.sessions[token];
  if (!s) return null;
  const accountId = s.accountId;
  const familyIds = Object.values(store.db.families)
    .filter((f) => f.members.includes(accountId))
    .map((f) => f.id);
  return {
    accountId,
    deviceId: s.deviceId,
    deviceName: s.deviceName,
    familyIds
  };
}

function nameOf(id) {
  const a = Object.values(store.db.accounts).find((x) => x.id === id);
  return a ? a.displayName : '未知';
}

module.exports = { hash, verify, genId, register, login, logout, ctxFromToken, nameOf };
