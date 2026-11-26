const {connection} = require('./postgis-db.cjs');

async function handler(req, res, url) {
  const match = /^\/api\/buildings\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.pbf$/.exec(url.pathname);
  if (req.method !== 'GET' || !match) { res.writeHead(404); return res.end(); }
  const [z,x,y] = match.slice(1).map(Number);
  if (z < 14 || z > 17 || x >= 2**z || y >= 2**z) { res.writeHead(400); return res.end(); }
  try {
    const {rows} = await connection().query(`WITH tile AS (SELECT ST_TileEnvelope($1,$2,$3) AS box),
      features AS (
        SELECT id,height,ST_AsMVTGeom(ST_Transform(geom,3857),box,4096,64,true) AS geom
        FROM renewal.nanjing_buildings_2024,tile
        WHERE geom && ST_Transform(ST_Expand(box, (ST_XMax(box)-ST_XMin(box))/64),4326)
      ) SELECT ST_AsMVT(features,'buildings',4096,'geom','id') AS tile FROM features WHERE geom IS NOT NULL`,[z,x,y]);
    res.writeHead(200, {'Content-Type':'application/vnd.mapbox-vector-tile','Cache-Control':'private, max-age=3600'});
    res.end(rows[0].tile);
  } catch {
    res.writeHead(503,{'Cache-Control':'no-store'});res.end('Building tiles unavailable');
  }
}
module.exports = {handler};
