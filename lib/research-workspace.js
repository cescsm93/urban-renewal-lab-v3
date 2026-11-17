(function(){
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const topics={housing:['住宅价格','元/㎡'],rent:['商业租金','元/㎡·月'],population:['人口分布','人'],coverage:['公服步行覆盖','分钟']};
const dataTopics={...topics,supply:['公寓与公服供给台账','按设施类型']};
let adapter,root,layers={},lastCharts=[],uploadsPending=0,assessment,program,reportPreviewOnly=false,pendingReport=null,lastReportInput=null,archiveContext=null;
const $=id=>document.getElementById(id);
function download(blob,name){if(reportPreviewOnly&&name==='前期研判报告包.zip'){pendingReport=blob;return}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
function panel(preselected) {
  if (window.RenewalArchive?.isEditing()) {alert('请先保存或取消当前边界编辑');return;}
  window.RenewalArchive?.close();
  root.hidden = false;
  const select = $('wsProject');
  const previous = select.value;
  const projects = adapter.projects();
  select.replaceChildren(...projects.map((project, index) => new Option(project.name, index)));
  if (Number.isInteger(preselected) && projects[preselected]) select.value = String(preselected);
  else if (previous !== '' && projects[Number(previous)]) select.value = previous;
  if (previous !== select.value) program?.invalidate();
  assessment?.invalidate();
  status('选择项目、准备数据，再做前期研判和报告。上传的专题数据仅用于当前页面会话，请保留原文件。');
}
async function refreshSelectedProject() {
  const select = $('wsProject');
  if (select.value === '') throw Error('请先选择项目');
  const index = Number(select.value);
  const freshIndex = await adapter.refreshArchive(index);
  if (!adapter.projects()[freshIndex]) throw Error('项目档案已变化，请重新选择');
  archiveContext = await adapter.archiveContext(freshIndex);
  select.replaceChildren(...adapter.projects().map((project, i) => new Option(project.name, i)));
  select.value = String(freshIndex);
  return freshIndex;
}
function status(s){$('wsStatus').textContent=s}
function dataRows() {
  return Object.entries(dataTopics).map(([key,[name,unit]]) => {
    const isSupply = key === 'supply';
    const help = isSupply ? 'WGS84 点图层。properties.kind 填类型代码，value 填可供套数或设施容量。' +
      Object.entries(RenewalProgram.methods).map(([code, method]) => method.name + ' ' + code + '（' + method.unit + '）').join('、') :
      unit + ' · WGS84 GeoJSON，数值写在 properties.value。请统一同一时点与同一口径。';
    return '<section class="ws-data"><h3>' + name + '</h3><p>' + help + '</p>' +
      '<label>数据来源<input id="wsSource-' + key + '"></label><label>数据日期<input id="wsDate-' + key + '" type="date"></label>' +
      '<label>上传数据<input type="file" data-upload="' + key + '" accept=".geojson,.json"></label><small id="wsCount-' + key + '">未加载</small>' +
      (isSupply ? '' : '<button class="ws-tool" data-show-topic="' + key + '">在地图显示' + name + '</button>') + '</section>';
  }).join('');
}
async function upload(key, file) {
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) throw Error('单份专题数据最多 3 MB');
  const data = JSON.parse(await file.text());
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length > 5000) {
    throw Error('需为不超过 5000 条的 GeoJSON FeatureCollection');
  }
  for (const feature of data.features) {
    const geometry = feature?.geometry;
    if (!['Point', 'Polygon', 'MultiPolygon'].includes(geometry?.type) || !Array.isArray(geometry.coordinates)) {
      throw Error('仅支持坐标有效的点和面数据');
    }
    const value = feature.properties?.value;
    if (key !== 'supply' && (!Number.isFinite(value) || value < 0)) throw Error('每条数据需有非负数值 properties.value');
    const coords = geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates.flat(geometry.type === 'Polygon' ? 1 : 2);
    if (!coords.length || coords.some(p => !Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) ||
        Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw Error('需使用有效 WGS84 经纬度');
  }
  if (key === 'supply') RenewalProgram.validateSupply(data);
  layers[key] = data;
  program?.invalidate();
  assessment?.invalidate();
  $('wsCount-' + key).textContent = '已加载 ' + data.features.length + ' 条，请填写来源和日期';
  status('已加载 ' + dataTopics[key][0] + '，可保存到本机项目库。');
}
const text=(x,y,s,size=18)=>`<text x="${x}" y="${y}" font-family="Microsoft YaHei,PingFang SC,sans-serif" font-size="${size}" fill="#193b46">${esc(s)}</text>`;
function thematic(key,input){const [name,unit]=topics[key],layer=layers[key],source=$('wsSource-'+key).value.trim(),date=$('wsDate-'+key).value;let fs=[];if(layer){if(!source||!date)throw Error(name+'需要填写数据来源和日期');const circle=turf.circle(input.center,input.radius/1000,{steps:64,units:'kilometers'});fs=layer.features.filter(f=>f.geometry.type==='Point'?RenewalBrief.distance(input.center,f.geometry.coordinates)<=input.radius:turf.booleanIntersects(f,circle));}
let svg='<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1350" viewBox="0 0 960 1350"><rect width="960" height="1350" fill="#f7faf9"/>'+text(48,70,'URBAN RENEWAL LAB / 专题分析',22)+text(48,135,name,38)+text(48,180,input.project.name+' · '+(input.radius/1000)+' km',22);const notes=[];
if(!fs.length){svg+=text(48,320,layer?'研究范围内没有匹配样本':'尚未提供该专题的数据',27)+text(48,375,'本页为数据缺项说明，不代表数值为零。',20);notes.push(layer?'范围内无样本':'缺少数据');}else{const values=fs.map(f=>f.properties.value).sort((a,b)=>a-b),min=values[0],max=values.at(-1),median=(values[Math.floor((values.length-1)/2)]+values[Math.ceil((values.length-1)/2)])/2;const scale=320/input.radius,c=Math.cos(input.center[1]*Math.PI/180),xy=p=>[480+(p[0]-input.center[0])*111320*c*scale,650-(p[1]-input.center[1])*111320*scale];svg+='<defs><clipPath id="topicmap"><rect x="48" y="270" width="864" height="770"/></clipPath></defs><rect x="48" y="270" width="864" height="770" fill="#e7eeeb"/><g clip-path="url(#topicmap)">';for(const f of fs){const t=max===min?.5:(f.properties.value-min)/(max-min),color=`rgb(${Math.round(70+150*t)},${Math.round(150-85*t)},${Math.round(155-90*t)})`;if(f.geometry.type==='Point'){const q=xy(f.geometry.coordinates);svg+=`<circle cx="${q[0]}" cy="${q[1]}" r="${key==='population'?5+18*Math.sqrt(t):7}" fill="${color}" fill-opacity=".75"/>`}else{const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;for(const p of polygons){const path=p.map(r=>r.map((q,i)=>(i?'L':'M')+xy(q).join(' ')).join(' ')+'Z').join(' ');svg+=`<path d="${path}" fill="${color}" fill-opacity=".6" fill-rule="evenodd" stroke="#fff"/>`}}}svg+='</g>'+text(48,230,`${fs.length} 个样本 · 最小 ${min.toFixed(1)} / 中位 ${median.toFixed(1)} / 最大 ${max.toFixed(1)} ${unit}`,19);notes.push(`样本 ${fs.length}；中位数 ${median.toFixed(1)} ${unit}`);svg+=text(48,1080,'颜色由蓝绿（低）到红（高）；同图相对范围，不同图不宜直接比颜色。',16);}
const foot=key==='population'?'人口数据按原始点／网格展示，不由 POI 推算；不能据此识别个人。':key==='coverage'?'仅展示上传的步行分析结果；未按人口加权，不据此声明人口覆盖率。':'仅描述所提供样本；挂牌价、成交价、商铺与办公租金应分别制作。';svg+=text(48,1140,'来源：'+(source||'未提供')+'；数据日期：'+(date||'未提供'),17)+text(48,1185,foot,16)+text(48,1230,'空间范围：项目中心周边；跨边界面以相交纳入，未裁剪，不计算范围内人口合计。',16)+text(48,1290,'研究草图 · 无道路底图 · 请结合原始数据和现场调研审查',16)+'</svg>';return{key,name,svg,source,date,count:fs.length,notes}}
async function raster(svg){const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));try{const img=new Image();await new Promise((ok,no)=>{img.onload=ok;img.onerror=()=>no(Error('图像生成失败'));img.src=url});const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=2025;canvas.getContext('2d').drawImage(img,0,0,1440,2025);return new Uint8Array(await (await new Promise(r=>canvas.toBlob(r,'image/png'))).arrayBuffer())}finally{URL.revokeObjectURL(url)}}
function narrative(input,charts){
 const archive=input.archiveContext;
 const records=archive?.records||[];
 const parcels=records.filter(row=>row.layer==='宗地层'&&row.linked);
 const buildings=records.filter(row=>row.layer==='建筑层'&&row.linked);
 const plans=records.filter(row=>row.layer==='规划用地层').sort((a,b)=>b.projectShare-a.projectShare);
 const mode=input.project.sourceAttributes?.['更新方式'];
 const lines=[
  '项目：'+input.project.name,
  '研究半径：'+(input.radius/1000)+' 公里；以项目中心划定。',
  '示意项目面积：'+Number(input.areaHa||0).toFixed(2)+' 公顷；非证载面积。',
  input.project.archiveDbId?'来源：本机 PostGIS 项目层 #'+input.project.archiveDbId+'，版本 '+input.project.archiveVersion+'。':'来源：当前页面项目资料。',
  archive?'宗地：档案关联 '+parcels.length+' 条（'+(parcels.map(row=>row.code).join('、')||'无')+'）。':'宗地：未查询。',
  archive?'建筑：相交 '+(archive.counts['建筑层']??0)+' 条；档案关联 '+buildings.length+' 条，逐栋须核。':'建筑：未查询。',
  archive?'交叉关系：'+(archive.crossRelations?.length??0)+' 对；未匹配待核 '+(archive.crossGaps?.length??0)+' 项。':'交叉关系：未查询。',
  plans.length?'规划图斑：主交叠 '+plans[0].code+'，数据库用途 '+(plans[0].use||'未录入')+'。':'规划图斑：未查询。',
  mode?'档案更新方向：'+mode+'；仅作前期意向。':'档案更新方向：未录入。',
  input.poiLoaded?'周边 POI：本次加载 '+input.pois.length+' 处；受数据源覆盖限制。':'周边 POI：暂无匹配查询。',
  ...charts.slice(1).map(c=>c.name+'：'+c.notes.join('；')),
  '研判建议：',
  plans.some(row=>/轨道交通/.test(row.use||''))?
    '优先核实控规现行效力、轨道交通边界及项目权属。':
    '优先核实控规现行效力、项目边界及权属。',
  '逐栋核查结构、消防、用途和实际经营，再定改造深度。',
  '补齐租金、客流和运营数据，比较保留改造与局部调整。',
  '本报告是前期筛查，不替代规划审批或技术鉴定。',
  '计算口径与局限：',
  '相交含边界接触；图层为示意配准，不作法定归属。',
  '价格、人口与公服数据缺失时，不得推断其供需水平。',
  '专题面按相交选入、未经裁剪，不计算范围内人口。'
 ];
 return '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1350"><rect width="960" height="1350" fill="#f7faf9"/>'+text(48,75,'URBAN RENEWAL LAB',23)+text(48,145,'项目前期研判报告',38)+lines.map((line,i)=>text(48,215+i*51,line,17)).join('')+'</svg>';
}
function csvCell(value){
  const raw=String(value??'');
  const safe=/^[=+\-@\t\r]/.test(raw)?"'"+raw:raw;
  return '"'+safe.replace(/"/g,'""')+'"';
}
function crossCsv(context){
  const rows=[['起点图层','起点编号','终点图层','终点编号','关系','字段关联','图形相交','项目范围内交叠㎡'],
    ...(context.crossRelations||[]).map(row=>[row.fromLayer,row.fromCode,row.toLayer,row.toCode,
      row.relation,row.fieldMatch?'是':'否',row.spatialMatch?'是':'否',row.overlapSqm])];
  return '\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
function crossGapCsv(context){
  const rows=[['图层','编号','待核事项'],...(context.crossGaps||[]).map(row=>[row.layer,row.code,row.issue])];
  return '\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
async function downloadAllCrossRelations(button){
  button.disabled=true;
  try{
    const projects=adapter.projects().filter(project=>project.archiveDbId);
    if(!projects.length)throw Error('当前没有数据库项目');
    const rows=[['项目名称','项目记录ID','起点图层','起点编号','终点图层','终点编号','关系','字段关联','图形相交','项目范围内交叠㎡']];
    for(const project of projects){
      const index=adapter.projects().findIndex(row=>row.archiveDbId===project.archiveDbId);
      const context=await adapter.archiveContext(index);
      for(const pair of context.crossRelations||[])rows.push([
        project.name,project.archiveDbId,pair.fromLayer,pair.fromCode,pair.toLayer,pair.toCode,
        pair.relation,pair.fieldMatch?'是':'否',pair.spatialMatch?'是':'否',pair.overlapSqm]);
    }
    download(new Blob(['\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],
      {type:'text/csv;charset=utf-8'}),'全部项目-四层交叉关系.csv');
    status('已导出 '+projects.length+' 个项目、'+(rows.length-1)+' 对交叉关系。');
  }catch(error){status('全部项目导出失败：'+error.message)}
  finally{button.disabled=false}
}
async function generate(){const btn=$('wsExport');btn.disabled=true;try{const i=Number($('wsProject').value),radius=Math.round(Number($('wsRadius').value)*1000);if($('wsProject').value===''||!adapter.projects()[i])throw Error('请先创建项目');if(radius<100||radius>5000||!Number.isFinite(radius))throw Error('半径须在 0.1～5 km');const freshIndex=await refreshSelectedProject();const input=adapter.snapshot(freshIndex,radius);input.archiveContext=archiveContext;lastReportInput=input;lastCharts=[{key:'overview',name:'项目概览与周边POI',svg:RenewalBrief.sheet(input),source:'项目档案与本次已加载高德 POI',date:new Date().toISOString().slice(0,10)},...Object.keys(topics).map(k=>thematic(k,input))];status('正在排版报告与 5 张专题图…');const pdf=new jspdf.jsPDF({unit:'mm',format:'a4'}),files={};pdf.addImage(await raster(narrative(input,lastCharts)),'PNG',0,0,210,295.3);for(let i=0;i<lastCharts.length;i++){const chart=lastCharts[i],png=await raster(chart.svg);files[`配图/${i+1}-${chart.name}.png`]=png;files[`矢量图/${i+1}-${chart.name}.svg`]=fflate.strToU8(chart.svg);pdf.addPage();pdf.addImage(png,'PNG',0,0,210,295.3);}files['前期研判报告.pdf']=new Uint8Array(pdf.output('arraybuffer'));files['数据来源与缺项.json']=fflate.strToU8(JSON.stringify({project:input.project.name,generatedAt:new Date().toISOString(),radiusMeters:radius,spatialContext:input.archiveContext||null,archive:input.project.archiveDbId?{workspace:'建宁路片区',layer:'项目层',recordId:input.project.archiveDbId,version:input.project.archiveVersion,sourceFilename:input.project.archiveSourceFilename,registrationNote:input.project.archiveRegistrationNote}:null,topics:lastCharts.map(({svg,...x})=>x),note:'PDF为图文排版草稿；缺项页不能当作已完成分析。交付包包含逐条交叉关系表和待核清单，不含完整原始图层。'},null,2));files['阅读说明.txt']=fflate.strToU8('本报告包包含一份图文PDF、独立分析图、四层交叉关系表和未匹配清单。缺数据的专题保留明确的缺项说明。房价和租金应区分挂牌/成交、物业类型与日期。人口图仅表示上传数据。公服图仅表示上传的步行结果，不能推导人口覆盖率。');if(input.archiveContext?.crossRelations){files['四层交叉关系.csv']=fflate.strToU8(crossCsv(input.archiveContext));files['交叉未匹配清单.csv']=fflate.strToU8(crossGapCsv(input.archiveContext));}const zip=fflate.zipSync(files,{level:3});download(new Blob([zip],{type:'application/zip'}),'前期研判报告包.zip');$('wsPreview').innerHTML=lastCharts.map(c=>`<article><h3>${esc(c.name)}</h3>${c.svg}</article>`).join('');status('报告包已下载：1 份 PDF＋5 张 PNG＋5 张 SVG＋数据来源清单＋交叉关系 CSV。请审查缺项页。')}catch(e){status('未生成：'+e.message)}finally{btn.disabled=false}}
function focusArchiveFromReport(id){
  root.hidden=true;
  if(!adapter.focusArchive(id)){root.hidden=false;status('地图尚未准备好，请刷新后重试')}
}
function spatialArchiveSection(context) {
  if (!Array.isArray(context?.records)) return null;
  const section=document.createElement('article');
  section.style.gridColumn='1 / -1';
  section.innerHTML='<h3>项目关联的宗地、建筑与规划用地</h3><p>'+esc(context.method)+' '+esc(context.warning)+'</p>';
  for (const [layer,label] of [['宗地层','宗地'],['规划用地层','规划用地'],['建筑层','建筑']]) {
    const records=context.records.filter(row=>row.layer===layer);
    const details=document.createElement('details');
    details.open=layer!=='建筑层';
    const heading=document.createElement('summary');
    heading.textContent=label+' · 空间相交 '+(context.counts?.[layer]??records.filter(row=>row.spatialMatch).length)+' 条'+
      (context.linkedCounts?.[layer]?'，档案关联 '+context.linkedCounts[layer]+' 条':'');
    details.append(heading);
    const scroller=document.createElement('div');
    scroller.style.overflowX='auto';
    const table=document.createElement('table');
    table.style.cssText='width:100%;border-collapse:collapse;margin:10px 0;font-size:13px';
    const head=document.createElement('tr');
    for(const name of ['编号','名称／用途','关系','示意交叠面积','占项目范围','图上查看']){
      const th=document.createElement('th');th.textContent=name;th.style.padding='8px';head.append(th);
    }
    table.append(head);
    for(const row of records){
      const tr=document.createElement('tr');
      const cells=[row.code,row.name,row.relation,
        row.overlapSqm<0.01?(row.spatialMatch?'仅接触':'图形未叠'):row.overlapSqm.toFixed(1)+' ㎡',
        layer==='规划用地层'&&Number.isFinite(row.projectShare)?
          (row.projectShare*100).toFixed(1)+'%':'—'];
      for(const value of cells){const td=document.createElement('td');td.textContent=value;td.style.cssText='padding:8px;border-top:1px solid #d8e5e6';tr.append(td)}
      const td=document.createElement('td'),button=document.createElement('button');
      button.type='button';button.className='ws-tool';button.textContent='地图／档案';
      button.onclick=()=>focusArchiveFromReport(row.id);
      td.append(button);tr.append(td);table.append(tr);
    }
    scroller.append(table);details.append(scroller);section.append(details);
  }
  return section;
}
function crossArchiveSection(context){
  if(!Array.isArray(context?.crossRelations))return null;
  const section=document.createElement('article');section.style.gridColumn='1 / -1';
  section.innerHTML='<h3>四层交叉关系表</h3><p>项目与宗地、建筑、规划用地的逐条关系见上方；下表补全宗地—建筑、宗地—规划用地、建筑—规划用地三组。以当前项目示意范围裁剪后叠加，另核对建筑的“关联宗地编号”。图形交叠不等于权属或规划许可。未匹配项列在表后。</p>';
  const exportButton=document.createElement('button');exportButton.type='button';
  exportButton.className='ws-tool';exportButton.textContent='下载完整交叉关系 CSV';
  exportButton.onclick=()=>download(new Blob([crossCsv(context)],{type:'text/csv;charset=utf-8'}),
    (lastReportInput?.project.name||'项目')+'-四层交叉关系.csv');
  section.append(exportButton);
  const allButton=document.createElement('button');allButton.type='button';
  allButton.className='ws-tool';allButton.textContent='下载全部项目交叉关系 CSV';
  allButton.onclick=()=>downloadAllCrossRelations(allButton);
  section.append(allButton);
  const gapButton=document.createElement('button');gapButton.type='button';
  gapButton.className='ws-tool';gapButton.textContent='下载未匹配清单 CSV';
  gapButton.onclick=()=>download(new Blob([crossGapCsv(context)],{type:'text/csv;charset=utf-8'}),
    (lastReportInput?.project.name||'项目')+'-交叉未匹配清单.csv');
  section.append(gapButton);
  for(const [fromLayer,toLayer,label] of [
    ['宗地层','建筑层','宗地 ↔ 建筑'],['宗地层','规划用地层','宗地 ↔ 规划用地'],
    ['建筑层','规划用地层','建筑 ↔ 规划用地']]){
    const pairs=context.crossRelations.filter(row=>row.fromLayer===fromLayer&&row.toLayer===toLayer);
    const details=document.createElement('details');details.open=pairs.length<=50;
    const summary=document.createElement('summary');summary.textContent=label+' · '+pairs.length+' 对';
    details.append(summary);
    const scroller=document.createElement('div');scroller.style.overflowX='auto';
    const table=document.createElement('table');table.style.cssText='width:100%;border-collapse:collapse;margin:10px 0;font-size:13px';
    const header=document.createElement('tr');
    for(const name of ['起点编号','终点编号','关系','交叠面积','起点档案','终点档案']){
      const th=document.createElement('th');th.textContent=name;th.style.padding='8px';header.append(th);
    }
    table.append(header);
    for(const pair of pairs){
      const tr=document.createElement('tr');
      for(const value of [pair.fromCode,pair.toCode,pair.relation,
        pair.overlapSqm<0.01?(pair.spatialMatch?'0／仅接触':'0／图形未叠'):pair.overlapSqm.toFixed(1)+' ㎡']){
        const td=document.createElement('td');td.textContent=value;
        td.style.cssText='padding:8px;border-top:1px solid #d8e5e6';tr.append(td);
      }
      for(const id of [pair.fromId,pair.toId]){
        const td=document.createElement('td'),button=document.createElement('button');
        button.type='button';button.className='ws-tool';button.textContent='地图／档案';
        button.onclick=()=>focusArchiveFromReport(id);td.append(button);tr.append(td);
      }
      table.append(tr);
    }
    scroller.append(table);details.append(scroller);section.append(details);
  }
  const gaps=context.crossGaps||[];
  const gapHeading=document.createElement('h3');gapHeading.textContent='未匹配与待核 · '+gaps.length+' 项';
  section.append(gapHeading);
  if(!gaps.length){const p=document.createElement('p');p.textContent='当前候选记录未发现空白交叉关系；仍须核实配准和原始档案。';section.append(p)}
  else{
    const list=document.createElement('ul');
    for(const row of gaps){const li=document.createElement('li');li.textContent=row.layer+' '+row.code+'：'+row.issue;list.append(li)}
    section.append(list);
  }
  return section;
}
async function previewReport(){
  reportPreviewOnly=true;
  pendingReport=null;
  try {await generate();}
  finally {reportPreviewOnly=false;}
  if (!pendingReport) return;
  const i=Number($('wsProject').value),radius=Math.round(Number($('wsRadius').value)*1000);
  const input=lastReportInput;
  if (!input) return;
  const summary=document.createElement('article');
  summary.style.gridColumn='1 / -1';
  const fields=input.project.sourceAttributes||{};
  const facts=['项目编号','项目名称','项目类型','位置','用地面积','更新方式','建设内容']
    .filter(key=>fields[key]!=null&&String(fields[key]).trim()!=='')
    .map(key=>'<li><b>'+esc(key)+'：</b>'+esc(fields[key])+'</li>').join('');
  summary.innerHTML='<h3>项目档案与研判依据</h3><p>来源：'+esc(input.project.source||'在线录入')+(input.project.archiveDbId?' · 记录 #'+esc(input.project.archiveDbId)+' · 版本 '+esc(input.project.archiveVersion):'')+'。下列字段取自项目档案；未录入字段不会推断。</p>'+(input.project.archiveRegistrationNote?'<p>坐标说明：'+esc(input.project.archiveRegistrationNote)+'</p>':'')+
    (input.archiveContext?'<p>空间叠加：项目示意边界与宗地 '+esc(input.archiveContext.counts['宗地层']??0)+' 条、建筑 '+esc(input.archiveContext.counts['建筑层']??0)+' 条、规划用地 '+esc(input.archiveContext.counts['规划用地层']??0)+' 条相交。'+esc(input.archiveContext.warning)+'</p>':'')+
    (facts?'<ul>'+facts+'</ul>':'<p>该项目尚无可展示的原始档案字段。</p>')+
    '<h3>研判说明与计算口径</h3>'+narrative(input,lastCharts);
  $('wsPreview').prepend(summary);
  const spatial=spatialArchiveSection(input.archiveContext);
  if(spatial) summary.after(spatial);
  const cross=crossArchiveSection(input.archiveContext);
  if(cross) (spatial||summary).after(cross);
  $('wsDownload').hidden=false;
  status('报告已在本页生成。请先检查数据来源、缺项与建议，再按需下载 PDF 和配图。');
  $('wsPreview').scrollIntoView({behavior:'smooth',block:'start'});
}
function groupedSamples(key,input){const circle=turf.circle(input.center,input.radius/1000,{steps:64,units:'kilometers'});const fs=(layers[key]?.features||[]).filter(f=>f.geometry.type==='Point'?RenewalBrief.distance(input.center,f.geometry.coordinates)<=input.radius:turf.booleanIntersects(f,circle));const groups=new Map();for(const f of fs){const name=String(f.properties.name||f.properties.community||'未命名样本');const g=groups.get(name)||{name,sum:0,count:0,point:f.geometry.type==='Point'?f.geometry.coordinates:turf.centroid(f).geometry.coordinates};g.sum+=f.properties.value;g.count++;groups.set(name,g)}return [...groups.values()].map(g=>({...g,value:g.sum/g.count})).sort((a,b)=>b.value-a.value)}
let thematicMarkers=[];
const programLayers=['study-program-circles','study-program-gap','study-program-heat','study-program-points'];
function clearTopic(){const m=adapter.map();if(m){for(const id of ['study-label','study-circle','study-heat','study-point',...programLayers])if(m.getLayer(id))m.removeLayer(id);for(const id of ['study-data','study-buffer',...programLayers])if(m.getSource(id))m.removeSource(id)}thematicMarkers.forEach(x=>x.remove());thematicMarkers=[];document.getElementById('studyChart')?.remove()}
function mapProgram(result) {
  const m = adapter.map();
  if (!m) throw Error('地图尚未加载');
  clearTopic();
  const add = (id, type, features, paint) => {
    m.addSource(id, { type:'geojson', data:turf.featureCollection(features) });
    m.addLayer({ id, type, source:id, paint });
  };
  if (result.circles?.length) add(programLayers[0], 'fill', result.circles, {
    'fill-color':'#078875', 'fill-opacity':.16, 'fill-outline-color':'#147d6f'
  });
  if (result.uncovered) add(programLayers[1], 'fill', [result.uncovered], {
    'fill-color':'#e77c35', 'fill-opacity':.55, 'fill-outline-color':'#a34f1c'
  });
  if (result.demand.length) {
    const field = result.kind !== 'apartment' && result.target !== null ? 'target' : 'population';
    const max = Math.max(1, ...result.demand.map(row => row[field]));
    add(programLayers[2], 'heatmap', result.demand.map(row => turf.point(row.point, { weight:row[field]/max })), {
      'heatmap-weight':['get','weight'], 'heatmap-radius':30, 'heatmap-opacity':.6,
      'heatmap-color':['interpolate',['linear'],['heatmap-density'],0,'rgba(64,100,210,0)',.3,'#4aa7ed',.65,'#eed168',1,'#ca4841']
    });
  }
  if (result.items.length) add(programLayers[3], 'circle', result.items.map(item => turf.point(item.point, { value:item.value ?? 0 })), {
    'circle-color':result.kind === 'apartment' ? '#b78218' : '#167166',
    'circle-radius':['interpolate',['linear'],['get','value'],0,5,300,12],
    'circle-stroke-color':'white', 'circle-stroke-width':1
  });
  const [west,south,east,north] = turf.bbox(turf.featureCollection([result.study,result.site]));
  m.fitBounds([[west,south],[east,north]], { padding:70, maxZoom:16 });
  const box = document.createElement('div');
  box.id = 'studyChart';
  box.className = 'glass';
  box.style.cssText = 'position:fixed;right:16px;bottom:76px;z-index:48;width:min(380px,85vw);max-height:49vh;overflow:auto;padding:14px';
  const title = document.createElement('b');
  title.textContent = result.method.name + ' · 供需叠加';
  box.append(title);
  const heatLabel = result.kind !== 'apartment' && result.target !== null ? '目标人群样本' : '人口样本';
  const legend = result.kind === 'apartment' ? '暖色热力 · 人口样本｜金色点 · 公寓供给' :
    '绿色 · 同类设施和服务圈｜橙色 · 地块未覆盖部分｜暖色热力 · ' + heatLabel;
  for (const text of [legend, ...RenewalProgram.readout(result)]) {
    const line = document.createElement('p');
    line.textContent = text;
    box.append(line);
  }
  const back = document.createElement('button');
  back.textContent = '返回用途研判';
  back.onclick = () => { clearTopic(); root.hidden = false; };
  const close = document.createElement('button');
  close.textContent = '清除叠加';
  close.onclick = clearTopic;
  box.append(back, close);
  document.body.append(box);
  root.hidden = true;
}
function mapTopic(key,input,items,service=500){const m=adapter.map();if(!m)throw Error('地图尚未加载');clearTopic();const features=items.map(x=>({type:'Feature',properties:{name:x.name,value:x.value||1},geometry:{type:'Point',coordinates:x.point}}));m.addSource('study-data',{type:'geojson',data:{type:'FeatureCollection',features}});if(key==='population'){m.addLayer({id:'study-heat',type:'heatmap',source:'study-data',paint:{'heatmap-weight':['interpolate',['linear'],['get','value'],0,0,Math.max(1,...items.map(x=>x.value)),1],'heatmap-radius':35,'heatmap-opacity':.75,'heatmap-color':['interpolate',['linear'],['heatmap-density'],0,'rgba(0,0,255,0)',.2,'#4595ee',.5,'#f4dd62',1,'#d72d35']}})}else{if(key==='coverage'){m.addSource('study-buffer',{type:'geojson',data:{type:'FeatureCollection',features:items.map(x=>turf.circle(x.point,service/1000,{steps:48,units:'kilometers'}))}});m.addLayer({id:'study-circle',type:'fill',source:'study-buffer',paint:{'fill-color':'#3e9a90','fill-opacity':.16}})}m.addLayer({id:'study-point',type:'circle',source:'study-data',paint:{'circle-radius':6,'circle-color':'#d35f4e','circle-stroke-width':1,'circle-stroke-color':'white'}});m.addLayer({id:'study-label',type:'symbol',source:'study-data',layout:{'text-field':['get','name'],'text-size':12,'text-offset':[0,1.4]},paint:{'text-color':'#214957','text-halo-color':'#fff','text-halo-width':2}})}
 const bounds=turf.bbox(turf.circle(input.center,input.radius/1000,{units:'kilometers'}));m.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{padding:70,maxZoom:15});root.hidden=true;
 const box=document.createElement('div');box.id='studyChart';box.style.cssText='position:fixed;right:16px;bottom:25px;z-index:48;width:min(390px,90vw);max-height:52vh;overflow:auto;background:#fff;padding:18px;border-radius:12px;box-shadow:0 5px 30px #163d4d40';const max=Math.max(1,...items.map(x=>x.value||1));box.innerHTML=`<button id="studyClose" style="float:right">清除专题 ×</button><b>${esc(key==='coverage'?'公服直线服务圈':topics[key][0])}</b><p style="font-size:12px">${key==='coverage'?`设施直线服务半径 ${service} 米；不是道路步行等时圈。查询最多200处，不能代表完整覆盖率。`:key==='population'?'人口热力为上传数据的相对强度；面数据按中心点汇聚，是示意效果。':'样本算术平均；同名样本分组，不是全市场均价。单位：'+topics[key][1]}</p><small>${items.length} 组；地图已叠加。研究半径 ${(input.radius/1000)} 公里。</small>`+(key==='housing'||key==='rent'?items.slice(0,50).map(x=>`<div style="margin:10px 0;font-size:12px">${esc(x.name)} · ${x.value.toFixed(0)} <small>(${x.count}样本)</small><div style="height:9px;background:#398a9e;width:${Math.max(1,x.value/max*100)}%"></div></div>`).join(''):'');document.body.append(box);$('studyClose').onclick=clearTopic;
}
function studyInput(){const i=Number($('wsProject').value),radius=Math.round(Number($('wsRadius').value)*1000);if($('wsProject').value===''||!adapter.projects()[i])throw Error('请先选择项目');if(!Number.isInteger(radius)||radius<100||radius>5000)throw Error('研究半径须为0.1～5公里');const input=adapter.snapshot(i,radius);if(archiveContext?.recordId===input.project.archiveDbId&&archiveContext.projectVersion===input.project.archiveVersion)input.archiveContext=archiveContext;return input}
function assessmentInput() {
  const input = studyInput();
  const market = {};
  if (window.turf) for (const key of ['housing', 'rent']) {
    const source = $('wsSource-' + key).value.trim();
    const date = $('wsDate-' + key).value;
    if (!layers[key] || !source || !date) continue;
    const groups = groupedSamples(key, input);
    const count = groups.reduce((total, group) => total + group.count, 0);
    if (count > 0) {
      const mean = groups.reduce((total, group) => total + group.sum, 0) / count;
      market[key] = { count, mean, source, date };
    }
  }
  return { ...input, market, programEvidence:program?.evidence() };
}
function programLayer(key) {
  if (!layers[key]) return null;
  const source = $('wsSource-' + key).value.trim();
  const date = $('wsDate-' + key).value;
  if (!source || !date) throw Error('请填写' + dataTopics[key][0] + '的数据来源和日期');
  return { data:layers[key], source, date };
}
async function showTopic(key){try{const input=studyInput();if(!layers[key])throw Error('请先上传授权数据；房价和租金供应商接口尚未配置');if(!$('wsSource-'+key).value||!$('wsDate-'+key).value)throw Error('请填写来源与日期');mapTopic(key,input,key==='population'?(layers[key].features.filter(f=>RenewalBrief.distance(input.center,f.geometry.type==='Point'?f.geometry.coordinates:turf.centroid(f).geometry.coordinates)<=input.radius).map(f=>({name:f.properties.name||'人口样本',value:f.properties.value,point:f.geometry.type==='Point'?f.geometry.coordinates:turf.centroid(f).geometry.coordinates}))):groupedSamples(key,input))}catch(e){status(e.message)}}
async function publicServices(){const b=$('wsPublic');b.disabled=true;try{const input=studyInput(),service=+$('wsServiceRadius').value;if(!Number.isFinite(service)||service<50||service>3000)throw Error('服务半径须为50～3000米');let items=[],total=0;for(let page=1;page<=10;page++){status('正在查询公服设施第'+page+'页…');const r=await fetch('/api/amap-poi?'+new URLSearchParams({center:input.center.join(','),radius:String(input.radius),page:String(page),publicOnly:'1'}));const d=await r.json();if(!r.ok)throw Error(d.error);items.push(...d.pois);total=d.total;if(!d.hasMore)break}items=[...new Map(items.map(x=>[x.id||x.name,x])).values()];mapTopic('coverage',input,items,service);status(`已查询${items.length}处，高德报告约${total}处；直线服务圈仅供筛查。`)}catch(e){status(e.message)}finally{b.disabled=false}}
async function storeProject(load){try{if(load&&!confirm('将用数据库中的项目快照替换当前资源和专题数据。建议先下载浏览器备份。是否继续？'))return;const r=await fetch('/api/local-project',load?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...adapter.save(),studyLayers:layers,studyMeta:Object.fromEntries(Object.keys(dataTopics).map(k=>[k,{source:$('wsSource-'+k).value,date:$('wsDate-'+k).value}]))})});const d=await r.json();if(!r.ok)throw Error(d.error||'存储服务不可用');if(load){if(!d.state)throw Error('数据库还没有保存过项目');adapter.restore(d.state);program?.invalidate();layers=d.state.studyLayers||{};for(const k of Object.keys(dataTopics)){const meta=d.state.studyMeta?.[k]||{};$('wsSource-'+k).value=meta.source||'';$('wsDate-'+k).value=meta.date||'';$('wsCount-'+k).textContent='已恢复 '+(layers[k]?.features.length||0)+' 条'}panel()}status((load?'已恢复':'已保存')+'数据库快照 #'+d.id+' · '+d.createdAt+'。位于本机项目目录 .local-data/projects.sqlite，不是云端。')}catch(e){status('数据库操作失败：'+e.message+'；公网尚未接云数据库。')}}

