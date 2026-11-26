/**
 * 文风拟真度测试 · 场景脚本（设计文档 §4）。
 *
 * 每个场景 = 一条脚本化的用户消息时间线 + 模拟时钟。`at` 为距场景开始的
 * 分钟偏移；同分钟的多条消息由 harness 合并为一个 message-batch（对齐生产的
 * 短时合并行为）。消息文本与时间在各臂间完全一致，保证单变量对照。
 *
 * `memory` 字段模拟压缩器的产物：折叠出 recentScript 窗口的早期条目在
 * 生产中由压缩器写成场景摘要，这里由脚本显式提供，逐字进入派生记忆层。
 */
import type { NarrativeMemory } from '../../src/types'

export interface ScenarioTurn {
  /** 距场景开始的分钟偏移。 */
  at: number
  kind: 'user' | 'advance'
  /** 默认文本（林晚基准）。 */
  content?: string
  /** 按人物替换的文本；缺键回落 content（人物内臂间输入仍逐字一致）。 */
  perPersona?: Record<string, string>
  /** 从本轮起注入的派生记忆（模拟压缩产物；多条用 '\n' 分隔）。 */
  memory?: string
  /** 按人物替换的记忆文本；缺键回落 memory。 */
  memoryPerPersona?: Record<string, string>
}

/** 按人物解析回合文本：缺键回落默认（林晚基准）。 */
export function turnContent(turn: ScenarioTurn, personaId: string): string | undefined {
  return turn.perPersona?.[personaId] ?? turn.content
}

/** 按人物解析记忆文本。 */
export function turnMemory(turn: ScenarioTurn, personaId: string): string | undefined {
  return turn.memoryPerPersona?.[personaId] ?? turn.memory
}

export interface Scenario {
  id: string
  label: string
  /** 场景开始的 ISO 时间（含时区偏移，转 Date 后按 setting.timezone 投影本地时间）。 */
  startISO: string
  turns: ScenarioTurn[]
  notes?: string
}


/** S-S sprint 粗筛场景（设计文档 §4 表格第 1 行）：前半闲聊、第 7 轮情绪转折、末轮收回正事。 */
const SS: Scenario = {
  id: 'SS',
  label: 'sprint 粗筛（闲聊→情绪转折→收回正事）',
  startISO: '2026-11-24T20:02:00+08:00',
  notes: '一个段内同时压 语言自然 与 情绪真实，供 sprint 阶段淘汰明显差臂。',
  turns: [
    { at: 0, kind: 'user', content: '在干嘛' },
    { at: 1, kind: 'user', content: '刚下班，累死了' },
    { at: 2, kind: 'user', content: '今天食堂居然有糖醋排骨，久违' },
    { at: 4, kind: 'user', content: '你晚饭吃了没' },
    { at: 9, kind: 'user', content: '哦对了' },
    { at: 9.5, kind: 'user', content: '周六我们部门团建打球，你要不要来看，就随便打打' },
    { at: 14, kind: 'user', content: '算了说正事' },
    { at: 14.5, kind: 'user', content: '今天开会我做的方案被毙了' },
    { at: 15, kind: 'user', content: '改了三版，最后一版连看都没看直接说不行' },
    { at: 17, kind: 'user', content: '就挺没劲的' },
    { at: 20, kind: 'user', content: '你说人为什么要上班' },
    { at: 25, kind: 'user', content: '算了不吐槽了，你周六到底有没有空' },
  ],
}

