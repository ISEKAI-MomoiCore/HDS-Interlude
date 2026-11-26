<script setup lang="ts">
/**
 * P4 对比：变体交叉表（可排序）+ 在场度曲线（SVG 散点）+ 人物方差表 + 契约指纹横幅。
 * 评分列来自 active profile 的 rubric（动态）；综合分 = Σ(维度×权重)/Σ权重。
 */
import { computed, ref } from 'vue'
import { get } from '../api'
import type { Rubric } from '../store'

interface Row {
  resultId: string, cohort: string, status: 'complete' | 'failed' | 'stopped',
  segment: string, date: string, variant: string, variantLabel: string, presence: number, lang: string,
  persona: string, personaName: string, scenario: string, engineModel: string, turns: number, errorTurns: number,
  hFails: Record<string, number>, totalTokens: number,
  avgScriptLen: number, avgBubbles: number, avgSentence: number, openerRepeatPct: number,
  humanScores: Record<string, number> | null, contractHash?: string,
}

interface Cohort { id: string, profile: string, rubric: Rubric, legacy: boolean }
const data = ref<{ segments: Row[], cohorts: Cohort[] }>({ segments: [], cohorts: [] })
const selection = ref('')
const sortKey = ref('variant')
const sortAsc = ref(true)
const scatterMode = ref<'score' | 'fail'>('score')
const loaded = ref(false)
const loadError = ref('')

async function load(): Promise<void> {
  try {
    data.value = await get('/api/aggregate')
    selection.value = data.value.cohorts.find(group => !group.legacy)?.id ?? data.value.cohorts[0]?.id ?? ''
  } catch (error) {
    loadError.value = (error as Error).message
  } finally { loaded.value = true }
}
void load()

const cohort = computed(() => data.value.cohorts.find(group => group.id === selection.value))
const dimensions = computed(() => cohort.value?.rubric.dimensions ?? [])
const samples = computed(() => data.value.segments.filter(row => row.cohort === selection.value))
const complete = computed(() => samples.value.filter(row => row.status === 'complete'))
const failed = computed(() => samples.value.filter(row => row.status === 'failed'))
const stopped = computed(() => samples.value.filter(row => row.status === 'stopped'))
const errorTurns = computed(() => failed.value.reduce((sum, row) => sum + row.errorTurns, 0))

function groupBy(rows: Row[], keyOf: (row: Row) => string): Array<{ key: string, rows: Row[] }> {
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const key = keyOf(row)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }
  return [...groups].map(([key, rows]) => ({ key, rows }))
}

function overallScore(scores: Row['humanScores']): number | undefined {
  if (!scores || cohort.value?.legacy) return undefined
  let sum = 0
  let weight = 0
  for (const dim of dimensions.value) {
    if (dim.weight <= 0) continue
    const value = scores[dim.id]
    if (typeof value !== 'number') return undefined
    sum += value * dim.weight
    weight += dim.weight
  }
  if (!weight) return undefined
  return Math.round(sum / weight * 100) / 100
}

function hFailTotal(hFails: Record<string, number>): number {
  return Object.values(hFails ?? {}).reduce((sum, v) => sum + v, 0)
}

const variantRows = computed(() => {
  const rows = groupBy(samples.value, row => JSON.stringify([row.engineModel, row.variant])).map(group => {
    const list = group.rows.filter(row => row.status === 'complete')
    const avg = (pick: (row: Row) => number) => list.length ? Math.round(list.map(pick).reduce((s, v) => s + v, 0) / list.length * 100) / 100 : 0
    const scored = list.map(row => overallScore(row.humanScores)).filter(v => v !== undefined) as number[]
    const hFails: Record<string, number> = {}
    for (const row of list) for (const [id, count] of Object.entries(row.hFails ?? {})) hFails[id] = (hFails[id] ?? 0) + count
    const first = group.rows[0]
    return {
      key: group.key,
      variant: first?.variant ?? '', variantLabel: first?.variantLabel ?? '', presence: first?.presence ?? 0,
      lang: first?.lang ?? 'zh', model: first?.engineModel ?? '',
      segments: list.length,
      failed: group.rows.filter(row => row.status === 'failed').length,
      stopped: group.rows.filter(row => row.status === 'stopped').length,
      score: scored.length ? Math.round(scored.reduce((s, v) => s + v, 0) / scored.length * 100) / 100 : undefined,
      dimScores: Object.fromEntries(dimensions.value.map(dim => {
        const values = list.map(row => row.humanScores?.[dim.id]).filter(v => typeof v === 'number') as number[]
        return [dim.id, values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length * 100) / 100 : undefined]
      })),
      avgScriptLen: avg(row => row.avgScriptLen), avgBubbles: avg(row => row.avgBubbles),
      avgSentence: avg(row => row.avgSentence), openerRepeatPct: avg(row => row.openerRepeatPct),
      hFailTotal: list.reduce((sum, row) => sum + hFailTotal(row.hFails), 0),
      tokens: list.reduce((sum, row) => sum + row.totalTokens, 0),
      hFails,
    }
  })
  const key = sortKey.value
  const dir = sortAsc.value ? 1 : -1
  return rows.sort((a, b) => {
    const value = (row: typeof a) => key.startsWith('dimScores.')
      ? row.dimScores[key.slice('dimScores.'.length)] : row[key as keyof typeof row] as number | string | undefined
    const va = value(a), vb = value(b)
    if (va === undefined && vb === undefined) return 0
    if (va === undefined) return 1
    if (vb === undefined) return -1
    return va < vb ? -dir : va > vb ? dir : 0
  })
})

