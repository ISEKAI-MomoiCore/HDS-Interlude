/**
 * 运行时天气服务：Open-Meteo 免费拉取 → 中文快照 → world-event 剧本条目注入。
 *
 * 设计原则（与提案 #IKL4DY 对齐,经审查调整后）:
 * - 注入格式为纯数据("环境：22°C 小毛毛雨。"),不含建议句/观测点地名,不引导叙事
 * - 复用 interlude_seeded_event + world-event 管道(非 admin-note),零新增剧本类型
 * - 滚动替换:每次注入前把上一条天气事件标 expired,时间线上只保留最新一条
 * - 地点解析:优先从 story.setting.location 自动地理编码,失败回退手动经纬度
 * - 架空世界跳过:手动开关 AND 世界描述含架空关键词(异世界/精灵/架空/幻想/另一个世界)
 *
 * 数据源：open-meteo(默认,免费无 Key)或 qweather(和风天气,国内可直连,
 * 支持 API Key 或 Ed25519 JWT 自动签发)。两源共用同一缓存与注入管道,
 * 仅拉取与地理编码步骤不同;和风的 LocationID 命中时优先于经纬度。
 */
import { createHash, createPrivateKey, sign } from 'node:crypto'
import type { Context } from 'koishi'

export type WeatherProvider = 'open-meteo' | 'qweather'

export interface WeatherConfig {
  enabled: boolean
  /** 手动观测点(经纬度);autoFromLocation 开启时仅作回退 */
  latitude: number
  longitude: number
  /** 从 story.setting.location 自动解析观测点(地理编码),失败回退经纬度 */
  autoFromLocation: boolean
  /** 手动开关:架空世界(异世界/精灵/架空)跳过天气注入 */
  skipFantasyWorld: boolean
  cadenceMinutes: number
  /** 数据源;缺省视为 open-meteo(向后兼容旧配置与直接构造的调用方) */
  provider?: WeatherProvider
  /** 和风天气专属 API Host(控制台项目设置提供,如 xxx.re.qweatherapi.com) */
  qweatherHost?: string
  /** 认证方式:ed25519=自动签发 JWT;apikey=固定 API Key */
  qweatherAuth?: 'ed25519' | 'apikey'
  qweatherApiKey?: string
  qweatherKid?: string
  qweatherSub?: string
  qweatherIss?: string
  qweatherJwtTtlMinutes?: number
  /** Ed25519 私钥(PEM);resolveWeatherConfig 会统一剥掉 \r */
  qweatherPrivateKey?: string
}

export const DEFAULT_WEATHER_CONFIG: WeatherConfig = {
  enabled: false, latitude: 39.14, longitude: 117.18,
  autoFromLocation: true, skipFantasyWorld: false, cadenceMinutes: 30,
  provider: 'open-meteo', qweatherHost: '', qweatherAuth: 'ed25519',
  qweatherApiKey: '', qweatherKid: '', qweatherSub: '', qweatherIss: '',
  qweatherJwtTtlMinutes: 60, qweatherPrivateKey: '',
}

export function resolveWeatherConfig(value: unknown): WeatherConfig {
  const record = !!value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const clamp = (v: unknown, min: number, max: number, fallback: number) => {
    // typeof 前置守卫：Number(null)/Number('')===0 会把 Console 表单残留
    // 静默变成合法的 0°(几内亚湾)而非走 fallback。
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
    return Math.max(min, Math.min(max, v))
  }
  const text = (v: unknown) => String(v ?? '').trim()
  return {
    enabled: record.enabled === true,
    latitude: clamp(record.latitude, -90, 90, DEFAULT_WEATHER_CONFIG.latitude),
    longitude: clamp(record.longitude, -180, 180, DEFAULT_WEATHER_CONFIG.longitude),
    autoFromLocation: record.autoFromLocation !== false,
    skipFantasyWorld: record.skipFantasyWorld === true,
    cadenceMinutes: Math.floor(clamp(record.cadenceMinutes, 5, 180, DEFAULT_WEATHER_CONFIG.cadenceMinutes)),
    provider: record.provider === 'qweather' ? 'qweather' : 'open-meteo',
    qweatherHost: text(record.qweatherHost).replace(/\/+$/, ''),
    qweatherAuth: record.qweatherAuth === 'apikey' ? 'apikey' : 'ed25519',
    qweatherApiKey: text(record.qweatherApiKey),
    qweatherKid: text(record.qweatherKid),
    qweatherSub: text(record.qweatherSub),
    qweatherIss: text(record.qweatherIss),
    qweatherJwtTtlMinutes: Math.floor(clamp(record.qweatherJwtTtlMinutes, 5, 1440, 60)),
    // PEM 换行被 yml/表单改写成 \r 时 createPrivateKey 会拒签,统一剥掉
    qweatherPrivateKey: String(record.qweatherPrivateKey ?? '').replace(/\r/g, '').trim(),
  }
}

