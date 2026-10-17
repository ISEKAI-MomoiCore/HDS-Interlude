import test from 'node:test'
import assert from 'node:assert/strict'
import { manageSessionDenialReason } from '../src/service'
import type { OneBotAccountRule } from '../src/service'

const rule = (qq: string, enabled = true): OneBotAccountRule => ({ qq, label: qq, enabled })

test('权限门：白名单关闭且 managers 为空时全部放行', () => {
  assert.equal(manageSessionDenialReason({
    platform: 'onebot', selfId: '10001', userId: '20002',
    onebot: { enabled: false }, managers: [],
  }), undefined)
  assert.equal(manageSessionDenialReason({
    platform: 'onebot', selfId: '10001', userId: '20002',
  }), undefined)
})

test('权限门：OneBot 层拒绝必须指明是机器人账号还是用户账号', () => {
  const denialBot = manageSessionDenialReason({
    platform: 'onebot', selfId: '10001', userId: '20002',
    onebot: { enabled: true, botAccounts: [rule('99999')], userAccounts: [rule('20002')] },
  })
  assert.equal(denialBot?.layer, 'onebot')
  assert.match(denialBot!.detail, /botAccounts/)
  assert.match(denialBot!.detail, /10001/)

  const denialUser = manageSessionDenialReason({
    platform: 'onebot', selfId: '10001', userId: '20002',
    onebot: { enabled: true, botAccounts: [rule('10001')], userAccounts: [] },
  })
  assert.equal(denialUser?.layer, 'onebot')
  assert.match(denialUser!.detail, /userAccounts/)
  assert.match(denialUser!.detail, /空白名单即全部拒绝/)
})

test('权限门：managers 不匹配时给出当前账号与已配置列表', () => {
  const denial = manageSessionDenialReason({
    platform: 'onebot', selfId: '10001', userId: '20002',
    onebot: { enabled: true, botAccounts: [rule('10001')], userAccounts: [rule('20002')] },
    managers: ['30003'],
  })
  assert.equal(denial?.layer, 'managers')
  assert.match(denial!.detail, /20002/)
  assert.match(denial!.detail, /30003/)
  assert.match(denial!.detail, /managerAccounts/)
})

test('权限门：managers 匹配支持 qq: 前缀等传输限定形式', () => {
  assert.equal(manageSessionDenialReason({
    platform: 'onebot', selfId: '10001', userId: '20002',
    onebot: { enabled: true, botAccounts: [rule('10001')], userAccounts: [rule('20002')] },
    managers: ['QQ:20002'],
  }), undefined)
  assert.equal(manageSessionDenialReason({
    platform: 'onebot', selfId: '10001', userId: 'onebot:20002',
    onebot: { enabled: true, botAccounts: [rule('10001')], userAccounts: [rule('20002')] },
    managers: ['20002'],
  }), undefined)
})

test('权限门：非 OneBot 环境（Console 沙盒）账号与 QQ managers 永不匹配，需提示环境差异', () => {
  const denial = manageSessionDenialReason({
    platform: 'sandbox', userId: 'root',
    managers: ['20002'],
  })
  assert.equal(denial?.layer, 'managers')
  assert.match(denial!.detail, /非 OneBot 环境/)
  assert.match(denial!.detail, /root/)
})

test('权限门：白名单拒绝优先于 managers 判定', () => {
  // 用户账号未过白名单时，即使 managers 匹配也应报 onebot 层——
  // 修复"给了管理员仍提示管理员权限不足"的误导。
  const denial = manageSessionDenialReason({
    platform: 'onebot', selfId: '10001', userId: '20002',
    onebot: { enabled: true, botAccounts: [rule('10001')], userAccounts: [] },
    managers: ['20002'],
  })
  assert.equal(denial?.layer, 'onebot')
})

test('权限门：ignoreSelfMessages 过滤机器人自消息', () => {
  const denial = manageSessionDenialReason({
    platform: 'onebot', selfId: '10001', userId: '10001',
    onebot: { enabled: true, ignoreSelfMessages: true, botAccounts: [rule('10001')], userAccounts: [rule('10001')] },
    managers: [],
  })
  assert.equal(denial?.layer, 'onebot')
  assert.match(denial!.detail, /ignoreSelfMessages/)
})

test('剧本历史预算：contextEntryLimit 尊重用户设置（无 35 硬地板）', async () => {
  const { resolveScriptContextBudget } = await import('../src/service')
  // 小模型场景：显式调小必须生效——此前 Math.max(35, …) 使其失效。
  assert.deepEqual(resolveScriptContextBudget({ contextEntryLimit: 15, contextTimeWindowMinutes: 0 }), { count: 15, minutes: 0 })
  assert.deepEqual(resolveScriptContextBudget({ contextEntryLimit: 5, contextTimeWindowMinutes: 10 }), { count: 5, minutes: 10 })
  // 缺省回落与 RC57 Console 默认值一致。
  assert.deepEqual(resolveScriptContextBudget({}), { count: 17, minutes: 6 })
  // 边界钳制。
  assert.deepEqual(resolveScriptContextBudget({ contextEntryLimit: 999, contextTimeWindowMinutes: 9_999 }), { count: 200, minutes: 1_440 })
  assert.equal(resolveScriptContextBudget({ contextEntryLimit: 0 })?.count, 1)
})

test('小模型换行分句：开关开启时换行运行成为气泡边界', async () => {
  const { splitVisibleReplyBubbles } = await import('../src/service')
  const on = { splitEnabled: true, newlineAsSeparator: true }
  const off = { splitEnabled: true, newlineAsSeparator: false }
  // 单换行与连续换行（含 CRLF）都收敛为一条分隔。
  assert.deepEqual(splitVisibleReplyBubbles('早呀\r\n\r\n昨晚睡得好吗', on), ['早呀', '昨晚睡得好吗'])
  assert.deepEqual(splitVisibleReplyBubbles('第一句\n第二句\n\n第三句', on), ['第一句', '第二句', '第三句'])
  // 关闭（默认）：换行原样保留在单条消息里。
  assert.deepEqual(splitVisibleReplyBubbles('第一句\n第二句', off), ['第一句\n第二句'])
  // 模型已输出显式分隔符时不做换行转换——尊重合约输出。
  assert.deepEqual(splitVisibleReplyBubbles('甲<sep/>乙\n丙', on), ['甲', '乙\n丙'])
  // 显式分隔符的常规拆分不受开关影响。
  assert.deepEqual(splitVisibleReplyBubbles('甲<sep/>乙', off), ['甲', '乙'])
  // 拆分关闭：开关无效，整条发送。
  assert.deepEqual(splitVisibleReplyBubbles('甲\n乙', { splitEnabled: false, newlineAsSeparator: true }), ['甲\n乙'])
  // 无换行无分隔符：单条；纯换行内容不产生空投递列表。
  assert.deepEqual(splitVisibleReplyBubbles('一句话', on), ['一句话'])
  assert.deepEqual(splitVisibleReplyBubbles('\n\n', on), ['\n\n'])
})
