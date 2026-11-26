import assert from 'node:assert/strict'
import test from 'node:test'
import { toPromptPayload } from '../src/narrator'
import { InterludeService } from '../src/service'
import { FOCUS_ATTENTIONS } from '../src/life-rhythm'
import { LIFE_RHYTHM_STALE_MS } from '../src/story-state'
import { entryEventAttention, fixedEventTier, resolveEventAttentionFocus, seededEventTier, type FixedAttentionEvent } from '../src/script/event-attention'
import { hasNotableWeatherChange, weatherAttentionOffset, type WeatherSnapshot } from '../src/weather'
import { attentionFixture, attentionBaselineDigest, from, now } from './event-attention-fixture'

test('attention table has the nine documented rows and a neutral fallback', () => {
  const columns: FixedAttentionEvent[] = ['privateBatch', 'groupBatch', 'groupBackground', 'weather', 'friendFeed']
  assert.deepEqual([...FOCUS_ATTENTIONS, null].map(focus => columns.map(event => fixedEventTier(focus, event))), [
    [1, 2, 2, 4, 2], [2, 3, 3, 4, 3], [3, 4, 5, 4, 5], [4, 5, 5, 4, 5], [2, 3, 4, 3, 3],
    [3, 4, 5, 3, 5], [3, 4, 5, 3, 4], [4, 5, 5, 4, 5], [5, 5, 5, 5, 5], [3, 3, 3, 3, 3],
  ])
  const assessedAt = new Date(now.getTime() - LIFE_RHYTHM_STALE_MS).toISOString()
  const rhythm = { attention: 'asleep' as const, assessedAt, basis: '', source: 'compactor' as const }
  assert.equal(resolveEventAttentionFocus(rhythm, now), 'asleep')
  assert.equal(resolveEventAttentionFocus(rhythm, new Date(+now + 1)), null)
  for (const attention of ['phone-focused', 'occupied', 'resting', 'available'] as const) {
    assert.equal(resolveEventAttentionFocus({ ...rhythm, attention }, now), null)
  }
  assert.equal(resolveEventAttentionFocus({ ...rhythm, assessedAt: 'invalid' }, now), null)
  assert.equal(resolveEventAttentionFocus(undefined, now), null)
})

test('world events multiply the two factors without focus adjustment or text-based classification', () => {
  assert.deepEqual(['low', 'medium', 'high'].map(importance =>
    ['environment', 'involved'].map(involvement => seededEventTier(importance, involvement))), [[5, 4], [4, 2], [3, 1]])
  assert.equal(seededEventTier('high', undefined), 3)
  assert.equal(seededEventTier(undefined, undefined), 5)
  const entry = { kind: 'world-event', metadata: { eventSource: 'world-seeder', importance: 'high', involvement: 'involved' } }
  assert.match(entryEventAttention(entry, 'asleep')!, /T1/)
  assert.match(entryEventAttention({ ...entry, metadata: { importance: 'high', seededEventId: 5 } }, 'device-focus-chat')!, /T5/)
})

test('weather severity precedes change, clamps at T1/T5, and uses raw finite km/h', () => {
  assert.equal(weatherAttentionOffset({ weatherCode: 65, weatherChanged: true }), -2)
  assert.equal(weatherAttentionOffset({ weatherCode: 0, windSpeedKmh: 50 }), -2)
  assert.equal(weatherAttentionOffset({ weatherCode: 61, windSpeedKmh: 49.99, weatherChanged: true }), 0)
  for (const windSpeedKmh of [undefined, -50, NaN, Infinity, '90', 49.99]) {
    assert.equal(weatherAttentionOffset({ weatherCode: 0, windSpeedKmh }), 1)
  }
  const weather = (metadata: Record<string, unknown>) => ({ kind: 'world-event', metadata: { ...metadata, eventSource: 'weather' } })
  assert.match(entryEventAttention(weather({ weatherCode: 96 }), 'avaliable-relax')!, /T1/)
  assert.match(entryEventAttention(weather({ weatherCode: 95 }), 'asleep')!, /T3/)
  assert.match(entryEventAttention(weather({ weatherCode: 61, weatherChanged: true }), 'busy-work')!, /T4/)
  assert.match(entryEventAttention(weather({}), 'asleep')!, /T5/)
})

test('notable weather change requires a different, valid recent sample from the same location', () => {
  const clear = { weatherCode: 0, observationPoint: 'x', fetchedAt: +from, observedAt: +from } as WeatherSnapshot
  const next = (weatherCode: number, extra: Partial<WeatherSnapshot> = {}) => ({ ...clear, weatherCode, observedAt: +from + 60 * 60_000, ...extra })
  for (const weatherCode of [61, 71, 45]) assert.equal(hasNotableWeatherChange(clear, next(weatherCode), 30), true)
  for (const sample of [next(3), next(999), next(61, { observedAt: +from }), next(61, { observationPoint: 'y' }),
    next(61, { observedAt: +from - 1 }), next(61, { observedAt: +from + 60 * 60_000 + 1 }), next(61, { observedAt: undefined })]) {
    assert.equal(hasNotableWeatherChange(clear, sample, 30), false)
  }
  assert.equal(hasNotableWeatherChange({ ...clear, weatherCode: 51 }, next(63), 30), false)
  assert.equal(hasNotableWeatherChange({ ...clear, weatherCode: undefined }, next(61), 30), false)
})

