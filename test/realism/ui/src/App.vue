<script setup lang="ts">
import { computed } from 'vue'
import { store, refreshState } from './store'
import { post } from './api'

const nav = [
  { path: '/', label: '总览', icon: '▦' },
  { path: '/run', label: '运行', icon: '▶' },
  { path: '/review', label: '评审', icon: '✎' },
  { path: '/compare', label: '对比', icon: '⇄' },
  { path: '/settings', label: 'Profile', icon: '⚙' },
]

const statusText = computed(() => {
  if (!store.loaded) return '连接中…'
  if (store.campaign.running) return `运行中 ${store.campaign.current}`
  const done = store.campaign.states.filter(s => s.status === 'done').length
  return done ? `${done} 段已完成` : '空闲'
})
const missingWarn = computed(() => store.env.missing.length ? `缺 ${store.env.missing.join('/')}` : '')

async function switchProfile(event: Event): Promise<void> {
  const name = (event.target as HTMLSelectElement).value
  try { await post('/api/profile/activate', { name }); await refreshState() }
  catch (error) { alert((error as Error).message) }
}
</script>

<template>
  <div class="sidebar">
    <div class="logo">Realism Lab<small>拟真度评价体系</small></div>
    <label class="fld" style="padding:0 6px;">
      <span style="font-size:10px;">Profile</span>
      <select :value="store.activeProfile" style="width:100%; font-size:11px;" @change="switchProfile">
        <option v-for="name in store.profiles" :key="name" :value="name">{{ name }}</option>
      </select>
    </label>
    <router-link v-for="item in nav" :key="item.path" :to="item.path">
      <span>{{ item.icon }} {{ item.label }}</span>
      <span class="badge" v-if="item.path === '/' && store.campaign.running">●</span>
    </router-link>
    <div class="spacer"></div>
    <div class="status-line">
      <div><b>{{ statusText }}</b></div>
      <div>{{ store.env.model || '未配置模型' }}</div>
      <div v-if="missingWarn" class="warn">{{ missingWarn }}</div>
    </div>
  </div>
  <div class="main">
    <router-view />
  </div>
</template>
