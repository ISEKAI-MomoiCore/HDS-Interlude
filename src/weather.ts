/**
 * 运行时天气服务：Open-Meteo 免费拉取 → 中文快照 → world-event 剧本条目注入。
 *
 * 设计原则（与提案 #IKL4DY 对齐,经审查调整后）:
 * - 注入格式为纯数据("环境:22°C 小毛毛雨。"),不含建议句/观测点地名,不引导叙事
 * - 复用 interlude_seeded_event + world-event 管道(非 admin-note),零新增剧本类型
 * - 滚动替换:每次注入前把上一条天气事件标 expired,时间线上只保留最新一条
 * - 地点解析:优先从 story.setting.location 自动地理编码,失败回退手动经纬度
 * - 架空世界跳过:由 Console 手动开关控制(非关键词自动判定)
 */
import type { Context } from 'koishi'

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
}

export const DEFAULT_WEATHER_CONFIG: WeatherConfig = {
  enabled: false, latitude: 39.14, longitude: 117.18,
  autoFromLocation: true, skipFantasyWorld: false, cadenceMinutes: 30,
}

export function resolveWeatherConfig(value: unknown): WeatherConfig {
  const record = !!value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const clamp = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
  }
  return {
    enabled: record.enabled === true,
    latitude: clamp(record.latitude, -90, 90, DEFAULT_WEATHER_CONFIG.latitude),
    longitude: clamp(record.longitude, -180, 180, DEFAULT_WEATHER_CONFIG.longitude),
    autoFromLocation: record.autoFromLocation !== false,
    skipFantasyWorld: record.skipFantasyWorld === true,
    cadenceMinutes: Math.floor(clamp(record.cadenceMinutes, 5, 180, DEFAULT_WEATHER_CONFIG.cadenceMinutes)),
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
  /** 注入文本:"环境:22°C 小毛毛雨。" */
  text: string
}

// ── 缓存(进程内) ──────────────────────────────────────────────────────────

interface CacheEntry { snapshot: WeatherSnapshot; cachedAt: number; city?: string }
const snapshotCache = new Map<string, CacheEntry>()
const geoCache = new Map<string, { lat: number; lon: number; name: string; cachedAt: number }>()

const GEO_CACHE_TTL = 24 * 3_600_000

// ── 地理编码 ─────────────────────────────────────────────────────────────────

async function geocode(ctx: Context, city: string): Promise<{ lat: number; lon: number; name: string } | undefined> {
  const key = city.trim().toLowerCase()
  if (!key) return undefined
  const cached = geoCache.get(key)
  if (cached && Date.now() - cached.cachedAt < GEO_CACHE_TTL) return cached
  try {
    const results = await ctx.http.get('https://geocoding-api.open-meteo.com/v1/search', {
      params: { name: city.trim(), count: 1, language: 'zh', format: 'json' },
      timeout: 8_000,
    }) as { results?: Array<{ latitude: number; longitude: number; name: string }> }
    const hit = results?.results?.[0]
    if (!hit || typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number') return undefined
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
  let cacheKey = `manual:${lat},${lon}`

  if (config.autoFromLocation && locationHint?.trim()) {
    const geo = await geocode(ctx, locationHint)
    if (geo) {
      lat = geo.lat; lon = geo.lon
      cacheKey = `auto:${geo.name}`
    }
    // 地理编码失败时回退到手动经纬度(下面用手动 key)
  }

  const cached = snapshotCache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < config.cadenceMinutes * 60_000) return cached.snapshot

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
    const condition = WMO_CODES[cur.weather_code as number] ?? `天气码${cur.weather_code}`
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

/** 获取最近一次成功快照(不触发拉取)——供播种器 payload 协同用 */
export function lastWeatherSnapshot(): WeatherSnapshot | undefined {
  let latest: WeatherSnapshot | undefined
  for (const entry of snapshotCache.values()) {
    if (!latest || entry.snapshot.fetchedAt > latest.fetchedAt) latest = entry.snapshot
  }
  return latest
}
