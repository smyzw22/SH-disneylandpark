import { useMemo, useState } from 'react'
import { Input, Picker, ScrollView, Text, View } from '@tarojs/components'
import { Button } from '@nutui/nutui-react-taro'
import Taro, { useDidShow } from '@tarojs/taro'
import { PASS_PRESETS, TICKET_PRESETS } from '../services/attractions'
import {
  addDays,
  addPassExpense,
  addTicketPurchase,
  calcPassStats,
  clearPassAccount,
  deletePassExpense,
  getCheckIns,
  getPassAccount,
  savePassAccount,
  todayStr,
} from '../services/storage'
import type { PassAccount, PassCardType } from '../services/types'
import './LedgerPanel.scss'

type EntryMode = 'expense' | 'ticket' | null

function emptyDraftPass(): PassAccount {
  const start = todayStr()
  return {
    cardType: 'pearl',
    passName: PASS_PRESETS[0].name,
    passCost: PASS_PRESETS[0].price,
    ticketFaceValue: PASS_PRESETS[0].ticketFace,
    startDate: start,
    endDate: addDays(start, PASS_PRESETS[0].days),
    ledger: [],
  }
}

function toast(title: string) {
  Taro.showToast({ title, icon: 'none', duration: Math.min(3200, 1200 + title.length * 40) })
}

