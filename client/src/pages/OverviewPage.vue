<script setup lang="ts">
import { computed } from 'vue'
import type { HdsiOverview } from '../../../src/console'
import DataRow from '../components/DataRow.vue'

defineOptions({ name: 'OverviewPage' })
const props = defineProps<{ overview: any }>()
const statusLabels: Record<string, string> = { active: '活动中', paused: '已暂停', archived: '已归档' }
const rhythmLabels: Record<string, string> = { 'device-focus-chat': '查看聊天', 'device-focus-other': '使用设备', 'busy-work': '专注事务', 'busy-play': '投入娱乐', 'avaliable-relax': '放松空闲', 'avaliable-tense': '警觉空闲', 'rest-conscious': '清醒休息', 'rest-dazed': '朦胧休息', asleep: '睡眠', resting: '休息', occupied: '忙碌', available: '空闲', normal: '日常', active: '活跃', 'phone-focused': '关注消息', focused: '专注' }
const rhythm = computed(() => rhythmLabels[props.overview?.story?.rhythm] ?? props.overview?.story?.rhythm ?? '未建立')
const attention = computed<HdsiOverview['story']['eventAttention']>(() => props.overview?.story?.eventAttention)
const attentionStatusLabels: Record<string, string> = {
  current: '有效', missing: '未建立 · 中性档', stale: '已过期 · 中性档', legacy: '旧档未细分 · 中性档',
}
const storedFocusLabel = computed(() => attention.value?.status === 'missing' ? '未建立'
  : `${rhythm.value}（${props.overview?.story?.rhythm}）`)
const tierLabels: Record<string, string> = { low: '低密度', normal: '日常', high: '高密度', burst: '密集对话' }
const modeLabel = (mode?: string) => mode === 'auto' ? '自动' : mode === 'fixed' ? '固定' : '—'
const modelLabels: Record<string, string> = { main: '主叙事', compaction: '记忆整理', timeline: '时间导演', alter: '情绪分析', embedding: '向量检索', stickers: '表情包描述', vision: '视觉理解', research: '考据检索' }

