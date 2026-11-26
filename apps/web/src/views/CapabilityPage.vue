<script setup lang="ts">
import { computed } from 'vue'
import { useCapabilityStore } from '../stores/capabilities'

const props = defineProps<{ title: string, capabilityId: string }>()
const store = useCapabilityStore()
const current = computed(() => store.items.find(item => item.id === props.capabilityId))
</script>

<template>
  <section class="content-panel" aria-labelledby="page-title">
    <div class="panel-heading"><h1 id="page-title">{{ title }}</h1><el-tag v-if="current?.available" type="success">依赖已连接</el-tag><el-tag v-else type="warning">尚未接通</el-tag></div>
    <p v-if="current?.available">底层服务可读取。业务入口需完成权限与保存链路后启用。</p>
    <p v-else>{{ current?.reason || '此模块的真实接口尚未接通。不会显示示例数据冒充正式资料。' }}</p>
    <el-alert v-if="capabilityId === 'archive'" title="请核对图层的配准说明。示意配准仅供位置参考。" type="warning" :closable="false" show-icon />
  </section>
</template>
