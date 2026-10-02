import { useEffect, useMemo, useState } from 'react'
import { View, Text } from '@tarojs/components'
import { Button, NoticeBar } from '@nutui/nutui-react-taro'
import Taro, { useDidShow } from '@tarojs/taro'
import CrowdGauge from '../../components/CrowdGauge'
import WaitList from '../../components/WaitList'
import { tryFetchRealtimeFromApi } from '../../services/api'
import { getRealtime, saveRealtimeSnapshot } from '../../services/storage'
import type { RealtimeData } from '../../services/types'
import './index.scss'

function formatCapturedAt(data: RealtimeData) {
  if (!data.updated_at) {
    return `${data.date} ${String(data.hour).padStart(2, '0')}:${String(data.minute ?? 0).padStart(2, '0')}`
  }
  const d = new Date(data.updated_at)
  if (Number.isNaN(d.getTime())) return data.updated_at
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function parkStatusLabel(status: string) {
  return ({ OPERATING: '开放中', CLOSED: '已闭园', DOWN: '暂时关闭' } as Record<string, string>)[status] || status
}

export default function IndexPage() {
  const [data, setData] = useState<RealtimeData | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')

  const pull = async (manual = false) => {
    setSyncing(true)
    setSyncError('')
    const live = await tryFetchRealtimeFromApi()
    if (live) {
      setData(saveRealtimeSnapshot(live))
      if (manual) {
        Taro.showToast({
          title: live.stale ? '已同步，但采集快照较旧' : '已同步真实采集数据',
          icon: 'none',
        })
      }
    } else {
      setData((current) => current || getRealtime())
      setSyncError('暂时连不上数据服务，下面展示的是最近一次已保存快照。')
      if (manual) Taro.showToast({ title: '同步失败，已保留最近快照', icon: 'none' })
    }
    setSyncing(false)
  }

  useDidShow(() => {
    setData(getRealtime())
    void pull(false)
  })

  // ThemeParks live 数据建议最多每 5 分钟刷新一次。
  useEffect(() => {
    const id = setInterval(() => void pull(false), 300_000)
    return () => clearInterval(id)
  }, [])

  const weatherText = useMemo(() => {
    if (!data) return ''
    if (!data.weather) return '天气暂无'
    const rain = data.weather.precipitation_mm > 0 ? ` · 降雨 ${data.weather.precipitation_mm}mm` : ' · 无雨'
    return `${data.weather.temperature_c ?? '--'}°C${rain}`
  }, [data])

  if (!data) {
    return (
      <View className='page'>
        <Text className='muted'>再等我一小下，马上回来…！</Text>
      </View>
    )
  }

  return (
    <View className='page index-page'>
      <View className='hero'>
        <Text className='hero__title'>今日园区实况</Text>
        <Text className='hero__meta'>
          采集于 {formatCapturedAt(data)} · {weatherText}
        </Text>
        <Text className={`hero__live ${data.stale ? 'hero__live--stale' : ''}`}>
          {data.stale ? '离线/过期快照' : '真实采集'} · {data.snapshot_label || 'ThemeParks 数据'}
        </Text>
      </View>

      {syncError || data.stale ? (
        <View className='data-notice'>
          <Text className='data-notice__title'>{syncError ? '当前为离线状态' : '这不是此刻的实时数据'}</Text>
          <Text className='data-notice__body'>
            {syncError || `距采集约 ${data.freshness_minutes ?? '--'} 分钟，请同步后再据此安排行程。`}
          </Text>
        </View>
      ) : null}

      <NoticeBar
        content='人少不等于队短——预测和路线页可以一起看，心里更有谱'
        leftIcon={null}
        scrollable
        color='#3d5a80'
        style={{ background: 'rgba(201,149,108,0.18)' }}
      />

      <View className='card section'>
        <CrowdGauge
          value={data.crowd_index}
          subtitle={`在转的项目 ${data.operating_rides} · 均排大约 ${data.avg_wait_min} 分钟`}
        />
        <View className='tags'>
          {data.calendar.is_weekend ? <Text className='chip chip--hot'>周末</Text> : null}
          {!data.calendar.is_weekend && !data.calendar.is_holiday ? <Text className='chip'>工作日</Text> : null}
          {data.calendar.is_holiday ? <Text className='chip chip--warn'>节假日</Text> : null}
          {data.calendar.is_school_vacation ? <Text className='chip'>寒暑假</Text> : null}
          <Text className='chip chip--ok'>{parkStatusLabel(data.park_status)}</Text>
        </View>
        <Button
          type='primary'
          block
          className='refresh-btn'
          loading={syncing}
          disabled={syncing}
          onClick={() => void pull(true)}
        >
          {syncing ? '正在同步真实数据' : '同步真实数据'}
        </Button>
        <Text className='muted refresh-hint'>
          数据源：ThemeParks.wiki · 失败时只回退到已标注时间的快照
        </Text>
      </View>

      <View className='section'>
        <View className='section-title'>
          <Text className='section-title__main'>各项目排队速览</Text>
          <Text className='section-title__sub'>{data.stale ? '快照排队' : '实采排队'}</Text>
        </View>
        <View className='card'>
          <WaitList rides={data.rides} />
        </View>
      </View>
    </View>
  )
}
