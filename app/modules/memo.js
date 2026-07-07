// 备忘录模块：个人备忘录(memo_personal)与家庭备忘录(memo_family)相互独立。
// 家庭备忘录变更时，向其他家庭成员推送提醒。
const auth = require('../lib/auth');
const store = require('../lib/store');

module.exports = {
  id: 'memo',
  name: '备忘录',
  icon: '📝',
  collections: ['memo_personal', 'memo_family'],
  visibility: { memo_personal: 'personal', memo_family: 'family' },
  serverOnlyCollections: [],

  hooks: {
    afterWrite(entity, collection, scopeId, ctx, enqueue) {
      if (collection !== 'memo_family' || entity.deleted) return;
      const f = store.db.families[scopeId];
      if (!f) return;
      const title = (entity.data && entity.data.title) || '(无标题)';
      for (const mid of f.members) {
        if (mid === ctx.accountId) continue;
        const pid = auth.genId();
        enqueue({
          collection: 'push',
          scopeId: mid,
          entityId: pid,
          baseRev: 0,
          entity: {
            id: pid,
            rev: 0,
            data: { type: 'memo_change', text: '家庭备忘录已更新：' + title, ts: Date.now() },
            ts: Date.now(),
            createdBy: ctx.accountId,
            deleted: false
          }
        });
      }
    }
  }
};
