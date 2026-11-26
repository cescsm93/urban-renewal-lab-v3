<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { useCapabilityStore } from './stores/capabilities'
import { useSessionStore } from './stores/session'
import LoginPage from './views/LoginPage.vue'

const store = useCapabilityStore()
const session = useSessionStore()
onMounted(async () => { await session.refresh(); if (session.current) void store.refresh() })
watch(() => session.current, value => { if (value) void store.refresh() })
</script>

<template>
  <div class="app-shell">
    <header class="masthead"><strong>Urban Renewal Lab</strong><span>模块化工作台 · 本机实施入口</span><span v-if="session.current" class="account">{{ session.current.username }} · {{ session.current.admin ? '管理员' : '成员' }} <el-button size="small" @click="session.logout">退出</el-button></span></header>
    <nav v-if="session.current" class="primary-nav" aria-label="主导航">
      <RouterLink to="/map">地图</RouterLink>
      <RouterLink to="/projects">共享项目</RouterLink>
      <RouterLink to="/archive">导入数据</RouterLink>
      <RouterLink to="/knowledge">政策库</RouterLink>
      <RouterLink to="/libraries">四库</RouterLink>
      <RouterLink to="/workflow">工作流</RouterLink>
      <RouterLink to="/report">研判报告</RouterLink>
    </nav>
    <main v-if="session.pending && !session.current" aria-live="polite">正在核验会话…</main>
    <LoginPage v-else-if="!session.current" />
    <main v-else>
      <el-alert v-if="store.error" :title="store.error" type="error" :closable="false" show-icon />
      <div class="status-row"><span>后端状态：{{ store.pending ? '检测中' : store.error ? '不可用' : '已连接' }}</span><el-button size="small" :loading="store.pending" @click="store.refresh">重新检查</el-button></div>
      <RouterView />
    </main>
  </div>
</template>
