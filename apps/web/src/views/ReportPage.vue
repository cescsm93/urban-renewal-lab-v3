<script setup lang="ts">
import { computed,onMounted,ref,watch } from 'vue'
import { RouterLink,useRoute } from 'vue-router'
import { getJson } from '../api/client'
import MapCanvas,{type MapFeature} from '../components/MapCanvas.vue'
type Relation={layerId:string,featureId:string,layerName:string,kind:string,name:string,relation:string,overlapSqm:number|null}
type Study={available:boolean,radiusMeters:number,center?:[number,number],reason?:string,population?:{source:string,cells:number,estimatedResidents:number,missingCells:number,workers:number|null,heatCells:[number,number,number][]},housing?:{source:string,totalSamples:number,communities:{name:string,meanPrice:number,samples:number,point:[number,number]}[]},poi?:{source:string,categories:{category:string,count:number,nearest:{name:string,point:[number,number],meters:number}[]}[]}}
type Report={id:string,createdAt:string,subject:{layerId:string,featureId:string,name:string,properties:Record<string,unknown>,geometry:MapFeature['geometry']},counts:Record<string,number>,relations:Relation[],study?:Study,precision:{status:string,note:string},findings:string[],recommendation:string,dataGaps:string[],algorithm:string,algorithmVersion?:string,truncated:boolean}
const route=useRoute(),runs=ref<{id:string,name:string,createdAt:string}[]>([]),report=ref<Report|null>(null),error=ref(''),busy=ref(false)
const mapSubject=computed<MapFeature|null>(()=>report.value?{type:'Feature',layerId:report.value.subject.layerId,featureId:report.value.subject.featureId,version:1,
  layerName:'项目层',layerKind:'project',properties:report.value.subject.properties,geometry:report.value.subject.geometry}:null)
const studyOverlay=computed(()=>report.value?.study?.available?report.value.study:undefined)
async function load(){busy.value=true;error.value=''
 try{runs.value=(await getJson<{runs:{id:string,name:string,createdAt:string}[]}>('/api/v1/workflow/runs')).runs
 const id=String(route.query.runId||runs.value[0]?.id||'')
 report.value=id?await getJson<Report>(`/api/v1/workflow/runs/${id}`):null
 }catch(cause){error.value=cause instanceof Error?cause.message:'报告读取失败'}finally{busy.value=false}}
