<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { store, type CommunicationActionDetailView, type CommunicationActionRowView } from '../store'
import DataRow from '../components/DataRow.vue'

defineOptions({ name: 'ActionsPage' })

const rows = ref<CommunicationActionRowView[]>([])
const total = ref(0)
const cursor = ref<string | undefined>(undefined)
const loading = ref(false)
const error = ref('')
const feedback = ref('')
const selectedId = ref('')
const detail = ref<CommunicationActionDetailView | null>(null)
const detailLoading = ref(false)
const operating = ref(false)
let disposed = false
let listRequest = 0
let detailRequest = 0

const KIND_LABELS: Record<string, string> = { action: '当前动作', plan: '人物计划', 'fixed-delay': '确定延迟' }
const STATUS_LABELS: Record<string, string> = {
  pending: '待执行', delivered: '已送达', partial: '部分送达', failed: '失败', cancelled: '已取消',
  unknown: '待核实', 'pending-plan': '计划待处理',
}

const cancellable = computed(() => {
  if (!detail.value) return false
  if (detail.value.kind !== 'action') return true
  return detail.value.segments.some(segment => segment.status === 'pending' || segment.status === 'unknown')
})
const verifiable = computed(() => !!detail.value?.segments.some(segment => segment.status === 'unknown'))

const REASONS: Record<string, string> = {
  'plan-cancelled': '计划已取消',
  'segments-cancelled': '分段已取消',
  'nothing-pending': '没有待取消的分段',
  'nothing-unknown': '没有待核实的分段',
  'verified-delivered': '已核实为送达',
  'verified-not-sent': '已核实为未发送',
  'already-cancelled': '已是取消状态',
  'already-completed': '已完成，无需取消',
  'not-found': '记录已移除或不存在',
  'no-story': '没有活跃故事',
}
const DELIVERY_REASONS: Record<string, string> = {
  'console-cancel': '管理员取消后续',
  'manual-verified-delivered': '管理员已核实送达',
  'manual-verified-not-sent': '管理员已核实未发送',
  'policy-daily-cap': '滚动 24 小时额度已满',
  'policy-run-interval': '尚在最短运行间隔内',
  'policy-deferral-expired': '延期已超过有效期',
  'delivery-target-unavailable': '投递目标当前不可用',
  'delivery-source-unavailable': '消息来源当前不可用',
  'endpoint-registry-unavailable': '通信端点登记当前不可用',
  'delivery-generation-obsolete': '任务已由较新的运行状态接替',
  'delivery-unconfirmed-retry-scheduled': '投递尚未确认，已安排重试',
  'group-not-allowed': '当前群聊未获发送许可',
}
function reasonText(reason: string) { return DELIVERY_REASONS[reason] ? `${DELIVERY_REASONS[reason]}（${reason}）` : reason }
async function operate(action: () => Promise<{ ok: boolean, changed: number, reason: string }>) {
  if (operating.value) return
  const id = selectedId.value
  operating.value = true
  feedback.value = ''
  error.value = ''
  try {
    const result = await action()
    if (disposed) return
    if (!result.ok) throw new Error(REASONS[result.reason] ?? result.reason ?? '操作失败')
    feedback.value = REASONS[result.reason] ?? (result.changed ? '操作已完成。' : '状态已经更新，本次无需变更。')
    if (result.changed > 0) {
      await load(true)
      if (!disposed && selectedId.value === id) await fetchDetail(id)
    }
  } catch (caught) {
    if (!disposed) error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    if (!disposed) operating.value = false
  }
}

async function fetchDetail(id: string) {
  error.value = ''
  const request = ++detailRequest
  detailLoading.value = true
  detail.value = null
  try {
    const fresh = await store.actionDetail(id)
    if (disposed || request !== detailRequest || selectedId.value !== id) return
    if (!fresh) throw new Error('该动作已不在当前记录中，请刷新列表。')
    detail.value = fresh
  } catch (caught) {
    if (!disposed && request === detailRequest) error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    if (!disposed && request === detailRequest) detailLoading.value = false
  }
}

async function load(reset = true) {
  const request = ++listRequest
  loading.value = true
  error.value = ''
  try {
    const result = await store.actionsList(reset ? undefined : cursor.value)
    if (!result) throw new Error('Console 连接尚未就绪')
    if (disposed || request !== listRequest) return
    rows.value = reset ? result.rows : [...rows.value, ...result.rows]
    total.value = result.total
    cursor.value = result.cursor
    if (reset && selectedId.value && !rows.value.some(row => row.id === selectedId.value)) { selectedId.value = ''; detail.value = null; detailRequest++; detailLoading.value = false }
  } catch (caught) {
    if (!disposed && request === listRequest) error.value = String(caught)
  } finally {
    if (!disposed && request === listRequest) loading.value = false
  }
}

async function openDetail(id: string) {
  if (operating.value) return
  error.value = ''
  feedback.value = ''
  if (selectedId.value === id) { selectedId.value = ''; detail.value = null; detailRequest++; detailLoading.value = false; return }
  selectedId.value = id
  await fetchDetail(id)
}

