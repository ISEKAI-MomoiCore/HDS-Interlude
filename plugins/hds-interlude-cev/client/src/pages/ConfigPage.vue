<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { store, type ConfigSection } from '../store'
import EditField from '../components/EditField.vue'

defineOptions({ name: 'ConfigPage' })
defineProps<{ overview: any }>()

interface FieldSpec {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select'
  options?: Array<{ value: string, label: string }>
  info?: string
  range?: string
  min?: number
  max?: number
  textarea?: boolean
  secret?: boolean
  placeholder?: string
}

/** 字段清单与值域说明（docs/CONSOLE_HANDOFF.md 第六节）；键名须与
 * 服务端 EDITABLE_*_KEYS 白名单（src/console/contract.ts）保持同步。 */
const SECTIONS: Array<{ id: ConfigSection, label: string, hint: string, fields: FieldSpec[] }> = [
  {
    id: 'story', label: '故事设定', hint: '写入 cev_interlude_story.setting，跨重启持久',
    fields: [
      { key: 'character.name', label: '主角姓名', type: 'text', info: '主角姓名，出现在全部叙事中', range: '任意非空中文/英文' },
      { key: 'character.profile', label: '人设描述', type: 'text', textarea: true, info: '主角的人设正文', range: '自由文本' },
      { key: 'character.traits', label: '性格特质', type: 'text', textarea: true, info: '每行一条，落库为数组', range: '换行分隔文本' },
      { key: 'world', label: '世界观', type: 'text', textarea: true, info: '世界观描述', range: '自由文本（≤4000 字）' },
      { key: 'location', label: '主要地点', type: 'text', info: '故事发生的核心场景' },
      { key: 'supportingCast', label: '配角', type: 'text', textarea: true, info: '围绕主角的次要人物' },
      { key: 'style', label: '叙事文风', type: 'text', textarea: true, info: '模型按此写 prose', range: '自由文本' },
      { key: 'perspective', label: '叙事视角', type: 'text', info: '如第二人称 / 第一人称' },
      { key: 'defaultRelationship', label: '初始关系', type: 'text', info: '新参与者与主角的默认关系' },
      { key: 'timezone', label: '时区', type: 'text', info: 'IANA 时区', range: '如 Asia/Shanghai / America/New_York', placeholder: 'Asia/Shanghai' },
    ],
  },
  {
    id: 'runtime', label: '运行时参数', hint: '进程内生效不落 koishi.yml——下轮叙事生效，重启后回到配置文件值',
    fields: [
      { key: 'contextEntryLimit', label: '上下文条目锚点', type: 'number', min: 1, max: 200, info: '写入主叙事上下文的近期剧本条目数', range: '1-200，默认 18' },
      { key: 'contextEntryMode', label: '条目模式', type: 'select', options: [
        { value: 'fixed', label: 'fixed · 固定条数' },
        { value: 'auto', label: 'auto · 按密度自适应' },
      ], info: 'fixed=固定条数 / auto=按密度自适应（12-25 条）', range: 'fixed | auto' },
      { key: 'contextTimeWindowMinutes', label: '时间窗并入', type: 'number', min: 0, max: 1440, info: '额外并入最近 N 分钟全部条目', range: '0-1440 分钟，0=关闭' },
      { key: 'allowProactiveMessages', label: '主动可见消息', type: 'boolean', info: '允许主角主动发起可见消息' },
      { key: 'userMessageDebounceSeconds', label: '消息合并等待', type: 'number', min: 1, max: 30, info: '连续消息合并等待', range: '1-30 秒' },
    ],
  },
  {
    id: 'research', label: '考据配置', hint: '进程内生效不落 koishi.yml——下轮叙事生效，重启后回到配置文件值',
    fields: [
      { key: 'enabled', label: '考据总开关', type: 'boolean', info: '应答式：她承诺去查 → 后台核实 → 案头供作者参考' },
      { key: 'searchBackend', label: '搜索后端', type: 'select', options: [
        { value: 'auto', label: 'auto · 自动' },
        { value: 'tavily', label: 'tavily' },
        { value: 'bocha', label: 'bocha' },
        { value: 'searxng', label: 'searxng' },
        { value: 'duckduckgo-html', label: 'duckduckgo-html' },
      ], info: '考据检索的网络后端' },
      { key: 'searchApiKey', label: '搜索 API Key', type: 'text', secret: true, info: '所选搜索后端的 Key' },
      { key: 'proxyAgent', label: '网络代理', type: 'text', info: 'HTTP(S) 代理地址', range: '如 http://127.0.0.1:7890' },
      { key: 'responseFormat', label: '蒸馏格式', type: 'select', options: [
        { value: 'json-object', label: 'json-object · API JSON mode' },
        { value: 'prompt-only', label: 'prompt-only · 不兼容网关用' },
      ], info: 'json-object 发 API JSON mode；不兼容网关用后者' },
      { key: 'maxRounds', label: '检索轮数上限', type: 'number', min: 1, max: 2, info: '单次考据任务的搜索轮数', range: '1-2' },
      { key: 'taskTokenBudget', label: '单任务预算', type: 'number', min: 600, max: 20000, info: '单任务出向 token 预算', range: '600-20000' },
      { key: 'deskCapacity', label: '案头容量', type: 'number', min: 2, max: 32, info: '资料案头在架条目上限', range: '2-32' },
      { key: 'stableFactTtlHours', label: '稳定事实 TTL', type: 'number', min: 1, max: 2160, info: '稳定事实保留时长', range: '1-2160 小时' },
      { key: 'volatileFactTtlHours', label: '易变事实 TTL', type: 'number', min: 1, max: 168, info: '易变事实保留时长', range: '1-168 小时' },
    ],
  },
]

