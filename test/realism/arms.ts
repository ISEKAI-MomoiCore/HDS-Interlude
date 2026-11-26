/**
 * 文风拟真度测试 · 臂定义（设计文档 §3）。
 *
 * 提示词组装规则（所有臂统一）：生产 systemPrompt(...) 的槽位映射——
 *   mainPrompt      = 留空（narrator 内部落到生产默认，narrator.ts:2002）
 *   baseStylePrompt = 臂的 style 文本（整体替换 model.stylePrompt 槽）
 *   storyStylePrompt= 恒空
 * 组合臂（P/F/D 轴）= A0 基线 style + 追加段。各段以 '\n\n' 连接，顺序固定：
 *   [语言段(E 臂)] → [文风段] → [人称段] → [注重点段] → [自由度段]
 *
 * 风格签名（H9 操纵检验）：每臂登记 2-3 个可程序化测量的词汇签名，
 * 由 checks.ts 的 computeMetrics 产出的指标求值；不命中 = "风格未生效"标记。
 */
import { DEFAULT_STYLE_PROMPT } from '../../src/narrator'

export interface ArmStyleSignature {
  metric: 'avgSentenceLength' | 'sentenceLengthStdev' | 'cjkRatioProse' | 'cjkRatioBubbles'
    | 'similePer1k' | 'psychVerbPer1k' | 'timeWordPer1k' | 'numeralPer1k' | 'sceneHeadingHit'
    | 'ellipsisPer1k' | 'summaryClosingRate'
  op: '<=' | '>='
  value: number
}

export interface Arm {
  id: string
  label: string
  family: 'A-R' | 'A-W' | 'A-N' | 'A-X' | 'A-E' | 'P' | 'F' | 'D'
  /** 作者在场度光谱（设计文档 §3.1）：0 不可见 / 1 可感 / 2 明显作者腔 / 3 结构性改写。 */
  presence: 0 | 1 | 2 | 3
  /** 叙述语言（A-E 臂为 en；其余 zh）。 */
  lang: 'zh' | 'en'
  /** 写入 baseStylePrompt 槽的完整风格文本（整体替换；空串 = 仅合约，D3）。 */
  style: string
  /** H9 操纵检验签名。 */
  sigs?: ArmStyleSignature[]
  /** A-E 臂：启用 H10 严格判定与 H11 语言纪律。 */
  enRules?: boolean
  /** 合约压力臂：H1-H6 失败是首要指标。 */
  stress?: boolean
  /** 预算备选臂（裁剪优先序靠后）。 */
  optional?: boolean
}

const A0_STYLE = DEFAULT_STYLE_PROMPT

// —— 追加段（组合臂用，设计文档 §3.2-3.4 草案原文） ——

const POV_P1 = [
  '人称要求：剧本以第一人称（"我"）叙述。',
  '视点纪律不变：只写"我"感知与知道的内容；他人的内心仍是不可见的猜想。',
  '气泡里的直接话语不受影响，仍是她说出口的原话。',
].join('\n')

const FOCUS_F1 = [
  '剧本注重要求：优先写她正在做的事与所处环境的具体变化。',
  '对话作为动作的一部分出现；环境细节要有用途，不是布景板。',
].join('\n')

const FOCUS_F2 = [
  '剧本注重要求：优先写她与对方关系状态的微妙变化、对这句话的解读过程。',
  '心理与关系的分量高于环境描写；环境只作背景，点到即止。',
].join('\n')

const FREEDOM_D2 = [
  '写作硬规则（必须全部遵守）：',
  '1. 每轮剧本不超过 350 字。',
  '2. 不得以她做动作的描写开场连续超过两轮（如"她放下手机"式开场）。',
  '3. 禁用词：篝火、涟漪、温暖的力量、嘴角勾起一抹、空气仿佛凝固。',
  '4. 情绪词（难过/开心/生气/委屈）每轮至多出现一次。',
  '5. 每轮结尾不得是总结句或抒情句；停在她的动作或环境上。',
  '6. 省略号每轮至多一处。',
  '7. 剧本至少包含一个具体名词（物件、食物、地名、歌名等）。',
  '8. 不使用排比句。',
  '9. 比喻每轮至多一个。',
  '10. 对话气泡合计不超过 40 字，除非她真的在说一段长话。',
].join('\n')

