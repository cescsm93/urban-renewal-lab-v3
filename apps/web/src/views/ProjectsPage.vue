<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { getJson, requestJson } from '../api/client'
import { useSessionStore } from '../stores/session'

type Row = { id: string, name: string, version: number, role: string, updatedAt: string }
const rows = ref<Row[]>([])
const name = ref('')
const error = ref('')
const pending = ref(false)
const session = useSessionStore()
async function load() {
  pending.value = true
  try { rows.value = (await getJson<{ projects: Row[] }>('/api/v1/projects')).projects; error.value = '' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取项目'; rows.value = [] }
  finally { pending.value = false }
}
async function create() {
  if (!name.value.trim()) return
  try { await requestJson('/api/v1/projects', { method: 'POST', body: JSON.stringify({ name: name.value.trim(), state: {} }) }); name.value = ''; await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '创建失败' }
}
onMounted(() => { void load() })
</script>

<template>
  <section class="content-panel"><h1>共享项目</h1><p>项目由 PostGIS 所在的 PostgreSQL 保存；只显示你有权查看的项目。</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <div v-if="session.current?.admin" class="inline-form"><el-input v-model="name" placeholder="新项目名称" maxlength="100" /><el-button type="primary" @click="create">新建项目</el-button></div>
    <el-table :data="rows" v-loading="pending" empty-text="暂无可访问的共享项目" style="width:100%">
      <el-table-column label="项目" min-width="200"><template #default="{ row }"><RouterLink :to="`/projects/${row.id}`">{{ row.name }}</RouterLink></template></el-table-column>
      <el-table-column prop="version" label="版本" width="90" /><el-table-column prop="role" label="权限" width="110" />
      <el-table-column prop="updatedAt" label="更新于" min-width="170" />
    </el-table>
  </section>
</template>
