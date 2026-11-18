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
    const project = top.project;
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
    return { index: top.index, name: project.name, text: lines.join('\n'), details: lines };
  }
  return { find };
});
