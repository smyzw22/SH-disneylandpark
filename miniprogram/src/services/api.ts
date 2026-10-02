import Taro from '@tarojs/taro'
import type { CrowdDay, DayPlan, HistoryPoint, RealtimeData } from './types'

/** 线上构建需配置已加入微信 request 合法域名的 HTTPS 地址。 */
export const API_BASE =
  typeof process !== 'undefined' && process.env?.TARO_APP_API_BASE
    ? process.env.TARO_APP_API_BASE
    : 'http://127.0.0.1:3000'

interface ApiEnvelope {
  ok: boolean
  cached?: boolean
  error?: string
}

async function request<T>(path: string): Promise<T | null> {
  try {
    const res = await Taro.request<ApiEnvelope & T>({
      url: `${API_BASE}${path}`,
      method: 'GET',
      timeout: 8000,
    })
    if (res.statusCode < 200 || res.statusCode >= 300 || !res.data?.ok) return null
    return res.data as T
  } catch {
    return null
  }
}

export async function tryFetchRealtimeFromApi(): Promise<RealtimeData | null> {
  const data = await request<RealtimeData & ApiEnvelope>('/api/realtime')
  return data ? { ...data, cached: Boolean(data.cached) } : null
}

export async function tryFetchPredictFromApi(start: string, end: string): Promise<CrowdDay[] | null> {
  const data = await request<
    ApiEnvelope & { predictions?: CrowdDay[]; rows?: CrowdDay[]; date_rankings?: CrowdDay[] }
  >(
    `/api/predict?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  )
  return data?.predictions || data?.rows || data?.date_rankings || null
}

export async function tryFetchSuggestFromApi(date: string): Promise<DayPlan | null> {
  const data = await request<ApiEnvelope & { plan?: DayPlan }>(
    `/api/suggest?date=${encodeURIComponent(date)}`
  )
  return data?.plan || null
}

export async function tryFetchObservedHistoryFromApi(limit = 60): Promise<HistoryPoint[] | null> {
  const safeLimit = Math.max(1, Math.min(366, Math.trunc(limit) || 60))
  const data = await request<ApiEnvelope & { rows?: HistoryPoint[] }>(
    `/api/history?limit=${safeLimit}`
  )
  return data?.rows || null
}
