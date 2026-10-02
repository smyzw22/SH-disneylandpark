import { useMemo, useState } from 'react'
import { View, Text, Image, Map, Picker, ScrollView } from '@tarojs/components'
import { Button, TextArea } from '@nutui/nutui-react-taro'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  ATTRACTIONS,
  OFFICIAL_ATTRACTION_COUNT,
  PARK_CENTER,
  mapLocationFor,
} from '../../services/attractions'
import {
  addCheckIn,
  batchEntryCheckIns,
  deleteCheckIn,
  evaluateBadges,
  getCheckIns,
  seedLocalDataIfNeeded,
  todayStr,
  updateCheckIn,
} from '../../services/storage'
import type { AttractionSpot, CheckInRecord, CheckInType } from '../../services/types'
import './index.scss'

type Tab = 'today' | 'history' | 'summary' | 'map'
type SummaryDetail = 'days' | 'attraction' | 'show' | 'character'
type MapFilter = 'attraction' | 'show' | 'character' | 'all'

const MOODS = ['开心爆棚', '腿已经不是我的了', '下次还敢', '今天很幸运', '排队也很浪漫'] as const
const MAP_CATEGORY_COUNTS = {
  show: ATTRACTIONS.filter((item) => item.category === 'show').length,
  character: ATTRACTIONS.filter((item) => item.category === 'character').length,
}

function monthMatrix(year: number, month: number) {
  const first = new Date(year, month, 1)
  const startPad = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: Array<{ date: string; day: number; inMonth: boolean }> = []
  for (let i = 0; i < startPad; i++) cells.push({ date: '', day: 0, inMonth: false })
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ date, day: d, inMonth: true })
  }
  while (cells.length % 7 !== 0) cells.push({ date: '', day: 0, inMonth: false })
  return cells
}

function toast(title: string) {
  Taro.showToast({ title, icon: 'none', duration: Math.min(3200, 1200 + title.length * 40) })
}