const SWITCH_INFO: Record<string, string> = {
  allowProactiveMessages: '主角可主动发起可见消息（非回复式）',
  urge: '依据生活节奏和对话密度安排后台补写；人物是否联系他人由主叙事形成动作',
  sceneConditions: '设备、隐私和负荷的有效场景证据，与 Focus 相互独立；设备可达性不参与当前 T 档标注',
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
        <div class="sub">故事现场、推进时钟、上下文预算与模型配置的当前快照</div>
      </div>
    </div>
    <div v-if="overview.story?.found" class="notice info">
      <b>{{ overview.story.characterName }}</b> · {{ statusLabels[overview.story.status] ?? overview.story.status }} · {{ attention && attention.status !== 'current' ? '已存 Focus' : '当前 Focus' }} {{ rhythm }}。剧情时间 <code>{{ overview.story.cursorLocal }}</code>，共 <b>{{ overview.story.entryCount }}</b> 条剧本记录。
    </div>
    <div v-else class="notice">当前还没有故事。先在配置中心填写故事档案和模型，再从聊天启动故事。</div>
    <div class="metrics" aria-label="关键指标">
      <div><span>剧本记录</span><strong>{{ overview.story?.entryCount ?? 0 }}</strong></div>
      <div><span>关系人数</span><strong>{{ overview.story?.participantCount ?? 0 }}</strong></div>
      <div><span>私聊上下文</span><strong>{{ overview.density?.budgets?.private?.count ?? overview.density?.effectiveLimit ?? '—' }} <small>条</small></strong></div>
      <div><span>群聊上下文</span><strong>{{ overview.density?.budgets?.group?.count ?? '—' }} <small>条</small></strong></div>
    </div>
    <div class="overview-columns">
      <div class="overview-stack">
      <div class="card">
        <h3><span class="sq" />故事状态</h3>
        <DataRow label="主角" :value="overview.story.characterName || '—'" info="主角姓名，出现在全部叙事中" range="任意非空中文/英文" />
        <DataRow label="关系人数" :value="overview.story.participantCount" info="已登记的参与者（跨会话共享同一故事）" />
        <DataRow label="故事状态" :value="statusLabels[overview.story.status] ?? overview.story.status" :state="overview.story.status === 'active' ? 'ok' : ''" info="active=活动 / paused=暂停 / archived=归档" />
        <DataRow v-if="!attention" label="生活节奏" :value="rhythm" state="acc" info="最近保存的生活节奏状态" />
        <DataRow label="场景地点" :value="overview.story.location || '待建立'" info="优先显示当前场景中的地点，缺失时显示故事档案的主要地点" />
        <DataRow label="正在进行" :value="overview.story.activity || '待建立'" info="来自已落库的场景状态" />
        <DataRow label="叙事焦点" :value="overview.story.focus || '待建立'" />
        <DataRow label="故事时区" :value="overview.story.timezone || '—'" />
        <div class="card-links"><router-link to="/hdsi/config">编辑当前故事</router-link><router-link to="/hdsi/actions">查看通信动作</router-link></div>
      </div>
      <div v-if="attention" class="card">
        <h3><span class="sq" />Focus 与事件注意度</h3>
        <DataRow label="已存 Focus" :value="storedFocusLabel" state="acc" info="主叙事在剧本提交后更新；压缩器可补写。收到私聊不会改变或续期 Focus。" />
        <DataRow label="标注依据" :value="attentionStatusLabels[attention.status] ?? '未知'" :state="attention.status === 'current' ? 'ok' : 'warn'"
          info="以概览读取时间判断，超过两小时使用中性行；旧档中仅有效的 asleep 可直接使用。" />
        <DataRow v-if="attention.assessedAtLocal" label="证据时间" :value="attention.assessedAtLocal" info="按故事时区显示的剧本证据时间" />
        <p class="attention-caption">按当前状态预览，非上次请求记录。T1 最容易被注意到，T5 最不容易；只给已有材料加标注，不改变顺序，也不表示已读或必须回复。</p>
        <DataRow label="私聊入站" :value="`T${attention.tiers.privateBatch}`" />
        <DataRow label="群聊入站 / 群聊背景" :value="`T${attention.tiers.groupBatch} / T${attention.tiers.groupBackground}`" />
        <DataRow label="社交动态" :value="`T${attention.tiers.friendFeed}`" />
        <DataRow label="实况天气基础档" :value="`T${attention.tiers.weather}`" info="恶劣天气前移两档，明显变化用基础档，其余后移一档；限定 T1–T5。不因分档增加新事件。" />
        <DataRow label="播种世界事件" value="按重要性 × 涉及程度" info="environment 为环境事件、involved 为直接涉及主角或其关系和事务。每条独立计算，不受 Focus 影响。" />
        <p class="attention-caption">设备可达性见「当前行动条件」，是独立状态；本功能不按它过滤消息。</p>
      </div>
      <div class="card">
        <h3><span class="sq" />推进时钟</h3>
        <DataRow label="剧情时间" :value="overview.story.cursorLocal || '—'" info="剧本已经推进到的故事时间" />
        <DataRow label="补写最早时间" :value="overview.story.nextAdvanceLocal || '尚未安排'" info="持久化的自动补写时钟；实际执行还取决于故事状态、任务队列和运行条件" />
        <DataRow label="上次自动补写" :value="overview.story.lastAdvanceLocal || '暂无记录'" />
        <DataRow label="对话后续时点" :value="overview.story.followUpCount ?? 0" info="已排定的对话后续时点数量" />
      </div>
      <div class="card">
        <h3><span class="sq" />系统开关</h3>
        <DataRow v-for="sw in overview.switches" :key="sw.key" :label="sw.label" :value="sw.value"
          :state="sw.ok === true ? 'ok' : sw.ok === false ? 'warn' : ''" :info="SWITCH_INFO[sw.key]" />
      </div>
      </div>
      <div class="overview-stack">
      <div class="card">
        <h3><span class="sq" />模型连接</h3>
        <DataRow v-for="m in overview.models" :key="m.task" :label="modelLabels[m.task] ?? m.task"
          :value="`${m.provider} · ${m.model}`" :state="m.available ? 'ok' : m.reason === 'disabled' ? '' : 'warn'"
          info="按模型中心的用途配置解析出的连接与模型；该状态表示配置匹配，不表示网络探活成功" />
      </div>
      <div class="card">
        <h3><span class="sq" />上下文与对话密度</h3>
        <DataRow label="密度档位" :value="tierLabels[overview.density?.tier] ?? '—'" info="根据近期对话频率确定，供自动上下文预算使用" />
        <DataRow label="5 / 15 / 30 分钟" :value="`${overview.density?.counts?.count5 ?? 0} / ${overview.density?.counts?.count15 ?? 0} / ${overview.density?.counts?.count30 ?? 0}`" info="各时间窗内的对话计数" />
        <DataRow label="私聊模式" :value="modeLabel(overview.density?.budgets?.private?.mode ?? overview.density?.mode)" />
        <DataRow label="群聊模式" :value="modeLabel(overview.density?.budgets?.group?.mode)" />
        <DataRow label="时间窗口" :value="overview.density?.budgets?.private?.minutes === 0 ? '不限时间' : `${overview.density?.budgets?.private?.minutes ?? '—'} 分钟`" info="与条目预算共同约束普通用户消息回合的近期上下文" />
        <div class="card-links"><router-link to="/hdsi/density">查看密度详情</router-link><router-link to="/hdsi/config-center">调整配置</router-link></div>
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
  </div>
</template>

<style scoped>
.pg-head { margin-bottom: 1rem; }
.pg-head h2 { font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
.pg-head h2::before { content: ""; width: 10px; height: 10px; background: var(--fg3, #3b82f6); transform: rotate(45deg); }
.sub { opacity: .55; font-size: 12.5px; padding-left: 20px; }
.notice { border-left: 3px solid var(--fg3, #3b82f6); background: rgba(59,130,246,.08); padding: 11px 14px; font-size: 12.5px; margin-bottom: 12px; }
code { background: rgba(0,0,0,.25); padding: 1px 6px; font-family: 'Cascadia Code', monospace; font-size: .9em; }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.metrics > div { border: 1px solid var(--k-color-divider, #8883); border-radius: 10px; padding: 12px 16px; background: var(--k-card-bg, transparent); }
.metrics span { display: block; font-size: 12px; opacity: .75; }
.metrics strong { display: block; font-size: 24px; font-variant-numeric: tabular-nums; }
.metrics small { font-size: 12px; font-weight: 400; }
.overview-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
.overview-stack { display: grid; gap: 16px; min-width: 0; }
.attention-caption { font-size: 12px; line-height: 1.65; opacity: .78; margin: 10px 0 4px; }
.card-links { display: flex; flex-wrap: wrap; gap: 16px; border-top: 1px solid var(--k-color-divider, #8883); padding-top: 12px; margin-top: 12px; font-size: 12px; }
.card-links a { color: var(--k-color-primary, #6754cf); }
@media (max-width: 850px) { .overview-columns { grid-template-columns: minmax(0, 1fr); } .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.card { background: var(--bg1, rgba(128,128,128,.05)); border: 1px solid var(--bg3, rgba(128,128,128,.15)); padding: 14px 16px; }
.card h3 { font-size: 11.5px; opacity: .55; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.sq { width: 8px; height: 8px; background: #14b8a6; }
.card:hover .sq { transform: rotate(45deg) scale(1.15); }
</style>
