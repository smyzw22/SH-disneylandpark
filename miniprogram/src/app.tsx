import { PropsWithChildren } from 'react'
import Taro, { useLaunch } from '@tarojs/taro'
import { clearPassAccount, forceReseedFromScraper, seedLocalDataIfNeeded } from './services/storage'
import './app.scss'

const DATA_VER = 'scraper_v5'

function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    const ver = Taro.getStorageSync('sdl_data_ver')
    if (ver !== DATA_VER) {
      forceReseedFromScraper()
      // 清除旧版默认年卡脏数据，强制按真实信息重填
      clearPassAccount()
      try {
        Taro.removeStorageSync('sdl_pass_account')
      } catch {
        /* ignore */
      }
      Taro.setStorageSync('sdl_data_ver', DATA_VER)
    } else {
      seedLocalDataIfNeeded()
    }
  })

  return children
}

export default App
