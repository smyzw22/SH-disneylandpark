import { View, Text } from '@tarojs/components'
import { crowdLevel } from '../utils/format'
import './CrowdGauge.scss'

interface Props {
  value: number
  subtitle?: string
}

export default function CrowdGauge({ value, subtitle }: Props) {
  const level = crowdLevel(value)
  const deg = Math.min(180, Math.max(0, (value / 100) * 180))

  return (
    <View className='gauge'>
      <View className='gauge__arc'>
        <View className='gauge__track' />
        <View className='gauge__fill' style={{ transform: `rotate(${deg - 180}deg)` }} />
        <View className='gauge__center'>
          <Text className='gauge__value'>{value.toFixed(1)}</Text>
          <Text className='gauge__unit'>人流指数</Text>
          <Text className={`gauge__level gauge__level--${level.tone}`}>{level.label}</Text>
        </View>
      </View>
      {subtitle ? <Text className='gauge__sub'>{subtitle}</Text> : null}
    </View>
  )
}
