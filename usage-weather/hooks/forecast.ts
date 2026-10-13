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