function when(value: string | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

onMounted(() => void load())
onUnmounted(() => { disposed = true; listRequest++; detailRequest++ })
</script>

<template>
  <div>
    <div class="pg-head">
      <div>
        <h2>通信动作</h2>
        <div class="sub">查看作者动作、投递结果与未来计划；管理员可取消后续分段或核实未知回执。当前窗口共 {{ total }} 条。</div>
      </div>
      <button class="refresh" :disabled="loading" @click="load(true)">刷新</button>
    </div>
    <div v-if="error" class="error" role="alert">{{ error }}</div>
    <div v-if="feedback" class="notice" role="status">{{ feedback }}</div>
    <div v-if="loading && !rows.length" class="empty">正在读取通信动作…</div>
    <div v-if="!loading && !rows.length && !error" class="empty">暂无动作记录。</div>
    <div class="list">
      <div v-for="row in rows" :key="row.id" class="row" :class="{ open: selectedId === row.id }">
        <button type="button" class="row-main" :aria-expanded="selectedId === row.id" :disabled="operating" @click="openDetail(row.id)">
          <span class="kind" :data-kind="row.kind">{{ KIND_LABELS[row.kind] ?? row.kind }}</span>
          <span class="target">{{ row.target }}</span>
          <span class="head">{{ row.head }}</span>
          <span class="status" :data-status="row.status">{{ STATUS_LABELS[row.status] ?? row.status }}<template v-if="row.segmentCount">（{{ row.deliveredCount }}/{{ row.segmentCount }}）</template></span>
          <span class="time">{{ when(row.updatedAt) }}</span>
        </button>
        <div v-if="selectedId === row.id" class="detail">
          <div v-if="detailLoading">读取中…</div>
          <template v-else-if="detail">
            <DataRow label="动作" :value="detail.id" />
            <DataRow label="渠道" :value="detail.channel === 'group' ? '群聊' : '私聊'" />
            <DataRow v-if="detail.dueAt" label="到期" :value="when(detail.dueAt)" />
            <DataRow v-if="detail.expiresAt" label="失效" :value="when(detail.expiresAt)" />
            <DataRow v-if="detail.reason" label="原因" :value="reasonText(detail.reason)" />
            <DataRow v-if="detail.segments.length" label="分段"
              :value="detail.segments.map(segment => `第 ${segment.index + 1} 段：${STATUS_LABELS[segment.status] ?? segment.status}${segment.reason ? `（${reasonText(segment.reason)}）` : ''}`).join('；') || '—'" />
            <div v-if="detail.quote" class="quote">原文：{{ detail.quote }}</div>
            <div v-if="cancellable || verifiable" class="ops">
              <p v-if="verifiable" class="verify-hint">根据平台实际记录核实；确认送达后，该结果会作为后续写作依据。</p>
              <button v-if="cancellable" :disabled="operating" @click="operate(() => store.cancelAction(detail!.id))">{{ operating ? '处理中…' : '取消后续' }}</button>
              <button v-if="verifiable" :disabled="operating" class="ok" @click="operate(() => store.verifyAction(detail!.id, 'delivered'))">核实已送达</button>
              <button v-if="verifiable" :disabled="operating" @click="operate(() => store.verifyAction(detail!.id, 'not-sent'))">核实未发送</button>
            </div>
          </template>
          <button v-else class="refresh" @click="fetchDetail(row.id)">重试读取详情</button>
        </div>
      </div>
    </div>
    <button v-if="cursor" class="more" :disabled="loading" @click="load(false)">
      {{ loading ? '读取中…' : '加载更多' }}
    </button>
  </div>
</template>

<style scoped>
.pg-head { margin-bottom: 1rem; display: flex; align-items: flex-end; justify-content: space-between; }
.pg-head h2 { font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
.pg-head h2::before { content: ""; width: 10px; height: 10px; background: var(--fg3, #3b82f6); transform: rotate(45deg); }
.sub { opacity: .55; font-size: 12.5px; padding-left: 20px; }
.refresh, .more { background: none; border: 1px solid var(--bg3, rgba(128,128,128,.25)); color: inherit; padding: 4px 12px; cursor: pointer; }
.refresh:disabled, .more:disabled { opacity: .5; cursor: default; }
.error { color: #f87171; padding: 8px 0; }
.empty { opacity: .5; padding: 16px 0; }
.list { display: flex; flex-direction: column; gap: 6px; }
.row { background: var(--bg1, rgba(128,128,128,.05)); border: 1px solid var(--bg3, rgba(128,128,128,.15)); }
.row.open { border-left: 2.5px solid var(--fg3, #3b82f6); }
.row-main { display: grid; grid-template-columns: 72px 110px 1fr 150px 150px; gap: 10px; align-items: center; width: 100%; background: none; border: none; color: inherit; text-align: left; padding: 9px 12px; cursor: pointer; font-size: 13px; }
.kind { font-size: 11px; opacity: .75; }
.kind[data-kind='plan'] { color: #f59e0b; }
.kind[data-kind='fixed-delay'] { color: #38bdf8; }
.target { opacity: .8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head { opacity: .9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status[data-status='delivered'] { color: #34d399; }
.status[data-status='unknown'] { color: #fbbf24; }
.status[data-status='failed'] { color: #f87171; }
.time { opacity: .5; font-size: 12px; text-align: right; }
.detail { border-top: 1px dashed var(--bg3, rgba(128,128,128,.2)); padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }
.quote { opacity: .65; font-size: 12px; line-height: 1.6; }
.verify-hint { flex-basis: 100%; margin: 0; font-size: 12px; opacity: .8; }
.ops { flex-wrap: wrap; display: flex; gap: 8px; padding-top: 4px; }
.ops button { background: none; border: 1px solid var(--bg3, rgba(128,128,128,.25)); color: inherit; padding: 4px 12px; cursor: pointer; font-size: 12.5px; }
.ops button.ok { border-color: #34d39988; color: #34d399; }
.ops button:disabled { opacity: .5; cursor: default; }
.more { margin-top: 10px; }
</style>
