<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, type Component } from 'vue'
import { useRoute } from 'vue-router'
import { store } from './store'
import IconSet from './IconSet.vue'

defineOptions({ name: 'HdsiApp' })

const pages: Array<{ id: string, path: string, label: string, group: string, icon: string, badge?: string, component: Component }> = [
  { id: 'overview', path: '/hdsi/overview', label: '概览', group: '运行', icon: 'overview', component: defineAsyncComponent(() => import('./pages/OverviewPage.vue')) },
  { id: 'config-center', path: '/hdsi/config-center', label: '配置中心', group: '配置', icon: 'center', component: defineAsyncComponent(() => import('./pages/ConfigCenterPage.vue')) },
  { id: 'config', path: '/hdsi/config', label: '当前故事', group: '配置', icon: 'config', component: defineAsyncComponent(() => import('./pages/ConfigPage.vue')) },
  { id: 'desk', path: '/hdsi/desk', label: '考据案头', group: '观测', icon: 'desk', component: defineAsyncComponent(() => import('./pages/DeskPage.vue')) },
  { id: 'actions', path: '/hdsi/actions', label: '通信动作', group: '观测', icon: 'actions', component: defineAsyncComponent(() => import('./pages/ActionsPage.vue')) },
  { id: 'density', path: '/hdsi/density', label: '上下文预算', group: '观测', icon: 'density', component: defineAsyncComponent(() => import('./pages/DensityPage.vue')) },
]

const route = useRoute()
const activeId = computed(() => {
  const raw = route.params.page
  const first = Array.isArray(raw) ? raw[0] : raw
  return pages.some(p => p.id === first) ? first : 'overview'
})

const needsOverview = computed(() => !['config', 'config-center', 'actions'].includes(activeId.value))
const overview = ref<any>(null)
const loading = ref(true)
const failed = ref('')

let overviewRequest = 0
let disposed = false
onUnmounted(() => { disposed = true; overviewRequest++ })

async function refreshOverview() {
  if (disposed) return
  const request = ++overviewRequest
  const current = () => !disposed && request === overviewRequest
  loading.value = true
  failed.value = ''
  try {
    const result = await store.overview()
    if (!current()) return
    if (!result) throw new Error('Console 连接尚未就绪，请重试。')
    overview.value = result
  } catch (error: any) {
    if (current()) failed.value = error?.message ?? String(error)
  } finally {
    if (current()) loading.value = false
  }
}

onMounted(refreshOverview)
</script>

<template>
  <k-layout main="hdsi-layout">
    <template #header><span class="hdsi-host-title">HDSI <small>{{ overview?.version ?? '写作工作台' }}</small></span></template>
  <div class="hdsi-shell">
    <header class="topbar">
      <nav class="tabs">
        <router-link
          v-for="page in pages"
          :key="page.id"
          :to="page.path"
          class="tab"
          :class="{ on: activeId === page.id }"
        >
          <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><IconSet :name="page.icon" /></svg>
          {{ page.label }}
        </router-link>
      </nav>
    </header>
    <main class="main">
      <template v-if="needsOverview && !overview">
        <div v-if="loading" class="notice info">正在连接 HDSI 数据服务……</div>
        <div v-else class="notice warn">
          数据服务不可用：{{ failed }}
          <button class="refresh" @click="refreshOverview">重试</button>
        </div>
      </template>
      <template v-else>
        <div v-if="needsOverview" class="snapshot-actions">
          <span v-if="failed" class="notice warn">刷新失败：{{ failed }}，当前展示上次快照。</span>
          <button class="refresh" :disabled="loading" @click="refreshOverview">{{ loading ? '刷新中……' : '刷新概览' }}</button>
        </div>
        <component :is="pages.find(p => p.id === activeId)!.component" :overview="overview" />
      </template>
    </main>
  </div>
  </k-layout>
</template>

<style scoped>
.hdsi-shell { display: flex; flex-direction: column; min-height: 0; padding: 24px; box-sizing: border-box; width: 100%; max-width: 1560px; margin: 0 auto; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
.topbar { display: flex; align-items: center; gap: 16px; padding: 0 0 10px; border-bottom: 1px solid var(--bg3, rgba(128,128,128,.15)); margin-bottom: 12px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.brand-mark { width: 18px; height: 18px; flex-shrink: 0; position: relative; }
.brand-mark::before { content: ""; position: absolute; inset: 0; border: 1.5px solid var(--fg3, #3b82f6); transform: rotate(45deg); }
.brand-mark::after { content: ""; position: absolute; inset: 5px; background: var(--fg3, #3b82f6); transform: rotate(45deg); }
.brand-name { font-size: 13px; font-weight: 700; white-space: nowrap; }
.brand-name small { opacity: .5; font-weight: 400; font-size: 10px; margin-left: 4px; }
.tabs { display: flex; gap: 2px; flex-wrap: wrap; }
.tab { display: flex; align-items: center; gap: 6px; padding: 5px 12px; border-bottom: 2px solid transparent; opacity: .55; text-decoration: none; color: inherit; font-size: 12.5px; white-space: nowrap; }
.tab:hover { opacity: .85; }
.tab.on { opacity: 1; border-bottom-color: var(--fg3, #3b82f6); }
.glyph { width: 13px; height: 13px; }
.main { flex: 1; min-width: 0; }
.notice { border-left: 3px solid; padding: 11px 14px; font-size: 12.5px; }
.notice.info { border-color: var(--fg3, #3b82f6); background: rgba(59,130,246,.08); }
.notice.warn { border-color: #b45309; background: rgba(180,83,9,.08); }
.snapshot-actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-bottom: 10px; }
.refresh { border: 1px solid var(--k-color-primary, #3b82f6); background: transparent; color: var(--k-color-primary, #3b82f6); font: inherit; font-size: 12px; padding: 5px 12px; cursor: pointer; }
.refresh:disabled { opacity: .5; cursor: wait; }
</style>
