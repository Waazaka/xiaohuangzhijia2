// 基于 scope 的读写权限判定。scope 由集合在模块注册表中声明，服务端权威推导。
function canWrite(scope, scopeId, ctx) {
  if (scope === 'personal') return scopeId === ctx.accountId;
  if (scope === 'family') return ctx.familyIds.includes(scopeId);
  return false; // 'server' 集合客户端不可写
}

function canRead(scope, scopeId, ctx) {
  if (scope === 'personal') return scopeId === ctx.accountId;
  if (scope === 'family') return ctx.familyIds.includes(scopeId);
  return false;
}

module.exports = { canWrite, canRead };
