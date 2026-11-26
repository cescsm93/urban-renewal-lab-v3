<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import MapCanvas, { type MapFeature } from '../components/MapCanvas.vue'
import { getJson, requestJson } from '../api/client'
import { useSessionStore } from '../stores/session'

type Layer = { layerId:string,name:string,kind:string,geometryType:string,featureCount:number,precision:{status:string,note:string|null} }
type Canvas = InstanceType<typeof MapCanvas>
const route=useRoute(), session=useSessionStore()
const canvas=ref<Canvas|null>(null)
const layers=ref<Layer[]>([]), visibleLayerIds=ref<string[]>([])
const selected=ref<MapFeature|null>(null), warning=ref(''), error=ref(''), success=ref('')
const basemap=ref<'satellite'|'light'|'offline'>(navigator.onLine?'satellite':'offline')
const loading=ref(false), mode=ref<'view'|'draw'|'edit'>('view'), name=ref(''), createLayer=ref('')
const attributeEditor=ref(false),attributesText=ref(''),attributeError=ref('')
const activeLayer=computed(()=>layers.value.find(item=>item.layerId===(selected.value?.layerId||createLayer.value)))
const canEdit=computed(()=>!!session.current?.scopes.includes('archive:edit'))
const drawLayers=computed(()=>layers.value.filter(layer=>layer.geometryType!=='Point' && layer.geometryType!=='MultiPoint'))
const canDraw=computed(()=>canEdit.value && drawLayers.value.some(layer=>visibleLayerIds.value.includes(layer.layerId)))
const title=(feature:MapFeature)=>String(feature.properties['项目名称']||feature.properties['名称']||`${feature.layerName} #${feature.featureId}`)
const workflowTo=computed(()=>selected.value?`/workflow?layerId=${selected.value.layerId}&featureId=${selected.value.featureId}`:'/workflow')

async function loadLayers() {
  try {
    layers.value=(await getJson<{layers:Layer[]}>('/api/v1/layers')).layers
    createLayer.value=drawLayers.value.find(item=>item.kind==='project')?.layerId||drawLayers.value[0]?.layerId||''
    await selectFromRoute()
  } catch(cause) { error.value=cause instanceof Error?cause.message:'图层读取失败' }
}
let navigation = 0
async function selectFromRoute() {
  const request = ++navigation
  const layerId = String(route.query.layerId || ''), featureId = String(route.query.featureId || '')
  selected.value = null
  error.value = ''; warning.value = ''; success.value = ''
  if (!layerId) {
    visibleLayerIds.value = layers.value.filter(item => item.kind === 'project').map(item => item.layerId)
    return
  }
  const layer = layers.value.find(item => item.layerId === layerId)
  visibleLayerIds.value = layer ? [layer.layerId] : []
  if (!layer) { error.value = '找不到此图层'; return }
  if (drawLayers.value.includes(layer)) createLayer.value = layer.layerId
  try {
    if (featureId) {
      const found = await getJson<MapFeature>(`/api/v1/layers/${layerId}/features/${encodeURIComponent(featureId)}`)
      if (request !== navigation) return
      selected.value = found
      await nextTick(); canvas.value?.focus(found)
    } else {
      const { bbox } = await getJson<{bbox: [number,number,number,number] | null}>(`/api/v1/layers/${layerId}/extent`)
      if (request !== navigation) return
      if (bbox) canvas.value?.focusBounds(bbox)
      else error.value = '此图层暂无可定位的坐标'
    }
  } catch (cause) {
    if (request === navigation) error.value = cause instanceof Error ? cause.message : '图层定位失败'
  }
}
function selectFeature(feature:MapFeature) {selected.value=feature;error.value='';success.value=''}
function cancel() {canvas.value?.clearDraft();mode.value='view';error.value=''}
function draw() {if (!canDraw.value) return;selected.value=null;name.value='';canvas.value?.startDraw();mode.value='draw';error.value=''}
function edit() {
  if (!selected.value || !canEdit.value) return
  if (!canvas.value?.startEdit(selected.value)) {error.value='目前仅支持编辑无内环的单面。复杂几何保持原状，请通过 GIS 核对后再处理。';return}
  mode.value='edit';error.value=''
}
function openAttributes(){if(!selected.value||!canEdit.value)return;attributesText.value=JSON.stringify(selected.value.properties,null,2);attributeError.value='';attributeEditor.value=true}
async function saveAttributes(){
  if(!selected.value)return
  try{
    const properties=JSON.parse(attributesText.value)
    if(!properties||typeof properties!=='object'||Array.isArray(properties))throw Error('属性必须为 JSON 对象')
    const current=selected.value
    const updated=await requestJson<MapFeature>(`/api/v1/layers/${current.layerId}/features/${current.featureId}`,{
      method:'PATCH',body:JSON.stringify({expectedVersion:current.version,properties,geometry:current.geometry})})
    selected.value={...current,...updated};attributeEditor.value=false;success.value=`属性已保存为版本 ${updated.version}`
    await canvas.value?.refresh()
  }catch(cause){attributeError.value=cause instanceof Error?cause.message:'保存失败'}
}
async function save() {
  try {
    const geometry=canvas.value?.draftGeometry()
    if (!geometry) throw Error('地图尚未准备好')
    if (mode.value==='draw') {
      if (!createLayer.value) throw Error('请先选择要新增的图层')
      if (!name.value.trim()) throw Error('请填写档案名称')
      const layer=layers.value.find(item=>item.layerId===createLayer.value)
      const field=layer?.kind==='project'?'项目名称':'名称'
      const result=await requestJson<MapFeature>(`/api/v1/layers/${createLayer.value}/features`,{
        method:'POST',body:JSON.stringify({properties:{[field]:name.value.trim()},geometry})})
      selected.value={...result,layerName:layer?.name||'图层',layerKind:layer?.kind||'other'}
      if (!visibleLayerIds.value.includes(createLayer.value)) visibleLayerIds.value.push(createLayer.value)
      success.value='新档案已保存到 PostGIS'
    } else if (mode.value==='edit' && selected.value) {
      const current=selected.value
      const result=await requestJson<MapFeature>(`/api/v1/layers/${current.layerId}/features/${current.featureId}`,{
        method:'PATCH',body:JSON.stringify({expectedVersion:current.version,properties:current.properties,geometry})})
      selected.value={...current,...result};success.value=`边界和字段已作为版本 ${result.version} 保存`
    }
    cancel();await canvas.value?.refresh()
  } catch(cause) {error.value=cause instanceof Error?cause.message:'保存失败，草稿仍保留在地图上'}
}
onMounted(()=>{void loadLayers()})
watch(() => [route.query.layerId, route.query.featureId], () => { if (layers.value.length) void selectFromRoute() })
</script>

