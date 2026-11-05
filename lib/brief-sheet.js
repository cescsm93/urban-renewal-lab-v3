/* One-page evidence sheet. Calculations use only the supplied project snapshot. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RenewalBrief=api})(typeof window==='undefined'?globalThis:window,function(){
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const finite=n=>Number.isFinite(Number(n));
 const round=(n,d=1)=>Number(n).toFixed(d);
 function summarize(input){
  const p=input.project||{},center=input.center||[0,0],radius=Number(input.radius)||1000;
  const pois=(input.pois||[]).filter(x=>Array.isArray(x.point)&&x.point.length===2&&distance(center,x.point)<=radius);
  const groups={商业服务:0,教育:0,医疗:0,公园绿地:0,其他:0};
  for(const poi of pois){const s=String(poi.type||'')+' '+String(poi.name||'');if(/学校|大学|幼儿园|教育/.test(s))groups.教育++;else if(/医院|诊所|卫生|医疗|药店/.test(s))groups.医疗++;else if(/公园|绿地|广场|景区/.test(s))groups.公园绿地++;else if(/餐饮|购物|商场|超市|便利|生活服务|商务|写字楼|咖啡/.test(s))groups.商业服务++;else groups.其他++}
  const walk=input.walk&&distance(center,input.walk.origin||[])<=30?input.walk:null;
  return {project:p,center,radius,pois,groups,walk,areaHa:finite(input.areaHa)?Number(input.areaHa):0,date:input.date||new Date().toISOString().slice(0,10),poiQueryComplete:!!input.poiQueryComplete,poiLoaded:!!input.poiLoaded};
 }
 function distance(a,b){if(!Array.isArray(a)||!Array.isArray(b)||a.length<2||b.length<2)return Infinity;const R=6371000,t=Math.PI/180,dLat=(b[1]-a[1])*t,dLon=(b[0]-a[0])*t,h=Math.sin(dLat/2)**2+Math.cos(a[1]*t)*Math.cos(b[1]*t)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
 function sheet(input){const d=summarize(input),p=d.project,W=960,H=1350;
  const tx=(x,y,v,size=17,color='#18343d',weight=400)=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" font-family="Microsoft YaHei,PingFang SC,sans-serif">${esc(v)}</text>`;
  const line=(x1,y1,x2,y2,color='#d8e1e3',width=1)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"/>`;
  const rect=(x,y,w,h,fill,rx=12)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>`;
  const textLines=(x,y,str,max=28,step=27,size=16,color='#385760')=>{let out='',s=String(str||'');for(let i=0;i<s.length;i+=max)out+=tx(x,y+i/max*step,s.slice(i,i+max),size,color);return out};
  const mapX=48,mapY=281,mapW=552,mapH=500,scale=Math.min(mapW,mapH)*.38/d.radius,cos=Math.cos(d.center[1]*Math.PI/180),project=point=>[mapX+mapW/2+(point[0]-d.center[0])*111320*cos*scale,mapY+mapH/2-(point[1]-d.center[1])*111320*scale];
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="960" height="1350" fill="#f8faf9"/>${rect(0,0,960,12,'#193c46',0)}${tx(48,68,'URBAN RENEWAL LAB / 项目前期研判',20,'#51717b',700)}${tx(48,121,p.name||'未命名资源',39,'#17343d',800)}${tx(48,158,`${p.type||'未分类'} · ${p.stage||'前期研究'} · ${d.date}`,16,'#607b83')}${line(48,183,912,183)}`;
  const cards=[['资源用地',`${round(d.areaHa,2)} ha`],['周边范围',`${round(d.radius/1000,1)} km`],['已加载 POI',d.poiLoaded?String(d.pois.length):'未查询'],['规划建面',finite(p.plannedGfa)&&Number(p.plannedGfa)>0?`${round(Number(p.plannedGfa)/10000,1)} 万㎡`:'待录入']];
  cards.forEach((c,i)=>{const x=48+i*220;svg+=rect(x,202,204,62,'#e8f0f0')+tx(x+13,225,c[0],13,'#637d83')+tx(x+13,250,c[1],21,'#17343d',700)});
  svg+=rect(mapX,mapY,mapW,mapH,'#edf2f0')+`<clipPath id="mapclip"><rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" rx="12"/></clipPath><g clip-path="url(#mapclip)">`;
  for(let x=mapX+46;x<mapX+mapW;x+=68)svg+=line(x,mapY,x,mapY+mapH,'#dde7e4');for(let y=mapY+37;y<mapY+mapH;y+=68)svg+=line(mapX,y,mapX+mapW,y,'#dde7e4');
  svg+=`<circle cx="${mapX+mapW/2}" cy="${mapY+mapH/2}" r="${(d.radius*scale).toFixed(1)}" fill="none" stroke="#9eb6b8" stroke-width="2" stroke-dasharray="8 7"/>`;
  const geo=p.geometry||{type:'Polygon',coordinates:[[...(p.pts||[]),(p.pts||[])[0]]]},polys=geo.type==='MultiPolygon'?geo.coordinates:[geo.coordinates];
  for(const polygon of polys){let paths='';for(const ring of polygon||[]){if(!ring?.length)continue;paths+=ring.map((pt,i)=>{const q=project(pt);return(i?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)}).join(' ')+' Z '}svg+=`<path d="${paths}" fill="#d9835a" fill-opacity=".35" fill-rule="evenodd" stroke="#b45338" stroke-width="3"/>`}
  d.pois.slice(0,300).forEach(poi=>{const q=project(poi.point);svg+=`<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="4" fill="#377f92" stroke="white" stroke-width="1"/>`});const c=project(d.center);svg+=`<circle cx="${c[0]}" cy="${c[1]}" r="7" fill="#17343d" stroke="white" stroke-width="2"/></g>`;
  svg+=tx(65,310,'项目边界与已加载地点 · 位置示意',14,'#365b65',700)+tx(65,755,'● 更新资源中心   ● 高德地点   ■ 项目边界',13,'#365b65')+tx(622,305,'周边业态与设施',21,'#17343d',800);
  if(d.poiLoaded){let j=0;for(const [name,n] of Object.entries(d.groups)){svg+=tx(622,345+j*55,name,16)+tx(870,345+j*55,n,19,'#17343d',700)+line(622,360+j*55,905,360+j*55);j++}svg+=textLines(622,655,d.poiQueryComplete?'已加载分页结果；仍受高德收录和排序限制。':'仅统计当前已加载的分页，不代表范围内全部设施。',17,24,14)}else svg+=textLines(622,354,'尚未运行本项目的周边 POI 查询。请先查询再生成研判图。',18,25,16);
  svg+=line(48,811,912,811)+tx(48,852,'初步研判',23,'#17343d',800);
  const econ=p.entCalc,insights=[`地块面积 ${round(d.areaHa,2)} ha，现状用途：${p.currentUse||'待录入'}；拟定用途：${p.plannedUse||'待录入'}。`,d.poiLoaded?`已加载 ${d.pois.length} 个 ${round(d.radius/1000,1)} km 内地点；商业服务 ${d.groups.商业服务}、教育 ${d.groups.教育}、医疗 ${d.groups.医疗}、公园绿地 ${d.groups.公园绿地}。`:'周边业态与公服尚无本项目查询结果，暂不判断供给充足程度。',d.walk?`本次最近候选设施路线：${d.walk.results?.filter(r=>Number.isFinite(r.duration)).length||0} 条可用；仅代表候选设施路线时间。`:'尚无以该资源中心点为起点的步行分析结果；不判断公服覆盖率。',econ?`按档案人工输入参数测算：企业投资 ${round(econ.investment||0,0)} 万元，项目 IRR ${econ.projectIrr==null?'未算出':round(econ.projectIrr*100,1)+'%'}；并非市场估值。`:'尚未运行经济测算；租金、成本等参数需另行核实。'];
  insights.forEach((s,i)=>{svg+=`<circle cx="58" cy="${886+i*54}" r="5" fill="#bc6c4b"/>`+textLines(75,891+i*54,s,49,23,16)});
  svg+=line(48,1110,912,1110)+tx(48,1150,'数据状态与方法',21,'#17343d',800)+textLines(48,1181,'房价、商业租金、人口：尚未接入可靠数据；本页不展示估计值。',54,23,15)+textLines(48,1210,'面积来自项目资源档案；POI 来自已加载的高德搜索结果。圆心距离为直线距离。',54,23,15)+textLines(48,1239,'点位数量不等于商业需求或设施服务能力；位置图为几何示意，无道路与底图。',54,23,15)+tx(48,1307,'研究草图 · 需核实数据来源、采集时间与现场情况后用于正式决策',14,'#6e8489')+tx(875,1307,'01 / 01',13,'#6e8489')+'</svg>';
  return svg;
 }
 return {summarize,sheet,distance};
});
