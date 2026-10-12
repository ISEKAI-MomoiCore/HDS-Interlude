export const DEFAULT_WEATHER_CONFIG = {
    enabled: false, latitude: 39.14, longitude: 117.18,
    autoFromLocation: true, skipFantasyWorld: false, cadenceMinutes: 30,
};
export function resolveWeatherConfig(value) {
    const record = !!value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const clamp = (v, min, max, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    };
    return {
        enabled: record.enabled === true,
        latitude: clamp(record.latitude, -90, 90, DEFAULT_WEATHER_CONFIG.latitude),
        longitude: clamp(record.longitude, -180, 180, DEFAULT_WEATHER_CONFIG.longitude),
        autoFromLocation: record.autoFromLocation !== false,
        skipFantasyWorld: record.skipFantasyWorld === true,
        cadenceMinutes: Math.floor(clamp(record.cadenceMinutes, 5, 180, DEFAULT_WEATHER_CONFIG.cadenceMinutes)),
    };
}
// ── WMO 天气码 → 中文 ───────────────────────────────────────────────────────
const WMO_CODES = {
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
};
const snapshotCache = new Map();
const geoCache = new Map();
const GEO_CACHE_TTL = 24 * 3_600_000;
// ── 地理编码 ─────────────────────────────────────────────────────────────────
async function geocode(ctx, city) {
    const key = city.trim().toLowerCase();
    if (!key)
        return undefined;
    const cached = geoCache.get(key);
    if (cached && Date.now() - cached.cachedAt < GEO_CACHE_TTL)
        return cached;
    try {
        const results = await ctx.http.get('https://geocoding-api.open-meteo.com/v1/search', {
            params: { name: city.trim(), count: 1, language: 'zh', format: 'json' },
            timeout: 8_000,
        });
        const hit = results?.results?.[0];
        if (!hit || typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number')
            return undefined;
        const geo = { lat: hit.latitude, lon: hit.longitude, name: hit.name || city, cachedAt: Date.now() };
        geoCache.set(key, geo);
        return geo;
    }
    catch {
        return undefined;
    }
}
// ── 拉取 ─────────────────────────────────────────────────────────────────
export async function fetchWeatherSnapshot(ctx, config, locationHint) {
    let lat = config.latitude;
    let lon = config.longitude;
    let cacheKey = `manual:${lat},${lon}`;
    if (config.autoFromLocation && locationHint?.trim()) {
        const geo = await geocode(ctx, locationHint);
        if (geo) {
            lat = geo.lat;
            lon = geo.lon;
            cacheKey = `auto:${geo.name}`;
        }
        // 地理编码失败时回退到手动经纬度(下面用手动 key)
    }
    const cached = snapshotCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < config.cadenceMinutes * 60_000)
        return cached.snapshot;
    try {
        const data = await ctx.http.get('https://api.open-meteo.com/v1/forecast', {
            params: {
                latitude: lat, longitude: lon,
                current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
                timezone: 'auto',
            },
            timeout: 10_000,
        });
        const cur = data?.current;
        if (!cur || typeof cur.temperature_2m !== 'number')
            return undefined;
        const condition = WMO_CODES[cur.weather_code] ?? `天气码${cur.weather_code}`;
        const snapshot = {
            temperature: Math.round(cur.temperature_2m),
            feelsLike: Math.round(cur.apparent_temperature ?? cur.temperature_2m),
            humidity: Math.round(cur.relative_humidity_2m ?? 0),
            windSpeed: Math.round(cur.wind_speed_10m ?? 0),
            condition,
            fetchedAt: Date.now(),
            text: `环境：${Math.round(cur.temperature_2m)}°C ${condition}。`,
        };
        snapshotCache.set(cacheKey, { snapshot, cachedAt: Date.now() });
        return snapshot;
    }
    catch {
        return undefined;
    }
}
/** 获取最近一次成功快照(不触发拉取)——供播种器 payload 协同用 */
export function lastWeatherSnapshot() {
    let latest;
    for (const entry of snapshotCache.values()) {
        if (!latest || entry.snapshot.fetchedAt > latest.fetchedAt)
            latest = entry.snapshot;
    }
    return latest;
}
