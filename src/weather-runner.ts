/** Weather snapshots share the seeded-event timeline, with independent source
 * configuration and the same task lifetime as other background work. */
import { Time } from 'koishi'
import { fetchWeatherSnapshot, hasNotableWeatherChange, hasValidWeatherCode, isFantasyStory, weatherSampleTime, type WeatherSnapshot } from './weather'
import { captureStoryTask } from './task-lifecycle'

function locationKey(config: any, story: any) {
  return JSON.stringify([story.setting.location ?? '', config.autoFromLocation, config.latitude, config.longitude])
}

// Last distinct valid sample for the current story/location. This is only an
// attention input: it never participates in weather admission or deduplication.
const weatherAttentionSamples = new WeakMap<object, { scope: string, snapshot: WeatherSnapshot, changed: boolean }>()

function sampleAttentionChange(svc: object, scope: string, snapshot: WeatherSnapshot, cadenceMinutes: number) {
  const previous = weatherAttentionSamples.get(svc)
  if (previous?.scope !== scope) weatherAttentionSamples.delete(svc)
  if (!hasValidWeatherCode(snapshot)) return false
  if (previous?.scope === scope && (previous.snapshot.observedAt === undefined) === (snapshot.observedAt === undefined)) {
    const delta = weatherSampleTime(snapshot) - weatherSampleTime(previous.snapshot)
    if (delta < 0) return false
    if (delta === 0) return previous.changed && snapshot.weatherCode === previous.snapshot.weatherCode
      && snapshot.fetchedAt - previous.snapshot.fetchedAt <= 2 * cadenceMinutes * 60_000
  }
  const changed = previous?.scope === scope && hasNotableWeatherChange(previous.snapshot, snapshot, cadenceMinutes)
  weatherAttentionSamples.set(svc, { scope, snapshot, changed })
  return changed
}

// There is only one canonical weather story per service. The guard covers
// both fetching and waiting in the story queue to commit the sample.
const weatherSweepRunning = new WeakSet<object>()

export async function weatherSweep(svc: any) {
  if (svc.databaseResetting || svc.disposed || svc.desktopRuntimePhase === 'paused' || !svc.weatherConfig.enabled) return
  if (weatherSweepRunning.has(svc)) return
  weatherSweepRunning.add(svc)
  try {
    await runWeatherSweep(svc)
  } finally {
    weatherSweepRunning.delete(svc)
  }
}

async function runWeatherSweep(svc: any) {
  const story = await svc.getCanonicalStory()
  if (!story || !svc.canHandleStory(story)) return
  const task = captureStoryTask(svc, story.id)
  const config = { ...svc.weatherConfig }
  if (!task.taskCurrent() || (config.skipFantasyWorld && isFantasyStory(story.setting.world, story.setting.location))) return
  const key = locationKey(config, story)
  const snapshot = await fetchWeatherSnapshot(svc.ctx, config, story.setting.location)
  if (!task.taskCurrent()) return
  if (!snapshot) { svc.reportOperation('diagnostic', 'debug', story, 'advance', '天气拉取失败或无数据,本轮跳过'); return }
  await svc.serial(story.id, async () => {
    if (!task.taskCurrent()) return
    const current = await svc.getCanonicalStory()
    const currentConfig = svc.weatherConfig
    if (!task.taskCurrent() || current?.id !== story.id || !svc.canHandleStory(current) || !currentConfig.enabled
      || locationKey(currentConfig, current) !== key
      || (currentConfig.skipFantasyWorld && isFantasyStory(current.setting.world, current.setting.location))) return
    const now = new Date()
    const rows = await svc.dbGet('interlude_seeded_event', { storyId: story.id, sourcePayload: { weather: true }, status: { $in: ['scheduled', 'injecting', 'injected'] } }) as any[]
    if (!task.taskCurrent()) return
    const weatherRows = rows.filter(row => row.sourcePayload?.weather === true)
    const scope = JSON.stringify([story.id, svc.deliveryGeneration?.(story.id), key, snapshot.observationPoint])
    const weatherChanged = sampleAttentionChange(svc, scope, snapshot, config.cadenceMinutes)
    const same = weatherRows.find(row => (row.status === 'scheduled' || row.status === 'injecting' || row.status === 'injected')
      && row.summary === snapshot.text && row.sourcePayload?.locationKey === key
      && row.expiresAt && new Date(row.expiresAt).getTime() > now.getTime())
    if (same) { svc.reportOperation('diagnostic', 'debug', story, 'advance', '天气无变化,跳过注入 %s', snapshot.text); return }
    for (const row of weatherRows) {
      if (!task.taskCurrent()) return
      if (row.status === 'scheduled' || row.status === 'injecting' || row.status === 'injected') {
        await svc.dbSet('interlude_seeded_event', { id: row.id }, { status: 'expired', updatedAt: now })
      }
    }
    if (!task.taskCurrent()) return
    const expiresAt = new Date(now.getTime() + config.cadenceMinutes * 60_000 + 30 * Time.minute)
    await svc.dbCreate('interlude_seeded_event', {
      storyId: story.id, summary: snapshot.text, importance: 'low',
      occursAt: now, expiresAt, status: 'scheduled',
      subjects: [], sourcePayload: { weather: true, ...snapshot, weatherChanged, locationKey: key },
    })
    svc.reportOperation('standard', 'info', story, 'advance', '天气快照已注入 %s', snapshot.text)
  })
}
