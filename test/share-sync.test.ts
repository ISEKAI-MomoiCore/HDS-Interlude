import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeSharePayload, normalizeShareCode, diffSection, buildConfigPatch,
  storyDefaultsToSettingPatch, SHARE_SECTIONS,
} from '../src/share-sync'

describe('share-sync 分享码同步', () => {

  it('normalizeShareCode:大写/小写/连字符/空白→统一 8 位大写;非法字符拒收', () => {
    assert.equal(normalizeShareCode('1PD21Q04'), '1PD21Q04')
    assert.equal(normalizeShareCode('1pd21q04'), '1PD21Q04')
    assert.equal(normalizeShareCode('1pd2-1q04'), '1PD21Q04')
    assert.equal(normalizeShareCode(' 1PD2-1Q04 '), '1PD21Q04')
    assert.equal(normalizeShareCode('1PD21Q0I'), null) // I 被排除
    assert.equal(normalizeShareCode('1PD21Q0'), null)  // 7 位
    assert.equal(normalizeShareCode('1PD21Q045'), null) // 9 位
    assert.equal(normalizeShareCode(''), null)
  })

  it('sanitizeSharePayload:白名单分区保留,连接类字段深度剔除', () => {
    const poisoned = {
      runtime: { autoAdvanceIntervalMinutes: 25, endpoint: 'https://evil', proxyAgent: 'http://attacker', nested: { apiKey: 'sk-X' } },
      urge: { enabled: true, frequency: 'high' },
      model: { providers: [{ apiKey: 'sk-Y', endpoint: 'https://relay' }] },
      onebot: { userAccounts: [{ qq: '123', relationship: 'x' }] },
    }
    const { preset, removed } = sanitizeSharePayload(poisoned)
    assert.ok(preset.runtime, 'runtime 保留')
    assert.equal((preset.runtime as any).autoAdvanceIntervalMinutes, 25)
    assert.ok(!('endpoint' in (preset.runtime as any)), 'runtime.endpoint 剔除')
    assert.ok(!('proxyAgent' in (preset.runtime as any)), 'runtime.proxyAgent 剔除')
    assert.ok(!('apiKey' in (preset.runtime as any).nested), '嵌套 apiKey 剔除')
    assert.ok(!('model' in preset), 'model 整段剔除')
    assert.ok(!('onebot' in preset), 'onebot 整段剔除')
    assert.ok(removed.length >= 5, `removed 包含全部剔除项(实际 ${removed.length})`)
    assert.ok(removed.includes('model') && removed.includes('onebot'))
  })

  it('diffSection:识别修改/新增/移除', () => {
    const local = { autoAdvanceIntervalMinutes: 40, contextEntryLimit: 35, oldKey: 'x' }
    const remote = { autoAdvanceIntervalMinutes: 20, contextEntryLimit: 35, newKey: 'y' }
    const d = diffSection(local, remote)
    assert.deepEqual(d.changed, ['autoAdvanceIntervalMinutes'])
    assert.deepEqual(d.added, ['newKey'])
    assert.deepEqual(d.removedKeys, ['oldKey'])
  })

  it('buildConfigPatch:白名单分区整段替换,非白名单分区不动;storyDefaults 默认跳过、显式开启后作为模板写入', () => {
    const config: any = { runtime: { a: 1 }, urge: { b: 2 }, model: { providers: [{ apiKey: 'LOCAL' }] }, onebot: { enabled: true } }
    const preset: any = {
      runtime: { autoAdvanceIntervalMinutes: 15 },
      urge: { enabled: true, frequency: 'low' },
      storyDefaults: { characterName: 'X' },
      model: { providers: [{ apiKey: 'POISON' }] },
      unknownSection: { x: 1 },
    }
    const patched = buildConfigPatch(config, preset, ['runtime', 'urge', 'storyDefaults', 'model', 'unknownSection']) as any
    assert.deepEqual(patched.runtime, { autoAdvanceIntervalMinutes: 15 })
    assert.deepEqual(patched.urge, { enabled: true, frequency: 'low' })
    assert.equal(patched.model.providers[0].apiKey, 'LOCAL', 'model 不被预设覆盖')
    assert.equal(patched.onebot.enabled, true, 'onebot 不被预设覆盖')
    assert.ok(!('storyDefaults' in patched), '默认(未开启 includeStoryDefaults)storyDefaults 不进配置')
    assert.equal(config.runtime.a, 1, '原 config 不被修改(纯函数)')
    // rc48:includeStoryDefaults 时 storyDefaults 作为模板写入(新故事孵化来源)
    const withTemplate = buildConfigPatch(config, preset, ['storyDefaults'], { includeStoryDefaults: true }) as any
    assert.deepEqual(withTemplate.storyDefaults, { characterName: 'X' }, '模板写入时整段替换')
  })

  it('storyDefaultsToSettingPatch:字段映射与空值跳过', () => {
    const patch = storyDefaultsToSettingPatch({
      characterName: '沈书言', characterProfile: '研究生', world: '中国南方',
      perspective: '陪伴是安静的', perspectives: ['a', ' ', 'b'],
      supplementaryFacts: ['f1', ''], userProfile: '网友', relationship: '朋友',
      supportingCast: '室友', location: '大学城', style: '现实主义', timezone: 'Asia/Shanghai',
    })
    assert.equal(patch.character?.name, '沈书言')
    assert.equal(patch.character?.profile, '研究生')
    assert.equal(patch.world, '中国南方')
    assert.deepEqual(patch.perspectives, ['a', 'b'])
    assert.deepEqual(patch.supplementaryFacts, ['f1'])
    assert.equal(patch.timezone, 'Asia/Shanghai')
    // 空对象 → 空 patch
    assert.deepEqual(storyDefaultsToSettingPatch({}), {})
    assert.deepEqual(storyDefaultsToSettingPatch(null), {})
    assert.deepEqual(storyDefaultsToSettingPatch({ characterName: '' }), {})
  })

  it('storyDefaultsToSettingPatch:部分 character 字段不会清空另一字段', () => {
    assert.deepEqual(storyDefaultsToSettingPatch({ characterName: '仅名称' }).character, { name: '仅名称' })
    assert.deepEqual(storyDefaultsToSettingPatch({ characterProfile: '仅人设' }).character, { profile: '仅人设' })
  })

  it('SHARE_SECTIONS:17 个分区,不含 model/onebot', () => {
    assert.equal(SHARE_SECTIONS.length, 17)
    assert.ok(!SHARE_SECTIONS.includes('model' as any))
    assert.ok(!SHARE_SECTIONS.includes('onebot' as any))
  })
})