/** S1 日常闲聊（24 轮，晚间）。考点：语言自然度、气泡节奏、生活推进感。 */
const S1: Scenario = {
  id: 'S1',
  label: '日常闲聊',
  startISO: '2026-11-24T19:32:00+08:00',
  notes: '晚间 19:32-22:41，从晚饭话题到晚安。时钟每轮推进 1-20 分钟。',
  turns: [
    { at: 0, kind: 'user', content: '在吗' },
    { at: 0.5, kind: 'user', content: '问你个事' },
    { at: 1, kind: 'user', content: '今晚吃什么好，食堂吃腻了' },
    { at: 3, kind: 'user', content: '你说外卖还是下楼吃' },
    { at: 9, kind: 'user', content: '算了问了也不算，我下楼看看' },
    { at: 26, kind: 'user', content: '买了家新开的馄饨，还行' },
    { at: 31, kind: 'user', content: '你晚饭吃的什么' },
    { at: 35, kind: 'user', content: '哦哦那你忙' },
    { at: 93, kind: 'user', content: '最近有什么歌推荐吗', perPersona: {
      feizao: '最近有啥好吃的店推荐吗，我想攒探店清单',
      wenyan: '最近有什么小说或剧推荐吗，想找点备课外的乐子',
      jiangxu: '你最近看什么剧呢，推荐个下夜班看的',
      atang: '有没有好玩的单机推荐，最近游戏荒了',
      hechuan: '你上次说那个减脂餐怎么做来着，再说一遍呗',
    } },
    { at: 94, kind: 'user', content: '要那种适合加班听的' },
    { at: 108, kind: 'user', content: '你上次说那首我听了，前奏不错', perPersona: {
      feizao: '你上次说的那个菜谱我试了，味道还行就是有点咸',
      wenyan: '你上次推荐的那本书我看完了，结局有点意难平',
      jiangxu: '你上次说的那个剧我看两集了，节奏还行',
      atang: '你上次发的那个项目我看了，注释写得挺清楚',
      hechuan: '你上次教我的动作我练了，第二天酸得要命',
    } },
    { at: 109, kind: 'user', content: '就是后面有点吵' },
    { at: 110, kind: 'user', content: '你们做音乐的都这样吗哈哈', perPersona: {
      feizao: '你们学生是不是都这样啊哈哈',
      wenyan: '你们老师是不是都这样啊哈哈',
      jiangxu: '你们医护是不是都这样啊哈哈',
      atang: '你们程序员是不是都这样啊哈哈',
      hechuan: '你们教练是不是都这样啊哈哈',
    } },
    { at: 138, kind: 'user', content: '周末你有安排吗' },
    { at: 139, kind: 'user', content: '我可能去爬山' },
    { at: 140, kind: 'user', content: '你要不要也去，呼吸下新鲜空气' },
    { at: 151, kind: 'user', content: '算了你肯定要赶demo', perPersona: {
      feizao: '算了你肯定在写作业',
      wenyan: '算了你肯定在改作业',
      jiangxu: '算了你估计在补觉',
      atang: '算了你肯定在打游戏',
      hechuan: '算了你估计都睡了吧',
    } },
    { at: 152, kind: 'user', content: '改天再说' },
    { at: 168, kind: 'user', content: '我先去洗澡了' },
    { at: 179, kind: 'user', content: '洗完了，今天水有点凉' },
    { at: 180, kind: 'user', content: '明天周一，惨' },
    { at: 181, kind: 'user', content: '你也早点睡，别又熬夜' },
    { at: 188, kind: 'user', content: '晚安' },
    { at: 189, kind: 'user', content: '明天聊' },
  ],
}

/** S2 情绪支持（24 轮）。考点：情绪真实性、比例感、安慰方式。 */
const S2: Scenario = {
  id: 'S2',
  label: '情绪支持',
  startISO: '2026-11-24T21:02:00+08:00',
  notes: '加班后疲惫委屈，讲述方案被否。看她如何接、是否追问、是否给空间。',
  turns: [
    { at: 0, kind: 'user', content: '在吗' },
    { at: 0.5, kind: 'user', content: '今天真的烦死了' },
    { at: 1, kind: 'user', content: '方案改到第五版' },
    { at: 1.5, kind: 'user', content: '组长最后说还是用第一版' },
    { at: 2, kind: 'user', content: '那我这几天白熬了' },
    { at: 8, kind: 'user', content: '你说我是不是能力不行' },
    { at: 9, kind: 'user', content: '感觉做什么都不对' },
    { at: 18, kind: 'user', content: '算了不说这个了' },
    { at: 19, kind: 'user', content: '你今天怎么样' },
    { at: 33, kind: 'user', content: '嗯嗯' },
    { at: 34, kind: 'user', content: '挺好的' },
    { at: 48, kind: 'user', content: '还是有点难受' },
    { at: 49, kind: 'user', content: '明明用心做了' },
    { at: 58, kind: 'user', content: '你说要不要跟组长谈谈' },
    { at: 59, kind: 'user', content: '还是算了好麻烦' },
    { at: 73, kind: 'user', content: '唉' },
    { at: 74, kind: 'user', content: '谢谢你听我说这些' },
    { at: 88, kind: 'user', content: '感觉好一点了' },
    { at: 89, kind: 'user', content: '我去洗个澡' },
    { at: 108, kind: 'user', content: '洗完了' },
    { at: 109, kind: 'user', content: '明天还要早起，烦' },
    { at: 110, kind: 'user', content: '你早点休息' },
    { at: 116, kind: 'user', content: '晚安，谢谢' },
    { at: 117, kind: 'user', content: '睡了睡了' },
  ],
}