const personaRows = computed(() => {
  return groupBy(complete.value, row => JSON.stringify([row.persona, row.scenario])).map(group => {
    const list = group.rows
    const scored = list.map(row => overallScore(row.humanScores)).filter(v => v !== undefined) as number[]
    return {
      key: group.key,
      personaName: list[0]?.personaName ?? '', scenario: list[0]?.scenario ?? '',
      segments: list.length,
      score: scored.length ? Math.round(scored.reduce((s, v) => s + v, 0) / scored.length * 100) / 100 : undefined,
      avgScriptLen: Math.round(list.reduce((s, row) => s + row.avgScriptLen, 0) / list.length * 100) / 100,
      avgBubbles: Math.round(list.reduce((s, row) => s + row.avgBubbles, 0) / list.length * 100) / 100,
      openerRepeatPct: Math.round(list.reduce((s, row) => s + row.openerRepeatPct, 0) / list.length * 100) / 100,
      hFailTotal: list.reduce((sum, row) => sum + hFailTotal(row.hFails), 0),
    }
  }).sort((a, b) => a.scenario.localeCompare(b.scenario) || a.personaName.localeCompare(b.personaName))
})

function sortBy(key: string): void {
  if (sortKey.value === key) sortAsc.value = !sortAsc.value
  else { sortKey.value = key; sortAsc.value = true }
}

// —— SVG 在场度散点 ——
const scatterW = 460, scatterH = 240, padX = 40, padY = 26
const scatterPoints = computed(() => {
  return variantRows.value.map(row => {
    const y = scatterMode.value === 'score' ? row.score : (row.segments ? Math.round(row.hFailTotal / row.segments * 1000) / 10 : 0)
    return { variant: row.variant, presence: row.presence, y, lang: row.lang, model: row.model }
  }).filter(point => point.y !== undefined)
})
function sx(presence: number): number { return padX + (presence / 3) * (scatterW - padX * 2) }
function sy(y: number): number {
  const [min, max] = scatterMode.value === 'score' ? [1, 5] : [0, 20]
  const clamped = Math.max(min, Math.min(max, y))
  return scatterH - padY - ((clamped - min) / (max - min)) * (scatterH - padY * 2)
}
const yTicks = computed(() => scatterMode.value === 'score' ? [1, 2, 3, 4, 5] : [0, 5, 10, 15, 20])
</script>

