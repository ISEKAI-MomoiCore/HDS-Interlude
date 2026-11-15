import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_HARVEST_JUDGMENT_PROMPT, DEFAULT_STICKER_HARVEST_CONFIG, DailyQuotaTracker,
  parseHarvestJudgment, resolveStickerHarvestConfig, shouldHarvestSticker, StickerHarvestStore,
  type HarvestProvenance,
} from '../src/sticker-harvest'
import { OpenAICompatibleNarrator, type ModelConfig, type ProviderConfig } from '../src/narrator'

const pngDataUri = (bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`
const provenance = (chatKey = 'u1'): HarvestProvenance => ({
  platform: 'onebot', chatType: 'private', chatKey, senderId: 'u1', receivedAt: '2026-10-27T08:00:00.000Z',
})
const limits = { maxStagingFiles: 200, maxFileSizeMB: 10 }

function tempDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix))
}

test('harvest config resolves defaults, clamps numerics and sanitizes the kept subfolder', () => {
  assert.deepEqual(Object.keys(DEFAULT_STICKER_HARVEST_CONFIG).sort(), [
    'enabled', 'harvestPrompt', 'keptSubfolder', 'maxFileSizeMB', 'maxPerChatPerDay', 'maxStagingFiles', 'privateChats', 'scanIntervalMinutes', 'stagingDirectory',
  ])
  const resolved = resolveStickerHarvestConfig(undefined)
  assert.equal(resolved.enabled, false)
  assert.equal(resolved.privateChats, false)
  assert.equal(resolved.stagingDirectory, 'data/hds-interlude/sticker-harvest')
  assert.equal(resolved.scanIntervalMinutes, 30)
  const clamped = resolveStickerHarvestConfig({ enabled: true, scanIntervalMinutes: 1, maxPerChatPerDay: 9999, maxStagingFiles: 1, keptSubfolder: 'a/b\\..\\c', maxFileSizeMB: 0 })
  assert.equal(clamped.scanIntervalMinutes, 5)
  assert.equal(clamped.maxPerChatPerDay, 500)
  assert.equal(clamped.maxStagingFiles, 10)
  assert.equal(clamped.maxFileSizeMB, 10, '0/NaN 数值按房屋钳制惯例回落默认值')
  assert.equal(clamped.keptSubfolder, 'ab..c')
})

test('the built-in judgment prompt states keep and discard criteria and the JSON contract', () => {
  assert.match(DEFAULT_HARVEST_JUDGMENT_PROMPT, /保留：/)
  assert.match(DEFAULT_HARVEST_JUDGMENT_PROMPT, /丢弃：/)
  assert.match(DEFAULT_HARVEST_JUDGMENT_PROMPT, /"keep"/)
})

test('judgment parsing is tolerant but rejects a missing boolean decision', () => {
  assert.deepEqual(parseHarvestJudgment('{"keep":true,"reason":"情绪清晰"}'), { keep: true, reason: '情绪清晰' })
  assert.deepEqual(parseHarvestJudgment('前置噪声 ```json\n{"keep": false, "reason": "纯文字截图", "tags": ["截图", 1]}\n``` 后置'), { keep: false, reason: '纯文字截图', tags: ['截图', '1'] })
  assert.equal(parseHarvestJudgment('{"reason":"没有决定"}'), undefined)
  assert.equal(parseHarvestJudgment('完全不是 JSON'), undefined)
})

test('gating requires the master switch, the sticker library and the per-chat toggle', () => {
  const config = { ...DEFAULT_STICKER_HARVEST_CONFIG, enabled: true, privateChats: true }
  assert.equal(shouldHarvestSticker(config, true, 'private'), true)
  assert.equal(shouldHarvestSticker(config, false, 'private'), false, '表情库未启用时采集不生效')
  assert.equal(shouldHarvestSticker({ ...config, privateChats: false }, true, 'private'), false)
  assert.equal(shouldHarvestSticker(config, true, 'group', true), true)
  assert.equal(shouldHarvestSticker(config, true, 'group', false), false)
  assert.equal(shouldHarvestSticker({ ...config, enabled: false }, true, 'private'), false)
})

test('the daily quota counts per chat and resets by calendar day', () => {
  const quota = new DailyQuotaTracker()
  for (let index = 0; index < 3; index++) assert.equal(quota.within('g1', 3), true)
  assert.equal(quota.within('g1', 3), false)
  assert.equal(quota.within('g2', 3), true, '配额按聊天隔离')
  assert.equal(quota.within('g1', 0), false, '0 配额恒拒绝')
})

test('the store stages files with manifests and dedupes by hash, memory and library index', async () => {
  const dir = tempDir('hdsi-harvest-store-')
  try {
    const store = new StickerHarvestStore(dir)
    const bytes = Buffer.from('fake-png-bytes')
    assert.equal(await store.ingest(pngDataUri(bytes), provenance(), limits), 'stored')
    const staged = await store.listStaged()
    assert.equal(staged.length, 1)
    const hash = staged[0].hash
    assert.equal(staged[0].fileName, `${hash}.png`)
    assert.equal(staged[0].provenance.chatKey, 'u1')
    assert.ok(existsSync(join(dir, `${hash}.png`)))
    const manifest = JSON.parse(readFileSync(join(dir, `${hash}.png.json`), 'utf8'))
    assert.equal(manifest.platform, 'onebot')
    // 同哈希重复入站：暂存去重。
    assert.equal(await store.ingest(pngDataUri(bytes), provenance('u2'), limits), 'duplicate')
    // 表情库已有该哈希：跳过并计数。
    assert.equal(await store.ingest(pngDataUri(bytes), provenance('u2'), limits, () => true), 'duplicate')
    assert.equal(store.counters.deduped, 1)
    // 非图片与超体积：直接跳过。
    assert.equal(await store.ingest('data:text/plain;base64,' + Buffer.from('x').toString('base64'), provenance(), limits), 'skipped')
    assert.equal(await store.ingest(pngDataUri(Buffer.alloc(11 * 1024 * 1024)), provenance(), { ...limits, maxFileSizeMB: 10 }), 'skipped')
    assert.equal((await store.listStaged()).length, 1)
    // 读取暂存图为 dataUri。
    const dataUri = await store.readStagedDataUri(staged[0])
    assert.ok(dataUri!.startsWith('data:image/png;base64,'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('kept stickers move into the library folder and discarded ones leave a memory', async () => {
  const dir = tempDir('hdsi-harvest-keep-')
  const library = tempDir('hdsi-harvest-lib-')
  try {
    const store = new StickerHarvestStore(dir)
    await store.ingest(pngDataUri(Buffer.from('keep-me')), provenance(), limits)
    await store.ingest(pngDataUri(Buffer.from('drop-me')), provenance(), limits)
    const staged = await store.listStaged()
    const keepHashExpected = await hashOf('keep-me')
    const keepHash = staged.find(item => item.hash === keepHashExpected)!.hash

    const target = await store.markKept(keepHash, library)
    assert.ok(target && target.startsWith(library))
    assert.ok(existsSync(target))
    assert.ok(!existsSync(join(dir, `${keepHash}.png`)), '暂存原图已移走')
    assert.ok(!existsSync(join(dir, `${keepHash}.png.json`)), 'sidecar 已清理')
    assert.equal(store.counters.kept, 1)

    const dropHash = staged.find(item => item.hash !== keepHash)!.hash
    await store.markDiscarded(dropHash)
    assert.equal((await store.listStaged()).length, 0)
    assert.equal(store.counters.discarded, 1)
    assert.equal(store.hasDiscarded(dropHash), true)
    assert.equal(await store.ingest(pngDataUri(Buffer.from('drop-me')), provenance('u9'), limits), 'duplicate', '丢弃记忆拦截同图再入')
    assert.equal(store.discardedMemorySize, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(library, { recursive: true, force: true })
  }
})

test('staging backlog beyond the cap evicts the oldest without judgment', async () => {
  const dir = tempDir('hdsi-harvest-evict-')
  try {
    const store = new StickerHarvestStore(dir)
    const tight = { maxStagingFiles: 2, maxFileSizeMB: 10 }
    await store.ingest(pngDataUri(Buffer.from('old')), { ...provenance(), receivedAt: '2026-10-27T08:00:00.000Z' }, tight)
    await store.ingest(pngDataUri(Buffer.from('mid')), { ...provenance(), receivedAt: '2026-10-27T09:00:00.000Z' }, tight)
    await store.ingest(pngDataUri(Buffer.from('new')), { ...provenance(), receivedAt: '2026-10-27T10:00:00.000Z' }, tight)
    const staged = await store.listStaged()
    const oldHash = await hashOf('old')
    assert.equal(staged.length, 2)
    assert.ok(!staged.some(item => item.hash === oldHash), '最旧的被清理')
    assert.equal(store.counters.evicted, 1)
    assert.equal(readdirSync(dir).filter(name => !name.endsWith('.json')).length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('customSideTaskWithImage sends one text part plus one image part and parses JSON', async () => {
  const provider: ProviderConfig = { label: 'harvest', enabled: true, endpoint: 'https://gateway.test/v1/chat/completions', apiKey: 'k', model: 'vision-model',
    temperature: 0.2, topP: 1, maxTokens: 512, timeout: 1000, responseFormat: 'json-object', extraHeaders: '', extraBody: '', useForStickers: true }
  const modelConfig = (): ModelConfig => ({ providers: [provider], fixedPrompt: '', stylePrompt: '', failover: { enabled: false, strategy: 'priority', maxAttemptsPerProvider: 1, cooldownMinutes: 0 } })
  let captured: any
  const narrator = new OpenAICompatibleNarrator({ http: { post: async (_url: string, body: any) => {
    captured = body
    return { choices: [{ message: { content: '{"keep":true,"reason":"通用性强"}' } }] }
  } } } as any, modelConfig(), true)
  const result = await narrator.customSideTaskWithImage<{ keep: boolean }>(provider, '表情包采集判定', 1000, 0.2, 512, '判定准则', '来源：私聊', 'data:image/png;base64,QUJD')
  assert.deepEqual(result, { keep: true, reason: '通用性强' })
  const user = captured.messages[1]
  assert.equal(user.role, 'user')
  assert.ok(Array.isArray(user.content))
  assert.equal(user.content[0].type, 'text')
  assert.equal(user.content[0].text, '来源：私聊')
  assert.equal(user.content[1].type, 'image_url')
  assert.equal(user.content[1].image_url.url, 'data:image/png;base64,QUJD')
  assert.deepEqual(captured.response_format, { type: 'json_object' })
  assert.equal(captured.messages[0].role, 'system')
  assert.equal(captured.messages[0].content, '判定准则')
})

async function hashOf(content: string) {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(Buffer.from(content)).digest('hex')
}