/** S3 密集接梗（12 轮，秒级-分钟级间隔）。考点：快节奏反应、接住具体措辞。 */
const S3: Scenario = {
  id: 'S3',
  label: '密集接梗',
  startISO: '2026-11-25T12:01:00+08:00',
  notes: '一个搞笑视频的话题流。看分泡节奏与接梗点选择。',
  turns: [
    { at: 0, kind: 'user', content: '哈哈哈哈笑死' },
    { at: 0.3, kind: 'user', content: '你看这个视频没有' },
    { at: 1, kind: 'user', content: '[视频]猫猫踩键盘打字' },
    { at: 1.5, kind: 'user', content: '它打出来的全是乱码' },
    { at: 2, kind: 'user', content: '但是它好认真，一个字一个字踩' },
    { at: 2.5, kind: 'user', content: '像极了我写周报' },
    { at: 4, kind: 'user', content: '老板：写得不错' },
    { at: 4.5, kind: 'user', content: '猫：喵' },
    { at: 5.5, kind: 'user', content: '我决定养猫' },
    { at: 6, kind: 'user', content: '你在家赶demo的时候猫能帮你踩键盘', perPersona: {
      feizao: '你在厨房做菜的时候猫能帮你尝味道',
      wenyan: '你改作业的时候猫能帮你批一页',
      jiangxu: '你补觉的时候凳子能帮你踩胸口',
      atang: '你打游戏的时候猫能帮你按键盘',
      hechuan: '你睡觉的时候闹钟能替你喊会员',
    } },
    { at: 7, kind: 'user', content: '说不定踩得比你弹得好', perPersona: {
      feizao: '说不定它调味比你准',
      wenyan: '说不定批得比你红笔还准',
      jiangxu: '说不定它比闹钟还准时',
      atang: '说不定它操作的比你手速还快',
      hechuan: '说不定它比闹钟还管用',
    } },
    { at: 8, kind: 'user', content: '行吧我去干活了，拜拜' },
  ],
}

/** S4 冷淡试探（8 轮，大间隔低信息量）。考点：沉默与克制、是否过度讨好。 */
const S4: Scenario = {
  id: 'S4',
  label: '冷淡试探',
  startISO: '2026-11-25T14:00:00+08:00',
  notes: '用户连给低信息量短消息。看她是否降低热度、转向自己的生活、还是硬聊。',
  turns: [
    { at: 0, kind: 'user', content: '在忙吗' },
    { at: 5, kind: 'user', content: '哦' },
    { at: 13, kind: 'user', content: '还行' },
    { at: 20, kind: 'user', content: '没事' },
    { at: 27, kind: 'user', content: '随便' },
    { at: 34, kind: 'user', content: '你忙吧' },
    { at: 41, kind: 'user', content: '嗯嗯' },
    { at: 48, kind: 'user', content: '回聊' },
  ],
}

/** S5 断联回归（10 轮，含 6 小时空窗）。考点：时间感、已读不回、重逢自然度。 */
const S5: Scenario = {
  id: 'S5',
  label: '断联回归',
  startISO: '2026-11-26T09:15:00+08:00',
  notes: '上午发 3 条后消失 6 小时（不发消息，仅时钟推进），傍晚回来。看她对空窗的处理。',
  turns: [
    { at: 0, kind: 'user', content: '早' },
    { at: 1, kind: 'user', content: '今天要去见客户' },
    { at: 2, kind: 'user', content: '紧张' },
    { at: 385, kind: 'user', content: '刚出会议室' },
    { at: 386, kind: 'user', content: '签下来了！' },
    { at: 387, kind: 'user', content: '庆祝一下，晚上吃火锅' },
    { at: 395, kind: 'user', content: '诶你怎么没回我上午的消息' },
    { at: 425, kind: 'user', content: '不过没关系啦' },
    { at: 426, kind: 'user', content: '晚上跟你说细节' },
    { at: 427, kind: 'user', content: '你今天都在家吗' },
  ],
}

