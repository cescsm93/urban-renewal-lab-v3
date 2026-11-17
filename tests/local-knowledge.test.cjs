const assert = require('node:assert/strict');
const { pdfTerms, passageForRerank, searchNotesByTerms, hybridCandidates } = require('../lib/local-knowledge.cjs')._test;

const longQuestion = '请结合上海市城市更新规划土地实施细则，说明公共空间、公共服务设施、交通设施、市政设施、轨道交通站点和主城区以外地区的规定，以及更新地块内现状包含公共空间但未向公众开放的奖励规则';
assert.ok(pdfTerms(longQuestion).some(term => term.includes('未向公众') || term.includes('向公众开')),
  '长问题末尾的限定条件应参与关键词检索');

const clause = '更新地块内现状包含公共空间但未向公众开放的，经更新后向公众开放，按照不能划示独立用地的公共开放空间奖励面积倍数执行。';
const content = `资料：某政策\n栏目：附件\n${'公共空间和公共服务设施。'.repeat(55)}\n${clause}`;
assert.ok(passageForRerank('未向公众开放的公共空间更新后，奖励面积如何计算？', content).includes(clause),
  '重排模型应看到材料后半段的直接依据');

const notes = [
  { title: '城市更新养老设施政策', path: '养老.md', content: '养老设施配置应结合老年人口分布。' },
  { title: '商办楼宇', path: '楼宇.md', content: '办公楼宇运维。' }
];
const keywordHits = searchNotesByTerms(notes, '城市更新项目养老设施怎么配置');
assert.equal(keywordHits[0].path, '养老.md');
assert.ok(hybridCandidates([], [], [], 14, keywordHits).some(row => row.path === '养老.md'),
  '向量结果遗漏时，笔记关键词仍能进入候选集');

console.log('local knowledge retrieval tests passed');
