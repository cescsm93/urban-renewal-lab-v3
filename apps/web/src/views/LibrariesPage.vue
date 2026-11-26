<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { getJson } from '../api/client'
import { useSessionStore } from '../stores/session'
import ProjectCatalog from '../components/ProjectCatalog.vue'

type Row = Record<string, unknown>
type Library = { source?: string, fields?: string[], records: Row[] }
type Tab = 'policy' | 'partners' | 'projects' | 'scenes'
const session = useSessionStore()
const active = ref<Tab>('partners')
const partners = ref<Library | null>(null), scenes = ref<Library | null>(null)
const selected = ref<Row | null>(null), search = ref(''), category = ref('')
const loading = ref(false), error = ref('')
const title = { policy: '政策库', partners: '资源库', projects: '项目库', scenes: '场景库' }
const current = computed(() => active.value === 'partners' ? partners.value : scenes.value)
const categories = computed(() => [...new Set((partners.value?.records || []).map(row => String(row['类别'] || '')).filter(Boolean))])
const filtered = computed(() => (current.value?.records || []).filter(row => {
  if (active.value === 'partners' && category.value && row['类别'] !== category.value) return false
  const words = search.value.trim().toLocaleLowerCase()
  return !words || Object.values(row).some(value => String(value ?? '').toLocaleLowerCase().includes(words))
}))
const fields = computed(() => active.value === 'scenes' ? Object.entries((selected.value?.['字段'] || {}) as Row) :
  (current.value?.fields || []).map(field => [field, selected.value?.[field]] as const))
const recordName = (row: Row) => String(row[active.value === 'partners' ? '机构名称' : '名称'] || '未命名')
const subtitle = (row: Row) => active.value === 'partners' ? [row['类别'], row['所在地区'], row['专业方向']].filter(Boolean).join(' · ') : String(row['描述'] || '')
const sourceUrl = (row: Row) => '/api/v1/libraries/scenes/source?' + new URLSearchParams({ file: String(row['来源文件'] || '') })

async function load(tab: Tab) {
  if (!session.current?.admin || (tab !== 'partners' && tab !== 'scenes')) return
  if (tab === 'partners' && partners.value || tab === 'scenes' && scenes.value) return
  loading.value = true; error.value = ''
  try {
    const data = await getJson<Library>(`/api/v1/libraries/${tab}`)
    if (tab === 'partners') partners.value = data
    else scenes.value = data
    selected.value = data.records[0] || null
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '资料库读取失败' }
  finally { loading.value = false }
}
watch([active, () => session.current?.admin], ([tab]) => {
  search.value = ''; category.value = ''
  selected.value = (tab === 'partners' ? partners.value : scenes.value)?.records[0] || null
  void load(tab)
}, { immediate: true })
watch(filtered, rows => { if (rows.length && !rows.includes(selected.value || {})) selected.value = rows[0] || null; if (!rows.length) selected.value = null })
</script>

<template>
  <section class="content-panel library-page"><h1>四库</h1>
    <p>政策、合作伙伴、项目和场景资料保留在本机；目录与原文仅管理员查看。</p>
    <el-tabs v-model="active" aria-label="四库分类">
      <el-tab-pane v-for="(label,key) in title" :key="key" :label="label" :name="key" />
    </el-tabs>
    <div v-if="!session.current?.admin" class="library-empty"><h2>{{ title[active] }}</h2><p>当前可查看记录：0 条。你仍可使用已授权的问答功能。</p></div>
    <template v-else-if="active==='policy'"><h2>政策库</h2><p>原目录和索引在本机政策知识库中查看。</p><RouterLink to="/knowledge">打开政策库目录与问答</RouterLink></template>
    <ProjectCatalog v-else-if="active==='projects'" />
    <template v-else>
      <h2>{{ title[active] }} <small>· {{ current?.records.length || 0 }} 条</small></h2>
      <p v-if="current?.source">来源：{{ current.source }}</p>
      <a v-if="active==='partners' && current" class="library-export" href="/api/v1/libraries/partners/export" download="partner-library.json">下载资源库备份 JSON</a>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <div v-loading="loading" class="library-controls">
        <el-input v-model="search" clearable :placeholder="active==='partners'?'搜索机构、地区、专业方向或案例':'搜索场景名称、目标或内容'" />
        <el-select v-if="active==='partners'" v-model="category" clearable placeholder="全部类别"><el-option v-for="item in categories" :key="item" :label="item" :value="item" /></el-select>
      </div>
      <div class="library-grid">
        <div class="library-results"><p>显示 {{ filtered.length }} / {{ current?.records.length || 0 }} 条</p>
          <button v-for="(row,index) in filtered" :key="index" type="button" :class="{on:selected===row}" @click="selected=row"><b>{{ recordName(row) }}</b><small>{{ subtitle(row) }}</small></button>
          <p v-if="!filtered.length">没有符合条件的记录。</p>
        </div>
        <div class="library-record" v-if="selected"><h3>{{ recordName(selected) }}</h3>
          <a v-if="active==='scenes' && selected['来源文件']" :href="sourceUrl(selected)">下载原始 Word 文件</a>
          <dl><template v-for="[key,value] in fields" :key="key"><dt>{{ key }}</dt><dd>{{ value || '未录入' }}</dd></template></dl>
        </div>
      </div>
    </template>
  </section>
</template>