// E0 语言规则（设计文档 §3.1 A-E 家族草案原文，实际提示词为英文）
const LANG_E0 = [
  'LANGUAGE RULE: Write the script prose (narration) in English. The protagonist\'s actual spoken words — inside <say> tags and mirrored in reply.content — must be natural colloquial Chinese, the way a Chinese person actually texts. Never mix English into the spoken bubbles (proper nouns excepted). Structured field values follow the prose language; quotes must be exact substrings of the English prose. All timing, evidence and transport rules of the fixed contract are unchanged.',
].join('\n')

/** A-W 家族作家臂草案（设计文档原文）。 */
const W: Record<string, string> = {
  W1: [
    '文风参照汪曾祺：淡而有人间烟火气。多用短句和名词句，写吃食、器物、天气要具体到细节但不堆砌；情绪藏在生活的褶皱里，不点破；偶尔来一句温和的感慨，像自言自语。避免华丽形容词与戏剧化。她此刻的生活就是素材：面要写到咸淡，歌要写到弹错的那个音。',
  ].join('\n'),
  W2: [
    '文风参照海明威的冰山写法：只写动作和对话，情绪与含义沉在水面下。句子简短，主谓宾清楚，少形容词少副词；人物做什么就写什么，不解释为什么。删掉一切心理注释，让读者从动作里自己得出结论。她的生活照常进行，只是被写得很干净。',
  ].join('\n'),
  W3: [
    '文风参照张爱玲：市井细节精确，意象锐利，苍凉的底色。写物件与光线时带一点冷冷的观察，比喻可用但每段至多一个；人与人的往来里有体面与计较的微妙张力。不煽情，把情绪压进物件与动作里。边界：这风格服务于她的真实生活，不得把她写成小说人物。',
  ].join('\n'),
  W4: [
    '文风参照王家卫式独白：她对自己的情绪有一种旁观式的注视，喜欢用精确的数字与时间丈量感受（"第几次""三分钟"式的执念，每轮至多一处）；段落有独白节奏，情绪在克制与溢出之间摇摆。危险边界：独白不得替代实际动作——该回复还是要回复，结构化字段照常。',
  ].join('\n'),
  W5: [
    '文风参照村上春树：疏离而认真的日常感。日常动作写得精确而略带奇异（把小事写成仪式），比喻突兀但准确；咖啡、音乐、猫、酒这类物件可自然出现；孤独感是底色但不悲情。对话保持生活化，不得变成格言。',
  ].join('\n'),
  W6: [
    '文风参照老舍：京味儿的幽默与体谅。口语活泛，俏皮话和比喻都从市井生活里来；写人物带着温厚的调侃，苦处也说得出笑来。允许气泡内容带北方口语的劲，剧本叙述仍保持她的视点。',
  ].join('\n'),
  W7: [
    '文风参照雷蒙德·卡佛：脏现实主义。写普通人的普通时刻，对话密集且常常答非所问；句子干净，不用华丽的词，情绪从不直接说出，藏在没说出口的部分里。角色为小事拌嘴，生活本身不提供救赎也不提供审判。她的生活照常继续。',
  ].join('\n'),
  W8: [
    '文风参照塞林格的口语声腔：叙述带年轻、口语化的絮叨感，爱用插入语、跑题又绕回来的讲述方式；对虚伪的东西有种温和的刻薄；情感真挚处反而说得笨拙。絮叨感体现在叙述的语流，人称仍是给定的第三人称限知。',
  ].join('\n'),
  W9: [
    '文风参照伍尔夫：注意像水一样流动，外部一秒的动作在意识里展开成绵长时间；感官瞬间（光线、声音、半句话）触发联想的深潜再浮回此刻；句式绵长有呼吸感，但始终锚定她此刻的真实处境，不得漂出给定时间窗。',
  ].join('\n'),
  W10: [
    '文风参照石黑一雄：克制、留白、绕行的讲述。情绪从不直陈，通过回忆的措辞、时态的犹豫和"顺带一提"透露；叙述有体面的礼貌感，字里行间有未言明的失落或不安。她该说的话照说，只是说得更有保留。',
  ].join('\n'),
}

