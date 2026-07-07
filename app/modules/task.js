// 任务管理模块：
//  - task_personal / task_family 两个集合（个人 or 家庭共享）
//  - 支持 dueAt(定时)、repeat(重复规则)、assignee(分配给家庭成员)
//  - 分配/家庭任务变更时推送提醒
const auth = require('../lib/auth');
const store = require('../lib/store');

module.exports = {
  id: 'task',
  name: '任务管理',
  icon: '✅',
  collections: ['task_personal', 'task_family'],
  visibility: { task_personal: 'personal', task_family: 'family' },
  serverOnlyCollections: [],

  hooks: {
    afterWrite(entity, collection, scopeId, ctx, enqueue) {
      const data = entity.data || {};
      // 分配给他人 -> 推送
      if (data.assignee && data.assignee !== ctx.accountId) {
        const pid = auth.genId();
        enqueue({
          collection: 'push',
          scopeId: data.assignee,
          entityId: pid,
          baseRev: 0,
          entity: {
            id: pid,
            rev: 0,
            data: { type: 'task_assigned', text: '你被分配任务：' + (data.title || ''), taskId: entity.id, ts: Date.now() },
            ts: Date.now(),
            createdBy: ctx.accountId,
            deleted: false
          }
        });
      }
      // 家庭任务变更 -> 通知其他成员
      if (collection === 'task_family' && scopeId && store.db.families[scopeId]) {
        for (const mid of store.db.families[scopeId].members) {
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
              data: { type: 'task_change', text: '家庭任务更新：' + (data.title || ''), ts: Date.now() },
              ts: Date.now(),
              createdBy: ctx.accountId,
              deleted: false
            }
          });
        }
      }
    }
  }
};
