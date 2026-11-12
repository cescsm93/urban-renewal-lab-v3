(() => {
  const roleLabel = { admin: '管理员', editor: '编辑', viewer: '查看' };
  const $ = id => document.getElementById(id);
  let map, me, current, personal, baseline, busy = false, checking = false, dialog;
  let message = '';

  async function request(url, method = 'GET', data) {
    const options = { method, signal: AbortSignal.timeout(20000), cache: 'no-store' };
    if (data !== undefined) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(data);
    }
    const response = await fetch(url, options);
    const result = await response.json();
    if (!response.ok) throw Object.assign(Error(result.error || '共享服务暂不可用'), { status: response.status });
    return result;
  }

  const currentPath = () => '/api/shared/projects/' + current.id;
  const changed = () => !!current && JSON.stringify(map.capture()) !== baseline;
  function show(text = message) {
    message = text;
    $('sharedStatus').textContent = text;
    $('sharedBanner').hidden = !current;
    $('sharedProjectTitle').textContent = current
      ? current.name + ' · ' + roleLabel[current.role] + ' · v' + current.version + (changed() ? ' · 本页有未保存修改' : '') : '';
    $('sharedMapStatus').textContent = text;
    $('sharedSave').title = current?.role === 'viewer' ? '查看权限可浏览和试算，不能保存共享版本' : '';
    $('sharedSave').disabled = !current || current.role === 'viewer' || busy;
    $('sharedRefresh').disabled = !current || busy;
    $('sharedLeave').disabled = !current || busy;
    $('sharedAccess').hidden = !current || !me?.admin;
    $('sharedMemberTools').hidden = !me?.admin;
  }
  function working(fn) {
    return async () => {
      if (busy) return;
      busy = true;
      show();
      try { await fn(); }
      catch (error) { show(error.message); }
      finally { busy = false; show(); }
    };
  }
  function mayReplace() {
    if (map.editing()) throw Error('请先完成边界编辑或文件导入');
    return !changed() || confirm('本页有未保存修改。确定放弃这些修改吗？');
  }
  function activate(project) {
    const previous = current;
    const snapshot = map.capture();
    if (!previous) personal = snapshot;
    current = project;
    try { map.apply(project.state); }
    catch (error) {
      current = previous;
      map.apply(snapshot);
      throw error;
    }
    baseline = JSON.stringify(map.capture());
    show('已加载 v' + project.version + '，最近保存者 ' + project.updatedBy);
  }
  async function list() {
    const { projects } = await request('/api/shared/projects');
    const select = $('sharedProjects');
    const selected = select.value || String(current?.id || '');
    select.replaceChildren(...projects.map(p => new Option(p.name + ' · ' + roleLabel[p.role] + ' · v' + p.version, p.id)));
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
    $('sharedOpen').disabled = !projects.length;
    if (!projects.length) show(me.admin ? '还没有共享项目。可以从当前地图创建。' : '你目前没有项目权限，请联系管理员。');
  }
  async function members() {
    if (!current || !me.admin) return;
    const [{ members }, { users }] = await Promise.all([request(currentPath() + '/members'), request('/api/shared/users')]);
    $('sharedMemberList').textContent = members.length
      ? members.map(m => m.username + '（' + roleLabel[m.role] + '）').join('、') : '尚未分配项目成员。';
    const select = $('sharedMember');
    const previous = select.value;
    select.replaceChildren(...users.map(name => new Option(name, name)));
    if (users.includes(previous)) select.value = previous;
    $('sharedGrant').disabled = !users.length;
  }
  async function check() {
    if (!current || busy || checking || document.hidden) return;
    checking = true;
    const previous = current;
    try {
      const latest = await request(currentPath() + '?version=' + previous.version);
      if (current !== previous || busy) return;
      current.role = latest.role;
      if (latest.state) {
        if (changed() || map.editing() || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) {
          show('同事保存了 v' + latest.version + '。本页保留当前内容，可备份后加载最新版。');
        } else activate(latest);
      } else show();
    } catch (error) {
      if (current === previous) show(error.message);
    } finally { checking = false; }
  }
  const save = working(async () => {
    if (!current || current.role === 'viewer') return;
    if (map.editing()) throw Error('请先完成边界编辑或文件导入');
    const state = map.capture();
    const submitted = JSON.stringify(state);
    const project = await request(currentPath(), 'PUT', { version: current.version, state });
    current = project;
    baseline = submitted;
    show('已保存共享版本 v' + project.version + '。同事打开该项目时会看到此版本。');
  });
  function backup() {
    const blob = new Blob([JSON.stringify({ app: 'Urban Renewal Lab', version: 7, ...map.capture() }, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = 'renewal-shared-draft.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  function account(reset) {
    return working(async () => {
      if (reset && !confirm('重置会使该同事的旧口令及登录会话失效，继续吗？')) return;
      const result = await request('/api/shared/users', 'POST', { username: $('sharedUsername').value, reset });
      $('sharedCredential').textContent = '账号 ' + result.username + '  ·  口令 ' + result.password;
      if (current) await members();
      show('请将上面的个人账号和口令私下交给同事。');
    });
  }

  async function init(adapter) {
    map = adapter;
    const css = document.createElement('style');
    css.textContent = `
      #sharedBanner{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:48;width:min(650px,92vw);background:#fff;border:1px solid #bfd5da;box-shadow:0 8px 30px #173b492a;padding:10px 14px;border-radius:12px;color:#173d49}
      #sharedBanner p{margin:4px 0;font-size:13px}
      #sharedDialog{width:min(620px,92vw);max-height:85vh;overflow:auto;padding:24px;border:1px solid #c6d8db;border-radius:14px;color:#173d49}
      #sharedDialog::backdrop{background:#102e48a0}
      #sharedDialog section{border-top:1px solid #d9e7ea;margin-top:14px;padding-top:12px}
      #sharedDialog p{margin:8px 0;line-height:1.5}
      #sharedDialog label{display:block;margin:8px 0}
      #sharedDialog input,#sharedDialog select{margin:4px 0;width:100%}
      #sharedDialog button,#sharedBanner button{padding:7px 10px;border:1px solid #c2d7dc;border-radius:7px;background:#eff7f8;color:#173d49;margin:3px;cursor:pointer}
      #sharedCredential{overflow-wrap:anywhere;background:#eff7f8;user-select:all}
    `;
    document.head.append(css);
    const nav = document.createElement('button');
    nav.textContent = '共享项目';
    nav.id = 'openSharedProjects';
    document.querySelector('.workspace-nav').append(nav);
    document.body.insertAdjacentHTML('beforeend', `
      <div id="sharedBanner" hidden><b id="sharedProjectTitle"></b><p id="sharedMapStatus" role="status"></p>
        <button id="sharedSave">保存共享版本</button><button id="sharedRefresh">加载最新版</button>
        <button id="sharedLeave">退出共享项目</button><button id="sharedDraft">下载当前草稿</button></div>
      <dialog id="sharedDialog"><form method="dialog"><button style="float:right">关闭</button></form>
        <h2>共享项目</h2><p id="sharedIdentity"></p><button id="sharedLogout">退出登录</button>
        <p id="sharedStatus" role="status"></p>
        <section id="sharedProjectTools"><label>我的共享项目<select id="sharedProjects"></select></label><button id="sharedOpen">打开项目</button>
          <p>编辑后点击地图下方的「保存共享版本」。其他成员会自动检查更新。</p></section>
        <section id="sharedMemberTools" hidden>
          <h3>创建共享项目</h3><label>项目名称<input id="sharedName" maxlength="100"></label><button id="sharedCreate">用当前地图创建</button>
          <h3>成员账号</h3><label>账号<input id="sharedUsername" maxlength="32" placeholder="例如 wang01"></label>
          <button id="sharedCreateUser">创建账号</button><button id="sharedResetUser">重置口令</button><p id="sharedCredential"></p>
          <div id="sharedAccess" hidden><h3>当前项目权限</h3><p id="sharedMemberList"></p>
            <label>成员<select id="sharedMember"></select></label>
            <label>权限<select id="sharedRole"><option value="editor">编辑</option><option value="viewer">查看</option><option value="none">撤销权限</option></select></label>
            <button id="sharedGrant">更新权限</button>
          </div>
        </section>
      </dialog>
    `);
    dialog = $('sharedDialog');
    nav.onclick = working(async () => {
      if (!dialog.open) dialog.showModal();
      $('sharedCredential').textContent = '';
      try { me = await request('/api/shared/me'); }
      catch (error) {
        if (error.status !== 403) throw error;
        me = null;
        $('sharedIdentity').textContent = '当前为访客';
        $('sharedProjectTools').hidden = true;
        return show('如需访问共享项目，请退出登录，再使用管理员分配的成员账号。');
      }
      $('sharedProjectTools').hidden = false;
      $('sharedIdentity').textContent = '当前账号 ' + me.username + (me.admin ? ' · 管理员' : '');
      await list();
      await members();
    });
    $('sharedOpen').onclick = working(async () => {
      const id = $('sharedProjects').value;
      if (!id || !mayReplace()) return;
      const starting = JSON.stringify(map.capture());
      const project = await request('/api/shared/projects/' + id);
      if (map.editing() || JSON.stringify(map.capture()) !== starting) throw Error('加载期间地图发生变化，请重新打开项目');
      activate(project);
      dialog.close();
    });
    $('sharedCreate').onclick = working(async () => {
      if (map.editing()) throw Error('请先完成边界编辑或文件导入');
      const state = map.capture();
      const starting = JSON.stringify(state);
      const project = await request('/api/shared/projects', 'POST', { name: $('sharedName').value, state });
      if (map.editing() || JSON.stringify(map.capture()) !== starting) {
        await list();
        return show('共享项目已创建。地图在创建期间有变化，请从项目列表打开。');
      }
      activate(project);
      $('sharedName').value = '';
      await list();
      await members();
    });
    $('sharedCreateUser').onclick = account(false);
    $('sharedResetUser').onclick = account(true);
    $('sharedGrant').onclick = working(async () => {
      await request(currentPath() + '/members', 'PUT', { username: $('sharedMember').value, role: $('sharedRole').value });
      await members();
      show('已更新当前项目的成员权限。');
    });
    $('sharedSave').onclick = save;
    $('sharedRefresh').onclick = working(async () => {
      if (!mayReplace()) return;
      const starting = JSON.stringify(map.capture());
      const project = await request(currentPath());
      if (map.editing() || JSON.stringify(map.capture()) !== starting) throw Error('加载期间地图发生变化，请重新加载');
      activate(project);
    });
    $('sharedLeave').onclick = working(async () => {
      if (!mayReplace()) return;
      const snapshot = personal;
      current = null;
      map.apply(snapshot);
      personal = null;
      show('已回到本地项目。');
    });
    $('sharedDraft').onclick = backup;
    $('sharedLogout').onclick = working(async () => {
      if (!mayReplace()) return;
      await request('/lan-logout', 'POST');
      location.reload();
    });
    window.addEventListener('beforeunload', event => {
      if (changed() || (current && map.editing())) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    setInterval(check, 8000);
  }
  window.RenewalShared = {
    init,
    active: () => !!current,
    noteChange: () => { if (current) show(); }
  };
})();
