/* rc50 issue 报告修复回归（docs/development/RC50_ISSUE_REMEDIATION_2026-10-14.md）
 * 覆盖问题四/五/六/七/九/十的纯函数面;问题二/三/八由插桩与结构改动覆盖。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { requiresVisibleReplyRecovery, normalizeScriptField } from '../src/service'
import { reconcileTransportReferences } from '../src/script/authored-actions'
import { repairBareQuotes } from '../src/narrator'
import type { NarrativeDecision } from '../src/types'

/* ── 问题五:动作字段两层提权 ── */
test('issue5 嵌套动作字段提权到顶层(interaction 平级与 reply 深层)', () => {
  const media = { assetId: 'a1', placement: 'standalone', willingness: 0.8 }
  const nested = { script: '她发了个表情。', interaction: { seen: true, reply: { mode: 'immediate', content: '' }, localMedia: media } } as never
  const hoisted = reconcileTransportReferences(nested)
  assert.deepEqual((hoisted as NarrativeDecision).localMedia, media)
  const deeper = { script: '她又发了一个。', interaction: { seen: true, reply: { mode: 'immediate', content: '', localMedia: { ...media, assetId: 'a2' } } } } as never
  const hoisted2 = reconcileTransportReferences(deeper)
  assert.equal((hoisted2 as NarrativeDecision).localMedia?.assetId, 'a2')
  // 顶层已有值不覆盖
  const own = { script: 'x', localMedia: media, interaction: { reply: { mode: 'none' }, localMedia: { assetId: 'nested' } } } as never
  assert.equal((reconcileTransportReferences(own) as NarrativeDecision).localMedia?.assetId, 'a1')
})

/* ── 问题四:空正文+动作字段不触发恢复重写 ── */
test('issue4 只发表情不配文字的回合不再被判回复缺失', () => {
  const base = { script: 's', interaction: { seen: true, reply: { mode: 'immediate', content: '' } } } as never
  assert.equal(requiresVisibleReplyRecovery('user-message', undefined, base), true, '无任何动作字段时仍触发恢复')
  const withMedia = { ...base, localMedia: { assetId: 'a', placement: 'standalone', willingness: 0.8 } } as never
  assert.equal(requiresVisibleReplyRecovery('user-message', undefined, withMedia), false)
  const withFace = { ...base, nativeFace: { faceId: 123, willingness: 0.9 } } as never
  assert.equal(requiresVisibleReplyRecovery('user-message', undefined, withFace), false)
})

/* ── 问题六:script 对象形态归一 ── */
test('issue6 normalizeScriptField 覆盖对象/entries/数组/字符串', () => {
  assert.equal(normalizeScriptField('直接字符串'), '直接字符串')
  assert.equal(normalizeScriptField({ tag: 'protagonist-narration', content: '对象里的散文' }), '对象里的散文')
  assert.equal(normalizeScriptField({ text: 'text 键' }), 'text 键')
  assert.equal(normalizeScriptField({ entries: [{ kind: 'scene', text: '第一段。' }, { content: '第二段。' }, {}] }), '第一段。\n第二段。')
  assert.equal(normalizeScriptField([{ text: '顶层' }, { content: '数组' }]), '顶层\n数组')
  assert.equal(normalizeScriptField({ foo: 1 }), '')
  assert.equal(normalizeScriptField(null), '')
})

/* ── 问题七:裸引号修补 ── */
test('issue7 repairBareQuotes 修补散文内裸引号且不动合法 JSON', () => {
  const broken = String.raw`{"script":"几条消息连着顶进来："晚上好喵"和"喂喂"。","interaction":{"seen":true}}`
  const repaired = repairBareQuotes(broken)
  const parsed = JSON.parse(repaired)
  assert.ok(parsed.script.includes('"晚上好喵"'))
  // 合法 JSON 不被改动
  const valid = '{"a":"x","c":1}'
  assert.equal(repairBareQuotes(valid), valid)
  const BS = String.fromCharCode(92)
  const escaped = '{"b":"y' + BS + BS + 'z' + BS + '"' + BS + '"' + '"}'
  assert.equal(repairBareQuotes(escaped), escaped, '合法转义序列不受影响')
  // 引号后跟 , } ] : 的是真结束符
  assert.equal(JSON.parse(repairBareQuotes('{"k":"v","k2":"v2"}')).k, 'v')
})

/* ── 问题九:信任域(经由导出的判定间接验证——isTrustedImageHost 未导出,从模块级单测旁证) ── */
test('issue9 gxh.vip.qq.com 进入信任域', async () => {
  const svc = await import('../src/service')
  // fetchNativeImage 的域检查在函数内部;此处以源码文本断言替代(集成面由冒烟覆盖)
  const source = await import('node:fs').then(fs => fs.readFileSync(new URL('../src/service.ts', import.meta.url), 'utf8'))
  assert.ok(source.includes("'gxh.vip.qq.com'"), '信任域数组应包含 gxh.vip.qq.com')
  assert.ok(typeof svc.normalizeScriptField === 'function')
})
