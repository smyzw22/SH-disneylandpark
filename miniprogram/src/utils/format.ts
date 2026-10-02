export function crowdLevel(index: number): { label: string; tone: 'ok' | 'mid' | 'hot' } {
  if (index < 35) return { label: '舒适', tone: 'ok' }
  if (index < 55) return { label: '适中', tone: 'mid' }
  return { label: '拥挤', tone: 'hot' }
}

export function weekdayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
}

export function shortDate(dateStr: string): string {
  const [, m, day] = dateStr.split('-')
  return `${Number(m)}/${Number(day)}`
}

export function formatTime(isoOrHm: string): string {
  if (isoOrHm.includes(' ')) return isoOrHm.split(' ')[1]
  return isoOrHm
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}