// ── WMO 天气码 → 中文 ───────────────────────────────────────────────────────

const WMO_CODES: Record<number, string> = {
  0: '晴', 1: '基本晴', 2: '多云', 3: '阴',
  45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
  56: '小冻毛毛雨', 57: '大冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '小冻雨', 67: '大冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '小阵雨', 81: '阵雨', 82: '强阵雨',
  85: '小阵雪', 86: '大阵雪',
  95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷阵雨伴冰雹',
}

// ── 快照 ─────────────────────────────────────────────────────────────────────

export interface WeatherSnapshot {
  temperature: number
  feelsLike: number
  humidity: number
  windSpeed: number
  condition: string
  fetchedAt: number
  /** 注入文本:"环境：22°C 小毛毛雨。" */
  text: string
}

// ── 缓存(进程内) ──────────────────────────────────────────────────────────

interface CacheEntry { snapshot: WeatherSnapshot; cachedAt: number; city?: string }
const snapshotCache = new Map<string, CacheEntry>()
const geoCache = new Map<string, { lat: number; lon: number; name: string; cachedAt: number }>()

const GEO_CACHE_TTL = 24 * 3_600_000

// ── 和风天气(QWeather)辅助 ──────────────────────────────────────────────────

const QWEATHER_JWT_MIN_TTL_SECONDS = 300
const QWEATHER_JWT_MAX_TTL_SECONDS = 24 * 3_600
const qweatherJwtCache = new Map<string, { token: string; expiresAtMs: number }>()
const qweatherGeoCache = new Map<string, { lat: number; lon: number; name: string; id: string; cachedAt: number }>()

function qweatherErrorMessage(data: unknown): string {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const detail = (record.error as Record<string, unknown> | undefined)?.detail
  if (typeof detail === 'string' && detail) return `和风天气接口错误: ${detail}`
  const code = record.code != null ? String(record.code) : '无响应码'
  const reference = typeof record.reference === 'string' && record.reference ? ` (reference: ${record.reference})` : ''
  return `和风天气接口返回错误 code=${code}${reference}`
}

function signQWeatherJwt(config: WeatherConfig): { token: string; expiresAtMs: number } {
  if (!config.qweatherHost?.trim() || !config.qweatherKid?.trim() || !config.qweatherSub?.trim() || !config.qweatherPrivateKey?.trim()) {
    throw new Error('和风 Ed25519 自动签发需要同时提供 API Host、kid、sub 与 PEM 私钥')
  }
  const nowSeconds = Math.floor(Date.now() / 1_000)
  const ttlSeconds = Math.min(Math.max((config.qweatherJwtTtlMinutes ?? 60) * 60, QWEATHER_JWT_MIN_TTL_SECONDS), QWEATHER_JWT_MAX_TTL_SECONDS)
  const header = { alg: 'EdDSA', kid: config.qweatherKid }
  const payload: Record<string, unknown> = { sub: config.qweatherSub, iat: nowSeconds, exp: nowSeconds + ttlSeconds }
  if (config.qweatherIss?.trim()) payload.iss = config.qweatherIss
  const signingInput = Buffer.from(JSON.stringify(header)).toString('base64url')
    + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = sign(null, Buffer.from(signingInput), createPrivateKey(config.qweatherPrivateKey))
  return { token: signingInput + '.' + signature.toString('base64url'), expiresAtMs: Date.now() + (ttlSeconds - 60) * 1_000 }
}

function getQWeatherJwt(config: WeatherConfig): string {
  const fingerprint = `${config.qweatherKid}:${config.qweatherSub}:${config.qweatherIss}:${config.qweatherJwtTtlMinutes}`
    + `:${createHash('sha256').update(config.qweatherPrivateKey ?? '').digest('hex').slice(0, 16)}`
  const cached = qweatherJwtCache.get(fingerprint)
  if (cached && Date.now() < cached.expiresAtMs) return cached.token
  const signed = signQWeatherJwt(config)
  qweatherJwtCache.clear()
  qweatherJwtCache.set(fingerprint, signed)
  return signed.token
}

