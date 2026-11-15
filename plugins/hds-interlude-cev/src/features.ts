/**
 * 路线图 #2 用户侧人格档案演化 + #3 环境实感注入（天气）
 * 轻量实现：复用 ParticipantState（profileOverlay）与独立 weather 字段。
 */
import { Context } from 'koishi'
import { storyLocalTimeContext } from './time'

// ═══════════════════════════════════════════════════════════════════════════
// #2 userProfilePatch：压缩时主模型输出对用户的理解深化
//   与 statePatch 完全同构——走 CompactionDecision 的可选字段，
//   写入 participant.state.profileOverlay（不是 participant.profile，
//   后者是 Console 手动编辑的 canon）。
// ═══════════════════════════════════════════════════════════════════════════

export interface UserProfilePatchDraft {
  /** 目标参与者 personId；压缩时只知道一个上下文窗口内的主要用户。 */
  personId: string
  /** 累进式的理解深化（≤500 字），追加而非替换。 */
  understanding: string
  evidence: string
  confidence: number
}

/** 压缩提示词追加指令（拼在 compactionPrompt 尾部）。 */
export const USER_PROFILE_PATCH_INSTRUCTION = `userProfiles (optional): when the supplied entries reveal a durable shift in how the protagonist understands a user (their mood pattern, life situation, values, or communication habits), include userProfiles: [{"personId":"the participant personId","understanding":"one concise sentence in Chinese, at most 120 characters, describing the new understanding","evidence":"brief factual basis from the entries","confidence":0.0}]. Only when something genuinely new and lasting emerges; omit entirely for routine exchanges.`

/** 应用 patch：追加到 participant.state.profileOverlay（非替换）。 */
export function applyUserProfilePatch(currentOverlay: string | undefined, patch: UserProfilePatchDraft): string {
  const stamp = new Date().toISOString().slice(0, 10)
  const line = `[${stamp}] ${patch.understanding}`
  if (!currentOverlay?.trim()) return line
  // 去重：同一天同一句不重复追加
  if (currentOverlay.includes(patch.understanding)) return currentOverlay
  const lines = currentOverlay.split('\n')
  // 滚动窗口：保留最近 20 条理解（≤500 字符/条 × 20 = 10K 上限够用）
  const kept = lines.slice(-19)
  return [...kept, line].join('\n')
}

// ═══════════════════════════════════════════════════════════════════════════
// #3 环境实感注入：Console 配置城市名，拉取 open-meteo 实时天气
//   独立 weather 字段注入 payload——不混入 webContext，主角不去刻意关注。
// ═══════════════════════════════════════════════════════════════════════════

export interface WeatherSnapshot {
  /** 城市显示名（Console 配置的原文） */
  city: string
  /** 天气描述（中文，如"多云"） */
  condition: string
  /** 温度 °C */
  temperature: number
  /** 体感温度 °C */
  feelsLike: number
  /** 湿度 % */
  humidity: number
  /** 风速 km/h */
  windSpeed: number
  /** 本地日期时间（故事时区） */
  localTime: string
}

/** open-meteo WMO code → 中文描述 */
const WMO_CODES: Record<number, string> = {
  0: '晴', 1: '基本晴', 2: '多云', 3: '阴',
  45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '浓毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '小阵雨', 81: '阵雨', 82: '强阵雨',
  85: '小阵雪', 86: '阵雪',
  95: '雷暴', 96: '雷暴伴冰雹', 99: '强雷暴伴冰雹',
}

/** 城市名 → open-meteo 坐标（geocoding API），缓存 24h。 */
const geoCache = new Map<string, { lat: number, lon: number, name: string, cachedAt: number }>()

async function geocode(ctx: Context, city: string): Promise<{ lat: number, lon: number, name: string } | undefined> {
  const cached = geoCache.get(city)
  if (cached && Date.now() - cached.cachedAt < 24 * 3600_000) return cached
  try {
    const results = await ctx.http.get('https://geocoding-api.open-meteo.com/v1/search', {
      params: { name: city, count: 1, language: 'zh', format: 'json' },
      timeout: 10_000,
    })
    const hit = (results as any)?.results?.[0]
    if (!hit || typeof hit.latitude !== 'number') return undefined
    const entry = { lat: hit.latitude, lon: hit.longitude, name: hit.name ?? city, cachedAt: Date.now() }
    geoCache.set(city, entry)
    return entry
  } catch { return undefined }
}

/** 天气缓存：30 分钟（open-meteo 免费额度 10K/天，30 分钟刷新已足够）。 */
const weatherCache = new Map<string, { snapshot: WeatherSnapshot, cachedAt: number }>()

export async function fetchWeather(ctx: Context, city: string, timezone: string): Promise<WeatherSnapshot | undefined> {
  if (!city.trim()) return undefined
  const cacheKey = `${city}:${timezone}`
  const cached = weatherCache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < 30 * 60_000) return cached.snapshot

  const geo = await geocode(ctx, city)
  if (!geo) return undefined

  try {
    const data = await ctx.http.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: geo.lat, longitude: geo.lon,
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
        timezone: 'auto',
      },
      timeout: 10_000,
    }) as any
    const cur = data?.current
    if (!cur || typeof cur.temperature_2m !== 'number') return undefined
    const snapshot: WeatherSnapshot = {
      city: geo.name || city,
      condition: WMO_CODES[cur.weather_code as number] ?? `气象代码${cur.weather_code}`,
      temperature: Math.round(cur.temperature_2m),
      feelsLike: Math.round(cur.apparent_temperature),
      humidity: Math.round(cur.relative_humidity_2m),
      windSpeed: Math.round(cur.wind_speed_10m),
      localTime: storyLocalTimeContext(new Date(), timezone).local,
    }
    weatherCache.set(cacheKey, { snapshot, cachedAt: Date.now() })
    return snapshot
  } catch { return undefined }
}

/** 注入 payload 的 weather 字段（纯数据，不 teach 模型——让主角自然感知）。 */
export function weatherPromptField(snapshot: WeatherSnapshot): Record<string, unknown> {
  return {
    city: snapshot.city,
    condition: snapshot.condition,
    temperatureC: snapshot.temperature,
    feelsLikeC: snapshot.feelsLike,
    humidityPercent: snapshot.humidity,
    windKmh: snapshot.windSpeed,
    localTime: snapshot.localTime,
    _note: 'ambient environment; the protagonist perceives it naturally without narrating the weather report',
  }
}
