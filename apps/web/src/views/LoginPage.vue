<script setup lang="ts">
import { ref } from 'vue'
import { useSessionStore } from '../stores/session'

const username = ref('')
const password = ref('')
const store = useSessionStore()
async function submit() { await store.login(username.value, password.value); password.value = '' }
</script>

<template>
  <div class="login-wrap"><form class="content-panel login-card" @submit.prevent="submit">
    <h1>登录工作台</h1><p>使用已有成员账号。权限由本机 Fastify 与数据库核验。</p>
    <label for="username">成员账号</label><el-input id="username" v-model="username" autocomplete="username" maxlength="32" />
    <label for="password">访问口令</label><el-input id="password" v-model="password" type="password" autocomplete="current-password" maxlength="128" show-password />
    <el-alert v-if="store.error" :title="store.error" type="error" :closable="false" />
    <el-button native-type="submit" type="primary" :loading="store.pending">登录</el-button>
  </form></div>
</template>
