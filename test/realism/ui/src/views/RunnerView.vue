<script setup lang="ts">
/**
 * P2 运行：环境自检 + 段选择（勾选子集）+ 队列控制 + run 级模型覆盖。
 */
import { computed, reactive, ref, watch } from 'vue'
import { store, stateOf, refreshState } from '../store'
import { post } from '../api'

const selection = reactive(new Set<string>())
const dry = ref(false)
const concurrency = ref(1)
const overrideModel = ref('')
const overrideEndpoint = ref('')
const overrideKey = ref('')
const force = ref(false)
const submitting = ref(false)
const runInfo = ref('')
const testResult = ref<{ ok?: boolean, latencyMs?: number, endpointHost?: string, model?: string, error?: string, loading?: boolean }>({})
const runError = ref('')

const phases = computed(() => store.phases)
watch(() => store.activeProfile, () => { selection.clear(); runInfo.value = ''; testResult.value = {} })

function toggle(id: string): void {
  if (selection.has(id)) selection.delete(id)
  else selection.add(id)
}
function selectPhase(key: string, on: boolean): void {
  const phase = store.phases.find(item => item.key === key)
  for (const segment of phase?.segments ?? []) {
    if (on) selection.add(segment.id)
    else selection.delete(segment.id)
  }
}
const selectedCount = computed(() => selection.size)

function runSelection() {
  const model = overrideModel.value.trim()
  const endpoint = overrideEndpoint.value.trim()
  const apiKey = overrideKey.value.trim()
  return { segments: selection.size ? [...selection] : undefined, overrides: { model, endpoint, apiKey } }
}

async function run(): Promise<void> {
  runError.value = ''
  runInfo.value = ''
  submitting.value = true
  try {
    const result = await post<{ queued: number, reused: number }>('/api/run', {
      ...runSelection(), dry: dry.value, concurrency: concurrency.value, force: force.value,
    })
    runInfo.value = `入队 ${result.queued} 段 · 复用 ${result.reused} 段`
    await refreshState()
  } catch (error) {
    runError.value = (error as Error).message
  } finally {
    submitting.value = false
  }
}
async function stop(): Promise<void> {
  runError.value = ''
  try { await post('/api/stop') } catch (error) { runError.value = (error as Error).message }
}

async function testConnection(): Promise<void> {
  testResult.value = { loading: true }
  try { testResult.value = await post('/api/test', runSelection()) } catch (error) {
    testResult.value = { ok: false, error: (error as Error).message }
  }
}
</script>

<template>
  <h1 class="page-title">运行 <span class="muted" style="font-size:12px;">profile={{ store.activeProfile }}</span></h1>
  <p class="page-sub">环境自检、勾选段子集、run 级模型覆盖（优先级：run 覆盖 &gt; 变体 &gt; profile &gt; env）。</p>

  <div class="kpis">
    <div class="kpi"><div class="k">端点</div><div class="v"><small>{{ store.env.endpointHost || '未配置' }}</small></div></div>
    <div class="kpi"><div class="k">模型</div><div class="v"><small>{{ store.env.model || '未配置' }}</small></div></div>
    <div class="kpi"><div class="k">协议</div><div class="v"><small>{{ store.env.protocol }}</small></div></div>
    <div class="kpi"><div class="k">环境</div><div class="v"><small v-if="store.env.missing.length" class="warn">缺 {{ store.env.missing.join(', ') }}</small><small v-else class="ok-text">就绪</small></div></div>
    <div class="kpi"><div class="k">连接测试</div><div class="v">
      <button class="small" @click="testConnection">ping</button>
      <small v-if="testResult.loading">…</small>
      <small v-else-if="testResult.ok" class="ok-text">{{ testResult.latencyMs }}ms · {{ testResult.endpointHost }} · {{ testResult.model }}</small>
      <small v-else-if="testResult.error" class="err-text">{{ testResult.error.slice(0, 60) }}</small>
    </div></div>
  </div>

  <div style="display:flex; gap:10px; align-items:center; margin-bottom: 10px; flex-wrap: wrap;">
    <label class="fld" style="margin:0;"><span>run 级模型覆盖（可空）</span>
      <input type="text" v-model="overrideModel" placeholder="如 gemini-2.5-flash；空 = 按变体/profile 链" style="width:260px;" /></label>
    <label class="fld" style="margin:0;"><span>run 级端点覆盖（可空）</span>
      <input type="text" v-model="overrideEndpoint" placeholder="完整地址；空 = 按链" style="width:260px;" /></label>
    <label class="fld" style="margin:0;"><span>本次 API Key（跨来源端点必填）</span>
      <input type="password" v-model="overrideKey" autocomplete="off" /></label>
  </div>
  <div style="display:flex; gap:10px; align-items:center; margin-bottom: 16px; flex-wrap: wrap;">
    <label class="checkbox-row"><input type="checkbox" v-model="dry" /> dry 模式（组装不请求）</label>
    <label class="checkbox-row"><input type="checkbox" v-model="force" :disabled="dry" /> 强制重跑</label>
    <label class="checkbox-row">并发
      <select v-model.number="concurrency" style="width:60px;">
        <option :value="1">1</option><option :value="2">2</option><option :value="3">3</option>
      </select>
    </label>
    <button class="primary" :disabled="store.campaign.running || submitting" @click="run()">▶ 启动（{{ selectedCount || '全部' }} 段）</button>
    <button class="danger" :disabled="!store.campaign.running" @click="stop()">⏹ 停止</button>
    <span v-if="runError" class="err-text">{{ runError }}</span>
    <span v-else-if="runInfo" class="muted">{{ runInfo }}</span>
  </div>

  <div v-for="phase in phases" :key="phase.key" class="phase-block">
    <div class="phase-head">
      <span class="name">{{ phase.name }}</span>
      <span class="meta">
        <button class="small" @click="selectPhase(phase.key, true)">全选</button>
        <button class="small" @click="selectPhase(phase.key, false)">清空</button>
      </span>
    </div>
    <div class="seg-grid">
      <div v-for="segment in phase.segments" :key="segment.id"
           class="seg-tile" :class="stateOf(segment.id) ? 'st-' + stateOf(segment.id)?.status : ''"
           :style="selection.has(segment.id) ? 'border-color: var(--blue); background: #12212e;' : ''"
           @click="toggle(segment.id)">
        <div class="sid">{{ selection.has(segment.id) ? '☑' : '☐' }} {{ segment.id }}</div>
        <div class="sdesc">{{ segment.variant }}×{{ segment.scenario }}{{ segment.persona ? '·' + segment.persona : '' }}</div>
        <div class="sdesc" v-if="stateOf(segment.id)?.turns">t{{ stateOf(segment.id)!.turns!.done }}/{{ stateOf(segment.id)!.turns!.total }} <span v-if="stateOf(segment.id)?.status === 'reused'">· 已复用</span></div>
        <div class="err-text" v-if="stateOf(segment.id)?.error">{{ stateOf(segment.id)?.error }}</div>
      </div>
    </div>
  </div>
</template>
