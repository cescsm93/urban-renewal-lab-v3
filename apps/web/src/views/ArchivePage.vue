<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { getJson, requestJson, uploadFile } from '../api/client'
import { useSessionStore } from '../stores/session'

type Layer = { layerId: string, name: string, kind: string, featureCount: number, precision: { status: string, note: string | null }, fieldIds: string[] }
type Feature = { featureId: string, version: number, properties: Record<string, unknown>, geometry: Record<string, unknown> }
const session = useSessionStore()
const route = useRoute(), router = useRouter()
const layers = ref<Layer[]>([])
const selected = ref<Layer | null>(null)
const features = ref<Feature[]>([])
const total = ref(0)
const offset = ref(0)
const error = ref('')
const pending = ref(false)
const editing = ref<Feature | null>(null)
const fieldsText = ref('')
const geometryText = ref('')
const editError = ref('')
type ImportPreview={batchId:string,fileId:string,filename:string,sourceCRS:string,layers:{name:string,count:number,fields:string[]}[]}
const importFile=ref<File|null>(null),importPreview=ref<ImportPreview|null>(null),importBusy=ref(false),importError=ref(''),importSuccess=ref('')
const workspaces=ref<{id:string,name:string}[]>([]),workspaceId=ref('')
const batches=ref<{id:string,fileId:string,filename:string,status:string,layers:{name:string,count:number}[],createdAt:string}[]>([])
const importLayers=ref<{name:string,kind:'project'|'parcel'|'building'|'planned_land'|'other'}[]>([])
async function loadBatches(){
  if(!session.current?.scopes.includes('archive:import'))return
  try{batches.value=(await getJson<{batches:typeof batches.value}>('/api/v1/imports')).batches}catch{batches.value=[]}
}
async function previewFile() {
  if(!importFile.value) return
  importBusy.value=true;importError.value='';importSuccess.value=''
  try {
    const preview=await uploadFile<ImportPreview>('/api/v1/imports/preview',importFile.value)
    importPreview.value=preview
    importLayers.value=preview.layers.map(layer=>({name:layer.name,kind:'other'}))
    workspaces.value=(await getJson<{workspaces:{id:string,name:string}[]}>('/api/v1/imports/workspaces')).workspaces
    workspaceId.value=''
  } catch(cause) {importError.value=cause instanceof Error?cause.message:'预览失败'}
  finally {importBusy.value=false}
}
async function commitFile() {
  if(!importPreview.value) return
  importBusy.value=true;importError.value=''
  try {
    const result=await requestJson<{featureCount:number,layerIds:string[]}>(`/api/v1/imports/${importPreview.value.batchId}/commit`,{
      method:'POST',body:JSON.stringify({workspaceId:workspaceId.value,layers:importLayers.value})})
    importSuccess.value=`已写入 ${result.featureCount} 条档案、${result.layerIds.length} 个图层；刷新页面仍可读取。`
    importPreview.value=null;importFile.value=null;await load();await loadBatches()
  } catch(cause) {importError.value=cause instanceof Error?cause.message:'入库失败；预览仍保留，可修改后重试'}
  finally {importBusy.value=false}
}
async function load() {
  pending.value = true
  try { layers.value = (await getJson<{ layers: Layer[] }>('/api/v1/layers')).layers; error.value = '' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '图层读取失败' }
  finally { pending.value = false }
}
let pageRequest = 0
async function choose(layer: Layer, page = 0) {
  const request = ++pageRequest
  selected.value = layer; pending.value = true
  features.value = []; total.value = 0; offset.value = page
  try {
    const data = await getJson<{ total: number, offset: number, features: Feature[] }>(`/api/v1/layers/${layer.layerId}/features?limit=100&offset=${page}`)
    if (request !== pageRequest) return
    features.value = data.features; total.value = data.total; offset.value = data.offset; error.value = ''
  } catch (cause) { if (request === pageRequest) error.value = cause instanceof Error ? cause.message : '档案读取失败' }
  finally { if (request === pageRequest) pending.value = false }
}
function selectFromRoute() {
  const id = route.query.layerId
  const layer = layers.value.find(item => item.layerId === id)
  if (layer) return choose(layer)
  pageRequest++
  selected.value = null; pending.value = false
  if (id) error.value = '找不到此图层'
}
function openLayer(layer: Layer) {
  if (route.query.layerId === layer.layerId) return choose(layer)
  return router.push({ path: '/archive', query: { layerId: layer.layerId } })
}
function openEdit(feature: Feature) {
  editing.value = feature
  fieldsText.value = JSON.stringify(feature.properties,null,2)
  geometryText.value = JSON.stringify(feature.geometry,null,2)
  editError.value = ''
}
async function saveEdit() {
  if (!selected.value || !editing.value) return
  try {
    const properties = JSON.parse(fieldsText.value)
    const geometry = JSON.parse(geometryText.value)
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw Error('属性必须是 JSON 对象')
    const updated = await requestJson<Feature>(`/api/v1/layers/${selected.value.layerId}/features/${editing.value.featureId}`, {
      method:'PATCH', body: JSON.stringify({ expectedVersion: editing.value.version, properties, geometry }) })
    features.value = features.value.map(row => row.featureId === updated.featureId ? updated : row)
    editing.value = null
  } catch (cause) { editError.value = cause instanceof Error ? cause.message : '保存失败，当前修改仍在窗口中' }
}
watch(() => route.query.layerId, selectFromRoute)
onMounted(async () => { void loadBatches(); await load(); if (!error.value) await selectFromRoute() })
</script>

