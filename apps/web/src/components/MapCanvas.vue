<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as maplibregl from 'maplibre-gl'
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { getJson } from '../api/client'
import { registerAmap } from '../map/amap'

export type MapFeature = { type: 'Feature', layerId: string, featureId: string, version: number,
  layerName: string, layerKind: string, properties: Record<string, unknown>,
  geometry: { type: string, coordinates?: unknown } }
type Point = [number,number]
type StudyOverlay={center?:Point,radiusMeters?:number,population?:{heatCells:[number,number,number][]},housing?:{communities:{name:string,meanPrice:number,point:Point}[]},poi?:{categories:{category:string,nearest:{name:string,point:Point}[]}[]}}
const props = defineProps<{ visibleLayerIds: string[], selected: MapFeature | null, basemap: 'satellite'|'light'|'offline',study?:StudyOverlay }>()
const emit = defineEmits<{ select: [feature: MapFeature], loading: [value: boolean], warning: [message: string] }>()
const container = ref<HTMLElement | null>(null)
let map: MapLibreMap | null = null
let visibleFeatures: MapFeature[] = []
let pending: AbortController | null = null
let requestNumber = 0
let drawing = false
let draft: Point[] = []
let markers: Marker[] = []
let rasterErrors = 0
let resizeObserver: ResizeObserver | null = null
const empty = () => ({ type: 'FeatureCollection' as const, features: [] as unknown[] })
const source = (id: string) => map?.getSource(id) as GeoJSONSource | undefined