<template>
  <h1 class="page-title">对比</h1>
  <div v-if="loadError" class="err-text">{{ loadError }}</div>
  <label v-if="data.cohorts.length" class="fld">
    <span>实验配置</span>
    <select v-model="selection">
      <option v-for="group in data.cohorts" :key="group.id" :value="group.id">
        {{ group.legacy ? '历史样本 · ' + group.id.slice('legacy/'.length) : group.profile + ' · ' + group.id.split('/')[1].slice(0, 8) }}
      </option>
    </select>
  </label>
  <p v-if="cohort" class="page-sub">{{ complete.length }} 份完整样本 · {{ failed.length }} 份失败 · {{ stopped.length }} 份已停止</p>
  <p v-if="failed.length" class="warn">失败样本包含 {{ errorTurns }} 个异常回合，可在评审页查看。</p>
  <p v-if="cohort?.legacy" class="warn">历史样本缺少评分规则快照，仅展示原始评分与指标。</p>
  <p v-if="loaded && !cohort && !loadError" class="muted">暂无评分或运行产物。</p>

  <div class="charts-row">
    <div class="chart-box">
      <div class="h">在场度曲线（x = 作者在场度 0-3，y = {{ scatterMode === 'score' ? '人工快评加权分' : '每段 H 失败数' }}）</div>
      <div class="legend" style="margin-bottom:0;">
        <span><span class="sw" style="background:var(--blue);"></span>中文叙述</span>
        <span><span class="sw" style="background:var(--yellow);"></span>英文叙述</span>
        <label class="checkbox-row" style="display:inline-flex;"><input type="radio" value="score" v-model="scatterMode" /> 快评分</label>
        <label class="checkbox-row" style="display:inline-flex;"><input type="radio" value="fail" v-model="scatterMode" /> H 失败率</label>
      </div>
      <svg :width="scatterW" :height="scatterH" v-if="loaded">
        <line v-for="tick in yTicks" :key="tick" :x1="padX" :x2="scatterW - padX"
              :y1="sy(tick)" :y2="sy(tick)" stroke="#232a34" stroke-width="1" />
        <text v-for="tick in yTicks" :key="'t' + tick" :x="padX - 8" :y="sy(tick) + 3" fill="#556170" font-size="10" text-anchor="end">{{ tick }}</text>
        <text v-for="tick in [0, 1, 2, 3]" :key="'x' + tick" :x="sx(tick)" :y="scatterH - padY + 14" fill="#556170" font-size="10" text-anchor="middle">在场度 {{ tick }}</text>
        <g v-for="point in scatterPoints" :key="point.variant + point.model" :transform="`translate(${sx(point.presence)}, ${sy(point.y!)})`">
          <circle r="6" :fill="point.lang === 'en' ? 'var(--yellow)' : 'var(--blue)'" fill-opacity="0.85" />
          <text y="-9" fill="#cdd6e0" font-size="10" text-anchor="middle" font-family="monospace">{{ point.variant }}{{ point.model ? '*' : '' }}</text>
        </g>
        <text v-if="!scatterPoints.length" :x="scatterW / 2" :y="scatterH / 2" fill="#556170" font-size="12" text-anchor="middle">暂无数据（先评审打分）</text>
      </svg>
    </div>

    <div class="chart-box">
      <div class="h">变体汇总（{{ variantRows.length }} 组 · 评分缺失显示 —）</div>
      <div style="max-height:300px; overflow:auto;">
        <table class="grid">
          <thead><tr>
            <th>变体</th><th class="num">在场</th><th class="num">完整 / 失败 / 已停止</th>
            <th class="num sortable" v-for="dim in dimensions" :key="dim.id" @click="sortBy('dimScores.' + dim.id)" :title="dim.label">{{ dim.label }}</th>
            <th class="num sortable" @click="sortBy('score')">加权</th>
            <th class="num sortable" @click="sortBy('avgScriptLen')">剧长</th><th class="num sortable" @click="sortBy('avgBubbles')">分泡</th>
            <th class="num sortable" @click="sortBy('openerRepeatPct')">重复%</th>
            <th class="num sortable" @click="sortBy('hFailTotal')">H✗</th><th class="num sortable" @click="sortBy('tokens')">tokens</th>
          </tr></thead>
          <tbody>
            <tr v-for="row in variantRows" :key="row.key">
              <td><b>{{ row.variant }}</b><span class="muted" v-if="row.model"> · {{ row.model }}</span></td>
              <td class="num">{{ row.presence }}</td>
              <td class="num">{{ row.segments }} / {{ row.failed }} / {{ row.stopped }}</td>
              <td class="num" v-for="dim in dimensions" :key="dim.id">{{ (row.dimScores as any)[dim.id] ?? '—' }}</td>
              <td class="num">{{ row.score ?? '—' }}</td>
              <td class="num">{{ row.segments ? row.avgScriptLen : '—' }}</td>
              <td class="num">{{ row.segments ? row.avgBubbles : '—' }}</td>
              <td class="num">{{ row.segments ? row.openerRepeatPct + '%' : '—' }}</td>
              <td class="num"><span class="hflag" v-if="row.hFailTotal">{{ row.hFailTotal }}</span><span v-else class="ok-text">0</span></td>
              <td class="num">{{ row.tokens.toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="chart-box">
    <div class="h">人物方差（同一场景下人物间差异）</div>
    <table class="grid">
      <thead><tr>
        <th>人物</th><th>场景</th><th class="num">段数</th><th class="num">加权分</th>
        <th class="num">剧长</th><th class="num">分泡</th><th class="num">重复%</th><th class="num">H✗</th>
      </tr></thead>
      <tbody>
        <tr v-for="row in personaRows" :key="row.key">
          <td><b>{{ row.personaName }}</b></td>
          <td>{{ row.scenario }}</td>
          <td class="num">{{ row.segments }}</td>
          <td class="num">{{ row.score ?? '—' }}</td>
          <td class="num">{{ row.avgScriptLen }}</td>
          <td class="num">{{ row.avgBubbles }}</td>
          <td class="num">{{ row.openerRepeatPct }}%</td>
          <td class="num"><span class="hflag" v-if="row.hFailTotal">{{ row.hFailTotal }}</span><span v-else class="ok-text">0</span></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