const section = ref<ConfigSection>('story')
const current = () => SECTIONS.find(s => s.id === section.value)!
const form = reactive<Record<string, any>>({})
const loading = ref(false)
const saving = ref(false)
const notice = ref('')
const noticeKind = ref<'ok' | 'warn'>('ok')

async function loadSection(id: ConfigSection) {
  section.value = id
  loading.value = true
  notice.value = ''
  try {
    const result = await store.readConfig(id)
    if (!result.ok) {
      notice.value = result.error ?? '读取失败'
      noticeKind.value = 'warn'
      return
    }
    for (const field of current().fields) {
      const value = result.values?.[field.key]
      form[field.key] = field.type === 'boolean' ? value === true : (value ?? (field.type === 'number' ? 0 : ''))
    }
  } catch (error: any) {
    notice.value = error?.message ?? String(error)
    noticeKind.value = 'warn'
  } finally {
    loading.value = false
  }
}

async function saveSection() {
  saving.value = true
  notice.value = ''
  try {
    const values: Record<string, unknown> = {}
    for (const field of current().fields) values[field.key] = form[field.key]
    const result = await store.saveConfig(section.value, values)
    if (!result.ok) {
      notice.value = `保存失败：${result.error ?? '未知错误'}`
      noticeKind.value = 'warn'
      return
    }
    notice.value = `已写入 ${result.applied ?? 0} 项。${section.value === 'story' ? '已落库，立即生效。' : '进程内生效——下轮叙事采用，重启后回到 koishi.yml 值。'}`
    noticeKind.value = 'ok'
  } catch (error: any) {
    notice.value = `保存失败：${error?.message ?? String(error)}`
    noticeKind.value = 'warn'
  } finally {
    saving.value = false
  }
}

const storyMissing = () => section.value === 'story' && !form['character.name'] && !loading.value

onMounted(() => loadSection('story'))
</script>

<template>
  <div>
    <div class="pg-head">
      <div>
        <h2>主配置</h2>
        <div class="sub">故事设定 · 运行时参数 · 考据配置——写入即生效，无需重载插件</div>
      </div>
    </div>
    <div class="tabs">
      <button v-for="s in SECTIONS" :key="s.id" class="tab" :class="{ on: section === s.id }" @click="loadSection(s.id)">
        {{ s.label }}
      </button>
    </div>
    <div v-if="notice" class="notice" :class="noticeKind">{{ notice }}</div>
    <div v-if="storyMissing()" class="notice warn">当前没有活跃故事——先在聊天里用 interlude.story.start 启动，再回来编辑故事设定。</div>
    <div class="card">
      <h3><span class="sq" />{{ current().label }}</h3>
      <div class="hint">{{ current().hint }}</div>
      <div v-if="loading" class="hint">读取中……</div>
      <template v-else>
        <EditField v-for="f in current().fields" :key="f.key" v-model="form[f.key]"
          :label="f.label" :type="f.type" :options="f.options" :info="f.info" :range="f.range"
          :min="f.min" :max="f.max" :textarea="f.textarea" :secret="f.secret" :placeholder="f.placeholder" />
        <div class="actions">
          <button class="save" :disabled="saving" @click="saveSection">{{ saving ? '写入中……' : '保存本节' }}</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pg-head { margin-bottom: 1rem; }
.pg-head h2 { font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
.pg-head h2::before { content: ""; width: 10px; height: 10px; background: var(--fg3, #3b82f6); transform: rotate(45deg); }
.sub { opacity: .55; font-size: 12.5px; padding-left: 20px; }
.tabs { display: flex; gap: 0; margin-bottom: 12px; }
.tab { border: 1px solid var(--bg3, rgba(128,128,128,.15)); border-left: 2.5px solid transparent; background: transparent; color: inherit; font: inherit; font-size: 13px; padding: 7px 18px; cursor: pointer; opacity: .6; margin-right: -1px; }
.tab:hover { opacity: .9; }
.tab.on { opacity: 1; border-left-color: var(--fg3, #3b82f6); background: rgba(128,128,128,.06); }
.notice { border-left: 3px solid #14b8a6; background: rgba(20,184,166,.08); padding: 11px 14px; font-size: 12.5px; margin-bottom: 12px; }
.notice.warn { border-color: #b45309; background: rgba(180,83,9,.08); }
.card { background: var(--bg1, rgba(128,128,128,.05)); border: 1px solid var(--bg3, rgba(128,128,128,.15)); padding: 14px 16px; max-width: 760px; }
.card h3 { font-size: 11.5px; opacity: .55; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
.sq { width: 8px; height: 8px; background: #14b8a6; }
.card:hover .sq { transform: rotate(45deg) scale(1.15); }
.hint { font-size: 11.5px; opacity: .5; margin-bottom: 12px; }
.actions { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--bg3, rgba(128,128,128,.15)); }
.save { border: 1px solid var(--fg3, #3b82f6); background: transparent; color: var(--fg3, #3b82f6); font: inherit; font-size: 13px; padding: 7px 22px; cursor: pointer; }
.save:hover:not(:disabled) { background: rgba(59,130,246,.1); }
.save:disabled { opacity: .4; cursor: wait; }
</style>