function mapData() {
  return { type: 'FeatureCollection', features: visibleFeatures.map(feature => ({
    type: 'Feature', geometry: feature.geometry, properties: {
      featureId: feature.featureId, layerId: feature.layerId,
      layerKind: feature.layerKind, label: String(feature.properties['项目名称'] || feature.properties['名称'] || feature.layerName)
    }
  })) } as Parameters<GeoJSONSource['setData']>[0]
}
function setSelection() {
  if (!source('selected')) return
  source('selected')?.setData(props.selected ? { type:'FeatureCollection', features:[{
    type:'Feature', geometry:props.selected.geometry,properties:{}
  }] } as Parameters<GeoJSONSource['setData']>[0] : empty() as Parameters<GeoJSONSource['setData']>[0])
}
function setStudy() {
  if(!map || !source('study-population')) return
  const population=props.study?.population?.heatCells||[]
  const housing=props.study?.housing?.communities||[]
  const poi=props.study?.poi?.categories.flatMap(group=>group.nearest.map(place=>({...place,category:group.category})))||[]
  const collection=(features:unknown[])=>({type:'FeatureCollection',features}) as Parameters<GeoJSONSource['setData']>[0]
  source('study-population')?.setData(collection(population.map(([x,y,value])=>({type:'Feature',geometry:{type:'Point',coordinates:[x,y]},properties:{value}}))))
  source('study-housing')?.setData(collection(housing.map(item=>({type:'Feature',geometry:{type:'Point',coordinates:item.point},properties:{name:item.name,value:item.meanPrice}}))))
  source('study-poi')?.setData(collection(poi.map(item=>({type:'Feature',geometry:{type:'Point',coordinates:item.point},properties:{name:item.name,category:item.category}}))))
  const max=Math.max(1,...population.map(row=>row[2]))
  map.setPaintProperty('study-heat','heatmap-weight',['interpolate',['linear'],['get','value'],0,0,max,1])
  container.value?.setAttribute('data-study-count',String(population.length))
}
function setDraft() {
  if (!source('draft')) return
  const features: unknown[] = []
  if (draft.length === 1) features.push({ type:'Feature', properties:{}, geometry:{type:'Point',coordinates:draft[0]} })
  if (draft.length >= 2) features.push({ type:'Feature', properties:{}, geometry:{type:'LineString',coordinates:draft} })
  if (draft.length >= 3) features.push({ type:'Feature', properties:{}, geometry:{type:'Polygon',coordinates:[[...draft,draft[0]]]} })
  source('draft')?.setData({ type:'FeatureCollection',features } as Parameters<GeoJSONSource['setData']>[0])
  for (const marker of markers) marker.remove()
  markers = []
  if (!map) return
  draft.forEach((point,index) => {
    const element = document.createElement('button')
    element.type = 'button'; element.className = 'vertex-marker'; element.title = `拖动第 ${index+1} 个节点；双击删除`
    element.setAttribute('aria-label', element.title)
    element.ondblclick = event => { event.preventDefault(); event.stopPropagation(); if (draft.length > 3) { draft.splice(index,1);setDraft() } }
    const marker = new maplibregl.Marker({ element, draggable: true }).setLngLat(point).addTo(map!)
    marker.on('dragend', () => { const lngLat = marker.getLngLat(); draft[index] = [lngLat.lng,lngLat.lat]; setDraft() })
    markers.push(marker)
  })
}
function clearDraft() {
  drawing = false; draft = []
  for (const marker of markers) marker.remove()
  markers = []
  source('draft')?.setData(empty() as Parameters<GeoJSONSource['setData']>[0])
}
function startDraw() { clearDraft(); drawing = true }
function undoPoint() {if(drawing&&draft.length){draft.pop();setDraft()}}
function startEdit(feature: MapFeature): boolean {
  const coordinates = feature.geometry.coordinates
  if (feature.geometry.type !== 'Polygon' || !Array.isArray(coordinates) || coordinates.length !== 1 ||
    !Array.isArray(coordinates[0]) || coordinates[0].length < 4) return false
  clearDraft()
  draft = (coordinates[0] as Point[]).slice(0,-1).map(p => [...p] as Point)
  drawing = true; setDraft()
  focus(feature)
  return true
}
function draftGeometry() {
  if (draft.length < 3) throw Error('至少点击三个位置，才能保存面边界')
  return { type:'Polygon', coordinates:[[...draft,draft[0]]] }
}
function focus(feature: MapFeature) {
  if (!map) return
  const points: Point[] = []
  function visit(value: unknown): void {
    if (!Array.isArray(value)) return
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') points.push(value as Point)
    else value.forEach(visit)
  }
  visit(feature.geometry.coordinates)
  if (!points.length) return
  const bounds = new maplibregl.LngLatBounds()
  points.forEach(point => bounds.extend(point))
  if (points.length === 1) map.flyTo({ center:points[0],zoom:17 })
  else map.fitBounds(bounds,{ padding:60,maxZoom:17,duration:350 })
}
function focusBounds([west,south,east,north]: [number,number,number,number]) {
  if (west === east && south === north) map?.jumpTo({center:[west,south], zoom:17})
  else map?.fitBounds([[west,south],[east,north]], {padding:40,maxZoom:17,duration:0})
}
function focusStudy() {
  if(!map||!props.study?.center||!props.study.radiusMeters)return false
  const [x,y]=props.study.center,r=props.study.radiusMeters
  const dy=r/110000,dx=dy/Math.max(.2,Math.cos(y*Math.PI/180))
  map.fitBounds([[x-dx,y-dy],[x+dx,y+dy]],{padding:30,maxZoom:15,duration:0})
  container.value?.setAttribute('data-study-center',`${x},${y}`)
  return true
}
async function refresh() {
  if (!map || !source('features')) return
  pending?.abort()
  if (!props.visibleLayerIds.length) { visibleFeatures=[]; source('features')?.setData(empty() as Parameters<GeoJSONSource['setData']>[0]); return }
  const bounds=map.getBounds(), request=++requestNumber
  const controller=new AbortController();pending=controller;emit('loading',true)
  const bbox=[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()].map(n=>Math.max(-180,Math.min(180,n)))
  try {
    const query=new URLSearchParams({ bbox:bbox.join(','),layerIds:props.visibleLayerIds.join(',') })
    const result=await getJson<{features:MapFeature[],truncated:boolean,limit:number}>(`/api/v1/map/features?${query}`,controller.signal)
    if (request!==requestNumber) return
    visibleFeatures=result.features
    container.value?.setAttribute('data-feature-count',String(visibleFeatures.length))
    source('features')?.setData(mapData())
    if (result.truncated) emit('warning',`当前视野超过 ${result.limit} 条记录，请放大地图查看其余要素。`)
    else emit('warning','')
  } catch (cause) {
    if (!controller.signal.aborted && request===requestNumber) emit('warning',cause instanceof Error ? cause.message:'图层加载失败')
  } finally { if (request===requestNumber) emit('loading',false) }
}
function applyBasemap() {
  if (!map?.getLayer('amap-satellite')) return
  for (const mode of ['satellite','light'] as const) map.setLayoutProperty(`amap-${mode}`,'visibility',props.basemap===mode?'visible':'none')
}
onMounted(() => {
  if (!container.value) return
  maplibregl.setWorkerUrl(mapWorkerUrl)
  registerAmap()
  const mountedMap=new maplibregl.Map({ container:container.value, center:[118.785,32.079],zoom:13,
    style:{version:8,sources:{ satellite:{type:'raster',tiles:['amap://6/{z}/{x}/{y}'],tileSize:256,maxzoom:18},
      light:{type:'raster',tiles:['amap://7/{z}/{x}/{y}'],tileSize:256,maxzoom:18}},
      layers:[{id:'background',type:'background',paint:{'background-color':'#d5e5e7'}},
        {id:'amap-satellite',type:'raster',source:'satellite',layout:{visibility:props.basemap==='satellite'?'visible':'none'}},
        {id:'amap-light',type:'raster',source:'light',layout:{visibility:props.basemap==='light'?'visible':'none'}}] } })
  map=mountedMap
  resizeObserver = new ResizeObserver(() => mountedMap.resize())
  resizeObserver.observe(container.value)
  mountedMap.addControl(new maplibregl.NavigationControl(),'bottom-right')
  mountedMap.on('load',()=>{
    if (!map) return
    container.value?.setAttribute('data-map-loaded','yes')
    map.addSource('features',{type:'geojson',data:empty() as Parameters<GeoJSONSource['setData']>[0]})
    map.addSource('selected',{type:'geojson',data:empty() as Parameters<GeoJSONSource['setData']>[0]})
    map.addSource('draft',{type:'geojson',data:empty() as Parameters<GeoJSONSource['setData']>[0]})
    map.addSource('study-population',{type:'geojson',data:empty() as Parameters<GeoJSONSource['setData']>[0]})
    map.addSource('study-housing',{type:'geojson',data:empty() as Parameters<GeoJSONSource['setData']>[0]})
    map.addSource('study-poi',{type:'geojson',data:empty() as Parameters<GeoJSONSource['setData']>[0]})
    map.addLayer({id:'study-heat',type:'heatmap',source:'study-population',paint:{'heatmap-weight':1,'heatmap-radius':28,'heatmap-opacity':.72,'heatmap-color':['interpolate',['linear'],['heatmap-density'],0,'rgba(0,0,255,0)',.25,'#4891e2',.5,'#f6d25a',1,'#d83c34']}})
    map.addLayer({id:'archive-fill',type:'fill',source:'features',paint:{'fill-color':['match',['get','layerKind'],'project','#efaa34','parcel','#4a9db5','planned_land','#9c78cf','building','#719aa0','#557a8b'],'fill-opacity':.28}})
    map.addLayer({id:'archive-line',type:'line',source:'features',paint:{'line-color':['match',['get','layerKind'],'project','#f19d22','parcel','#3f9bb1','planned_land','#9468c6','building','#58818a','#456c7a'],'line-width':['case',['==',['get','layerKind'],'project'],2.5,1.3]}})
    map.addLayer({id:'archive-point',type:'circle',source:'features',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':'#f19d22','circle-radius':7,'circle-stroke-color':'white','circle-stroke-width':2}})
    map.addLayer({id:'selected-fill',type:'fill',source:'selected',paint:{'fill-color':'#ffda44','fill-opacity':.42}})
    map.addLayer({id:'selected-line',type:'line',source:'selected',paint:{'line-color':'#ffcf20','line-width':4}})
    map.addLayer({id:'selected-point',type:'circle',source:'selected',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':'#ffcf20','circle-radius':10,'circle-stroke-color':'#533f00','circle-stroke-width':3}})
    map.addLayer({id:'draft-fill',type:'fill',source:'draft',paint:{'fill-color':'#23dfcd','fill-opacity':.27}})
    map.addLayer({id:'draft-line',type:'line',source:'draft',paint:{'line-color':'#13c6b9','line-width':3,'line-dasharray':[2,1]}})
    map.addLayer({id:'study-housing-points',type:'circle',source:'study-housing',paint:{'circle-color':'#ef8f25','circle-radius':7,'circle-stroke-width':2,'circle-stroke-color':'#fff'}})
    map.addLayer({id:'study-poi-points',type:'circle',source:'study-poi',paint:{'circle-color':'#18b3b3','circle-radius':5,'circle-stroke-width':1.5,'circle-stroke-color':'#fff'}})
    for(const [layer,label] of [['study-housing-points','住宅均价'],['study-poi-points','POI']] as const) map.on('click',layer,event=>{
      const properties=event.features?.[0]?.properties
      if(!properties) return
      const content=document.createElement('div')
      content.textContent=layer==='study-housing-points'?`${properties.name} · ${label} ${Number(properties.value).toLocaleString()} 元/㎡（历史样本）`:`${properties.name} · ${properties.category}（本机档案，状态待核实）`
      new maplibregl.Popup().setLngLat(event.lngLat).setDOMContent(content).addTo(map!)
    })
    for (const id of ['archive-fill','archive-line','archive-point']) map!.on('click',id,event=>{
      if (drawing) return
      const properties=event.features?.[0]?.properties
      const found=visibleFeatures.find(row=>row.featureId===String(properties?.featureId) && row.layerId===String(properties?.layerId))
      if (found) emit('select',found)
    })
    map.on('click',event=>{ if (drawing) { draft.push([event.lngLat.lng,event.lngLat.lat]);setDraft() } })
    map.on('moveend',()=>{void refresh()})
    setSelection();setStudy();if(!focusStudy()&&props.selected) focus(props.selected);void refresh()
  })
  mountedMap.on('error',event=>{container.value?.setAttribute('data-map-error',String(event.error?.message||'unknown').slice(0,200));if (/amap|raster|tile/i.test(String(event.error?.message||'')) && ++rasterErrors>=4 && props.basemap!=='offline') emit('warning','在线底图无法加载，可切换离线项目图。')})
})
watch(()=>props.visibleLayerIds.join(','),()=>{void refresh()})
watch(()=>props.selected,()=>setSelection())
watch(()=>props.study,()=>setStudy(),{deep:true})
watch(()=>props.basemap,applyBasemap)
onBeforeUnmount(()=>{pending?.abort();resizeObserver?.disconnect();resizeObserver=null;clearDraft();map?.remove();map=null})
defineExpose({refresh,focus,focusBounds,startDraw,startEdit,undoPoint,draftGeometry,clearDraft})
</script>

<template><div ref="container" class="map-canvas" aria-label="更新档案地图" /></template>
