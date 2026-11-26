<script setup lang="ts">
/**
 * P1 总览：campaign 全局状态墙（段矩阵 + KPI + 活动流）。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { store, stateOf, refreshState } from '../store'
import { post } from '../api'

const router = useRouter()

const phases = computed(() => store.phases)

const totalTurns = computed(() => store.campaign.states.reduce((sum, s) => sum + (s.turns?.done ?? 0), 0))
const totalTokens = computed(() => store.campaign.states.reduce((sum, s) => sum + (s.totalTokens ?? 0), 0))
const doneCount = computed(() => store.campaign.states.filter(s => s.status === 'done').length)
const reusedCount = computed(() => store.campaign.states.filter(s => s.status === 'reused').length)
const segmentCount = computed(() => phases.value.reduce((total, phase) => total + phase.segments.length, 0))

function tileDesc(segment: { variant: string, scenario: string, persona?: string | null }): string {
  const persona = segment.persona ? `·${segment.persona}` : ''
  return `${segment.variant}${persona}×${segment.scenario}`
}

function statusClass(status?: string): string {
  return status ? `st-${status}` : ''
}

function openSegment(id: string): void {
  const result = stateOf(id)?.resultId
  void router.push({ path: '/review', query: result ? { result } : { seg: id, profile: store.activeProfile } })
}

async function runAll(dry: boolean): Promise<void> {
  try { await post('/api/run', { dry }); await refreshState() } catch (error) { alert((error as Error).message) }
}
async function stopAll(): Promise<void> {
  try { await post('/api/stop') } catch (error) { alert((error as Error).message) }
}
</script>

<template>
  <h1 class="page-title">总览</h1>
  <p class="page-sub">campaign 全局状态 · {{ segmentCount }} 段 · 数据落盘 test/realism/out/</p>

  <div class="kpis">
    <div class="kpi"><div class="k">状态</div>
      <div class="v"><small v-if="store.campaign.running">▶ {{ store.campaign.current }}</small><small v-else>空闲</small></div>
    </div>
    <div class="kpi"><div class="k">已完成段</div><div class="v">{{ doneCount }}<small> / {{ store.campaign.states.length || '—' }}<template v-if="reusedCount"> · 复用 {{ reusedCount }}</template></small></div></div>
    <div class="kpi"><div class="k">累计轮次</div><div class="v">{{ totalTurns }}</div></div>
    <div class="kpi"><div class="k">累计 tokens</div><div class="v">{{ totalTokens.toLocaleString() }}</div></div>
    <div class="kpi"><div class="k">模型</div><div class="v"><small>{{ store.env.model || '未配置' }}</small></div></div>
  </div>

  <div style="margin-bottom: 14px; display:flex; gap:8px;">
    <button class="primary" :disabled="store.campaign.running" @click="runAll(false)">▶ 全跑（live）</button>
    <button :disabled="store.campaign.running" @click="runAll(true)">Dry 全跑</button>
    <button class="danger" :disabled="!store.campaign.running" @click="stopAll()">⏹ 停止</button>
    <button @click="runAll(true)" v-if="!store.uiBuilt" class="warn">UI 未构建</button>
  </div>

  <div v-for="phase in phases" :key="phase.key" class="phase-block">
    <div class="phase-head">
      <span class="name">{{ phase.name }}</span>
      <span class="meta">{{ phase.segments.length }} 段</span>
    </div>
    <div class="seg-grid">
      <div v-for="segment in phase.segments" :key="segment.id" class="seg-tile"
           :class="statusClass(stateOf(segment.id)?.status)" :title="`${segment.variant} × ${segment.scenario}${segment.persona ? ' × ' + segment.persona : ''}`"
           @click="openSegment(segment.id)">
        <div class="sid"><span class="st" :class="statusClass(stateOf(segment.id)?.status)"></span>{{ segment.id }}</div>
        <div class="sdesc">{{ tileDesc(segment) }}</div>
        <div class="sdesc" v-if="stateOf(segment.id)?.turns">t{{ stateOf(segment.id)!.turns!.done }}/{{ stateOf(segment.id)!.turns!.total }}</div>
      </div>
    </div>
  </div>

  <div class="phase-head" style="margin-top:18px;"><span class="name">活动流</span><span class="meta">SSE 实时</span></div>
  <div class="feed">
    <div class="row" v-for="(item, index) in [...store.activity].reverse().slice(0, 40)" :key="index">
      <span class="t">{{ item.at }}</span>
      <span class="seg">{{ item.segment ?? '' }}</span>
      <span :class="'kind-' + item.kind">{{ item.text }}</span>
    </div>
    <div class="row" v-if="!store.activity.length"><span class="t">—</span><span>暂无活动</span></div>
  </div>
</template>
