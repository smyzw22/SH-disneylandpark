import type { CrowdDay, DayPlan, HistoryPoint, RealtimeData, RideWait, RouteStep } from './types'

export const HOT = [
  '创极速光轮－雪佛兰呈献',
  '创极速光轮',
  '疯狂动物城：热力追踪',
  '抱抱龙冲天赛车',
  '漫威英雄总部：钢铁侠飞行器',
  '加勒比海盗——沉落宝藏之战',
  '翱翔·飞越地平线',
  '七个小矮人矿山车',
]
export const COLD = ['巴斯光年星际营救', '小飞象', '小熊维尼历险记', '弹簧狗团团转', '旋转疯蜜罐']
export const MEDIUM = [
  '雷鸣山漂流',
  '晶彩奇航',
  '幻想曲旋转木马',
  '胡迪牛仔嘉年华',
  '小飞侠天空奇遇',
  '喷气背包飞行器',
  '古迹探索营的绳索挑战道',
]

/** 竞品常见做法：人流≈历史均排/历史峰值；再叠加日历/天气/近期趋势 */
const HIST_MAX_WAIT = 90

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`
}

export function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(base: Date, n: number) {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return d
}

export function tierOf(name: string): RideWait['tier'] {
  if (HOT.includes(name)) return 'hot'
  if (COLD.includes(name)) return 'cold'
  return 'medium'
}

function isCNHolidayApprox(d: Date) {
  const m = d.getMonth() + 1
  const day = d.getDate()
  // 近似法定节假日窗口（小程序本地演示；正式环境用 chinese-calendar）
  if (m === 1 && day >= 1 && day <= 3) return true
  if (m === 5 && day >= 1 && day <= 5) return true
  if (m === 10 && day >= 1 && day <= 7) return true
  // 春节窗口粗估
  if (m === 1 && day >= 20) return true
  if (m === 2 && day <= 15) return true
  return false
}

function schoolVacation(d: Date) {
  const m = d.getMonth() + 1
  const day = d.getDate()
  if (m === 7 || m === 8) return true
  if (m === 1 && day >= 15) return true
  if (m === 2 && day <= 20) return true
  return false
}

/** 小时曲线：早场低、午后峰、傍晚回落（对标竞品分时曲线） */
function hourCurve(hour: number) {
  if (hour < 10) return 0.55
  if (hour < 12) return 0.85
  if (hour < 14) return 1.15
  if (hour < 17) return 1.2
  if (hour < 19) return 0.95
  return 0.65
}

function weatherFactor(temp: number, precip: number) {
  let f = 1
  if (precip >= 8) f *= 0.82
  else if (precip >= 2) f *= 0.92
  if (temp >= 35 || temp <= 2) f *= 0.88
  else if (temp >= 30 || temp <= 5) f *= 0.94
  return f
}

/**
 * 改进版园区人流指数（0-100）
 * 方法论对齐 magic-tips / 行业常见做法：
 * score ≈ clamp( (模拟均排 / 历史峰值) * 100 * 日历权重 * 天气 * 近期趋势 )
 * 人流与单项目排队分开建模：节假日人流↑但热门可因分流而排队增幅较弱
 */
export function synthCrowd(d: Date, opts?: { temp?: number; precip?: number; recentBias?: number }) {
  const weekend = d.getDay() === 0 || d.getDay() === 6
  const holiday = isCNHolidayApprox(d)
  const vacation = schoolVacation(d)
  const temp = opts?.temp ?? 26 + (d.getDate() % 6)
  const precip = opts?.precip ?? (d.getDate() % 7 === 3 ? 4 : 0)

  // 基础“等效均排分钟”
  let avgWaitProxy = 28
  avgWaitProxy += weekend ? 14 : 0
  avgWaitProxy += holiday ? 22 : 0
  avgWaitProxy += vacation && !holiday ? 10 : 0
  // 季节性（暑期/国庆窗口更高）
  avgWaitProxy += 5 * Math.sin((2 * Math.PI * (d.getMonth() * 30 + d.getDate())) / 365)
  // 同星期历史波动
  avgWaitProxy += ((d.getDay() * 3 + d.getDate()) % 9) - 4

  let crowd = (avgWaitProxy / HIST_MAX_WAIT) * 100
  crowd *= weatherFactor(temp, precip)
  crowd *= 1 + (opts?.recentBias ?? 0)
  // 确定性噪声（可复现）
  const noise = ((d.getFullYear() * 13 + d.getMonth() * 17 + d.getDate() * 7) % 11) - 5
  crowd += noise * 0.6
  return Math.max(8, Math.min(98, Math.round(crowd * 10) / 10))
}

/**
 * 单项目分时排队：与人流弱相关
 * - 热门：早场相对更短；午后更长
 * - 节假日：热门因分流/预约，排队增幅 < 人流增幅（冲突来源）
 */
export function synthWait(name: string, hour: number, crowd: number, d?: Date) {
  const holiday = d ? isCNHolidayApprox(d) : false
  const weekend = d ? d.getDay() === 0 || d.getDay() === 6 : false
  const pop = HOT.includes(name) ? 1.35 : COLD.includes(name) ? 0.72 : 1.0
  const dispersal = HOT.includes(name) ? 0.18 : COLD.includes(name) ? 0.4 : 0.28
  let wait = crowd * 0.26 * pop * hourCurve(hour)
  // 节假日人分散：热门排队增幅弱于人流
  const holidayBoost = 1 + (holiday ? 0.12 : 0) + (weekend ? 0.08 : 0)
  wait *= holidayBoost * (1 - dispersal * (holiday ? 1 : 0.3))
  wait += ((name.length * 3 + hour * 5) % 8) - 2
  return Math.max(2, Math.min(180, Math.round(wait)))
}

export function buildMockRealtime(): RealtimeData {
  const now = new Date()
  const hour = Math.min(21, Math.max(9, now.getHours()))
  const precip = now.getDate() % 4 === 0 ? 3.2 : 0
  const temp = 28 + (now.getDate() % 5)
  const crowd = synthCrowd(now, { temp, precip })
  const names = [...HOT, ...MEDIUM, ...COLD]
  const rides: RideWait[] = names
    .map((name, i) => ({
      ride_id: `ride_${i}`,
      ride_name: name,
      wait_time_min: synthWait(name, hour, crowd, now),
      status: 'OPERATING',
      tier: tierOf(name),
    }))
    .sort((a, b) => (b.wait_time_min || 0) - (a.wait_time_min || 0))

  return {
    date: isoDate(now),
    hour,
    crowd_index: crowd,
    operating_rides: names.length,
    avg_wait_min: Math.round(rides.reduce((s, r) => s + (r.wait_time_min || 0), 0) / rides.length),
    max_wait_min: Math.max(...rides.map((r) => r.wait_time_min || 0)),
    park_status: 'OPERATING',
    weather: { temperature_c: temp, precipitation_mm: precip, wind_speed_kmh: 12 },
    calendar: {
      is_holiday: isCNHolidayApprox(now),
      is_weekend: now.getDay() === 0 || now.getDay() === 6,
      is_school_vacation: schoolVacation(now),
    },
    rides,
    updated_at: now.toISOString(),
  }
}

export function buildMockForecast(days = 30): CrowdDay[] {
  const start = addDays(new Date(), 1)
  const rows: CrowdDay[] = []
  let recentBias = 0
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i)
    const temp = 26 + (i % 6)
    const precip = i % 7 === 3 ? 4 : 0
    // 近期趋势惯性（竞品常用：最近几天观测微调）
    recentBias = recentBias * 0.6 + (((i % 5) - 2) * 0.01)
    const crowd = synthCrowd(d, { temp, precip, recentBias })
    const weekend = d.getDay() === 0 || d.getDay() === 6
    const holiday = isCNHolidayApprox(d)
    // 热门日均排队：对人流弱相关
    const hotSamples = HOT.map((n) => synthWait(n, 14, crowd, d))
    const hotWait = Math.round((hotSamples.reduce((a, b) => a + b, 0) / hotSamples.length) * 10) / 10
    const conflict = crowd < 42 && hotWait > 22
    rows.push({
      date: isoDate(d),
      predicted_crowd_index: crowd,
      crowd_rank: 0,
      hot_ride_avg_wait_min: hotWait,
      wait_rank: 0,
      is_holiday: holiday ? 1 : 0,
      is_weekend: weekend ? 1 : 0,
      conflict,
      conflict_note: conflict
        ? '⚠ 冲突：园区人流偏低，但热门项目排队仍偏长（分流/预约/爆款聚集）。建议早场冲热门、午峰改玩冷门。'
        : null,
      temperature_c: temp,
      precipitation_mm: precip,
      confidence: Math.round(72 + (i % 5) * 3 + (precip > 0 ? -4 : 2)),
    })
  }
  ;[...rows]
    .sort((a, b) => a.predicted_crowd_index - b.predicted_crowd_index)
    .forEach((r, idx) => {
      r.crowd_rank = idx + 1
    })
  ;[...rows]
    .sort((a, b) => a.hot_ride_avg_wait_min - b.hot_ride_avg_wait_min)
    .forEach((r, idx) => {
      r.wait_rank = idx + 1
    })
  return rows.sort((a, b) => a.crowd_rank - b.crowd_rank)
}

export function buildMockHistory(days = 30): HistoryPoint[] {
  const points: HistoryPoint[] = []
  for (let i = days; i >= 1; i--) {
    const d = addDays(new Date(), -i)
    const crowd = synthCrowd(d)
    points.push({
      date: isoDate(d),
      crowd_index: crowd,
      avg_wait_min: Math.round(crowd * 0.52),
      is_holiday: isCNHolidayApprox(d),
      is_weekend: d.getDay() === 0 || d.getDay() === 6,
    })
  }
  return points
}

function allRides() {
  return [...HOT, ...MEDIUM, ...COLD]
}

/** 同小时多项目推荐（按预计排队升序） */
export function buildHourRecommendations(dateStr: string, hour: number, crowd: number): RouteStep[] {
  const d = new Date(`${dateStr}T12:00:00`)
  return allRides()
    .map((ride) => ({
      time: `${dateStr} ${pad(hour)}:00`,
      hour,
      ride_name: ride,
      tier: tierOf(ride) || 'medium',
      predicted_wait_min: synthWait(ride, hour, crowd, d),
      reason: '',
    }))
    .sort((a, b) => a.predicted_wait_min - b.predicted_wait_min)
}

export function buildMockDayPlan(dateStr: string): DayPlan {
  const d = new Date(`${dateStr}T12:00:00`)
  const crowd = synthCrowd(d)
  const hotAvg =
    Math.round(
      (HOT.reduce((s, n) => s + synthWait(n, 14, crowd, d), 0) / HOT.length) * 10
    ) / 10
  const conflict = crowd < 42 && hotAvg > 22

  const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
  const slotReason: Record<number, string> = {
    9: '开园窗口：优先最短热门',
    10: '早场续刷热门',
    11: '早场收尾',
    12: '午峰避热门，冷门分流',
    13: '午峰继续分流',
    14: '午峰末尾，穿插中等',
    15: '下午补刷热门',
    16: '下午次热门',
    17: '傍晚优先短排队',
    18: '傍晚中等热度',
    19: '闭园前收尾',
  }

  const play_route: RouteStep[] = []
  hours.forEach((hour) => {
    const recs = buildHourRecommendations(dateStr, hour, crowd)
    // 主推 1 + 同场备选 2
    const preferredTier =
      hour <= 11 ? (['hot', 'medium', 'cold'] as const) : hour <= 14 ? (['cold', 'medium', 'hot'] as const) : (['hot', 'cold', 'medium'] as const)
    const picked: RouteStep[] = []
    for (const tier of preferredTier) {
      const hit = recs.find((r) => r.tier === tier && !picked.some((p) => p.ride_name === r.ride_name))
      if (hit) picked.push(hit)
      if (picked.length >= 1) break
    }
    const alts = recs.filter((r) => r.ride_name !== picked[0]?.ride_name).slice(0, 2)
    const primary = picked[0] || recs[0]
    play_route.push({
      ...primary,
      reason: slotReason[hour] || '综合推荐',
      alternatives: alts.map((a) => ({
        ride_name: a.ride_name,
        tier: a.tier,
        predicted_wait_min: a.predicted_wait_min,
      })),
    })
  })

  return {
    date: dateStr,
    predicted_crowd_index: crowd,
    hot_ride_avg_wait_min: hotAvg,
    conflict,
    conflict_note: conflict
      ? '⚠ 冲突提示：园区人流偏低，但热门项目排队仍偏长。请按下方分时多项目推荐游玩。'
      : null,
    time_slot_advice: [
      {
        slot: '早场 09:00-11:59',
        peak_level: '低峰',
        hot_avg_wait_min: Math.round(hotAvg * 0.85),
        cold_avg_wait_min: Math.round(hotAvg * 0.5),
        suggestion: '冲热门最佳窗口；同场可看备选项目',
      },
      {
        slot: '午峰 12:00-14:59',
        peak_level: '高峰',
        hot_avg_wait_min: Math.round(hotAvg * 1.25),
        cold_avg_wait_min: Math.round(hotAvg * 0.7),
        suggestion: '避峰：冷门/演出；热门作备选',
      },
      {
        slot: '下午 15:00-16:59',
        peak_level: '平峰',
        hot_avg_wait_min: Math.round(hotAvg * 1.1),
        cold_avg_wait_min: Math.round(hotAvg * 0.65),
        suggestion: '补刷遗漏热门',
      },
      {
        slot: '傍晚 17:00-21:00',
        peak_level: '低峰',
        hot_avg_wait_min: Math.round(hotAvg * 0.75),
        cold_avg_wait_min: Math.round(hotAvg * 0.45),
        suggestion: '短排队收尾，多项目任选',
      },
    ],
    play_route,
  }
}