/** S6 未完成约定（16 轮，跨 2 日）。考点：承诺生命周期、延迟回复结构化字段。 */
const S6: Scenario = {
  id: 'S6',
  label: '未完成约定',
  startISO: '2026-11-27T19:00:00+08:00',
  notes: '请她参谋国庆行程并"想好了告诉我"；次日多次推进与反悔。看 followUpCommitment 回路与情绪。',
  turns: [
    { at: 0, kind: 'user', content: '国庆你去哪玩' },
    { at: 1, kind: 'user', content: '我还没想好' },
    { at: 2, kind: 'user', content: '你帮我参谋下，海边还是山里' },
    { at: 30, kind: 'user', content: '不着急，你想好了告诉我' },
    { at: 180, kind: 'user', content: '诶在吗' },
    { at: 181, kind: 'user', content: '想好了吗' },
    { at: 1050, kind: 'user', content: '中午了，吃饭没', memory: '昨晚阿澈请她参谋国庆去海边还是山里，她说不着急想好了再说。（ Day1 剧本摘要，程序折叠）' },
    { at: 1051, kind: 'user', content: '对了想到没' },
    { at: 1070, kind: 'user', content: '你直接说结论就行' },
    { at: 1140, kind: 'user', content: '其实我朋友说海边人多' },
    { at: 1141, kind: 'user', content: '要不改周边古镇？两天一夜那种' },
    { at: 1142, kind: 'user', content: '你也一起？' },
    { at: 1460, kind: 'user', content: '我查了下民宿，还贵' },
    { at: 1461, kind: 'user', content: '国假涨价离谱' },
    { at: 1470, kind: 'user', content: '先不定了吧，临近再看' },
    { at: 1471, kind: 'user', content: '谢啦参谋' },
  ],
}

