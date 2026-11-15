<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, type Component } from 'vue'
import { useRoute } from 'vue-router'
import { store } from './store'
import IconSet from './IconSet.vue'

defineOptions({ name: 'HdsiApp' })

const pages: Array<{ id: string, path: string, label: string, group: string, icon: string, badge?: string, component: Component }> = [
  { id: 'overview', path: '/hdsi-cev/overview', label: '概览', group: '运行', icon: 'overview', component: defineAsyncComponent(() => import('./pages/OverviewPage.vue')) },
  { id: 'config', path: '/hdsi-cev/config', label: '主配置', group: '配置', icon: 'config', component: defineAsyncComponent(() => import('./pages/ConfigPage.vue')) },
  { id: 'desk', path: '/hdsi-cev/desk', label: '考据案头', group: '观测', icon: 'desk', component: defineAsyncComponent(() => import('./pages/DeskPage.vue')) },
  { id: 'density', path: '/hdsi-cev/density', label: '密度与预算', group: '观测', icon: 'density', component: defineAsyncComponent(() => import('./pages/DensityPage.vue')) },
]

const route = useRoute()
const activeId = computed(() => {
  const raw = route.params.page
  const first = Array.isArray(raw) ? raw[0] : raw
  return pages.some(p => p.id === first) ? first : 'overview'
})

const overview = ref<any>(null)
const loading = ref(true)
const failed = ref('')

onMounted(async () => {
  try {
    overview.value = await store.overview()
  } catch (error: any) {
    failed.value = error?.message ?? String(error)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="hdsi-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark" />
        <div>
          <h1>HDS Interlude</h1>
          <small>幕间系统 · {{ overview?.version ?? '…' }}</small>
        </div>
      </div>
      <template v-for="group in ['运行', '配置', '观测']" :key="group">
        <div class="group">{{ group }}</div>
        <router-link
          v-for="page in pages.filter(p => p.group === group)"
          :key="page.id"
          :to="page.path"
          class="nav-item"
          :class="{ on: activeId === page.id }"
        >
          <svg class="glyph"><IconSet :name="page.icon" /></svg>
          {{ page.label }}
          <span v-if="page.badge" class="badge">{{ page.badge }}</span>
        </router-link>
      </template>
    </aside>
    <main class="main">
      <div v-if="loading" class="notice info">正在连接 HDSI 数据服务……</div>
      <div v-else-if="failed" class="notice warn">数据服务不可用：{{ failed }}。请确认 HDSI 插件已启用。</div>
      <component v-else :is="pages.find(p => p.id === activeId)!.component" :overview="overview" />
    </main>
  </div>
</template>

<style scoped>
.hdsi-shell { display: flex; min-height: calc(100vh - 2rem); font-family: 'Outfit', system-ui, sans-serif; }
.sidebar { width: 204px; flex-shrink: 0; padding: 1.2rem 0; font-size: 13.5px; }
.brand { display: flex; gap: 10px; align-items: center; padding: 0 16px 14px; margin-bottom: 8px; border-bottom: 1px solid var(--bg3, rgba(128,128,128,.15)); }
.brand-mark { width: 30px; height: 30px; flex-shrink: 0; position: relative; }
.brand-mark::before { content: ""; position: absolute; inset: 0; border: 2px solid var(--fg3, #3b82f6); transform: rotate(45deg); }
.brand-mark::after { content: ""; position: absolute; inset: 9px; background: var(--fg3, #3b82f6); transform: rotate(45deg); }
.brand h1 { font-size: 14.5px; line-height: 1.2; }
.brand small { opacity: .55; font-size: 10.5px; }
.group { padding: 10px 16px 4px; opacity: .5; font-size: 10.5px; letter-spacing: 1.5px; text-transform: uppercase; }
.nav-item { display: flex; align-items: center; gap: 10px; padding: 7.5px 16px; border-left: 2.5px solid transparent; opacity: .6; text-decoration: none; color: inherit; }
.nav-item:hover { opacity: .9; }
.nav-item.on { opacity: 1; border-left-color: var(--fg3, #3b82f6); background: rgba(128,128,128,.06); }
.glyph { width: 15px; height: 15px; }
.main { flex: 1; padding: 1.4rem 1.6rem; min-width: 0; }
.notice { border-left: 3px solid; padding: 11px 14px; font-size: 12.5px; }
.notice.info { border-color: var(--fg3, #3b82f6); background: rgba(59,130,246,.08); }
.notice.warn { border-color: #b45309; background: rgba(180,83,9,.08); }
</style>
