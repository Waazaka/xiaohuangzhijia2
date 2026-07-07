// 本地 JSON 持久化存储：单进程、零依赖。
// 生产可替换为 SQLite / Postgres，对外接口不变。
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'store.json');

function blank() {
  return {
    accounts: {},   // username -> {id, username, passwordHash, displayName, createdAt}
    sessions: {},   // token -> {accountId, deviceId, deviceName, createdAt}
    devices: {},    // accountId -> [{deviceId, deviceName}]
    families: {},   // familyId -> {id, name, ownerId, members:[accountId], inviteCode, createdAt}
    dashboard: {},  // accountId -> [moduleId,...]
    state: {},      // collection -> { entityId -> entity }
    ops: [],        // 操作日志，每条带 serverSeq
    seq: 0
  };
}

let db;

function load() {
  try {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    db = blank();
    save();
  }
  for (const k of ['accounts', 'sessions', 'devices', 'families', 'dashboard', 'state']) {
    if (!db[k]) db[k] = (k === 'ops') ? [] : {};
  }
  if (!Array.isArray(db.ops)) db.ops = [];
  if (typeof db.seq !== 'number') db.seq = 0;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db));
}

// 任何写操作都应包在 mutate 内，结束自动落盘
function mutate(fn) {
  const r = fn(db);
  save();
  return r;
}

module.exports = {
  get db() { return db; },
  load, save, mutate, blank
};
