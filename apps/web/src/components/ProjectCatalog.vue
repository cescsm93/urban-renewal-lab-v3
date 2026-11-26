<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { getJson } from '../api/client'

type Layer = { layerId: string, name: string, kind: string, featureCount: number }
type Workspace = { workspaceId: string, name: string, layers: Layer[] }
type Group = { kind: 'province' | 'company', workspaces: Workspace[] }
const labels = { province: '全省项目库', company: '公司项目库' }
const groups = ref<Group[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    groups.value = (await getJson<{ groups: Group[] }>('/api/v1/libraries/project-catalog')).groups
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '项目库读取失败'
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <section class="project-catalog" v-loading="loading" aria-label="项目库">
    <div v-if="error"><el-alert type="error" :title="error" :closable="false" /><el-button @click="load">重试</el-button></div>
    <section v-for="group in groups" :key="group.kind">
      <h2>{{ labels[group.kind] }}</h2>
      <p v-if="!group.workspaces.length">暂无已归入此库的工作区。</p>
      <div v-for="workspace in group.workspaces" :key="workspace.workspaceId">
        <h3 v-if="workspace.name !== labels[group.kind] || group.workspaces.length > 1">{{ workspace.name }}</h3>
        <p v-if="!workspace.layers.length">此工作区暂无图层。</p>
        <ul v-else>
          <li v-for="layer in workspace.layers" :key="layer.layerId">
            <span><strong>{{ layer.name }}</strong> · {{ layer.featureCount }} 条档案</span>
            <span class="catalog-links">
              <RouterLink :to="{path:'/archive', query:{layerId:layer.layerId}}" :aria-label="`查看${layer.name}档案`">查看档案</RouterLink>
              <RouterLink :to="{path:'/map', query:{layerId:layer.layerId}}" :aria-label="`在地图查看${layer.name}`">在地图查看</RouterLink>
            </span>
          </li>
        </ul>
      </div>
    </section>
  </section>
</template>

<style scoped>
.project-catalog { min-height: 6rem; }
.project-catalog > section + section { margin-top: 2rem; }
.project-catalog ul { list-style: none; padding: 0; }
.project-catalog li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .5rem 1.5rem; padding: .65rem 0; border-bottom: 1px solid #dce5e4; }
.catalog-links { display: flex; gap: 1rem; }
</style>
