// 账本模块：
//  - ledger_personal（个人，仅本人）：支持批量导入；每笔明细 shareToFamily(默认 true)
//  - ledger_family（家庭，成员共享）：个人账本 shareToFamily=true 时由钩子自动复制一份
const auth = require('../lib/auth');

module.exports = {
  id: 'ledger',
  name: '账本',
  icon: '💰',
  collections: ['ledger_personal', 'ledger_family'],
  visibility: { ledger_personal: 'personal', ledger_family: 'family' },
  serverOnlyCollections: [],

  hooks: {
    // 个人账本写入后，若标记为共享，则向家庭账本写入关联副本
    afterWrite(entity, collection, scopeId, ctx, enqueue) {
      if (collection !== 'ledger_personal') return;
      if (entity.deleted) return;
      const data = entity.data || {};
      if (!data.shareToFamily) return;
      const familyId = ctx.familyIds[0];
      if (!familyId) return;
      enqueue({
        collection: 'ledger_family',
        scopeId: familyId,
        entityId: 'fam_' + entity.id,
        baseRev: 0,
        entity: {
          id: 'fam_' + entity.id,
          rev: 0,
          data: { ...data, sourceEntryId: entity.id, ownerId: ctx.accountId },
          ts: Date.now(),
          createdBy: ctx.accountId,
          deleted: false
        }
      });
    }
  }
};
