// Re-sample GCJ-02 raster tiles onto the WGS84 Web Mercator grid used by project geometry.
function registerAmapRaster() {
  maplibregl.addProtocol('localglyph',async ({url},controller)=>{
    const range=url.split('/').pop();
    if(!['0-255.pbf','8192-8447.pbf','12288-12543.pbf','65280-65535.pbf'].includes(range))return {data:new ArrayBuffer(0)};
    const res=await fetch('vendor/glyphs/'+range,{signal:controller.signal});
    if(!res.ok)throw Error('本地地图字形读取失败');
    return {data:await res.arrayBuffer()};
  });
  maplibregl.addProtocol('amap', async ({url}, controller) => {
    const [,style,z,x,y] = /^amap:\/\/(6|7)\/(\d+)\/(\d+)\/(\d+)$/.exec(url).map(Number);
    const n = 2**z;
    const lat = Math.atan(Math.sinh(Math.PI*(1-2*(y+.5)/n)))*180/Math.PI;
    const lon = (x+.5)*360/n-180;
    const [gx,gy] = RenewalCoordinates.wgsToGcj([lon,lat]);
    const sx = x*256 + (gx-lon)*256*n/360;
    const sy = ((1-Math.asinh(Math.tan(gy*Math.PI/180))/Math.PI)*n/2-.5)*256;
    const canvas = document.createElement('canvas');
    canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d');
    const pending=[];
    for(let tx=Math.floor(sx/256);tx<=Math.floor((sx+255.999)/256);tx++){
      for(let ty=Math.floor(sy/256);ty<=Math.floor((sy+255.999)/256);ty++){
        pending.push((async()=>{
          const tile=await fetch('https://webst01.is.autonavi.com/appmaptile?style='+style+'&z='+z+'&x='+tx+'&y='+ty,{signal:controller.signal});
          if(!tile.ok)throw Error('高德底图请求失败');
          const image=await createImageBitmap(await tile.blob());
          ctx.drawImage(image,Math.round(tx*256-sx),Math.round(ty*256-sy));
          image.close();
        })());
      }
    }
    await Promise.all(pending);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return {data:await blob.arrayBuffer()};
  });
}
