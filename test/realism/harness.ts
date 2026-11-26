/**
 * Realism Lab · CLI 入口（引擎 campaign.ts 由 profile 驱动；Web 界面 server.ts + ui/）。
 *
 * 用法：
 *   node --import tsx test/realism/harness.ts --list [--profile round1]
 *   node --import tsx test/realism/harness.ts --dry --segment P01
 *   node --import tsx test/realism/harness.ts --segment P01
 *   node --import tsx test/realism/harness.ts --phase 2A|2P|2B|outer [--only P01,P02]
 *   npm run realism:profile:migrate   # 从 TS 常量重新生成 round1 profile
 *
 * 环境变量（实跑必需；--dry 不需要）：
 *   HDSI_TEST_PROVIDER_ENDPOINT / HDSI_TEST_API_KEY / HDSI_TEST_MODEL
 *   HDSI_TEST_SAMPLING=off / HDSI_TEST_PROXY / HDSI_TEST_PROTOCOL /
 *   HDSI_TEST_TIMEOUT_MS / HDSI_TEST_MAX_TOKENS
 */
import { profileSegments, runSegment, consoleProgressSink, resolveEnvFromProcess, describeRun } from './campaign'
import { loadProfile, migrateAndSave, DEFAULT_PROFILE } from './profile'

interface CliOptions {
  list?: boolean
  dry?: boolean
  segment?: string
  phase?: string
  only?: string[]
  profile?: string
  migrate?: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--list') options.list = true
    else if (arg === '--dry') options.dry = true
    else if (arg === '--segment') options.segment = argv[++index]
    else if (arg === '--phase') options.phase = argv[++index]
    else if (arg === '--only') options.only = (argv[++index] ?? '').split(',').filter(Boolean)
    else if (arg === '--profile') options.profile = argv[++index]
    else if (arg === '--migrate') options.migrate = true
  }
  return options
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  if (options.migrate) {
    const profile = migrateAndSave(options.profile ?? DEFAULT_PROFILE)
    process.stdout.write(`已生成 profile：${profile.meta.name}（variants=${profile.variants.length} personas=${profile.personas.length} scenarios=${profile.scenarios.length} 段=${profileSegments(profile).length}）\n`)
    return
  }
  const profile = loadProfile(options.profile ?? DEFAULT_PROFILE)
  const all = profileSegments(profile)

  if (options.list) {
    for (const phase of profile.matrix.phases) {
      process.stdout.write(`# ${phase.key} · ${phase.name}\n`)
      for (const segment of phase.segments) {
        const desc = segment.variant === 'TBD' ? '(待决策点后填入)' : `${segment.variant} × ${segment.scenario}${segment.persona ? ` × ${segment.persona}` : ''}`
        process.stdout.write(`${segment.id}\t${desc}${segment.optional ? '\t(预算备选)' : ''}\n`)
      }
    }
    return
  }

  let segments
  if (options.segment) {
    segments = all.filter(item => item.id === options.segment)
    if (!segments.length) throw new Error(`矩阵中无段号 ${options.segment}`)
  } else if (options.phase) {
    const phase = profile.matrix.phases.find(item => item.key === options.phase || `phase${options.phase}` === item.key)
    if (!phase) throw new Error(`未知阶段 ${options.phase}（可用：${profile.matrix.phases.map(item => item.key).join(' / ')}）`)
    segments = phase.segments
  } else {
    throw new Error('需要 --segment <段号> 或 --phase <phase2A|phase2P|phase2B|outer>（或 --list / --migrate）')
  }
  const selected = options.only?.length ? segments.filter(segment => options.only!.includes(segment.id)) : segments
  if (!selected.length) throw new Error('--only 过滤后无段可跑')

  const env = resolveEnvFromProcess()
  if (!options.dry) for (const segment of selected) {
    if (segment.variant !== 'TBD') describeRun(profile, env, segment)
  }

  process.stdout.write(`拟真度测试：profile=${profile.meta.name}，${selected.length} 段，模式 ${options.dry ? 'DRY（无网络）' : 'LIVE'}\n`)
  ;(async () => {
    const baseSink = consoleProgressSink()
    let errors = 0
    const sink: typeof baseSink = { ...baseSink, onSegmentDone(segment, manifest) {
      baseSink.onSegmentDone?.(segment, manifest)
      if (manifest.status === 'failed') errors++
      process.stdout.write(`样本 ID：${manifest.resultId}\n`)
    } }
    for (const segment of selected) {
      if (segment.variant === 'TBD') {
        process.stdout.write(`  [${segment.id}] 跳过：variant 未定（在界面设置页或 profile JSON 中填入）\n`)
        continue
      }
      await runSegment(segment, { profile, env, dry: options.dry === true, sink })
    }
    process.stdout.write(errors ? `队列结束，${errors} 段有失败回合。\n` : '全部完成。\n')
    if (errors) process.exitCode = 1
  })().catch(error => {
    process.stderr.write(`失败：${(error as Error).message}\n`)
    process.exit(1)
  })
}

main()
