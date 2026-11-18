const path = require('node:path');

const NANJING = Object.freeze({ city:'南京市', province:'江苏省', label:'国家、江苏省、南京市' });
const foreignRegion = /北京|上海|深圳|广州|无锡|苏州|泰州|连云港|杭州|成都|重庆|天津|武汉|西安|合肥|郑州|长沙|厦门|福州|济南|青岛|沈阳|大连|长春|哈尔滨|昆明|贵阳|南宁|海口|石家庄|太原|呼和浩特|银川|兰州|西宁|乌鲁木齐|拉萨|香港|澳门|台湾|浙江|广东|安徽|山东|福建|湖北|湖南|四川|陕西|河南|河北|山西|江西|辽宁|吉林|黑龙江|海南|广西|云南|贵州|甘肃|青海|宁夏|新疆|西藏|内蒙古/;
const national = /国家政策|中华人民共和国|国务院|中共中央|全国人大|住房和城乡建设部|住房城乡建设部|自然资源部|财政部|国家发展改革委|国家标准|国办发|国发〔/;

function policyScope(question, project) {
  const point = project?.center;
  const inNanjing = Array.isArray(point) && point.length >= 2 &&
    Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
    point[0] >= 118.4 && point[0] <= 119.3 && point[1] >= 31.2 && point[1] <= 32.6;
  const projectText = [project?.region, project?.location, project?.name].filter(Boolean).join(' ');
  if (inNanjing || /南京/.test(projectText) || /南京/.test(String(question || ''))) return NANJING;
  return null;
}

function applicableSource(row, scope) {
  const sourcePath = String(row.path || '').replaceAll('\\', '/');
  const folder = sourcePath.split('/')[0];
  const title = String(row.title || path.basename(sourcePath));
  if (/征求意见|草案|送审稿|讨论稿/.test(title) || /征求意见|草案|送审稿|讨论稿/.test(sourcePath)) return false;
  if (!scope) return true;
  if (foreignRegion.test(title)) return false;
  if (/南京/.test(folder)) return true;
  if (/江苏/.test(folder)) return true;
  if (/国家政策/.test(folder)) return true;
  if (foreignRegion.test(folder)) return false;
  if (/南京/.test(title) && !foreignRegion.test(title)) return true;
  if (/江苏/.test(title) && !foreignRegion.test(title)) return true;
  if (foreignRegion.test(title)) return false;
  return national.test(title);
}

module.exports = { policyScope, applicableSource };
