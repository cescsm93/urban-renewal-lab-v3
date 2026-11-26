import { defineStore } from 'pinia'
import { ref } from 'vue'
import { capability } from '@renewal/contracts'
import type { Capability } from '@renewal/contracts'
import { getJson } from '../api/client'

export const useCapabilityStore = defineStore('capabilities', () => {
  const items = ref<Capability[]>([])
  const pending = ref(false)
  const error = ref('')
  async function refresh() {
    pending.value = true
    error.value = ''
    try {
      const payload = await getJson<{ capabilities: unknown[] }>('/api/v1/capabilities')
      items.value = payload.capabilities.map(item => capability.parse(item))
    } catch (cause) {
      items.value = []
      error.value = cause instanceof Error ? cause.message : '无法读取能力状态'
    } finally { pending.value = false }
  }
  return { items, pending, error, refresh }
})
