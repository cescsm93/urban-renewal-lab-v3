(function (root, brief) {
  const clean = (value, max = 36) => String(value ?? '').trim().slice(0, max) || '待核实';
  const number = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '未提供';

  function buildEvidence(input) {
    const summary = brief.summarize(input);
    const project = summary.project;
    const evidence = [];
    const fact = (id, label, value, source) => evidence.push({ id, label, value, source });
    const gap = (id, label, value) => fact(id, label, value, '当前项目证据缺项');
    fact('F1', '地块现状', '边界面积 ' + number(summary.areaHa, 2) + ' 公顷，档案分类 ' + clean(project.type) +
      '，录入的现状用途 ' + clean(project.currentUse) + '，现状建筑面积 ' + (project.existingGfa > 0 ? number(project.existingGfa, 0) + ' ㎡' : '未有可用记录') + '。',
    '更新资源档案与地图边界计算。录入用途需核实。');
    fact('F2', '规划测算情景', '拟定用途 ' + clean(project.plannedUse) +
      '，规划用地 ' + number(project.plannedLandArea, 2) + ' 公顷，容积率 ' + number(project.plannedFar, 2) +
      '，规划建筑面积 ' + number(project.plannedGfa, 0) + ' ㎡。',
    '资源档案参数，可能含平台默认值。仅表示拟测情景。');

    if (summary.poiLoaded) {
      const counts = Object.entries(summary.groups).filter(([, count]) => count > 0)
        .map(([name, count]) => name + ' ' + count + ' 处').join('、');
      const nearby = summary.pois.filter(poi => /学校|幼儿园|医院|卫生|公园|教育|医疗/.test(poi.type + ' ' + poi.name))
        .map(poi => ({ name:clean(poi.name, 24), distance:brief.distance(summary.center, poi.point) }))
        .sort((a, b) => a.distance - b.distance).slice(0, 3);
      const examples = nearby.length ? '公服样本线索 ' + nearby.map(poi => poi.name + '（直线约 ' +
        Math.round(poi.distance) + ' 米）').join('、') + '。' : '';
      fact('F3', '周边 POI 样本', '以地块中心 ' + number(summary.radius / 1000) + ' 公里内，本次已加载 ' +
        summary.pois.length + ' 处。' + (counts ? counts + '。' : '') + examples,
      '高德本页查询结果。' + (summary.poiQueryComplete ? '受收录和分类口径限制。' : '仅已加载分页。') + '未出现的类别需另行核查。点位不反映供给容量。');
    } else gap('G3', '周边公服与业态', '尚无匹配本地块及研究半径的周边 POI 查询。');

    if (summary.walk) {
      const routes = (summary.walk.results || []).filter(route => Number.isFinite(route.duration));
      const limits = [5, 10, 15].map(min => min + ' 分钟内 ' + routes.filter(route => route.duration <= min * 60).length + ' 条').join('、');
      fact('F4', '步行路线样本', '从地块中心附近起算，成功获得 ' + routes.length + ' 条路线。' + limits + '。',
        '高德步行路径，本次候选设施。未覆盖未查询设施与实际出入口。');
    } else gap('G4', '步行可达性', '未获得从本地块中心附近出发的步行路线结果。');

    const enterprise = project.entCalc;
    const government = project.govCalc;
    if (enterprise || government) {
      const enterpriseText = enterprise ? '企业投资 ' + number(enterprise.investment, 0) + ' 万元，项目 IRR ' +
        (Number.isFinite(enterprise.projectIrr) ? number(enterprise.projectIrr * 100) + '%' : '未算出') +
        '，净现值 ' + number(enterprise.npv, 0) + ' 万元。' : '企业测算缺失。';
      const governmentText = government ? '政府净收益 ' + number(government.net, 0) + ' 万元。' : '政府测算缺失。';
      fact('F5', '经济情景结果', enterpriseText + governmentText,
        '资源档案的已运行测算。结果取决于租金、造价、开发时序等人工假设。');
    } else gap('G5', '经济测算', '本项目尚未运行经济测算。需要核实租金或售价、造价及更新成本。');

    for (const [key, id, label, unit] of [
      ['housing', '6', '住宅价格', '元/㎡'],
      ['rent', '7', '商业租金', '元/㎡·月']
    ]) {
      const topic = input.market?.[key];
      if (topic?.count > 0 && Number.isFinite(topic.mean)) {
        fact('F' + id, label + '样本', '本范围内匹配 ' + topic.count + ' 条，上传样本均值 ' + number(topic.mean, 0) + ' ' + unit + '。',
          clean(topic.source, 70) + ' · ' + clean(topic.date, 12) + '。受样本类型和时点限制。');
      } else gap('G' + id, label, '缺少有来源和日期的可比样本。');
    }

    if (input.programEvidence) evidence.push(input.programEvidence);
    gap('G1', '法定规划与权属', '需查阅现行控规、权籍、用途准入及相关限制。档案中的规划参数仍是情景假设。');
    gap('G2', '实际使用与现场条件', '需核实建筑安全、场地历史与环境风险、实际出入口、服务容量和人口需求。');
    return evidence;
  }

  function mount({ container, getInput }) {
    const section = document.createElement('section');
    section.id = 'wsAssessment';
    section.className = 'ws-data';
    section.innerHTML = `
      <h3>Qwen 项目前期研判</h3>
      <p>模型基于选中项目的资料给出初筛判断和优先核查事项。完成上一步用途研判后，计算结果会自动加入证据。</p>
      <label>希望研判的情景<textarea id="wsAssessmentQuestion" maxlength="300" rows="3"
        placeholder="例如：这块老厂区考虑改为居住，现有资料支持什么判断？"></textarea></label>
      <button type="button" class="ws-tool" id="wsAssessmentResidential">试问居住更新</button>
      <button type="button" class="ws-tool" id="wsAssessmentEconomy">试问实施与经济</button>
      <button type="button" class="primary" id="wsRunAssessment">生成前期研判</button>
      <p id="wsAssessmentStatus" role="status">先选择一个地块。建议查询周边 POI 或完成测算后再研判。</p>
      <div id="wsAssessmentResult"></div>
      <details id="wsAssessmentEvidence" hidden><summary>本次证据与缺项</summary><div id="wsAssessmentRows"></div></details>
    `;
    container.insertBefore(section, container.querySelector('#wsDeliver'));
    const $ = id => section.querySelector('#' + id);
    const question = $('wsAssessmentQuestion');
    const run = $('wsRunAssessment');
    const status = $('wsAssessmentStatus');
    const result = $('wsAssessmentResult');
    const details = $('wsAssessmentEvidence');
    const rows = $('wsAssessmentRows');
    let revision = 0;
    let pending;
    const append = (parent, tag, text) => {
      const element = document.createElement(tag);
      element.textContent = text;
      parent.append(element);
      return element;
    };
    const invalidate = () => {
      revision++;
      pending?.abort();
      pending = null;
      run.disabled = false;
      result.replaceChildren();
      rows.replaceChildren();
      details.hidden = true;
      status.textContent = '项目或研究条件已变更，请重新生成。';
    };
    const example = text => {
      question.value = text;
      invalidate();
      question.focus();
    };
    $('wsAssessmentResidential').onclick = () => example('如果这个地块考虑转为居住更新，现有资料支持什么判断？请分析公服和规划条件，并给出最先核查的三项。');
    $('wsAssessmentEconomy').onclick = () => example('按当前拟定用途，项目是否值得继续深化？请结合经济测算和实施条件，列出影响判断的三项核查任务。');
    question.addEventListener('input', invalidate);
    for (const id of ['wsProject', 'wsRadius']) container.querySelector('#' + id).addEventListener('input', invalidate);

    function renderEvidence(evidence) {
      rows.replaceChildren();
      for (const entry of evidence) {
        const card = document.createElement('div');
        card.className = 'method-card';
        card.id = 'wsEvidence-' + entry.id;
        append(card, 'b', '[' + entry.id + '] ' + entry.label);
        append(card, 'p', entry.value);
        append(card, 'small', entry.source);
        rows.append(card);
      }
      details.hidden = false;
    }

    function citations(parent, refs) {
      for (const ref of refs) {
        const button = append(parent, 'button', '[' + ref + ']');
        button.type = 'button';
        button.className = 'ws-tool';
        button.onclick = () => {
          details.open = true;
          $('wsEvidence-' + ref)?.scrollIntoView({ block: 'nearest' });
        };
      }
    }

    function renderResult(report) {
      const overview = document.createElement('div');
      overview.className = 'method-card';
      append(overview, 'b', '初步判断');
      append(overview, 'p', report.overview.text);
      citations(overview, report.overview.refs);
      result.append(overview);

      append(result, 'h3', '机会、约束与不确定性');
      for (const item of report.findings) {
        const row = append(result, 'p', item.kind + ' · ' + item.text);
        citations(row, item.refs);
      }
      append(result, 'h3', '优先核查的三项工作');
      const list = document.createElement('ol');
      for (const item of report.checks) {
        const row = append(list, 'li', item.action);
        append(row, 'p', item.reason);
        citations(row, item.refs);
      }
      result.append(list);
    }

    run.onclick = async () => {
      let input;
      try { input = getInput(); }
      catch (error) { status.textContent = error.message; return; }
      const evidence = buildEvidence(input);
      const fingerprint = JSON.stringify([input.project.name, input.center, input.radius, evidence]);
      const request = ++revision;
      const controller = new AbortController();
      pending = controller;
      renderEvidence(evidence);
      result.replaceChildren();
      run.disabled = true;
      status.textContent = clean(input.project.name, 100) + ' · 正在用本机 Qwen 分析本次证据…';
      try {
        const response = await fetch('/api/copilot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'assessment',
            question: question.value.trim() || '按当前拟定用途，判断项目值得继续核实的机会与主要约束，并给出三项优先核查行动。',
            evidence
          }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(95000)])
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || '研判服务暂不可用');
        if (request !== revision) return;
        const latest = getInput();
        if (JSON.stringify([latest.project.name, latest.center, latest.radius, buildEvidence(latest)]) !== fingerprint) {
          invalidate();
          return;
        }
        if (data.mode !== 'assessment' || !data.result) throw Error('请用新版服务启动后再研判');
        renderResult(data.result);
        status.textContent = clean(input.project.name, 100) + ' · 初筛建议 · 点编号查看依据';
      } catch (error) {
        if (request === revision) status.textContent = '未生成研判。' + error.message + '。可展开查看本次证据。';
      } finally {
        if (request === revision) {
          pending = null;
          run.disabled = false;
        }
      }
    };
    return {
      invalidate,
      ask(text) {
        example(text);
        section.scrollIntoView({ block:'start' });
      }
    };
  }

  const api = { buildEvidence, mount };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RenewalAssessment = api;
})(typeof window === 'undefined' ? globalThis : window,
   typeof module === 'object' && module.exports ? require('./brief-sheet') : window.RenewalBrief);
