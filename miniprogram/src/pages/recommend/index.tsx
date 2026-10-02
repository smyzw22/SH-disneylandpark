import { useEffect } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'

/** 旧「推荐」页已并入「预测」，自动跳转 */
export default function RecommendRedirect() {
  useEffect(() => {
    Taro.switchTab({ url: '/pages/forecast/index' })
  }, [])
  return (
    <View className='page'>
      <Text className='muted'>推荐功能已并入「预测」页，正在跳转…</Text>
    </View>
  )
}
