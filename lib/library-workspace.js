(function (root) {
  'use strict';
  const fields = ['序号','类别','机构名称','机构性质','所在地区','地址','专业方向','联系人','合作项目','优势特长','相关案例','入库部门'];
  let overlay, content, nav, payload = null, active = 'partners';
  const $ = id => document.getElementById(id);

  function element(tag, className, label) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (label != null) node.textContent = label;
    return node;
  }
  function close() {
    if (overlay) overlay.hidden = true;
    $('openLibraries')?.classList.remove('on');
  }
  function heading(title, description) {
    const box = element('div', 'library-intro');
    box.append(element('h2', '', title), element('p', '', description));
    return box;
  }
  function linkTo(label, target) {
    const button = element('button', 'library-action', label);
    button.type = 'button';
    button.onclick = () => { close(); $(target)?.click(); };
    return button;
  }
  function renderSimple(type) {
    content.replaceChildren();
    if (type === 'policy') {
      content.append(heading('政策库', '本机政策 PDF 与笔记由 Copilot 检索，回答可打开引用原文。公开演示站不提供本地政策文件。'), linkTo('打开政策问答', 'openCopilot'));
    } else if (type === 'projects') {
      content.append(heading('项目库', '项目层、宗地层、建筑层等档案保留原图层名称与字段，可在导入数据中查看和维护。'), linkTo('打开项目档案图层', 'openData'));
    } else {
      content.append(heading('场景库', '目前没有录入场景。'));
      const empty = element('p', 'library-empty', '0 条场景记录');
      content.append(empty);
    }
  }
  function downloadPartners() {
    if (!payload) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = '合作伙伴资源库备份-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function showPartnerRecord(record, detail) {
    detail.replaceChildren(element('h3', '', record['机构名称']));
    const dl = element('dl', 'library-fields');
    for (const field of fields) {
      const dt = element('dt', '', field);
      const dd = element('dd', '', record[field] == null || record[field] === '' ? '未录入' : String(record[field]));
      dl.append(dt, dd);
    }
    detail.append(dl);
  }
  function renderPartners() {
    content.replaceChildren();
    if (!payload?.records?.length) {
      content.append(heading('资源库 · 合作伙伴', '合作伙伴资料仅由本机或已登录的局域网服务提供。'));
      content.append(element('p', 'library-empty', '当前服务没有可查看的合作伙伴记录。公开演示站不包含联系人等资料。'));
      return;
    }
    const records = payload.records;
    const intro = heading('资源库 · 合作伙伴', `${records.length} 家机构 · 来源：${payload.source || '本地文件'} · 仅在本机和登录后的局域网查看`);
    const backup = element('button', 'library-action', '下载本库备份 JSON');
    backup.type = 'button'; backup.onclick = downloadPartners;
    intro.append(backup);
    const controls = element('div', 'library-controls');
    const search = element('input'); search.type = 'search'; search.placeholder = '搜索机构、地区、专业方向、案例';
    search.setAttribute('aria-label', '搜索合作伙伴');
    const category = element('select'); category.setAttribute('aria-label', '按类别筛选');
    category.add(new Option('全部类别', ''));
    for (const value of [...new Set(records.map(row => row['类别']).filter(Boolean))]) category.add(new Option(value, value));
    controls.append(search, category);
    const layout = element('div', 'library-layout');
    const list = element('div', 'library-list');
    const detail = element('div', 'library-detail');
    layout.append(list, detail);
    function filter() {
      const term = search.value.trim().toLocaleLowerCase();
      const matches = records.filter(row => (!category.value || row['类别'] === category.value) &&
        (!term || ['机构名称','所在地区','专业方向','合作项目','优势特长','相关案例'].some(field =>
          String(row[field] ?? '').toLocaleLowerCase().includes(term))));
      list.replaceChildren(element('p', 'library-count', `显示 ${matches.length} / ${records.length} 家机构`));
      for (const row of matches) {
        const button = element('button', 'library-row'); button.type = 'button';
        button.append(element('b', '', row['机构名称']), element('small', '', [row['类别'],row['所在地区'],row['专业方向']].filter(Boolean).join(' · ')));
        button.onclick = () => { list.querySelectorAll('.library-row').forEach(item => item.classList.remove('on')); button.classList.add('on'); showPartnerRecord(row, detail); };
        list.append(button);
      }
      if (matches.length) list.querySelector('.library-row').click();
      else detail.replaceChildren(element('p', 'library-empty', '没有符合条件的记录。'));
    }
    search.oninput = filter; category.onchange = filter;
    content.append(intro, controls, layout); filter();
  }
  async function select(type) {
    active = type;
    nav.querySelectorAll('button[data-library]').forEach(button => {
      button.classList.toggle('on', button.dataset.library === type);
      button.setAttribute('aria-selected', String(button.dataset.library === type));
    });
    if (type !== 'partners') return renderSimple(type);
    if (payload) return renderPartners();
    content.replaceChildren(heading('资源库 · 合作伙伴', '正在读取本机合作伙伴资料…'));
    try {
      const response = await fetch('/api/partner-library', { cache: 'no-store' });
      if (!response.ok) throw Error('此服务未提供资源库');
      const data = await response.json();
      if (!Array.isArray(data.records)) throw Error('资源库格式无效');
      payload = data;
      if (active === 'partners') renderPartners();
    } catch {
      payload = { records: [] };
      if (active === 'partners') renderPartners();
    }
  }
  function init() {
    if (overlay) return;
    const style = element('style');
    style.textContent = `.library-workspace[hidden]{display:none!important}.library-workspace{position:fixed;inset:0;z-index:1002;display:flex;flex-direction:column;background:#edf3f4;color:#17343d;font:14px/1.55 system-ui,-apple-system,"Microsoft YaHei",sans-serif}.library-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px clamp(16px,3vw,46px);background:#fff;border-bottom:1px solid #d5e1e4}.library-head h1{margin:0;font-size:24px}.library-head button,.library-action{border:0;border-radius:9px;background:#17343d;color:#fff;padding:9px 13px;font:inherit;font-weight:700;cursor:pointer}.library-tabs{display:flex;gap:7px;padding:12px clamp(16px,3vw,46px);background:#fff}.library-tabs button{border:1px solid #d2e0e3;background:#f3f7f8;border-radius:9px;padding:9px 15px;color:#45636c;font:inherit;font-weight:700;cursor:pointer}.library-tabs button.on{background:#17343d;color:#fff}.library-content{min-height:0;flex:1;overflow:auto;padding:20px clamp(16px,3vw,46px)}.library-intro h2{font-size:20px;margin:0}.library-intro p{margin:6px 0 12px;color:#526e78}.library-action{margin:3px 0 15px}.library-controls{display:flex;gap:9px;max-width:850px;margin-bottom:15px}.library-controls input{flex:1}.library-controls select{width:180px}.library-layout{display:grid;grid-template-columns:minmax(250px,36%) minmax(0,1fr);gap:14px;min-height:0;height:calc(100% - 140px)}.library-list,.library-detail{background:#fff;border:1px solid #d5e1e4;border-radius:13px;padding:12px;overflow:auto}.library-count{margin:0 0 8px;color:#69818a}.library-row{display:block;text-align:left;width:100%;border:0;border-radius:8px;background:#fff;padding:10px;cursor:pointer;color:#17343d}.library-row:hover,.library-row.on{background:#e7f1f3}.library-row b,.library-row small{display:block}.library-row small{color:#637d85;margin-top:3px}.library-detail h3{font-size:18px;margin:3px 0 15px}.library-fields{display:grid;grid-template-columns:110px minmax(0,1fr);gap:0;margin:0}.library-fields dt,.library-fields dd{border-bottom:1px solid #e7eef0;padding:8px 4px;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.library-fields dt{color:#67808a}.library-empty{padding:20px;color:#68818a;background:#fff;border-radius:12px}@media(max-width:720px){.library-head h1{font-size:19px}.library-tabs{padding:8px;gap:4px}.library-tabs button{flex:1;padding:8px 3px;font-size:12px}.library-content{padding:10px}.library-controls{display:grid}.library-controls select{width:100%}.library-layout{display:block;height:auto}.library-list{max-height:32vh;margin-bottom:8px}.library-detail{max-height:39vh}.library-fields{grid-template-columns:78px minmax(0,1fr)}}`;
    document.head.append(style);
    overlay = element('section', 'library-workspace'); overlay.hidden = true;
    const header = element('header', 'library-head');
    header.append(element('h1', '', 'Urban Renewal Lab · 四库'));
    const closeButton = element('button', '', '返回地图'); closeButton.type = 'button'; closeButton.onclick = close; header.append(closeButton);
    nav = element('nav', 'library-tabs'); nav.setAttribute('aria-label', '四库分类');
    for (const [key, label] of [['policy','政策库'],['partners','资源库'],['projects','项目库'],['scenes','场景库']]) {
      const button = element('button', '', label); button.type = 'button'; button.dataset.library = key;
      button.onclick = () => select(key); nav.append(button);
    }
    content = element('main', 'library-content');
    overlay.append(header, nav, content); document.body.append(overlay);
  }
  root.RenewalLibraries = { open(type = 'partners') { init(); overlay.hidden = false; $('openLibraries')?.classList.add('on'); select(type); }, close };
})(window);
