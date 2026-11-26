<script setup lang="ts">
import { onMounted,ref } from 'vue'
import { RouterLink,useRoute,useRouter } from 'vue-router'
import { getJson,requestJson } from '../api/client'
type Subject={layerId:string,featureId:string,name:string,layerName:string}
const route=useRoute(),router=useRouter()
const subjects=ref<Subject[]>([]),selected=ref(''),radiusMeters=ref(2000),busy=ref(false),error=ref('')
onMounted(async()=>{try{subjects.value=(await getJson<{subjects:Subject[]}>('/api/v1/workflow/subjects')).subjects
  const layerId=String(route.query.layerId||''),featureId=String(route.query.featureId||'')
  selected.value=subjects.value.find(item=>item.layerId===layerId&&item.featureId===featureId)?`${layerId}:${featureId}`:''
}catch(cause){error.value=cause instanceof Error?cause.message:'项目读取失败'}})
async function run(){
  const [layerId,featureId]=selected.value.split(':')
  if(!layerId||!featureId)return
  busy.value=true;error.value=''
  try{const result=await requestJson<{id:string}>('/api/v1/workflow/runs',{method:'POST',body:JSON.stringify({layerId,featureId,radiusMeters:radiusMeters.value})});
    await router.push(`/report?runId=${result.id}`)
  }catch(cause){error.value=cause instanceof Error?cause.message:'研判失败'}finally{busy.value=false}
}
</script>
<template><section class="content-panel"><h1>项目前期研判工作流</h1>
  <p>选择现有项目和研究半径 → 叠加宗地、建筑、规划用地、本机人口、房价与 POI → 保存研判记录 → 查看页面报告。</p>
  <el-alert title="示意配准的空间关系仅供核对；不用于精确测距和法定边界判断。" type="warning" :closable="false" show-icon />
  <div class="inline-form"><el-select v-model="selected" filterable placeholder="选择项目" style="width:min(100%,520px)">
    <el-option v-for="item in subjects" :key="`${item.layerId}:${item.featureId}`" :label="`${item.name} · ${item.layerName}`" :value="`${item.layerId}:${item.featureId}`" /></el-select>
    <label>研究半径（米）<el-input-number v-model="radiusMeters" :min="500" :max="5000" :step="500" /></label>
    <el-button type="primary" :disabled="!selected" :loading="busy" @click="run">运行研判并保存</el-button></div>
  <el-alert v-if="error" :title="error" type="error" :closable="false" />
  <RouterLink v-if="selected" :to="`/map?layerId=${selected.split(':')[0]}&featureId=${selected.split(':')[1]}`">在地图上核对项目</RouterLink>
  <p>商业租金和公服步行覆盖尚未接入本轮报告，报告中会列为缺项。</p>
</section></template>
