const assert = require('node:assert/strict');
const { policyScope, applicableSource, projectUse } = require('../lib/policy-scope.cjs');
const { find, describe, refersToSelection } = require('../lib/map-project-query.js');
const { entries } = require('../scripts/check-policy-updates.cjs');

const scope = policyScope('这个项目能减免土地价款吗？', { name: '金桥市场', center: [118.78, 32.08] });
assert.equal(scope.city, '南京市');
assert.equal(scope.use, '商业');
assert.equal(projectUse({ name: '金桥灯饰城更新项目' }), '商业');
assert.equal(applicableSource({ path: '南京市政策文件/关于推进老旧小区改造的实施意见.pdf' }, scope), false);
assert.equal(applicableSource({ path: '南京市政策文件/02居住类地段城市更新规划土地实施细则.pdf' }, scope), false);
assert.equal(applicableSource({ path: '03北京市政策/北京市城市更新办法.pdf' }, scope), false);
assert.equal(applicableSource({ path: '南京市政策文件/南京市城市更新办法.pdf' }, scope), true);
assert.equal(applicableSource({ path: '江苏省政策/江苏省城市更新办法.pdf' }, scope), true);
assert.equal(applicableSource({ path: '国家政策/国务院关于持续推进城市更新.pdf' }, scope), true);
assert.equal(applicableSource({ path: '国家政策/关于北京市城市更新试点的通知.pdf' }, scope), false);
assert.equal(applicableSource({ path: '混合政策/北京市和南京市比较.pdf' }, scope), false);
assert.equal(applicableSource({ path: '南京市政策文件/南京市城市更新办法（征求意见稿）.pdf' }, scope), false);

const projects = [
  { name: '金桥市场更新项目', type: '老旧商业', stage: '前期研究', sourceAttributes: { 项目名称: '金桥市场', 项目编号: 'A01' } },
  { name: '玉桥市场更新项目', type: '老旧商业', stage: '实施' }
];
const result = find('请介绍金桥市场项目信息并定位', projects, () => 2.4, () => [118.78, 32.08]);
assert.equal(result.index, 0);
assert.match(result.text, /金桥市场更新项目/);
assert.match(result.text, /项目编号：A01/);
assert.equal(find('图上有几个项目', projects, () => 1, () => [118, 32]), null);
assert.equal(describe(projects[0], 0, () => 2.4, () => [118.78, 32.08]).index, 0);
assert.equal(refersToSelection('这个项目在哪里？'), true);

const source = { name: '江苏省政府公报', host: 'www.js.gov.cn', url: 'https://www.js.gov.cn/col/col81677/index.html' };
const links = entries('<a href="/art/2026/1.html">关于城市更新的通知</a><a href="https://elsewhere.cn/a">城市更新</a>', source);
assert.equal(links.length, 1);
assert.equal(links[0].url, 'https://www.js.gov.cn/art/2026/1.html');
console.log('Copilot 演示关键路径通过');
