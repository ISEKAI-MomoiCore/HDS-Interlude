<script setup lang="ts">
import DataRow from '../components/DataRow.vue'

defineOptions({ name: 'DeskPage' })
defineProps<{ overview: any }>()
</script>

<template>
  <div v-if="overview">
    <div class="pg-head">
      <div>
        <h2>考据案头</h2>
        <div class="sub">经核实的写作参考；资料可供作者使用，主角知情范围由剧情证据决定。</div>
      </div>
    </div>
    <div class="grid">
      <div class="card">
        <h3><span class="sq" />案头概况</h3>
        <DataRow label="在架条目" :value="overview.research.deskEntries" info="在架的核实事实数（稳定+易变，TTL 过期淘汰）" range="案头容量 2-32，默认 8" />
        <DataRow label="搜索后端" :value="overview.research.backend" state="acc" info="考据检索的网络后端" range="auto/tavily/bocha/searxng/duckduckgo-html" />
        <DataRow label="查询缓存" :value="`${overview.research.cache.size} 条（命中 ${overview.research.cache.hits} / 未命中 ${overview.research.cache.misses}）`" info="搜索查询结果缓存——命中可省一次网络检索" />
        <DataRow label="累计写入 / 复用 / 淘汰" :value="`${overview.research.counters.offered} / ${overview.research.counters.reused} / ${overview.research.counters.evicted}`" info="写入案头 / 复用已有条目 / 容量与 TTL 淘汰（重载归零）" />
      </div>
      <div class="card">
        <h3><span class="sq" />Jev 决策门控</h3>
        <DataRow label="状态" :value="overview.research.jev.enabled ? (overview.research.jev.keyConfigured ? '已启用' : '已开启 · 待配置密钥') : '未启用'" :state="overview.research.jev.enabled ? (overview.research.jev.keyConfigured ? 'ok' : 'warn') : ''" info="自动生活推进前的考据判定；同时受考据总开关控制" />
        <DataRow label="判定 / 触发" :value="`${overview.research.jev.calls} / ${overview.research.jev.triggered}`" info="判定=门控调用次数，触发=判定 TRUE 放行先查后写（重载归零）" />
        <div v-if="!overview.research.jev.enabled" class="notice info" style="margin-top:8px">如需在生活推进前判定是否查证，可在配置中心的「考据 Agent」中配置 Jev 密钥并启用门控。</div>
      </div>
    </div>
    <div class="notice info" style="margin-top:12px">当前页展示案头数量、缓存与门控的汇总状态；资料的使用情况可结合写作记录和考据日志核对。</div>
  </div>
</template>

<style scoped>
.pg-head { margin-bottom: 1rem; }
.pg-head h2 { font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
.pg-head h2::before { content: ""; width: 10px; height: 10px; background: var(--fg3, #3b82f6); transform: rotate(45deg); }
.sub { opacity: .55; font-size: 12.5px; padding-left: 20px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.card { background: var(--bg1, rgba(128,128,128,.05)); border: 1px solid var(--bg3, rgba(128,128,128,.15)); padding: 14px 16px; }
.card h3 { font-size: 11.5px; opacity: .55; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.sq { width: 8px; height: 8px; background: #14b8a6; }
.notice { border-left: 3px solid var(--fg3, #3b82f6); background: rgba(59,130,246,.08); padding: 11px 14px; font-size: 12.5px; }
.notice.warn { border-color: #b45309; background: rgba(180,83,9,.08); }
</style>