export default function LedgerPanel() {
  const [pass, setPass] = useState<PassAccount>(() => getPassAccount())
  const [entryMode, setEntryMode] = useState<EntryMode>(null)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [entryDate, setEntryDate] = useState(todayStr())
  const [ticketKind, setTicketKind] = useState<(typeof TICKET_PRESETS)[number]['kind'] | 'other'>('day_ticket')
  const [showPassForm, setShowPassForm] = useState(false)
  const [draftPass, setDraftPass] = useState<PassAccount>(emptyDraftPass)

  useDidShow(() => setPass(getPassAccount()))

  const stats = useMemo(() => calcPassStats(pass, getCheckIns()), [pass])
  const liveDraftStats = useMemo(
    () => calcPassStats(showPassForm ? draftPass : pass, getCheckIns()),
    [showPassForm, draftPass, pass]
  )

  const openEntry = (mode: Exclude<EntryMode, null>) => {
    setEntryMode(mode)
    setTitle('')
    setAmount('')
    setEntryDate(todayStr())
    if (mode === 'ticket') setTicketKind('day_ticket')
  }

  const saveEntry = () => {
    const cleanTitle = title.trim()
    const value = Number(amount)
    if (!cleanTitle) {
      toast('先写清楚这笔花在了哪里')
      return
    }
    if (!Number.isFinite(value) || value <= 0) {
      toast('金额需要是大于 0 的数字')
      return
    }
    if (!entryDate) {
      toast('请选择消费日期')
      return
    }
    const next =
      entryMode === 'ticket'
        ? addTicketPurchase(ticketKind, cleanTitle, value, '', entryDate)
        : addPassExpense(cleanTitle, value, '', entryDate)
    setPass(next)
    setEntryMode(null)
    toast(entryMode === 'ticket' ? '票务已入账' : '园内消费已入账')
  }

  const applyPreset = (id: PassCardType) => {
    const preset = PASS_PRESETS.find((item) => item.id === id)
    if (!preset) return
    const start = draftPass.startDate || todayStr()
    setDraftPass({
      ...draftPass,
      cardType: id,
      passName: preset.name,
      passCost: preset.price,
      ticketFaceValue: preset.ticketFace,
      startDate: start,
      endDate: addDays(start, preset.days),
    })
  }

  const confirmPass = () => {
    const passCost = Number(draftPass.passCost)
    const faceValue = Number(draftPass.ticketFaceValue)
    if (!draftPass.passName.trim() || !Number.isFinite(passCost) || passCost <= 0) {
      toast('请填写有效的卡种和实付金额')
      return
    }
    if (!draftPass.startDate || !draftPass.endDate || draftPass.endDate < draftPass.startDate) {
      toast('请检查年卡有效期')
      return
    }
    const saved = savePassAccount({
      ...draftPass,
      passName: draftPass.passName.trim(),
      passCost,
      ticketFaceValue: Number.isFinite(faceValue) && faceValue > 0 ? faceValue : 499,
      ledger: pass.ledger.filter((item) => item.type !== 'annual_pass' && item.type !== 'pass_cost'),
    })
    setPass(saved)
    setShowPassForm(false)
    toast('年卡资料已保存')
  }

  return (
    <View className='ledger-panel'>
      <View className='ledger-overview'>
        <Text className='ledger-overview__label'>累计总支出</Text>
        <Text className='ledger-overview__value'>¥{stats.totalSpend.toFixed(2)}</Text>
        <View className='ledger-overview__split'>
          <View>
            <Text className='ledger-overview__split-label'>票务支出</Text>
            <Text className='ledger-overview__split-value'>¥{stats.ticketSpend.toFixed(2)}</Text>
          </View>
          <View>
            <Text className='ledger-overview__split-label'>园内消费</Text>
            <Text className='ledger-overview__split-value'>¥{stats.parkExpense.toFixed(2)}</Text>
          </View>
        </View>
      </View>

      <View className='ledger-actions'>
        <View className='ledger-action' onClick={() => openEntry('expense')}>
          <Text className='ledger-action__title'>记园内消费</Text>
          <Text className='ledger-action__desc'>餐饮、周边与其他开销</Text>
        </View>
        <View className='ledger-action' onClick={() => openEntry('ticket')}>
          <Text className='ledger-action__title'>记票务</Text>
          <Text className='ledger-action__desc'>门票、尊享卡与早享卡</Text>
        </View>
      </View>

      {entryMode ? (
        <View className='card ledger-form'>
          <View className='ledger-form__head'>
            <Text className='block-title'>{entryMode === 'ticket' ? '新增票务' : '新增园内消费'}</Text>
            <Text className='ledger-form__close' onClick={() => setEntryMode(null)}>取消</Text>
          </View>
          {entryMode === 'ticket' ? (
            <>
              <Text className='ledger-helper'>参考模板仅预填名称与金额，请以订单实付为准。</Text>
              <View className='ledger-pills'>
                {TICKET_PRESETS.map((preset) => (
                  <View
                    key={preset.id}
                    className={`ledger-pill ${title === preset.name ? 'ledger-pill--on' : ''}`}
                    onClick={() => {
                      setTicketKind(preset.kind)
                      setTitle(preset.name)
                      setAmount(String(preset.price))
                    }}
                  >
                    {preset.name.replace('乐园门票·', '')}
                  </View>
                ))}
              </View>
            </>
          ) : null}
          <Text className='ledger-label'>名称</Text>
          <Input
            className='ledger-input'
            placeholder={entryMode === 'ticket' ? '例如：一日票' : '例如：午餐或纪念品'}
            value={title}
            onInput={(event) => setTitle(event.detail.value)}
          />
          <Text className='ledger-label'>实付金额</Text>
          <Input
            className='ledger-input'
            type='digit'
            placeholder='0.00'
            value={amount}
            onInput={(event) => setAmount(event.detail.value)}
          />
          <Text className='ledger-label'>发生日期</Text>
          <Picker mode='date' value={entryDate} onChange={(event) => setEntryDate(String(event.detail.value))}>
            <View className='ledger-input'>{entryDate}</View>
          </Picker>
          <Button type='primary' block onClick={saveEntry}>确认入账</Button>
        </View>
      ) : null}

      <View className='section-title ledger-section-title'>
        <Text className='section-title__main'>年卡分析</Text>
        <Text
          className='ledger-section-title__action'
          onClick={() => {
            setDraftPass(stats.hasPass ? { ...pass } : emptyDraftPass())
            setShowPassForm(true)
          }}
        >
          {stats.hasPass ? '修改' : '添加'}
        </Text>
      </View>

      {stats.hasPass ? (
        <View className='card ledger-pass'>
          <Text className='ledger-pass__name'>{pass.passName}</Text>
          <View className='ledger-pass__row'><Text>已入园</Text><Text>{stats.visitDays} 天</Text></View>
          <View className='ledger-pass__row'><Text>按入园均摊</Text><Text>¥{stats.costPerVisit}</Text></View>
          <View className='ledger-pass__row'><Text>预计回本门槛</Text><Text>{stats.breakEvenVisits} 天</Text></View>
          <View className='ledger-progress'><View className='ledger-progress__bar' style={{ width: `${stats.progress}%` }} /></View>
          <Text className='ledger-helper'>按你填写的单日票面值估算，结果仅用于个人记账。</Text>
          <View
            className='ledger-pass__clear'
            onClick={async () => {
              const result = await Taro.showModal({
                title: '清空年卡资料？',
                content: '只移除年卡资料和年卡购入行，票务与园内消费流水会保留。',
                confirmText: '确认清空',
              })
              if (!result.confirm) return
              setPass(clearPassAccount())
              toast('年卡资料已清空，其他流水已保留')
            }}
          >
            清空年卡资料
          </View>
        </View>
      ) : (
        <View className='card ledger-empty'>
          <Text className='ledger-empty__title'>没有年卡也能完整记账</Text>
          <Text className='ledger-helper'>添加年卡后，才会额外出现均摊与回本进度；不会影响现有流水。</Text>
        </View>
      )}

      <View className='section-title ledger-section-title'>
        <Text className='section-title__main'>全部流水</Text>
        <Text className='muted'>{pass.ledger.length} 笔</Text>
      </View>
      {pass.ledger.length ? (
        pass.ledger.map((item) => (
          <View className='card ledger-row' key={item.id}>
            <View>
              <Text className='ledger-row__title'>{item.title}</Text>
              <Text className='ledger-row__meta'>{item.date} · {{
                annual_pass: '年卡', pass_cost: '年卡', day_ticket: '一日票', premier_access: '尊享卡',
                early_entry: '早享卡', park_expense: '园内', expense: '园内', other: '其他', ticket_value: '其他',
              }[item.type] || item.type}</Text>
            </View>
            <View className='ledger-row__right'>
              <Text className='ledger-row__amount'>¥{Math.abs(item.amount).toFixed(2)}</Text>
              {item.type !== 'annual_pass' && item.type !== 'pass_cost' ? (
                <Text
                  className='ledger-row__delete'
                  onClick={async () => {
                    const result = await Taro.showModal({
                      title: '删除这笔流水？',
                      content: `${item.title} · ¥${Math.abs(item.amount).toFixed(2)}，删除后无法恢复。`,
                      confirmText: '删除',
                    })
                    if (!result.confirm) return
                    setPass(deletePassExpense(item.id))
                    toast('这笔流水已删除')
                  }}
                >
                  删除
                </Text>
              ) : null}
            </View>
          </View>
        ))
      ) : (
        <View className='card ledger-empty'><Text className='ledger-helper'>还没有流水，从上方新增第一笔吧。</Text></View>
      )}

      {showPassForm ? (
        <View className='ledger-sheet'>
          <View className='ledger-sheet__backdrop' onClick={() => setShowPassForm(false)} />
          <View className='ledger-sheet__panel'>
            <ScrollView scrollY className='ledger-sheet__scroll'>
              <Text className='ledger-sheet__title'>年卡资料</Text>
              <Text className='ledger-helper'>卡价会调整，请核对你的实际订单，不把预设金额当作官方现价。</Text>
              <View className='ledger-pills'>
                {PASS_PRESETS.map((preset) => (
                  <View
                    key={preset.id}
                    className={`ledger-pill ${draftPass.cardType === preset.id ? 'ledger-pill--on' : ''}`}
                    onClick={() => applyPreset(preset.id)}
                  >{preset.name}</View>
                ))}
              </View>
              <Text className='ledger-label'>年卡实付金额</Text>
              <Input className='ledger-input' type='digit' value={String(draftPass.passCost || '')} onInput={(event) => setDraftPass({ ...draftPass, passCost: Number(event.detail.value) || 0, cardType: 'custom' })} />
              <Text className='ledger-label'>用于回本比较的单日票面</Text>
              <Input className='ledger-input' type='digit' value={String(draftPass.ticketFaceValue || '')} onInput={(event) => setDraftPass({ ...draftPass, ticketFaceValue: Number(event.detail.value) || 0 })} />
              <Text className='ledger-label'>有效期开始</Text>
              <Picker mode='date' value={draftPass.startDate || todayStr()} onChange={(event) => {
                const startDate = String(event.detail.value)
                const preset = PASS_PRESETS.find((item) => item.id === draftPass.cardType)
                setDraftPass({ ...draftPass, startDate, endDate: preset ? addDays(startDate, preset.days) : draftPass.endDate || addDays(startDate, 365) })
              }}><View className='ledger-input'>{draftPass.startDate || '选择日期'}</View></Picker>
              <Text className='ledger-label'>有效期结束</Text>
              <Picker mode='date' value={draftPass.endDate || todayStr()} onChange={(event) => setDraftPass({ ...draftPass, endDate: String(event.detail.value) })}><View className='ledger-input'>{draftPass.endDate || '选择日期'}</View></Picker>
              <View className='ledger-sheet__preview'>每天约摊 ¥{liveDraftStats.dailyAmortized} · 回本门槛约 {liveDraftStats.breakEvenVisits} 天</View>
              <View className='ledger-sheet__confirm' onClick={confirmPass}>保存年卡资料</View>
              <View className='ledger-sheet__cancel' onClick={() => setShowPassForm(false)}>取消</View>
            </ScrollView>
          </View>
        </View>
      ) : null}
    </View>
  )
}
