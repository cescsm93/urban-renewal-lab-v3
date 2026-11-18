(function () {
  const form = document.getElementById('copilotForm');
  const answer = document.getElementById('copilotAnswer');
  const sourceBox = document.getElementById('copilotSources');
  if (!form || !answer || !sourceBox) return;
  const modes = [
    ['map', '地图问答'], ['resource', '找资源'], ['policy', '找政策'],
    ['project', '找项目'], ['scene', '找场景']
  ];
  let active = 'map';
  let uploaded = null;
  const style = document.createElement('style');
  style.textContent = '.four-copilot-tabs{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0}.four-copilot-tabs button{border:1px solid #76adb5;border-radius:9px;background:#dceef0;color:#153d46;padding:9px 12px;cursor:pointer}.four-copilot-tabs button.on{background:#114a58;color:white}.four-copilot-project{display:flex;flex-wrap:wrap;gap:10px;align-items:end;padding:12px;margin:10px 0;border:1px solid #a8cbd0;border-radius:12px;background:#e8f3f2}.four-copilot-project label{display:grid;gap:5px;font-size:13px}.four-copilot-project select,.four-copilot-project input{min-width:190px;max-width:100%;padding:9px;border:1px solid #99b9be;border-radius:8px}.four-copilot-card{padding:12px;margin:9px 0;background:#e9f3f3;border:1px solid #b9d5d7;border-radius:10px}.four-copilot-card b,.four-copilot-card span{display:block}.four-copilot-card small{white-space:pre-wrap}.four-copilot-card a{color:#075c76}';
  document.head.append(style);
  const tabs = document.createElement('div');
  tabs.className = 'four-copilot-tabs';
  tabs.setAttribute('aria-label', 'Copilot 查询类别');
  const picker = document.createElement('div');
  picker.className = 'four-copilot-project';
  picker.hidden = true;
  const selectLabel = document.createElement('label');
  selectLabel.textContent = '点选当前项目';
  const select = document.createElement('select');
  select.add(new Option('不指定项目', ''));
  selectLabel.append(select);
  const fileLabel = document.createElement('label');
  fileLabel.textContent = '或上传项目 JSON／GeoJSON';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.json,.geojson,application/json';
  fileLabel.append(file);
  picker.append(selectLabel, fileLabel);
  const note = document.createElement('small');
  note.textContent = '上传文件只在本机读取；仅名称、类型、阶段和面积摘要用于匹配，不上传边界与完整档案。';
  picker.append(note);
  form.before(tabs);
  form.querySelector('textarea').after(picker);
  const submit = form.querySelector('button[type="submit"]');
  function refreshProjects() {
    const current = select.value;
    select.replaceChildren(new Option('不指定项目', ''));
    const rows = window.RenewalCopilotContext?.projects() || [];
    rows.forEach((row, i) => select.add(new Option(row.name || ('项目' + (i + 1)), String(i))));
    const selected = window.RenewalCopilotContext?.selectedProject?.();
    if (selected && rows[selected.index]) select.value = String(selected.index);
    else if (current && rows[Number(current)]) select.value = current;
  }
  function renderSources(sources, matches) {
    sourceBox.replaceChildren();
    const items = Array.isArray(sources) ? sources : Array.isArray(matches) ? matches : [];
    if (!items.length) {
      const p = document.createElement('p');
      p.textContent = '本次没有可展示的匹配项。';
      sourceBox.append(p);
      return;
    }
    if (active === 'policy' && items.every(item => !item.openUrl)) {
      const notice = document.createElement('p');
      notice.textContent = '政策索引已用于本次回答。当前账号只能查看引用标题；原文件仅管理员登录后可打开。';
      sourceBox.append(notice);
    }
    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'four-copilot-card';
      const heading = document.createElement('b');
      heading.textContent = (item.id ? '[' + item.id + '] ' : '') + (item.title || item.name || '候选');
      card.append(heading);
      const meta = document.createElement('span');
      meta.textContent = [
        item.kind, item.page ? '第 ' + item.page + ' 页' : '',
        item.category || item.type, item.region, item.stage,
        item.collection
      ].filter(Boolean).join(' · ');
      card.append(meta);
      if (Array.isArray(item.evidence)) {
        const evidence = document.createElement('small');
        evidence.textContent = item.evidence.join('\n');
        card.append(evidence);
      }
      if (item.description) {
        const description = document.createElement('small');
        description.textContent = item.description;
        card.append(description);
      }
      if (item.openUrl) {
        const link = document.createElement('a');
        link.href = item.openUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = '打开本机原文';
        card.append(link);
      }
      sourceBox.append(card);
    }
  }
  function choose(mode) {
    active = mode;
    for (const button of tabs.querySelectorAll('button')) button.classList.toggle('on', button.dataset.mode === mode);
    picker.hidden = !['map','resource','project','policy'].includes(mode);
    fileLabel.hidden = mode === 'policy' || mode === 'map';
    note.textContent = mode === 'map' ?
      '地图上点选项目会同步到这里；输入项目名称也会自动匹配并定位。' : mode === 'policy' ?
      '按选中项目所在地筛选适用的国家、省、市政策；未指定项目时请在问题中写明城市。' :
      '上传文件只在本机读取；仅名称、类型、阶段和面积摘要用于匹配，不上传边界与完整档案。';
    submit.textContent = mode === 'map' ? '查询地图' : '查询' + modes.find(row => row[0] === mode)[1];
    document.getElementById('askLocalKnowledge').hidden = true;
    document.getElementById('openProjectAssessment').hidden = mode !== 'map';
    document.getElementById('copilotQuestion').placeholder = ({
      map: '例如：图上有多少个产业更新资源？',
      resource: '描述项目的区位、更新类型和需要的专业能力，推荐适合参与的公司',
      policy: '例如：该类城市更新项目有哪些政策条件？',
      project: '输入项目名称、类型或阶段，查询本机已保存的项目',
      scene: '描述要解决的问题，查找适合的场景'
    })[mode];
    answer.textContent = mode === 'map' ? '输入地图问题后查询。' :
      mode === 'policy' ? '选择项目后提问，系统会按项目所在地筛选政策。政策适用条件仍需核对原文。' :
      '输入问题；找资源还可以点选或上传一个项目。结果只作候选，仍需人工核对。';
    sourceBox.replaceChildren();
    if (picker.hidden) file.value = '';
    refreshProjects();
  }
  for (const [mode, label] of modes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.mode = mode;
    button.onclick = () => choose(mode);
    tabs.append(button);
  }
  select.onchange = () => {
    uploaded = null; file.value = '';
    if (select.value !== '') window.RenewalCopilotContext?.focusProject?.(Number(select.value));
  };
  window.RenewalCopilotPicker = {
    selectedIndex: () => select.value === '' ? null : Number(select.value),
    setIndex: index => { if (index != null && select.options[Number(index) + 1]) select.value = String(index); }
  };
  file.onchange = async () => {
    uploaded = null;
    if (!file.files[0]) return;
    if (file.files[0].size > 2 * 1024 * 1024) {
      answer.textContent = '项目文件超过 2 MB；可只输入项目简介。';
      file.value = '';
      return;
    }
    try {
      const data = JSON.parse(await file.files[0].text());
      const row = data.projects?.[0] || data.features?.[0]?.properties || data.properties || data;
      uploaded = {
        name: String(row.name || row['项目名称'] || file.files[0].name).slice(0, 120),
        type: String(row.type || row['更新类型'] || '').slice(0, 80),
        stage: String(row.stage || row['项目阶段'] || '').slice(0, 80),
        areaHa: Number(row.areaHa) || null
      };
      select.value = '';
      answer.textContent = '已读取项目摘要：' + uploaded.name + '。现在输入需求并点击查询。';
    } catch { answer.textContent = '项目文件不是可读取的 JSON／GeoJSON。'; }
  };
  form.addEventListener('submit', async event => {
    if (active === 'map') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const question = document.getElementById('copilotQuestion').value.trim();
    if (!question) return;
    const rows = window.RenewalCopilotContext?.projects() || [];
    const project = uploaded || (select.value && rows[Number(select.value)]) || null;
    submit.disabled = true;
    answer.textContent = '正在从本机资料中检索…';
    sourceBox.replaceChildren();
    try {
      const response = await fetch('/api/four-copilot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: active, question, project }),
        signal: AbortSignal.timeout(125000)
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '查询失败');
      answer.textContent = data.answer;
      renderSources(data.sources, data.matches);
    } catch (error) { answer.textContent = '本地查询未完成：' + error.message; }
    finally { submit.disabled = false; }
  }, true);
  document.getElementById('openCopilot').addEventListener('click', refreshProjects);
  choose('map');
})();
