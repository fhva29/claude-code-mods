import type { UsageWeatherLimit, UsageWeatherReading } from '../types'

export type Forecast = { glyph: string; label: string; color: string }

const BARS = '▁▂▃▄▅▆▇█'

export function forecastFor(percent: number): Forecast {
  if (percent < 25) return { glyph: '☀', label: 'Clear', color: 'success' }
  if (percent < 50) return { glyph: '☁', label: 'Cloudy', color: 'suggestion' }
  if (percent < 75) return { glyph: '☂', label: 'Showers', color: 'warning' }
  if (percent < 90) return { glyph: '☇', label: 'Storm', color: 'error' }
  return { glyph: '↯', label: 'Compact soon', color: 'error' }
}

export function sparkline(readings: readonly UsageWeatherReading[], width: number): string {
  return readings
    .slice(-width)
    .map(r => BARS[Math.min(BARS.length - 1, Math.floor((r.percent / 100) * BARS.length))])
    .join('')
}

export function meter(percent: number, width: number): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

export function limitColor(percent: number): string {
  if (percent >= 90) return 'error'
  if (percent >= 70) return 'warning'
  return 'success'
}

export function limitLabel(limit: UsageWeatherLimit): string {
  if (limit.kind === 'five_hour') return '5h'
  if (limit.kind === 'seven_day') return '7d'
  return limit.kind.replace(/_/g, ' ')
}

export function compactTokens(tokens: number): string {
  const trim = (value: string): string => value.replace(/\.0$/, '')
  if (tokens >= 1_000_000) return `${trim((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 1_000) return `${trim((tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1))}k`
  return String(tokens)
}

export function signedTokens(delta: number): string {
  return `${delta >= 0 ? '+' : '−'}${compactTokens(Math.abs(delta))}`
}

export function shortModel(model: string): string {
  const match = /claude-(\w+)-(\d+)-(\d+)/.exec(model)
  if (match === null) return model
  const [, family = '', major, minor] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`
}

// SVG is drawn isolated from the page theme, so the desktop band maps theme keys to fixed hues
// that read on both light and dark backgrounds.
const HEX: Record<string, string> = {
  success: '#3fb67a',
  suggestion: '#5b8def',
  warning: '#e0a030',
  error: '#e5534b',
}
const TRACK = 'rgba(128,128,128,0.25)'

export function hexFor(color: string): string {
  return HEX[color] ?? '#d97757'
}

export function meterSvg(percent: number, color: string, width = 96, height = 8): string {
  const clamped = Math.min(100, Math.max(0, percent))
  const filled = Math.max(clamped > 0 ? height : 0, Math.round((clamped / 100) * width))
  const r = height / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${r}" fill="${TRACK}"/>` +
    `<rect width="${filled}" height="${height}" rx="${r}" fill="${hexFor(color)}"/>` +
    '</svg>'
  )
}

export function sparklineSvg(
  readings: readonly UsageWeatherReading[],
  color: string,
  width = 72,
  height = 18,
): string {
  const values = readings.map(r => Math.min(100, Math.max(0, r.percent)))
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const pad = 1.5
  // Scaled to the readings' own range, so a session sitting at a few percent still shows its shape;
  // a near-flat run keeps a minimum span and sits in the middle.
  const hi = Math.max(...values)
  const span = Math.max(hi - Math.min(...values), 5)
  const lo = (hi + Math.min(...values)) / 2 - span / 2
  const points = values.map((v, i) => {
    const x = (i * step).toFixed(1)
    const y = (pad + (1 - (v - lo) / span) * (height - pad * 2)).toFixed(1)
    return `${x},${y}`
  })
  const stroke = hexFor(color)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<polygon points="0,${height} ${points.join(' ')} ${width},${height}" fill="${stroke}" fill-opacity="0.18"/>` +
    `<polyline points="${points.join(' ')}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` +
    '</svg>'
  )
}
