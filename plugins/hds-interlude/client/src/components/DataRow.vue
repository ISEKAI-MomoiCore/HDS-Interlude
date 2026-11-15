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
.row { display: grid; grid-template-columns: minmax(95px, .9fr) minmax(0, 1.4fr); gap: 12px; align-items: start; padding: 7px 0; font-size: 13px; line-height: 1.6; }
.k { display: flex; align-items: center; flex-wrap: wrap; opacity: .8; min-width: 0; overflow-wrap: anywhere; }
.v { font-weight: 550; text-align: right; min-width: 0; overflow-wrap: anywhere; }
.v.ok { color: var(--k-color-success, #14b8a6); }
.v.warn { color: var(--k-color-warning, #dfc084); }
.v.acc { color: var(--k-text-active, inherit); }
</style>