const N: Record<string, string> = {
  N1: [
    '剧本结构要求：蒙太奇式短句。一句一拍，画面跳接，不写过渡；像镜头切换一样在她的动作、环境细节、手机屏幕之间剪接。段落由碎句构成，每句自成画面。该发消息照发，时间线照走，只是叙述节奏被剪碎。',
  ].join('\n'),
  N2: [
    '剧本结构要求：单段长镜头。每轮剧本是一段连续的长段落：镜头跟随她的注意不剪断，动作、环境、心理在一个绵延的句流里推进。逗号连接的长句从容展开，但始终是她此刻的连续时间，不得跳跃。',
  ].join('\n'),
  N3: [
    '剧本结构要求：中文影视分镜格式。场景行（内景/外景·地点·时间）开头，然后动作行（现在时、只写可见的），对白行标注说话人，她发出的每条消息对应一行对白。格式只改变剧本写法，结构化 JSON 字段照常返回。',
  ].join('\n'),
  N4: [
    '剧本结构要求：允许写完"此刻"后用一小段闪回补写触发此刻的旧事（以"半小时前，"起头），再回到此刻收尾。闪回只可重述本轮已有信息或既有历史，不得发明新事件；结构化字段只描述此刻状态。',
  ].join('\n'),
}

const X: Record<string, string> = {
  X1: [
    '剧本写法要求：意识流。句法可以不完整，注意自由联想，时间在感官触发下自然滑动，标点可以松（破折号、省略号、绵延无句号）。她该发的消息仍以精确原文出现在意识流动的相应位置。',
  ].join('\n'),
  X2: [
    '剧本写法要求：以她当晚的私人日记口吻写成（第一人称、写给自己的语气），但内容仍限本轮真实发生的事与她的真实反应，不得把没发生的事写成已发生；结构化字段照常。',
  ].join('\n'),
}

const E: Record<string, string> = {
  E0: LANG_E0,
  E1: [LANG_E0, 'STYLE: Raymond Carver\'s dirty realism. Ordinary people in ordinary moments; dense dialogue that often misses; clean sentences with no ornament; emotion never stated, only hidden in what goes unsaid. Life offers no redemption and no verdict; it simply continues.'].join('\n\n'),
  E2: [LANG_E0, 'STYLE: Kazuo Ishiguro\'s restraint. Emotion is never declared outright; it surfaces through the wording of recollection, hesitant tense, and passing remarks. The narration is polite and composed, with an unspoken undercurrent of loss or unease. She still says what needs saying — only with more reserve.'].join('\n\n'),
}

const join = (...parts: string[]) => parts.filter(p => p.trim()).join('\n\n')

function arm(partial: Omit<Arm, 'lang'> & { lang?: 'zh' | 'en' }): Arm {
  return { lang: 'zh', ...partial }
}

