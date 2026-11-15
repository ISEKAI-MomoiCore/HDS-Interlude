<script lang="ts">
/** 数据行组件：键 + 值 + 可选 ⓘ 提示（值含义与值域）。 */
import InfoDot from './InfoDot.vue'

export default {
  name: 'DataRow',
  components: { InfoDot },
  props: {
    label: { type: String, required: true },
    value: { type: [String, Number, Boolean], default: '—' },
    state: { type: String, default: '' }, // 'ok' | 'warn' | 'acc'
    info: { type: String, default: '' },
    range: { type: String, default: '' },
  },
}
</script>

<template>
  <div class="row">
    <span class="k">
      {{ label }}
      <InfoDot v-if="info || range" :info="info" :range="range" />
    </span>
    <span class="v" :class="state || undefined">{{ value }}</span>
  </div>
</template>

<style scoped>
.row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 13px; }
.k { display: flex; align-items: center; opacity: .55; }
.v { font-weight: 600; }
.v.ok { color: #14b8a6; }
.v.warn { color: #dfc084; }
.v.acc { color: var(--fg3, #3b82f6); }
</style>
