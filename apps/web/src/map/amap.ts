import { addProtocol } from 'maplibre-gl'

const R = 6378245
const EE = 0.00669342162296594323
const PI = Math.PI
let registered = false

function wgsToGcj(lon: number, lat: number): [number, number] {
  if (lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271) return [lon, lat]
  const x = lon - 105, y = lat - 35
  let dy = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x))
  dy += (20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3
  dy += (20*Math.sin(y*PI)+40*Math.sin(y/3*PI))*2/3
  dy += (160*Math.sin(y/12*PI)+320*Math.sin(y*PI/30))*2/3
  let dx = 300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x))
  dx += (20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3
  dx += (20*Math.sin(x*PI)+40*Math.sin(x/3*PI))*2/3
  dx += (150*Math.sin(x/12*PI)+300*Math.sin(x/30*PI))*2/3
  const rad = lat/180*PI, magic = 1-EE*Math.sin(rad)**2, sqrt = Math.sqrt(magic)
  return [lon+dx*180/(R/sqrt*Math.cos(rad)*PI), lat+dy*180/((R*(1-EE))/(magic*sqrt)*PI)]
}

export function registerAmap() {
  if (registered) return
  registered = true
  addProtocol('amap', async ({ url }, controller) => {
    const match = /^amap:\/\/(6|7)\/(\d+)\/(\d+)\/(\d+)$/.exec(url)
    if (!match) throw Error('无效的高德瓦片地址')
    const style = Number(match[1]), z = Number(match[2]), x = Number(match[3]), y = Number(match[4])
    const n = 2**z
    const lat = Math.atan(Math.sinh(PI*(1-2*(y+.5)/n)))*180/PI
    const lon = (x+.5)*360/n-180
    const [gx,gy] = wgsToGcj(lon,lat)
    const sx = x*256 + (gx-lon)*256*n/360
    const sy = ((1-Math.asinh(Math.tan(gy*PI/180))/PI)*n/2-.5)*256
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (!ctx) throw Error('无法绘制地图瓦片')
    await Promise.all(Array.from({ length: 4 }, async (_, index) => {
      const tx = Math.floor(sx/256) + index%2, ty = Math.floor(sy/256) + Math.floor(index/2)
      const response = await fetch(`https://webst01.is.autonavi.com/appmaptile?style=${style}&z=${z}&x=${tx}&y=${ty}`, { signal: controller.signal })
      if (!response.ok) throw Error('高德底图请求失败')
      const bitmap = await createImageBitmap(await response.blob())
      ctx.drawImage(bitmap,Math.round(tx*256-sx),Math.round(ty*256-sy))
      bitmap.close()
    }))
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve,'image/png'))
    if (!blob) throw Error('地图瓦片绘制失败')
    return { data: await blob.arrayBuffer() }
  })
}
