<script setup lang="ts">
/**
 * P3 评审器：三列布局（段列表 / transcript / 打分面板）。
 * 评分维度与标记键采用样本的评分规则。
 * 键盘流：J/K 逐轮、标记键、S 保存。盲评模式隐藏变体名。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { get, post } from '../api'
import type { Rubric } from '../store'

interface Manifest {
  segment: string
  variant: { id: string, label: string, presence: number, lang: string }
  arm?: { id: string, label: string }   // 旧 manifest 兼容
  scenario: { id: string, label: string }
  persona?: { id: string, characterName: string, label: string }
  provider?: { model: string }
  engine?: { model: string }
  hFails: Record<string, number>
  rubric?: Rubric
}
interface TurnRecord {
  seq: number, kind: 'user' | 'advance', atLocal: string, userMessage?: string,
  parsed?: { script?: string, seen?: boolean, replyMode?: string, replyContent?: string, replySendAt?: string },
  checks?: Array<{ id: string, verdict: string, detail?: string }>,
  error?: string
  parseError?: string
}
interface ScoreFile {
  scores: Record<string, number>
  flags: Record<string, Array<{ turn: number, note?: string }>>
  note?: string
}

const route = useRoute()
interface ReviewRow {
  resultId: string, segment: string, date: string, profile: string, scenario: string, variant: string, engineModel: string,
  startedAt?: string, status: 'complete' | 'failed' | 'stopped', humanScores: Record<string, number> | null
}
const agg = ref<{ segments: ReviewRow[] }>({ segments: [] })
const rubric = ref<Rubric | null>(null)
let loadRequest = 0
const current = ref('')
const manifest = ref<Manifest | null>(null)
const turns = ref<TurnRecord[]>([])
const blind = ref(false)
const hideScored = ref(false)
const currentTurn = ref(1)
const loading = ref(false)
const savedAt = ref('')
const viewError = ref('')
const saving = ref(false)
const reviewing = computed(() => !loading.value && Boolean(current.value))

const scores = reactive<Record<string, number | undefined>>({})
const flags = reactive<Record<string, Array<{ turn: number, note?: string }>>>({})
const note = ref('')
const gatePack = ref('')
const gateCopied = ref(false)

async function loadGatePack(): Promise<void> {
  if (!reviewing.value) return
  const id = current.value
  gateCopied.value = false
  try {
    const data = await get<{ text?: string, error?: string }>(`/api/gate/${encodeURIComponent(id)}`)
    if (id === current.value && reviewing.value) gatePack.value = data.text ?? `（${data.error ?? '无产物'}）`
  } catch (error) {
    if (id === current.value && reviewing.value) gatePack.value = `（${(error as Error).message}）`
  }
}

const dimensions = computed(() => rubric.value?.dimensions ?? [])
const flagDefs = computed(() => rubric.value?.flags ?? [])

const segList = computed(() => {
  const rows = agg.value.segments
  if (!hideScored.value) return rows
  return rows.filter(row => !row.humanScores)
})

function scoreText(row: ReviewRow): string {
  const s = row.humanScores as Record<string, number> | null
  if (!s || !Object.keys(s).length) return '未评分'
  return Object.values(s).join('/')
}

async function loadList(): Promise<void> {
  try { agg.value = await get('/api/aggregate') } catch (error) { viewError.value = (error as Error).message }
}

async function loadSegment(id: string): Promise<void> {
  const request = ++loadRequest
  loading.value = true
  viewError.value = ''
  gatePack.value = ''
  gateCopied.value = false
  try {
    const data = await get<{ manifest: Manifest, rubric: Rubric, turns: TurnRecord[], scores?: ScoreFile }>(`/api/segment/${encodeURIComponent(id)}`)
    if (request !== loadRequest) return
    rubric.value = data.rubric
    current.value = id
    manifest.value = data.manifest
    turns.value = data.turns
    currentTurn.value = data.turns[0]?.seq ?? 0
    const loaded = data.scores ?? { scores: {}, flags: {}, note: undefined }
    for (const key of Object.keys(scores)) delete scores[key]
    for (const [key, value] of Object.entries(loaded.scores ?? {})) scores[key] = value
    for (const key of Object.keys(flags)) delete flags[key]
    for (const [key, value] of Object.entries(loaded.flags ?? {})) flags[key] = value
    const legacy = loaded as unknown as { breaks?: Array<{ turn: number }>, gems?: Array<{ turn: number }> }
    for (const flag of flagDefs.value) {
      const items = loaded.flags?.[flag.id]
        ?? (flag.id === 'break' ? legacy.breaks : flag.id === 'gem' ? legacy.gems : [])
      flags[flag.id] = [...(items ?? [])]
    }
    note.value = loaded.note ?? ''
    savedAt.value = ''
  } catch (error) {
    if (request === loadRequest) viewError.value = (error as Error).message
  } finally {
    if (request === loadRequest) loading.value = false
  }
}

async function save(): Promise<void> {
  if (!reviewing.value || saving.value) return
  const id = current.value
  const cleanScores: Record<string, number> = {}
  for (const [key, value] of Object.entries(scores)) if (typeof value === 'number') cleanScores[key] = value
  saving.value = true
  try {
    await post('/api/score', { resultId: id, scores: cleanScores, flags, note: note.value || undefined })
    if (id === current.value) savedAt.value = `已保存 ${new Date().toLocaleTimeString()}`
    await loadList()
  } catch (error) {
    viewError.value = (error as Error).message
  } finally {
    saving.value = false
  }
}

function setScore(dimId: string, value: number): void {
  if (!reviewing.value) return
  scores[dimId] = scores[dimId] === value ? undefined : value
}

function toggleFlag(flagId: string, turn = currentTurn.value): void {
  if (!reviewing.value || !turn) return
  const list = flags[flagId] ?? (flags[flagId] = [])
  const existing = list.findIndex(item => item.turn === turn)
  if (existing >= 0) { list.splice(existing, 1); return }
  list.push({ turn })
}

// —— 键盘流（标记键来自 rubric.flags.hotkey） ——
function onKey(event: KeyboardEvent): void {
  if ((event.target as HTMLElement).tagName === 'TEXTAREA' || (event.target as HTMLElement).tagName === 'INPUT') return
  if (!current.value) return
  if (event.key === 'j' || event.key === 'J') currentTurn.value = Math.min(turns.value.length, currentTurn.value + 1)
  else if (event.key === 'k' || event.key === 'K') currentTurn.value = Math.max(1, currentTurn.value - 1)
  else if (event.key === 's' || event.key === 'S') void save()
  else {
    const flag = flagDefs.value.find(item => item.hotkey.toLowerCase() === event.key.toLowerCase())
    if (flag) toggleFlag(flag.id)
  }
}
function openLinkedResult(): void {
  const id = route.query.result
  if (typeof id === 'string') { void loadSegment(id); return }
  const segment = route.query.seg
  if (typeof segment === 'string') {
    const profile = route.query.profile
    const matches = agg.value.segments.filter(row => row.segment === segment && (!profile || row.profile === profile))
    if (matches.length === 1) void loadSegment(matches[0].resultId)
    else viewError.value = matches.length ? `${segment} 有 ${matches.length} 份样本，请从列表选择。` : `${segment} 暂无样本。`
  } else if (segList.value.length) void loadSegment(segList.value[0].resultId)
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  await loadList()
  openLinkedResult()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
watch(() => [route.query.result, route.query.seg, route.query.profile], openLinkedResult)

async function copyGatePack(): Promise<void> {
  try {
    await navigator.clipboard.writeText(gatePack.value)
    gateCopied.value = true
  } catch (error) {
    viewError.value = (error as Error).message
  }
}

function bubbles(content?: string): string[] {
  return content ? content.split('<sep/>').filter(Boolean) : []
}
function flagChips(turn: TurnRecord): Array<{ id: string, verdict: string, detail?: string }> {
  return (turn.checks ?? []).filter(check => check.verdict === 'fail' || check.verdict === 'flag')
}
function isFlagged(flagId: string, seq: number): boolean {
  return (flags[flagId] ?? []).some(item => item.turn === seq)
}
function variantTitle(m: Manifest): string {
  const v = m.variant ?? m.arm
  return v ? `${v.id} · ${v.label}` : '▓▓▓'
}
function proseScroll(seq: number): void {
  currentTurn.value = seq
  const el = document.getElementById(`turn-${seq}`)
  el?.scrollIntoView({ block: 'center' })
}
</script>

<template>
  <h1 class="page-title">评审 <span class="muted" v-if="manifest">— {{ manifest.scenario.label }}</span></h1>
  <p class="page-sub">
    J/K 逐轮 · <template v-for="flag in flagDefs" :key="flag.id">{{ flag.hotkey.toUpperCase() }} {{ flag.label }} · </template>S 保存
    <label class="checkbox-row" style="display:inline-flex; margin-left:14px;"><input type="checkbox" v-model="blind" /> 盲评</label>
    <label class="checkbox-row" style="display:inline-flex;"><input type="checkbox" v-model="hideScored" /> 只看待评</label>
  </p>

  <p v-if="viewError" class="err-text">{{ viewError }}</p>
  <div class="review-layout" :aria-busy="loading">
    <div class="review-seglist">
      <div v-for="(row, index) in segList" :key="row.resultId" class="item"
           :class="{ active: row.resultId === current }" @click="loadSegment(row.resultId)">
        <div>
          <b>{{ blind ? '样本 ' + (index + 1) : row.segment }}</b> <span class="muted">{{ blind ? row.scenario : row.variant + ' · ' + row.scenario }}</span>
          <div v-if="!blind" class="muted">{{ row.startedAt ? new Date(row.startedAt).toLocaleString() : row.date }} · {{ row.engineModel }}</div>
          <span v-if="row.status !== 'complete'" class="warn">{{ row.status === 'stopped' ? '已停止' : '有失败回合' }}</span>
        </div>
        <div class="score">{{ scoreText(row) }} <span v-if="row.humanScores">✓</span></div>
      </div>
      <div v-if="!segList.length" class="muted" style="padding:8px;">暂无已完成的段（先运行）</div>
    </div>

    <div class="review-center">
      <div v-if="manifest && !blind" class="muted" style="margin-bottom:8px;">
        {{ variantTitle(manifest) }}（在场度 {{ manifest.variant?.presence ?? '?' }}，{{ manifest.variant?.lang === 'en' ? '英文叙述' : '中文叙述' }}）
        · 人物 {{ manifest.persona?.characterName ?? '林晚' }} · {{ manifest.engine?.model ?? manifest.provider?.model }}
        · H: <span class="hflag">{{ JSON.stringify(manifest.hFails) }}</span>
      </div>
      <div v-else-if="manifest && blind" class="muted" style="margin-bottom:8px;">
        盲评模式 · 人物 {{ manifest.persona?.characterName ?? '林晚' }} · {{ turns.length }} 轮
      </div>

      <div v-for="turn in turns" :key="turn.seq" :id="`turn-${turn.seq}`"
           class="turn-card" :class="{ current: turn.seq === currentTurn }" @click="proseScroll(turn.seq)">
        <div class="turn-head">
          <span class="t-time">{{ turn.atLocal }}</span>
          <span>#{{ turn.seq }}</span>
          <span v-if="turn.kind === 'advance'">（advance 相位）</span>
          <template v-for="flag in flagDefs" :key="flag.id">
            <span v-if="isFlagged(flag.id, turn.seq)" style="color:var(--yellow);">{{ flag.label }}</span>
          </template>
        </div>
        <div class="turn-user" v-if="turn.userMessage"><span class="bubble">{{ turn.userMessage }}</span></div>
        <div class="turn-reply" v-if="turn.parsed?.replyMode === 'none'"><span class="mode">none</span><span class="muted">（未回复）</span></div>
        <div class="turn-reply" v-else-if="turn.parsed?.replyMode === 'delayed'">
          <span class="mode">delayed→{{ turn.parsed?.replySendAt }}</span>
          <span v-for="(b, i) in bubbles(turn.parsed?.replyContent)" :key="i" class="bubble">{{ b }}</span>
        </div>
        <div class="turn-reply" v-else-if="turn.parsed?.replyContent">
          <span class="mode">immediate</span>
          <span v-for="(b, i) in bubbles(turn.parsed?.replyContent)" :key="i" class="bubble">{{ b }}</span>
        </div>
        <div class="turn-reply" v-else-if="turn.error || turn.parseError"><span class="err-text">回合错误：{{ turn.error || turn.parseError }}</span></div>
        <div class="turn-prose" v-if="turn.parsed?.script">
          <details><summary>剧本 {{ turn.parsed.script.length }} 字</summary>
            <div class="prose-text">{{ turn.parsed.script }}</div>
          </details>
        </div>
        <div class="turn-flags" v-if="flagChips(turn).length">
          <span v-for="flag in flagChips(turn)" :key="flag.id" class="hchip" :class="flag.verdict"
                :title="flag.detail">{{ flag.id }}{{ flag.verdict === 'fail' ? '✗' : '?' }}</span>
        </div>
      </div>
      <div v-if="!turns.length && !loading" class="muted">选择左侧已完成的段</div>
    </div>

    <div class="review-panel">
      <div class="h">快评<span v-if="manifest && !manifest.rubric" class="muted"> · 历史参考规则</span></div>
      <div class="score-row" v-for="dim in dimensions" :key="dim.id">
        <span class="lbl" :title="JSON.stringify(dim.anchors)">{{ dim.label }}</span>
        <button v-for="v in [1, 2, 3, 4, 5]" :key="v" :class="{ on: scores[dim.id] === v }" @click="setScore(dim.id, v)">{{ v }}</button>
      </div>
      <div class="panel-sec">
        <div class="h">标记（点当前轮；快捷键见顶部）</div>
        <template v-for="flag in flagDefs" :key="flag.id">
          <div class="flag-item" v-for="item in flags[flag.id] ?? []" :key="flag.id + item.turn">
            <b>t{{ item.turn }}</b> {{ flag.label }}
            <button class="small" @click="toggleFlag(flag.id, item.turn)" style="float:right;">删</button>
          </div>
        </template>
        <div class="flag-item" v-if="!flagDefs.some(flag => (flags[flag.id] ?? []).length)">无</div>
      </div>
      <div class="panel-sec">
        <div class="h">总备注</div>
        <textarea v-model="note" rows="3" placeholder="一句话结论（可选）"></textarea>
      </div>
      <div class="panel-sec">
        <button class="primary" style="width:100%;" :disabled="!reviewing || saving" @click="save()">保存（S）</button>
        <div class="muted" style="margin-top:6px;">{{ savedAt }}</div>
      </div>
      <div class="panel-sec">
        <div class="h">一审任务包（rubric.gate 驱动；贴给子代理）</div>
        <button class="small" :disabled="!reviewing" @click="loadGatePack()">生成</button>
        <div v-if="gatePack" style="margin-top:6px;">
          <textarea :value="gatePack" rows="6" readonly style="font-size:10px;"></textarea>
          <button class="small" @click="copyGatePack">复制</button>
          <span v-if="gateCopied" class="ok-text" style="font-size:11px;">已复制</span>
        </div>
      </div>
    </div>
  </div>
</template>
