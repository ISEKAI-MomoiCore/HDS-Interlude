/**
 * 全局状态：/api/state 轮询 + SSE 活动流 + active profile。
 */
import { reactive } from 'vue'
import { connectEvents, get, type EventItem } from './api'

export interface MatrixSegment { id: string, variant: string, scenario: string, persona?: string | null, optional?: boolean }
export interface MatrixPhase { key: string, name: string, segments: MatrixSegment[] }
export interface SegmentState {
  id: string, variant: string, scenario: string, persona?: string,
  status: 'pending' | 'running' | 'done' | 'error' | 'stopped' | 'reused',
  resultId?: string
  turns?: { done: number, total: number }, hFails?: Record<string, number>,
  totalTokens?: number, error?: string
}

export interface RubricDimension { id: string, label: string, weight: number, anchors: Record<string, string> }
export interface RubricFlag { id: string, label: string, hotkey: string }
export interface Rubric { dimensions: RubricDimension[], flags: RubricFlag[], gate: { scope: 'action-only', rules: string } }

export const store = reactive({
  loaded: false,
  profiles: [] as string[],
  activeProfile: 'round1',
  profileMeta: { name: '', title: '', variants: 0, personas: 0, scenarios: 0 },
  env: { model: '', endpointHost: '', protocol: 'chat-completions', samplingOff: false, missing: [] as string[] },
  campaign: { profile: '', running: false, current: '', states: [] as SegmentState[] },
  phases: [] as MatrixPhase[],
  rubric: { dimensions: [], flags: [], gate: { scope: 'action-only', rules: '' } } as Rubric,
  uiBuilt: true,
  contractFingerprint: { systemHash: '' },
  activity: [] as EventItem[],
})

let stateTimer: ReturnType<typeof setInterval> | undefined
let lastStateJson = ''
let stateRequest = 0

export async function refreshState(): Promise<void> {
  const request = ++stateRequest
  const data = await get('/api/state')
  if (request !== stateRequest) return
  // 状态未变化时跳过赋值：轮询引发的空闲重渲染会替换 DOM 节点，
  // 与快速点击（打分/标记）产生竞态。
  const json = JSON.stringify(data)
  if (json === lastStateJson) { store.loaded = true; return }
  lastStateJson = json
  store.profiles = data.profiles
  store.activeProfile = data.activeProfile
  store.profileMeta = data.profileMeta
  store.env = data.env
  store.campaign = data.campaign
  store.phases = data.matrix?.phases ?? []
  store.rubric = data.rubric
  store.uiBuilt = data.uiBuilt
  store.contractFingerprint = data.contractFingerprint
  store.loaded = true
}

export function startPolling(): void {
  if (stateTimer) return
  stateTimer = setInterval(() => { void refreshState().catch(() => { /* 服务暂不可达时保留旧状态 */ }) }, 2000)
  connectEvents(item => {
    store.activity.push(item)
    if (store.activity.length > 120) store.activity.splice(0, store.activity.length - 120)
    if (['done', 'start', 'stop', 'error', 'run'].includes(item.kind)) void refreshState().catch(() => {})
  })
}

export function stateOf(segmentId: string): SegmentState | undefined {
  if (store.campaign.profile !== store.activeProfile) return undefined
  return store.campaign.states.find(state => state.id === segmentId)
}
