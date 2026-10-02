export interface RideWait {
  ride_id: string
  ride_name: string
  wait_time_min: number | null
  status: string
  tier?: 'hot' | 'cold' | 'medium'
}

export interface RealtimeData {
  date: string
  hour: number
  minute?: number
  crowd_index: number
  operating_rides: number
  avg_wait_min: number
  max_wait_min: number
  park_status: string
  weather: {
    temperature_c: number
    precipitation_mm: number
    wind_speed_kmh?: number
  }
  calendar: {
    is_holiday: boolean
    is_weekend: boolean
    is_school_vacation: boolean
  }
  rides: RideWait[]
  updated_at: string
  /** live_api | sqlite_snapshot | bundled_snapshot */
  data_source?: string
  snapshot_label?: string
  source_url?: string
  is_today?: boolean
  stale?: boolean
  freshness_minutes?: number | null
  cached?: boolean
  message?: string
}

export interface CrowdDay {
  date: string
  predicted_crowd_index: number
  crowd_rank: number
  hot_ride_avg_wait_min: number
  wait_rank: number
  is_holiday: number
  is_weekend: number
  conflict?: boolean
  conflict_note?: string | null
  temperature_c?: number
  precipitation_mm?: number
  confidence?: number
  data_source?: string
}

export interface TimeSlotAdvice {
  slot: string
  peak_level: string
  hot_avg_wait_min: number
  cold_avg_wait_min: number | null
  suggestion: string
}

export interface RouteAlt {
  ride_name: string
  tier: string
  predicted_wait_min: number
}

export interface RouteStep {
  time: string
  hour: number
  ride_name: string
  tier: string
  predicted_wait_min: number
  reason: string
  alternatives?: RouteAlt[]
}

export interface DayPlan {
  date: string
  predicted_crowd_index: number
  hot_ride_avg_wait_min: number
  conflict: boolean
  conflict_note: string | null
  time_slot_advice: TimeSlotAdvice[]
  play_route: RouteStep[]
}

export interface HistoryPoint {
  date: string
  crowd_index: number
  avg_wait_min: number
  is_holiday: boolean
  is_weekend: boolean
  hourly_samples?: number
  data_source?: string
}

export type SpotCategory = 'attraction' | 'show' | 'character'

export interface AttractionSpot {
  id: string
  name: string
  land: string
  category: SpotCategory
  x: number
  y: number
  latitude: number
  longitude: number
  tier: 'hot' | 'cold' | 'medium'
  intro: string
  thrill: string
}

export type CheckInType = 'entry' | 'attraction' | 'show' | 'character'

export interface CheckInRecord {
  id: string
  visitDate: string
  type: CheckInType
  attractionId?: string
  attractionName: string
  checkedAt: string
  note: string
  photos: string[]
}

/** 账本流水类型：票务 + 园内消费 */
export type LedgerItemType =
  | 'annual_pass'
  | 'day_ticket'
  | 'premier_access'
  | 'early_entry'
  | 'park_expense'
  | 'other'
  // 兼容旧数据
  | 'pass_cost'
  | 'expense'
  | 'ticket_value'

export interface PassLedgerItem {
  id: string
  type: LedgerItemType
  title: string
  amount: number
  date: string
  note?: string
}

export type PassCardType = 'pearl' | 'jade' | 'diamond' | 'custom'

export interface PassAccount {
  cardType: PassCardType
  passName: string
  passCost: number
  ticketFaceValue: number
  startDate: string
  endDate: string
  ledger: PassLedgerItem[]
}
