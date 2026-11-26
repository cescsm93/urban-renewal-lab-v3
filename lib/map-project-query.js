(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RenewalProjectQuery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function compact(value) {
    return String(value || '').toLowerCase().replace(/[\s·•（）()《》【】\[\]，,。.!！?？:：\-—_]/g, '');
  }
  function aliases(name) {
    const full = compact(name);
    const shorter = full.replace(/(?:城市)?更新(?:项目|资源)$/, '').replace(/项目$/, '');
    return [...new Set([full, shorter].filter(value => value.length >= 3))];
  }
  function refersToSelection(question) {
    return /这个项目|该项目|当前项目|选中项目|所选项目|它的|它在|这里|这块地|这个地块/.test(String(question || ''));
  }
  function find(question, projects, areaOf, centerOf) {
    const query = compact(question);
    if (!query || !Array.isArray(projects)) return null;
    const matches = projects.flatMap((project, index) => aliases(project.name)
      .filter(alias => query.includes(alias))
      .map(alias => ({ project, index, alias })));
    if (!matches.length) return null;
    matches.sort((a, b) => b.alias.length - a.alias.length ||
      Number(!!b.project.archiveDbId) - Number(!!a.project.archiveDbId) ||
      Number(!!b.project.sourceAttributes) - Number(!!a.project.sourceAttributes));
    const top = matches[0];
    if (matches.some(item => item.index !== top.index && item.alias.length === top.alias.length && item.project.name !== top.project.name))
      return { text: '找到多个名称相近的项目，请补充完整项目名称。', index: null };
    return describe(top.project, top.index, areaOf, centerOf);
  }
  function describe(project, index, areaOf, centerOf) {
    if (!project || !Number.isInteger(index)) return null;
    const center = centerOf(project);
    const area = areaOf(project);
    const attrs = project.sourceAttributes && typeof project.sourceAttributes === 'object' ?
      Object.entries(project.sourceAttributes).filter(([key, value]) =>
        !key.startsWith('_') && value != null && String(value).trim() &&
        typeof value !== 'object').slice(0, 12).map(([key, value]) => `${key}：${String(value).slice(0, 120)}`) : [];
    const lines = [
      `项目：${project.name}`,
      `类型：${project.type || '未录入'}`,
      `阶段：${project.stage || '未录入'}`,
      `边界面积：${Number.isFinite(area) ? area.toFixed(3) + ' 公顷' : '未录入'}`,
      `位置：${Array.isArray(center) ? center.map(n => Number(n).toFixed(5)).join('，') : '未录入'}（经纬度）`,
      ...attrs
    ];
    return { index, name: project.name, text: lines.join('\n'), details: lines };
  }
  function unknownNamedProject(question) {
    const before = question.split('项目')[0];
    if (before === question || refersToSelection(question)) return false;
    return /[\u4e00-\u9fff]{2,}(?:更新|市场|广场|中心|园区|小区|片区)$/.test(before);
  }
  const categories = [
    [/地铁|轨道交通/, '地铁站'], [/公交/, '公交站'], [/餐饮|餐厅|饭店|吃饭/, '餐饮'],
    [/购物|商场|商业网点/, '购物'], [/医疗/, '医疗'], [/教育文化/, '教育文化'], [/景点|景区/, '景点']
  ];
  function nearbyIntent(question) {
    const category = categories.find(([pattern]) => pattern.test(question))?.[1];
    const housing = /房价|住宅价格|小区.*(?:最贵|最便宜|均价)|(?:最贵|最便宜|价格最高|价格最低).*小区/.test(question);
    if (!housing && !category && !/\bpoi\b|兴趣点/i.test(question)) return null;
    const match = question.match(/(-?\d+(?:\.\d+)?)\s*(公里|千米|km|米|m)(?![²㎡])/i);
    const radius = match ? Math.round(Number(match[1]) * (/^(?:米|m)$/i.test(match[2]) ? 1 : 1000)) : 2000;
    return {category,housing,radius,cheap:/便宜|最低/.test(question),rank:/最贵|最高|便宜|最低/.test(question)};
  }
  function housingAnswer(groups, intent, source) {
    if (!groups.length) return {text:'研究圈内没有住宅价格样本。',source};
    const count = groups.reduce((n,g)=>n+g.count,0);
    const mean = groups.reduce((n,g)=>n+g.sum,0)/count;
    const price = n=>Math.round(n).toLocaleString('zh-CN')+' 元/㎡';
    if (!intent.rank) return {places:groups,text:count+' 条住宅样本，分属 '+groups.length+' 个名称分组，样本均价 '+price(mean)+'。',source};
    const extreme = (intent.cheap ? Math.min : Math.max)(...groups.map(g=>g.value));
    const hits = groups.filter(g=>g.value===extreme);
    return {text:'样本均价'+(intent.cheap?'最低':'最高')+'的小区为 '+hits.map(g=>g.name+'（'+g.count+' 条样本）').join('、')+'，'+price(extreme)+'。共比较 '+groups.length+' 个名称分组。',source,places:hits,place:hits[0]};
  }
  function operatingMetroGroup(catalog, center, radius, distance) {
    if (!catalog?.stations?.length) return { operating: false, count: 0, nearest: [] };
    const stations = catalog.stations.map(station => ({
      name: station.name.endsWith('站') ? station.name : station.name + '站',
      point: station.point, lines: station.lines, meters: distance(center, station.point)
    })).filter(station => station.meters <= radius).sort((a, b) => a.meters - b.meters);
    return { operating: true, count: stations.length, nearest: stations.slice(0, 3) };
  }
  function poiAnswer(summary, category, source) {
    const groups = Object.entries(summary);
    if (!category) return {places:groups.flatMap(([,g])=>g.nearest.slice(0,3)),text:groups.length?'圈内收录的 POI 点位：'+groups.map(([k,v])=>k+' '+v.count+' 处').join('、')+'。地图标出各类最近的最多 3 处。':'研究圈内没有匹配的 POI 记录。',source};
    const group=summary[category], first=group?.nearest[0];
    if (category === '地铁站' && !group?.operating) return {text:'当前数据无法核实地铁站是否已开通。',source};
    if (!first) return {text:category==='地铁站'?'研究圈内没有收录的已开通车站。':'研究圈内没有匹配的'+category+'点位。',source};
    if (category === '地铁站') {
      return {text:'收录的已开通车站中最近的是 '+first.name+'（'+first.lines.join('、')+'），距项目中心直线约 '+Math.round(first.meters)+' 米。圈内共有 '+group.count+' 座已开通车站。',source,place:first};
    }
    return {text:'收录点位中最近的'+category+'是 '+first.name+'，距项目中心直线约 '+Math.round(first.meters)+' 米。'+(first.address?'地址：'+first.address+'。':'')+'圈内共匹配 '+group.count+' 条点位记录。',source,place:first};
  }

  return { find, describe, refersToSelection, unknownNamedProject, nearbyIntent, housingAnswer, operatingMetroGroup, poiAnswer };
});
