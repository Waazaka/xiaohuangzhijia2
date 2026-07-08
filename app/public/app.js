/* HomeFrame 客户端：可组合看板 + 本地存储 + 离线队列 + 每10秒持续同步 */
(function () {
  'use strict';

  // ---------- 本地持久化 ----------
  const LS = { session: 'hf_session', store: 'hf_store', outbox: 'hf_outbox', since: 'hf_since', endpoint: 'hf_endpoint', offline: 'hf_offline' };
  let session = null;          // {token, accountId, username, displayName, deviceId, families}
  let storeData = {};          // collection -> { entityId -> entity(含 scopeId) }
  let outbox = [];             // 待推送操作
  let since = 0;               // 已拉取到的 serverSeq 游标
  const IS_NATIVE = !!(typeof window !== 'undefined' && window.Capacitor); // 在 Capacitor 原生壳内运行
  let endpoint = localStorage.getItem(LS.endpoint) || (IS_NATIVE ? '' : location.origin);
  let offlineManual = localStorage.getItem(LS.offline) === '1';
  let offline = offlineManual || !navigator.onLine;
  let modulesList = [];        // 全部模块元信息
  let layoutArr = [];          // 当前看板布局（模块 id 顺序）
  let current = '';            // 当前激活模块
  const sub = {};              // 模块内子标签状态
  let syncTimer = null;

  function load() {
    try { session = JSON.parse(localStorage.getItem(LS.session) || 'null'); } catch (e) {}
    try { storeData = JSON.parse(localStorage.getItem(LS.store) || '{}'); } catch (e) {}
    try { outbox = JSON.parse(localStorage.getItem(LS.outbox) || '[]'); } catch (e) {}
    since = +localStorage.getItem(LS.since) || 0;
    offlineManual = localStorage.getItem(LS.offline) === '1';
    offline = offlineManual || !navigator.onLine;
    endpoint = localStorage.getItem(LS.endpoint) || (IS_NATIVE ? '' : location.origin);
  }
  function save() {
    localStorage.setItem(LS.store, JSON.stringify(storeData));
    localStorage.setItem(LS.outbox, JSON.stringify(outbox));
    localStorage.setItem(LS.since, String(since));
  }
  const $ = (id) => document.getElementById(id);
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function uuid() { return crypto.randomUUID(); }

  // ---------- API ----------
  async function api(method, path, body) {
    if (offline) throw new Error('offline');
    if (!endpoint) throw new Error('请先在「连接设置」填写家庭服务器地址（局域网/VPS/域名）');
    const opt = { method, headers: { 'Content-Type': 'application/json' } };
    if (session) opt.headers['Authorization'] = 'Bearer ' + session.token;
    if (body) opt.body = JSON.stringify(body);
    const r = await fetch(endpoint + path, opt);
    if (!r.ok) { const t = await r.text(); throw new Error('HTTP ' + r.status + ' ' + t); }
    return r.json();
  }

  // ---------- 同步引擎（客户端） ----------
  function setStatus(s) {
    const el = $('connStatus');
    el.className = 'dot ' + s;
    el.title = s === 'online' ? '已同步' : s === 'offline' ? '离线（仅本地）' : '同步中…';
  }

  function mergeOps(ops) {
    let changed = false;
    for (const op of ops) {
      const col = op.collection;
      storeData[col] = storeData[col] || {};
      const cur = storeData[col][op.entityId];
      if (!cur || op.entity.ts >= cur.ts) {
        storeData[col][op.entityId] = Object.assign({}, op.entity, { scopeId: op.scopeId });
        changed = true;
      }
    }
    return changed;
  }

  async function triggerSync() {
    if (offline || !session) { setStatus('offline'); return; }
    setStatus('syncing');
    try {
      let changed = false;
      if (outbox.length) {
        const r = await api('POST', '/api/sync/push', { ops: outbox });
        since = Math.max(since, r.serverSeq || since);
        outbox = [];
        changed = true;
        save();
      }
      const r2 = await api('POST', '/api/sync/pull', { since });
      if (mergeOps(r2.ops)) changed = true;
      since = r2.serverSeq;
      save();
      setStatus('online');
      if (changed) renderCurrent();
    } catch (e) {
      setStatus('offline');
    }
  }

  // 本地写：乐观更新 + 入队 + 触发同步
  function writeEntity(collection, scopeId, data, existing, deleted) {
    let eid, rev, baseRev;
    if (existing) { eid = existing.id; rev = existing.rev + 1; baseRev = existing.rev; }
    else { eid = uuid(); rev = 1; baseRev = 0; }
    const entity = { id: eid, rev, data, ts: Date.now(), createdBy: session.accountId, deleted: !!deleted, scopeId };
    storeData[collection] = storeData[collection] || {};
    storeData[collection][eid] = entity;
    outbox.push({ opId: uuid(), entityId: eid, collection, scopeId, baseRev, entity, deviceId: session.deviceId, ts: entity.ts });
    save();
    triggerSync();
    renderCurrent();
  }
  function deleteEntity(collection, entity) {
    writeEntity(collection, entity.scopeId, entity.data, entity, true);
  }
  function updateEntity(collection, entity, patch) {
    writeEntity(collection, entity.scopeId, Object.assign({}, entity.data, patch), entity, false);
  }

  // ---------- 数据读取辅助 ----------
  function getEntities(collection, scopeId) {
    const col = storeData[collection] || {};
    return Object.values(col)
      .filter((e) => !e.deleted && (scopeId === undefined || e.scopeId === scopeId))
      .sort((a, b) => b.ts - a.ts);
  }
  function familyEntities(collection, familyId) {
    if (!familyId) return [];
    return getEntities(collection, familyId);
  }
  function membersFlat() {
    const map = {};
    (session.families || []).forEach((f) => f.members.forEach((m) => { map[m.id] = m.name; }));
    return map;
  }

  // ---------- 登录 / 注册 ----------
  function showLogin() {
    $('login').style.display = 'block';
    $('app').style.display = 'none';
    let mode = 'login';
    $('tab-login').onclick = () => { mode = 'login'; $('tab-login').classList.add('active'); $('tab-register').classList.remove('active'); $('li-displayName').style.display = 'none'; $('li-submit').textContent = '登录'; };
    $('tab-register').onclick = () => { mode = 'register'; $('tab-register').classList.add('active'); $('tab-login').classList.remove('active'); $('li-displayName').style.display = 'block'; $('li-submit').textContent = '注册并登录'; };
    $('li-submit').onclick = async () => {
      const username = $('li-username').value.trim();
      const password = $('li-password').value;
      const deviceName = $('li-deviceName').value.trim() || 'Web';
      $('li-msg').textContent = '';
      if (!username || !password) { $('li-msg').textContent = '请输入用户名和密码'; return; }
      try {
        if (mode === 'register') {
          const r = await api('POST', '/api/auth/register', { username, password, displayName: $('li-displayName').value.trim() || username });
          if (r.error) { $('li-msg').textContent = r.error; return; }
        }
        const r = await api('POST', '/api/auth/login', { username, password, deviceName });
        session = { token: r.token, accountId: r.accountId, username: r.username, displayName: r.displayName, deviceId: r.deviceId, families: r.families };
        localStorage.setItem(LS.session, JSON.stringify(session));
        enterApp();
      } catch (e) { $('li-msg').textContent = '连接失败：' + e.message; }
    };
  }

  async function enterApp() {
    $('login').style.display = 'none';
    $('app').style.display = 'block';
    $('userName').textContent = session.displayName;
    $('connUrl').value = endpoint;
    $('connOffline').checked = offline;
    try {
      const m = await api('GET', '/api/modules');
      modulesList = m.modules;
      layoutArr = m.layout;
      if (!current || !layoutArr.includes(current)) current = layoutArr[0];
    } catch (e) { setStatus('offline'); }
    renderTabs();
    renderCurrent();
    triggerSync();                 // 登录即同步
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(triggerSync, 10000); // 每 10 秒持续同步
  }

  // ---------- 看板渲染 ----------
  function renderTabs() {
    const nav = $('moduleTabs');
    nav.innerHTML = '';
    layoutArr.forEach((id) => {
      const mod = modulesList.find((m) => m.id === id);
      if (!mod) return;
      const b = document.createElement('button');
      b.textContent = mod.icon + ' ' + mod.name;
      if (id === current) b.classList.add('active');
      b.onclick = () => { current = id; renderTabs(); renderCurrent(); };
      nav.appendChild(b);
    });
  }

  function renderCurrent() {
    const c = $('moduleContent');
    if (!current) { c.innerHTML = '<div class="empty">请从「⚙ 看板」选择要显示的模块</div>'; return; }
    if (current === 'family') return renderFamily(c);
    if (current === 'ledger') return renderLedger(c);
    if (current === 'memo') return renderMemo(c);
    if (current === 'task') return renderTask(c);
    if (current === 'push') return renderPush(c);
    c.innerHTML = '<div class="empty">未知模块</div>';
  }

  // ---------- 家庭模块 ----------
  function renderFamily(c) {
    const fams = session.families || [];
    let html = '<div class="module-head"><h2>🏠 家庭</h2></div>';
    fams.forEach((f) => {
      html += '<div class="panel"><div class="row" style="justify-content:space-between"><strong>' + esc(f.name) + '</strong><span class="meta">邀请码：' + esc(f.inviteCode) + '</span></div>'
        + '<div class="meta">成员：' + f.members.map((m) => esc(m.name)).join('、') + '</div></div>';
    });
    html += '<div class="panel"><div class="row"><input id="famName" placeholder="新家庭名称"><button id="famCreate">创建家庭</button></div>'
      + '<div class="row"><input id="famCode" placeholder="输入邀请码加入"><button id="famJoin">加入</button></div></div>';
    c.innerHTML = html;
    $('famCreate').onclick = async () => {
      try { const r = await api('POST', '/api/family/create', { name: $('famName').value.trim() }); session.families = r; localStorage.setItem(LS.session, JSON.stringify(session)); renderCurrent(); } catch (e) { alert('失败：' + e.message); }
    };
    $('famJoin').onclick = async () => {
      try { const r = await api('POST', '/api/family/join', { inviteCode: $('famCode').value.trim() }); session.families = r; localStorage.setItem(LS.session, JSON.stringify(session)); renderCurrent(); } catch (e) { alert('失败：' + e.message); }
    };
  }

  // ---------- 账本模块 ----------
  function renderLedger(c) {
    const tab = sub.ledger || 'p';
    let html = '<div class="module-head"><h2>💰 账本</h2></div>'
      + '<div class="tabs2"><button data-t="p" class="' + (tab === 'p' ? 'active' : '') + '">个人账本</button><button data-t="f" class="' + (tab === 'f' ? 'active' : '') + '">家庭账本</button></div>';
    if (tab === 'p') {
      html += '<div class="panel"><div class="row"><input id="lDate" type="date"><select id="lType"><option>支出</option><option>收入</option></select><input id="lAmount" type="number" placeholder="金额"><input id="lCat" placeholder="分类"></div>'
        + '<div class="row"><input id="lNote" placeholder="备注"><label style="white-space:nowrap"><input type="checkbox" id="lShare" checked> 计入家庭</label><button id="lAdd">添加</button></div></div>'
        + '<div class="panel"><div class="row"><textarea id="lBatch" placeholder="批量导入，每行：日期,金额,分类,备注（金额正为收、负为支）" style="width:100%"></textarea></div><div class="row"><button id="lBatchAdd">批量导入</button></div></div>'
        + '<div id="ledgerList"></div>';
      c.innerHTML = html;
      c.querySelectorAll('.tabs2 button').forEach((b) => b.onclick = () => { sub.ledger = b.dataset.t; renderCurrent(); });
      const list = getEntities('ledger_personal', session.accountId);
      $('ledgerList').innerHTML = list.length ? '<div class="list">' + list.map(ledgerItem).join('') + '</div>' : '<div class="empty">暂无记录</div>';
      bindLedger(list);
    } else {
      const fam = session.families[0];
      const list = fam ? familyEntities('ledger_family', fam.id) : [];
      html += '<div class="panel"><div class="meta">家庭账本由成员共享；个人账本中勾选「计入家庭」的明细会自动同步到这里。</div></div>'
        + (list.length ? '<div class="list">' + list.map(ledgerItem).join('') + '</div>' : '<div class="empty">暂无家庭账目</div>');
      c.innerHTML = html;
      c.querySelectorAll('.tabs2 button').forEach((b) => b.onclick = () => { sub.ledger = b.dataset.t; renderCurrent(); });
    }
  }
  function ledgerItem(e) {
    const d = e.data || {};
    const sign = d.type === '收入' ? '+' : (d.amount < 0 ? '' : '-');
    const badge = d.shareToFamily ? '<span class="badge">已共享</span>' : '<span class="badge priv">私密</span>';
    return '<div class="item"><div><div>' + esc(d.category || '未分类') + ' ' + sign + Math.abs(d.amount) + ' <span class="meta">' + esc(d.date || '') + '</span></div><div class="meta">' + esc(d.note || '') + ' ' + badge + '</div></div>'
      + '<button class="del" data-id="' + e.id + '">删除</button></div>';
  }
  function bindLedger(list) {
    $('lAdd').onclick = () => {
      const amount = parseFloat($('lAmount').value);
      if (isNaN(amount)) return alert('金额无效');
      writeEntity('ledger_personal', session.accountId, {
        date: $('lDate').value || new Date().toISOString().slice(0, 10),
        type: $('lType').value,
        amount, category: $('lCat').value.trim(), note: $('lNote').value.trim(),
        shareToFamily: $('lShare').checked
      });
    };
    $('lBatchAdd').onclick = () => {
      const lines = $('lBatch').value.split('\n').map((s) => s.trim()).filter(Boolean);
      lines.forEach((line) => {
        const p = line.split(/[,，\t]/).map((s) => s.trim());
        const amount = parseFloat(p[1]);
        if (isNaN(amount)) return;
        writeEntity('ledger_personal', session.accountId, {
          date: p[0] || new Date().toISOString().slice(0, 10),
          type: amount >= 0 ? '收入' : '支出',
          amount: Math.abs(amount), category: p[2] || '未分类', note: p[3] || '',
          shareToFamily: true
        });
      });
      $('lBatch').value = '';
    };
    list.forEach((e) => { const btn = document.querySelector('.del[data-id="' + e.id + '"]'); if (btn) btn.onclick = () => deleteEntity('ledger_personal', e); });
  }

  // ---------- 备忘录模块 ----------
  function renderMemo(c) {
    const tab = sub.memo || 'p';
    const fam = session.families[0];
    let html = '<div class="module-head"><h2>📝 备忘录</h2></div>'
      + '<div class="tabs2"><button data-t="p" class="' + (tab === 'p' ? 'active' : '') + '">个人</button><button data-t="f" class="' + (tab === 'f' ? 'active' : '') + '">家庭</button></div>';
    if (tab === 'p') {
      html += '<div class="panel"><input id="mTitle" placeholder="标题"><textarea id="mBody" placeholder="内容" style="width:100%"></textarea><div class="row"><button id="mAdd">添加个人备忘录</button></div></div><div id="memoList"></div>';
      c.innerHTML = html;
      const list = getEntities('memo_personal', session.accountId);
      $('memoList').innerHTML = list.length ? '<div class="list">' + list.map(memoItem).join('') + '</div>' : '<div class="empty">暂无备忘录</div>';
      bindMemo(list, 'memo_personal', session.accountId);
    } else {
      if (!fam) { c.innerHTML = html + '<div class="empty">你还未加入任何家庭</div>'; bindMemoTabs(); return; }
      html += '<div class="panel"><input id="mTitle" placeholder="标题"><textarea id="mBody" placeholder="内容" style="width:100%"></textarea><div class="row"><button id="mAdd">添加家庭备忘录（成员共享）</button></div></div><div id="memoList"></div>';
      c.innerHTML = html;
      const list = familyEntities('memo_family', fam.id);
      $('memoList').innerHTML = list.length ? '<div class="list">' + list.map(memoItem).join('') + '</div>' : '<div class="empty">暂无家庭备忘录</div>';
      bindMemo(list, 'memo_family', fam.id);
    }
    bindMemoTabs();
  }
  function bindMemoTabs() { document.querySelectorAll('.tabs2 button').forEach((b) => b.onclick = () => { sub.memo = b.dataset.t; renderCurrent(); }); }
  function memoItem(e) {
    const d = e.data || {};
    return '<div class="item"><div><div>' + esc(d.title || '(无标题)') + '</div><div class="meta">' + esc(d.body || '') + '</div></div><button class="del" data-id="' + e.id + '">删除</button></div>';
  }
  function bindMemo(list, collection, scopeId) {
    const btn = $('mAdd');
    if (btn) btn.onclick = () => writeEntity(collection, scopeId, { title: $('mTitle').value.trim(), body: $('mBody').value.trim() });
    list.forEach((e) => { const b = document.querySelector('.del[data-id="' + e.id + '"]'); if (b) b.onclick = () => deleteEntity(collection, e); });
  }

  // ---------- 任务模块 ----------
  function renderTask(c) {
    const tab = sub.task || 'p';
    const fam = session.families[0];
    const members = membersFlat();
    const memberOpts = Object.keys(members).map((id) => '<option value="' + id + '">' + esc(members[id]) + '</option>').join('');
    let html = '<div class="module-head"><h2>✅ 任务管理</h2></div>'
      + '<div class="tabs2"><button data-t="p" class="' + (tab === 'p' ? 'active' : '') + '">个人</button><button data-t="f" class="' + (tab === 'f' ? 'active' : '') + '">家庭</button></div>'
      + '<div class="panel"><div class="row"><input id="tTitle" placeholder="任务标题"><input id="tDue" type="datetime-local"></div>'
      + '<div class="row"><select id="tRepeat"><option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option></select>'
      + (fam ? '<select id="tAssign"><option value="">分配给：不指定</option>' + memberOpts + '</select>' : '') + '</div>'
      + '<div class="row"><button id="tAdd">添加任务</button></div></div><div id="taskList"></div>';
    c.innerHTML = html;
    c.querySelectorAll('.tabs2 button').forEach((b) => b.onclick = () => { sub.task = b.dataset.t; renderCurrent(); });
    const list = tab === 'p' ? getEntities('task_personal', session.accountId) : (fam ? familyEntities('task_family', fam.id) : []);
    $('taskList').innerHTML = list.length ? '<div class="list">' + list.map((e) => taskItem(e, members)).join('') + '</div>' : '<div class="empty">暂无任务</div>';
    bindTask(list, tab === 'p' ? 'task_personal' : 'task_family', tab === 'p' ? session.accountId : (fam ? fam.id : ''));
  }
  function taskItem(e, members) {
    const d = e.data || {};
    const done = d.done ? '✅' : '⬜';
    const assignee = d.assignee && members[d.assignee] ? '→ ' + esc(members[d.assignee]) : '';
    const rep = d.repeat && d.repeat !== 'none' ? ' 🔁' + d.repeat : '';
    return '<div class="item"><label class="row" style="flex:1"><input type="checkbox" data-id="' + e.id + '" ' + (d.done ? 'checked' : '') + ' style="width:auto;margin:0"> <span>' + done + ' ' + esc(d.title) + ' <span class="meta">' + esc(d.due || '') + rep + ' ' + assignee + '</span></span></label><button class="del" data-id="' + e.id + '">删除</button></div>';
  }
  function bindTask(list, collection, scopeId) {
    const btn = $('tAdd');
    if (btn) btn.onclick = () => {
      if (!scopeId) return alert('请先加入家庭以创建家庭任务');
      writeEntity(collection, scopeId, {
        title: $('tTitle').value.trim(),
        due: $('tDue').value,
        repeat: $('tRepeat').value,
        assignee: $('tAssign') ? $('tAssign').value : '',
        done: false
      });
    };
    list.forEach((e) => {
      const chk = document.querySelector('input[type=checkbox][data-id="' + e.id + '"]');
      if (chk) chk.onchange = () => updateEntity(collection, e, { done: chk.checked });
      const b = document.querySelector('.del[data-id="' + e.id + '"]');
      if (b) b.onclick = () => deleteEntity(collection, e);
    });
  }

  // ---------- 推送模块 ----------
  function renderPush(c) {
    let html = '<div class="module-head"><h2>🔔 推送消息</h2><button id="pNotify" style="padding:6px 10px;border:1px solid #e3e6eb;background:#fff;border-radius:8px;cursor:pointer">开启浏览器通知</button></div>'
      + '<div id="pushList"></div>';
    c.innerHTML = html;
    const list = getEntities('push', session.accountId).sort((a, b) => b.data.ts - a.data.ts);
    $('pushList').innerHTML = list.length ? '<div class="list">' + list.map((e) => '<div class="item"><div><div>' + esc(e.data.text) + '</div><div class="meta">' + new Date(e.data.ts).toLocaleString() + '</div></div></div>').join('') + '</div>' : '<div class="empty">暂无消息</div>';
    $('pNotify').onclick = () => { if ('Notification' in window) Notification.requestPermission(); };
  }

  // ---------- 编辑看板 ----------
  function openModal() {
    const box = $('moduleOptions');
    box.innerHTML = '';
    modulesList.forEach((m) => {
      const div = document.createElement('div');
      div.className = 'opt';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = layoutArr.includes(m.id); cb.dataset.id = m.id;
      const span = document.createElement('span');
      span.textContent = m.icon + ' ' + m.name;
      div.appendChild(cb); div.appendChild(span);
      box.appendChild(div);
    });
    $('modal').style.display = 'flex';
  }
  $('btn-edit').onclick = openModal;
  $('modal-cancel').onclick = () => { $('modal').style.display = 'none'; };
  $('modal-save').onclick = async () => {
    const ids = Array.from($('moduleOptions').querySelectorAll('input')).filter((c) => c.checked).map((c) => c.dataset.id);
    if (!ids.length) { alert('至少选择一个模块'); return; }
    try { const r = await api('POST', '/api/dashboard/layout', { modules: ids }); layoutArr = r.layout; current = layoutArr[0]; renderTabs(); renderCurrent(); $('modal').style.display = 'none'; } catch (e) { alert('保存失败：' + e.message); }
  };

  // ---------- 连接设置 / 退出 ----------
  $('connOffline').onchange = (e) => { offlineManual = e.target.checked; offline = offlineManual || !navigator.onLine; localStorage.setItem(LS.offline, offlineManual ? '1' : '0'); setStatus(offline ? 'offline' : 'online'); if (!offline) triggerSync(); };
  $('connUrl').onchange = (e) => { endpoint = e.target.value.trim() || (IS_NATIVE ? '' : location.origin); localStorage.setItem(LS.endpoint, endpoint); if (!endpoint) { setStatus('offline'); return; } triggerSync(); };
  $('btn-logout').onclick = () => { if (syncTimer) clearInterval(syncTimer); session = null; localStorage.removeItem(LS.session); $('app').style.display = 'none'; showLogin(); };

  // ---------- PWA：注册 service worker（仅网页/HTTPS 下有效；原生壳用自带 WebView 离线） ----------
  if (!IS_NATIVE && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {});
    });
  }

  // 自动感知网络：断网即离线（数据留本地），恢复即同步
  window.addEventListener('offline', () => { offline = true; setStatus('offline'); });
  window.addEventListener('online', () => { offline = offlineManual; setStatus(offline ? 'offline' : 'online'); if (!offline) triggerSync(); });

  // ---------- 启动 ----------
  load();
  if (session) enterApp(); else showLogin();
  if (IS_NATIVE && !endpoint) {
    const c = $('connUrl'); if (c) { c.scrollIntoView({ behavior: 'smooth' }); c.focus(); }
    const m = $('li-msg'); if (m) m.textContent = '请先在「连接设置」填写家庭服务器地址（局域网/VPS/域名）';
  }
})();
