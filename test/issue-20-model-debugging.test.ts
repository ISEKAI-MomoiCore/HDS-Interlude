import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/** Issue #20 回归：非法 JSON 的受控预览、提供商失败可见性、模型自检一条龙。 */

test('#20 P1a：侧任务非法 JSON 仅在显式启用时输出诊断预览，错误不带原文', async () => {
  const { OpenAICompatibleNarrator, rawResponseExcerpt } = await import('../src/narrator')
  const narrator: any = Object.create(OpenAICompatibleNarrator.prototype)
  const diagnostics: unknown[][] = []
  let previewLength = 0
  narrator.diagnostics = { previewLength: () => previewLength }
  narrator.logger = { warn: (...args: unknown[]) => diagnostics.push(args), debug: (...args: unknown[]) => diagnostics.push(args) }
  narrator.config = { failover: { enabled: false, cooldownMinutes: 1 } }
  narrator.cooldownUntil = new Map()
  narrator.onSideTaskHealth = () => {}
  narrator.postChat = async () => ({ choices: [{ message: { content: '抱歉，我   不能\n输出 JSON。' } }] })
  const request = () => assert.rejects(
    narrator.customSideTask({ endpoint: 'https://api.example.com/v1/chat/completions', apiKey: 'k', model: 'm', label: '示例' },
      '测试任务', 5_000, 0, 64, 'system', 'ping'),
    (error: Error) => {
      assert.doesNotMatch(error.message, /抱歉|原文头=/)
      assert.match(error.message, /invalid JSON/)
      return true
    },
  )
  await request()
  assert.doesNotMatch(JSON.stringify(diagnostics), /抱歉/)
  previewLength = 8
  await request()
  assert.ok(diagnostics.some((args) => args.includes('抱歉，我 不能 ')))
  assert.equal(rawResponseExcerpt('  a \n b  c '), 'a b c', '摘录压缩空白')
})

test('#20 P1b：叙事提供商失败日志 warn 级 + 端点主机；Token 用量带来源（源码钉）', async () => {
  const narratorSource = readFileSync('src/narrator.ts', 'utf8')
  assert.ok(narratorSource.includes("this.logger?.warn?.(\n              '叙事模型服务商失败"), '提供商失败从 debug 提到 warn')
  assert.ok(narratorSource.includes('providerEndpointHost(provider.endpoint)'), '失败日志带端点主机')
  const serviceSource = readFileSync('src/service.ts', 'utf8')
  assert.ok(serviceSource.includes('来源=${record.providerLabel ||'), 'Token 用量日志带实际应答来源')
})

test('#20 P2：模型自检一条龙——路由摘要 + 逐提供商成功/失败 + 嵌入', async () => {
  const { InterludeService } = await import('../src/service')
  const service: any = Object.create(InterludeService.prototype)
  service.modelRouting = {
    main: { available: true, providers: [
      { endpoint: 'https://a.example.com/v1/chat/completions', apiKey: 'k', model: 'm1', label: '甲站' },
      { endpoint: 'https://b.example.com/v1/chat/completions', apiKey: 'k', model: 'm2', label: '乙站' },
    ] },
    compaction: { available: false, providers: [] },
    stickers: { available: true, providers: [{ endpoint: 'https://a.example.com/v1/chat/completions', apiKey: 'k', model: 'm1', label: '甲站' }] },
    research: { available: false, providers: [] },
    embedding: { available: true, providers: [] },
  }
  service.narrator = {
    customSideTask: async (provider: any, task: string) => {
      if (provider.label === '乙站') throw new Error('乙站提供商返回非法 JSON。原文头=我无法解析')
      return { ok: true }
    },
  }
  service.embedText = async () => [0.1, 0.2, 0.3]
  const lines = (await service.modelProbeLines()).join('\n')
  assert.match(lines, /主叙事 ✔ 甲站 · m1 @ a\.example\.com 成功 耗时=\d+ms/)
  assert.match(lines, /主叙事 ✘ 乙站 · m2 @ b\.example\.com 失败：乙站提供商返回非法 JSON。原文头=我无法解析/)
  assert.match(lines, /压缩：（未配置\/不可用）/)
  assert.match(lines, /播种\/贴纸 ✔/)
  assert.match(lines, /嵌入 ✔ 成功 维度=3/)
  assert.ok(lines.includes('提示：'), '带解读提示')
})
