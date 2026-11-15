<script setup lang="ts">
import DataRow from '../components/DataRow.vue'

defineOptions({ name: 'OverviewPage' })
defineProps<{ overview: any }>()

const SWITCH_INFO: Record<string, string> = {
  allowProactiveMessages: '主角可主动发起可见消息（非回复式）',
  urge: 'Urge 弹性推进——安静期的主动接触节奏器',
  agency: 'Agency 窗口——主角自主行动的联系通道',
  research: '考据 Agent：她承诺去查 → 后台核实 → 案头供作者参考',
  jev: '被动推进前的是非门控（毫秒级），TRUE 才先查后写',
}
</script>

<template>
  <div v-if="overview">
    <div class="pg-head">
      <div>
        <h2>概览</h2>
        <div class="sub">主角状态 · 模型连接 · 系统开关 · 健康指标</div>
      </div>
    </div>
    <div v-if="overview.story?.found" class="notice info">
      <b>{{ overview.story.characterName }}</b> 正在活动——节奏 <code>{{ overview.story.rhythm }}</code>。游标已写到 <code>{{ overview.story.cursorLocal }}</code>，剧本条目 <b>{{ overview.story.entryCount }}</b>。
    </div>
    <div class="grid">
      <div class="card">
        <h3><span class="sq" />故事状态</h3>
        <DataRow label="主角" :value="overview.story.characterName || '—'" info="主角姓名，出现在全部叙事中" range="任意非空中文/英文" />
        <DataRow label="关系人数" :value="overview.story.participantCount" info="已登记的参与者（跨会话共享同一故事）" />
        <DataRow label="故事状态" :value="overview.story.status" state="ok" info="active=活动 / paused=暂停 / archived=归档" />
        <DataRow label="节奏" :value="overview.story.rhythm" state="acc" info="主角当前的生活节奏/注意力，由时间与近况推得" />
      </div>
      <div class="card">
        <h3><span class="sq" />模型连接</h3>
        <DataRow v-for="m in overview.models" :key="m.task" :label="m.task"
          :value="`${m.provider} · ${m.model}`" :state="m.available ? 'ok' : 'warn'"
          info="该任务路由到的提供商 · 模型（模型中心勾选决定）" />
      </div>
      <div class="card">
        <h3><span class="sq" />系统开关</h3>
        <DataRow v-for="sw in overview.switches" :key="sw.key" :label="sw.label" :value="sw.value"
          :state="sw.ok === true ? 'ok' : sw.ok === false ? 'warn' : ''" :info="SWITCH_INFO[sw.key]" />
      </div>
      <div class="card">
        <h3><span class="sq" />考据 Agent</h3>
        <DataRow label="状态" :value="overview.research.enabled ? '开启' : '关闭'" :state="overview.research.enabled ? 'ok' : ''" info="考据总开关（可在主配置页改）" />
        <DataRow label="搜索后端" :value="overview.research.backend" state="acc" info="考据检索的网络后端" range="auto/tavily/bocha/searxng/duckduckgo-html" />
        <DataRow label="案头条目" :value="overview.research.deskEntries" info="在架的核实事实数（稳定+易变，TTL 过期淘汰）" range="案头容量 2-32" />
        <DataRow label="写入 / 复用" :value="`${overview.research.counters.offered} / ${overview.research.counters.reused}`" info="累计写入案头 / 复用已有条目（重载归零）" />
        <DataRow label="Jev 门控" :value="overview.research.jev.enabled ? `判定 ${overview.research.jev.calls} / 触发 ${overview.research.jev.triggered}` : '未配置 Key'"
          :state="overview.research.jev.enabled ? 'ok' : 'warn'" info="判定=门控调用次数，触发=判定 TRUE 放行先查后写" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.pg-head { margin-bottom: 1rem; }
.pg-head h2 { font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
.pg-head h2::before { content: ""; width: 10px; height: 10px; background: var(--fg3, #3b82f6); transform: rotate(45deg); }
.sub { opacity: .55; font-size: 12.5px; padding-left: 20px; }
.notice { border-left: 3px solid var(--fg3, #3b82f6); background: rgba(59,130,246,.08); padding: 11px 14px; font-size: 12.5px; margin-bottom: 12px; }
code { background: rgba(0,0,0,.25); padding: 1px 6px; font-family: 'Cascadia Code', monospace; font-size: .9em; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.card { background: var(--bg1, rgba(128,128,128,.05)); border: 1px solid var(--bg3, rgba(128,128,128,.15)); padding: 14px 16px; }
.card h3 { font-size: 11.5px; opacity: .55; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.sq { width: 8px; height: 8px; background: #14b8a6; }
.card:hover .sq { transform: rotate(45deg) scale(1.15); }
</style>
