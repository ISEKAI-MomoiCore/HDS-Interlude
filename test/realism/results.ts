import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { SegmentManifest, TurnRecord } from './campaign'

export const ROOT = path.dirname(fileURLToPath(import.meta.url))
export const OUT_ROOT = path.join(ROOT, 'out')
const samplePattern = /^(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9_-]+)$/

export function isSegmentId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id)
}

export function listResultIds(date?: string): string[] {
  if (!fs.existsSync(OUT_ROOT)) return []
  return fs.readdirSync(OUT_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name) && (!date || entry.name === date))
    .map(entry => entry.name).sort().reverse()
    .flatMap(day => fs.readdirSync(path.join(OUT_ROOT, day), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && isSegmentId(entry.name))
      .map(entry => `${day}/${entry.name}`)
      .filter(id => resultDir(id)))
}

export function resultDir(id: unknown): string | undefined {
  if (typeof id !== 'string') return undefined
  const match = samplePattern.exec(id)
  if (!match) return undefined
  const day = path.join(OUT_ROOT, match[1])
  const directory = path.join(day, match[2])
  if (!fs.lstatSync(OUT_ROOT, { throwIfNoEntry: false })?.isDirectory()
    || !fs.lstatSync(day, { throwIfNoEntry: false })?.isDirectory()
    || !fs.lstatSync(directory, { throwIfNoEntry: false })?.isDirectory()
    || !fs.lstatSync(path.join(directory, 'manifest.json'), { throwIfNoEntry: false })?.isFile()) return undefined
  return directory
}

export function writeAtomic(file: string, contents: string): void {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, contents, { flag: 'wx' })
    fs.renameSync(temporary, file)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

export function summarizeTurns(turns: TurnRecord[], expected: number | undefined, stopped?: boolean) {
  const hFails: Record<string, number> = Object.create(null)
  for (const turn of turns) {
    for (const check of turn.checks ?? []) {
      if (check.verdict === 'fail') hFails[check.id] = (hFails[check.id] ?? 0) + 1
    }
  }
  const errorTurns = turns.filter(turn => turn.error || turn.parseError).length
  const complete = turns.length > 0 && (expected === undefined || turns.length === expected)
    && turns.every((turn, index) => turn.seq === index + 1)
  const status = stopped ? 'stopped' : complete && !errorTurns ? 'complete' : 'failed'
  return { hFails, errorTurns, status } as const
}

export function readManifest(id: string): SegmentManifest | undefined {
  const directory = resultDir(id)
  return directory ? JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')) as SegmentManifest : undefined
}

export function readResult(id: string, manifest = readManifest(id)) {
  const directory = resultDir(id)
  if (!directory || !manifest) return undefined
  const file = path.join(directory, 'turns.jsonl')
  const turns = fs.lstatSync(file, { throwIfNoEntry: false })?.isFile()
    ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as TurnRecord)
    : []
  // 老报告的 parseError 没有记入 H1，读取时补齐，保留原始文件。
  for (const turn of turns) {
    if (turn.parseError && !turn.checks?.some(check => check.id === 'H1' && check.verdict === 'fail')) {
      turn.checks = [...(turn.checks ?? []).filter(check => check.id !== 'H1'), { id: 'H1', verdict: 'fail', detail: turn.parseError }]
    }
  }
  return { resultId: id, manifest: { ...manifest, resultId: id, ...summarizeTurns(turns, manifest.scenario?.turnCount, manifest.stopped) }, turns }
}
