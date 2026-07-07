// 模块注册表：所有模块在此登记。新增模块只需在 modules/ 加文件并在此 require。
const family = require('../modules/family');
const ledger = require('../modules/ledger');
const memo = require('../modules/memo');
const task = require('../modules/task');
const push = require('../modules/push');

const all = [family, ledger, memo, task, push];
const byId = new Map();
const collMap = new Map(); // collection -> {module, scope, serverOnly}

for (const m of all) {
  byId.set(m.id, m);
  for (const c of (m.collections || [])) {
    collMap.set(c, {
      module: m.id,
      scope: m.visibility[c],
      serverOnly: (m.serverOnlyCollections || []).includes(c)
    });
  }
}

function scopeOfCollection(c) {
  return collMap.get(c);
}

function getModule(id) {
  return byId.get(id);
}

function list() {
  return all.map((m) => ({ id: m.id, name: m.name, icon: m.icon, collections: m.collections || [] }));
}

module.exports = { all, byId, collMap, scopeOfCollection, getModule, list };