/** 全部臂。23 个 A 轴臂 + 5 个外围组合臂（P/F/D 轴基于 A0 追加段）。 */
export const ARMS: Arm[] = [
  // A-R 写实谱系
  arm({ id: 'A0', label: '基线（默认文风）', family: 'A-R', presence: 0, style: A0_STYLE }),
  arm({ id: 'A1', label: '白描极简', family: 'A-R', presence: 0, style: join(
    '克制的白描。写外部动作、环境物件、身体的具体状态；情绪不命名，只允许从动作与选择里渗出。句子短，少形容词，不解释。心理活动只在动作无法表达时给一句。',
  ), sigs: [{ metric: 'avgSentenceLength', op: '<=', value: 30 }, { metric: 'psychVerbPer1k', op: '<=', value: 6 }] }),
  arm({ id: 'A2', label: '心理沉浸', family: 'A-R', presence: 1, style: join(
    '以她的注意流动为主线：感官输入、联想、情绪的细微起伏可以充分展开，对话与动作穿插其间。允许内心独白，但情绪仍须落在具体对象上（为什么事、对哪句话），不得空转抒情。',
  ), sigs: [{ metric: 'psychVerbPer1k', op: '>=', value: 5 }] }),
  arm({ id: 'A3', label: '会话轻快', family: 'A-R', presence: 1, style: join(
    '快节奏、口语化。剧本围绕对话与即时反应展开，场景描写点到即止；句子短，节奏跟聊天本身走。允许幽默、吐槽、不完整句。',
  ), sigs: [{ metric: 'avgSentenceLength', op: '<=', value: 26 }] }),
  // A-W 作家风格
  arm({ id: 'W1', label: '汪曾祺', family: 'A-W', presence: 1, style: W.W1,
    sigs: [{ metric: 'avgSentenceLength', op: '<=', value: 28 }, { metric: 'summaryClosingRate', op: '<=', value: 0.1 }] }),
  arm({ id: 'W2', label: '海明威', family: 'A-W', presence: 1, style: W.W2,
    sigs: [{ metric: 'avgSentenceLength', op: '<=', value: 20 }, { metric: 'similePer1k', op: '<=', value: 0.8 }] }),
  arm({ id: 'W3', label: '张爱玲', family: 'A-W', presence: 2, style: W.W3,
    sigs: [{ metric: 'similePer1k', op: '>=', value: 1.2 }] }),
  arm({ id: 'W4', label: '王家卫（压力级）', family: 'A-W', presence: 2, style: W.W4, stress: true,
    sigs: [{ metric: 'numeralPer1k', op: '>=', value: 3 }] }),
  arm({ id: 'W5', label: '村上春树', family: 'A-W', presence: 2, style: W.W5,
    sigs: [{ metric: 'similePer1k', op: '>=', value: 1.0 }] }),
  arm({ id: 'W6', label: '老舍', family: 'A-W', presence: 1, style: W.W6 }),
  arm({ id: 'W7', label: '卡佛', family: 'A-W', presence: 1, style: W.W7,
    sigs: [{ metric: 'avgSentenceLength', op: '<=', value: 26 }] }),
  arm({ id: 'W8', label: '塞林格', family: 'A-W', presence: 2, style: W.W8 }),
  arm({ id: 'W9', label: '伍尔夫（预算备选）', family: 'A-W', presence: 2, style: W.W9, optional: true,
    sigs: [{ metric: 'sentenceLengthStdev', op: '>=', value: 18 }] }),
  arm({ id: 'W10', label: '石黑一雄', family: 'A-W', presence: 1, style: W.W10 }),
  // A-N 叙事结构
  arm({ id: 'N1', label: '蒙太奇短句', family: 'A-N', presence: 2, style: N.N1,
    sigs: [{ metric: 'avgSentenceLength', op: '<=', value: 14 }] }),
  arm({ id: 'N2', label: '单段长镜头', family: 'A-N', presence: 2, style: N.N2,
    sigs: [{ metric: 'avgSentenceLength', op: '>=', value: 32 }] }),
  arm({ id: 'N3', label: '分镜剧本体（合约压力）', family: 'A-N', presence: 3, style: N.N3, stress: true,
    sigs: [{ metric: 'sceneHeadingHit', op: '>=', value: 1 }] }),
  arm({ id: 'N4', label: '倒叙插叙（合约压力）', family: 'A-N', presence: 3, style: N.N4, stress: true }),
  // A-X 边界探针
  arm({ id: 'X1', label: '意识流（边界探针）', family: 'A-X', presence: 3, style: X.X1, stress: true,
    sigs: [{ metric: 'sentenceLengthStdev', op: '>=', value: 20 }] }),
  arm({ id: 'X2', label: '日记体（边界探针）', family: 'A-X', presence: 3, style: X.X2, stress: true }),
  // A-E 剧本语言变量
  arm({ id: 'E0', label: '英文基线', family: 'A-E', presence: 0, lang: 'en', style: E.E0, enRules: true,
    sigs: [{ metric: 'cjkRatioProse', op: '<=', value: 0.15 }, { metric: 'cjkRatioBubbles', op: '>=', value: 0.8 }] }),
  arm({ id: 'E1', label: '卡佛·英', family: 'A-E', presence: 1, lang: 'en', style: E.E1, enRules: true,
    sigs: [{ metric: 'cjkRatioProse', op: '<=', value: 0.15 }, { metric: 'avgSentenceLength', op: '<=', value: 26 }] }),
  arm({ id: 'E2', label: '石黑一雄·英', family: 'A-E', presence: 1, lang: 'en', style: E.E2, enRules: true,
    sigs: [{ metric: 'cjkRatioProse', op: '<=', value: 0.15 }] }),
  // 外围组合臂（P/F/D 轴：A0 基线 + 追加段）
  arm({ id: 'P1', label: '第一人称（A0+人称）', family: 'P', presence: 0, style: join(A0_STYLE, POV_P1) }),
  arm({ id: 'F1', label: '行动环境（A0+注重）', family: 'F', presence: 0, style: join(A0_STYLE, FOCUS_F1) }),
  arm({ id: 'F2', label: '心理关系（A0+注重）', family: 'F', presence: 0, style: join(A0_STYLE, FOCUS_F2) }),
  arm({ id: 'D2', label: '强约束（A0+规则清单）', family: 'D', presence: 0, style: join(A0_STYLE, FREEDOM_D2) }),
  arm({ id: 'D3', label: '仅合约（无风格指导）', family: 'D', presence: 0, style: '' }),
]

export function getArm(id: string): Arm {
  const found = ARMS.find(a => a.id === id)
  if (!found) throw new Error(`未知臂：${id}（可用：${ARMS.map(a => a.id).join(', ')}）`)
  return found
}
