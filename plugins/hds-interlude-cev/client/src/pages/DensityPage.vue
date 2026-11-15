<script setup lang="ts">
import DataRow from '../components/DataRow.vue'

defineOptions({ name: 'DensityPage' })
const props = defineProps<{ overview: any }>()

const tiers: Array<{ label: string, tier: string, limit: number, info: string }> = [
  { label: '极高密度', tier: 'burst', limit: 12, info: '连发轰炸（近 5 分钟 ≥6 条）时收紧到 12 条' },
  { label: '高密度', tier: 'high', limit: 15, info: '高频率对话（近 15 分钟 ≥4 条）' },
  { label: '日常', tier: 'normal', limit: 18, info: 'normal 档恒等于锚点 contextEntryLimit——调锚点即调日常档' },
  { label: '低密度', tier: 'low', limit: 22, info: '安静了一阵（近 30 分钟 ≤1 条）放宽到 22 条' },
  { label: '自动推进', tier: 'advance', limit: 25, info: 'advance 相位固定档，不随密度切换' },
]
</script>

<template>
  <div v-if="overview">
    <div class="pg-head">
      <div>
        <h2>密度与预算</h2>
        <div class="sub">原始剧本条目自适应（contextEntryMode）</div>
      </div>
    </div>
    <div class="grid">
      <div class="card">
        <h3><span class="sq" />当前档位</h3>
        <DataRow label="模式" :value="overview.density.mode" state="acc" info="fixed=固定条数 / auto=按密度自适应（12-25 条）" range="fixed | auto" />
        <DataRow label="档位" :value="`${overview.density.tier} → ${overview.density.effectiveLimit} 条`" info="当前密度档位 → 生效条目上限（auto 模式为硬上限，时间窗并入同样受约束）" />
        <DataRow label="近 5 分钟" :value="`${overview.density.counts.count5} 条消息`" info="入站消息计数——密度信号源之一（burst 判定窗）" />
        <DataRow label="近 15 分钟" :value="`${overview.density.counts.count15} 条消息`" info="入站消息计数——high 判定窗" />
        <DataRow label="近 30 分钟" :value="`${overview.density.counts.count30} 条消息`" info="入站消息计数——low 判定窗（轨迹重载归零）" />
      </div>
      <div class="card">
        <h3><span class="sq" />档位表</h3>
        <DataRow v-for="t in tiers" :key="t.label" class="row" :class="{ on: overview.density.tier === t.tier }"
          :label="t.label" :value="`${t.limit} 条`" :info="t.info" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.pg-head { margin-bottom: 1rem; }
.pg-head h2 { font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
.pg-head h2::before { content: ""; width: 10px; height: 10px; background: var(--fg3, #3b82f6); transform: rotate(45deg); }
.sub { opacity: .55; font-size: 12.5px; padding-left: 20px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.card { background: var(--bg1, rgba(128,128,128,.05)); border: 1px solid var(--bg3, rgba(128,128,128,.15)); padding: 14px 16px; }
.card h3 { font-size: 11.5px; opacity: .55; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.sq { width: 8px; height: 8px; background: #14b8a6; }
.row.on { border-left: 2.5px solid var(--fg3, #3b82f6); padding-left: 8px; background: rgba(59,130,246,.06); }
</style>
