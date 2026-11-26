const CATEGORIES = new Set(['industrial', 'residential', 'public', 'commercial', 'other']);
const CATEGORY_NAMES = {industrial:'产业', residential:'居住', public:'公服', commercial:'商业', other:'其他'};
const METRICS = new Set(['count', 'area', 'largest', 'breakdown', 'find', 'help']);
const SCOPES = new Set(['all', 'view', 'filter']);

function validateInput(data) {
  const question = String(data?.question || '').trim();
  if (question.length < 2 || question.length > 300) throw Error('请输入 2 至 300 字的问题');
  if (!Array.isArray(data?.resources) || data.resources.length > 300) throw Error('资源数据过多，请缩小项目后重试');
  const resources = data.resources.map((r, index) => {
    if (!r || !Number.isInteger(r.index) || r.index < 0 || r.index > 100000 ||
      typeof r.name !== 'string' || r.name.length > 100 ||
      typeof r.type !== 'string' || r.type.length > 100 ||
      !CATEGORIES.has(r.category) || !Number.isFinite(r.areaHa) || r.areaHa < 0 || r.areaHa > 10000000) throw Error(`第 ${index + 1} 个资源数据无效`);
    return {index:r.index, name:r.name, type:r.type, category:r.category,
      areaHa:r.areaHa, inView:r.inView === true, inFilter:r.inFilter === true};
  });
  return {question, resources};
}

function normalizeIntent(raw) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object') throw Error('模型没有返回可识别的查询意图');
  const metric = METRICS.has(value.metric) ? value.metric : 'help';
  const scope = SCOPES.has(value.scope) ? value.scope : 'all';
  const category = CATEGORIES.has(value.category) ? value.category : null;
  const searchText = typeof value.searchText === 'string' ? value.searchText.trim().slice(0, 60) : '';
  return {metric, scope, category, searchText};
}

function answer(input, intent) {
  let rows = input.resources;
  if (intent.scope === 'view') rows = rows.filter(r => r.inView);
  if (intent.scope === 'filter') rows = rows.filter(r => r.inFilter);
  if (intent.category) rows = rows.filter(r => r.category === intent.category);
  const scopeName = intent.scope === 'view' ? '当前视野（按资源中心点）' : intent.scope === 'filter' ? '当前筛选结果' : '全部资源';
  const label = scopeName + (intent.category ? '中的' + CATEGORY_NAMES[intent.category] + '类' : '');
  const source = '\n依据：当前浏览器中已录入的资源档案；面积由多边形边界计算。';
  if (intent.metric === 'help') return {text:'可以问资源数量、分类、面积合计、最大面积资源，或按名称查找。也可以指定“当前视野”或“当前筛选结果”。' + source, index:null};
  if (intent.metric === 'find') {
    if (!intent.searchText) return {text:'请说出要查找的资源名称。' + source, index:null};
    rows = rows.filter(r => r.name.includes(intent.searchText));
  }
  if (!rows.length) return {text:label + '没有匹配的更新资源。' + source, index:null};
  if (intent.metric === 'largest') {
    const largest = rows.reduce((best, r) => r.areaHa > best.areaHa ? r : best);
    return {text:`${label}最大面积资源是“${largest.name}”，面积 ${largest.areaHa.toFixed(3)} 公顷。点击“定位结果”可在地图上查看。${source}`, index:largest.index};
  }
  if (intent.metric === 'find') return {text:`找到 ${rows.length} 个名称匹配“${intent.searchText}”的资源：${rows.slice(0, 8).map(r => r.name).join('、')}${rows.length > 8 ? '等' : ''}。${source}`, index:rows[0].index};
  if (intent.metric === 'breakdown') {
    const counts = Object.fromEntries(Object.keys(CATEGORY_NAMES).map(k => [k, 0]));
    for (const r of rows) counts[r.category]++;
    return {text:`${label}共 ${rows.length} 处：${Object.entries(counts).filter(([,n])=>n).map(([k,n])=>`${CATEGORY_NAMES[k]} ${n} 处`).join('；')}。${source}`, index:null};
  }
  const total = rows.reduce((sum,r) => sum + r.areaHa, 0);
  const note = '重叠资源的面积会重复计入。';
  if (intent.metric === 'area') return {text:`${label}面积合计 ${total.toFixed(3)} 公顷，共 ${rows.length} 处。${note}${source}`, index:null};
  return {text:`${label}共 ${rows.length} 处，面积合计 ${total.toFixed(3)} 公顷。${note}${source}`, index:null};
}

module.exports = {validateInput, normalizeIntent, answer};
