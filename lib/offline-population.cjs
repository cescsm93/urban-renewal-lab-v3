const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const configFile = path.join(__dirname, '../.local-data/population.json');
const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, '')) : null;
const enabled = !!config;
let active = 0;
function html(page) {
  page = page.replace('<!-- LOCAL_TOOLS -->','<script>window.renewalLocalTools='+JSON.stringify({buildings:fs.existsSync(path.join(__dirname,'../.local-data/postgis.env')),voice:require('./local-speech.cjs').available()})+'</script>');
  return enabled ? page.replace('<!-- OFFLINE_POPULATION -->', '<script>window.renewalOfflinePopulation=true</script>') : page;
}
function handler(req, res, url) {
  function send(code, body) {
    res.writeHead(code, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
    res.end(body);
  }
  if (!enabled || req.method !== 'GET') return send(404, '{}');
  const values = ['x','y','radius'].map(key => Number(url.searchParams.get(key) || NaN));
  const [x,y,r] = values;
  if (!values.every(Number.isFinite) || Math.abs(x)>180 || Math.abs(y)>90 || r<100 || r>5000)
    return send(400, '{}');
  if (active >= 3) return send(429, '{}');
  active++;
  execFile(config.python, [path.join(__dirname,'../gis/population_window.py'), config.raster, ...values.map(String)],
    {windowsHide:true, timeout:20000, maxBuffer:4*1024*1024}, (error, output) => {
      active--;
      send(error ? 503 : 200, error ? '{}' : output);
    });
}
module.exports = {html, handler};