function captureStudy() {
  return {
    studyLayers: layers,
    studyMeta: Object.fromEntries(Object.keys(dataTopics).map(key => [key, {
      source: $('wsSource-' + key).value,
      date: $('wsDate-' + key).value
    }]))
  };
}
function restoreStudy(state) {
  program?.invalidate();
  assessment?.invalidate();
  clearTopic();
  root.hidden = true;
  lastCharts = [];
  $('wsPreview').replaceChildren();
  layers = state.studyLayers || {};
  for (const key of Object.keys(dataTopics)) {
    const metadata = state.studyMeta?.[key] || {};
    $('wsSource-' + key).value = metadata.source || '';
    $('wsDate-' + key).value = metadata.date || '';
    $('wsCount-' + key).textContent = layers[key] ? '已加载 ' + layers[key].features.length + ' 条' : '未加载';
    root.querySelector('[data-upload="' + key + '"]').value = '';
  }
}
window.RenewalWorkspace={captureStudy,restoreStudy,isImporting:()=>uploadsPending>0,init(a){adapter=a;const style=document.createElement('style');style.textContent=`.ws{position:fixed;inset:70px 14px 14px;z-index:50;background:#f5f8f8;border:1px solid #bed0d4;border-radius:18px;display:grid;grid-template-columns:190px 1fr;box-shadow:0 15px 65px #17343d40;overflow:hidden}.ws[hidden]{display:none}.ws aside{background:#17343d;color:white;padding:24px 14px}.ws aside button{display:block;width:100%;padding:13px;margin:8px 0;text-align:left;border:0;border-radius:8px;background:#31515b;color:white}.ws main{padding:25px;overflow:auto}.ws header{display:flex;justify-content:space-between;align-items:center}.ws header button{border:0;padding:10px;border-radius:9px}.ws h2{font-size:25px}.ws h3{border:0;margin:12px 0}.ws p{line-height:1.65;color:#526e78;font-size:14px}.ws-controls,.ws-grid{display:grid;grid-template-columns:1fr 1fr;gap:15px}.ws-data{padding:18px;background:white;border:1px solid #cedbde;border-radius:12px}.ws label{display:block;font-size:13px;margin:8px 0}.ws label[hidden]{display:none}.ws-tool{border:1px solid #b8cdd3;background:white;border-radius:8px;padding:12px;color:#264c5b;margin:4px}.ws #wsPreview{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.ws #wsPreview svg{width:100%;height:auto}.ws-status{background:#e2eeef;padding:12px;border-radius:10px;position:sticky;bottom:0}.ws .primary{max-width:350px}@media(max-width:720px){.ws{inset:70px 5px 5px;display:block}.ws aside{display:flex;gap:3px;padding:6px}.ws aside b{display:none}.ws aside button{font-size:11px;margin:0;padding:8px}.ws main{height:calc(100% - 55px);padding:15px}.ws-controls,.ws-grid{grid-template-columns:1fr}}`;document.head.append(style);root=document.createElement('section');root.className='ws';root.hidden=true;root.innerHTML=`<aside><b>前期研究工作区</b><button data-jump="wsStart">01 项目范围</button><button data-jump="wsData">02 数据准备</button><button data-jump="wsAnalysis">03 分析工具</button><button data-jump="wsProgram">04 用途研判</button><button data-jump="wsAssessment">05 Qwen 解读</button><button data-jump="wsDeliver">06 报告交付</button></aside><main><header><h2>研判报告</h2><button id="wsClose">返回地图 ×</button></header><p>从项目边界出发，整理证据、运行分析，再交付一份报告和配图。</p><section id="wsStart"><h3>项目与范围</h3><div class="ws-controls"><label>更新资源<select id="wsProject"></select></label><label>研究半径（公里）<input id="wsRadius" type="number" value="2" min="0.1" max="5" step="0.1"></label></div></section><section id="wsData"><h3>专题数据</h3><p>第一版支持 GeoJSON 点或面。字段 value 为本专题数值；数据来源与日期进入交付清单。房价单位元/㎡，商业租金元/㎡·月，人口为人，步行范围为分钟。</p><div class="ws-grid">${dataRows()}</div></section><section id="wsAnalysis"><h3>地图专题与工作流</h3><p>前期研究负责项目选择、证据整理和报告交付；工作流负责运行具体分析。房价／租金自动数据源待签约接入，现可用授权文件预演同一分析流程。</p><label>公服直线服务半径（米）<input id="wsServiceRadius" type="number" value="500" min="50" max="3000"></label><button id="wsPublic" class="ws-tool">查询周边公服并生成服务圈</button><p>点击进入现有分析工具，完成后可从顶部“前期研究”返回。当前报告包的公服专题需上传经过审查的步行结果 GeoJSON。</p>${[['openPOI','周边 POI'],['openCoverage','片区步行覆盖'],['openMorphology','街区形态'],['openEconomics','经济测算'],['openDensity','资源密度']].map(([id,n])=>`<button class="ws-tool" data-tool="${id}">${n}</button>`).join('')}</section><section id="wsDeliver"><h3>项目保存与交付</h3><p>浏览器自动保存与本机数据库是两份独立副本。数据库保存包含本页专题数据；换电脑需备份数据库文件。公网存储等待云数据库接入。</p><button id="wsSave" class="ws-tool">保存到本机数据库</button><button id="wsLoad" class="ws-tool">从本机数据库恢复</button><p>包含项目概览、房价、商业租金、人口分布、公服步行范围。缺数据的专题保留缺项说明。PDF 与独立配图同步生成。</p><button class="primary" id="wsExport">生成 PDF＋配图 ZIP</button><div id="wsPreview"></div></section><p class="ws-status" id="wsStatus" role="status"></p></main>`;document.body.append(root);
 queueMicrotask(()=>{
   root.querySelector('aside b').textContent='研判报告';
   const action=$('wsExport');
   action.textContent='在页面生成研判报告';
   action.onclick=previewReport;
   const exportButton=document.createElement('button');
   exportButton.id='wsDownload';
   exportButton.className='ws-tool';
   exportButton.textContent='下载 PDF 与配图 ZIP';
   exportButton.hidden=true;
   exportButton.onclick=()=>{if(pendingReport)download(pendingReport,'前期研判报告包.zip')};
   action.after(exportButton);
 });
 assessment = window.RenewalAssessment.mount({ container:root.querySelector('main'), getInput:assessmentInput, refresh:refreshSelectedProject });
program = window.RenewalProgram.mount({ container:root.querySelector('main'), getInput:studyInput, getLayer:programLayer,
  showMap:mapProgram, onChange:() => assessment.invalidate(), ask:question => assessment.ask(question) });
for (const id of ['wsProject','wsRadius','wsSource-population','wsDate-population','wsSource-supply','wsDate-supply']) {
  $(id).addEventListener('input', () => { program.invalidate(); assessment.invalidate(); });
}
$('wsClose').onclick=()=>root.hidden=true;root.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>$(b.dataset.jump).scrollIntoView({behavior:'smooth'}));root.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{root.hidden=true;document.getElementById(b.dataset.tool).click()});root.querySelectorAll('[data-upload]').forEach(el=>el.onchange=async()=>{uploadsPending++;try{await upload(el.dataset.upload,el.files[0])}catch(e){status(e.message)}finally{uploadsPending--}});$('wsPublic').onclick=publicServices;$('wsSave').onclick=()=>storeProject(false);$('wsLoad').onclick=()=>storeProject(true);root.querySelectorAll('[data-show-topic]').forEach(b=>b.onclick=()=>showTopic(b.dataset.showTopic));$('wsExport').onclick=generate;const nav=document.querySelector('.workspace-nav'),button=document.createElement('button');button.textContent='研判报告';button.id='openWorkspace';button.onclick=()=>panel();nav.append(button);},open:panel,
  close(){if(root)root.hidden=true;},
  openAssessment(index) {
    panel(index);
    requestAnimationFrame(() => $('wsProgram').scrollIntoView({block:'start'}));
  }
};
})();
