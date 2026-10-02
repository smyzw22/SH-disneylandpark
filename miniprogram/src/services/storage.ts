import Taro from '@tarojs/taro'
import parkData from '../data/park_data.json'
import { ATTRACTIONS, normalizeRideName } from './attractions'
import { buildMockDayPlan, synthWait, tierOf, HOT } from './mock'
import type {
  CheckInRecord,
  CheckInType,
  CrowdDay,
  DayPlan,
  HistoryPoint,
  PassAccount,
  PassCardType,
  PassLedgerItem,
  RealtimeData,
  RouteStep,
} from './types'

const KEYS = {
  seeded: 'sdl_seeded_v4',
  bundle: 'sdl_public_data_bundle_v5',
  realtime: 'sdl_realtime',
  forecast: 'sdl_forecast',
  history: 'sdl_history',
  plans: 'sdl_plans',
  favoriteDates: 'sdl_favorite_dates',
  checkins: 'sdl_checkins',
  pass: 'sdl_pass_account_v2',
  routeDate: 'sdl_route_date',
  badges: 'sdl_badges_seen',
} as const

function getJSON<T>(key: string, fallback: T): T {
  try {
    const v = Taro.getStorageSync(key)
    if (v === '' || v === undefined || v === null) return fallback
    return typeof v === 'string' ? (JSON.parse(v) as T) : (v as T)
  } catch {
    return fallback
  }
}

