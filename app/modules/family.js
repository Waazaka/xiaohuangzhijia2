// 家庭模块：多用户创建/加入同一家庭。家庭数据由服务端 families 表权威维护，
// 并通过专用 API（/api/family/*）暴露，便于权限计算与邀请。
const auth = require('../lib/auth');
const store = require('../lib/store');

module.exports = {
  id: 'family',
  name: '家庭',
  icon: '🏠',
  collections: [],          // 家庭关系由服务端维护，不走 sync 集合
  visibility: {},
  serverOnlyCollections: [],

  // 仅用于看板展示的客户端钩子占位（无 sync 钩子）
  hooks: {},

  createFamily(ownerId, name) {
    return store.mutate((db) => {
      const id = auth.genId();
      const invite = Math.random().toString(36).slice(2, 8).toUpperCase();
      db.families[id] = {
        id,
        name: name || '我的家庭',
        ownerId,
        members: [ownerId],
        inviteCode: invite,
        createdAt: Date.now()
      };
      return db.families[id];
    });
  },

  joinFamily(inviteCode, accountId) {
    const code = (inviteCode || '').toUpperCase();
    return store.mutate((db) => {
      const f = Object.values(db.families).find((x) => x.inviteCode === code);
      if (!f) return { error: '邀请码无效' };
      if (!f.members.includes(accountId)) f.members.push(accountId);
      return f;
    });
  }
};
