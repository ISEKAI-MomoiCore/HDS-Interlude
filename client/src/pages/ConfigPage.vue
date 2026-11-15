<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
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
    id: 'story', label: '故事设定', hint: '保存后更新当前故事，跨重启保留。',
    fields: [
      { key: 'character.name', label: '主角姓名', type: 'text', info: '主角姓名，出现在全部叙事中', range: '任意非空中文/英文' },
      { key: 'character.profile', label: '人设描述', type: 'text', textarea: true, info: '主角的人设正文', range: '自由文本' },
      { key: 'character.traits', label: '性格特质', type: 'text', textarea: true, info: '每行一条，落库为数组', range: '换行分隔文本' },
      { key: 'world', label: '世界观', type: 'text', textarea: true, info: '世界观描述', range: '自由文本（≤4000 字）' },
      { key: 'location', label: '主要地点', type: 'text', info: '故事发生的核心场景' },
      { key: 'supportingCast', label: '配角', type: 'text', textarea: true, info: '围绕主角的次要人物' },
      { key: 'style', label: '叙事文风', type: 'text', textarea: true, info: '模型据此选择叙事措辞与节奏', range: '自由文本' },
      { key: 'perspective', label: '主角视角层', type: 'text', textarea: true, info: '用于写作的主角感知、关注方式和表达习惯；作为独立视角层参与叙事' },
      { key: 'defaultRelationship', label: '初始关系', type: 'text', info: '新参与者与主角的默认关系' },
      { key: 'timezone', label: '时区', type: 'text', info: 'IANA 时区', range: '如 Asia/Shanghai / America/New_York', placeholder: 'Asia/Shanghai' },
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
const baseline = ref('')
const dirty = computed(() => !!loadedId.value && JSON.stringify(form) !== baseline.value)
const confirmLeave = () => !dirty.value || window.confirm('当前故事有未保存的修改。离开此页面？')
onBeforeRouteLeave(confirmLeave)
// All workbench tabs share one route record, so parameter updates also need a guard.
onBeforeRouteUpdate((to, from) => to.path === from.path || confirmLeave())
async function reloadStory() {
  if (dirty.value && !window.confirm('重新读取将使用服务器上的故事设定替换当前修改。继续？')) return
  await loadSection(section.value)
}
const loadedId = ref<ConfigSection | ''>('')
let readRequest = 0
let disposed = false
onUnmounted(() => { disposed = true; readRequest++ })

async function loadSection(id: ConfigSection) {
  const target = SECTIONS.find(item => item.id === id)
  if (disposed || !target) return
  const request = ++readRequest
  const currentRequest = () => !disposed && request === readRequest && section.value === id
  section.value = id
  loadedId.value = ''
  for (const key of Object.keys(form)) delete form[key]
  loading.value = true
  notice.value = ''
  try {
    const result = await store.readConfig(id)
    if (!result) throw new Error('Console 连接尚未就绪')
    if (!result.ok) throw new Error(result.error ?? '读取失败')
    if (!currentRequest()) return
    for (const field of target.fields) {
      const value = result.values?.[field.key]
      form[field.key] = field.type === 'boolean' ? value === true : (value ?? (field.type === 'number' ? 0 : ''))
    }
    baseline.value = JSON.stringify(form)
    loadedId.value = id
  } catch (error: any) {
    if (currentRequest()) {
      notice.value = error?.message ?? String(error)
      noticeKind.value = 'warn'
    }
  } finally {
    if (currentRequest()) loading.value = false
  }
}

async function saveSection() {
  if (disposed || saving.value || loading.value || loadedId.value !== section.value) return
  const id = section.value
  const request = readRequest
  const currentRequest = () => !disposed && request === readRequest && section.value === id
  const values: Record<string, unknown> = {}
  for (const field of current().fields) values[field.key] = form[field.key]
  const snapshot = JSON.parse(JSON.stringify(values))
  saving.value = true
  notice.value = ''
  try {
    const result = await store.saveConfig(id, snapshot)
    if (!currentRequest()) return
    if (!result.ok) throw new Error(result.error ?? '未知错误')
    baseline.value = JSON.stringify(snapshot)
    notice.value = `已写入 ${result.applied ?? 0} 项。${id === 'story' ? '已保存到当前故事，后续写作立即使用。' : '已写入 koishi.yml，插件热更新生效。'}`
    noticeKind.value = 'ok'
  } catch (error: any) {
    if (currentRequest()) {
      notice.value = `保存失败：${error?.message ?? String(error)}`
      noticeKind.value = 'warn'
    }
  } finally {
    if (!disposed) saving.value = false
  }
}

const storyMissing = () => section.value === 'story' && loadedId.value === 'story' && !form['character.name'] && !loading.value

onMounted(() => loadSection('story'))
</script>

<template>
  <div>
    <div class="pg-head">
      <div>
        <h2>当前故事</h2>
        <div class="sub">编辑当前故事的设定，保存到故事数据库。新故事的默认档案在配置中心设置。</div>
      </div>
    </div>
    <router-link to="/hdsi/config-center" class="redirect-card">模型、上下文预算、运行时与考据设置 → 配置中心</router-link>
    <div v-if="notice" class="notice" :class="noticeKind" role="status">{{ notice }}</div>
    <div v-if="storyMissing()" class="notice warn">当前没有活跃故事——先在聊天里用 interlude.story.start 启动，再回来编辑故事设定。</div>
    <div class="card">
      <h3><span class="sq" />{{ current().label }}</h3>
      <div class="hint">{{ current().hint }}</div>
      <div v-if="loading" class="hint">读取中……</div>
      <template v-else-if="loadedId === section && !storyMissing()">
        <EditField v-for="f in current().fields" :key="f.key" v-model="form[f.key]"
          :label="f.label" :type="f.type" :options="f.options" :info="f.info" :range="f.range"
          :min="f.min" :max="f.max" :textarea="f.textarea" :secret="f.secret" :placeholder="f.placeholder" />
        <div class="actions"><button class="refresh" :disabled="loading || saving" @click="reloadStory">重新读取</button>
          <button class="save" :disabled="saving || loading || loadedId !== section" @click="saveSection">{{ saving ? '写入中……' : '保存故事设定' }}</button>
        </div>
      </template>
      <button v-else type="button" class="save" @click="reloadStory">重新读取</button>
    </div>
  </div>
</template>

<style scoped>
.pg-head { margin-bottom: 1rem; }
.pg-head h2 { font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
.pg-head h2::before { content: ""; width: 10px; height: 10px; background: var(--fg3, #3b82f6); transform: rotate(45deg); }
.sub { opacity: .55; font-size: 12.5px; padding-left: 20px; }
.redirect-card { display: block; padding: 10px 14px; margin-bottom: 12px; border: 1px dashed var(--bg3, rgba(128,128,128,.3)); color: inherit; text-decoration: none; font-size: 13px; opacity: .85; }
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