<template>
  <section class="map-page">
    <div class="map-toolbar">
      <strong>档案地图</strong>
      <el-radio-group v-model="basemap" size="small" aria-label="底图"><el-radio-button label="satellite" value="satellite">影像</el-radio-button><el-radio-button label="light" value="light">浅色</el-radio-button><el-radio-button label="offline" value="offline">离线项目图</el-radio-button></el-radio-group>
      <span v-if="loading">正在按视野加载…</span>
      <el-button v-if="canDraw && mode==='view'" size="small" @click="draw">地图新增</el-button>
      <el-button v-if="canEdit && mode==='view' && selected?.geometry.type==='Polygon'" size="small" @click="edit">编辑边界</el-button>
      <template v-if="mode!=='view'"><el-button size="small" type="primary" @click="save">保存</el-button><el-button size="small" @click="cancel">取消</el-button></template>
      <el-button v-if="mode==='draw'" size="small" @click="canvas?.undoPoint()">撤销上一点</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="true" @close="error=''" />
    <el-alert v-if="warning" :title="warning" type="warning" :closable="false" />
    <div class="map-layout">
      <aside class="map-sidebar"><h2>图层</h2><p>可同时显示多个图层；建筑按当前视野加载。</p>
        <el-checkbox-group v-model="visibleLayerIds"><el-checkbox v-for="layer in layers" :key="layer.layerId" :value="layer.layerId">{{ layer.name }} · {{ layer.featureCount }}</el-checkbox></el-checkbox-group>
        <p class="precision-note">示意配准图层仅供研判示意，不用于精确测距或法定边界判断。</p>
        <template v-if="mode==='draw'"><h2>新增档案</h2><el-select v-model="createLayer" placeholder="选择图层"><el-option v-for="layer in drawLayers" :key="layer.layerId" :label="layer.name" :value="layer.layerId" /></el-select><el-input v-model="name" placeholder="档案名称" maxlength="100" /><p>在地图上点击至少三个点，再点保存。</p></template>
        <template v-else-if="mode==='edit'"><h2>编辑边界</h2><p>拖动节点；双击节点可删点。保存时同时提交原字段和新边界。</p></template>
        <template v-else-if="selected"><h2>{{ title(selected) }}</h2><p>{{ selected.layerName }} · #{{ selected.featureId }} · 版本 {{ selected.version }}</p>
          <el-button size="small" @click="canvas?.focus(selected)">地图定位</el-button><RouterLink :to="workflowTo">进入工作流</RouterLink>
          <el-button v-if="canEdit" size="small" @click="openAttributes">编辑属性</el-button>
          <p v-if="activeLayer" class="precision-note">精度：{{ activeLayer.precision.status==='approximate'?'示意配准':'未核验' }}。{{ activeLayer.precision.note }}</p>
          <dl class="map-properties"><template v-for="(value,key) in selected.properties" :key="key"><dt>{{ key }}</dt><dd>{{ value??'未录入' }}</dd></template></dl>
        </template>
        <p v-else>点选地图上的项目或其他图斑查看档案。</p>
      </aside>
      <div class="map-stage"><MapCanvas ref="canvas" :visible-layer-ids="visibleLayerIds" :selected="selected" :basemap="basemap" @select="selectFeature" @loading="loading=$event" @warning="warning=$event" /></div>
    </div>
    <el-alert v-if="success" :title="success" type="success" :closable="true" @close="success=''" />
    <el-dialog v-model="attributeEditor" title="编辑档案属性" width="min(92vw,760px)"><p>保留原始字段；属性与几何走同一版本保存命令。</p>
      <el-input v-model="attributesText" type="textarea" :rows="12" aria-label="档案属性 JSON" />
      <el-alert v-if="attributeError" :title="attributeError" type="error" :closable="false" />
      <template #footer><el-button @click="attributeEditor=false">取消</el-button><el-button type="primary" @click="saveAttributes">保存属性</el-button></template>
    </el-dialog>
  </section>
</template>