export default function CheckinPage() {
  const isH5 = Taro.getEnv() === Taro.ENV_TYPE.WEB
  const [tab, setTab] = useState<Tab>('today')
  const [checkins, setCheckins] = useState<CheckInRecord[]>([])
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [calYear, setCalYear] = useState(() => new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth())

  const [selected, setSelected] = useState<AttractionSpot | null>(null)
  const [note, setNote] = useState('')
  const [mood, setMood] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [formDate, setFormDate] = useState(todayStr())
  const [formType, setFormType] = useState<CheckInType>('attraction')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<CheckInRecord | null>(null)

  const [celebrate, setCelebrate] = useState(false)
  const [newBadge, setNewBadge] = useState<string | null>(null)
  const [showEgg, setShowEgg] = useState(false)
  const [mapScale, setMapScale] = useState(16)
  const [mapHeight, setMapHeight] = useState(420)
  const [summaryDetail, setSummaryDetail] = useState<SummaryDetail | null>(null)
  const [mapFilter, setMapFilter] = useState<MapFilter>('attraction')

  const TAB_ITEMS = [
    ['today', '今日'],
    ['history', '日历'],
    ['summary', '图鉴'],
    ['map', '地图'],
  ] as const

  const switchTab = (k: Tab) => {
    // 仅切页时清遮罩；选图返回触发的 useDidShow 不应清表单
    setCelebrate(false)
    setShowEgg(false)
    setShowAdd(false)
    setEditing(null)
    setSummaryDetail(null)
    setTab(k)
  }

  const refresh = () => {
    seedLocalDataIfNeeded()
    setCheckins(getCheckIns())
  }

  useDidShow(refresh)

  // 地图高度随屏幕自适应，但上限卡住，避免原生层盖住页签
  useDidShow(() => {
    try {
      const sys = Taro.getSystemInfoSync()
      const h = Math.round(Math.min(520, Math.max(320, (sys.windowHeight || 640) * 0.42)))
      setMapHeight(h)
    } catch {
      setMapHeight(420)
    }
  })

  const stats = useMemo(() => ({
    visitDays: new Set(checkins.map((item) => item.visitDate)).size,
    byCat: {
      attraction: checkins.filter((item) => item.type === 'attraction').length,
      show: checkins.filter((item) => item.type === 'show').length,
      character: checkins.filter((item) => item.type === 'character').length,
    },
  }), [checkins])
  const badges = useMemo(() => evaluateBadges(checkins), [checkins])
  const checkedIds = useMemo(
    () => new Set(checkins.filter((c) => c.attractionId).map((c) => c.attractionId as string)),
    [checkins]
  )
  const datesWithCheckin = useMemo(() => new Set(checkins.map((c) => c.visitDate)), [checkins])
  const todayList = useMemo(() => checkins.filter((c) => c.visitDate === todayStr()), [checkins])
  const dateList = useMemo(
    () => checkins.filter((c) => c.visitDate === selectedDate),
    [checkins, selectedDate]
  )
  const cells = useMemo(() => monthMatrix(calYear, calMonth), [calYear, calMonth])
  const photoCount = useMemo(() => checkins.reduce((s, c) => s + (c.photos?.length || 0), 0), [checkins])
  const noteCount = useMemo(() => checkins.filter((c) => c.note?.trim()).length, [checkins])
  const visitDates = useMemo(
    () => [...new Set(checkins.map((c) => c.visitDate))].sort((a, b) => b.localeCompare(a)),
    [checkins]
  )
  const groupedSummary = useMemo(() => {
    const grouped: Partial<Record<SummaryDetail, Array<{ name: string; count: number; latest: string }>>> = {}
    ;(['attraction', 'show', 'character'] as const).forEach((kind) => {
      const bucket = new globalThis.Map<string, { name: string; count: number; latest: string }>()
      checkins
        .filter((c) => c.type === kind)
        .forEach((c) => {
          const key = c.attractionId || c.attractionName
          const old = bucket.get(key)
          bucket.set(key, {
            name: c.attractionName,
            count: (old?.count || 0) + 1,
            latest: old && old.latest > c.visitDate ? old.latest : c.visitDate,
          })
        })
      grouped[kind] = [...bucket.values()].sort((a, b) => b.latest.localeCompare(a.latest))
    })
    return grouped
  }, [checkins])
  const visibleSpots = useMemo(
    () => ATTRACTIONS.filter((a) => mapFilter === 'all' || a.category === mapFilter),
    [mapFilter]
  )

  const markers = useMemo(
    () =>
      visibleSpots.map((a) => {
        const location = mapLocationFor(a)
        return {
        id: ATTRACTIONS.findIndex((item) => item.id === a.id) + 1,
        latitude: location.latitude,
        longitude: location.longitude,
        iconPath: '/assets/tab-checkin-active.png',
        title: a.name,
        width: 28,
        height: 28,
        callout: {
          content: a.name,
          display: 'BYCLICK' as const,
          padding: 8,
          borderRadius: 8,
          fontSize: 12,
        },
        label: {
          content: a.name.length > 6 ? `${a.name.slice(0, 6)}…` : a.name,
          color: checkedIds.has(a.id) ? '#5a8f6a' : '#3d5a80',
          fontSize: 10,
          anchorX: 0,
          anchorY: -4,
          borderRadius: 4,
          bgColor: '#fdf8f1',
          padding: 2,
        },
      }}),
    [checkedIds, visibleSpots]
  )

  const afterSave = (next: CheckInRecord[], opts?: { egg?: boolean }) => {
    const before = evaluateBadges(checkins).filter((b) => b.unlocked).map((b) => b.id)
    setCheckins(next)
    const unlockedNow = evaluateBadges(next)
      .filter((b) => b.unlocked)
      .find((b) => !before.includes(b.id))
    if (opts?.egg) {
      setShowEgg(true)
      if (unlockedNow) setNewBadge(`${unlockedNow.emoji} ${unlockedNow.name}`)
    } else {
      setCelebrate(true)
      if (unlockedNow) setNewBadge(`${unlockedNow.emoji} ${unlockedNow.name}`)
      setTimeout(() => {
        setCelebrate(false)
        setNewBadge(null)
      }, 1600)
    }
    Taro.vibrateShort({ type: 'medium' }).catch(() => undefined)
  }

  const pickPhotos = async () => {
    try {
      const res = await Taro.chooseImage({
        count: Math.max(1, 6 - photos.length),
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      const durablePaths = await Promise.all(
        (res.tempFilePaths || []).map(async (tempFilePath) => {
          try {
            const saved = await Taro.saveFile({ tempFilePath })
            return saved.savedFilePath || tempFilePath
          } catch {
            // H5 没有本地文件沙盒，保留浏览器可用的临时 URL。
            return tempFilePath
          }
        })
      )
      setPhotos((current) => [...current, ...durablePaths].slice(0, 6))
    } catch {
      toast('好的，那我们先不拍~')
    }
  }

  const openAdd = (opts?: { date?: string; type?: CheckInType; spot?: AttractionSpot }) => {
    setSelected(opts?.spot || null)
    setFormDate(opts?.date || selectedDate || todayStr())
    setFormType(opts?.type || opts?.spot?.category || 'attraction')
    setNote('')
    setMood('')
    setPhotos([])
    setShowAdd(true)
  }

  const composedNote = () => {
    const parts = [mood, note.trim()].filter(Boolean)
    return parts.join(' · ')
  }

  const submitAdd = () => {
    if (formType !== 'entry' && !selected) {
      toast(`先选择要打卡的${typeLabel(formType)}`)
      return
    }
    if (!formDate) {
      toast('先选择打卡日期')
      return
    }
    const body = composedNote()
    const next = addCheckIn({
      type: formType,
      visitDate: formDate,
      attractionId: selected?.id,
      attractionName: selected?.name,
      note: body,
      photos,
    })
    setShowAdd(false)
    setSelected(null)
    // 写了日记或塞了照片 → 弹出「私人游记本」彩蛋页
    afterSave(next, { egg: !!(body || photos.length) })
  }

  const oneClickEntry = () => {
    const next = addCheckIn({
      type: 'entry',
      visitDate: todayStr(),
      attractionName: '跨过城堡门口啦',
      note: '今日正式入园',
      photos: [],
    })
    if (next.length === checkins.length) return
    afterSave(next)
  }

  const shiftMonth = (delta: number) => {
    let m = calMonth + delta
    let y = calYear
    if (m < 0) {
      m = 11
      y -= 1
    } else if (m > 11) {
      m = 0
      y += 1
    }
    setCalMonth(m)
    setCalYear(y)
  }

  const onMarkerTap = (e: any) => {
    const mid = Number(e.detail?.markerId)
    if (!mid) return
    const spot = ATTRACTIONS[mid - 1]
    if (spot) openAdd({ spot, date: todayStr(), type: spot.category })
  }

  const typeLabel = (t: CheckInType) =>
    ({ entry: '入园', attraction: '设施', show: '演出', character: '角色' }[t] || t)

  return (
    <View className='page checkin-page'>
      <View className='hero'>
        <Text className='hero__title'>今天，也值得被记下</Text>
        <Text className='hero__sub'>照片、心情、入园脚印——我帮你收好</Text>
      </View>

      <View className='tabs'>
        {TAB_ITEMS.map(([k, label]) => (
          <View
            key={k}
            className={`tabs__item ${tab === k ? 'tabs__item--on' : ''}`}
            hoverClass='tabs__item--hover'
            onClick={() => switchTab(k)}
          >
            {label}
          </View>
        ))}
      </View>

      {tab === 'today' ? (
        <View className='section'>
          <View className='card day-head'>
            <Text className='day-head__date'>
              {todayStr().replace(/(\d+)-(\d+)-(\d+)/, '$1年$2月$3日')}
            </Text>
            <Text className='muted'>
              {todayList.length === 0
                ? '还是空白页，随时可以写第一笔'
                : `今天已写下 ${todayList.length} 段小故事`}
            </Text>
          </View>

          <View className='card card--soft tip-box'>
            <Text className='tip-box__title'>小提示</Text>
            <Text className='tip-box__body'>
              点开任意一条，就能补照片和心情。腿酸也没关系——日记可以很短，快乐可以很长。
            </Text>
          </View>

          {todayList.length === 0 ? (
            <View className='card empty-card'>
              <Text className='empty-card__text'>城堡还在等你踮脚。先点「我进园啦」，再慢慢填项目~</Text>
            </View>
          ) : (
            todayList.map((c) => (
              <View
                className='card diary'
                key={c.id}
                onClick={() => {
                  setEditing(c)
                  setNote(c.note)
                  setPhotos(c.photos || [])
                  setMood('')
                }}
              >
                <View className='diary__top'>
                  <Text className='diary__title'>{c.attractionName}</Text>
                  <Text className='chip'>{typeLabel(c.type)}</Text>
                </View>
                {c.photos?.length ? (
                  <View className='photo-row'>
                    {c.photos.map((p) => (
                      <Image key={p} src={p} className='photo-row__img' mode='aspectFill' />
                    ))}
                  </View>
                ) : (
                  <Text className='diary__hint'>还没有照片 · 点我补一张微相册</Text>
                )}
                <Text className='diary__note'>{c.note || '写一句给未来的自己…'}</Text>
              </View>
            ))
          )}

          <View className='action-stack'>
            <Button type='primary' block onClick={() => openAdd({ date: todayStr() })}>
              记下这一站
            </Button>
            <Button fill='outline' block onClick={oneClickEntry}>
              我进园啦
            </Button>
          </View>
        </View>
      ) : null}

      {tab === 'history' ? (
        <View className='section'>
          <View className='card cal'>
            <View className='cal__nav'>
              <Text className='cal__nav-btn' onClick={() => shiftMonth(-1)}>
                ‹
              </Text>
              <Text className='cal__title'>
                {calYear}年{calMonth + 1}月
              </Text>
              <Text className='cal__nav-btn' onClick={() => shiftMonth(1)}>
                ›
              </Text>
            </View>
            <View className='cal__week'>
              {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
                <Text key={w} className='cal__weekday'>
                  {w}
                </Text>
              ))}
            </View>
            <View className='cal__grid'>
              {cells.map((c, idx) => (
                <View
                  key={`${c.date}-${idx}`}
                  className={`cal__cell ${!c.inMonth ? 'cal__cell--empty' : ''} ${
                    c.date === selectedDate ? 'cal__cell--on' : ''
                  } ${datesWithCheckin.has(c.date) ? 'cal__cell--dot' : ''}`}
                  onClick={() => {
                    if (c.date) setSelectedDate(c.date)
                  }}
                >
                  {c.inMonth ? <Text>{c.day}</Text> : null}
                </View>
              ))}
            </View>
          </View>

          <View className='card day-head'>
            <Text className='day-head__date'>
              {selectedDate.replace(/(\d+)-(\d+)-(\d+)/, '$1年$2月$3日')}
            </Text>
            <Text className='muted'>点日期翻旧账 · 有绿点的日子有故事</Text>
          </View>

          {dateList.length === 0 ? (
            <View className='card empty-card'>
              <Text className='empty-card__text'>这一天还空着。是忘了记，还是在攒大招？</Text>
            </View>
          ) : (
            dateList.map((c) => (
              <View
                className='card diary'
                key={c.id}
                onClick={() => {
                  setEditing(c)
                  setNote(c.note)
                  setPhotos(c.photos || [])
                }}
              >
                <View className='diary__top'>
                  <Text className='diary__title'>{c.attractionName}</Text>
                  <Text className='chip'>{typeLabel(c.type)}</Text>
                </View>
                {c.photos?.length ? (
                  <View className='photo-row'>
                    {c.photos.map((p) => (
                      <Image key={p} src={p} className='photo-row__img' mode='aspectFill' />
                    ))}
                  </View>
                ) : null}
                <Text className='diary__note'>{c.note || '点我补日记或照片'}</Text>
              </View>
            ))
          )}

          <View className='action-row'>
            <Button type='primary' onClick={() => openAdd({ date: selectedDate })}>
              补记这一天
            </Button>
            <Button
              fill='outline'
              onClick={() => {
                const next = batchEntryCheckIns([selectedDate])
                if (next.length === checkins.length) {
                  toast('这天已经盖过入园章啦')
                  return
                }
                setCheckins(next)
                toast('入园印章盖好啦')
              }}
            >
              补盖入园章
            </Button>
          </View>
        </View>
      ) : null}

      {tab === 'summary' ? (
        <View className='section'>
          <View className='card overview'>
            <Text className='block-title'>游玩图鉴</Text>
            <Text className='muted overview__lead'>数字会变，快乐账本不会说谎</Text>
            <View className='overview__grid'>
              <View
                className='overview__item overview__item--tap'
                hoverClass='overview__item--pressed'
                onClick={() => setSummaryDetail('days')}
              >
                <Text className='muted'>入园天数</Text>
                <Text className='overview__num'>{stats.visitDays}</Text>
                <Text className='overview__link'>查看日期 ›</Text>
              </View>
              <View
                className='overview__item overview__item--tap'
                hoverClass='overview__item--pressed'
                onClick={() => setSummaryDetail('attraction')}
              >
                <Text className='muted'>设施打卡</Text>
                <Text className='overview__num'>{stats.byCat.attraction}</Text>
                <Text className='overview__link'>查看项目 ›</Text>
              </View>
              <View
                className='overview__item overview__item--tap'
                hoverClass='overview__item--pressed'
                onClick={() => setSummaryDetail('show')}
              >
                <Text className='muted'>看过演出</Text>
                <Text className='overview__num'>{stats.byCat.show}</Text>
                <Text className='overview__link'>查看演出 ›</Text>
              </View>
              <View
                className='overview__item overview__item--tap'
                hoverClass='overview__item--pressed'
                onClick={() => setSummaryDetail('character')}
              >
                <Text className='muted'>遇见角色</Text>
                <Text className='overview__num'>{stats.byCat.character}</Text>
                <Text className='overview__link'>查看角色 ›</Text>
              </View>
            </View>
          </View>

          <View className='viz-row'>
            <View className='viz-pill'>
              <Text className='viz-pill__n'>{photoCount}</Text>
              <Text className='viz-pill__l'>张微相册</Text>
            </View>
            <View className='viz-pill'>
              <Text className='viz-pill__n'>{noteCount}</Text>
              <Text className='viz-pill__l'>段微日记</Text>
            </View>
            <View className='viz-pill'>
              <Text className='viz-pill__n'>{badges.filter((b) => b.unlocked).length}</Text>
              <Text className='viz-pill__l'>枚徽章</Text>
            </View>
          </View>

          <View className='cat-card cat-card--green' onClick={() => setSummaryDetail('attraction')}>
            <Text className='cat-card__title'>游乐设施</Text>
            <Text className='cat-card__sub'>去过 {groupedSummary.attraction?.length || 0} 项 · 共打卡 {stats.byCat.attraction} 次 ›</Text>
          </View>
          <View className='cat-card cat-card--blue' onClick={() => setSummaryDetail('show')}>
            <Text className='cat-card__title'>娱乐表演</Text>
            <Text className='cat-card__sub'>看过 {groupedSummary.show?.length || 0} 场 · 共记录 {stats.byCat.show} 次 ›</Text>
          </View>
          <View className='cat-card cat-card--sand' onClick={() => setSummaryDetail('character')}>
            <Text className='cat-card__title'>角色见面</Text>
            <Text className='cat-card__sub'>遇见 {groupedSummary.character?.length || 0} 位 · 共记录 {stats.byCat.character} 次 ›</Text>
          </View>

          <View className='section-title'>
            <Text className='section-title__main'>小小徽章墙</Text>
          </View>
          <View className='badge-grid'>
            {badges.map((b) => (
              <View key={b.id} className={`badge ${b.unlocked ? 'badge--on' : 'badge--off'}`}>
                <Text className='badge__emoji'>{b.emoji}</Text>
                <Text className='badge__name'>{b.name}</Text>
                <Text className='badge__desc'>{b.desc}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {tab === 'map' ? (
        <View className='section map-section'>
          <View className='card map-summary'>
            <View>
              <Text className='block-title'>园区项目地图</Text>
              <Text className='muted'>
                设施 {OFFICIAL_ATTRACTION_COUNT}/{OFFICIAL_ATTRACTION_COUNT} · 演出 {MAP_CATEGORY_COUNTS.show} · 角色 {MAP_CATEGORY_COUNTS.character}
              </Text>
            </View>
            <Text className='chip'>{visibleSpots.length} 个标记</Text>
          </View>
          <View className='map-filters'>
            {(
              [
                ['attraction', '设施'],
                ['show', '演出'],
                ['character', '角色'],
                ['all', '全部'],
              ] as const
            ).map(([key, label]) => (
              <View
                key={key}
                className={`pill ${mapFilter === key ? 'pill--on' : ''}`}
                onClick={() => setMapFilter(key)}
              >
                {label}
              </View>
            ))}
          </View>
          <View className='map-wrap' style={{ height: `${mapHeight}px` }}>
            {isH5 ? (
              <View className='map-h5-placeholder' style={{ height: `${mapHeight}px` }}>
                <Text className='map-h5-placeholder__title'>地图预览请在微信小程序中打开</Text>
                <Text className='map-h5-placeholder__body'>H5 版保留完整项目清单和筛选；微信版会按当前筛选显示对应坐标标记。</Text>
              </View>
            ) : (
              <Map
                id='parkMap'
                style={{ width: '100%', height: `${mapHeight}px` }}
                longitude={PARK_CENTER.longitude}
                latitude={PARK_CENTER.latitude}
                scale={mapScale}
                minScale={14}
                maxScale={18}
                enableZoom
                enableScroll
                showLocation={false}
                markers={markers}
                onMarkerTap={onMarkerTap}
                onCalloutTap={onMarkerTap}
              />
            )}
          </View>
          <View className='zoom-bar card'>
            <View className='zoom-bar__hit' onClick={() => setMapScale((s) => Math.max(14, s - 1))}>
              缩小
            </View>
            <Text className='zoom-bar__val'>缩放 {mapScale}</Text>
            <View className='zoom-bar__hit zoom-bar__hit--on' onClick={() => setMapScale((s) => Math.min(18, s + 1))}>
              放大
            </View>
          </View>
          <View className='spot-list'>
            {visibleSpots.map((a) => (
              <View
                key={a.id}
                className={`card spot-row ${checkedIds.has(a.id) ? 'spot-row--done' : ''}`}
                onClick={() => openAdd({ spot: a, date: todayStr(), type: a.category })}
              >
                <View>
                  <Text className='spot-row__name'>{a.name}</Text>
                  <Text className='muted'>
                    {a.land} · {a.thrill}
                  </Text>
                </View>
                <Text className='chip'>{checkedIds.has(a.id) ? '来过' : '去记'}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {summaryDetail ? (
        <View className='sheet-mask'>
          <View className='sheet-mask__bg' onClick={() => setSummaryDetail(null)} />
          <View className='sheet-panel sheet-panel--detail'>
            <ScrollView scrollY className='sheet-scroll'>
              <View className='detail-head'>
                <View>
                  <Text className='sheet__name'>
                    {{
                      days: '我的入园日',
                      attraction: '设施打卡清单',
                      show: '看过的演出',
                      character: '遇见的角色',
                    }[summaryDetail]}
                  </Text>
                  <Text className='muted'>每一项都来自你的本机打卡记录</Text>
                </View>
                <View className='detail-head__close' onClick={() => setSummaryDetail(null)}>关闭</View>
              </View>

              {summaryDetail === 'days' ? (
                visitDates.length ? (
                  visitDates.map((date, index) => {
                    const records = checkins.filter((c) => c.visitDate === date)
                    return (
                      <View className='detail-row' key={date} onClick={() => {
                        setSelectedDate(date)
                        const d = new Date(`${date}T12:00:00`)
                        setCalYear(d.getFullYear())
                        setCalMonth(d.getMonth())
                        setSummaryDetail(null)
                        setTab('history')
                      }}>
                        <View>
                          <Text className='detail-row__name'>{date.replace(/(\d+)-(\d+)-(\d+)/, '$1年$2月$3日')}</Text>
                          <Text className='muted'>留下 {records.length} 条记录</Text>
                        </View>
                        <Text className='detail-row__meta'>第 {visitDates.length - index} 次 ›</Text>
                      </View>
                    )
                  })
                ) : (
                  <View className='detail-empty'>还没有入园日。先去「今日」盖下第一枚章吧。</View>
                )
              ) : (groupedSummary[summaryDetail] || []).length ? (
                (groupedSummary[summaryDetail] || []).map((item) => (
                  <View className='detail-row' key={item.name}>
                    <View>
                      <Text className='detail-row__name'>{item.name}</Text>
                      <Text className='muted'>最近一次 {item.latest}</Text>
                    </View>
                    <Text className='detail-row__meta'>打卡 {item.count} 次</Text>
                  </View>
                ))
              ) : (
                <View className='detail-empty'>这里还空着。去地图挑一个项目，写下第一笔吧。</View>
              )}
            </ScrollView>
          </View>
        </View>
      ) : null}

      {/* 自建底部面板，不用 NutUI Popup 遮罩（遮罩残留会导致全页点不动） */}
      {showAdd ? (
        <View className='sheet-mask'>
          <View className='sheet-mask__bg' onClick={() => setShowAdd(false)} />
          <View className='sheet-panel'>
            <ScrollView scrollY className='sheet-scroll'>
              <Text className='sheet__name'>{selected ? selected.name : '这一站叫什么'}</Text>
              {!selected ? (
                <View className='type-pills'>
                  {(
                    [
                      ['attraction', '设施'],
                      ['show', '演出'],
                      ['character', '角色'],
                      ['entry', '入园'],
                    ] as const
                  ).map(([k, label]) => (
                    <View
                      key={k}
                      className={`pill ${formType === k ? 'pill--on' : ''}`}
                      onClick={() => setFormType(k)}
                    >
                      {label}
                    </View>
                  ))}
                </View>
              ) : null}
              {!selected && formType !== 'entry' ? (
                <View className='spot-pick'>
                  {ATTRACTIONS.filter((a) => a.category === formType).map((a) => (
                    <View key={a.id} className='pill' onClick={() => setSelected(a)}>
                      {a.name}
                    </View>
                  ))}
                </View>
              ) : null}
              <Text className='field-label'>是哪一天的故事</Text>
              <Picker mode='date' value={formDate} onChange={(e) => setFormDate(String(e.detail.value))}>
                <View className='input picker-val'>{formDate}</View>
              </Picker>
              <Text className='field-label'>此刻心情（可选）</Text>
              <View className='type-pills'>
                {MOODS.map((m) => (
                  <View
                    key={m}
                    className={`pill ${mood === m ? 'pill--on' : ''}`}
                    onClick={() => setMood(mood === m ? '' : m)}
                  >
                    {m}
                  </View>
                ))}
              </View>
              {photos.length ? (
                <View className='photo-row'>
                  {photos.map((p) => (
                    <Image key={p} src={p} className='photo-row__img' mode='aspectFill' />
                  ))}
                </View>
              ) : null}
              <View className='sheet-hit' onClick={pickPhotos}>
                {photos.length ? '再塞几张进相册' : '打开微相册'}
              </View>
              <TextArea
                placeholder='写一句微日记，给以后的自己留个彩蛋'
                value={note}
                onChange={(v) => setNote(String(v))}
                maxLength={200}
              />
              <View className='sheet-hit sheet-hit--primary' onClick={submitAdd}>
                收进游记本
              </View>
              <View className='sheet-hit' onClick={() => setShowAdd(false)}>
                先算了
              </View>
            </ScrollView>
          </View>
        </View>
      ) : null}

      {editing ? (
        <View className='sheet-mask'>
          <View className='sheet-mask__bg' onClick={() => setEditing(null)} />
          <View className='sheet-panel'>
            <Text className='sheet__name'>{editing.attractionName}</Text>
            {photos.length ? (
              <View className='photo-row'>
                {photos.map((p) => (
                  <Image key={p} src={p} className='photo-row__img' mode='aspectFill' />
                ))}
              </View>
            ) : null}
            <View className='sheet-hit' onClick={pickPhotos}>
              补照片
            </View>
            <TextArea value={note} onChange={(v) => setNote(String(v))} maxLength={200} />
            <View
              className='sheet-hit sheet-hit--primary'
              onClick={() => {
                const hasStory = !!(note.trim() || photos.length)
                setCheckins(updateCheckIn(editing.id, { note, photos }))
                setEditing(null)
                if (hasStory) setShowEgg(true)
                else toast('我记住了，你可以放心退出咯~')
              }}
            >
              存好这份心情
            </View>
            <View
              className='sheet-hit'
              onClick={async () => {
                const result = await Taro.showModal({
                  title: '不保留这条记录？',
                  content: `将删除「${editing.attractionName}」以及其中的日记和照片。`,
                  confirmText: '确认删除',
                })
                if (!result.confirm) return
                setCheckins(deleteCheckIn(editing.id))
                setEditing(null)
                toast('这条先翻过去啦')
              }}
            >
              不想留了
            </View>
          </View>
        </View>
      ) : null}

      {celebrate ? (
        <View
          className='celebrate'
          onClick={() => {
            setCelebrate(false)
            setNewBadge(null)
          }}
        >
          <View className='celebrate__burst' />
          <Text className='celebrate__text'>记下啦！</Text>
          {newBadge ? <Text className='celebrate__sub'>徽章亮了 {newBadge}</Text> : null}
          <Text className='celebrate__tip'>点一下继续</Text>
        </View>
      ) : null}

      {showEgg ? (
        <View className='egg'>
          <View
            className='egg__bg'
            onClick={() => {
              setShowEgg(false)
              setNewBadge(null)
            }}
          />
          <View className='egg__card'>
            <Text className='egg__spark'>✦</Text>
            <Text className='egg__title'>私人游记本</Text>
            <Text className='egg__line'>只存在你手机里</Text>
            <Text className='egg__body'>
              这一页刚刚被你写亮了。没有云端围观，没有广告插队——故事安安静静地住在这里，等你下次翻开。
            </Text>
            {newBadge ? <Text className='egg__badge'>还顺手亮了徽章：{newBadge}</Text> : null}
            <View
              className='sheet-hit sheet-hit--primary'
              onClick={() => {
                setShowEgg(false)
                setNewBadge(null)
                toast('我记住了，你可以放心退出咯~')
              }}
            >
              好，收进口袋
            </View>
            <View
              className='egg__skip'
              onClick={() => {
                setShowEgg(false)
                setNewBadge(null)
              }}
            >
              先看看别的
            </View>
          </View>
        </View>
      ) : null}
    </View>
  )
}
