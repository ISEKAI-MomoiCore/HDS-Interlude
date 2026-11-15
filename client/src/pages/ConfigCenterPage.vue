<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Schema, SchemaBase } from '@koishijs/client'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { store, type ConfigCenterGroupMeta, type ConfigCenterSectionMeta } from '../store'

defineOptions({ name: 'ConfigCenterPage' })
defineProps<{ overview: any }>()

/** 仅危险项确认（评审决策 #1）：与服务端 CONFIG_CENTER_DANGEROUS_FIELDS
 * （src/console/contract.ts）保持同步；保存触及且值有变化时弹确认。 */
const DANGEROUS_FIELDS: Record<string, string[]> = {
  blindMode: ['enabled'],
}

const query = ref('')

const menu = ref<ConfigCenterGroupMeta[]>([])
const currentId = ref('')
const meta = ref<ConfigCenterSectionMeta | null>(null)
const sectionSchema = ref<any>(null)
const model = ref<Record<string, unknown>>({})
const initial = ref<Record<string, unknown>>({})
const maskedFields = ref<string[]>([])
const loading = ref(false)
const menuLoading = ref(false)
const menuFailed = ref(false)
const saving = ref(false)
const notice = ref('')
const noticeKind = ref<'ok' | 'warn'>('ok')
const loadedId = ref('')
let readRequest = 0
let disposed = false
onUnmounted(() => { disposed = true; readRequest++ })

const openSections = computed(() => menu.value.flatMap(group => group.sections.filter(s => s.stage === 1)))
const dirty = computed(() => loadedId.value === currentId.value && JSON.stringify(model.value) !== JSON.stringify(initial.value))
const filteredMenu = computed(() => menu.value.map(group => ({ ...group, sections: group.sections.filter(section =>
  `${section.label} ${section.id} ${section.description}`.toLowerCase().includes(query.value.trim().toLowerCase())) })).filter(group => group.sections.length))

const confirmLeave = () => !dirty.value || window.confirm('配置中心有未保存的修改。离开此页面？')
onBeforeRouteLeave(confirmLeave)
// All workbench tabs share one route record, so parameter updates also need a guard.
onBeforeRouteUpdate((to, from) => to.path === from.path || confirmLeave())

async function selectSection(id: string) {
  if (id === currentId.value || saving.value) return
  if (dirty.value && !window.confirm('本节有尚未保存的修改。切换配置节将重新读取，继续切换？')) return
  await loadSection(id)
}
async function reloadSection() {
  if (loading.value || saving.value || !currentId.value) return
  if (dirty.value && !window.confirm('重新读取将以已保存配置替换本节的未保存修改。继续？')) return
  await loadSection(currentId.value)
}
function removedPaths(before: Record<string, unknown>, after: Record<string, unknown>, prefix = ''): string[] {
  return Object.keys(before).flatMap(key => {
    const path = prefix ? `${prefix}.${key}` : key
    if (!(key in after)) return [path]
    const a = before[key], b = after[key]
    return a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)
      ? removedPaths(a as Record<string, unknown>, b as Record<string, unknown>, path) : []
  })
}

function findMeta(id: string): ConfigCenterSectionMeta | undefined {
  for (const group of menu.value) {
    const found = group.sections.find(section => section.id === id)
    if (found) return found
  }
  return undefined
}

async function loadMenu() {
  if (disposed || menuLoading.value) return
  menuLoading.value = true
  menuFailed.value = false
  notice.value = ''
  try {
    const result = await store.readConfigCenter()
    if (disposed) return
    if (!result?.ok || !Array.isArray(result.menu)) throw new Error(result?.error ?? '菜单读取失败')
    menu.value = result.menu
    const first = openSections.value.find(section => section.id === 'runtime') ?? openSections.value[0]
    if (first) await loadSection(first.id)
  } catch (error: any) {
    if (!disposed) {
      menuFailed.value = true
      notice.value = `配置菜单读取失败：${error?.message ?? String(error)}`
      noticeKind.value = 'warn'
    }
  } finally {
    if (!disposed) menuLoading.value = false
  }
}