function qweatherHeaders(config: WeatherConfig): Record<string, string> {
  if (config.qweatherAuth === 'ed25519') {
    return { Authorization: 'Bearer ' + getQWeatherJwt(config) }
  }
  if (!config.qweatherApiKey?.trim()) throw new Error('和风天气 API Key 未配置')
  return { 'X-QW-Api-Key': config.qweatherApiKey }
}

async function qweatherLookupCity(ctx: Context, config: WeatherConfig, city: string): Promise<{ lat: number; lon: number; name: string; id: string } | undefined> {
  if (!city?.trim()) return undefined
  const key = city.trim().toLowerCase()
  const cached = qweatherGeoCache.get(key)
  if (cached && Date.now() - cached.cachedAt < GEO_CACHE_TTL) {
    return cached.id ? cached : undefined  // 空 id=负结果哨兵
  }
  try {
    const data = await ctx.http.get(`https://${config.qweatherHost}/geo/v2/city/lookup`, {
      params: { location: city.trim(), number: 1, lang: 'zh' },
      headers: qweatherHeaders(config),
      timeout: 8_000,
    }) as { code?: string | number; location?: Array<{ lat?: string; lon?: string; name?: string; id?: string }> }
    if (String(data?.code) !== '200') throw new Error(qweatherErrorMessage(data))
    const hit = data.location?.[0]
    const lat = Number(hit?.lat)
    const lon = Number(hit?.lon)
    if (!hit || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      // 负结果短缓存:不可解析地点每轮 sweep 都打一次 8s 超时外呼。
      qweatherGeoCache.set(key, { lat: 0, lon: 0, name: '', id: '', cachedAt: Date.now() - GEO_CACHE_TTL + 10 * 60_000 })
      return undefined
    }
    const geo = { lat, lon, name: hit.name || city, id: hit.id || '', cachedAt: Date.now() }
    qweatherGeoCache.set(key, geo)
    return geo
  } catch (error) {
    ctx.logger('hds-interlude').warn('和风城市查询失败:%s', error instanceof Error ? error.message : String(error))
    return undefined
  }
}

async function fetchQWeatherSnapshot(ctx: Context, config: WeatherConfig, lat: number, lon: number, locationId?: string): Promise<WeatherSnapshot | undefined> {
  const location = locationId || `${lon.toFixed(2)},${lat.toFixed(2)}`
  const data = await ctx.http.get(`https://${config.qweatherHost}/v7/weather/now`, {
    params: { location, lang: 'zh' },
    headers: qweatherHeaders(config),
    timeout: 10_000,
  }) as { code?: string | number; now?: Record<string, unknown> }
  if (String(data?.code) !== '200') throw new Error(qweatherErrorMessage(data))
  const current = data.now ?? {}
  const temperature = Number(current.temp)
  if (!Number.isFinite(temperature)) return undefined
  const condition = String(current.text || '').trim() || '未知天气'
  const feelsLike = Number(current.feelsLike)
  return {
    temperature: Math.round(temperature),
    feelsLike: Math.round(Number.isFinite(feelsLike) ? feelsLike : temperature),
    humidity: Math.round(Number(current.humidity) || 0),
    windSpeed: Math.round(Number(current.windSpeed) || 0),
    condition,
    fetchedAt: Date.now(),
    text: `环境：${Math.round(temperature)}°C ${condition}。`,
  }
}

// ── 地理编码(Open-Meteo) ─────────────────────────────────────────────────────

async function geocode(ctx: Context, city: string): Promise<{ lat: number; lon: number; name: string } | undefined> {
  const key = city.trim().toLowerCase()
  if (!key) return undefined
  const cached = geoCache.get(key)
  if (cached && Date.now() - cached.cachedAt < GEO_CACHE_TTL) {
    return cached.name ? cached : undefined  // 空名=负结果哨兵
  }
  try {
    const results = await ctx.http.get('https://geocoding-api.open-meteo.com/v1/search', {
      params: { name: city.trim(), count: 1, language: 'zh', format: 'json' },
      timeout: 8_000,
    }) as { results?: Array<{ latitude: number; longitude: number; name: string }> }
    const hit = results?.results?.[0]
    if (!hit || typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number') {
      // 负结果短缓存:不可解析地点每轮 sweep 都打一次 8s 超时外呼。
      geoCache.set(key, { lat: 0, lon: 0, name: '', cachedAt: Date.now() - GEO_CACHE_TTL + 10 * 60_000 })
      return undefined
    }
    const geo = { lat: hit.latitude, lon: hit.longitude, name: hit.name || city, cachedAt: Date.now() }
    geoCache.set(key, geo)
    return geo
  } catch { return undefined }
}

