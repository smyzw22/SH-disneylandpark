import { View, Text } from '@tarojs/components'
import type { RideWait } from '../services/types'
import './WaitList.scss'

interface Props {
  rides: RideWait[]
}

const STATUS_LABEL: Record<string, string> = {
  OPERATING: '运营中',
  CLOSED: '已关闭',
  DOWN: '临时停运',
  REFURBISHMENT: '维护中',
}

export default function WaitList({ rides }: Props) {
  return (
    <View className='wait-list'>
      {rides.map((r, idx) => {
        const operating = r.status === 'OPERATING'
        const statusLabel = STATUS_LABEL[r.status] || r.status || '状态未知'
        return (
        <View className={`wait-item ${operating ? '' : 'wait-item--inactive'}`} key={r.ride_id || `${r.ride_name}-${idx}`}>
          <View className='wait-item__left'>
            <Text className='wait-item__rank'>{idx + 1}</Text>
            <View>
              <Text className='wait-item__name'>{r.ride_name}</Text>
              <View className='wait-item__meta'>
                {r.tier ? (
                  <Text className={`chip chip--${r.tier === 'hot' ? 'hot' : r.tier === 'cold' ? 'ok' : 'mid'}`}>
                    {r.tier === 'hot' ? '热门' : r.tier === 'cold' ? '冷门' : '中等'}
                  </Text>
                ) : null}
                <Text className='muted'>{statusLabel}</Text>
              </View>
            </View>
          </View>
          <View className='wait-item__right'>
            <Text className='wait-item__num'>{operating && r.wait_time_min != null ? r.wait_time_min : '--'}</Text>
            <Text className='wait-item__unit'>{operating ? '分钟' : statusLabel}</Text>
          </View>
        </View>
      )})}
    </View>
  )
}