async function loadSection(id: string, silent = false) {
  const target = findMeta(id)
  if (disposed || !target || target.stage !== 1) return
  const request = ++readRequest
  const current = () => !disposed && request === readRequest && currentId.value === id
  currentId.value = id
  meta.value = target
  loadedId.value = ''
  sectionSchema.value = null
  model.value = {}
  initial.value = {}
  maskedFields.value = []
  loading.value = true
  if (!silent) notice.value = ''
  try {
    const result = await store.readConfigCenter(id)
    if (!current()) return
    if (!result.ok) throw new Error(result.error ?? '读取失败')
    if (!result.schema) throw new Error('配置结构读取失败')
    // {uid, refs} JSON → schemastery Schema 实例，交由宿主同源组件渲染。
    sectionSchema.value = new (Schema as any)(result.schema)
    const values = (result.values ?? {}) as Record<string, unknown>
    model.value = JSON.parse(JSON.stringify(values))
    initial.value = JSON.parse(JSON.stringify(values))
    maskedFields.value = result.maskedFields ?? []
    loadedId.value = id
  } catch (error: any) {
    if (current()) {
      notice.value = `${silent ? '配置已保存，重新读取失败：' : ''}${error?.message ?? String(error)}`
      noticeKind.value = 'warn'
    }
  } finally {
    if (current()) loading.value = false
  }
}

function touchedDangerousFields(): string[] {
  const fields = DANGEROUS_FIELDS[currentId.value] ?? []
  return fields.filter(field => JSON.stringify(model.value[field]) !== JSON.stringify(initial.value[field]))
}

async function saveSection(reload = false) {
  if (disposed || saving.value || loading.value || !currentId.value || loadedId.value !== currentId.value) return
  const id = currentId.value
  const request = readRequest
  const current = () => !disposed && request === readRequest && currentId.value === id
  const serialized = JSON.stringify(model.value)
  const values = JSON.parse(serialized)
  const dangerous = touchedDangerousFields()
  if (dangerous.length) {
    const proceed = window.confirm(`本次保存将修改影响排障能力的字段：${dangerous.join('、')}。\n盲区模式开启后将关闭管理指令并隐藏运行日志，恢复需在 Koishi 配置中关闭该开关并重载。\n\n确认继续？`)
    if (!proceed) return
  }
  saving.value = true
  notice.value = ''
  try {
    const result = await store.saveConfigCenter(id, values, { reload, unset: removedPaths(initial.value, values) })
    if (!current()) return
    if (!result.ok) throw new Error(result.error ?? '未知错误')
    notice.value = reload ? '已保存，并已请求重载 HDSI。' : '已保存到 koishi.yml；配置更新已提交，插件将按需自动重载。'
    noticeKind.value = 'ok'
    if (JSON.stringify(model.value) === serialized) {
      // 同一视图仍展示提交值时，重读服务端规范化结果。
      await loadSection(id, true)
    } else {
      // 保存期间的新编辑继续留在表单，基准更新为刚确认的提交快照。
      initial.value = JSON.parse(serialized)
    }
  } catch (error: any) {
    if (current()) {
      notice.value = `保存失败：${error?.message ?? String(error)}`
      noticeKind.value = 'warn'
    }
  } finally {
    if (!disposed) saving.value = false
  }
}

onMounted(loadMenu)
</script>

<template>
  <div class="cc">
    <div class="pg-head">
      <div>
        <h2>配置中心</h2>
        <div class="sub">按用途管理故事档案、模型、上下文与运行能力。修改仅在保存后写入配置文件。</div>
      </div>
    </div>
    <div v-if="notice" class="notice" :class="noticeKind" role="status">
      {{ notice }}
      <button v-if="menuFailed" class="save" :disabled="menuLoading" @click="loadMenu">重试</button>
    </div>
    <div v-if="menuLoading && !menu.length" class="hint">读取配置菜单……</div>
    <div class="layout">
      <aside class="menu" aria-label="配置分类">
        <label class="search"><span>查找配置</span><input v-model="query" type="search" placeholder="名称或字段，如 runtime" aria-label="查找配置节" /></label>
        <div v-if="menu.length" class="menu-summary">{{ openSections.length }} 个配置节 · 全部可编辑</div>
        <template v-for="group in filteredMenu" :key="group.id">
          <div class="group">{{ group.label }}</div>
          <button v-for="section in group.sections" :key="section.id" type="button"
            class="item" :class="{ on: currentId === section.id }" :aria-current="currentId === section.id ? 'page' : undefined"
            :disabled="saving" @click="selectSection(section.id)">{{ section.label }}</button>
        </template>
        <div v-if="query && !filteredMenu.length" class="hint">没有匹配的配置节。</div>
      </aside>
      <main class="content">
        <div v-if="loading" class="hint">读取中……</div>
        <template v-else-if="meta && sectionSchema">
          <div class="card">
            <h3><span class="sq" />{{ meta.label }}</h3>
            <div class="hint">{{ meta.description }}<template v-if="maskedFields.length"> 密钥已隐藏，保持占位值可保留原密钥；填写新值可替换。</template></div>
            <SchemaBase.Form @submit.prevent :key="loadedId" :inert="saving || undefined" :aria-busy="saving" :schema="sectionSchema" :model-value="model" :initial="initial" @update:model-value="model = $event" />
            <div class="actions">
              <span class="save-state" role="status">{{ saving ? '正在写入配置…' : dirty ? '有未保存的修改' : '与已读取配置一致' }}</span>
              <button class="secondary" type="button" :disabled="saving || loading" @click="reloadSection">重新读取</button>
              <button class="save" type="button" :disabled="saving || loading || loadedId !== currentId" @click="saveSection(false)">{{ saving ? '保存中……' : '保存本节' }}</button>
              <button class="secondary" type="button" :disabled="saving || loading || loadedId !== currentId" @click="saveSection(true)">保存并重载</button>
            </div>
          </div>
        </template>
        <div v-else-if="!loading && currentId" class="hint">本节读取失败。<button class="secondary" @click="reloadSection">重新读取</button></div>
        <div v-else-if="!loading && menu.length" class="hint">选择配置节以查看和编辑。</div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.cc { min-width: 0; }
