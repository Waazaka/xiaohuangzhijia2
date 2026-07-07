// 推送消息模块：集合 'push' 仅服务端可写(serverOnly)，但按个人 scope 读取，
// 因此每条推送只送达目标接收者。由其他模块的钩子产生。
module.exports = {
  id: 'push',
  name: '推送消息',
  icon: '🔔',
  collections: ['push'],
  visibility: { push: 'personal' },
  serverOnlyCollections: ['push'],
  hooks: {}
};
