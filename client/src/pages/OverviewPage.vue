<script setup lang="ts">
import { computed } from 'vue'
import DataRow from '../components/DataRow.vue'

defineOptions({ name: 'OverviewPage' })
const props = defineProps<{ overview: any }>()
const statusLabels: Record<string, string> = { active: '活动中', paused: '已暂停', archived: '已归档' }
const rhythmLabels: Record<string, string> = { asleep: '睡眠', resting: '休息', occupied: '忙碌', available: '空闲', normal: '日常', active: '活跃', 'phone-focused': '关注消息', focused: '专注' }
const rhythm = computed(() => rhythmLabels[props.overview?.story?.rhythm] ?? props.overview?.story?.rhythm ?? '未建立')
const modelLabels: Record<string, string> = { main: '主叙事', compaction: '记忆整理', timeline: '时间导演', alter: '情绪分析', embedding: '向量检索', stickers: '表情包描述', vision: '视觉理解', research: '考据检索' }

const SWITCH_INFO: Record<string, string> = {
  allowProactiveMessages: '主角可主动发起可见消息（非回复式）',
  urge: '依据生活节奏和对话密度安排后台补写；人物是否联系他人由主叙事形成动作',
  sceneConditions: '设备、隐私和负荷的有效场景证据；缺失或过期时显示未知',
  deliveryPolicy: '管理员设置的主动出站运行额度和间隔；人物动机由主叙事决定',
  research: '考据 Agent：人物形成查证动作后，后台核实并写入考据案头，供后续写作参考',
  jev: '生活推进前的外部考据判定；命中时先检索资料，再继续写作',
}
</script>

<template>
  <div v-if="overview">
    <div class="pg-head">
      <div>
        <h2>概览</h2>
        <div class="sub">当前故事 · 模型用途 · 运行边界 · 考据状态</div>
      </div>
    </div>
    <div v-if="overview.story?.found" class="notice info">
      <b>{{ overview.story.characterName }}</b> · {{ statusLabels[overview.story.status] ?? overview.story.status }} · 当前节奏 {{ rhythm }}。剧情时间 <code>{{ overview.story.cursorLocal }}</code>，共 <b>{{ overview.story.entryCount }}</b> 条剧本记录。
    </div>
    <div v-else class="notice">当前还没有故事。先在配置中心填写故事档案和模型，再从聊天启动故事。</div>
    <div class="grid">
      <div class="card">
        <h3><span class="sq" />故事状态</h3>
        <DataRow label="主角" :value="overview.story.characterName || '—'" info="主角姓名，出现在全部叙事中" range="任意非空中文/英文" />
        <DataRow label="关系人数" :value="overview.story.participantCount" info="已登记的参与者（跨会话共享同一故事）" />
        <DataRow label="故事状态" :value="statusLabels[overview.story.status] ?? overview.story.status" :state="overview.story.status === 'active' ? 'ok' : ''" info="active=活动 / paused=暂停 / archived=归档" />
        <DataRow label="节奏" :value="rhythm" state="acc" info="主角当前的生活节奏/注意力，由时间与近况推得" />
      </div>
      <div class="card">
        <h3><span class="sq" />模型连接</h3>
        <DataRow v-for="m in overview.models" :key="m.task" :label="modelLabels[m.task] ?? m.task"
          :value="`${m.provider} · ${m.model}`" :state="m.available ? 'ok' : m.reason === 'disabled' ? '' : 'warn'"
          info="按模型中心的用途配置解析出的连接与模型；该状态表示配置匹配，不表示网络探活成功" />
      </div>
      <div class="card">
        <h3><span class="sq" />系统开关</h3>
        <DataRow v-for="sw in overview.switches" :key="sw.key" :label="sw.label" :value="sw.value"
          :state="sw.ok === true ? 'ok' : sw.ok === false ? 'warn' : ''" :info="SWITCH_INFO[sw.key]" />
      </div>
      <div class="card">
        <h3><span class="sq" />考据 Agent</h3>
        <DataRow label="状态" :value="overview.research.enabled ? '开启' : '关闭'" :state="overview.research.enabled ? 'ok' : ''" info="考据总开关，可在配置中心的「考据 Agent」中修改" />
        <DataRow label="搜索后端" :value="overview.research.backend" state="acc" info="考据检索的网络后端" range="auto/tavily/bocha/searxng/duckduckgo-html" />
        <DataRow label="案头条目" :value="overview.research.deskEntries" info="在架的核实事实数（稳定+易变，TTL 过期淘汰）" range="案头容量 2-32" />
        <DataRow label="写入 / 复用" :value="`${overview.research.counters.offered} / ${overview.research.counters.reused}`" info="累计写入案头 / 复用已有条目（重载归零）" />
        <DataRow label="Jev 门控" :value="overview.research.jev.enabled ? (overview.research.jev.keyConfigured ? `判定 ${overview.research.jev.calls} / 触发 ${overview.research.jev.triggered}` : '已开启 · 待配置密钥') : '未启用'"
          :state="overview.research.jev.enabled ? (overview.research.jev.keyConfigured ? 'ok' : 'warn') : ''" info="判定=门控调用次数，触发=判定 TRUE 放行先查后写" />
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
