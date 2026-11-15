/* weather.ts 专项功能测试：配置归一化 / 架空判定 / 快照拉取与缓存 / 注入格式 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync } from 'node:crypto'
import {
  resolveWeatherConfig, DEFAULT_WEATHER_CONFIG,
  isFantasyStory, fetchWeatherSnapshot, lastWeatherSnapshot,
  type WeatherConfig,
} from '../src/weather'

// ── 配置归一化 ─────────────────────────────────────────────────────────────

test('resolveWeatherConfig 默认值与合法输入', () => {
  assert.deepEqual(resolveWeatherConfig(undefined), DEFAULT_WEATHER_CONFIG)
  assert.deepEqual(resolveWeatherConfig({}), DEFAULT_WEATHER_CONFIG)
  assert.deepEqual(resolveWeatherConfig(null), DEFAULT_WEATHER_CONFIG)
  const full = resolveWeatherConfig({ enabled: true, latitude: 31.2, longitude: 121.5, autoFromLocation: false, skipFantasyWorld: true, cadenceMinutes: 60 })
  assert.equal(full.enabled, true)
  assert.equal(full.latitude, 31.2)
  assert.equal(full.longitude, 121.5)
  assert.equal(full.autoFromLocation, false)
  assert.equal(full.skipFantasyWorld, true)
  assert.equal(full.cadenceMinutes, 60)
})

test('resolveWeatherConfig 越界值被 clamp', () => {
  assert.equal(resolveWeatherConfig({ latitude: 999 }).latitude, 90)
  assert.equal(resolveWeatherConfig({ latitude: -999 }).latitude, -90)
  assert.equal(resolveWeatherConfig({ longitude: 999 }).longitude, 180)
  assert.equal(resolveWeatherConfig({ cadenceMinutes: 1 }).cadenceMinutes, 5)
  assert.equal(resolveWeatherConfig({ cadenceMinutes: 10000 }).cadenceMinutes, 180)
  assert.equal(resolveWeatherConfig({ cadenceMinutes: 7.9 }).cadenceMinutes, 7)
})

test('resolveWeatherConfig 非法类型回退默认', () => {
  assert.equal(resolveWeatherConfig({ latitude: 'abc' }).latitude, DEFAULT_WEATHER_CONFIG.latitude)
  assert.equal(resolveWeatherConfig({ cadenceMinutes: NaN }).cadenceMinutes, DEFAULT_WEATHER_CONFIG.cadenceMinutes)
  assert.equal(resolveWeatherConfig({ enabled: 'yes' }).enabled, false)
  assert.equal(resolveWeatherConfig({ autoFromLocation: 0 }).autoFromLocation, true)
})

// ── 架空世界判定 ───────────────────────────────────────────────────────────

test('isFantasyStory 命中/未命中', () => {
  assert.equal(isFantasyStory('异世界', ''), true)
  assert.equal(isFantasyStory('', '精灵森林'), true)
  assert.equal(isFantasyStory('架空历史', ''), true)
  assert.equal(isFantasyStory('幻想大陆', ''), true)
  assert.equal(isFantasyStory('另一个世界', ''), true)
  assert.equal(isFantasyStory('现代都市', '上海'), false)
  assert.equal(isFantasyStory('', ''), false)
  assert.equal(isFantasyStory(undefined, null), false)
  // world+location 拼接判定
  assert.equal(isFantasyStory('一个', '精灵的世界'), true)
})

// ── 快照拉取(mock HTTP) ────────────────────────────────────────────────────

function mockCtx(current?: Record<string, number>, geo?: { latitude: number, longitude: number, name: string }) {
  return {
    http: {
      get: async (url: string, opts?: { params?: Record<string, unknown> }) => {
        if (url.includes('geocoding')) {
          if (!geo) return {}
          return { results: [geo] }
        }
        if (url.includes('forecast')) {
          if (!current) throw new Error('network error')
          return { current }
        }
        throw new Error(`unexpected url: ${url}`)
      },
    },
  } as never
}

const sunnyConfig: WeatherConfig = { enabled: true, latitude: 39.14, longitude: 117.18, autoFromLocation: false, skipFantasyWorld: false, cadenceMinutes: 30 }

test('fetchWeatherSnapshot 手动经纬度拉取(晴)', async () => {
  const ctx = mockCtx({ temperature_2m: 22.4, apparent_temperature: 21.8, relative_humidity_2m: 45, weather_code: 0, wind_speed_10m: 3.2 })
  const snap = await fetchWeatherSnapshot(ctx, sunnyConfig)
  assert.ok(snap)
  assert.equal(snap.temperature, 22)
  assert.equal(snap.feelsLike, 22)
  assert.equal(snap.condition, '晴')
  assert.equal(snap.text, '环境：22°C 晴。')
})

test('fetchWeatherSnapshot 各 WMO 码映射', async () => {
  const cases: Array<[number, string]> = [
    [0, '晴'], [2, '多云'], [3, '阴'], [45, '雾'],
    [51, '小毛毛雨'], [61, '小雨'], [65, '大雨'], [71, '小雪'],
    [80, '小阵雨'], [95, '雷阵雨'], [96, '雷阵雨伴冰雹'],
  ]
  for (const [code, expected] of cases) {
    const ctx = mockCtx({ temperature_2m: 15, weather_code: code })
    const snap = await fetchWeatherSnapshot(ctx, { ...sunnyConfig, cadenceMinutes: 0 }, `unique-${code}`)
    assert.equal(snap?.condition, expected, `WMO ${code} → ${expected}`)
  }
})

test('fetchWeatherSnapshot 未知天气码 → 天气码N', async () => {
  const ctx = mockCtx({ temperature_2m: 10, weather_code: 42 })
  const snap = await fetchWeatherSnapshot(ctx, { ...sunnyConfig, cadenceMinutes: 0 }, 'unknown-code')
  assert.equal(snap?.condition, '天气码42')
})

test('fetchWeatherSnapshot 网络失败返回 undefined(不抛错)', async () => {
  const ctx = mockCtx(undefined)
  const snap = await fetchWeatherSnapshot(ctx, { ...sunnyConfig, cadenceMinutes: 0 }, 'net-fail')
  assert.equal(snap, undefined)
})

test('fetchWeatherSnapshot 缺 current 字段返回 undefined', async () => {
  const ctx = { http: { get: async () => ({}) } } as never
  const snap = await fetchWeatherSnapshot(ctx, { ...sunnyConfig, cadenceMinutes: 0 }, 'no-current')
  assert.equal(snap, undefined)
})

test('fetchWeatherSnapshot 自动地理编码成功', async () => {
  const config: WeatherConfig = { ...sunnyConfig, autoFromLocation: true }
  const ctx = mockCtx({ temperature_2m: 18, weather_code: 2 }, { latitude: 31.23, longitude: 121.47, name: '上海' })
  const snap = await fetchWeatherSnapshot(ctx, config, '上海')
  assert.ok(snap)
  assert.equal(snap.temperature, 18)
  assert.equal(snap.condition, '多云')
})

test('fetchWeatherSnapshot 地理编码失败回退手动经纬度', async () => {
  const config: WeatherConfig = { ...sunnyConfig, autoFromLocation: true, latitude: 40.0, longitude: 116.0 }
  const ctx = mockCtx({ temperature_2m: 5, weather_code: 71 })
  const snap = await fetchWeatherSnapshot(ctx, config, '不存在的城市xyz')
  assert.ok(snap)
  assert.equal(snap.condition, '小雪')
})

test('fetchWeatherSnapshot 地理编码缓存(第二次不请求 geocoding)', async () => {
  let geoCalls = 0
  const ctx = {
    http: {
      get: async (url: string) => {
        if (url.includes('geocoding')) { geoCalls++; return { results: [{ latitude: 1, longitude: 2, name: '测试' }] } }
        return { current: { temperature_2m: 20, weather_code: 0 } }
      },
    },
  } as never
  const config: WeatherConfig = { ...sunnyConfig, autoFromLocation: true, cadenceMinutes: 0 }
  await fetchWeatherSnapshot(ctx, config, '缓存测试地')
  await fetchWeatherSnapshot(ctx, config, '缓存测试地')
  assert.equal(geoCalls, 1, '第二次应命中地理编码缓存')
})

test('fetchWeatherSnapshot 快照缓存(cadence 内不重新拉取)', async () => {
  let fetchCalls = 0
  const ctx = {
    http: {
      get: async (url: string) => {
        if (url.includes('forecast')) fetchCalls++
        if (url.includes('geocoding')) return {}
        return { current: { temperature_2m: 25, weather_code: 1 } }
      },
    },
  } as never
  const config: WeatherConfig = { ...sunnyConfig, latitude: -33.87, longitude: 151.21, cadenceMinutes: 30 }
  const first = await fetchWeatherSnapshot(ctx, config, '快照缓存测试')
  const second = await fetchWeatherSnapshot(ctx, config, '快照缓存测试')
  assert.equal(fetchCalls, 1, 'cadence 内只拉取一次')
  assert.equal(first?.temperature, second?.temperature)
})

test('lastWeatherSnapshot 返回最近拉取的快照', async () => {
  const ctx = mockCtx({ temperature_2m: 33, weather_code: 0 })
  await fetchWeatherSnapshot(ctx, { ...sunnyConfig, cadenceMinutes: 0 }, 'latest-test')
  const latest = lastWeatherSnapshot()
  assert.ok(latest)
  assert.ok(latest.fetchedAt > 0)
})

test('注入文本格式:环境:N°C 天气。', async () => {
  const ctx = mockCtx({ temperature_2m: -3.7, apparent_temperature: -8.2, relative_humidity_2m: 80, weather_code: 73, wind_speed_10m: 12 })
  const snap = await fetchWeatherSnapshot(ctx, { ...sunnyConfig, cadenceMinutes: 0 }, 'format-test')
  assert.equal(snap?.text, '环境：-4°C 中雪。')
  assert.equal(snap?.feelsLike, -8)
  assert.equal(snap?.humidity, 80)
  assert.equal(snap?.windSpeed, 12)
})

// ── QWeather(和风天气)数据源 ────────────────────────────────────────────────

const qweatherKeyPair = generateKeyPairSync('ed25519')
const qweatherPrivateKey = qweatherKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

const qweatherConfig: WeatherConfig = {
  ...sunnyConfig,
  provider: 'qweather',
  qweatherHost: 'test.re.qweatherapi.com',
  qweatherAuth: 'ed25519',
  qweatherKid: 'test-kid',
  qweatherSub: 'test-sub',
  qweatherIss: 'test-iss',
  qweatherJwtTtlMinutes: 60,
  qweatherPrivateKey,
}

function qweatherMock(now: Record<string, unknown> | undefined, geo?: { lat: string; lon: string; name: string; id: string } | null) {
  const seen: Array<{ url: string; headers?: Record<string, string>; params?: Record<string, unknown> }> = []
  const ctx = {
    logger: () => ({ warn() {} }),
    http: {
      get: async (url: string, opts?: { params?: Record<string, unknown>; headers?: Record<string, string> }) => {
        seen.push({ url, headers: opts?.headers, params: opts?.params })
        if (url.includes('/geo/v2/city/lookup')) {
          if (geo === null) throw new Error('geo network error')
          if (!geo) return { code: '404' }
          return { code: '200', location: [geo] }
        }
        if (url.includes('/v7/weather/now')) {
          if (!now) throw new Error('weather network error')
          return { code: '200', now }
        }
        throw new Error(`unexpected url: ${url}`)
      },
    },
  } as never
  return { ctx, seen }
}

test('resolveWeatherConfig provider 与 qweather 字段归一化', () => {
  assert.equal(resolveWeatherConfig({}).provider, 'open-meteo')
  assert.equal(resolveWeatherConfig({ provider: 'qweather' }).provider, 'qweather')
  assert.equal(resolveWeatherConfig({ provider: 'bogus' }).provider, 'open-meteo')
  assert.equal(resolveWeatherConfig({ qweatherAuth: 'weird' }).qweatherAuth, 'ed25519')
  assert.equal(resolveWeatherConfig({ qweatherPrivateKey: 'a\rb\n' }).qweatherPrivateKey, 'ab')
  assert.equal(resolveWeatherConfig({ qweatherHost: 'a.re.qweatherapi.com/' }).qweatherHost, 'a.re.qweatherapi.com')
  assert.equal(resolveWeatherConfig({ qweatherJwtTtlMinutes: 99999 }).qweatherJwtTtlMinutes, 1440)
})

test('fetchWeatherSnapshot qweather:JWT 头 + LocationID 优先 + 快照映射', async () => {
  const { ctx, seen } = qweatherMock(
    { temp: '5', feelsLike: '3', humidity: '92', text: '阵雨', windSpeed: '8' },
    { lat: '43.05', lon: '141.34', name: '札幌', id: 'CC5DF' },
  )
  const snap = await fetchWeatherSnapshot(ctx, { ...qweatherConfig, cadenceMinutes: 0, autoFromLocation: true, latitude: 43.05, longitude: 141.34 }, '札幌')
  assert.ok(snap)
  assert.equal(snap.temperature, 5)
  assert.equal(snap.feelsLike, 3)
  assert.equal(snap.humidity, 92)
  assert.equal(snap.windSpeed, 8)
  assert.equal(snap.condition, '阵雨')
  assert.equal(snap.text, '环境：5°C 阵雨。')
  const weatherReq = seen.find(r => r.url.includes('/v7/weather/now'))
  assert.ok(weatherReq)
  assert.equal(weatherReq.params?.location, 'CC5DF', '命中 LocationID 时应优先于经纬度')
  assert.ok(String(weatherReq.headers?.Authorization).startsWith('Bearer '), 'ed25519 应签发 JWT')
})

test('fetchWeatherSnapshot qweather:apikey 头', async () => {
  const { ctx, seen } = qweatherMock({ temp: '9', text: '霾' })
  const config: WeatherConfig = { ...qweatherConfig, qweatherAuth: 'apikey', qweatherApiKey: 'key-1' }
  const snap = await fetchWeatherSnapshot(ctx, { ...config, cadenceMinutes: 0, autoFromLocation: false, latitude: 10.1, longitude: 20.2 })
  assert.ok(snap)
  const weatherReq = seen.find(r => r.url.includes('/v7/weather/now'))
  assert.equal(weatherReq?.headers?.['X-QW-Api-Key'], 'key-1')
})

test('fetchWeatherSnapshot qweather:地理编码失败回退手动经纬度', async () => {
  const { ctx, seen } = qweatherMock({ temp: '4', text: '多云' }, null)
  const snap = await fetchWeatherSnapshot(ctx, { ...qweatherConfig, cadenceMinutes: 0, autoFromLocation: true, latitude: 30.1, longitude: 40.2 }, '不存在的城市xyz')
  assert.ok(snap)
  const weatherReq = seen.find(r => r.url.includes('/v7/weather/now'))
  assert.equal(weatherReq?.params?.location, '40.20,30.10', '回退到 lon,lat 手动观测点')
})

test('fetchWeatherSnapshot qweather:业务错误码返回 undefined 且不抛错', async () => {
  const ctx = {
    logger: () => ({ warn() {} }),
    http: {
      get: async (url: string) => {
        if (url.includes('/v7/weather/now')) return { code: '402' }
        throw new Error(`unexpected url: ${url}`)
      },
    },
  } as never
  const snap = await fetchWeatherSnapshot(ctx, { ...qweatherConfig, cadenceMinutes: 0, autoFromLocation: false, latitude: 50.5, longitude: 60.6 })
  assert.equal(snap, undefined)
})

test('fetchWeatherSnapshot qweather:不可解析城市负缓存(第二次不请求 geo)', async () => {
  let geoCalls = 0
  const ctx = {
    logger: () => ({ warn() {} }),
    http: {
      get: async (url: string) => {
        if (url.includes('/geo/v2/city/lookup')) { geoCalls++; return { code: '200', location: [] } }
        if (url.includes('/v7/weather/now')) return { code: '200', now: { temp: '6', text: '晴' } }
        throw new Error(`unexpected url: ${url}`)
      },
    },
  } as never
  const config: WeatherConfig = { ...qweatherConfig, cadenceMinutes: 0, autoFromLocation: true, latitude: 70.7, longitude: 80.8 }
  await fetchWeatherSnapshot(ctx, config, '负缓存测试地')
  await fetchWeatherSnapshot(ctx, config, '负缓存测试地')
  assert.equal(geoCalls, 1, '第二次应命中负结果缓存')
})

test('fetchWeatherSnapshot qweather:快照缓存按数据源分键', async () => {
  let weatherCalls = 0
  const ctx = {
    logger: () => ({ warn() {} }),
    http: {
      get: async (url: string) => {
        if (url.includes('/v7/weather/now')) { weatherCalls++; return { code: '200', now: { temp: String(weatherCalls), text: '晴' } } }
        if (url.includes('/geo/v2/city/lookup')) return { code: '404' }
        throw new Error(`unexpected url: ${url}`)
      },
    },
  } as never
  const location = { ...qweatherConfig, autoFromLocation: false, cadenceMinutes: 30, latitude: -33.87, longitude: 151.21 }
  const first = await fetchWeatherSnapshot(ctx, location)
  const second = await fetchWeatherSnapshot(ctx, location)
  assert.equal(weatherCalls, 1, 'cadence 内只拉取一次')
  assert.equal(first?.temperature, second?.temperature)
})
