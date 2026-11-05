import * as THREE from 'three';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {routeAnalysis} from './route-analysis.mjs';
import {terrainRequest,terrainError} from './terrain-network.mjs';
const TERRAIN_API='https://urban-renewal-lab-1.vercel.app/api/snow-terrain';
const modelCache=new Map();
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
let disposeScene=null,token=0;
document.querySelector('#mountain-dialog').addEventListener('close',()=>closeMountain());
const colors={novice:0x29e9b4,easy:0x29e9b4,intermediate:0x37bbff,advanced:0xff5d86,expert:0xd186ff,freeride:0xffad50,unknown:0xc4d4e1};
const labels={novice:'初级',easy:'初级',intermediate:'中级',advanced:'高级',expert:'专家',freeride:'野雪',unknown:'未标难度'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function sample(model,lon,lat){const[w,s,e,n]=model.bounds,u=Math.max(0,Math.min(model.width-1,(lon-w)/(e-w)*(model.width-1))),v=Math.max(0,Math.min(model.height-1,(n-lat)/(n-s)*(model.height-1))),x=Math.floor(u),y=Math.floor(v),xx=Math.min(x+1,model.width-1),yy=Math.min(y+1,model.height-1),a=u-x,b=v-y,h=model.elevations;return a+b<=1?h[y*model.width+x]+(h[y*model.width+xx]-h[y*model.width+x])*a+(h[yy*model.width+x]-h[y*model.width+x])*b:h[yy*model.width+xx]+(h[yy*model.width+x]-h[yy*model.width+xx])*(1-a)+(h[y*model.width+xx]-h[yy*model.width+xx])*(1-b)}
async function loadLive(resort,status,signal){
 status.textContent='正在读取周边真实雪道，繁忙时会自动尝试备用数据源…';
 let ways=[],routeWarning='';
 try{const response=await terrainRequest(TERRAIN_API+'?kind=pistes&id='+encodeURIComponent(resort.id),{signal,retry:false});const raw=await response.json();ways=raw.elements.filter(w=>w.type==='way'&&w.geometry?.length>1&&w.tags?.area!=='yes');if(!ways.length)routeWarning='周边5公里未取得已映射雪道'}
 catch(error){if(signal.aborted)throw error;routeWarning=terrainError(error)}

 let w=Infinity,e=-Infinity,s=Infinity,n=-Infinity;for(const way of ways)for(const p of way.geometry){w=Math.min(w,p.lon);e=Math.max(e,p.lon);s=Math.min(s,p.lat);n=Math.max(n,p.lat)}if(!ways.length){const dx=5000/(111320*Math.cos(resort.lat*Math.PI/180)),dy=5000/111320;w=resort.lon-dx;e=resort.lon+dx;s=resort.lat-dy;n=resort.lat+dy}else{w-=.002;e+=.002;s-=.002;n+=.002}
 const model={resortId:resort.id,bounds:[w,s,e,n],width:96,height:96,elevations:[],routes:{type:'FeatureCollection',features:ways.map(v=>({type:'Feature',geometry:{type:'LineString',coordinates:v.geometry.map(p=>[p.lon,p.lat])},properties:{osmId:v.id,name:v.tags['piste:name']||v.tags.name||v.tags.ref||`OSM ${v.id}`,difficulty:v.tags['piste:difficulty']||'unknown',source:`https://www.openstreetmap.org/way/${v.id}`}}))},coverageNote:routeWarning?'仅显示概略位置周边真实 DEM 地形；雪道资料暂缺：'+routeWarning+'。未生成任何替代线路。':'按雪场概略位置周边5公里检索的社区映射片段，不是官方完整雪道目录；地形网格随范围变化。',retrievedAt:new Date().toISOString().slice(0,10)};
 status.textContent=routeWarning?'雪道数据暂缺，继续下载真实 DEM 地形…':`已取得 ${ways.length} 段线路，正在下载真实 DEM 地形…`;
 const cache=new Map(),z=12,nt=2**z;
 function tilepoint(lon,lat){return[(lon+180)/360*nt,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*nt]}
 const[ax,ay]=tilepoint(w,n),[bx,by]=tilepoint(e,s);if((Math.floor(bx)-Math.floor(ax)+1)*(Math.floor(by)-Math.floor(ay)+1)>50)throw Error('映射范围过大，暂不自动加载该区域');
 const jobs=[];for(let tx=Math.floor(ax);tx<=Math.floor(bx);tx++)for(let ty=Math.floor(ay);ty<=Math.floor(by);ty++)jobs.push([tx,ty]);
 // Bound concurrent raster downloads; sample actual pixels, never synthesize terrain.
 for(let i=0;i<jobs.length;i+=4)await Promise.all(jobs.slice(i,i+4).map(async([tx,ty])=>{const r=await terrainRequest(TERRAIN_API+`?kind=dem&id=${encodeURIComponent(resort.id)}&x=${tx}&y=${ty}`,{signal});const bitmap=await createImageBitmap(await r.blob()),canvas=document.createElement('canvas');canvas.width=canvas.height=256;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);cache.set(`${tx}/${ty}`,context.getImageData(0,0,256,256).data);bitmap.close()}));
 for(let row=0;row<model.height;row++)for(let col=0;col<model.width;col++){const[x,y]=tilepoint(w+(e-w)*col/(model.width-1),n-(n-s)*row/(model.height-1)),pixels=cache.get(`${Math.floor(x)}/${Math.floor(y)}`),k=(Math.min(255,Math.floor(y%1*256))*256+Math.min(255,Math.floor(x%1*256)))*4;model.elevations.push(Math.round((pixels[k]*256+pixels[k+1]+pixels[k+2]/256-32768)*10)/10)}
 return model;
}
export function closeMountain(){token++;disposeScene?.();disposeScene=null}
export async function openMountain(resort){
 closeMountain();const generation=token,dialog=document.querySelector('#mountain-dialog'),body=document.querySelector('#mountain-body');
 body.innerHTML=`<div class="mountain-header"><span class="eyebrow">TERRAIN EXPLORER / THREE.JS</span><h2>${esc(resort.nameZh||resort.name)} <small>${esc(resort.nameEn||'')}</small></h2><p>真实高程 · 雪道空间位置 · 原比例地形</p></div><div class="mountain-layout"><div class="terrain-stage"><div id="terrain-canvas"></div><div class="terrain-overlay"><span id="terrain-status" role="status">正在读取真实三维地形…</span><div><button id="terrain-reset">复位视角</button><button id="terrain-wire">网格</button></div></div><div class="terrain-hint">拖动旋转 · 双指 / 滚轮缩放 · 右键平移 · 高程比例 1:1</div></div><aside class="terrain-info"><div class="route-title"><span id="route-count">雪道档案</span><select id="terrain-filter" aria-label="三维雪道难度"><option value="all">全部难度</option><option value="easy">初级</option><option value="intermediate">中级</option><option value="advanced">高级 / 专家</option></select></div><div id="terrain-routes"></div><p class="terrain-disclaimer" id="terrain-note">DEM为历史地形，不含实时雪面；雪道宽度为显示效果，不是实测。社区线路可能不完整。</p></aside></div>`;
 dialog.showModal();const controller=new AbortController();let model;const status=document.querySelector('#terrain-status');
 let abortTimer;
 disposeScene=()=>{controller.abort();clearTimeout(abortTimer)};
 try{
  if(modelCache.has(resort.id)){model=modelCache.get(resort.id)}
  else if((await fetch('models/index.json').then(r=>r.ok?r.json():{}).catch(()=>({})))[resort.id]){abortTimer=setTimeout(()=>controller.abort(),30000);const r=await terrainRequest(`models/${resort.id}.json`,{signal:controller.signal});model=await r.json()}
  else{status.textContent='此雪场未预载模型。可联网获取真实地形与周边已映射雪道。';const b=document.createElement('button');b.className='primary';b.textContent='加载周边真实地形';status.append(document.createElement('br'),b);await new Promise((resolve,reject)=>{b.onclick=resolve;controller.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})});abortTimer=setTimeout(()=>controller.abort(),120000);model=await loadLive(resort,status,controller.signal)}
  clearTimeout(abortTimer);if(generation!==token)return;if(model.routes.features.length&&modelCache.size>=12)modelCache.delete(modelCache.keys().next().value);if(model.routes.features.length)modelCache.set(resort.id,model);const clean=buildScene(model,resort);disposeScene=()=>{controller.abort();clean()};
 }catch(error){if(generation!==token)return;clearTimeout(abortTimer);controller.abort();status.textContent=terrainError(error);const retry=document.createElement('button');retry.className='primary';retry.textContent='重新加载地形';retry.onclick=()=>{dialog.addEventListener('close',()=>openMountain(resort),{once:true});dialog.close()};status.append(document.createElement('br'),retry);document.querySelector('#terrain-note').textContent='没有取得真实地形数据时不显示替代山体。地图和百科仍可使用。'}
}
function buildScene(model,resort){
 const mount=document.querySelector('#terrain-canvas'),status=document.querySelector('#terrain-status'),routeBox=document.querySelector('#terrain-routes');
 const[w,s,e,n]=model.bounds,lat=(n+s)/2,worldW=(e-w)*111.32*Math.cos(lat*Math.PI/180),worldD=(n-s)*111.32,min=Math.min(...model.elevations),max=Math.max(...model.elevations),span=Math.max(worldW,worldD);
 const scene=new THREE.Scene();scene.background=new THREE.Color('#071320');scene.fog=new THREE.Fog('#0a171e',span*2,span*6);
 const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor('#0a171e');mount.append(renderer.domElement);renderer.domElement.setAttribute('aria-label','真实 DEM 三维地形与雪道');
 const camera=new THREE.PerspectiveCamera(42,1,.01,span*20),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=span*.12;controls.maxDistance=span*4;controls.maxPolarAngle=Math.PI*.49;
 const gridHelper=new THREE.GridHelper(span*1.5,24,0x28576a,0x142d40);gridHelper.position.y=-.18;scene.add(gridHelper);const rim=new THREE.DirectionalLight(0x34bfff,2);rim.position.set(span,.5*span,-span);scene.add(rim);const targetY=(max-min)/2000;function reset(){controls.target.set(0,targetY,0);camera.position.set(span*1.2,span*1.1,span*1.4);controls.update()}reset();
 scene.add(new THREE.HemisphereLight(0xe1f7ff,0x263b47,2.2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-span,span*2,span*.6);scene.add(light);
 const geo=new THREE.PlaneGeometry(worldW,worldD,model.width-1,model.height-1);geo.rotateX(-Math.PI/2);const pos=geo.attributes.position;
 for(let i=0;i<pos.count;i++)pos.setY(i,(model.elevations[i]-min)/1000);
 geo.computeVertexNormals();const vertexColors=new Float32Array(pos.count*3),normal=geo.attributes.normal;
 for(let i=0;i<pos.count;i++){const relative=(model.elevations[i]-min)/(max-min||1),steep=1-normal.getY(i),c=new THREE.Color().setHSL(.53,.08+steep*.2,.24+relative*.38-steep*.14);vertexColors.set([c.r,c.g,c.b],i*3)}
 geo.setAttribute('color',new THREE.BufferAttribute(vertexColors,3));const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,metalness:.05,side:THREE.DoubleSide});scene.add(new THREE.Mesh(geo,material));
 const wireMaterial=new THREE.MeshBasicMaterial({color:0x88bec9,wireframe:true,transparent:true,opacity:.13});const wire=new THREE.Mesh(geo,wireMaterial);wire.visible=false;scene.add(wire);
 const base=new THREE.Mesh(new THREE.BoxGeometry(worldW,.13,worldD),new THREE.MeshStandardMaterial({color:0x142b37,roughness:1}));base.position.y=-.1;scene.add(base);
 // Solid georeferenced side walls connect sampled terrain edges to the base.
 const edge=[];for(let x=0;x<model.width;x++)edge.push(x);for(let y=1;y<model.height;y++)edge.push(y*model.width+model.width-1);for(let x=model.width-2;x>=0;x--)edge.push((model.height-1)*model.width+x);for(let y=model.height-2;y>0;y--)edge.push(y*model.width);
 const sides=[];for(let i=0;i<edge.length;i++){const a=edge[i],b=edge[(i+1)%edge.length],A=[pos.getX(a),pos.getY(a),pos.getZ(a)],B=[pos.getX(b),pos.getY(b),pos.getZ(b)],C=[pos.getX(a),-.1,pos.getZ(a)],D=[pos.getX(b),-.1,pos.getZ(b)];sides.push(...A,...C,...B,...B,...C,...D)}const sideGeo=new THREE.BufferGeometry();sideGeo.setAttribute('position',new THREE.Float32BufferAttribute(sides,3));sideGeo.computeVertexNormals();scene.add(new THREE.Mesh(sideGeo,new THREE.MeshStandardMaterial({color:0x243d49,roughness:1,side:THREE.DoubleSide})));
 const meshes=[],group=new THREE.Group();scene.add(group);let selected=null,hovered=null,playing=false,progress=0,playPoints=[],playDistances=[],playLength=0,alive=true;
 const point=(lon,lat)=>new THREE.Vector3((lon-w)/(e-w)*worldW-worldW/2,(sample(model,lon,lat)-min)/1000+Math.max(.006,span*.0009),(n-lat)/(n-s)*worldD-worldD/2);
 const wide=(points,color,width)=>{const g=new LineGeometry();g.setPositions(points.flatMap(p=>[p.x,p.y,p.z]));const mat=new LineMaterial({color,linewidth:width,transparent:true,opacity:.95,depthTest:true});mat.resolution.set(mount.clientWidth,mount.clientHeight);const line=new Line2(g,mat);line.computeLineDistances();return line};
 for(let index=0;index<model.routes.features.length;index++){
  const f=model.routes.features[index],analysis=routeAnalysis(f.geometry.coordinates,(lon,lat)=>sample(model,lon,lat),model.gridSpacingMetres||[100,100]);
  const points=analysis.points.map(p=>point(p.lon,p.lat));if(points.length<2)continue;
  const line=wide(points,colors[f.properties.difficulty]||0x9cadbd,3.2);line.userData.index=index;group.add(line);meshes.push({line,f,index,points,analysis});
 }
 const annotationLayer=document.createElement('div');annotationLayer.className='terrain-annotations';mount.append(annotationLayer);
 const annotations=[];
 function label(text,position,cls=''){const el=document.createElement('button');el.className='terrain-tag '+cls;el.textContent=text;annotationLayer.append(el);const a={el,position,enabled:true};annotations.push(a);return a}
 const peakTag=label('',new THREE.Vector3(),'slope-tag');peakTag.enabled=false;
 const routeTag=label('',new THREE.Vector3(),'route-tag');routeTag.enabled=false;
 const peakGroup=new THREE.Group();scene.add(peakGroup);
 // A stylised skier is a playback cursor on source geometry, not a person or telemetry.
 const skier=new THREE.Group(),bodyMat=new THREE.MeshStandardMaterial({color:0xffb54b,emissive:0x6b2700,emissiveIntensity:.3});
 const body=new THREE.Mesh(new THREE.CapsuleGeometry(.16,.45,4,8),bodyMat);body.position.set(0,.5,0);body.rotation.x=-.3;skier.add(body);
 const head=new THREE.Mesh(new THREE.SphereGeometry(.18,10,8),new THREE.MeshStandardMaterial({color:0xf2faff}));head.position.set(0,1,.13);skier.add(head);
 for(const x of [-.17,.17]){const ski=new THREE.Mesh(new THREE.BoxGeometry(.12,.06,1.2),new THREE.MeshStandardMaterial({color:0x50edff,emissive:0x167f91}));ski.position.set(x,.05,.14);skier.add(ski);const pole=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.8,5),bodyMat);pole.position.set(x*2.5,.35,-.25);pole.rotation.x=.5;skier.add(pole)}
 scene.add(skier);skier.visible=false;
 const halo=new THREE.Mesh(new THREE.RingGeometry(.3,.4,32),new THREE.MeshBasicMaterial({color:0xffc465,transparent:true,opacity:.7,side:THREE.DoubleSide}));halo.rotation.x=-Math.PI/2;halo.position.y=.01;skier.add(halo);
 const extras=document.createElement('section');extras.className='terrain-extras';extras.innerHTML='<div class="experience-actions"><button id="ride-toggle">▶ 滑雪演示</button><button id="steepest">↗ 最大坡度段</button><button id="orbit-toggle">环绕视角</button></div><label class="ride-progress">线路进度 <input id="ride-progress" type="range" min="0" max="1000" value="0"></label><p class="ride-caption">沿记录线路示意播放 · 非真实人物、速度或导航</p><div id="slope-readout" aria-live="polite"></div><details open><summary>☕ 咖啡 · 餐饮 · 商店 <span id="poi-count"></span></summary><select id="poi-filter" aria-label="设施类型"><option value="all">全部设施</option><option value="cafe">咖啡店</option><option value="food">餐饮</option><option value="shop">商店</option><option value="none">隐藏设施</option></select><p id="poi-state">正在读取设施档案…</p><div id="poi-list"></div></details>';
 routeBox.before(extras);
 const format=a=>`${a.angle.toFixed(1)}° / ${a.percent.toFixed(0)}%`;
 const routeName=f=>f.properties.name||`OSM ${f.properties.osmId}`;
 function restyle(){for(const m of meshes){const active=m.index===selected,over=m.index===hovered;m.line.material.linewidth=active?6.5:over?5.5:3.2;m.line.material.opacity=active||over?1:selected===null?.95:.5;m.line.material.color.set(active?0xffce63:colors[m.f.properties.difficulty]||0x9cadbd)}}
 function stop(){playing=false;document.querySelector('#ride-toggle').textContent='▶ 滑雪演示'}
 function select(index){const m=meshes.find(m=>m.index===index);if(!m)return;selected=index;peakGroup.visible=true;stop();progress=0;restyle();playPoints=m.points.slice();if(m.analysis.points[0].h<m.analysis.points.at(-1).h)playPoints.reverse();playDistances=[0];for(let i=1;i<playPoints.length;i++)playDistances.push(playDistances.at(-1)+playPoints[i].distanceTo(playPoints[i-1]));playLength=playDistances.at(-1);skier.visible=true;
  const middle=m.points[Math.floor(m.points.length/2)];routeTag.position.copy(middle);routeTag.el.textContent=routeName(m.f);routeTag.enabled=true;
  document.querySelector('#terrain-selected').textContent=routeName(m.f)+' · '+(labels[m.f.properties.difficulty]||'难度未核实');
  document.querySelectorAll('.terrain-route').forEach(b=>b.classList.toggle('selected',Number(b.dataset.route)===index));
  while(peakGroup.children.length){const c=peakGroup.children[0];peakGroup.remove(c);c.geometry.dispose();c.material.dispose()}
  const a=m.analysis.max;peakTag.enabled=!!a;
  if(a){const segment=m.points.slice(a.start,a.end+1).map(p=>p.clone().add(new THREE.Vector3(0,.006,0)));peakGroup.add(wide(segment,0xff577c,8));peakTag.position.copy(segment[Math.floor(segment.length/2)]);peakTag.el.textContent=`DEM ≈ ${format(a)}`;document.querySelector('#slope-readout').innerHTML=`<strong>${format(a)}</strong><span>该片段最大窗口坡度 · DEM 估算</span><small>${Math.round(a.window)}m 沿线高差 / 水平距离；不是官方最大坡度。网格越粗，窗口越宽。</small>`}
  else document.querySelector('#slope-readout').textContent=`片段短于 ${m.analysis.window}m 分析窗口，最大坡度资料不足。`;
  const urls=m.f.properties.sourceUrls?.length?m.f.properties.sourceUrls:[m.f.properties.source];document.querySelector('#terrain-source-links').innerHTML=urls.filter(u=>/^https:\/\/www\.openstreetmap\.org\/way\/\d+$/.test(u)).map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener">原始线路 ${esc(u.split('/').at(-1))} ↗</a>`).join(' · ');
 }
 function list(){const value=document.querySelector('#terrain-filter').value;const visible=meshes.filter(m=>value==='all'||value==='easy'&&['novice','easy'].includes(m.f.properties.difficulty)||value==='intermediate'&&m.f.properties.difficulty==='intermediate'||value==='advanced'&&['advanced','expert','freeride'].includes(m.f.properties.difficulty));const set=new Set(visible.map(m=>m.index));meshes.forEach(m=>m.line.visible=set.has(m.index));if(selected!==null&&!set.has(selected)){stop();skier.visible=false;peakGroup.visible=false;peakTag.enabled=false;routeTag.enabled=false}else {peakGroup.visible=true;const chosen=meshes.find(m=>m.index===selected);if(chosen){skier.visible=true;routeTag.enabled=true;peakTag.enabled=!!chosen.analysis.max}}routeBox.innerHTML=visible.map(m=>`<button class="terrain-route ${m.index===selected?'selected':''}" data-route="${m.index}"><i style="background:#${(colors[m.f.properties.difficulty]||0x9cadbd).toString(16)}"></i><span>${esc(routeName(m.f))}<small>${esc(labels[m.f.properties.difficulty]||'未知')} · ${m.analysis.max?'DEM ≈ '+m.analysis.max.angle.toFixed(1)+'°':'坡度资料不足'}</small></span></button>`).join('');routeBox.querySelectorAll('button').forEach(b=>b.onclick=()=>{peakGroup.visible=true;select(Number(b.dataset.route))});document.querySelector('#route-count').textContent=`${visible.length} / ${meshes.length} 段社区线路`}
 status.innerHTML=`<b id="terrain-selected">${esc(resort.nameZh||resort.name)} · ${Math.round(min)}–${Math.round(max)} m</b><small>真实高程 1:1 · 红色粗段为 DEM 分析窗口 · 线宽仅用于显示</small>`;
 document.querySelector('#terrain-note').innerHTML=esc(model.coverageNote)+`<br><span id="terrain-source-links">选择线路查看依据。</span><br>坡度仅针对已收录片段；按历史 DEM 沿线窗口估算，不用于全球排名或滑行决策。<br><a href="data/${esc(model.resortId)}-osm.json" target="_blank">线路依据快照 ↗</a> · <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">DEM 来源 ↗</a>`;
 document.querySelector('#terrain-filter').onchange=list;document.querySelector('#terrain-reset').onclick=reset;document.querySelector('#terrain-wire').onclick=()=>wire.visible=!wire.visible;
 const globalPeak=meshes.filter(m=>m.analysis.max).sort((a,b)=>b.analysis.max.angle-a.analysis.max.angle)[0];
 document.querySelector('#steepest').onclick=()=>{if(!globalPeak)return;document.querySelector('#terrain-filter').value='all';list();select(globalPeak.index);controls.target.copy(peakTag.position);document.querySelector('#slope-readout').insertAdjacentHTML('beforeend','<small>当前已收录片段中的最大窗口值；不代表整座雪场官方最大值。</small>')};
 document.querySelector('#steepest').disabled=!globalPeak;
 document.querySelector('#ride-toggle').onclick=()=>{if(selected===null&&meshes.length)select(meshes[0].index);playing=!playing;if(progress>=1)progress=0;document.querySelector('#ride-toggle').textContent=playing?'Ⅱ 暂停演示':'▶ 滑雪演示'};
 document.querySelector('#ride-progress').oninput=e=>{stop();progress=Number(e.target.value)/1000};
 document.querySelector('#orbit-toggle').onclick=e=>{controls.autoRotate=!controls.autoRotate;controls.autoRotateSpeed=.6;e.target.textContent=controls.autoRotate?'暂停环绕':'环绕视角'};
 list();if(meshes.length)select(meshes.reduce((a,b)=>a.analysis.length>b.analysis.length?a:b).index);
 const poiAnnotations=[];
 fetch(`facilities/${resort.id}.json`).then(r=>{if(!r.ok)throw Error();return r.json()}).then(data=>{
  if(!alive)return;document.querySelector('#poi-count').textContent=`${data.features.length}处`;
  document.querySelector('#poi-state').textContent=data.status==='available'?`${data.coverageNote} 采集于 ${data.retrievedAt}。建筑位置为近似中心；显示标签数量受限，可在列表中选择。`:'设施资料暂缺：公开数据获取失败，未生成商户。';
  const entries=data.features.filter(p=>p.coordinates[0]>=w&&p.coordinates[0]<=e&&p.coordinates[1]>=s&&p.coordinates[1]<=n);
  const focus=p=>{controls.target.copy(point(...p.coordinates));for(const a of poiAnnotations)a.enabled=a.poi.id===p.id;document.querySelector('#poi-detail').innerHTML=`<strong>${esc(p.name)}</strong><br><a href="${esc(p.source)}" target="_blank" rel="noopener">查看 OSM 商户记录 ↗</a><small>营业状态未核实 · ${p.positionMethod==='OSM node'?'来源点位':'建筑近似中心'}</small>`};
  const detail=document.createElement('div');detail.id='poi-detail';document.querySelector('#poi-state').after(detail);
  for(const p of entries){const a=label((p.kind==='cafe'?'☕ ':p.kind==='shop'?'▣ ':'♨ ')+p.name,point(...p.coordinates),'poi-tag');a.poi=p;a.el.onclick=()=>focus(p);poiAnnotations.push(a)}
  function showPOIs(){const kind=document.querySelector('#poi-filter').value;const filtered=entries.filter(p=>kind==='all'||p.kind===kind);poiAnnotations.forEach(a=>a.enabled=filtered.slice(0,18).some(p=>p.id===a.poi.id));const box=document.querySelector('#poi-list');box.innerHTML=filtered.map(p=>`<button data-poi="${esc(p.id)}">${p.kind==='cafe'?'☕':p.kind==='shop'?'▣':'♨'} ${esc(p.name)}</button>`).join('')||'<small>当前类别未收录设施</small>';box.querySelectorAll('button').forEach(b=>b.onclick=()=>focus(entries.find(p=>p.id===b.dataset.poi)))}
  document.querySelector('#poi-filter').onchange=showPOIs;showPOIs();
 }).catch(()=>{if(alive)document.querySelector('#poi-state').textContent='设施档案尚未取得，未生成替代商户。'});
 const ray=new THREE.Raycaster();ray.params.Line2={threshold:5};let down=null,lastHover=0;
 function hit(e){const rect=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);return ray.intersectObjects(group.children.filter(c=>c.visible),false)[0]}
 renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const h=hit(e);if(h)select(h.object.userData.index);down=null});
 renderer.domElement.addEventListener('pointermove',e=>{if(e.buttons||performance.now()-lastHover<60)return;lastHover=performance.now();const h=hit(e);hovered=h?.object.userData.index??null;renderer.domElement.style.cursor=h?'pointer':'grab';renderer.domElement.title=h?routeName(meshes.find(m=>m.index===hovered).f):'拖动旋转';restyle()});
 const observer=new ResizeObserver(()=>{const rect=mount.getBoundingClientRect();if(!rect.width||!rect.height)return;renderer.setSize(rect.width,rect.height);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix()});observer.observe(mount);
 let frame,lastTime=performance.now();const projected=new THREE.Vector3(),cameraDirection=new THREE.Vector3();
 function animate(now=performance.now()){
  frame=requestAnimationFrame(animate);const delta=Math.min(.1,(now-lastTime)/1000);lastTime=now;controls.update();
  if(playing){progress=Math.min(1,progress+delta/25);if(progress>=1)stop()}
  if(playPoints.length>1){const distance=progress*playLength;let i=1;while(i<playDistances.length-1&&playDistances[i]<distance)i++;const t=(distance-playDistances[i-1])/(playDistances[i]-playDistances[i-1]||1);skier.position.lerpVectors(playPoints[i-1],playPoints[i],t);skier.rotation.y=Math.atan2(playPoints[i].x-playPoints[i-1].x,playPoints[i].z-playPoints[i-1].z);const size=Math.max(span*.004,camera.position.distanceTo(skier.position)*.012);skier.scale.setScalar(size);document.querySelector('#ride-progress').value=Math.round(progress*1000)}
  camera.getWorldDirection(cameraDirection);
  const occupied=[];for(const a of annotations){projected.copy(a.position).project(camera);const front=a.position.clone().sub(camera.position).dot(cameraDirection)>0,visible=a.enabled&&front&&projected.z<1&&Math.abs(projected.x)<.98&&Math.abs(projected.y)<.96;const x=Math.max(85,Math.min(mount.clientWidth-85,(projected.x*.5+.5)*mount.clientWidth)),y=(-projected.y*.5+.5)*mount.clientHeight;const collision=occupied.some(b=>Math.abs(b[0]-x)<145&&Math.abs(b[1]-y)<38);a.el.hidden=!visible||collision;if(visible&&!collision){occupied.push([x,y]);a.el.style.left=x+'px';a.el.style.top=y+'px'}}
  renderer.render(scene,camera);
 }animate();
 return()=>{alive=false;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();scene.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose()});renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();annotationLayer.remove()};
}
