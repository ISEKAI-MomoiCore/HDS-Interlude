<script setup lang="ts">
/**
 * P5 Profile 编辑器（全可视化）：管理 / engine / 提示词变体 / 人物 / 场景 / 评分 / 校验 / 矩阵。
 * 编辑在本地深拷贝上进行；Save → POST /api/profile（服务端校验）。
 */
import { onMounted, reactive, ref } from 'vue'
import { get, post } from '../api'
import { store, refreshState } from '../store'

type Profile = Record<string, any>

const tab = ref<'manage' | 'engine' | 'variants' | 'personas' | 'scenarios' | 'rubric' | 'checks' | 'matrix'>('manage')
const profile = ref<Profile | null>(null)
const selectedVariant = ref('')
const selectedPersona = ref('')
const selectedScenario = ref('')
const defaults = ref<Record<string, string>>({})
const saveState = ref('')
const newProfileName = ref('')
const importText = ref('')
const importError = ref('')

const SLOT_LABELS: Record<string, string> = {
  mainPrompt: '主提示词（空 = 生产默认）', formatPrompt: '结构化输出补充（空 = 生产默认）',
  fixedPrompt: '长期固定规则', style: '全局文风（空 = 生产默认文风）', storyStyle: '故事级文风',
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

async function loadProfile(name?: string): Promise<void> {
  saveState.value = ''
  profile.value = await get<Profile>(`/api/profile${name ? `?name=${encodeURIComponent(name)}` : ''}`)
  selectedVariant.value = profile.value.variants[0]?.id ?? ''
  selectedPersona.value = profile.value.personas[0]?.id ?? ''
  selectedScenario.value = profile.value.scenarios[0]?.id ?? ''
}

onMounted(async () => {
  try { defaults.value = await get('/api/profile/defaults') } catch { /* 可选 */ }
  await loadProfile(store.activeProfile)
})

async function save(): Promise<void> {
  if (!profile.value) return
  try {
    // sigs JSON 宽松解析（空串清空）
    for (const variant of profile.value.variants) {
      if (typeof variant.sigsText === 'string') {
        variant.sigs = variant.sigsText.trim() ? JSON.parse(variant.sigsText) : []
        delete variant.sigsText
      }
    }
    await post('/api/profile', profile.value)
    saveState.value = `已保存 ${new Date().toLocaleTimeString()}`
    await refreshState()
  } catch (error) {
    saveState.value = `失败：${(error as Error).message}`
  }
}

async function activate(name: string): Promise<void> {
  try {
    await post('/api/profile/activate', { name })
    await refreshState()
    saveState.value = `已激活 ${name}`
  } catch (error) { saveState.value = `失败：${(error as Error).message}` }
}

async function newProfile(): Promise<void> {
  const name = newProfileName.value.trim()
  if (!name) return
  try {
    await post('/api/profile/new', { name, from: profile.value?.meta.name })
    await loadProfile(name)
    await activate(name)
    saveState.value = `已创建并激活 ${name}`
  } catch (error) { saveState.value = `失败：${(error as Error).message}` }
}

async function doImport(): Promise<void> {
  importError.value = ''
  try {
    const parsed = JSON.parse(importText.value)
    await post('/api/profile', parsed)
    await loadProfile(parsed.meta.name)
    saveState.value = `已导入 ${parsed.meta.name}`
    importText.value = ''
  } catch (error) { importError.value = (error as Error).message }
}

function exportProfile(): void {
  if (!profile.value) return
  const blob = new Blob([JSON.stringify(profile.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${profile.value.meta.name}.profile.json`
  link.click()
  URL.revokeObjectURL(url)
}

// —— 变体/人物/场景/矩阵的增删 ——

function addVariant(): void {
  const id = `V${profile.value!.variants.length + 1}`
  profile.value!.variants.push({ id, label: '新变体', presence: 0, lang: 'zh', slots: { style: '' } })
  selectedVariant.value = id
}
function removeVariant(id: string): void {
  profile.value!.variants = profile.value!.variants.filter((v: any) => v.id !== id)
  if (selectedVariant.value === id) selectedVariant.value = profile.value!.variants[0]?.id ?? ''
}
function addPersona(): void {
  const id = `persona${profile.value!.personas.length + 1}`
  profile.value!.personas.push({
    id, label: '新人物',
    setting: { character: { name: '新角色', profile: '' }, user: { displayName: '阿澈', profile: '27 岁公司职员' }, relationship: '', world: '现实社会', perspective: '', supportingCast: '', location: '', style: '', timezone: 'Asia/Shanghai', supplementaryFacts: [] },
    participant: { id: `participant-${id}`, displayName: '阿澈', profile: '', relationship: '' },
  })
  selectedPersona.value = id
}
function removePersona(id: string): void {
  profile.value!.personas = profile.value!.personas.filter((p: any) => p.id !== id)
  if (selectedPersona.value === id) selectedPersona.value = profile.value!.personas[0]?.id ?? ''
}
function addScenario(): void {
  const id = `S${profile.value!.scenarios.length + 1}`
  profile.value!.scenarios.push({ id, label: '新场景', startISO: '2026-12-10T20:00:00+08:00', turns: [] })
  selectedScenario.value = id
}
function removeScenario(id: string): void {
  profile.value!.scenarios = profile.value!.scenarios.filter((s: any) => s.id !== id)
  if (selectedScenario.value === id) selectedScenario.value = profile.value!.scenarios[0]?.id ?? ''
}

function addTurn(scenario: any): void {
  const last = scenario.turns[scenario.turns.length - 1]
  scenario.turns.push({ at: (last?.at ?? 0) + 1, kind: 'user', content: '' })
}
function removeTurn(scenario: any, index: number): void {
  scenario.turns.splice(index, 1)
}
/** 回合内容编辑辅助：object 形态时编辑 default 键。 */
function contentOf(turn: any): string {
  if (turn.content === undefined || turn.content === null) return ''
  return typeof turn.content === 'string' ? turn.content : turn.content.default ?? ''
}
function setContent(turn: any, value: string): void {
  if (turn.content !== null && typeof turn.content === 'object') turn.content.default = value
  else turn.content = value
}
function personaOverrides(turn: any): Array<[string, string]> {
  if (turn.content === null || typeof turn.content !== 'object') return []
  return Object.entries(turn.content).filter(([key]) => key !== 'default')
}
function setPersonaOverride(turn: any, personaId: string, value: string): void {
  if (turn.content === null || typeof turn.content !== 'object') turn.content = { default: contentOf(turn) }
  turn.content[personaId] = value
}
function removePersonaOverride(turn: any, personaId: string): void {
  if (turn.content && typeof turn.content === 'object') delete turn.content[personaId]
}
function addPersonaOverride(turn: any, personaId: string): void {
  setPersonaOverride(turn, personaId, '')
}
function memoryOf(turn: any): string {
  if (turn.memory === undefined || turn.memory === null) return ''
  return typeof turn.memory === 'string' ? turn.memory : turn.memory.default ?? ''
}
function setMemory(turn: any, value: string): void {
  if (turn.memory !== null && typeof turn.memory === 'object') turn.memory.default = value
  else turn.memory = value
}

const variant = () => profile.value?.variants.find((v: any) => v.id === selectedVariant.value)
const persona = () => profile.value?.personas.find((p: any) => p.id === selectedPersona.value)
const scenario = () => profile.value?.scenarios.find((s: any) => s.id === selectedScenario.value)

const builtinChecks = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10', 'H11']
const CHECK_NOTES: Record<string, string> = {
  H1: 'JSON 结构（锁定）', H2: 'mode/sendAt 一致性（锁定）', H3: '泄漏', H4: '分隔符', H5: '幻觉',
  H6: '无证据入站', H7: '跨轮重复', H8: '时间越界', H9: '风格签名', H10: 'mirror', H11: '语言纪律',
}
</script>

<template>
  <h1 class="page-title">Profile 编辑器 <span class="muted" style="font-size:12px;" v-if="profile">{{ profile.meta.name }} · {{ profile.meta.title }}</span></h1>
  <p class="page-sub">
    <button v-for="t in [['manage','管理'],['engine','Engine'],['variants','提示词变体'],['personas','人物'],['scenarios','场景'],['rubric','评分'],['checks','校验'],['matrix','矩阵']] as const"
            :key="t[0]" :class="{ primary: tab === t[0] }" @click="tab = t[0]">{{ t[1] }}</button>
    <button class="primary" style="margin-left:14px;" @click="save()">💾 保存（校验后写盘）</button>
    <span class="muted" style="margin-left:8px;">{{ saveState }}</span>
  </p>

  <!-- 管理 -->
  <div v-if="tab === 'manage'" class="settings-cols">
    <div class="settings-col">
      <div class="chart-box">
        <div class="h">Profile 列表（激活值决定运行/评审/对比读哪套）</div>
        <table class="grid">
          <thead><tr><th>名</th><th>标题</th><th class="num">变体</th><th class="num">人物</th><th class="num">场景</th><th class="num">段</th><th></th></tr></thead>
          <tbody>
            <tr v-for="item in store.profiles" :key="item">
              <td><b>{{ item }}</b><span v-if="item === store.activeProfile" class="ok-text"> ←激活</span></td>
              <td class="muted">—</td>
              <td class="num" colspan="3" style="text-align:left;"><button class="small" @click="loadProfile(item)">载入编辑</button></td>
              <td colspan="2"><button class="small" :disabled="item === store.activeProfile" @click="activate(item)">激活</button></td>
            </tr>
          </tbody>
        </table>
        <div style="margin-top:10px; display:flex; gap:8px; align-items:center;">
          <input type="text" v-model="newProfileName" placeholder="新 profile 名（如 round2-style-test）" style="width:240px;" />
          <button @click="newProfile()">从当前复制新建</button>
        </div>
        <div class="panel-sec">
          <div class="h">导入 / 导出（JSON，可分享；不含 API key）</div>
          <button @click="exportProfile()">⬇ 导出当前 profile</button>
          <textarea v-model="importText" rows="3" placeholder="粘贴 profile JSON 后点导入" style="margin-top:6px;"></textarea>
          <button @click="doImport()">导入</button>
          <div v-if="importError" class="err-text">{{ importError }}</div>
        </div>
      </div>
    </div>
    <div class="settings-col">
      <div class="chart-box">
        <div class="h">当前 profile</div>
        <div class="muted" v-if="profile">
          <div>meta.name：{{ profile.meta.name }}</div>
          <div>meta.title：{{ profile.meta.title }}</div>
          <div>变体 {{ profile.variants.length }} · 人物 {{ profile.personas.length }} · 场景 {{ profile.scenarios.length }} · 段 {{ profile.matrix.phases.reduce((s: number, p: any) => s + p.segments.length, 0) }}</div>
          <div style="margin-top:8px;">核心合约指纹（systemHash）：<span class="chip">{{ store.contractFingerprint.systemHash || '—' }}</span></div>
          <div class="muted" style="margin-top:4px;">HDSI 核心升级后指纹会变；历史 run 与新 run 的跨版本对比自动失效（对比页有横幅提示）。</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Engine -->
  <div v-if="tab === 'engine' && profile" class="settings-col" style="max-width:640px;">
    <div class="chart-box">
      <div class="h">引擎配置（key 永不入 profile，走环境变量）</div>
      <label class="fld"><span>协议</span>
        <select v-model="profile.engine.protocol">
          <option value="chat-completions">chat-completions</option>
          <option value="anthropic-messages">anthropic-messages</option>
          <option value="gemini-interactions">gemini-interactions</option>
        </select></label>
      <label class="fld"><span>端点（可空 = 用环境变量端点）</span>
        <input type="text" v-model="profile.engine.endpoint" placeholder="https://host/v1/chat/completions" /></label>
      <label class="fld"><span>模型（可空 = 用环境变量模型；变体可再覆盖）</span>
        <input type="text" v-model="profile.engine.model" placeholder="如 gemini-2.5-flash" /></label>
      <div style="display:flex; gap:10px;">
        <label class="fld"><span>temperature</span><input type="number" step="0.05" v-model.number="profile.engine.sampling.temperature" style="width:90px;" /></label>
        <label class="fld"><span>topP</span><input type="number" step="0.05" v-model.number="profile.engine.sampling.topP" style="width:90px;" /></label>
        <label class="fld"><span>maxTokens</span><input type="number" v-model.number="profile.engine.sampling.maxTokens" style="width:110px;" /></label>
      </div>
      <div style="display:flex; gap:10px;">
        <label class="fld"><span>特化档位</span>
          <select v-model="profile.engine.specialization.tier">
            <option value="off">off（完整合约）</option><option value="lite">lite</option>
            <option value="standard">standard</option><option value="full">full</option>
          </select></label>
        <label class="fld"><span>特化家族</span>
          <select v-model="profile.engine.specialization.family">
            <option value="auto">auto</option><option v-for="f in ['gemini-flash','gemini','claude','gpt','glm','kimi','deepseek','grok','generic']" :key="f" :value="f">{{ f }}</option>
          </select></label>
        <label class="fld"><span>payload 顺序</span>
          <select v-model="profile.engine.payloadOrder"><option value="cache-first">cache-first</option><option value="legacy">legacy</option></select></label>
      </div>
    </div>
  </div>

  <!-- 提示词变体 -->
  <div v-if="tab === 'variants' && profile" class="review-layout">
    <div class="review-seglist">
      <div v-for="v in profile.variants" :key="v.id" class="item" :class="{ active: v.id === selectedVariant }" @click="selectedVariant = v.id">
        <div><b>{{ v.id }}</b> {{ v.label }}</div>
        <div class="score">在场度 {{ v.presence }} {{ v.lang === 'en' ? '·英' : '' }}{{ v.model ? '·' + v.model : '' }}</div>
      </div>
      <button style="width:100%; margin-top:6px;" @click="addVariant()">＋ 新变体</button>
    </div>
    <div class="review-center" style="max-width:760px;">
      <div v-if="variant()">
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <label class="fld"><span>ID</span><input type="text" v-model="variant()!.id" style="width:90px;" /></label>
          <label class="fld"><span>名称</span><input type="text" v-model="variant()!.label" style="width:200px;" /></label>
          <label class="fld"><span>在场度</span>
            <select v-model.number="variant()!.presence"><option :value="0">0 不可见</option><option :value="1">1 可感</option><option :value="2">2 作者腔</option><option :value="3">3 结构改写</option></select></label>
          <label class="fld"><span>叙述语言</span>
            <select v-model="variant()!.lang"><option value="zh">中文</option><option value="en">英文叙述+中文气泡</option></select></label>
          <label class="fld"><span>模型覆盖（可空）</span><input type="text" v-model="variant()!.model" placeholder="空 = 引擎链" style="width:200px;" /></label>
          <label class="checkbox-row" style="margin-top:20px;"><input type="checkbox" v-model="variant()!.stress" /> 合约压力臂</label>
          <label class="checkbox-row" style="margin-top:20px;"><input type="checkbox" v-model="variant()!.optional" /> 预算备选</label>
        </div>
        <div v-for="slotKey in ['mainPrompt', 'formatPrompt', 'fixedPrompt', 'style', 'storyStyle'] as const" :key="slotKey" class="panel-sec">
          <div class="h">
            {{ SLOT_LABELS[slotKey] }}
            <span v-if="defaults[slotKey]" class="muted">（生产默认 {{ defaults[slotKey].length }} 字，留空则回落）</span>
          </div>
          <textarea v-model="variant()!.slots[slotKey]" rows="4" :placeholder="defaults[slotKey]?.slice(0, 200) || '（空）'"></textarea>
        </div>
        <div class="panel-sec">
          <div class="h">风格签名（H9 操纵检验；JSON 数组 [{metric,op,value}]，可空）</div>
          <textarea v-model="variant()!.sigsText" rows="2" :placeholder="JSON.stringify(variant()!.sigs ?? [])"></textarea>
        </div>
        <button class="danger" @click="removeVariant(variant()!.id)">删除此变体</button>
      </div>
    </div>
  </div>

  <!-- 人物 -->
  <div v-if="tab === 'personas' && profile" class="review-layout">
    <div class="review-seglist">
      <div v-for="p in profile.personas" :key="p.id" class="item" :class="{ active: p.id === selectedPersona }" @click="selectedPersona = p.id">
        <div><b>{{ p.setting.character.name }}</b></div>
        <div class="score">{{ p.id }}</div>
      </div>
      <button style="width:100%; margin-top:6px;" @click="addPersona()">＋ 新人物</button>
    </div>
    <div class="review-center" style="max-width:760px;">
      <div v-if="persona()">
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <label class="fld"><span>ID</span><input type="text" v-model="persona()!.id" style="width:130px;" /></label>
          <label class="fld"><span>标签</span><input type="text" v-model="persona()!.label" style="width:260px;" /></label>
          <label class="fld"><span>角色名</span><input type="text" v-model="persona()!.setting.character.name" style="width:140px;" /></label>
          <label class="fld"><span>时区</span><input type="text" v-model="persona()!.setting.timezone" style="width:140px;" /></label>
        </div>
        <label class="fld"><span>角色设定（character.profile）</span>
          <textarea v-model="persona()!.setting.character.profile" rows="5"></textarea></label>
        <label class="fld"><span>视角（perspective）</span>
          <textarea v-model="persona()!.setting.perspective" rows="3"></textarea></label>
        <label class="fld"><span>补充事实（每行一条）</span>
          <textarea :value="(persona()!.setting.supplementaryFacts ?? []).join('\n')"
                    @change="persona()!.setting.supplementaryFacts = ($event.target as HTMLTextAreaElement).value.split('\n').filter(Boolean)" rows="3"></textarea></label>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <label class="fld"><span>聊天对象称呼</span><input type="text" v-model="persona()!.setting.user.displayName" style="width:120px;" /></label>
          <label class="fld"><span>世界</span><input type="text" v-model="persona()!.setting.world" style="width:220px;" /></label>
          <label class="fld"><span>主要地点</span><input type="text" v-model="persona()!.setting.location" style="width:220px;" /></label>
        </div>
        <label class="fld"><span>关系基线（relationship）</span>
          <textarea v-model="persona()!.setting.relationship" rows="2"></textarea></label>
        <label class="fld"><span>配角（supportingCast）</span>
          <textarea v-model="persona()!.setting.supportingCast" rows="2"></textarea></label>
        <label class="fld"><span>聊天对象 profile（participant）</span>
          <textarea v-model="persona()!.participant.profile" rows="2"></textarea></label>
        <button class="danger" @click="removePersona(persona()!.id)">删除此人物</button>
      </div>
    </div>
  </div>

  <!-- 场景 -->
  <div v-if="tab === 'scenarios' && profile" class="review-layout">
    <div class="review-seglist">
      <div v-for="s in profile.scenarios" :key="s.id" class="item" :class="{ active: s.id === selectedScenario }" @click="selectedScenario = s.id">
        <div><b>{{ s.id }}</b> {{ s.label }}</div>
        <div class="score">{{ s.turns.length }} 轮</div>
      </div>
      <button style="width:100%; margin-top:6px;" @click="addScenario()">＋ 新场景</button>
    </div>
    <div class="review-center" style="max-width:820px;">
      <div v-if="scenario()">
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <label class="fld"><span>ID</span><input type="text" v-model="scenario()!.id" style="width:80px;" /></label>
          <label class="fld"><span>名称</span><input type="text" v-model="scenario()!.label" style="width:280px;" /></label>
          <label class="fld"><span>起始时间（ISO 含时区）</span><input type="text" v-model="scenario()!.startISO" style="width:240px;" /></label>
        </div>
        <label class="fld"><span>说明</span><input type="text" v-model="scenario()!.notes" /></label>
        <div class="panel-sec">
          <div class="h">回合（at=分钟偏移；文本默认列=所有人共用；人物覆盖列=按人物替换）</div>
          <div v-for="(turn, index) in scenario()!.turns" :key="index" class="turn-card" style="padding:8px 10px; margin-bottom:8px;">
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
              <span class="muted">#{{ index + 1 }}</span>
              <input type="number" v-model.number="turn.at" style="width:90px;" title="分钟偏移" />
              <select v-model="turn.kind" style="width:110px;"><option value="user">user</option><option value="advance">advance</option></select>
              <button class="small danger" @click="removeTurn(scenario()!, index)">删</button>
            </div>
            <textarea v-if="turn.kind === 'user'" :value="contentOf(turn)" @change="setContent(turn, ($event.target as HTMLTextAreaElement).value)" rows="1" placeholder="用户消息（默认）"></textarea>
            <div v-for="[pid, text] in personaOverrides(turn)" :key="pid" style="display:flex; gap:6px; margin-top:4px; align-items:flex-start;">
              <span class="chip" style="flex:none; margin-top:4px;">{{ pid }}</span>
              <textarea :value="text" @change="setPersonaOverride(turn, pid, ($event.target as HTMLTextAreaElement).value)" rows="1"></textarea>
              <button class="small" @click="removePersonaOverride(turn, pid)">×</button>
            </div>
            <div style="display:flex; gap:6px; margin-top:4px; align-items:center;" v-if="turn.kind === 'user'">
              <select @change="addPersonaOverride(turn, ($event.target as HTMLSelectElement).value)" style="width:150px;">
                <option value="">＋ 添加人物覆盖…</option>
                <option v-for="p in profile.personas.filter((p:any) => !personaOverrides(turn).some(([key]) => key === p.id))" :key="p.id" :value="p.id">{{ p.setting.character.name }}（{{ p.id }}）</option>
              </select>
            </div>
            <textarea :value="memoryOf(turn)" @change="setMemory(turn, ($event.target as HTMLTextAreaElement).value)" rows="1" placeholder="派生记忆（模拟压缩产物，可空）" style="margin-top:4px;"></textarea>
          </div>
          <button @click="addTurn(scenario())">＋ 添加回合</button>
        </div>
        <button class="danger" @click="removeScenario(scenario()!.id)">删除此场景</button>
      </div>
    </div>
  </div>

  <!-- 评分 -->
  <div v-if="tab === 'rubric' && profile" class="settings-col" style="max-width:900px;">
    <div class="chart-box">
      <div class="h">评分维度（评审面板与对比页动态渲染；综合分 = Σ维度×权重/Σ权重）</div>
      <table class="grid">
        <thead><tr><th>ID</th><th>名称</th><th class="num">权重</th><th>锚点 1 / 3 / 5（每行一条文本）</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(dim, index) in profile.rubric.dimensions" :key="index">
            <td><input type="text" v-model="dim.id" style="width:100px;" /></td>
            <td><input type="text" v-model="dim.label" style="width:100px;" /></td>
            <td class="num"><input type="number" step="0.1" v-model.number="dim.weight" style="width:60px;" /></td>
            <td>
              <textarea v-model="dim.anchors['1']" rows="1" placeholder="1 分锚点"></textarea>
              <textarea v-model="dim.anchors['3']" rows="1" placeholder="3 分锚点"></textarea>
              <textarea v-model="dim.anchors['5']" rows="1" placeholder="5 分锚点"></textarea>
            </td>
            <td><button class="small danger" @click="profile.rubric.dimensions.splice(index, 1)">删</button></td>
          </tr>
        </tbody>
      </table>
      <button style="margin-top:8px;" @click="profile.rubric.dimensions.push({ id: `dim${profile.rubric.dimensions.length + 1}`, label: '新维度', weight: 1, anchors: {} })">＋ 维度</button>
      <div class="panel-sec">
        <div class="h">标记（评审快捷键）</div>
        <div v-for="(flag, index) in profile.rubric.flags" :key="index" style="display:flex; gap:8px; margin-bottom:6px; align-items:center;">
          <input type="text" v-model="flag.id" style="width:110px;" placeholder="id" />
          <input type="text" v-model="flag.label" style="width:110px;" placeholder="标签" />
          <input type="text" v-model="flag.hotkey" style="width:50px;" placeholder="键" />
          <button class="small danger" @click="profile.rubric.flags.splice(index, 1)">删</button>
        </div>
        <button @click="profile.rubric.flags.push({ id: `flag${profile.rubric.flags.length + 1}`, label: '新标记', hotkey: 'x' })">＋ 标记</button>
      </div>
      <div class="panel-sec">
        <div class="h">一审 gate 规则（任务包导出时嵌入）</div>
        <textarea v-model="profile.rubric.gate.rules" rows="5"></textarea>
      </div>
    </div>
  </div>

  <!-- 校验 -->
  <div v-if="tab === 'checks' && profile" class="settings-col" style="max-width:900px;">
    <div class="chart-box">
      <div class="h">内置检查（H1/H2 锁定 = 输出可被管线消费的底线；其余可开关；auto = 按变体语言自动切模式）</div>
      <table class="grid">
        <thead><tr><th>ID</th><th>说明</th><th>开关</th></tr></thead>
        <tbody>
          <tr v-for="id in builtinChecks" :key="id">
            <td><b>{{ id }}</b></td>
            <td class="muted">{{ CHECK_NOTES[id] }}</td>
            <td>
              <select v-model="profile.checks.builtin[id]" :disabled="id === 'H1' || id === 'H2'">
                <option value="auto">auto</option><option :value="true">开</option><option :value="false">关</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="panel-sec">
        <div class="h">自定义检查（regex-prose / regex-bubble / metric）</div>
        <table class="grid">
          <thead><tr><th>ID</th><th>类型</th><th>参数</th><th>级别</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(check, index) in profile.checks.custom" :key="index">
              <td><input type="text" v-model="check.id" style="width:80px;" /></td>
              <td>
                <select v-model="check.kind" style="width:140px;">
                  <option value="regex-prose">regex-prose</option><option value="regex-bubble">regex-bubble</option><option value="metric">metric</option>
                </select>
              </td>
              <td>
                <input v-if="check.kind !== 'metric'" type="text" v-model="check.pattern" placeholder="正则" style="width:280px;" />
                <template v-else>
                  <input type="text" v-model="check.metric" placeholder="指标" style="width:140px;" />
                  <select v-model="check.op" style="width:60px;"><option value="<=">≤</option><option value=">=">≥</option></select>
                  <input type="number" v-model.number="check.value" style="width:80px;" />
                </template>
              </td>
              <td><select v-model="check.severity"><option value="flag">flag</option><option value="fail">fail</option></select></td>
              <td><button class="small danger" @click="profile.checks.custom.splice(index, 1)">删</button></td>
            </tr>
          </tbody>
        </table>
        <button style="margin-top:8px;" @click="profile.checks.custom.push({ id: `C${profile.checks.custom.length + 1}`, kind: 'metric', metric: 'avgSentenceLength', op: '<=', value: 30, severity: 'flag' })">＋ 自定义检查</button>
      </div>
    </div>
  </div>

  <!-- 矩阵 -->
  <div v-if="tab === 'matrix' && profile" class="settings-col" style="max-width:980px;">
    <div v-for="(phase, phaseIndex) in profile.matrix.phases" :key="phase.key" class="chart-box" style="margin-bottom:14px;">
      <div class="h" style="display:flex; gap:8px; align-items:center;">
        <input type="text" v-model="phase.key" style="width:110px;" title="阶段键（CLI --phase 用）" />
        <input type="text" v-model="phase.name" style="width:220px;" />
        <button class="small danger" @click="profile.matrix.phases.splice(phaseIndex, 1)">删阶段</button>
      </div>
      <table class="grid">
        <thead><tr><th>段 ID</th><th>变体</th><th>场景</th><th>人物</th><th>备选</th><th></th></tr></thead>
        <tbody>
          <tr v-for="segment in phase.segments" :key="segment.id">
            <td><input type="text" v-model="segment.id" style="width:80px;" /></td>
            <td>
              <select v-model="segment.variant" style="width:150px;">
                <option value="TBD">TBD（跳过）</option>
                <option v-for="v in profile.variants" :key="v.id" :value="v.id">{{ v.id }} · {{ v.label }}</option>
              </select>
            </td>
            <td>
              <select v-model="segment.scenario" style="width:120px;">
                <option v-for="s in profile.scenarios" :key="s.id" :value="s.id">{{ s.id }}</option>
              </select>
            </td>
            <td>
              <select v-model="segment.persona" style="width:140px;">
                <option :value="null">默认（第一个人物）</option>
                <option v-for="p in profile.personas" :key="p.id" :value="p.id">{{ p.setting.character.name }}</option>
              </select>
            </td>
            <td><input type="checkbox" v-model="segment.optional" /></td>
            <td><button class="small danger" @click="phase.segments = phase.segments.filter((s:any) => s !== segment)">删</button></td>
          </tr>
        </tbody>
      </table>
      <button style="margin-top:8px;" @click="phase.segments.push({ id: `N${phase.segments.length + 1}`, variant: 'TBD', scenario: profile.scenarios[0]?.id ?? '', persona: null })">＋ 段</button>
    </div>
    <button @click="profile.matrix.phases.push({ key: `phase${profile.matrix.phases.length + 1}`, name: '新阶段', segments: [] })">＋ 阶段</button>
  </div>
</template>
