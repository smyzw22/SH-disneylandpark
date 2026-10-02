import { View, Text } from '@tarojs/components'
import type { RouteStep } from '../services/types'
import { formatTime } from '../utils/format'
import './RouteTimeline.scss'

interface Props {
  steps: RouteStep[]
}

export default function RouteTimeline({ steps }: Props) {
  return (
    <View className='timeline'>
      {steps.map((s, i) => (
        <View className='timeline__item' key={`${s.time}-${s.ride_name}-${i}`}>
          <View className='timeline__rail'>
            <View className={`timeline__dot timeline__dot--${s.tier}`} />
            {i < steps.length - 1 ? <View className='timeline__line' /> : null}
          </View>
          <View className='timeline__body'>
            <View className='timeline__head'>
              <Text className='timeline__time'>{formatTime(s.time)}</Text>
              <Text className={`chip chip--${s.tier === 'hot' ? 'hot' : s.tier === 'cold' ? 'ok' : 'mid'}`}>
                {s.tier === 'hot' ? '热门' : s.tier === 'cold' ? '冷门' : '中等'}
              </Text>
            </View>
            <Text className='timeline__ride'>{s.ride_name}</Text>
            <Text className='timeline__wait'>主推 · 预计排队 {s.predicted_wait_min} 分钟</Text>
            <Text className='timeline__reason'>{s.reason}</Text>
            {s.alternatives && s.alternatives.length > 0 ? (
              <View className='timeline__alts'>
                <Text className='timeline__alts-title'>还可选</Text>
                {s.alternatives.map((alt) => (
                  <View className='timeline__alt' key={alt.ride_name}>
                    <Text className='timeline__alt-name'>{alt.ride_name}</Text>
                    <Text className='timeline__alt-wait'>{alt.predicted_wait_min}′</Text>
                    <Text
                      className={`chip chip--${
                        alt.tier === 'hot' ? 'hot' : alt.tier === 'cold' ? 'ok' : 'mid'
                      }`}
                    >
                      {alt.tier === 'hot' ? '热' : alt.tier === 'cold' ? '冷' : '中'}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  )
}
