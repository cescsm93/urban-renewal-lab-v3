const assert = require('node:assert/strict');
const { buildEvidence } = require('../lib/project-assessment.js');
const { validateAssessment, validateAssessmentResult } = require('../lib/project-assessment.cjs');

const input = {
  project: { type:'老旧厂区', currentUse:'工业', plannedUse:'居住', plannedLandArea:2.4, plannedFar:2, plannedGfa:48000 },
  center: [118.78,32.01], areaHa: 2.5, radius: 1000,
  poiLoaded: true, pois: [{ name:'样例小学', type:'教育', point:[118.781,32.011] }],
  walk: { origin:[118.9,32.01], results:[{ duration:180 }] }
};
const evidence = buildEvidence(input);
assert.match(evidence.find(row => row.id === 'F3').value, /教育 1 处/);
assert.match(evidence.find(row => row.id === 'F3').value, /样例小学/);
assert.match(evidence.find(row => row.id === 'F3').source, /未出现的类别需另行核查/);
assert.equal(evidence.some(row => row.id === 'F4'), false);
assert.equal(evidence.some(row => row.id === 'G4'), true);
assert.equal(evidence.some(row => row.id === 'G5'), true);
const assessment = validateAssessment({ question:'考虑居住更新，需先核实什么？', evidence });
assert.deepEqual(assessment.evidence, evidence);
assert.throws(() => validateAssessment({ question:'研判', evidence:[evidence[0], evidence[0]] }), /编号/);

const report = {
  overview: { text:'录入的居住情景有待核实法定用途。', refs:['F2','G1'] },
  findings: [
    { kind:'机会', text:'教育点位可作为核查设施服务范围的线索。', refs:['F3'] },
    { kind:'不确定', text:'尚缺匹配地块的步行路线。', refs:['G4'] }
  ],
  checks: [
    { action:'查现行控规和权籍', reason:'确认用途准入', refs:['G1'] },
    { action:'在实际出入口复核步行路线', reason:'补足路线证据', refs:['G4'] },
    { action:'按租售与成本假设测算', reason:'建立经济情景', refs:['G5'] }
  ]
};
assert.deepEqual(validateAssessmentResult(report, evidence), report);
assert.throws(() => validateAssessmentResult({ ...report, overview:{...report.overview, refs:['F99']} }, evidence), /无法核对/);
assert.throws(() => validateAssessmentResult({
  ...report, overview: { text:'周边公共服务设施较为缺乏，改造可以填补服务空白。', refs:['F3'] }
}, evidence), /未经核实/);
console.log('PASS project evidence, missing-data distinction, source citations and unsupported service inference guard');
