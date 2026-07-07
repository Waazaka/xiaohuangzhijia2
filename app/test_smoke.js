// 端到端冒烟测试：注册双用户、建家庭、账本共享、备忘录推送、冲突裁决
const BASE = 'http://localhost:8787';

async function call(token, method, path, body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opt.headers['Authorization'] = 'Bearer ' + token;
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(method + ' ' + path + ' -> ' + r.status + ' ' + JSON.stringify(j));
  return j;
}

function assert(cond, msg) { if (!cond) throw new Error('断言失败: ' + msg); console.log('  ✓ ' + msg); }

(async () => {
  console.log('1) 注册并登录双用户');
  await call(null, 'POST', '/api/auth/register', { username: 'alice', password: 'pw', displayName: 'Alice' }).catch(() => {});
  await call(null, 'POST', '/api/auth/register', { username: 'bob', password: 'pw', displayName: 'Bob' }).catch(() => {});
  const a = await call(null, 'POST', '/api/auth/login', { username: 'alice', password: 'pw', deviceName: 'A-phone' });
  const b = await call(null, 'POST', '/api/auth/login', { username: 'bob', password: 'pw', deviceName: 'B-pc' });
  assert(a.token && b.token, '双用户登录获得 token');

  console.log('2) 创建家庭 + 加入');
  const fams = await call(a.token, 'POST', '/api/family/create', { name: '我家' });
  const fam = fams[0];
  assert(fam && fam.inviteCode, 'Alice 创建家庭，邀请码=' + (fam && fam.inviteCode));
  const famsB = await call(b.token, 'POST', '/api/family/join', { inviteCode: fam.inviteCode });
  assert(famsB[0].members.length === 2, 'Bob 加入家庭，成员数=2');

  console.log('3) 账本：个人写入并共享到家庭账本');
  const eid = 'test-' + Date.now();
  const pushRes = await call(a.token, 'POST', '/api/sync/push', {
    ops: [{
      opId: 'o1', entityId: eid, collection: 'ledger_personal', scopeId: a.accountId,
      baseRev: 0, deviceId: 'devA',
      entity: { id: eid, rev: 1, data: { date: '2026-07-07', type: '支出', amount: 50, category: '餐饮', note: '午饭', shareToFamily: true }, ts: Date.now(), createdBy: a.accountId, deleted: false }
    }]
  });
  assert(pushRes.applied.length >= 1, 'Alice 个人账本 push 成功');
  // Bob 应能从家庭账本拉到共享条目
  const bp = await call(b.token, 'POST', '/api/sync/pull', { since: 0 });
  const shared = bp.ops.find((o) => o.collection === 'ledger_family');
  assert(shared, 'Bob 在家庭账本看到 Alice 共享的账目');

  console.log('4) 备忘录：家庭备忘录变更应推送给 Bob');
  const mid = 'memo-' + Date.now();
  await call(a.token, 'POST', '/api/sync/push', {
    ops: [{
      opId: 'o2', entityId: mid, collection: 'memo_family', scopeId: fam.id,
      baseRev: 0, deviceId: 'devA',
      entity: { id: mid, rev: 1, data: { title: '买菜', body: '番茄鸡蛋' }, ts: Date.now(), createdBy: a.accountId, deleted: false }
    }]
  });
  const bp2 = await call(b.token, 'POST', '/api/sync/pull', { since: bp.serverSeq });
  const pushToBob = bp2.ops.find((o) => o.collection === 'push' && o.scopeId === b.accountId);
  assert(pushToBob, 'Bob 收到家庭备忘录变更推送');

  console.log('5) 冲突裁决：LWW 按时间戳');
  const cid = 'conf-' + Date.now();
  await call(a.token, 'POST', '/api/sync/push', {
    ops: [{ opId: 'c1', entityId: cid, collection: 'memo_personal', scopeId: a.accountId, baseRev: 0, deviceId: 'devA',
      entity: { id: cid, rev: 1, data: { title: '旧' }, ts: 1000, createdBy: a.accountId, deleted: false } }]
  });
  const late = await call(a.token, 'POST', '/api/sync/push', {
    ops: [{ opId: 'c2', entityId: cid, collection: 'memo_personal', scopeId: a.accountId, baseRev: 0, deviceId: 'devA',
      entity: { id: cid, rev: 1, data: { title: '新' }, ts: 2000, createdBy: a.accountId, deleted: false } }]
  });
  assert(late.applied.length >= 1, '时间戳更新的版本被接受（LWW）');
  const ap = await call(a.token, 'POST', '/api/sync/pull', { since: 0 });
  const finalEnt = ap.ops.filter((o) => o.entityId === cid).pop();
  assert(finalEnt.entity.data.title === '新', '最终版本为时间戳较新者');

  console.log('\n✅ 全部冒烟测试通过');
})().catch((e) => { console.error('\n❌ ' + e.message); process.exit(1); });
