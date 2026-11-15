<script setup lang="ts">
import { computed, ref } from 'vue'
import DataRow from '../components/DataRow.vue'

defineOptions({ name: 'DensityPage' })
const props = defineProps<{ overview: any }>()

const scope = ref<'private' | 'group'>('private')
const labels: Record<string, string> = { burst: '极高密度', high: '高密度', normal: '日常', low: '低密度', advance: '自动推进' }
const mode = computed(() => {
  const value = props.overview?.density?.scopes?.[scope.value]?.mode
  return value && value !== 'inherit' ? value : props.overview?.density?.globalMode ?? props.overview?.density?.mode ?? 'fixed'
})
const tiers = computed(() => {
  const density = props.overview?.density ?? {}
  const configured = density.scopes?.[scope.value]?.tiers ?? {}
  return [
    { label: '极高密度', tier: 'burst', limit: configured.burst, info: '近 5 分钟至少 4 条消息' },
    { label: '高密度', tier: 'high', limit: configured.high, info: '近 5 分钟至少 2 条，或近 15 分钟至少 4 条消息' },
    { label: '日常', tier: 'normal', limit: density.anchor, info: '使用 contextEntryLimit 作为日常档锚点' },
    { label: '低密度', tier: 'low', limit: configured.low, info: '近 30 分钟没有新消息' },
    { label: '自动推进', tier: 'advance', limit: configured.advance, info: '自动生活推进回合使用的档位' },
  ]
})
const effectiveLimit = computed(() => {
  const value = mode.value === 'fixed' ? props.overview?.density?.anchor : tiers.value.find(item => item.tier === props.overview?.density?.tier)?.limit
  return mode.value === 'auto' && value != null ? Math.max(4, Math.min(200, Math.floor(value))) : value
})

</script>

<template>
  <div v-if="overview">
    <div class="pg-head">
      <div>
        <h2>上下文预算</h2>
        <div class="sub">近期原始剧本的保留预算。密度统计按当前故事计算，私聊与群聊可分别设置模式和档位。</div>
      </div>
    </div>
    <div class="scope-controls"><button :class="{ on: scope === 'private' }" @click="scope = 'private'">私聊预算</button><button :class="{ on: scope === 'group' }" @click="scope = 'group'">群聊预算</button><router-link to="/hdsi/config-center">在配置中心调整 →</router-link></div>
    <div class="grid">
      <div class="card">
        <h3><span class="sq" />当前档位</h3>
        <DataRow label="模式" :value="mode === 'auto' ? '随密度自适应' : '固定预算'" state="acc" info="fixed 使用锚点与时间窗；auto 按本页档位动态选择" range="fixed | auto" />
        <DataRow label="档位" :value="`${mode === 'auto' ? labels[overview.density.tier] ?? overview.density.tier : '固定'} → ${effectiveLimit ?? '—'} 条`" info="当前密度对应的用户回合预算；fixed 可额外合并时间窗，auto 使用至少 4 条的档位硬上限。自动推进回合使用推进档。" />
        <DataRow label="近 5 分钟" :value="`${overview.density.counts.count5} 条消息`" info="入站消息计数——密度信号源之一（burst 判定窗）" />
        <DataRow label="近 15 分钟" :value="`${overview.density.counts.count15} 条消息`" info="入站消息计数——high 判定窗" />
        <DataRow label="近 30 分钟" :value="`${overview.density.counts.count30} 条消息`" info="入站消息计数——low 判定窗（轨迹重载归零）" />
      </div>
      <div class="card">
        <h3><span class="sq" />档位表</h3>
        <DataRow v-for="t in tiers" :key="t.label" class="row" :class="{ on: mode === 'auto' && overview.density.tier === t.tier }"
          :label="t.label" :value="t.limit == null ? '未提供配置' : `${t.limit} 条`" :info="t.info" />
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
.scope-controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 18px; }
.scope-controls button { padding: 6px 14px; background: transparent; border: 1px solid var(--k-color-divider, #8884); color: inherit; cursor: pointer; }
.scope-controls button.on { border-color: var(--k-color-primary); color: var(--k-color-primary); }
.scope-controls a { font-size: 13px; }
</style>
