/**
 * 文风拟真度测试 · 评审包生成与聚合（设计文档 §8.3 / §9）。
 *
 * 用法：
 *   node --import tsx test/realism/build-review.ts --segments P01,P02          # 生成评审包
 *   node --import tsx test/realism/build-review.ts --segments P01 --blind      # 盲评（隐去臂名）
 *   node --import tsx test/realism/build-review.ts --aggregate                 # 全部段指标聚合表
 *
 * 同名段有多份产物时，--segments 使用日期/样本目录作为标识。评分区留空由二审人工填写。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { ROOT, listResultIds, readManifest, readResult } from './results'
import type { SegmentManifest } from './campaign'
const REPORT_DIR = path.join(ROOT, 'report')

type Manifest = SegmentManifest & {
  arm?: SegmentManifest['variant']
  provider?: { model: string }
  persona?: SegmentManifest['persona'] & { label?: string }
}

type ManifestVariant = NonNullable<Manifest['variant'] | Manifest['arm']>

function variantOf(manifest: Manifest): ManifestVariant {
  const variant = manifest.variant ?? manifest.arm
  if (!variant) throw new Error(`段 ${manifest.segment} 的 manifest 缺 variant/arm 字段`)
  return variant
}

function modelOf(manifest: Manifest): string {
  return manifest.engine?.model ?? manifest.provider?.model ?? '未知'
}

function selectResult(selection: string): string {
  if (selection.includes('/')) return selection
  const options = listResultIds().filter(id => {
    try { return readManifest(id)?.segment === selection } catch { return false }
  })
  if (options.length !== 1) throw new Error(options.length
    ? `段 ${selection} 有多份样本，请指定样本 ID：${options.join(', ')}`
    : `未找到段 ${selection} 的输出`)
  return options[0]
}

function buildReview(selection: string, blind: boolean): void {
  const resultId = selectResult(selection)
  const data = readResult(resultId)
  if (!data) throw new Error(`样本 ${resultId} 无产物`)
  const manifest: Manifest = data.manifest
  const { turns } = data
  const variant = variantOf(manifest)
  const armTitle = blind ? '（盲评：臂名已隐藏）' : `${variant.id} · ${variant.label}（在场度 ${variant.presence}，${variant.lang === 'en' ? '英文叙述' : '中文叙述'}）`
  const personaTitle = manifest.persona
    ? `人物：${manifest.persona.characterName}${manifest.persona.label ? `（${manifest.persona.label}）` : ''}`
    : '人物：林晚（默认 fixture）'
  const lines: string[] = [
    `# 评审包 ${blind ? "（盲评）" : resultId} — ${manifest.scenario.label}`,
    '',
    `臂：${armTitle}`,
    personaTitle,
    `${blind ? '' : `模型：${modelOf(manifest)}　`}段长：${turns.length} 轮 · ${manifest.status}`,
    '',
    '## 逐轮记录',
    '',
  ]
  for (const turn of turns) {
    lines.push(`### ${turn.seq}. [${turn.atLocal}] ${turn.kind === 'advance' ? '（advance 相位）' : `用户：${turn.userMessage ?? ''}`}`)
    const reply = turn.parsed?.replyContent
    const bubbles = reply ? reply.split('<sep/>').filter(Boolean) : []
    if (turn.parsed?.replyMode === 'none') lines.push('  ↳ （未回复）')
    else if (turn.parsed?.replyMode === 'delayed') lines.push(`  ↳ 延迟回复（sendAt ${turn.parsed?.replySendAt}）：${reply ?? ''}`)
    else if (bubbles.length) lines.push(`  ↳ 回复（${bubbles.length} 泡）：${bubbles.map(bubble => `「${bubble}」`).join(' ')}`)
    if (turn.error || turn.parseError) lines.push(`  ↳ （回合错误：${turn.error || turn.parseError}）`)
    const flags = (turn.checks ?? []).filter(check => check.verdict !== 'pass' && check.verdict !== 'skip')
    if (flags.length) lines.push(`  ↳ ⚠ ${flags.map(check => `${check.id}${check.verdict === 'fail' ? '✗' : '?'}：${check.detail ?? ''}`).join('；')}`)
    const prose = turn.parsed?.script
    if (prose) lines.push(`  ↳ 剧本：${prose}`)
    lines.push('')
  }
  lines.push(
    '## 快评分（sprint 用）',
    '',
    '| 维度 | 1 破功 | 2 | 3 及格 | 4 | 5 拟真 | 得分 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| 语言自然度 | 明显 AI 腔 | | 偶有书面腔 | | 像真人打字 | |',
    '| 情绪真实 | 直给且不匹配 | | 基本匹配但套路 | | 从动作里渗出 | |',
    '| 文风执行度 | 完全没执行 | | 部分执行 | | 稳定执行 | |',
    '',
    '出戏标记（一句话一处）：',
    '',
    '- ',
    '- ',
    '',
    '佳句标记：',
    '',
    '- ',
  )
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  const suffix = blind ? createHash('sha256').update(resultId).digest('hex').slice(0, 12) + '-blind' : resultId.replace('/', '_')
  const file = path.join(REPORT_DIR, `review-${suffix}.md`)
  fs.writeFileSync(file, lines.join('\n') + '\n')
  process.stdout.write(`已生成 ${file}\n`)
}

function aggregate(): void {
  const rows: string[] = ['| 样本 | 状态 | 臂 | 场景 | 轮数 | 错误轮 | H失败 | tokens | scriptLen均值 | 分泡均值 | 开场重复率 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
  for (const resultId of listResultIds()) {
    try {
      const data = readResult(resultId)
      if (!data) continue
      const { manifest, turns } = data
      const withMetrics = turns.filter(turn => turn.metrics)
      const avgLen = withMetrics.length ? Math.round(withMetrics.reduce((sum, t) => sum + Number(t.metrics!.scriptLength ?? 0), 0) / withMetrics.length) : 0
      const avgBubbles = withMetrics.length ? Math.round(withMetrics.reduce((sum, t) => sum + Number(t.metrics!.bubbleCount ?? 0), 0) / withMetrics.length * 100) / 100 : 0
      const openers = new Map<string, number>()
      for (const turn of withMetrics) {
        const opener = String(turn.metrics!.opener8 ?? '')
        if (opener) openers.set(opener, (openers.get(opener) ?? 0) + 1)
      }
      const maxRepeat = [...openers.values()].reduce((max, count) => Math.max(max, count), 0)
      const repeatRate = withMetrics.length ? Math.round(maxRepeat / withMetrics.length * 100) : 0
      rows.push(`| ${resultId} | ${manifest.status} | ${variantOf(manifest).id} | ${manifest.scenario.id} | ${turns.length} | ${manifest.errorTurns} | ${JSON.stringify(manifest.hFails)} | ${manifest.totalTokens ?? 0} | ${avgLen} | ${avgBubbles} | ${repeatRate}% |`)
    } catch (error) {
      process.stderr.write(`跳过 ${resultId}：${(error as Error).message}\n`)
    }
  }
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  const file = path.join(REPORT_DIR, 'aggregate.md')
  fs.writeFileSync(file, rows.join('\n') + '\n')
  process.stdout.write(`已生成 ${file}\n` + rows.join('\n') + '\n')
}

function main(): void {
  const argv = process.argv.slice(2)
  if (argv.includes('--aggregate')) return aggregate()
  const segmentsIndex = argv.indexOf('--segments')
  const segments = (segmentsIndex >= 0 ? argv[segmentsIndex + 1] ?? '' : '').split(',').filter(Boolean)
  if (!segments.length) throw new Error('需要 --segments <段号列表>（或 --aggregate）')
  const blind = argv.includes('--blind')
  for (const segment of segments) buildReview(segment, blind)
}

main()
