/** Weather snapshots share the seeded-event timeline, with independent source
 * configuration and the same task lifetime as other background work. */
import { Time } from 'koishi'
import { fetchWeatherSnapshot, isFantasyStory } from './weather'
import { captureStoryTask } from './task-lifecycle'

function locationKey(config: any, story: any) {
  return JSON.stringify([story.setting.location ?? '', config.autoFromLocation, config.latitude, config.longitude])
}

export async function weatherSweep(svc: any) {
  if (svc.databaseResetting || svc.disposed || svc.desktopRuntimePhase === 'paused' || !svc.weatherConfig.enabled) return
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
      subjects: [], sourcePayload: { weather: true, ...snapshot, locationKey: key },
    })
    svc.reportOperation('standard', 'info', story, 'advance', '天气快照已注入 %s', snapshot.text)
  })
}
