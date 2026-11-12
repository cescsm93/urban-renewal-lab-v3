(function (root) {
  'use strict';

  const colors = ['#ce6844','#367f91','#9165ba','#b38a2c','#3f8b66','#c65078'];
  const maxLayers = 16;
  let map, changed, layers = [], loaded = false, panel, list, status, popup;
  let tableBox, tableLayerSelect, tableScroll, tableIndex = 0, tablePage = 0;
  let editMode = null, editMarkers = [], boundaryValid;
  const pageSize = 50;
  let revision = 0, appliedRevision = -1;

  const $ = id => document.getElementById(id);
  const id = index => 'archive-' + index;
  const visible = row => row.visible !== false;
  const featureName = (feature, index) => {
    const props = feature.properties || {};
    return String(props['项目名称'] || props['宗地名称'] || props['建筑名称'] ||
      props['规划名称'] || props.name || props['名称'] || '记录 ' + (index + 1));
  };
  function checkGeometry(geometry) {
    if (!geometry || !['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon'].includes(geometry.type)) {
      throw Error('档案图层包含不支持的几何类型');
    }
    let count = 0;
    function scan(value) {
      if (!Array.isArray(value) || !value.length) throw Error('档案图层包含无效坐标');
      if (typeof value[0] === 'number') {
        if (value.length < 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1]) ||
            Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw Error('图层坐标须为 WGS84 经纬度');
        count++;
      } else value.forEach(scan);
    }
    scan(geometry.coordinates);
    if (count > 200000) throw Error('单条记录节点过多，请裁剪数据');
  }
  function normalized(row) {
    if (!row || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 100 ||
        row.collection?.type !== 'FeatureCollection' || !Array.isArray(row.collection.features) ||
        row.collection.features.length > 5000) throw Error('每个图层须有名称和不超过 5000 条的 GeoJSON 要素');
    if (row.collection.crs && !/EPSG:4326|CRS84|urn:ogc:def:crs:OGC:1.3:CRS84/i.test(
        String(row.collection.crs.properties?.name || ''))) throw Error(row.name + ' 请先转换为 WGS84');
    const features = row.collection.features.map((feature, index) => {
      if (feature?.type !== 'Feature' || !feature.properties || Array.isArray(feature.properties) ||
          typeof feature.properties !== 'object') throw Error(row.name + ' 的第 ' + (index + 1) + ' 条属性无效');
      checkGeometry(feature.geometry);
      return {
        type:'Feature', geometry:feature.geometry,
        properties:{...feature.properties, _archiveTitle:featureName(feature,index)}
      };
    });
    return { name:row.name.trim(), visible:visible(row),
      collection:{ type:'FeatureCollection', features } };
  }
  function validate(next) {
    if (!Array.isArray(next) || next.length > maxLayers) throw Error('档案最多显示 16 个图层');
    const names = new Set();
    return next.map(item => {
      const row = normalized(item);
      if (names.has(row.name)) throw Error('图层名称重复：' + row.name);
      names.add(row.name);
      return row;
    });
  }
  function clearMap() {
    if (!map?.isStyleLoaded()) return;
    for (let index=0; index<maxLayers; index++) {
      for (const suffix of ['label','point','line','fill']) {
        if (map.getLayer(id(index)+'-'+suffix)) map.removeLayer(id(index)+'-'+suffix);
      }
      if (map.getSource(id(index))) map.removeSource(id(index));
    }
    popup?.remove();
    popup = null;
  }
  function syncMap() {
    if (!map?.isStyleLoaded()) return;
    if (appliedRevision === revision && (!layers.length || map.getSource(id(0)))) return;
    clearMap();
    layers.forEach((row, index) => {
      const source = id(index);
      map.addSource(source,{ type:'geojson',data:row.collection });
      const layout = { visibility:visible(row) ? 'visible' : 'none' };
      const color = colors[index % colors.length];
      const before = map.getLayer('draft-fill') ? 'draft-fill' : undefined;
      map.addLayer({id:source+'-fill',type:'fill',source,
        filter:['==',['geometry-type'],'Polygon'],layout,
        paint:{'fill-color':color,'fill-opacity':.32}},before);
      map.addLayer({id:source+'-line',type:'line',source,
        filter:['any',['==',['geometry-type'],'Polygon'],['==',['geometry-type'],'LineString']],layout,
        paint:{'line-color':color,'line-width':2.5}},before);
      map.addLayer({id:source+'-point',type:'circle',source,
        filter:['==',['geometry-type'],'Point'],layout,
        paint:{'circle-color':color,'circle-radius':6,'circle-stroke-color':'white','circle-stroke-width':1.2}},before);
      map.addLayer({id:source+'-label',type:'symbol',source,
        filter:['==',['geometry-type'],'Polygon'],
        layout: {...layout,'text-field':['get','_archiveTitle'],'text-font':['Noto Sans Regular'],'text-size':12,'text-optional':true},
        paint:{'text-color':color,'text-halo-color':'white','text-halo-width':2}},before);
    });
    appliedRevision = revision;
  }
  function fitLayers() {
    if (!map || !root.turf) return;
    const features = layers.flatMap(row => row.collection.features);
    if (!features.length) return;
    const bounds = root.turf.bbox(root.turf.featureCollection(features));
    if (bounds.every(Number.isFinite)) map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],
      {padding:75,maxZoom:17});
  }
  function showRecord(feature, index, lngLat) {
    const row = layers[index];
    if (!row) return;
    const card = document.createElement('div');
    card.className = 'archive-record';
    const title = document.createElement('h3');
    title.textContent = row.name + ' · ' + String(feature.properties._archiveTitle || '档案');
    card.append(title);
    const note = document.createElement('p');
    note.textContent = '字段值沿用原文件，空字段显示“未录入”。面积字段按原文件单位理解。';
    card.append(note);
    const table = document.createElement('dl');
    for (const [key,value] of Object.entries(feature.properties)) {
      if (key === '_archiveTitle') continue;
      const term = document.createElement('dt');
      term.textContent = key;
      const definition = document.createElement('dd');
      definition.textContent = value == null || value === '' ? '未录入' :
        typeof value === 'object' ? JSON.stringify(value) : String(value);
      table.append(term,definition);
    }
    card.append(table);
    popup?.remove();
    popup = new root.maplibregl.Popup({maxWidth:'440px',closeButton:true})
      .setLngLat(lngLat).setDOMContent(card).addTo(map);
  }
  function hitAt(point) {
    if (!map || !layers.length) return null;
    const ids = layers.flatMap((row,index) => visible(row) ?
      ['fill','line','point'].map(suffix => id(index)+'-'+suffix) : []).filter(name => map.getLayer(name));
    const features = ids.length ? map.queryRenderedFeatures(point,{layers:ids}) : [];
    if (features.length) {
      const hit = features[0];
      return {feature:hit,index:Number(hit.layer.id.split('-')[1])};
    }
    if (!root.turf) return null;
    const lngLat = map.unproject(point);
    for (let index=layers.length-1; index>=0; index--) {
      if (!visible(layers[index])) continue;
      for (const feature of layers[index].collection.features) {
        if (['Polygon','MultiPolygon'].includes(feature.geometry.type) &&
            root.turf.booleanPointInPolygon([lngLat.lng,lngLat.lat],feature)) return {feature,index};
      }
    }
    return null;
  }
  function openAt(event) {
    const hit = hitAt(event.point);
    if (!hit) return false;
    showRecord(hit.feature,hit.index,event.lngLat);
    return true;
  }
  function render() {
    if (!list) return;
    list.replaceChildren();
    for (const [index,row] of layers.entries()) {
      const line = document.createElement('div');
      line.className = 'archive-layer-row';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.setAttribute('aria-label', '显示' + row.name);
      check.checked = visible(row);
      check.onchange = () => {
        row.visible = check.checked;
        revision++;
        syncMap();
        changed();
      };
      const swatch = document.createElement('span');
      swatch.style.background = colors[index % colors.length];
      const text = document.createElement('span');
      text.textContent = row.name + ' · ' + row.collection.features.length + ' 条';
      line.append(check,swatch,text);
      const tableButton = document.createElement('button');
      tableButton.type = 'button';
      tableButton.textContent = '属性表';
      tableButton.onclick = () => showTable(index);
      line.append(tableButton);
      if (row.collection.features.length) {
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = '查看首条';
        open.onclick = () => {
          if (!map) return;
          const feature = row.collection.features[0];
          const center = root.turf.centroid(feature).geometry.coordinates;
          map.easeTo({center,zoom:Math.max(map.getZoom(),15)});
          showRecord(feature,index,center);
        };
        line.append(open);
      }
      list.append(line);
    }
    status.textContent = layers.length ? '点击地图上的图形，查看该条档案的全部字段。' : '请选择 GeoJSON 文件或 GDB 压缩包。';
    renderTable();
  }
  function showTable(index = tableIndex) {
    tableIndex = index;
    tablePage = 0;
    panel.hidden = false;
    tableBox.hidden = false;
    panel.classList.add('table-open');
    $('archiveTableToggle').textContent = '收起属性表';
    renderTable();
  }
  function fieldValue(value) {
    if (value == null || value === '') return '未录入';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  function parseField(raw, example) {
    if (!raw.trim()) return null;
    if (typeof example === 'number') {
      const value = Number(raw.trim());
      if (!Number.isFinite(value)) throw Error('该字段需要有效数字');
      return value;
    }
    if (typeof example === 'boolean') {
      if (!/^(true|false|是|否)$/i.test(raw.trim())) throw Error('该字段请输入 true、false、是或否');
      return /^(true|是)$/i.test(raw.trim());
    }
    if (example && typeof example === 'object') return JSON.parse(raw);
    return raw;
  }
  function startFieldEdit(button, featureIndex, key) {
    const row = layers[tableIndex];
    const feature = row?.collection.features[featureIndex];
    if (!feature || key === '_archiveTitle' || key === '__proto__') return;
    const current = feature.properties[key];
    const example = current == null ? row.collection.features.map(item => item.properties[key]).find(value => value != null && value !== '') : current;
    const input = document.createElement('input');
    input.className = 'archive-edit';
    input.setAttribute('aria-label', '编辑' + row.name + '第' + (featureIndex + 1) + '条的' + key);
    input.value = current == null ? '' : typeof current === 'object' ? JSON.stringify(current) : String(current);
    button.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const commit = () => {
      if (finished) return;
      let value;
      try { value = parseField(input.value, example); }
      catch (error) { status.textContent = '修改失败：' + error.message; input.focus(); return; }
      finished = true;
      feature.properties[key] = value;
      feature.properties._archiveTitle = featureName(feature, featureIndex);
      revision++;
      syncMap();
      render();
      changed();
      status.textContent = '已保存“' + key + '”字段。请定期下载项目备份。';
    };
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { finished = true; renderTable(); }
    });
    input.addEventListener('blur', commit);
  }
  function renderTable() {
    if (!tableBox || tableBox.hidden) return;
    const previousLeft = tableScroll.scrollLeft, previousTop = tableScroll.scrollTop;
    if (tableIndex >= layers.length) tableIndex = 0;
    tableLayerSelect.replaceChildren(...layers.map((row,index) => new Option(row.name + ' · ' + row.collection.features.length + ' 条',index)));
    tableLayerSelect.disabled = !layers.length;
    if (layers.length) tableLayerSelect.value = String(tableIndex);
    const row = layers[tableIndex], table = document.createElement('table');
    if (!row) { tableScroll.textContent = '请先导入档案图层。'; return; }
    const fields = [...new Set(row.collection.features.flatMap(feature => Object.keys(feature.properties || {})))].filter(key => key !== '_archiveTitle' && key !== '__proto__');
    const query = $('archiveTableSearch').value.trim().toLowerCase();
    const matches = row.collection.features.map((feature,index) => ({feature,index})).filter(({feature}) =>
      !query || Object.entries(feature.properties).some(([key,value]) => key !== '_archiveTitle' && String(value ?? '').toLowerCase().includes(query)));
    const pages = Math.max(1,Math.ceil(matches.length/pageSize));
    tablePage = Math.min(tablePage,pages-1);
    const head = document.createElement('thead'), header = document.createElement('tr');
    for (const name of ['记录', ...fields]) { const th = document.createElement('th'); th.textContent = name; header.append(th); }
    head.append(header); table.append(head);
    const body = document.createElement('tbody');
    matches.slice(tablePage*pageSize,(tablePage+1)*pageSize).forEach(({feature,index:featureIndex}) => {
      const tr = document.createElement('tr'), locate = document.createElement('button');
      locate.type = 'button'; locate.className = 'archive-locate'; locate.textContent = String(featureIndex + 1);
      locate.title = '在地图查看第 ' + (featureIndex + 1) + ' 条';
      locate.onclick = () => {
        if (!map || !root.turf) return;
        const center = root.turf.centroid(feature).geometry.coordinates;
        map.easeTo({center,zoom:Math.max(map.getZoom(),15)});
        showRecord(feature,tableIndex,center);
      };
      const first = document.createElement('td'); first.append(locate);
      if (['Polygon','MultiPolygon'].includes(feature.geometry.type)) {
        const edit = document.createElement('button');
        edit.type = 'button'; edit.className = 'archive-locate'; edit.textContent = '改边界';
        edit.title = '在地图拖动节点修改第 ' + (featureIndex + 1) + ' 条边界';
        edit.onclick = () => startBoundaryEdit(tableIndex,featureIndex);
        first.append(' ',edit);
      }
      tr.append(first);
      fields.forEach(key => {
        const td = document.createElement('td'), cell = document.createElement('button');
        cell.type = 'button'; cell.className = 'archive-cell';
        if (feature.properties[key] == null || feature.properties[key] === '') cell.classList.add('archive-missing');
        cell.textContent = fieldValue(feature.properties[key]);
        cell.title = key + '：点击编辑';
        cell.onclick = () => startFieldEdit(cell,featureIndex,key);
        td.append(cell); tr.append(td);
      });
      body.append(tr);
    });
    table.append(body); tableScroll.replaceChildren(table);
    tableScroll.scrollLeft = previousLeft; tableScroll.scrollTop = previousTop;
    $('archiveTableCount').textContent = matches.length + ' / ' + row.collection.features.length + ' 条 · ' + fields.length + ' 个字段';
    $('archivePage').textContent = tablePage+1 + ' / ' + pages + ' 页';
    $('archivePrev').disabled = tablePage === 0;
    $('archiveNext').disabled = tablePage >= pages-1;
  }
  function clearEditGraphics() {
    editMarkers.forEach(marker => marker.remove());
    editMarkers = [];
    if (map?.getSource('projects')) {
      for (const name of ['archive-draft-point','archive-draft-line','archive-draft-fill']) {
        if (map.getLayer(name)) map.removeLayer(name);
      }
      if (map.getSource('archive-draft')) map.removeSource('archive-draft');
    }
    map?.doubleClickZoom.enable();
    if (map) map.getCanvas().style.cursor = '';
  }
  function cancelEdit() {
    clearEditGraphics();
    editMode = null;
    $('archiveEditControls').hidden = true;
  }
  function drawEditGeometry() {
    if (!editMode || !map?.getSource('projects')) return;
    const points = editMode.points;
    const features = points.map(point => ({type:'Feature',geometry:{type:'Point',coordinates:point},properties:{}}));
    if (points.length > 1) features.push({type:'Feature',geometry:{type:'LineString',coordinates:[...points,...(points.length >= 3 ? [points[0]] : [])]},properties:{}});
    if (points.length >= 3) features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[[...points,points[0]]]},properties:{}});
    const data = {type:'FeatureCollection',features};
    if (!map.getSource('archive-draft')) {
      map.addSource('archive-draft',{type:'geojson',data});
      map.addLayer({id:'archive-draft-fill',type:'fill',source:'archive-draft',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#e79636','fill-opacity':.28}});
      map.addLayer({id:'archive-draft-line',type:'line',source:'archive-draft',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#a9571d','line-width':3}});
      map.addLayer({id:'archive-draft-point',type:'circle',source:'archive-draft',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':'#a9571d','circle-radius':5,'circle-stroke-color':'#fff','circle-stroke-width':1.5}});
    } else map.getSource('archive-draft').setData(data);
    $('archiveEditHint').textContent = editMode.kind === 'new' ?
      '已添加 ' + points.length + ' 个节点。单击地图加点，双击结束并保存；也可点“保存边界”。' :
      '拖动蓝色节点调整边界；点击黄色中点加节点，右键蓝色节点删除。';
  }
  function showEditMarkers() {
    editMarkers.forEach(marker => marker.remove());
    editMarkers = [];
    if (!editMode || editMode.kind !== 'boundary' || !map) return;
    editMode.points.forEach((point,index) => {
      const node = document.createElement('button');
      node.type = 'button'; node.className = 'archive-vertex';
      node.title = '拖动修改节点；右键删除节点';
      const marker = new root.maplibregl.Marker({element:node,draggable:true}).setLngLat(point).addTo(map);
      marker.on('drag',() => {const p=marker.getLngLat(); editMode.points[index]=[p.lng,p.lat]; drawEditGeometry();});
      marker.on('dragend',showEditMarkers);
      node.oncontextmenu = event => {
        event.preventDefault(); event.stopPropagation();
        if (editMode.points.length <= 3) return;
        editMode.points.splice(index,1); drawEditGeometry(); showEditMarkers();
      };
      editMarkers.push(marker);
      const next = editMode.points[(index+1)%editMode.points.length];
      const midpoint = [(point[0]+next[0])/2,(point[1]+next[1])/2];
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'archive-vertex archive-midpoint'; add.title = '在这里增加节点';
      add.onclick = event => {event.stopPropagation(); editMode.points.splice(index+1,0,midpoint); drawEditGeometry(); showEditMarkers();};
      editMarkers.push(new root.maplibregl.Marker({element:add}).setLngLat(midpoint).addTo(map));
    });
  }
  function beginEdit(kind, layerIndex, featureIndex, points, originalType) {
    if (!map?.getSource('projects')) {status.textContent = '地图尚未加载，请稍后再试。'; return;}
    if (editMode) cancelEdit();
    editMode = {kind,layerIndex,featureIndex,points,originalType};
    tableBox.hidden = true; panel.classList.remove('table-open');
    $('archiveTableToggle').textContent = '查看／编辑属性表';
    panel.hidden = false;
    $('archiveEditControls').hidden = false;
    $('archiveUndo').hidden = kind !== 'new';
    map.doubleClickZoom.disable();
    map.getCanvas().style.cursor = kind === 'new' ? 'crosshair' : '';
    drawEditGeometry(); showEditMarkers();
  }
  function startNewFeature() {
    const index = layers.findIndex(row => row.name === '项目层');
    beginEdit('new', index >= 0 ? index : layers.length, -1, [], 'Polygon');
  }
  function startBoundaryEdit(layerIndex, featureIndex) {
    const geometry = layers[layerIndex]?.collection.features[featureIndex]?.geometry;
    const rings = geometry?.type === 'Polygon' ? geometry.coordinates :
      geometry?.type === 'MultiPolygon' && geometry.coordinates.length === 1 ? geometry.coordinates[0] : null;
    if (!rings || rings.length !== 1 || rings[0].length < 4) {
      status.textContent = '该记录含多部件或内洞，暂请在 GIS 软件中修改边界后重新导入。';
      return;
    }
    beginEdit('boundary',layerIndex,featureIndex,rings[0].slice(0,-1).map(point => [...point]),geometry.type);
  }
  function saveEdit() {
    if (!editMode) return;
    const points = editMode.points;
    if (points.length < 3 || (boundaryValid && !boundaryValid(points))) {
      status.textContent = '边界至少需要三个不同节点，且不能自相交或面积为零。';
      return;
    }
    const ring = [...points.map(point => [...point]),[...points[0]]];
    const geometry = editMode.originalType === 'MultiPolygon' ?
      {type:'MultiPolygon',coordinates:[[ring]]} : {type:'Polygon',coordinates:[ring]};
    const next = layers.map(row => ({...row,collection:{...row.collection,features:[...row.collection.features]}}));
    let row = next[editMode.layerIndex];
    if (!row) {row = {name:'项目层',collection:{type:'FeatureCollection',features:[]}}; next.push(row);}
    let featureIndex = editMode.featureIndex;
    if (editMode.kind === 'new') {
      const fields = [...new Set(row.collection.features.flatMap(feature => Object.keys(feature.properties)))].filter(key => key !== '_archiveTitle');
      const properties = Object.fromEntries(fields.map(key => [key,null]));
      const nameField = fields.find(key => ['项目名称','名称','name'].includes(key)) || '项目名称';
      properties[nameField] = '新增更新项目' + (row.collection.features.length+1);
      row.collection.features.push({type:'Feature',geometry,properties});
      featureIndex = row.collection.features.length-1;
    } else {
      const previous = row.collection.features[featureIndex];
      row.collection.features[featureIndex] = {...previous,geometry};
    }
    const index = editMode.layerIndex;
    cancelEdit();
    setLayers(next);
    tableIndex = index;
    tablePage = Math.floor(featureIndex/pageSize);
    $('archiveTableSearch').value = '';
    showTable(index);
    tablePage = Math.floor(featureIndex/pageSize);
    renderTable();
    status.textContent = '边界已保存到档案图层；请继续填写字段并下载项目备份。';
  }
  function handleMapClick(event) {
    if (!editMode) return false;
    if (editMode.kind === 'new' && event.originalEvent?.detail !== 2) {
      editMode.points.push([event.lngLat.lng,event.lngLat.lat]);
      drawEditGeometry();
    }
    return true;
  }
  function handleDoubleClick(event) {
    if (!editMode) return false;
    event.preventDefault();
    if (editMode.kind === 'new') saveEdit();
    return true;
  }
  function setLayers(next, persist = true) {
    layers = validate(next);
    revision++;
    loaded = true;
    render();
    syncMap();
    if (persist) changed();
  }
  function close() {
    if (editMode) cancelEdit();
    if (panel) panel.hidden = true;
    $('openData')?.classList.remove('on');
  }
  function focusRecord(layerName, featureIndex) {
    const index=layers.findIndex(row=>row.name===layerName);
    const feature=layers[index]?.collection.features[featureIndex];
    if (!feature) return false;
    panel.hidden=false;
    $('openData')?.classList.add('on');
    tableIndex=index;
    $('archiveTableSearch').value='';
    showTable(index);
    tablePage=Math.floor(featureIndex/pageSize);
    renderTable();
    if(map&&root.turf){const center=root.turf.centroid(feature).geometry.coordinates;map.easeTo({center,zoom:Math.max(map.getZoom(),15)});}
    return true;
  }
  function restore(next) {
    setLayers(next || [],false);
  }
  function readGeoJson(text, filename) {
    const value = JSON.parse(text);
    if (Array.isArray(value.layers)) return value.layers;
    const collection = value.type === 'FeatureCollection' ? value :
      value.type === 'Feature' ? {type:'FeatureCollection',features:[value]} : null;
    if (!collection) throw Error(filename + ' 需要 GeoJSON FeatureCollection');
    return [{ name:String(value.name || filename.replace(/\.geojson$|\.json$/i,'')), collection }];
  }
  async function upload(files) {
    if (!files.length) return;
    const next = [];
    const localService = /^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
    for (const file of files) {
      const limit = localService ? 20 * 1024 * 1024 : 3_000_000;
      if (file.size > limit) throw Error(file.name + (localService ? ' 超过 20 MB' : ' 超过线上 3 MB 限制'));
      if (/\.(rar|zip)$/i.test(file.name)) {
        const binary = new Uint8Array(await file.arrayBuffer());
        let raw = '';
        for (let start=0;start<binary.length;start+=32768) {
          raw += String.fromCharCode(...binary.subarray(start,start+32768));
        }
        const response = await fetch('/api/gdb-import',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({filename:file.name,data:btoa(raw)}),
          signal:AbortSignal.timeout(70000)
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || 'GDB 导入失败');
        next.push(...data.layers);
      } else if (/\.(geojson|json)$/i.test(file.name)) {
        next.push(...readGeoJson(await file.text(),file.name));
      } else throw Error('请选择 GeoJSON、GDB RAR 或 GDB ZIP');
    }
    const names = new Set(next.map(row => row.name));
    setLayers([...layers.filter(row => !names.has(row.name)), ...next]);
    fitLayers();
    status.textContent = '已导入 ' + next.length + ' 个图层。点地图图形可查看档案。';
  }
  function init({ getMap, onChange, validateBoundary }) {
    changed = onChange;
    boundaryValid = validateBoundary;
    panel = document.createElement('section');
    panel.id = 'archivePanel';
    panel.hidden = true;
    panel.innerHTML = '<header><b>导入数据</b><button id="archiveClose" type="button" aria-label="关闭导入数据">×</button></header>' +
      '<p>同事录入的项目、宗地、建筑等图层在这里统一管理。保留图层名称与原始字段，支持在线补录、改字段和改简单多边形边界。</p>' +
      '<div id="archiveList"></div>' +
      '<label class="archive-upload">导入 GeoJSON 或 GDB 压缩包<input id="archiveFiles" type="file" multiple accept=".geojson,.json,.rar,.zip"></label>' +
      '<p id="archiveStatus" role="status"></p>' +
      '<button id="archiveLocal" type="button">载入本机四层档案</button> ' +
      '<button id="archiveFit" type="button">定位所有档案</button><br>' +
      '<div class="archive-actions"><button id="archiveNewProject" type="button">＋ 地图上新增项目层记录</button><button id="archiveBackup" type="button">备份／恢复</button></div>' +
      '<div id="archiveEditControls" class="archive-edit-controls" hidden><b>地图边界编辑</b><p id="archiveEditHint"></p><button id="archiveUndo" type="button">撤销一点</button><button id="archiveSave" type="button">保存边界</button><button id="archiveCancel" type="button">取消</button></div>' +
      '<button id="archiveTableToggle" class="archive-table-toggle" type="button" aria-controls="archiveTable">查看／编辑属性表</button>' +
      '<section id="archiveTable" class="archive-table" hidden><div class="archive-table-toolbar"><label for="archiveTableLayer">图层</label><select id="archiveTableLayer"></select><input id="archiveTableSearch" type="search" placeholder="搜索本层字段值" aria-label="搜索本图层记录"><span id="archiveTableCount"></span></div><div id="archiveTableScroll" class="archive-table-scroll"></div><div class="archive-pages"><button id="archivePrev" type="button">上一页</button><span id="archivePage"></span><button id="archiveNext" type="button">下一页</button></div><p class="archive-table-note">每页 50 条；左右滚动查看全部原始字段。空值显示“未录入”；点击单元格输入新值，按 Enter 或点别处保存，按 Esc 取消。记录号可定位地图，“改边界”可拖动节点。</p></section>';
    document.body.append(panel);
    list = $('archiveList');
    status = $('archiveStatus');
    tableBox = $('archiveTable');
    tableLayerSelect = $('archiveTableLayer');
    tableScroll = $('archiveTableScroll');
    $('archiveClose').onclick = close;
    $('archiveFit').onclick = fitLayers;
    $('archiveNewProject').onclick = startNewFeature;
    $('archiveBackup').onclick = () => {panel.hidden = true; $('openData')?.classList.remove('on'); $('openStorage').click();};
    $('archiveUndo').onclick = () => {if (editMode?.kind === 'new') {editMode.points.pop(); drawEditGeometry();}};
    $('archiveSave').onclick = saveEdit;
    $('archiveCancel').onclick = cancelEdit;
    $('archiveTableSearch').oninput = () => {tablePage = 0; renderTable();};
    $('archivePrev').onclick = () => {tablePage--; renderTable();};
    $('archiveNext').onclick = () => {tablePage++; renderTable();};
    $('archiveTableToggle').onclick = () => {
      if (tableBox.hidden) showTable();
      else { tableBox.hidden = true; panel.classList.remove('table-open'); $('archiveTableToggle').textContent = '查看／编辑属性表'; }
    };
    tableLayerSelect.onchange = () => { tableIndex = Number(tableLayerSelect.value); tablePage = 0; renderTable(); };
    if (!/^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname)) {
      $('archiveLocal').hidden = true;
    }
    $('archiveLocal').onclick = async () => {
      status.textContent = '正在载入本机档案…';
      try {
        const response = await fetch('/api/gdb-import');
        const data = await response.json();
        if (!response.ok) throw Error(data.error || '本机档案读取失败');
        setLayers(data.layers);
        fitLayers();
        status.textContent = '已载入 ' + data.layers.length + ' 层，' + data.sourceCRS + '。';
      } catch (error) { status.textContent = error.message; }
    };
    $('archiveFiles').onchange = async event => {
      const input = event.target;
      const files = [...(input.files || [])];
      input.disabled = true;
      status.textContent = '正在导入和检查图层…';
      try { await upload(files); }
      catch (error) { status.textContent = '导入失败：' + error.message; }
      finally { input.disabled = false; input.value = ''; }
    };
    $('resourceArchive').onclick = () => { panel.hidden = false; $('openData')?.classList.add('on'); renderTable(); };
    document.addEventListener('keydown', event => {if (event.key === 'Escape' && editMode) cancelEdit();});
    render();
    return {
      attachMap() {
        map = getMap();
        appliedRevision = -1;
        syncMap();
        map?.once('idle', syncMap);
      },
      autoload: async () => {
        if (loaded) return;
        try {
          const response = await fetch('/api/gdb-import');
          if (response.ok && !loaded) {
            const data = await response.json();
            setLayers(data.layers);
            fitLayers();
            panel.hidden = false;
            status.textContent = '已载入本次提供的四层档案。点击图形查看字段。';
          }
        } catch {}
      }
    };
  }
  const api = { init, restore, capture:() => layers, hitAt, openAt, validate,
    isEditing:() => Boolean(editMode), mapReady:() => Boolean(map?.getSource('projects')), handleMapClick, handleDoubleClick, focusRecord,
    open:() => {panel.hidden = false; $('openData')?.classList.add('on'); renderTable();}, close };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RenewalArchive = api;
})(typeof window === 'undefined' ? globalThis : window);
