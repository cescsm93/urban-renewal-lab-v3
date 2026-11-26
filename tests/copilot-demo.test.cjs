const assert = require('node:assert/strict');
const { policyScope, applicableSource, projectUse } = require('../lib/policy-scope.cjs');
const { find, describe, refersToSelection, nearbyIntent, housingAnswer, poiAnswer } = require('../lib/map-project-query.js');
const { entries } = require('../scripts/check-policy-updates.cjs');

const scope = policyScope('这个项目能减免土地价款吗？', { name: '样例甲市场', center: [118.78, 32.08] });
assert.equal(scope.city, '南京市');
assert.equal(scope.use, '商业');
assert.equal(projectUse({ name: '样例灯饰城更新项目' }), '商业');
assert.equal(applicableSource({ path: '南京市政策文件/样例老旧小区规则.pdf' }, scope), false);
assert.equal(applicableSource({ path: '南京市政策文件/样例住宅用地规则.pdf' }, scope), false);
assert.equal(applicableSource({ path: '北京市示例政策/北京示例办法.pdf' }, scope), false);
assert.equal(applicableSource({ path: '南京市政策文件/南京市示例办法.pdf' }, scope), true);
assert.equal(applicableSource({ path: '江苏省政策/江苏省示例办法.pdf' }, scope), true);
assert.equal(applicableSource({ path: '国家政策/国家政策示例.pdf' }, scope), true);
assert.equal(applicableSource({ path: '国家政策/关于北京市城市更新试点的通知.pdf' }, scope), false);
assert.equal(applicableSource({ path: '混合政策/北京市和南京市比较.pdf' }, scope), false);
assert.equal(applicableSource({ path: '南京市政策文件/南京市示例办法（征求意见稿）.pdf' }, scope), false);

const projects = [
  { name: '样例甲市场更新项目', type: '老旧商业', stage: '前期研究', sourceAttributes: { 项目名称: '样例甲市场', 项目编号: 'TEST-01' } },
  { name: '样例乙市场更新项目', type: '老旧商业', stage: '实施' }
];
const result = find('请介绍样例甲市场项目信息并定位', projects, () => 2.4, () => [118.78, 32.08]);
assert.equal(result.index, 0);
assert.match(result.text, /样例甲市场更新项目/);
assert.match(result.text, /项目编号：TEST-01/);
assert.equal(find('图上有几个项目', projects, () => 1, () => [118, 32]), null);
assert.equal(describe(projects[0], 0, () => 2.4, () => [118.78, 32.08]).index, 0);
assert.equal(refersToSelection('这个项目在哪里？'), true);

assert.equal(nearbyIntent('离这个项目最近的地铁站在哪').category, '地铁站');
assert.equal(nearbyIntent('这个项目周边1.5公里哪个小区最贵').radius, 1500);
assert.equal(nearbyIntent('项目500米内有哪些POI').radius, 500);
assert.equal(nearbyIntent('这个项目的面积是多少'), null);
const groups = [{name:'甲',sum:120,count:2,value:60}, {name:'乙',sum:85,count:1,value:85}];
assert.equal(housingAnswer(groups, nearbyIntent('周边最贵的小区'), '测试').place.name, '乙');
assert.match(poiAnswer({}, '地铁站', '测试').text, /没有匹配/);
const { operatingMetroGroup } = require('../lib/map-project-query.js');
const { distance } = require('../lib/brief-sheet.js');
const center = [0, 0];
const catalog = { stations: [
  { name: '样例乙', point: [0, 0.013], lines: ['B线'] },
  { name: '样例甲', point: [0, 0.006], lines: ['A线'] }
] };
const metro = operatingMetroGroup(catalog, center, 2000, distance);
const subway = poiAnswer({ '地铁站': metro }, '地铁站', '测试');
assert.equal(subway.place, metro.nearest[0]);
assert.equal(subway.place.name, '样例甲站');
assert.match(subway.text, /A线.*667 米/);
assert.equal(operatingMetroGroup(catalog, center, 500, distance).count, 0);
assert.equal(operatingMetroGroup(catalog, center, 700, distance).count, 1);
assert.equal(poiAnswer({ '地铁站': { count: 1, nearest: [{ name: '待核实样例站' }] } }, '地铁站', '测试').place, undefined);

const source = { name: '示例公报', host: 'bulletin.example', url: 'https://bulletin.example/bulletins/index.html' };
const links = entries('<a href="/art/2026/1.html">关于城市更新的通知</a><a href="https://elsewhere.example/a">城市更新</a>', source);
assert.equal(links.length, 1);
assert.equal(links[0].url, 'https://bulletin.example/art/2026/1.html');
console.log('Copilot 演示关键路径通过');