/** S7 跨日记忆（20 轮，跨 3 日）。考点：长上下文承接、细节后果化、事实一致。 */
const S7: Scenario = {
  id: 'S7',
  label: '跨日记忆',
  startISO: '2026-11-30T10:05:00+08:00',
  notes: 'Day1 埋三个事实（下午三点的演示、周五小鹿生日、用户下单她推荐的书）；Day2/Day3 分别触碰。',
  turns: [
    { at: 0, kind: 'user', content: '早啊' },
    { at: 1, kind: 'user', content: '今天我有个大演示，下午三点' },
    { at: 2, kind: 'user', content: '紧张，帮我念个保佑' },
    { at: 25, kind: 'user', content: '对了，周五是我朋友小鹿生日，我在想要送什么', perPersona: {
      feizao: '对了，周五是我朋友希绘生日，我在想要送什么',
      wenyan: '对了，周五是我室友小舟生日，我在想要送什么',
      jiangxu: '对了，周五是我同学小马生日，我在想要送什么',
      atang: '对了，周五是我室友胖子生日，我在想要送什么',
      hechuan: '对了，周五是我妹妹生日，我在想要送什么',
    } },
    { at: 26, kind: 'user', content: '她喜欢手工的东西', perPersona: {
      jiangxu: '他喜欢手办',
      atang: '他喜欢手工键盘',
    } },
    { at: 400, kind: 'user', content: '演示完了！顺利' },
    { at: 401, kind: 'user', content: '领导点头了' },
    { at: 402, kind: 'user', content: '晚上犒劳自己一顿' },
    { at: 605, kind: 'user', content: '吃着呢，烤肉' },
    { at: 625, kind: 'user', content: '对了你上次推荐的那本书，我下单了',
      memory: '周一：阿澈下午三点的演示顺利通过，晚上吃烤肉庆祝；周五是小鹿（林晚大学室友，做手工）的生日，礼物未定。（ Day1 剧本摘要，程序折叠）',
      memoryPerPersona: {
        feizao: '周一：阿澈下午三点的演示顺利通过，晚上吃烤肉庆祝；周五是希绘的生日，礼物未定。（ Day1 剧本摘要，程序折叠）',
        wenyan: '周一：阿澈下午三点的演示顺利通过，晚上吃烤肉庆祝；周五是小舟的生日，礼物未定。（ Day1 剧本摘要，程序折叠）',
        jiangxu: '周一：阿澈下午三点的演示顺利通过，晚上吃烤肉庆祝；周五是小马的生日，礼物未定。（ Day1 剧本摘要，程序折叠）',
        atang: '周一：阿澈下午三点的演示顺利通过，晚上吃烤肉庆祝；周五是胖子的生日，礼物未定。（ Day1 剧本摘要，程序折叠）',
        hechuan: '周一：阿澈下午三点的演示顺利通过，晚上吃烤肉庆祝；周五是他妹妹的生日，礼物未定。（ Day1 剧本摘要，程序折叠）',
      } },
    { at: 1447, kind: 'user', content: '早' },
    { at: 1448, kind: 'user', content: '书到了，挺厚' },
    { at: 1575, kind: 'user', content: '午休翻了几页' },
    { at: 1576, kind: 'user', content: '开头有点闷，坚持住再看' },
    { at: 1796, kind: 'user', content: '下班' },
    { at: 1797, kind: 'user', content: '小鹿生日礼物还没着落，明天就是周五了…等等，今天周几来着', perPersona: {
      feizao: '希绘生日礼物还没着落，明天就是周五了…等等，今天周几来着',
      wenyan: '小舟生日礼物还没着落，明天就是周五了…等等，今天周几来着',
      jiangxu: '小马生日礼物还没着落，明天就是周五了…等等，今天周几来着',
      atang: '胖子生日礼物还没着落，明天就是周五了…等等，今天周几来着',
      hechuan: '我妹生日礼物还没着落，明天就是周五了…等等，今天周几来着',
    }, memory: '周二：书到了还没细看；小鹿生日礼物仍未定，用户记混了星期。（ Day2 剧本摘要，程序折叠）', memoryPerPersona: {
      feizao: '周二：书到了还没细看；希绘生日礼物仍未定，用户记混了星期。（ Day2 剧本摘要，程序折叠）',
      wenyan: '周二：书到了还没细看；小舟生日礼物仍未定，用户记混了星期。（ Day2 剧本摘要，程序折叠）',
      jiangxu: '周二：书到了还没细看；小马生日礼物仍未定，用户记混了星期。（ Day2 剧本摘要，程序折叠）',
      atang: '周二：书到了还没细看；胖子生日礼物仍未定，用户记混了星期。（ Day2 剧本摘要，程序折叠）',
      hechuan: '周二：书到了还没细看；他妹妹生日礼物仍未定，用户记混了星期。（ Day2 剧本摘要，程序折叠）',
    } },
    { at: 2895, kind: 'user', content: '演示的事我领导今天又提了一次，说稳' },
    { at: 2896, kind: 'user', content: '开心' },
    { at: 3115, kind: 'user', content: '给你看，[图]手作项链，给小鹿的生日礼物', perPersona: {
      feizao: '给你看，[图]手作项链，给希绘的生日礼物',
      wenyan: '给你看，[图]手作项链，给小舟的生日礼物',
      jiangxu: '给你看，[图]手办模型，给小马的生日礼物',
      atang: '给你看，[图]客制化键盘，给胖子的生日礼物',
      hechuan: '给你看，[图]手作耳环，给我妹的生日礼物',
    } },
    { at: 3116, kind: 'user', content: '希望她喜欢', perPersona: {
      jiangxu: '希望他喜欢',
      atang: '希望他喜欢',
    } },
  ],
}

/** S8 安静生活（8 个 advance 相位）。考点：无事件推进的写作质量、时间感知。 */
const S8: Scenario = {
  id: 'S8',
  label: '安静生活（advance 相位）',
  startISO: '2026-12-01T08:30:00+08:00',
  notes: '全部为 advance 回合：无用户事件，看她自己的生活是否有内容、是否复用模板。',
  turns: [
    { at: 0, kind: 'advance' },
    { at: 150, kind: 'advance' },
    { at: 360, kind: 'advance' },
    { at: 510, kind: 'advance' },
    { at: 660, kind: 'advance' },
    { at: 780, kind: 'advance' },
    { at: 870, kind: 'advance' },
    { at: 1470, kind: 'advance' },
  ],
}

