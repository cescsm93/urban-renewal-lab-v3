const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const roadHandler=require('./api/amap-roads.js'),walkHandler=require('./api/walk-access.js'),poiHandler=require('./api/amap-poi.js'),copilotHandler=require('./api/copilot.js');const base=__dirname;
const offlinePopulation=require('./lib/offline-population.cjs');
const localStore=require('./lib/local-store.cjs');
const gisBridge=require('./gis/local-bridge.cjs');
const spatialBridge=require('./gis/spatial-bridge.cjs');
const gdbBridge=require('./gis/gdb-bridge.cjs');
const localKnowledge=require('./lib/local-knowledge.cjs');
const privateLibrary=require('./lib/private-libraries.cjs');
const fourCopilot=require('./lib/four-copilot.cjs');
const postgisPilot=require('./lib/postgis-pilot.cjs');
const postgisArchive=require('./lib/postgis-archive.cjs');
const envFile=process.env.AMAP_ENV_FILE||path.join(__dirname,'.local-data','amap.env');if(envFile&&fs.existsSync(envFile)){for(const line of fs.readFileSync(envFile,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/)){const m=line.match(/^AMAP_WEB_KEY=(.+)$/);if(m)process.env.AMAP_WEB_KEY=m[1].trim()}}
const allowed=new Map([['/','index.html'],['/index.html','index.html'],['/density-worker.js','density-worker.js'],['/lib/brief-sheet.js','lib/brief-sheet.js'],['/vendor/terra-draw.umd.js','vendor/terra-draw.umd.js'],['/vendor/terra-draw-maplibre-gl-adapter.umd.js','vendor/terra-draw-maplibre-gl-adapter.umd.js']]);
for(const file of ['visual-theme.css','vendor/glyphs/0-255.pbf','vendor/glyphs/8192-8447.pbf','vendor/glyphs/12288-12543.pbf','vendor/glyphs/65280-65535.pbf','lib/amap-basemap.js','lib/amap-coordinates.js','lib/copilot-voice.js','lib/map-result-view.js','lib/research-workspace.js','lib/project-assessment.js','lib/program-analysis.js','lib/archive-layers.js','lib/library-workspace.js','lib/four-copilot-ui.js','lib/map-project-query.js','lib/nanjing-metro-stations.json','vendor/jspdf.umd.min.js','vendor/fflate.umd.js','vendor/maplibre-gl.js','vendor/maplibre-gl.css','vendor/turf.min.js'])allowed.set('/'+file,file);
async function sendMetroCatalog(req, res) {
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.headers.host || '');
  const source = process.env.RENEWAL_METRO_CATALOG;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!source || !loopback || !localHost || req.headers.forwarded || req.headers['x-forwarded-for']) {
    return res.end(JSON.stringify({ stations: [] }));
  }
  try {
    const data = JSON.parse(await fs.promises.readFile(source, 'utf8'));
    const stations = data.stations.map(({ name, point, lines }) => {
      if (typeof name !== 'string' || !Array.isArray(point) || point.length !== 2 ||
          !point.every(Number.isFinite) || !Array.isArray(lines) || !lines.every(line => typeof line === 'string')) {
        throw Error('Invalid station');
      }
      return { name, point, lines };
    });
    return res.end(JSON.stringify({ stations }));
  } catch {
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: '本机地铁目录暂时不可用' }));
  }
}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(req.method==='GET' && url.pathname==='/lib/nanjing-metro-stations.json')return sendMetroCatalog(req,res);if(url.pathname.startsWith('/api/buildings/'))return require('./lib/building-tiles.cjs').handler(req,res,url);if(url.pathname==='/api/local-speech')return require('./lib/local-speech.cjs').handler(req,res);if(url.pathname==='/api/offline-population')return offlinePopulation.handler(req,res,url);if(url.pathname==='/api/postgis/pilot')return postgisPilot.handler(req,res);if(url.pathname.startsWith('/api/postgis/archive'))return postgisArchive.handler(req,res,url);if(url.pathname==='/api/local-knowledge'||url.pathname==='/api/local-knowledge/source'||url.pathname==='/api/local-knowledge/catalog')return localKnowledge(req,res);if(url.pathname==='/api/partner-library'||(url.pathname==='/api/scenario-library'||url.pathname==='/api/scenario-library/source'))return privateLibrary(req,res);if(url.pathname==='/api/four-copilot')return fourCopilot(req,res);if(url.pathname==='/api/local-project')return localStore(req,res);if(url.pathname==='/api/gdb-import')return gdbBridge(req,res);if(url.pathname==='/api/amap-roads')return roadHandler(req,res);if(url.pathname==='/api/amap-poi')return poiHandler(req,res);if(url.pathname==='/api/walk-access')return walkHandler(req,res);if(url.pathname==='/api/copilot')return copilotHandler(req,res);if(url.pathname==='/api/gis-inspect')return gisBridge.handler(req,res);if(url.pathname==='/api/spatial-analysis')return spatialBridge.handler(req,res);if(req.method==='GET'&&['/','/index.html'].includes(url.pathname)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(offlinePopulation.html(fs.readFileSync(path.join(base,'index.html'),'utf8')).replace('<!-- PRIVATE_COPILOT -->','<script src="/lib/four-copilot-ui.js"></script>'))}const file=allowed.get(url.pathname);if(!file){res.writeHead(404);return res.end('Not found')}res.setHeader('Content-Type',file.endsWith('.json')?'application/json; charset=utf-8':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8');res.setHeader('Cache-Control','no-store');fs.createReadStream(path.join(base,file)).pipe(res)});
module.exports=server;
const port=Number(process.env.PORT||4173);if(require.main===module)server.listen(port,'127.0.0.1',()=>console.log('Urban Renewal Lab v3: http://127.0.0.1:'+port+' · 高德服务端配置'+(process.env.AMAP_WEB_KEY?'已读取':'未设置')));