.pg-head { margin-bottom: 1rem; }
.pg-head h2 { font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
.pg-head h2::before { content: ""; width: 10px; height: 10px; background: var(--fg3, #3b82f6); transform: rotate(45deg); }
.sub { opacity: .55; font-size: 12.5px; padding-left: 20px; }
.notice { border-left: 3px solid #14b8a6; background: rgba(20,184,166,.08); padding: 11px 14px; font-size: 12.5px; margin-bottom: 12px; }
.notice.warn { border-color: #b45309; background: rgba(180,83,9,.08); }
.layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 24px; align-items: start; }
.menu { min-width: 0; font-size: 13px; position: sticky; top: 0; max-height: calc(100vh - 160px); overflow-y: auto; padding: 4px; }
.group { padding: 9px 10px 4px; opacity: .5; font-size: 10.5px; letter-spacing: 1.5px; text-transform: uppercase; }
.item { width: 100%; text-align: left; border: 0; background: transparent; color: inherit; font: inherit; display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 9px 12px; border-left: 2.5px solid transparent; opacity: .85; cursor: pointer; user-select: none; }
.item:hover:not(.off) { opacity: .95; }
.item.on { opacity: 1; border-left-color: var(--fg3, #3b82f6); background: rgba(128,128,128,.06); }
.item.off { opacity: .35; cursor: default; }
.stage { font-size: 9.5px; letter-spacing: .5px; border: 1px solid var(--bg3, rgba(128,128,128,.3)); padding: 1px 5px; opacity: .9; }
.content { min-width: 0; }
.card { background: var(--bg1, rgba(128,128,128,.05)); border: 1px solid var(--bg3, rgba(128,128,128,.15)); padding: 14px 16px; }
.card h3 { font-size: 11.5px; opacity: .55; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
.sq { width: 8px; height: 8px; background: #14b8a6; }
.card:hover .sq { transform: rotate(45deg) scale(1.15); }
.hint { font-size: 11.5px; opacity: .5; margin-bottom: 12px; }
.actions { position: sticky; bottom: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 24px -16px -14px; padding: 16px; border-top: 1px solid var(--k-color-divider, #8883); background: var(--k-card-bg, #24272e); border-radius: 0 0 10px 10px; }
.save { border: 1px solid var(--fg3, #3b82f6); background: transparent; color: var(--fg3, #3b82f6); font: inherit; font-size: 13px; padding: 7px 22px; cursor: pointer; }
.save:hover:not(:disabled) { background: rgba(59,130,246,.1); }
.save:disabled { opacity: .4; cursor: wait; }
.search { display: grid; gap: 6px; font-size: 12px; margin: 4px 8px 10px; }
.search input { min-width: 0; width: 100%; border: 1px solid var(--k-color-divider, #8885); background: var(--k-input-bg, transparent); color: inherit; font: inherit; border-radius: 6px; padding: 8px 10px; }
.menu-summary { font-size: 11px; opacity: .7; padding: 0 10px 8px; }
.secondary { border: 1px solid var(--k-color-divider, #8885); color: inherit; background: transparent; padding: 7px 14px; cursor: pointer; }
.secondary:disabled { opacity: .5; cursor: default; }
.save-state { margin-right: auto; font-size: 12px; opacity: .8; }
@media (max-width: 900px) {
  .layout { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .menu { position: static; max-height: 240px; border: 1px solid var(--k-color-divider, #8883); border-radius: 8px; }
  .actions { gap: 8px; }
  .save-state { width: 100%; }
}
</style>
