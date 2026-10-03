import { useMemo, useState } from 'react'
import { View, Text } from '@tarojs/components'
import { Button } from '@nutui/nutui-react-taro'
import Taro, { useDidShow } from '@tarojs/taro'
import ConflictBanner from '../../components/ConflictBanner'
import { tryFetchPredictFromApi } from '../../services/api'
import {
  addDays,
  getFavoriteDates,
  getForecast,
  refreshForecast,
  saveForecastSnapshot,
  setRouteDate,
  toggleFavoriteDate,
  todayStr,
} from '../../services/storage'
import type { CrowdDay } from '../../services/types'
import { crowdLevel, shortDate, weekdayLabel } from '../../utils/format'
import './index.scss'

type RankMode = 'date' | 'crowd' | 'wait'

export default function ForecastPage() {
  const [list, setList] = useState<CrowdDay[]>([])
  const [mode, setMode] = useState<RankMode>('date')
  const [favorites, setFavorites] = useState<string[]>([])
  const [syncing, setSyncing] = useState(false)

  useDidShow(() => {
    setList(getForecast())
    setFavorites(getFavoriteDates())
  })

  const goRoute = (date: string) => {
    setRouteDate(date)
    Taro.switchTab({ url: '/pages/route/index' })
  }

  const syncForecast = async () => {
    setSyncing(true)
    const start = addDays(todayStr(), 1)
    const rows = await tryFetchPredictFromApi(start, addDays(start, 29))
    if (rows?.length) {
      setList(saveForecastSnapshot(rows))
      Taro.showToast({ title: '已同步服务端模型结果', icon: 'none' })
    } else {
      setList(refreshForecast())
      Taro.showToast({ title: '服务暂不可用，保留离线历史模型估计', icon: 'none' })
    }
    setSyncing(false)
  }

  const maxCrowd = useMemo(
    () => Math.max(1, ...list.map((d) => d.predicted_crowd_index)),
    [list]
  )

  const sortedByDate = useMemo(
    () => [...list].sort((a, b) => a.date.localeCompare(b.date)),
    [list]
  )

  const displayList = useMemo(() => {
    if (mode === 'crowd') {
      return [...list].sort((a, b) => a.crowd_rank - b.crowd_rank)
    }
    if (mode === 'wait') {
      return [...list].sort((a, b) => a.wait_rank - b.wait_rank)
    }
    return sortedByDate
  }, [list, mode, sortedByDate])

  const lowCrowd = useMemo(
    () => [...list].sort((a, b) => a.predicted_crowd_index - b.predicted_crowd_index).slice(0, 5),
    [list]
  )
  const shortWait = useMemo(
    () => [...list].sort((a, b) => a.hot_ride_avg_wait_min - b.hot_ride_avg_wait_min).slice(0, 5),
    [list]
  )

  return (
    <View className='page forecast-page'>
      <View className='hero'>
        <Text className='hero__title'>未来 30 天预测</Text>
      </View>

      <View className='forecast-source'>
        <Text className='forecast-source__title'>预测不是实测</Text>
        <Text className='forecast-source__body'>
          本页按历史排队画像、星期与节假日估算；真实采集时间和实时排队请以「今日」页为准。
        </Text>
      </View>

      <View className='card chart-card'>
        <View className='section-title'>
          <Text className='section-title__main'>人流走势</Text>
          <Text className='section-title__sub'>越矮越舒适</Text>
        </View>
        <View className='bars'>
          {sortedByDate.map((d) => {
            const h = Math.max(8, (d.predicted_crowd_index / maxCrowd) * 160)
            const level = crowdLevel(d.predicted_crowd_index)
            return (
              <View
                className='bars__col'
                key={d.date}
                onClick={() => goRoute(d.date)}
              >
                <View
                  className={`bars__bar bars__bar--${level.tone}`}
                  style={{ height: `${h}px` }}
                  onClick={() => goRoute(d.date)}
                />
                <Text className='bars__label'>{shortDate(d.date)}</Text>
              </View>
            )
          })}
        </View>
      </View>

      <View className='section'>
        <View className='section-title'>
          <Text className='section-title__main'>推荐日期</Text>
        </View>
        <View className='card rec-grid'>
          <View className='rec-col'>
            <Text className='rec-col__title'>低人流 TOP5</Text>
            {lowCrowd.map((d) => (
              <View
                className='rec-row'
                key={`lc-${d.date}`}
                onClick={() => goRoute(d.date)}
              >
                <Text className='rec-row__date'>{d.date.slice(5)}</Text>
                <Text className='rec-row__val'>{d.predicted_crowd_index}</Text>
              </View>
            ))}
          </View>
          <View className='rec-col'>
            <Text className='rec-col__title'>短排队 TOP5</Text>
            {shortWait.map((d) => (
              <View
                className='rec-row'
                key={`sw-${d.date}`}
                onClick={() => goRoute(d.date)}
              >
                <Text className='rec-row__date'>{d.date.slice(5)}</Text>
                <Text className='rec-row__val'>{d.hot_ride_avg_wait_min}′</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View className='section'>
        <View className='section-title'>
          <View>
            <Text className='section-title__main'>逐日预测与排名</Text>
            <Text className='section-title__sub'>同一份明细，换一种顺序看</Text>
          </View>
          <Button
            size='small'
            type='primary'
            loading={syncing}
            disabled={syncing}
            onClick={() => void syncForecast()}
          >
            同步模型
          </Button>
        </View>

        <View className='mode-tabs'>
          {(
            [
              ['date', '日期顺序'],
              ['crowd', '人流从低到高'],
              ['wait', '排队从短到长'],
            ] as const
          ).map(([k, label]) => (
            <Text
              key={k}
              className={`mode-tabs__item ${mode === k ? 'mode-tabs__item--on' : ''}`}
              onClick={() => setMode(k)}
            >
              {label}
            </Text>
          ))}
        </View>

        {displayList.map((d) => {
          const level = crowdLevel(d.predicted_crowd_index)
          return (
            <View className='card day-card' key={d.date}>
              <View
                onClick={() => goRoute(d.date)}
              >
                <View className='day-card__head'>
                  <View>
                    <Text className='day-card__date'>
                      {mode === 'crowd'
                        ? `#${d.crowd_rank} · ${d.date}`
                        : mode === 'wait'
                          ? `#${d.wait_rank} · ${d.date}`
                          : `${d.date} · ${weekdayLabel(d.date)}`}
                    </Text>
                    <View className='day-card__tags'>
                      {d.is_weekend ? <Text className='chip chip--hot'>周末</Text> : null}
                      {d.is_holiday ? <Text className='chip chip--warn'>节假日</Text> : null}
                      {d.conflict ? <Text className='chip chip--warn'>冲突</Text> : null}
                      {d.confidence ? <Text className='chip'>置信 {d.confidence}%</Text> : null}
                    </View>
                  </View>
                  <Text
                    className={`chip chip--${
                      level.tone === 'ok' ? 'ok' : level.tone === 'hot' ? 'warn' : 'hot'
                    }`}
                  >
                    {level.label}
                  </Text>
                </View>
                <View className='day-card__metrics'>
                  <View className='metric'>
                    <Text className='metric__label'>园区人流</Text>
                    <Text className='metric__value'>{d.predicted_crowd_index}</Text>
                  </View>
                  <View className='metric'>
                    <Text className='metric__label'>热门均排</Text>
                    <Text className='metric__value'>
                      {d.hot_ride_avg_wait_min}
                      <Text className='metric__unit'>分</Text>
                    </Text>
                  </View>
                  <View className='metric'>
                    <Text className='metric__label'>人流 / 排队排名</Text>
                    <Text className='metric__value metric__value--ranks'>
                      #{d.crowd_rank} / #{d.wait_rank}
                    </Text>
                  </View>
                </View>
                <ConflictBanner note={d.conflict_note} />
              </View>
              <View className='day-card__fav'>
                <Button
                  size='mini'
                  fill='outline'
                  onClick={() => setFavorites(toggleFavoriteDate(d.date))}
                >
                  {favorites.includes(d.date) ? '已收藏' : '收藏此日'}
                </Button>
                <Button
                  size='mini'
                  type='primary'
                  onClick={() => goRoute(d.date)}
                >
                  看路线
                </Button>
              </View>
            </View>
          )
        })}
      </View>
    </View>
  )
}
