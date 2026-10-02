import { useMemo, useRef, useState } from 'react'
import { View, Text, Canvas } from '@tarojs/components'
import { Button } from '@nutui/nutui-react-taro'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import ConflictBanner from '../../components/ConflictBanner'
import RouteTimeline from '../../components/RouteTimeline'
import { tryFetchSuggestFromApi } from '../../services/api'
import {
  getDayPlan,
  getForecast,
  getLowCrowdDates,
  getRouteDate,
  saveDayPlanSnapshot,
  setRouteDate,
} from '../../services/storage'
import type { DayPlan } from '../../services/types'
import { weekdayLabel } from '../../utils/format'
import './index.scss'

function todayStr() {
  const d = new Date()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function shiftDate(dateStr: string, delta: number) {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + delta)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export default function RoutePage() {
  const router = useRouter()
  const [date, setDate] = useState(todayStr())
  const [plan, setPlan] = useState<DayPlan | null>(null)
  const [sharing, setSharing] = useState(false)
  const [needCanvas, setNeedCanvas] = useState(false)
  const loadToken = useRef(0)

  const quickDates = useMemo(() => getLowCrowdDates(5), [date])
  const forecastHit = useMemo(() => getForecast().find((d) => d.date === date), [date])
  const maxRouteDate = useMemo(() => {
    const rows = getForecast()
    return rows.length ? rows.reduce((max, row) => (row.date > max ? row.date : max), rows[0].date) : todayStr()
  }, [date])

  const load = (requestedDate: string, notify = false) => {
    const min = todayStr()
    const normalized = requestedDate < min ? min : requestedDate > maxRouteDate ? maxRouteDate : requestedDate
    if (notify && normalized !== requestedDate) {
      Taro.showToast({ title: requestedDate < min ? '路线从今天开始安排' : '已到当前预测范围末尾', icon: 'none' })
    }
    setDate(normalized)
    setRouteDate(normalized)
    setPlan(getDayPlan(normalized))
    const token = ++loadToken.current
    void tryFetchSuggestFromApi(normalized).then((remotePlan) => {
      if (remotePlan && token === loadToken.current) {
        setPlan(saveDayPlanSnapshot(remotePlan))
      }
    })
  }

  useDidShow(() => {
    const target = router.params.date || getRouteDate() || date || todayStr()
    load(target)
  })

  const sharePoster = async () => {
    if (!plan || sharing) return
    setSharing(true)
    setNeedCanvas(true)
    try {
      // 等 Canvas 真正挂载，避免「短暂挂载」过快导致画布未就绪
      await new Promise((r) => setTimeout(r, 120))
      const ctx = Taro.createCanvasContext('routePoster')
      const W = 375
      const H = 560
      ctx.setFillStyle('#0B3D5C')
      ctx.fillRect(0, 0, W, H)
      ctx.setFillStyle('#E8A838')
      ctx.fillRect(0, 0, W, 8)
      ctx.setFillStyle('#FFFFFF')
      ctx.setFontSize(22)
      ctx.fillText('上海迪士尼游玩路线', 24, 48)
      ctx.setFontSize(14)
      ctx.setFillStyle('#B8C9D6')
      ctx.fillText(`${plan.date}  ${weekdayLabel(plan.date)}`, 24, 76)
      ctx.setFillStyle('#FFFFFF')
      ctx.setFontSize(13)
      ctx.fillText(`人流 ${plan.predicted_crowd_index}  ·  热门均排 ${plan.hot_ride_avg_wait_min}分`, 24, 104)

      let y = 140
      plan.play_route.slice(0, 8).forEach((step) => {
        ctx.setFillStyle('#E8A838')
        ctx.fillRect(24, y - 10, 4, 28)
        ctx.setFillStyle('#FFFFFF')
        ctx.setFontSize(13)
        const hm = step.time.split(' ')[1] || ''
        ctx.fillText(`${hm}  ${step.ride_name}`, 36, y)
        ctx.setFillStyle('#B8C9D6')
        ctx.setFontSize(11)
        ctx.fillText(`预计 ${step.predicted_wait_min} 分钟`, 36, y + 16)
        y += 48
      })

      ctx.setFillStyle('#7A8B99')
      ctx.setFontSize(11)
      ctx.fillText('迪士尼人流助手 · 仅供参考', 24, H - 28)
      await new Promise<void>((resolve) => ctx.draw(false, () => resolve()))

      const res = await Taro.canvasToTempFilePath({
        canvasId: 'routePoster',
        width: W,
        height: H,
        destWidth: W * 2,
        destHeight: H * 2,
      })
      await Taro.showShareImageMenu({ path: res.tempFilePath }).catch(async () => {
        await Taro.previewImage({ urls: [res.tempFilePath] })
      })
    } catch (e) {
      Taro.showToast({ title: '海报生成失败', icon: 'none' })
    } finally {
      setSharing(false)
      setNeedCanvas(false)
    }
  }

  if (!plan) {
    return (
      <View className='page'>
        <Text className='muted'>加载中…</Text>
      </View>
    )
  }

  return (
    <View className='page route-page'>
      <View className='hero'>
        <Text className='hero__title'>分时游玩路线</Text>
        <Text className='hero__meta'>
          {date} · {weekdayLabel(date)}
        </Text>
      </View>

      <View className='route-source'>
        <Text className='route-source__title'>路线是建议，不是实时承诺</Text>
        <Text className='route-source__body'>
          顺序按历史分时排队画像生成；到园后请结合「今日」实采状态和临时停运信息调整。
        </Text>
      </View>

      <View className='card summary'>
        <View className='summary__row'>
          <View>
            <Text className='muted'>选定日期</Text>
            <Text className='summary__date'>{date}</Text>
          </View>
          <View className='summary__nav'>
            <Button size='small' fill='outline' disabled={date <= todayStr()} onClick={() => load(shiftDate(date, -1), true)}>
              前一天
            </Button>
            <Button size='small' type='primary' disabled={date >= maxRouteDate} onClick={() => load(shiftDate(date, 1), true)}>
              后一天
            </Button>
          </View>
        </View>

        <View className='quick'>
          <Text className='muted'>低人流日</Text>
          <View className='quick__list'>
            {quickDates.map((d) => (
              <Text
                key={d.date}
                className={`quick__chip ${d.date === date ? 'quick__chip--on' : ''}`}
                onClick={() => load(d.date)}
              >
                {d.date.slice(5)}
              </Text>
            ))}
          </View>
        </View>

        <View className='summary__metrics'>
          <View className='metric'>
            <Text className='metric__label'>预测人流</Text>
            <Text className='metric__value'>{plan.predicted_crowd_index}</Text>
          </View>
          <View className='metric'>
            <Text className='metric__label'>热门均排</Text>
            <Text className='metric__value'>{plan.hot_ride_avg_wait_min}′</Text>
          </View>
          <View className='metric'>
            <Text className='metric__label'>人流排名</Text>
            <Text className='metric__value'>{forecastHit ? `#${forecastHit.crowd_rank}` : '-'}</Text>
          </View>
        </View>
        <ConflictBanner note={plan.conflict_note} />
        <Button className='share-btn' type='primary' block loading={sharing} onClick={sharePoster}>
          生成分享海报
        </Button>
      </View>

      <View className='section'>
        <View className='section-title'>
          <Text className='section-title__main'>分时段避峰</Text>
        </View>
        <View className='card'>
          {plan.time_slot_advice.map((slot) => (
            <View className='slot' key={slot.slot}>
              <View className='slot__head'>
                <Text className='slot__name'>{slot.slot}</Text>
                <Text
                  className={`chip ${
                    slot.peak_level === '高峰' ? 'chip--warn' : slot.peak_level === '低峰' ? 'chip--ok' : 'chip--hot'
                  }`}
                >
                  {slot.peak_level}
                </Text>
              </View>
              <Text className='slot__wait'>
                热门 {slot.hot_avg_wait_min}′
                {slot.cold_avg_wait_min != null ? ` · 轻松 ${slot.cold_avg_wait_min}′` : ''}
              </Text>
              <Text className='slot__tip'>{slot.suggestion}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='section'>
        <View className='section-title'>
          <Text className='section-title__main'>游玩顺序</Text>
        </View>
        <View className='card'>
          <RouteTimeline steps={plan.play_route} />
        </View>
      </View>

      {needCanvas ? (
        <Canvas
          canvasId='routePoster'
          style={{ width: '375px', height: '560px', position: 'fixed', left: '-9999px', top: 0 }}
        />
      ) : null}
    </View>
  )
}