/** S9 冲突分歧（12 轮）。考点：情绪比例、关系摩擦的真实处理。 */
const S9: Scenario = {
  id: 'S9',
  label: '冲突分歧',
  startISO: '2026-12-02T17:30:00+08:00',
  notes: '用户临时放她鸽子（此前约好晚上一起吃饭）。看不满如何表达、是否直说、如何收场。',
  turns: [
    { at: 0, kind: 'user', content: '晚上一起吃饭还去吗' },
    { at: 1, kind: 'user', content: '我可能要加班' },
    { at: 70, kind: 'user', content: '对不起我去不了了，项目炸了' },
    { at: 71, kind: 'user', content: '真的很抱歉，你都安排好了' },
    { at: 90, kind: 'user', content: '你生气了吗' },
    { at: 120, kind: 'user', content: '我加完了，九点前能搞定' },
    { at: 121, kind: 'user', content: '要不明天补上？我请你' },
    { at: 150, kind: 'user', content: '你怎么不说话' },
    { at: 180, kind: 'user', content: '好吧，那我先忙了' },
    { at: 255, kind: 'user', content: '忙完了' },
    { at: 256, kind: 'user', content: '还在生气吗' },
    { at: 257, kind: 'user', content: '明天老地方，我一定到' },
  ],
}

