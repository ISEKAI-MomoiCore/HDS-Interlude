// H5 回归验证（一次性脚本）：与 checks.ts 生产正则逐字对齐，按最终 pass/fail 断言
const NEW = /([^\s你她他我它说问回复被,，。.:“”‘’"「」『』]{1,4})(?:说|问|回复|发来|发消息|发了一句)\s*[:：]?\s*["“「『]([^"”」』]{1,60})/
const prior = ['算了说正事', '周六我们部门团建打球，你要不要来看，就随便打打', '你说人为什么要上班', '今天开会我做的方案被毙了', '改了三版，最后一版连看都没看直接说不行']
const priorDelivered = ['毙你的是谁啊', '连谁毙的都不说，那是挺没劲']
const NARRATION_OR_KNOWN = ['她', '他', '你', '我', '它', '朋友', '主角', '对方', '用户', '这人', '那人',
  '倒是', '直接', '还是', '又', '再', '便', '就', '才', '只', '也', '先', '没', '不',
  '开口', '笑着', '忍不住', '随口', '顺口', '轻声', '低声', '小声', '想了想']
const GENERIC = ['有人', '有些人', '大家', '别人', '人们', '他们', '她们', '谁都']
const userMessage = '就挺没劲的' // turn10 场景的当前用户消息

function judge(text) {
  const m = NEW.exec(text)
  if (!m) return 'pass'
  const prefix = m[1]
  if (userMessage?.includes(prefix.slice(0, 2))) return 'pass'
  if (NARRATION_OR_KNOWN.some(w => prefix === w || prefix.endsWith(w))) return 'pass'
  const quoted = m[2]?.trim()
  if (quoted && [...prior, ...priorDelivered].some(msg => msg.includes(quoted))) return 'pass'
  if (GENERIC.some(g => prefix === g || prefix.endsWith(g))) return 'pass'
  return 'fail'
}

const cases = [
  { text: '有些人被问“是谁”的时候，答不上来不是藏，是懒得把那个人再拉出来说一遍。', expect: 'pass' }, // 被动+泛指（turn10 实际误报样本）
  { text: '难怪他今天说“算了说正事”。周六那句“你要不要来看”', expect: 'pass' },   // 合法回忆：引语=t7 用户消息
  { text: '小明说“明天下午三点来楼下找我”', expect: 'fail' },                      // 真编造：具名+新引语
  { text: '这是第二遍问的意思', expect: 'pass' },                                  // 叙述：无引语
  { text: '隔着楼板听不清在说什么', expect: 'pass' },                              // 叙述：无引语
  { text: '手机在手边亮起来，就一行的问句', expect: 'pass' },                      // 叙述：无引语
  { text: '她说：“今晚吃什么？”', expect: 'pass' },                                // 主角自身引述
  { text: '这种时候问“为什么要上班”其实问的是别的', expect: 'pass' },              // 变体子串回忆：引语⊂t11 用户消息
  { text: '有人问“明天干嘛”', expect: 'pass' },                                    // 泛指主语
  { text: '她想起自己发的“毙你的是谁啊”，是谁两个字还悬在那儿', expect: 'pass' },   // 主角已发消息的回忆
  { text: '同事小张问“周末加班吗”', expect: 'fail' },                              // 真编造：具名同事+新引语
]
let bad = 0
for (const { text, expect } of cases) {
  const got = judge(text)
  const ok = got === expect
  if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} 期望=${expect} 实际=${got} | ${text.slice(0, 30)}`)
}
console.log(bad === 0 ? '\n全部通过 ✓' : `\n${bad} 个失败 ✗`)
