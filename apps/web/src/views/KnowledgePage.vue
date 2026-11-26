<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getJson, requestJson } from '../api/client'
import { useSessionStore } from '../stores/session'

type Source = { id: number, title: string, kind: string, page: number | null, openUrl?: string }
type Document = { title: string, kind: string, path: string }
const session = useSessionStore()
const question = ref('')
const answer = ref('')
const sources = ref<Source[]>([])
const documents = ref<Document[]>([])
const pending = ref(false)
const error = ref('')
async function ask() {
  if (!question.value.trim()) return
  pending.value = true; error.value = ''; answer.value = ''; sources.value = []
  try {
    const data = await requestJson<{ answer: string, sources: Source[] }>('/api/v1/knowledge/query',
      { method: 'POST', body: JSON.stringify({ question: question.value.trim() }) })
    answer.value = data.answer; sources.value = data.sources
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '问答失败' }
  finally { pending.value = false }
}
async function loadCatalog() {
  if (!session.current?.admin) return
  try { documents.value = (await getJson<{ documents: Document[] }>('/api/v1/knowledge/catalog')).documents }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '目录读取失败' }
}
onMounted(() => { void loadCatalog() })
const sourceUrl = (item: Document) => '/api/v1/knowledge/source?' + new URLSearchParams({ kind: item.kind, path: item.path }).toString()
</script>

<template>
  <section class="content-panel"><h1>政策知识库</h1><p>政策索引和 Qwen 均保留在本机。同事可问答；目录和原文由后端单独鉴权。</p>
    <label for="question">政策问题</label><el-input id="question" v-model="question" type="textarea" :rows="4" maxlength="300" show-word-limit placeholder="例如：南京产业园更新有哪些适用政策？" />
    <el-button type="primary" :loading="pending" class="ask-button" @click="ask">查询政策</el-button>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <div v-if="answer" class="answer"><h2>回答</h2><p>{{ answer }}</p><h3>来源</h3>
      <ol><li v-for="source in sources" :key="source.id">{{ source.title }} · {{ source.kind }}<span v-if="source.page"> · 第 {{ source.page }} 页</span>
        <a v-if="source.openUrl" :href="source.openUrl" target="_blank" rel="noopener noreferrer">打开本机原文</a></li></ol></div>
    <details v-if="session.current?.admin" class="catalog"><summary>政策库目录 · {{ documents.length }} 份</summary><ul><li v-for="item in documents" :key="`${item.kind}:${item.path}`"><a :href="sourceUrl(item)" target="_blank" rel="noopener noreferrer">{{ item.title }}</a> · {{ item.kind }}</li></ul></details>
  </section>
</template>