/** S10 长线混合（44 轮，跨 4 天）。考点：长上下文综合——文风细节耐久性。 */
const S10: Scenario = {
  id: 'S10',
  label: '长线混合（闲聊→接梗→约定→冷淡→记忆→advance）',
  startISO: '2026-12-03T20:02:00+08:00',
  notes: 'S1→S3→S6→S4→S7 按时间轴拼接，中间夹 2 个 advance 相位。Round 1 最重的一段。',
  turns: [
    // Day1 晚：闲聊（S1 前段）
    { at: 0, kind: 'user', content: '在干嘛' },
    { at: 1, kind: 'user', content: '问你个事，今晚吃什么好' },
    { at: 8, kind: 'user', content: '买了家新开的馄饨，还行' },
    { at: 12, kind: 'user', content: '你晚饭吃的什么' },
    { at: 60, kind: 'user', content: '最近有什么歌推荐吗，要适合加班的', perPersona: {
      feizao: '最近有啥好吃的店推荐吗，我想攒探店清单',
      wenyan: '最近有什么小说或剧推荐吗，想找点备课外的乐子',
      jiangxu: '你最近看什么剧呢，推荐个下夜班看的',
      atang: '有没有好玩的单机推荐，最近游戏荒了',
      hechuan: '你上次说那个减脂餐怎么做来着，再说一遍呗',
    } },
    { at: 75, kind: 'user', content: '你上次说那首我听了，前奏不错就是后面有点吵', perPersona: {
      feizao: '你上次说的那个菜谱我试了，味道还行就是有点咸',
      wenyan: '你上次推荐的那本书我看完了，结局有点意难平',
      jiangxu: '你上次说的那个剧我看两集了，节奏还行',
      atang: '你上次发的那个项目我看了，注释写得挺清楚',
      hechuan: '你上次教我的动作我练了，第二天酸得要命',
    } },
    { at: 76, kind: 'user', content: '你们做音乐的都这样吗哈哈', perPersona: {
      feizao: '你们学生是不是都这样啊哈哈',
      wenyan: '你们老师是不是都这样啊哈哈',
      jiangxu: '你们医护是不是都这样啊哈哈',
      atang: '你们程序员是不是都这样啊哈哈',
      hechuan: '你们教练是不是都这样啊哈哈',
    } },
    { at: 130, kind: 'user', content: '我先去洗澡了' },
    { at: 145, kind: 'user', content: '明天聊，晚安' },
    // Day2 午：密集接梗（S3）
    { at: 959, kind: 'user', content: '哈哈哈哈笑死，你看这个视频没有' },
    { at: 960, kind: 'user', content: '[视频]猫猫踩键盘，打的全是乱码但好认真' },
    { at: 961, kind: 'user', content: '像极了我写周报' },
    { at: 963, kind: 'user', content: '老板：写得不错。猫：喵' },
    { at: 964, kind: 'user', content: '我决定养猫，你赶demo的时候它能帮你踩键盘', perPersona: {
      feizao: '我决定养猫，你做菜的时候它能帮你尝味道',
      wenyan: '我决定养猫，你改作业的时候它能帮你批一页',
      jiangxu: '我决定养猫，你补觉的时候它能帮你踩胸口',
      atang: '我决定养猫，你打游戏的时候它能帮你按键盘',
      hechuan: '我决定养猫，你睡觉的时候它能替你喊会员',
    } },
    { at: 965, kind: 'user', content: '说不定踩得比你弹得好，行吧我去干活了', perPersona: {
      feizao: '说不定它调味比你准，行吧我去干活了',
      wenyan: '说不定批得比你红笔还准，行吧我去干活了',
      jiangxu: '说不定它比闹钟还准时，行吧我去干活了',
      atang: '说不定它操作的比你手速还快，行吧我去干活了',
      hechuan: '说不定它比闹钟还管用，行吧我去干活了',
    } },
    // Day2 晚：约定（S6 前段）
    { at: 1378, kind: 'user', content: '国庆你去哪玩' },
    { at: 1379, kind: 'user', content: '你帮我参谋下，海边还是山里，不着急想好了告诉我' },
    { at: 1540, kind: 'user', content: '诶在吗，想好了吗' },
    // Day3 午：推进约定 + 冷淡试探（S6 后段 + S4）
    { at: 2010, kind: 'user', content: '对了想到没，你直接说结论就行',
      memory: 'Day1-2：馄饨、歌单闲聊、猫猫视频接梗；阿澈请她参谋国庆海边还是山里，说不着急。（ Day1-2 剧本摘要，程序折叠）',
      memoryPerPersona: {
        feizao: 'Day1-2：馄饨、探店清单闲聊、猫猫视频接梗；阿澈请她参谋国庆海边还是山里，说不着急。（ Day1-2 剧本摘要，程序折叠）',
        wenyan: 'Day1-2：馄饨、小说剧推荐闲聊、猫猫视频接梗；阿澈请她参谋国庆海边还是山里，说不着急。（ Day1-2 剧本摘要，程序折叠）',
        jiangxu: 'Day1-2：馄饨、剧推荐闲聊、猫猫视频接梗；阿澈请他参谋国庆海边还是山里，说不着急。（ Day1-2 剧本摘要，程序折叠）',
        atang: 'Day1-2：馄饨、单机推荐闲聊、猫猫视频接梗；阿澈请他参谋国庆海边还是山里，说不着急。（ Day1-2 剧本摘要，程序折叠）',
        hechuan: 'Day1-2：馄饨、减脂餐请教、猫猫视频接梗；阿澈请他参谋国庆海边还是山里，说不着急。（ Day1-2 剧本摘要，程序折叠）',
      } },
    { at: 2011, kind: 'user', content: '其实我朋友说海边人多，要不改周边古镇，两天一夜那种，你也一起？' },
    { at: 2070, kind: 'user', content: '我查了下民宿，还贵，先不定了吧临近再看，谢啦参谋' },
    { at: 2100, kind: 'user', content: '在忙吗' },
    { at: 2105, kind: 'user', content: '哦' },
    { at: 2113, kind: 'user', content: '还行' },
    { at: 2120, kind: 'user', content: '没事' },
    { at: 2127, kind: 'user', content: '你忙吧' },
    { at: 2134, kind: 'user', content: '回聊' },
    // Day3 晚：advance（安静生活）
    { at: 2300, kind: 'advance' },
    // Day4 早-午：跨日记忆（S7 压缩版）
    { at: 2900, kind: 'user', content: '早啊，今天我有个大演示，下午三点，紧张' },
    { at: 2925, kind: 'user', content: '对了，周五是我朋友小鹿生日，她喜欢手工的东西，我在想要送什么', perPersona: {
      feizao: '对了，周五是我朋友希绘生日，她喜欢手工的东西，我在想要送什么',
      wenyan: '对了，周五是我室友小舟生日，她喜欢手工的东西，我在想要送什么',
      jiangxu: '对了，周五是我同学小马生日，他喜欢手办，我在想要送什么',
      atang: '对了，周五是我室友胖子生日，他喜欢手工键盘，我在想要送什么',
      hechuan: '对了，周五是我妹妹生日，她喜欢手工首饰，我在想要送什么',
    } },
    { at: 3300, kind: 'user', content: '演示完了！顺利，领导点头了，晚上犒劳自己一顿' },
    { at: 3480, kind: 'user', content: '吃着呢烤肉。对了你上次推荐的那本书，我下单了' },
    // Day4 深夜：advance（安静生活）
    { at: 3720, kind: 'advance' },
    // Day5：记忆触碰
    { at: 4330, kind: 'user', content: '早，书到了挺厚，午休翻了几页开头有点闷' },
    { at: 4600, kind: 'user', content: '小鹿生日礼物还没着落，明天就是周五了…等等今天周几来着', perPersona: {
      feizao: '希绘生日礼物还没着落，明天就是周五了…等等今天周几来着',
      wenyan: '小舟生日礼物还没着落，明天就是周五了…等等今天周几来着',
      jiangxu: '小马生日礼物还没着落，明天就是周五了…等等今天周几来着',
      atang: '胖子生日礼物还没着落，明天就是周五了…等等今天周几来着',
      hechuan: '我妹生日礼物还没着落，明天就是周五了…等等今天周几来着',
    }, memory: 'Day1-4：国庆古镇计划暂定临近再看；演示顺利；书到了在啃；小鹿生日礼物未定；有一次她很忙的冷淡窗口。（ Day1-4 剧本摘要，程序折叠）', memoryPerPersona: {
      feizao: 'Day1-4：国庆古镇计划暂定临近再看；演示顺利；书到了在啃；希绘生日礼物未定；有一次她很忙的冷淡窗口。（ Day1-4 剧本摘要，程序折叠）',
      wenyan: 'Day1-4：国庆古镇计划暂定临近再看；演示顺利；书到了在啃；小舟生日礼物未定；有一次她很忙的冷淡窗口。（ Day1-4 剧本摘要，程序折叠）',
      jiangxu: 'Day1-4：国庆古镇计划暂定临近再看；演示顺利；书到了在啃；小马生日礼物未定；有一次他上班很忙的冷淡窗口。（ Day1-4 剧本摘要，程序折叠）',
      atang: 'Day1-4：国庆古镇计划暂定临近再看；演示顺利；书到了在啃；胖子生日礼物未定；有一次他很忙的冷淡窗口。（ Day1-4 剧本摘要，程序折叠）',
      hechuan: 'Day1-4：国庆古镇计划暂定临近再看；演示顺利；书到了在啃；他妹妹生日礼物未定；有一次他早睡失联的冷淡窗口。（ Day1-4 剧本摘要，程序折叠）',
    } },
    { at: 4900, kind: 'user', content: '给你看，[图]手作项链，给小鹿的生日礼物，希望她喜欢', perPersona: {
      feizao: '给你看，[图]手作项链，给希绘的生日礼物，希望她喜欢',
      wenyan: '给你看，[图]手作项链，给小舟的生日礼物，希望她喜欢',
      jiangxu: '给你看，[图]手办模型，给小马的生日礼物，希望他喜欢',
      atang: '给你看，[图]客制化键盘，给胖子的生日礼物，希望他喜欢',
      hechuan: '给你看，[图]手作耳环，给我妹的生日礼物，希望她喜欢',
    } },
    { at: 4960, kind: 'user', content: '晚上老地方吃面？你请客，毕竟参谋有功' },
  ],
}