// Captured from the pre-annotation narrator, including original JSON key order.
const baseline = {
  private: ['1e5fa49b9481507230569df5a55bd42443d89e6ff44089bda35d9fb8e893c591', 'df27560bd24ca1e34b6cb24330eb2c7cbee15d8e885af20350df5a7b54ece472'],
  group: ['a1de330297b9af32ee45dd2adf4741a29f306f9324217232e7c8cf94bea3ff87', 'ea9e2616fd006d65879234dedf4d468314dc7d3183e51a7ca541a57c0ccaccf8'],
  advance: ['0e9c7db36ea52fcf9738277f5164d42df5b20ad1fd1913e89898a442f916aac3', '2643bd19682febdafa2a02ef983db4f1acab197316da3865f6bfac279f911002'],
}
const tier = (value: string | undefined) => value?.match(/（(T[1-5])）$/)?.[1]
for (const variant of ['private', 'group', 'advance'] as const) for (const cacheFirst of [false, true]) {
  test(`${variant} / cache-first=${cacheFirst}: only annotation fields differ from base payload`, () => {
    const request = attentionFixture(variant)
    for (const focus of ['busy-work', 'device-focus-chat'] as const) {
      request.eventAttentionFocus = focus
      const payload = JSON.parse(JSON.stringify(toPromptPayload(request, { cacheFirst })))
      const { recentScript, groupBackgroundAttention, recalledScript } = payload.relevantEstablishedEpisodes
      const event = payload.incomingEvent.event
      assert.equal(attentionBaselineDigest(payload), baseline[variant][cacheFirst ? 1 : 0])
      const work = focus === 'busy-work'
      assert.deepEqual(recentScript.map((item: { eventAttention?: string }) => tier(item.eventAttention)), [undefined, 'T2', 'T1', work ? 'T5' : 'T2', 'T5', undefined])
      assert.equal(recalledScript[0].eventAttention, undefined)
      assert.match(payload.authoringWindow.eventAttentionGuide, /不表示已经或必然注意到/)
      if (variant === 'advance') {
        assert.equal(event.eventAttention, undefined)
        assert.equal(tier(groupBackgroundAttention), work ? 'T5' : 'T2')
        assert.ok(Object.keys(payload.relevantEstablishedEpisodes).indexOf('groupBackgroundAttention') < Object.keys(payload.relevantEstablishedEpisodes).indexOf('groupBackground'))
      } else {
        assert.equal(tier(event.eventAttention), variant === 'private' ? (work ? 'T3' : 'T1') : (work ? 'T4' : 'T2'))
        assert.ok(Object.keys(event).indexOf('eventAttention') < Object.keys(event).indexOf('content'))
      }
      assert.ok(Object.keys(recentScript[1]).indexOf('eventAttention') < Object.keys(recentScript[1]).indexOf('content'))
    }
  })
}

test('no guide for an empty intent-due turn; dropped history is not separately annotated', () => {
  const request = attentionFixture('advance')
  request.phase = 'intent-due'
  request.groupBackground = []
  const script = request.recentEntries[0]
  request.recentEntries = [request.recentEntries[1], ...Array.from({ length: 5 }, (_, i) => ({ ...script, id: i + 10, content: 'x'.repeat(4_000) }))]
  for (const cacheFirst of [false, true]) {
    const payload = toPromptPayload(request, { cacheFirst })
    assert.deepEqual(payload.incomingEvent.event, { type: 'due-intents' })
    assert.equal(payload.authoringWindow.eventAttentionGuide, undefined)
  }
})

test('web and recovery calls keep the same focus across the two-hour expiry while clocks and observations update', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(+now + 2_000) })
  const request = attentionFixture('private')
  request.story.state.lifeRhythm!.assessedAt = new Date(+now - LIFE_RHYTHM_STALE_MS).toISOString()
  const inputs: any[][] = []
  const host = {
    config: {}, modelRouting: { main: { available: true } }, browserConfig: { enabled: true, mode: 'allow-immediate', allowSearch: true },
    decide: async (...args: any[]) => {
      inputs.push(args)
      if (inputs.length === 1) return { browserIntents: [{ mode: 'search', query: '当地时间', purpose: '确认现场细节', timing: 'immediate' }] }
      if (inputs.length === 2) return { script: '她收回了手。' } // missing interaction, requires recovery
      return { script: '她收回了手。', interaction: { reply: { mode: 'none' } } }
    },
    collectWebObservation: async () => ({ summary: '真实网页返回' }),
    mainModelLabel: () => 'fake', modelResponseLogLimit: () => 0, reportOperation: () => {}, report: () => {},
  }
  const result = await (InterludeService.prototype as any).tryDecide.call(host,
    request.story, { id: 'u' }, 'user-message', from, now, request.userMessage, [])
  assert.equal(result.succeeded, true)
  assert.deepEqual(inputs.map(args => [+args[4], args.at(-1), args[12]]), [
    [+now, 'busy-work', false], [+now + 2_000, 'busy-work', false], [+now + 2_000, 'busy-work', true],
  ])
  assert.deepEqual(inputs[2][11], [{ summary: '真实网页返回' }])
})
