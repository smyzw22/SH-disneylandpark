import { useMemo, useState } from 'react'
import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import LedgerPanel from '../../components/LedgerPanel'
import { tryFetchObservedHistoryFromApi } from '../../services/api'
import { getHistory, saveHistorySnapshot } from '../../services/storage'
import type { HistoryPoint } from '../../services/types'
import { weekdayLabel } from '../../utils/format'
import './index.scss'

type MyTab = 'ledger' | 'data'

export default function MyPage() {
  const [tab, setTab] = useState<MyTab>('ledger')
  const [list, setList] = useState<HistoryPoint[]>([])
  const [historySync, setHistorySync] = useState<'syncing' | 'live' | 'offline'>('syncing')

  useDidShow(() => {
    setList(getHistory())
    setHistorySync('syncing')
    void tryFetchObservedHistoryFromApi(60).then((rows) => {
      if (rows?.length) {
        setList(saveHistorySnapshot(rows))
        setHistorySync('live')
      } else {
        setHistorySync('offline')
      }
    })
  })

  const stats = useMemo(() => {
    if (!list.length) return { avgCrowd: 0, avgWait: 0 }
    const avg = (values: number[]) =>
      Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
    return {
      avgCrowd: avg(list.map((item) => item.crowd_index)),
      avgWait: avg(list.map((item) => item.avg_wait_min)),
    }
  }, [list])

  return (
    <View className='page my-page'>
      <View className='hero my-hero'>
        <Text className='hero__title'>我的乐园</Text>
        <Text className='my-hero__sub'>个人账本与数据档案，各自归位</Text>
      </View>

      <View className='my-tabs'>
        <View className={`my-tab ${tab === 'ledger' ? 'my-tab--on' : ''}`} onClick={() => setTab('ledger')}>账本</View>
        <View className={`my-tab ${tab === 'data' ? 'my-tab--on' : ''}`} onClick={() => setTab('data')}>数据档案</View>
      </View>

      {tab === 'ledger' ? <LedgerPanel /> : null}

      {tab === 'data' ? (
        <View className='data-archive'>
          <View className='data-truth'>
            <View className='data-truth__head'>
              <Text className='data-truth__title'>已验证实采 {list.length} 天</Text>
              <Text className={`data-truth__status data-truth__status--${historySync}`}>
                {historySync === 'live' ? '服务端已同步' : historySync === 'syncing' ? '同步中' : '离线档案'}
              </Text>
            </View>
            <Text className='data-truth__body'>
              {list.length
                ? `当前可核验范围：${list[0].date} 至 ${list[list.length - 1].date}。这里只陈列已保存的真实观测，不用预测值填补缺口。`
                : '还没有通过校验的历史快照。启动后端采集后，这里会自动累积。'}
            </Text>
          </View>

          <View className='archive-kpis'>
            <View className='archive-kpi'><Text>样本均人流</Text><Text>{stats.avgCrowd}</Text></View>
            <View className='archive-kpi'><Text>样本均排队</Text><Text>{stats.avgWait}′</Text></View>
          </View>

          <View className='archive-source card'>
            <Text className='archive-source__title'>数据口径</Text>
            <Text className='archive-source__line'>实时排队：ThemeParks.wiki live / history API</Text>
            <Text className='archive-source__line'>天气：Open-Meteo</Text>
            <Text className='archive-source__line'>自动采集：默认每 5 分钟；同小时保留最新观测</Text>
            <Text className='archive-source__line'>历史回填：无密钥约 7 天，免费密钥可到 30 天</Text>
            <Text className='archive-source__credit'>Powered by ThemeParks.wiki</Text>
          </View>

          <View className='section-title'><Text className='section-title__main'>实采日期</Text></View>
          {list.length ? list.slice().reverse().map((item) => (
            <View className='card archive-row' key={item.date}>
              <View>
                <Text className='archive-row__date'>{item.date} · {weekdayLabel(item.date)}</Text>
                <Text className='archive-row__kind'>真实观测日</Text>
              </View>
              <View className='archive-row__value'>
                <Text>{item.crowd_index}</Text>
                <Text>均排 {item.avg_wait_min}′</Text>
              </View>
            </View>
          )) : (
            <View className='card archive-empty'>采集服务启动后，真实日期会出现在这里。</View>
          )}
        </View>
      ) : null}
    </View>
  )
}