<template>
  <section class="content-panel"><h1>导入图层与档案</h1><p>当前从 PostGIS 动态读取图层；原始字段按档案展示。</p>
    <section v-if="session.current?.scopes.includes('archive:import')" class="import-panel">
      <h2>导入 GeoJSON 或 GDB 压缩包</h2><p>先预览文件、图层和字段，确认后写入 PostGIS。原文件仅存本机。</p>
      <input aria-label="选择导入文件" type="file" accept=".geojson,.zip,.rar" @change="event => importFile=(event.target as HTMLInputElement).files?.[0]||null" />
      <el-button :loading="importBusy" :disabled="!importFile" @click="previewFile">预览导入</el-button>
      <el-alert v-if="importError" :title="importError" type="error" :closable="false" />
      <el-alert v-if="importSuccess" :title="importSuccess" type="success" :closable="false" />
      <div v-if="importPreview"><p>{{ importPreview.filename }} · {{ importPreview.sourceCRS }} · {{ importPreview.layers.length }} 层</p>
        <a v-if="session.current?.scopes.includes('source:download')" :href="`/api/v1/imports/${importPreview.fileId}/source`">下载刚上传的原文件</a>
        <label>工作区 <el-select v-model="workspaceId" placeholder="选择工作区"><el-option v-for="work in workspaces" :key="work.id" :label="work.name" :value="work.id" /></el-select></label>
        <div v-for="(layer,index) in importPreview.layers" :key="index" class="import-layer">
          <strong>{{ layer.name }} · {{ layer.count }} 条</strong><p>字段：{{ layer.fields.join('、')||'无' }}</p>
          <el-input v-model="importLayers[index]!.name" aria-label="图层名称" maxlength="120" />
          <el-select v-model="importLayers[index]!.kind" aria-label="图层类别"><el-option label="项目" value="project" /><el-option label="宗地" value="parcel" /><el-option label="建筑" value="building" /><el-option label="规划用地" value="planned_land" /><el-option label="其他" value="other" /></el-select>
        </div><el-button type="primary" :loading="importBusy" :disabled="!workspaceId" @click="commitFile">确认写入 PostGIS</el-button>
      </div>
      <details v-if="batches.length" class="import-history"><summary>最近导入记录（{{ batches.length }}）</summary><ul><li v-for="batch in batches" :key="batch.id">
        {{ batch.filename }} · {{ batch.status==='committed'?'已入库':'待确认' }} · {{ batch.layers.map(layer=>`${layer.name} ${layer.count} 条`).join('、') }}
        <a v-if="session.current?.scopes.includes('source:download')" :href="`/api/v1/imports/${batch.fileId}/source`">下载原文件</a>
      </li></ul></details>
    </section>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-alert title="请核对档案的配准说明。示意配准仅供位置参考。" type="warning" :closable="false" show-icon />
    <div class="layer-list" v-loading="pending"><el-button v-for="layer in layers" :key="layer.layerId" :type="selected?.layerId === layer.layerId ? 'primary' : 'default'" @click="openLayer(layer)">{{ layer.name }} · {{ layer.featureCount }}</el-button></div>
    <template v-if="selected"><h2>{{ selected.name }}</h2><p>精度：{{ selected.precision.status === 'approximate' ? '示意配准' : '未核验' }}{{ selected.precision.note ? ` · ${selected.precision.note}` : '' }}</p>
      <div class="table-scroll"><table class="archive-table"><thead><tr><th>记录</th><th>地图</th><th v-if="session.current?.scopes.includes('archive:edit')">操作</th><th v-for="field in selected.fieldIds" :key="field">{{ field }}</th></tr></thead>
        <tbody><tr v-for="feature in features" :key="feature.featureId"><td>{{ feature.featureId }}</td><td><RouterLink v-if="(Array.isArray(feature.geometry.coordinates) && feature.geometry.coordinates.length) || (Array.isArray(feature.geometry.geometries) && feature.geometry.geometries.length)" :to="{path:'/map',query:{layerId:selected.layerId,featureId:feature.featureId}}">定位</RouterLink><span v-else>暂无坐标</span></td><td v-if="session.current?.scopes.includes('archive:edit')"><el-button size="small" @click="openEdit(feature)">编辑</el-button></td><td v-for="field in selected.fieldIds" :key="field">{{ feature.properties[field] ?? '未录入' }}</td></tr></tbody></table></div>
      <div class="inline-form"><span>显示 {{ features.length ? offset+1 : 0 }}–{{ offset+features.length }} / {{ total }}</span><el-button :disabled="offset === 0" @click="choose(selected,Math.max(0,offset-100))">上一页</el-button><el-button :disabled="offset+features.length >= total" @click="choose(selected,offset+100)">下一页</el-button></div>
    </template>
    <el-dialog :model-value="!!editing" title="编辑档案" width="min(92vw,760px)" @update:model-value="value => { if (!value) editing = null }">
      <p>属性与边界通过同一条保存命令更新；示意配准边界请先核对来源。</p>
      <label for="fields-json">原始字段</label><el-input id="fields-json" v-model="fieldsText" type="textarea" :rows="9" />
      <details><summary>高级：GeoJSON 几何</summary><el-input v-model="geometryText" type="textarea" :rows="7" /></details>
      <el-alert v-if="editError" :title="editError" type="error" :closable="false" />
      <template #footer><el-button @click="editing = null">取消</el-button><el-button type="primary" @click="saveEdit">保存</el-button></template>
    </el-dialog>
  </section>
</template>
