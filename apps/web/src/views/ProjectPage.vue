<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { getJson, requestJson } from '../api/client'

type Project = { id: string, name: string, version: number, role: 'admin'|'editor'|'viewer', state: Record<string, unknown>, updatedAt: string }
const route = useRoute()
const project = ref<Project | null>(null)
const summary = ref('')
const revision = ref(0)
const dirty = ref(false)
const pending = ref(false)
const error = ref('')
const success = ref('')
async function load() {
  pending.value = true
  try {
    const row = await getJson<Project>(`/api/v1/projects/${route.params.id}`)
    project.value = row; summary.value = typeof row.state.projectSummary === 'string' ? row.state.projectSummary : ''
    dirty.value = false; error.value = ''
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '项目读取失败' }
  finally { pending.value = false }
}
function edit(value: string) { summary.value = value; revision.value++; dirty.value = true; success.value = '' }
async function save() {
  if (!project.value || !dirty.value) return
  const submitting = revision.value
  const current = project.value
  pending.value = true
  try {
    const row = await requestJson<Project & { savedDraftRevision: number }>(`/api/v1/projects/${current.id}`, {
      method: 'PUT', body: JSON.stringify({ expectedVersion: current.version, draftRevision: submitting,
        state: { ...current.state, projectSummary: summary.value } }) })
    project.value = row
    if (revision.value === row.savedDraftRevision) { dirty.value = false; success.value = `已保存版本 ${row.version}` }
    else { dirty.value = true; success.value = '上一版已保存；当前新输入仍未保存' }
    error.value = ''
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败；草稿已保留' }
  finally { pending.value = false }
}
onMounted(() => { void load() })
</script>

<template>
  <section class="content-panel"><RouterLink to="/projects">← 返回项目</RouterLink>
    <h1>{{ project?.name || '项目详情' }}</h1><p v-if="project">版本 {{ project.version }} · {{ project.role }} · {{ project.updatedAt }}</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" /><el-alert v-if="success" :title="success" type="success" :closable="false" />
    <template v-if="project"><label for="summary">项目摘要</label>
      <el-input id="summary" :model-value="summary" type="textarea" :rows="7" :readonly="project.role === 'viewer'" @update:model-value="edit" />
      <div v-if="project.role !== 'viewer'" class="inline-form"><el-button type="primary" :disabled="!dirty" :loading="pending" @click="save">保存摘要</el-button><span v-if="dirty">有未保存修改</span></div>
      <p>现有地图、图层和其他字段仍按原项目快照保留；本批只开放摘要编辑。</p>
    </template>
  </section>
</template>