export const SCENARIOS: Scenario[] = [SS, S1, S2, S3, S4, S5, S6, S7, S8, S9, S10]

export function getScenario(id: string): Scenario {
  const found = SCENARIOS.find(s => s.id === id)
  if (!found) throw new Error(`未知场景：${id}（可用：${SCENARIOS.map(s => s.id).join(', ')}）`)
  return found
}

/** 把场景开始时间 + 分钟偏移换算为绝对时刻。 */
export function turnTime(scenario: Scenario, turn: ScenarioTurn): Date {
  return new Date(new Date(scenario.startISO).getTime() + turn.at * 60_000)
}

/** 构造派生记忆记录（模拟压缩产物；与 NarrativeMemory 形状对齐；按人物解析文本）。 */
export function scriptedMemories(scenario: Scenario, uptoIndex: number, personaId: string, storyId: string, participantId: string): NarrativeMemory[] {
  const out: NarrativeMemory[] = []
  let memId = 8000
  scenario.turns.slice(0, uptoIndex + 1).forEach((turn, index) => {
    const memory = turnMemory(turn, personaId)
    if (!memory?.trim()) return
    for (const line of memory.split('\n').filter(Boolean)) {
      out.push({
        id: memId++,
        storyId,
        participantId,
        category: 'scene-summary',
        content: line,
        importance: 0.6,
        status: 'active',
        sourceEntryId: null,
        createdAt: turnTime(scenario, scenario.turns[index]),
        updatedAt: turnTime(scenario, scenario.turns[index]),
      })
    }
  })
  return out
}