function setJSON(key: string, value: unknown) {
  Taro.setStorageSync(key, value)
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/** 本地时区日期，避免 toISOString() 在 UTC+8 凌晨变成昨天 */
function todayStr() {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

function addDays(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function defaultPass(): PassAccount {
  return {
    cardType: 'custom',
    passName: '',
    passCost: 0,
    ticketFaceValue: 499,
    startDate: '',
    endDate: '',
    ledger: [],
  }
}

/** 流水以年卡设定为准：购入行永远等于 passCost，去掉陈旧默认值 */
function syncPassLedger(pass: PassAccount): PassAccount {
  // 保留用户全部流水；年卡购入行与设定同步
  const others = (pass.ledger || []).filter(
    (l) => l.type !== 'annual_pass' && l.type !== 'pass_cost'
  )
  const ledger: PassLedgerItem[] = []
  if (pass.passName && pass.passCost > 0 && pass.startDate && pass.endDate) {
    ledger.push({
      id: 'annual_pass_current',
      type: 'annual_pass',
      title: `${pass.passName}购入`,
      amount: -Math.abs(pass.passCost),
      date: pass.startDate || todayStr(),
    })
  }
  ledger.push(...others)
  return { ...pass, ledger }
}

function normalizePass(raw: Partial<PassAccount> | null | undefined): PassAccount {
  const base = defaultPass()
  if (!raw || typeof raw !== 'object') return base

  const cost = Number(raw.passCost) || 0
  const face = Number(raw.ticketFaceValue) || 499
  const startDate = raw.startDate || ''
  const endDate = raw.endDate || ''
  const passName = String(raw.passName || '').trim()
  const cardType = (raw.cardType as PassCardType) || 'custom'
  const ledger = (Array.isArray(raw.ledger) ? raw.ledger : []).filter(
    (item): item is PassLedgerItem =>
      !!item &&
      typeof item.id === 'string' &&
      typeof item.title === 'string' &&
      Number.isFinite(Number(item.amount))
  )

  // 账本不依赖年卡存在。旧版在未配置年卡时会把正常消费一起丢掉，现只清理无效年卡行。
  if (!passName || cost <= 0 || !startDate || !endDate || passName === '奇妙年卡') {
    return {
      ...base,
      ticketFaceValue: face,
      ledger: ledger.filter((l) => l.type !== 'annual_pass' && l.type !== 'pass_cost'),
    }
  }

  return syncPassLedger({
    cardType,
    passName,
    passCost: cost,
    ticketFaceValue: face,
    startDate,
    endDate,
    ledger,
  })
}

function normalizeCheckIns(raw: unknown): CheckInRecord[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item, i) => {
    const c = item as Record<string, unknown>
    const checkedAt = String(c.checkedAt || new Date().toISOString())
    const photos = Array.isArray(c.photos)
      ? (c.photos as string[])
      : c.photoPath
        ? [String(c.photoPath)]
        : []
    return {
      id: String(c.id || `ck_${checkedAt}_${i}`),
      visitDate: String(c.visitDate || checkedAt.slice(0, 10)),
      type: (c.type as CheckInType) || 'attraction',
      attractionId: c.attractionId ? String(c.attractionId) : undefined,
      attractionName: String(c.attractionName || '上海迪士尼乐园'),
      checkedAt,
      note: String(c.note || ''),
      photos,
    }
  })
}

function fromParkRealtime(): RealtimeData {
  const r = parkData.realtime as any
  const updated = String(r.updated_at || '')
  const age = updated ? Math.max(0, Math.round((Date.now() - new Date(updated).getTime()) / 60000)) : null
  return {
    ...r,
    rides: (r.rides || []).map((x: any) => {
      const ride_name = normalizeRideName(x.ride_name)
      return { ...x, ride_name, tier: x.tier || tierOf(ride_name) }
    }),
    data_source: 'bundled_snapshot',
    snapshot_label: updated ? `离线快照 · ${updated.replace('T', ' ').slice(0, 16)}` : '离线快照',
    freshness_minutes: age,
    stale: age == null || age > 15,
    is_today: r.date === todayStr(),
  }
}

function fromParkForecast(): CrowdDay[] {
  return (parkData.forecast as CrowdDay[]).map((d) => ({ ...d }))
}

function fromParkHistory(): HistoryPoint[] {
  return (parkData.history as HistoryPoint[]).map((d) => ({ ...d }))
}

/** 用爬虫分时画像表生成路线 */
export function buildPlanFromScraper(dateStr: string): DayPlan {
  const forecast = fromParkForecast()
  const hit = forecast.find((d) => d.date === dateStr)
  const crowd = hit?.predicted_crowd_index ?? 40
  const d = new Date(`${dateStr}T12:00:00`)
  const weekday = d.getDay() === 0 ? 6 : d.getDay() - 1 // JS Sun=0 -> profile Mon=0
  // park profile uses Monday=0
  const wd = (d.getDay() + 6) % 7
  const table = (parkData as any).wait_table || {}
  const allNames = ATTRACTIONS.map((a) => a.name)

  const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
  const reasons: Record<number, string> = {
    9: '开园优先短排队热门',
    10: '早场续刷热门',
    11: '早场收尾',
    12: '午峰改玩轻松项目',
    13: '午峰继续分流',
    14: '午峰末穿插中等',
    15: '下午补刷热门',
    16: '下午次热门',
    17: '傍晚优先短排队',
    18: '傍晚灵活安排',
    19: '闭园前收尾',
  }

  const play_route: RouteStep[] = hours.map((hour) => {
    const scored = allNames
      .map((name) => {
        const key = `${name}|${hour}|${wd}`
        let wait = table[key]
        if (wait == null) wait = synthWait(name, hour, crowd, d)
        return {
          time: `${dateStr} ${String(hour).padStart(2, '0')}:00`,
          hour,
          ride_name: name,
          tier: tierOf(name) || 'medium',
          predicted_wait_min: Math.round(Number(wait)),
          reason: '',
        }
      })
      .sort((a, b) => a.predicted_wait_min - b.predicted_wait_min)

    const preferred =
      hour <= 11 ? ['hot', 'medium', 'cold'] : hour <= 14 ? ['cold', 'medium', 'hot'] : ['hot', 'cold', 'medium']
    let primary = scored[0]
    for (const t of preferred) {
      const hitRide = scored.find((s) => s.tier === t)
      if (hitRide) {
        primary = hitRide
        break
      }
    }
    const alts = scored.filter((s) => s.ride_name !== primary.ride_name).slice(0, 2)
    return {
      ...primary,
      reason: reasons[hour] || '',
      alternatives: alts.map((a) => ({
        ride_name: a.ride_name,
        tier: a.tier,
        predicted_wait_min: a.predicted_wait_min,
      })),
    }
  })

  const hotAvg =
    hit?.hot_ride_avg_wait_min ??
    Math.round(
      (HOT.reduce((s, n) => s + synthWait(n, 14, crowd, d), 0) / HOT.length) * 10
    ) / 10
  const conflict = !!hit?.conflict

  return {
    date: dateStr,
    predicted_crowd_index: crowd,
    hot_ride_avg_wait_min: hotAvg,
    conflict,
    conflict_note: hit?.conflict_note || null,
    time_slot_advice: [
      {
        slot: '早场 09:00-11:59',
        peak_level: '低峰',
        hot_avg_wait_min: Math.round(hotAvg * 0.85),
        cold_avg_wait_min: Math.round(hotAvg * 0.5),
        suggestion: '优先热门项目',
      },
      {
        slot: '午峰 12:00-14:59',
        peak_level: '高峰',
        hot_avg_wait_min: Math.round(hotAvg * 1.2),
        cold_avg_wait_min: Math.round(hotAvg * 0.7),
        suggestion: '改玩轻松项目或看演出',
      },
      {
        slot: '下午 15:00-16:59',
        peak_level: '平峰',
        hot_avg_wait_min: Math.round(hotAvg * 1.05),
        cold_avg_wait_min: Math.round(hotAvg * 0.65),
        suggestion: '补刷遗漏热门',
      },
      {
        slot: '傍晚 17:00-21:00',
        peak_level: '低峰',
        hot_avg_wait_min: Math.round(hotAvg * 0.8),
        cold_avg_wait_min: Math.round(hotAvg * 0.45),
        suggestion: '短排队收尾',
      },
    ],
    play_route,
  }
}

export function seedLocalDataIfNeeded() {
  const seeded = Taro.getStorageSync(KEYS.seeded)
  const bundleReady = Taro.getStorageSync(KEYS.bundle)

  // 公共数据包升级与个人数据初始化分开：刷新真实快照时绝不覆盖打卡和账本。
  if (!bundleReady) {
    setJSON(KEYS.realtime, fromParkRealtime())
    setJSON(KEYS.forecast, fromParkForecast())
    setJSON(KEYS.history, fromParkHistory())
    setJSON(KEYS.plans, {})
    Taro.setStorageSync(KEYS.bundle, '1')
  }
  if (seeded) return

  setJSON(KEYS.favoriteDates, [])
  setJSON(KEYS.checkins, [])
  setJSON(KEYS.pass, defaultPass())
  Taro.setStorageSync(KEYS.seeded, '1')
}

export function forceReseedFromScraper() {
  setJSON(KEYS.realtime, fromParkRealtime())
  setJSON(KEYS.forecast, fromParkForecast())
  setJSON(KEYS.history, fromParkHistory())
  setJSON(KEYS.plans, {})
  Taro.setStorageSync(KEYS.bundle, '1')
  Taro.setStorageSync(KEYS.seeded, '1')
  return fromParkForecast()
}

export function getRealtime(): RealtimeData {
  seedLocalDataIfNeeded()
  return normalizeRealtimeSnapshot(getJSON<RealtimeData>(KEYS.realtime, fromParkRealtime()))
}

export function refreshRealtime(): RealtimeData {
  const data = fromParkRealtime()
  setJSON(KEYS.realtime, data)
  return data
}

export function saveRealtimeSnapshot(data: RealtimeData): RealtimeData {
  const normalized = normalizeRealtimeSnapshot(data)
  setJSON(KEYS.realtime, normalized)
  return normalized
}

function normalizeRealtimeSnapshot(data: RealtimeData): RealtimeData {
  return {
    ...data,
    rides: (data.rides || []).map((ride) => {
      const ride_name = normalizeRideName(ride.ride_name)
      return { ...ride, ride_name, tier: ride.tier || tierOf(ride_name) }
    }),
  }
}

export function getForecast(): CrowdDay[] {
  seedLocalDataIfNeeded()
  return getJSON<CrowdDay[]>(KEYS.forecast, fromParkForecast())
}

export function saveForecastSnapshot(rows: CrowdDay[]): CrowdDay[] {
  const next = rows.map((row) => ({ ...row }))
  setJSON(KEYS.forecast, next)
  return next
}

export function refreshForecast(): CrowdDay[] {
  return forceReseedFromScraper()
}

export function getHistory(): HistoryPoint[] {
  seedLocalDataIfNeeded()
  return getJSON<HistoryPoint[]>(KEYS.history, fromParkHistory())
}

export function saveHistorySnapshot(rows: HistoryPoint[]): HistoryPoint[] {
  const next = rows
    .filter((row) => row?.date && Number.isFinite(Number(row.crowd_index)))
    .map((row) => ({ ...row }))
    .sort((a, b) => a.date.localeCompare(b.date))
  setJSON(KEYS.history, next)
  return next
}

export function getDayPlan(date: string): DayPlan {
  seedLocalDataIfNeeded()
  const plans = getJSON<Record<string, DayPlan>>(KEYS.plans, {})
  const plan = Object.keys((parkData as any).wait_table || {}).length
    ? buildPlanFromScraper(date)
    : buildMockDayPlan(date)
  plans[date] = plan
  setJSON(KEYS.plans, plans)
  return plan
}

export function saveDayPlanSnapshot(plan: DayPlan): DayPlan {
  seedLocalDataIfNeeded()
  const plans = getJSON<Record<string, DayPlan>>(KEYS.plans, {})
  plans[plan.date] = plan
  setJSON(KEYS.plans, plans)
  return plan
}

export function getFavoriteDates(): string[] {
  return getJSON<string[]>(KEYS.favoriteDates, [])
}

export function toggleFavoriteDate(date: string): string[] {
  const list = getFavoriteDates()
  const next = list.includes(date) ? list.filter((d) => d !== date) : [...list, date]
  setJSON(KEYS.favoriteDates, next)
  return next
}

export function getLowCrowdDates(topN = 5): CrowdDay[] {
  return [...getForecast()].sort((a, b) => a.predicted_crowd_index - b.predicted_crowd_index).slice(0, topN)
}

export function getShortWaitDates(topN = 5): CrowdDay[] {
  return [...getForecast()].sort((a, b) => a.hot_ride_avg_wait_min - b.hot_ride_avg_wait_min).slice(0, topN)
}

export function getCheckIns(): CheckInRecord[] {
  seedLocalDataIfNeeded()
  const list = normalizeCheckIns(getJSON<unknown>(KEYS.checkins, []))
  setJSON(KEYS.checkins, list)
  return list
}

export function getCheckInsByDate(date: string): CheckInRecord[] {
  return getCheckIns().filter((c) => c.visitDate === date)
}

export function saveCheckIns(list: CheckInRecord[]): CheckInRecord[] {
  setJSON(KEYS.checkins, list)
  return list
}

export interface AddCheckInInput {
  type: CheckInType
  visitDate?: string
  attractionId?: string
  attractionName?: string
  note?: string
  photos?: string[]
}

export function addCheckIn(input: AddCheckInInput | string, note = '', photoPath = ''): CheckInRecord[] {
  // 兼容旧调用：addCheckIn(attractionId, note, photoPath)
  const payload: AddCheckInInput =
    typeof input === 'string'
      ? { type: 'attraction', attractionId: input, note, photos: photoPath ? [photoPath] : [] }
      : input

  const spot = payload.attractionId ? ATTRACTIONS.find((a) => a.id === payload.attractionId) : undefined
  const visitDate = payload.visitDate || todayStr()
  const type = payload.type || (spot?.category as CheckInType) || 'attraction'
  const list = getCheckIns()

  if (type === 'entry') {
    const exists = list.some((c) => c.type === 'entry' && c.visitDate === visitDate)
    if (exists) {
      Taro.showToast({ title: '这天已经记过入园啦', icon: 'none' })
      return list
    }
  }

  const record: CheckInRecord = {
    id: `ck_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    visitDate,
    type,
    attractionId: spot?.id || payload.attractionId,
    attractionName:
      payload.attractionName ||
      spot?.name ||
      (type === 'entry' ? '上海迪士尼乐园 · 入园' : '自定义打卡'),
    checkedAt: new Date().toISOString(),
    note: (payload.note || '').trim(),
    photos: payload.photos || [],
  }
  const next = [record, ...list]
  return saveCheckIns(next)
}

export function updateCheckIn(
  id: string,
  patch: Partial<Pick<CheckInRecord, 'note' | 'photos' | 'attractionName' | 'visitDate'>>
): CheckInRecord[] {
  const list = getCheckIns().map((c) => (c.id === id ? { ...c, ...patch } : c))
  return saveCheckIns(list)
}

export function updateCheckInNote(idOrCheckedAt: string, note: string): CheckInRecord[] {
  const list = getCheckIns().map((c) =>
    c.id === idOrCheckedAt || c.checkedAt === idOrCheckedAt ? { ...c, note } : c
  )
  return saveCheckIns(list)
}

export function deleteCheckIn(id: string): CheckInRecord[] {
  const list = getCheckIns()
  const target = list.find((item) => item.id === id)
  ;(target?.photos || []).forEach((filePath) => {
    Taro.removeSavedFile({ filePath }).catch(() => undefined)
  })
  return saveCheckIns(list.filter((c) => c.id !== id))
}

export function batchEntryCheckIns(dates: string[]): CheckInRecord[] {
  let list = getCheckIns()
  const existing = new Set(list.filter((c) => c.type === 'entry').map((c) => c.visitDate))
  const now = Date.now()
  dates.forEach((date, i) => {
    if (existing.has(date)) return
    list = [
      {
        id: `ck_batch_${now}_${i}`,
        visitDate: date,
        type: 'entry',
        attractionName: '上海迪士尼乐园 · 入园',
        checkedAt: new Date().toISOString(),
        note: '',
        photos: [],
      },
      ...list,
    ]
    existing.add(date)
  })
  return saveCheckIns(list)
}

export function getPassAccount(): PassAccount {
  seedLocalDataIfNeeded()
  // 丢弃旧 key 里的默认 1999 脏数据
  try {
    Taro.removeStorageSync('sdl_pass_account')
  } catch {
    /* ignore */
  }
  const pass = normalizePass(getJSON<PassAccount>(KEYS.pass, defaultPass()))
  setJSON(KEYS.pass, pass)
  return pass
}

export function savePassAccount(pass: PassAccount): PassAccount {
  const next = syncPassLedger({
    cardType: pass.cardType || 'custom',
    passName: String(pass.passName || '').trim(),
    passCost: Number(pass.passCost) || 0,
    ticketFaceValue: Number(pass.ticketFaceValue) || 499,
    startDate: pass.startDate || '',
    endDate: pass.endDate || '',
    ledger: Array.isArray(pass.ledger) ? pass.ledger : [],
  })
  setJSON(KEYS.pass, next)
  return next
}

export function clearPassAccount(): PassAccount {
  const current = getPassAccount()
  const empty = {
    ...defaultPass(),
    ticketFaceValue: current.ticketFaceValue || 499,
    ledger: current.ledger.filter((l) => l.type !== 'annual_pass' && l.type !== 'pass_cost'),
  }
  setJSON(KEYS.pass, empty)
  try {
    Taro.removeStorageSync('sdl_pass_account')
  } catch {
    /* ignore */
  }
  return empty
}

export function addPassExpense(title: string, amount: number, note = '', date = todayStr()): PassAccount {
  const pass = getPassAccount()
  const item: PassLedgerItem = {
    id: `exp_${Date.now()}`,
    type: 'park_expense',
    title,
    amount: -Math.abs(amount),
    date,
    note,
  }
  const others = pass.ledger.filter((l) => l.type !== 'annual_pass' && l.type !== 'pass_cost')
  const next = syncPassLedger({
    ...pass,
    ledger: [item, ...others],
  })
  setJSON(KEYS.pass, next)
  return next
}

export function addTicketPurchase(
  type: PassLedgerItem['type'],
  title: string,
  amount: number,
  note = '',
  date = todayStr()
): PassAccount {
  const pass = getPassAccount()
  const item: PassLedgerItem = {
    id: `tk_${Date.now()}`,
    type,
    title,
    amount: -Math.abs(amount),
    date,
    note,
  }
  const others = pass.ledger.filter((l) => l.type !== 'annual_pass' && l.type !== 'pass_cost')
  const next = syncPassLedger({
    ...pass,
    ledger: [item, ...others],
  })
  setJSON(KEYS.pass, next)
  return next
}

export function deletePassExpense(id: string): PassAccount {
  const pass = getPassAccount()
  const next = syncPassLedger({
    ...pass,
    ledger: pass.ledger.filter((l) => l.id !== id),
  })
  setJSON(KEYS.pass, next)
  return next
}

export function calcPassStats(pass: PassAccount, checkins: CheckInRecord[]) {
  const hasPass = !!(pass.passName && pass.passCost > 0 && pass.startDate && pass.endDate)
  const visitDays = new Set(checkins.map((c) => c.visitDate)).size
  const entryDays = new Set(checkins.filter((c) => c.type === 'entry').map((c) => c.visitDate)).size
  const daysUsed = Math.max(visitDays, entryDays)
  const uniqueRides = new Set(
    checkins.filter((c) => c.attractionId && c.type !== 'entry').map((c) => c.attractionId)
  ).size
  const byCat = {
    attraction: checkins.filter((c) => c.type === 'attraction').length,
    show: checkins.filter((c) => c.type === 'show').length,
    character: checkins.filter((c) => c.type === 'character').length,
  }

  let validityDays = 365
  if (pass.startDate && pass.endDate) {
    const a = new Date(`${pass.startDate}T12:00:00`).getTime()
    const b = new Date(`${pass.endDate}T12:00:00`).getTime()
    validityDays = Math.max(1, Math.round((b - a) / 86400000) + 1)
  }

  const face = Math.max(1, pass.ticketFaceValue || 1)
  const cost = Math.max(0, pass.passCost || 0)
  const breakEvenVisits = cost > 0 ? Math.ceil(cost / face) : 0
  const dailyAmortized = cost > 0 ? Math.round((cost / validityDays) * 10) / 10 : 0
  const costPerVisit = daysUsed > 0 ? Math.round((cost / daysUsed) * 10) / 10 : cost
  const recovered = daysUsed * face

  const parkExpense = Math.abs(pass.ledger
    .filter((l) => l.type === 'park_expense' || l.type === 'expense')
    .reduce((s, l) => s + Number(l.amount || 0), 0))
  const ticketSpend = Math.abs(pass.ledger
    .filter((l) =>
      ['day_ticket', 'premier_access', 'early_entry', 'other', 'annual_pass', 'pass_cost'].includes(l.type)
    )
    .reduce((s, l) => s + Number(l.amount || 0), 0))
  const totalSpend = parkExpense + ticketSpend
  const balance = recovered - totalSpend
  const progress =
    breakEvenVisits > 0 ? Math.min(100, Math.round((daysUsed / breakEvenVisits) * 100)) : 0

  return {
    hasPass,
    income: recovered,
    expense: totalSpend,
    parkExpense,
    ticketSpend,
    totalSpend,
    balance,
    uniqueRides,
    visitDays: daysUsed,
    entryDays,
    checkinCount: checkins.length,
    breakEvenVisits,
    progress,
    dailyAmortized,
    costPerVisit,
    validityDays,
    remainingVisits: Math.max(0, breakEvenVisits - daysUsed),
    byCat,
  }
}

export { todayStr, addDays }

export function setRouteDate(date: string) {
  Taro.setStorageSync(KEYS.routeDate, date)
}

export function getRouteDate(): string {
  return Taro.getStorageSync(KEYS.routeDate) || ''
}

export interface Badge {
  id: string
  name: string
  desc: string
  emoji: string
  unlocked: boolean
}

export function evaluateBadges(checkins: CheckInRecord[]): Badge[] {
  const unique = new Set(checkins.filter((c) => c.attractionId).map((c) => c.attractionId)).size
  const days = new Set(checkins.map((c) => c.visitDate)).size
  const withPhoto = checkins.filter((c) => c.photos?.length).length
  const withNote = checkins.filter((c) => c.note && c.note.trim()).length
  const defs = [
    { id: 'first', name: '初来乍到', desc: '留下第一条脚印', emoji: '🌱', ok: checkins.length >= 1 },
    { id: 'three', name: '三连打卡', desc: '累计写下 3 笔', emoji: '🔥', ok: checkins.length >= 3 },
    { id: 'explorer', name: '园区探索者', desc: '去过 5 个不同项目', emoji: '🧭', ok: unique >= 5 },
    { id: 'collector', name: '图鉴预备役', desc: '去过 8 个不同项目', emoji: '🏅', ok: unique >= 8 },
    { id: 'diarist', name: '游记作者', desc: '写出 3 段心情', emoji: '✍️', ok: withNote >= 3 },
    { id: 'photog', name: '随手拍达人', desc: '有 2 条带图记录', emoji: '📷', ok: withPhoto >= 2 },
    { id: 'regular', name: '回头客', desc: '到访满 3 天', emoji: '🎫', ok: days >= 3 },
  ]
  return defs.map((d) => ({
    id: d.id,
    name: d.name,
    desc: d.desc,
    emoji: d.emoji,
    unlocked: d.ok,
  }))
}
