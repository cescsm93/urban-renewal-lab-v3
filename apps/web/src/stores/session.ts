import { defineStore } from 'pinia'
import { ref } from 'vue'
import { session, type Session } from '@renewal/contracts'
import { getJson, requestJson } from '../api/client'

export const useSessionStore = defineStore('session', () => {
  const current = ref<Session | null>(null)
  const pending = ref(false)
  const error = ref('')
  async function refresh() {
    pending.value = true
    try { current.value = session.parse(await getJson<unknown>('/api/v1/me')); error.value = '' }
    catch { current.value = null }
    finally { pending.value = false }
  }
  async function login(username: string, password: string) {
    pending.value = true
    error.value = ''
    try {
      await requestJson('/api/v1/session', { method: 'POST', body: JSON.stringify({ username, password }) })
      current.value = session.parse(await getJson('/api/v1/me'))
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '登录失败'
      current.value = null
    } finally { pending.value = false }
  }
  async function logout() {
    await requestJson('/api/v1/session', { method: 'DELETE' })
    current.value = null
  }
  return { current, pending, error, refresh, login, logout }
})
