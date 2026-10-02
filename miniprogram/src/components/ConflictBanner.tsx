import { View, Text } from '@tarojs/components'
import './ConflictBanner.scss'

interface Props {
  note?: string | null
}

export default function ConflictBanner({ note }: Props) {
  if (!note) return null
  return (
    <View className='conflict'>
      <Text className='conflict__text'>{note}</Text>
    </View>
  )
}
