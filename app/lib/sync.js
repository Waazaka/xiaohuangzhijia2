// 同步引擎：操作日志 + 服务端权威状态 + LWW 冲突裁决。
const store = require('./store');
const { canWrite, canRead } = require('./permissions');
const reg = require('./modules');
const auth = require('./auth');

function nextSeq() {
  store.db.seq += 1;
  return store.db.seq;
}

// 应用单条 op 到权威状态，并写入操作日志（分配 serverSeq）
// opts.fromServer=true 时跳过客户端权限校验（供模块钩子使用）
function applyOp(op, ctx, opts = {}) {
  const meta = reg.scopeOfCollection(op.collection);
  if (!meta) return { ok: false, reason: '未知集合: ' + op.collection };
  const scope = meta.scope;
  if (meta.serverOnly && !opts.fromServer) return { ok: false, reason: '该集合仅服务端可写' };
  if (!opts.fromServer && !canWrite(scope, op.scopeId, ctx)) {
    return { ok: false, reason: '无写权限' };
  }

  const state = store.db.state;
  state[op.collection] = state[op.collection] || {};
  const cur = state[op.collection][op.entityId];
  const incoming = op.entity;
  let rev;

  if (!cur) {
    rev = 1;
  } else if (op.baseRev === cur.rev) {
    rev = cur.rev + 1;
  } else {
    // 冲突：按时间戳 LWW（deviceId 作决胜），旧版本跳过
    if (incoming.ts > cur.ts) {
      rev = cur.rev + 1;
    } else if (incoming.ts === cur.ts) {
      rev = incoming.id > cur.id ? cur.rev + 1 : (function () { return null; })();
      if (rev === null) return { ok: false, conflict: true };
    } else {
      return { ok: false, conflict: true };
    }
  }

  const entity = Object.assign({}, incoming, { rev, collection: op.collection });
  state[op.collection][op.entityId] = entity;

  const stored = {
    opId: op.opId || auth.genId(),
    entityId: op.entityId,
    collection: op.collection,
    scope,
    scopeId: op.scopeId,
    baseRev: op.baseRev,
    entity,
    serverSeq: nextSeq(),
    deviceId: op.deviceId || (ctx && ctx.deviceId) || 'server',
    ts: incoming.ts
  };
  store.db.ops.push(stored);

  return { ok: true, seq: stored.serverSeq, entity, collection: op.collection, scope, scopeId: op.scopeId };
}

function push(ops, ctx) {
  const applied = [];
  const conflicts = [];
  const errors = [];
  store.mutate((db) => {
    for (const op of (ops || [])) {
      const r = applyOp(op, ctx);
      if (r.ok) {
        applied.push(r.seq);
        const meta = reg.scopeOfCollection(r.collection);
        const mod = reg.getModule(meta.module);
        if (mod && mod.hooks && mod.hooks.afterWrite) {
          mod.hooks.afterWrite(r.entity, r.collection, r.scopeId, ctx, (extra) => {
            const rr = applyOp(
              Object.assign({}, extra, { opId: auth.genId(), deviceId: 'server' }),
              ctx,
              { fromServer: true }
            );
            if (rr.ok) applied.push(rr.seq);
            else errors.push(rr.reason);
          });
        }
      } else if (r.conflict) {
        conflicts.push(op.entityId);
      } else {
        errors.push((op.entityId || '') + ':' + r.reason);
      }
    }
  });
  return { serverSeq: store.db.seq, applied, conflicts, errors };
}

// 拉取自 since 之后、且当前用户可见的操作
function pull(since, ctx) {
  const ops = store.db.ops.filter(
    (o) => o.serverSeq > since && canRead(o.scope, o.scopeId, ctx)
  );
  return { serverSeq: store.db.seq, ops };
}

module.exports = { push, pull, applyOp };