onMounted(()=>{void load()});watch(()=>route.query.runId,()=>{void load()})
const title=(kind:string)=>({parcel:'宗地',building:'建筑',planned_land:'规划用地'}[kind]||kind)
</script>
<template><section class="content-panel report-page" v-loading="busy"><h1>研判报告</h1>
  <el-alert v-if="error" :title="error" type="error" :closable="false" />
  <div v-if="runs.length" class="inline-form"><span>选择历史研判：</span><RouterLink v-for="run in runs.slice(0,10)" :key="run.id" :to="`/report?runId=${run.id}`">{{ run.name }} · #{{ run.id }}</RouterLink></div>
  <template v-if="report"><header><h2>{{ report.subject.name }} · 前期研判草稿</h2><p>记录 #{{ report.id }} · {{ new Date(report.createdAt).toLocaleString('zh-CN') }}</p></header>
    <el-alert v-if="!report.algorithmVersion && !report.study?.available" title="此报告生成于当前研判算法更新前，请重新运行工作流获取最新关系口径。" type="warning" :closable="false" />
    <el-alert :title="`精度：${report.precision.status==='approximate'?'示意配准':'未核验'}。${report.precision.note}`" type="warning" :closable="false" show-icon />
    <h3>一、项目概况</h3><p>项目名称：{{ report.subject.name }}。<RouterLink :to="`/map?layerId=${report.subject.layerId}&featureId=${report.subject.featureId}`">在地图上查看边界</RouterLink></p>
    <dl class="report-fields"><template v-for="(value,key) in report.subject.properties" :key="key"><dt>{{ key }}</dt><dd>{{ value??'未录入' }}</dd></template></dl>
    <h3>二、空间叠加核验</h3><p v-for="finding in report.findings" :key="finding">{{ finding }}</p><p>{{ report.algorithm }}</p>
    <div class="relation-chart" role="img" :aria-label="`宗地 ${report.counts.parcel}、建筑 ${report.counts.building}、规划用地 ${report.counts.planned_land}`">
      <div v-for="kind in ['parcel','building','planned_land']" :key="kind" class="relation-bar"><span>{{ title(kind) }}</span><div><i :style="{width:`${Math.max(3,Math.round(100*(report.counts[kind]||0)/Math.max(1,...Object.values(report.counts))))}%`}" /></div><strong>{{ report.counts[kind]||0 }}</strong></div>
    </div>
    <el-alert v-if="report.truncated" title="关联记录超过 5000 条，仅显示前 5000 条；需缩小范围复核。" type="warning" :closable="false" />
    <div class="table-scroll"><table class="archive-table"><thead><tr><th>类别</th><th>图层</th><th>档案</th><th>关系</th><th>示意重叠面积（㎡）</th></tr></thead><tbody><tr v-for="item in report.relations" :key="`${item.layerId}:${item.featureId}`"><td>{{ title(item.kind) }}</td><td>{{ item.layerName }}</td><td><RouterLink :to="`/map?layerId=${item.layerId}&featureId=${item.featureId}`">{{ item.name }} #{{ item.featureId }}</RouterLink></td><td>{{ item.relation }}</td><td>{{ item.overlapSqm??'—' }}</td></tr></tbody></table></div>
    <h3>三、周边专题 · {{ report.study?.radiusMeters??'—' }} 米</h3>
    <el-alert v-if="report.study && !report.study.available" :title="`本机专题数据未读取：${report.study.reason}`" type="warning" :closable="false" />
    <template v-if="report.study?.available">
      <div class="report-map"><MapCanvas :key="report.id" :visible-layer-ids="[report.subject.layerId]" :selected="mapSubject" basemap="offline" :study="studyOverlay" /></div>
      <p>图例：蓝黄红为人口格网相对热度，橙色为住宅历史均价点，青色为 POI 档案点。点击点位查看名称。</p>
      <div class="study-grid"><div class="study-card"><h4>人口分布</h4><p>估算居住人口：{{ report.study.population?.estimatedResidents.toLocaleString()??'—' }} 人</p><p>格网 {{ report.study.population?.cells??0 }} 个 · 工作人口 {{ report.study.population?.workers?.toLocaleString()??'未提供' }}</p><small>{{ report.study.population?.source }}；格网估算值，不能识别个人。</small></div>
        <div class="study-card"><h4>住宅价格</h4><p>小区 {{ report.study.housing?.communities.length??0 }} 个 · 样本 {{ report.study.housing?.totalSamples??0 }} 条</p><small>{{ report.study.housing?.source }}；不作为当前成交价。</small></div>
        <div class="study-card"><h4>POI</h4><p>类别 {{ report.study.poi?.categories.length??0 }} 类</p><small>{{ report.study.poi?.source }}；不自动认定地铁已运营。</small></div></div>
      <h4>住宅小区平均价格（历史样本，元/㎡）</h4><div v-if="report.study.housing?.communities.length" class="price-chart"><div v-for="home in report.study.housing.communities.slice(0,10)" :key="home.name" class="price-bar"><span>{{ home.name }}</span><div><i :style="{width:`${Math.max(3,Math.round(100*home.meanPrice/Math.max(1,report.study.housing.communities[0]?.meanPrice||1)))}%`}" /></div><strong>{{ home.meanPrice.toLocaleString() }}</strong></div></div><p v-else>研究圈内没有住宅价格样本。</p>
      <h4>周边 POI 类别</h4><div class="poi-tags"><span v-for="group in report.study.poi?.categories" :key="group.category">{{ group.category }} {{ group.count }}</span></div>
    </template>
    <h3>四、初步建议</h3><p>{{ report.recommendation }}</p>
    <h3>五、待补数据与核查</h3><ul><li v-for="gap in report.dataGaps" :key="gap">{{ gap }}</li></ul>
    <p class="precision-note">本页是基于现有档案与 PostGIS 叠加的草稿，需人工核对原始资料和正式坐标。未纳入的数据没有推断结果。</p>
  </template><p v-else-if="!busy">还没有研判记录。请先在工作流中选择项目并运行。</p>
</section></template>
