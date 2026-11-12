(function (root) {
  'use strict';

  const methods = {
    apartment: { name: '租赁公寓', demand: 'apartment_demand', unit: '套' },
    elder_daycare: { name: '养老日间照料', demand: 'elderly', unit: '托位', radius: 500, keywords: '日间照料|日间照护|日托中心|托老所' },
    elder_meal: { name: '老年助餐', demand: 'elderly', unit: '日供餐份数', radius: 500, keywords: '长者食堂|老年食堂|老年助餐|长者助餐' },
    primary_school: { name: '小学', demand: 'primary_age', unit: '学位', radius: 500, keywords: '小学' },
    middle_school: { name: '初中', demand: 'middle_age', unit: '学位', radius: 1000, keywords: '初级中学|初中' },
    kindergarten: { name: '幼儿园', demand: 'preschool_age', unit: '学位', radius: 300, keywords: '幼儿园' },
    clinic: { name: '社区卫生服务', demand: '', unit: '日接诊能力', radius: 500, keywords: '社区卫生服务中心|社区卫生服务站' }
  };

  const isCount = value => Number.isSafeInteger(value) && value >= 0;
  const label = (value, fallback) => String(value || fallback).slice(0, 80);
  const facilityReach = (input, radius, gis) => gis.coordAll(gis.feature(input.geometry || input.project.geometry))
    .reduce((max, coord) => Math.max(max, gis.distance(input.center, coord, { units:'meters' })), input.radius) + radius;

  function validateSupply(collection) {
    const seen = new Set();
    for (const feature of collection.features) {
      const { geometry, properties } = feature;
      if (geometry.type !== 'Point' || !Object.hasOwn(methods, properties?.kind)) {
        throw Error('供给台账需为点图层，且每条记录需填写支持的 kind');
      }
      if (properties.value != null && !isCount(properties.value)) {
        throw Error('供给量 value 需为非负整数；缺失可留空');
      }
      const id = properties.id;
      if (id != null && id !== '') {
        const key = JSON.stringify([properties.kind, String(id)]);
        if (seen.has(key)) throw Error('同一类型有重复的设施或公寓 ID');
        seen.add(key);
      }
    }
  }

  function evaluate(input, options, gis) {
    const { kind, radius, inventoryChecked, population, supply } = options;
    const method = methods[kind];
    const isApartment = kind === 'apartment';
    const center = gis.point(input.center);
    const site = gis.feature(input.geometry || input.project.geometry);
    const siteArea = gis.area(site);
    if (!(siteArea > 0)) throw Error('请先完成有效的地块边界');
    const distance = (a, b) => gis.distance(a, b, { units: 'meters' });
    const study = gis.circle(center, input.radius, { steps: 64, units: 'meters' });
    const cutoff = isApartment ? input.radius : facilityReach(input, radius, gis);

    const demand = (population?.data.features || []).map(feature => {
      const point = feature.geometry.type === 'Point' ? feature : gis.centroid(feature);
      return { point: point.geometry.coordinates, population: feature.properties.value, target: feature.properties[method.demand] };
    }).filter(row => distance(center, row.point) <= input.radius);
    const people = demand.length ? demand.reduce((total, row) => total + row.population, 0) : null;
    const target = demand.length && method.demand && demand.every(row => isCount(row.target))
      ? demand.reduce((total, row) => total + row.target, 0) : null;

    const recorded = supply?.data.features.filter(feature => feature.properties.kind === kind) || [];
    const sample = !isApartment && !recorded.length && (options.poi || (input.poiLoaded ? { pois:input.pois, radius:input.radius } : null));
    const matchingPoi = sample && new RegExp(method.keywords);
    const facilities = recorded.length
      ? recorded
      .map(feature => ({
        point: feature.geometry.coordinates,
        name: label(feature.properties.name, method.name),
        value: feature.properties.value
      })) : sample ? [...new Map(sample.pois.filter(poi => matchingPoi.test(poi.name + ' ' + poi.type) &&
        !/校门|入口|出口|停车|接送点/.test(poi.name)).map(poi => [poi.id || poi.name + '|' + poi.point.join(','), poi])).values()]
      .map(poi => ({ point: poi.point, name: label(poi.name, method.name) })) : [];
    const items = facilities.filter(item => distance(center, item.point) <= cutoff);
    const capacity = items.length && items.every(item => isCount(item.value))
      ? items.reduce((total, item) => total + item.value, 0)
      : supply && inventoryChecked && items.length === 0 ? 0 : null;
    const result = {
      kind, method, center: input.center, site, study, items, people, target, demand,
      capacity, population, supply, sample, inventoryChecked, radius
    };
    if (isApartment) {
      result.gap = target !== null && capacity !== null && inventoryChecked ? target - capacity : null;
      return result;
    }
    if (!recorded.length && !sample) return result;
    if (items.length > 300) throw Error('周边同类设施超过 300 个，请缩小研究范围或整理设施台账');
    result.circles = items.map(item => gis.circle(item.point, radius, { steps: 64, units: 'meters' }));
    const siteCircles = result.circles.filter(circle => gis.booleanIntersects(site, circle));
    const union = siteCircles.length > 1 ? gis.union(gis.featureCollection(siteCircles)) : siteCircles[0];
    result.uncovered = union ? gis.difference(gis.featureCollection([site, union])) : site;
    result.coverage = 100 * Math.min(1, Math.max(0, 1 - (result.uncovered ? gis.area(result.uncovered) : 0) / siteArea));
    if (target !== null) {
      const uncovered = demand.filter(row => !items.some(item => distance(row.point, item.point) <= radius));
      result.uncoveredTarget = uncovered.reduce((total, row) => total + row.target, 0);
      result.addedTarget = uncovered.filter(row => distance(center, row.point) <= radius)
        .reduce((total, row) => total + row.target, 0);
    }
    return result;
  }

  const number = value => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
  const pct = value => value > 0 && value < .1 ? '<0.1%' : value < 100 && value > 99.9 ? '>99.9%' : number(value) + '%';

  function readout(result) {
    const { kind, method, items, people, target, capacity, gap, population, supply, sample, inventoryChecked } = result;
    const lines = [];
    if (people !== null) lines.push('研究圈内人口样本合计 ' + number(people) + ' 人。');
    if (kind === 'apartment') {
      lines.push(target === null ? '缺少同一客群和时点的目标租住需求套数。人口热度仅用于识别需求线索。' :
        '目标租住需求 ' + number(target) + ' 套。');
      lines.push(supply ? '研究圈内台账 ' + items.length + ' 处' + (capacity !== null ? '，同期可供 ' + number(capacity) + ' 套。' : '，可供套数待核实。') :
        '请上传公寓供给台账，记录目标客群同期可出租的套数。');
      if (gap !== null) lines.push(gap > 0 ? '按录入口径测得需求比供给多 ' + number(gap) + ' 套，可进入租金与去化核查。' :
        '按录入口径，研究圈合计暂未显示数量缺口。' + (gap < 0 ? '已录入供给比需求多 ' + number(-gap) + ' 套。' : ''));
      else if (supply && !inventoryChecked) lines.push('核实需求与供给口径和台账覆盖范围后，才计算套数缺口。');
    } else if (result.coverage === undefined) {
      lines.push('请上传同类设施台账，或点击查询高德设施样本。');
    } else {
      lines.push('按 ' + result.radius + ' 米直线服务半径，' + items.length + ' 处' + (sample ? '已加载高德样本' : '台账点位') +
        '覆盖地块面积的 ' + pct(result.coverage) + '，图上橙色为样本未覆盖部分。');
      if (capacity !== null) lines.push('入选设施记录容量合计 ' + number(capacity) + ' ' + method.unit + '，仍需核实余量和服务对象。');
      if (target !== null) {
        lines.push('圈内目标人群样本 ' + number(target) + ' 人，现有服务圈外 ' + number(result.uncoveredTarget) +
          ' 人。以地块代表点试设同半径设施，新增触及约 ' + number(result.addedTarget) + ' 人。');
      } else if (method.demand) lines.push('缺少对应年龄段人口，暂无法估算补点会新增服务多少人。');
      if (sample) lines.push('高德在中心周边 ' + sample.radius + ' 米内搜索。点位和分页有限，空白区须核查台账与入口。');
      if (result.coverage < 100) {
        if (result.addedTarget === 0) lines.push('地块虽有圈外部分，本次试设未新增触及目标人口样本。先核实需求与备选入口。');
        else lines.push('地块可列为补点待核查。先核实目标人群、实际步行入口、容量和改造条件。');
      }
    }
    if (population && people !== null) lines.push('人口面数据按中心点入圈，结果为样本估算。');
    return lines;
  }

  function evidence(result) {
    const sources = [result.population, result.supply].filter(Boolean)
      .map(data => data.source.slice(0, 36) + ' ' + data.date);
    if (result.sample) sources.push('已加载的高德 POI，收录与分页有限');
    const known = (result.kind === 'apartment' && result.gap !== null) || result.coverage !== undefined;
    const lines = readout(result).filter(line => !line.includes('图上')).slice(0, 4);
    if (result.coverage !== undefined) {
      lines.unshift(result.radius + ' 米直线服务圈覆盖地块面积 ' + pct(result.coverage) + '。点位覆盖与可用容量、步行条件需分别核实。');
    }
    return {
      id: known ? 'F8' : 'G8',
      label: result.method.name + '供需研判',
      value: lines.join('').slice(0, 380),
      source: (sources.join('；') || '当前项目专题数据缺项').slice(0, 130)
    };
  }

  function mount({ container, getInput, getLayer, showMap, onChange, ask }) {
    const section = document.createElement('section');
    section.className = 'ws-data';
    section.id = 'wsProgram';
    section.innerHTML = '<h3>用途研判 · 供需与服务圈</h3>' +
      '<p>选定用途和研究半径。公寓看人口、目标需求与房源供给；公服看同类设施的直线覆盖和潜在补点人群。</p>' +
      '<div class="ws-controls"><label>研判用途<select id="wsProgramKind"></select></label>' +
      '<label id="wsProgramRadiusLabel">试算服务半径（米）<input id="wsProgramRadius" type="number" min="50" max="3000" step="10"></label></div>' +
      '<label id="wsProgramCheckLabel"><input id="wsProgramCheck" type="checkbox"> 已核实数据覆盖研究圈，需求和可供套数的客群、租金档、时点一致</label>' +
      '<p id="wsProgramMethod"></p><button type="button" class="primary" id="wsProgramRun">计算用途研判</button> ' +
      '<button type="button" class="ws-tool" id="wsProgramPoi">查高德设施样本并试算</button> ' +
      '<button type="button" class="ws-tool" id="wsProgramMap" disabled>在地图看叠加</button> ' +
      '<button type="button" class="ws-tool" id="wsProgramAsk" disabled>请 Qwen 解读</button>' +
      '<div id="wsProgramResult" role="status"></div>';
    container.insertBefore(section, container.querySelector('#wsAssessment'));
    const $ = id => section.querySelector('#' + id);
    const select = $('wsProgramKind');
    const radiusInput = $('wsProgramRadius');
    const checkbox = $('wsProgramCheck');
    const output = $('wsProgramResult');
    const mapButton = $('wsProgramMap');
    const askButton = $('wsProgramAsk');
    const poiButton = $('wsProgramPoi');
    let latest;
    let pending;
    for (const [key, method] of Object.entries(methods)) select.add(new Option(method.name, key));

    function invalidate() {
      pending?.abort();
      pending = null;
      poiButton.disabled = false;
      latest = null;
      output.replaceChildren();
      mapButton.disabled = true;
      askButton.disabled = true;
    }
    function methodChanged() {
      const method = methods[select.value];
      const apartment = select.value === 'apartment';
      radiusInput.value = method.radius || '';
      $('wsProgramRadiusLabel').hidden = apartment;
      $('wsProgramCheckLabel').hidden = !apartment;
      poiButton.hidden = apartment;
      checkbox.checked = false;
      $('wsProgramMethod').textContent = apartment ?
        '人口 GeoJSON 中可加 apartment_demand（同口径预计需要的套数）。公寓台账的 value 填同期可出租套数。' :
        '默认半径是可改的试算参数。台账类型需区分设施功能，学校另核实招生片区、学位余量。' +
        (method.demand ? '人口图层可加 ' + method.demand + '（对应人群人数），计算补点可能新增触及的人数。' : '');
      invalidate();
      onChange();
    }
    function prepare() {
      const input = getInput();
      const kind = select.value;
      const radius = Number(radiusInput.value);
      if (kind !== 'apartment' && (!Number.isFinite(radius) || radius < 50 || radius > 3000)) {
        throw Error('试算服务半径须在 50～3000 米之间');
      }
      const options = { kind, radius, inventoryChecked: checkbox.checked, population: getLayer('population'), supply: getLayer('supply') };
      const key = JSON.stringify([input.project.name, input.geometry, input.center, input.radius, input.poiLoaded, input.pois, options]);
      return { input, options, key };
    }
    function append(text) {
      const line = document.createElement('p');
      line.textContent = text;
      output.append(line);
    }
    select.onchange = methodChanged;
    for (const field of [radiusInput, checkbox]) field.oninput = () => { invalidate(); onChange(); };
    methodChanged();
    async function run(withPoi) {
      invalidate();
      onChange();
      const controller = new AbortController();
      pending = controller;
      try {
        if (!root.turf) throw Error('空间计算组件尚未加载，请刷新页面');
        const { input, options, key } = prepare();
        if (withPoi) {
          if (options.supply?.data.features.some(feature => feature.properties.kind === options.kind)) {
            throw Error('已上传该类设施台账，请直接计算用途研判');
          }
          const reach = Math.min(5000, Math.ceil(facilityReach(input, options.radius, root.turf)));
          const query = new URLSearchParams({ center:input.center.join(','), radius:String(reach), kind:options.kind });
          append('正在查询高德设施样本…');
          poiButton.disabled = true;
          const response = await fetch('/api/amap-poi?' + query, {
            signal:AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])
          });
          const data = await response.json();
          if (!response.ok) throw Error(data.error || '高德设施查询失败');
          if (pending !== controller) return;
          if (prepare().key !== key) throw Error('项目或数据已变化，请重新计算');
          options.poi = { pois:data.pois, radius:reach };
          output.replaceChildren();
        }
        const result = evaluate(input, options, root.turf);
        latest = { result, key };
        readout(result).forEach(append);
        const item = evidence(result);
        append('依据 · ' + item.source);
        mapButton.disabled = false;
        askButton.disabled = false;
      } catch (error) { if (pending === controller) append(error.message); }
      finally {
        if (pending === controller) {
          pending = null;
          poiButton.disabled = false;
        }
      }
    }
    $('wsProgramRun').onclick = () => run(false);
    poiButton.onclick = () => run(true);
    mapButton.onclick = () => {
      try {
        if (!latest || prepare().key !== latest.key) throw Error('项目或数据已变化，请重新计算');
        showMap(latest.result);
      } catch (error) { invalidate(); append(error.message); }
    };
    askButton.onclick = () => {
      try {
        if (!latest || prepare().key !== latest.key) throw Error('项目或数据已变化，请重新计算');
        ask('请解读本地块的' + latest.result.method.name + '研判，结合现有证据说明是否值得列为候选，并给出三项优先核查任务。');
      } catch (error) { invalidate(); append(error.message); }
    };
    return {
      invalidate() { checkbox.checked = false; invalidate(); },
      evidence() {
        if (!latest) return null;
        try { return prepare().key === latest.key ? evidence(latest.result) : null; }
        catch { return null; }
      }
    };
  }

  const api = { methods, validateSupply, evaluate, readout, evidence, mount };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RenewalProgram = api;
})(typeof window === 'undefined' ? globalThis : window);