// ── 拉取 ─────────────────────────────────────────────────────────────────

export async function fetchWeatherSnapshot(
  ctx: Context,
  config: WeatherConfig,
  locationHint?: string,
): Promise<WeatherSnapshot | undefined> {
  let lat = config.latitude
  let lon = config.longitude
  let cacheKey = `${config.provider ?? 'open-meteo'}:manual:${lat},${lon}`
  let locationId: string | undefined

  if (config.autoFromLocation && locationHint?.trim()) {
    const geo = config.provider === 'qweather'
      ? await qweatherLookupCity(ctx, config, locationHint)
      : await geocode(ctx, locationHint)
    if (geo) {
      lat = geo.lat; lon = geo.lon
      cacheKey = `${config.provider ?? 'open-meteo'}:auto:${geo.name}`
      locationId = (geo as { id?: string }).id
    }
    // 地理编码失败时回退到手动经纬度(下面用手动 key)
  }

  const cached = snapshotCache.get(cacheKey)
  // TTL 取 cadence 的 90%：TTL==sweep 周期时,首次拉取耗时使下一轮 sweep
  // 必定命中缓存(年龄 C-f < C),实际刷新率减半。留 10% 余量保证每轮都拉新。
  const ttl = config.cadenceMinutes * 60_000 * 0.9
  if (cached && Date.now() - cached.cachedAt < ttl) return cached.snapshot

  if (config.provider === 'qweather') {
    try {
      const snapshot = await fetchQWeatherSnapshot(ctx, config, lat, lon, locationId)
      if (snapshot) snapshotCache.set(cacheKey, { snapshot, cachedAt: Date.now() })
      return snapshot
    } catch (error) {
      ctx.logger('hds-interlude').warn('和风天气拉取失败:%s', error instanceof Error ? error.message : String(error))
      return undefined
    }
  }

  try {
    const data = await ctx.http.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: lat, longitude: lon,
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
        timezone: 'auto',
      },
      timeout: 10_000,
    }) as { current?: Record<string, number> }
    const cur = data?.current
    if (!cur || typeof cur.temperature_2m !== 'number') return undefined
    const weatherCode = typeof cur.weather_code === 'number' ? cur.weather_code : undefined
    const condition = weatherCode !== undefined ? WMO_CODES[weatherCode] ?? `天气码${weatherCode}` : '未知天气'
    const snapshot: WeatherSnapshot = {
      temperature: Math.round(cur.temperature_2m),
      feelsLike: Math.round(cur.apparent_temperature ?? cur.temperature_2m),
      humidity: Math.round(cur.relative_humidity_2m ?? 0),
      windSpeed: Math.round(cur.wind_speed_10m ?? 0),
      condition,
      fetchedAt: Date.now(),
      text: `环境：${Math.round(cur.temperature_2m)}°C ${condition}。`,
    }
    snapshotCache.set(cacheKey, { snapshot, cachedAt: Date.now() })
    return snapshot
  } catch { return undefined }
}

/** 架空世界判定(手动开关语义下与 weatherSweep 共用的唯一权威拷贝)：
 * 命中即跳过实况天气注入;播种器据此反过来保留天气播种(那些世界里模型
 * 即兴是唯一的天气来源)。 */
export function isFantasyStory(world: unknown, location: unknown): boolean {
  const text = String(world ?? '') + String(location ?? '')
  return /异世界|精灵|架空|幻想|另一个世界/.test(text)
}

/** 获取最近一次成功快照(不触发拉取)——供播种器 payload 协同用 */
export function lastWeatherSnapshot(): WeatherSnapshot | undefined {
  let latest: WeatherSnapshot | undefined
  for (const entry of snapshotCache.values()) {
    if (!latest || entry.snapshot.fetchedAt > latest.fetchedAt) latest = entry.snapshot
  }
  return latest
}
