import type { RoutingDecision } from '../types'

export type ModelFamily = 'haiku' | 'sonnet' | 'opus'

/** USD per million tokens; a cache write is billed at 1.25x input (5-minute entry). */
type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }

export const PRICES: Record<ModelFamily, Price> = {
  opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  sonnet: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
}

export function familyOf(model: string | undefined): ModelFamily | null {
  const name = (model ?? '').toLowerCase()
  if (name.includes('opus')) return 'opus'
  if (name.includes('sonnet')) return 'sonnet'
  if (name.includes('haiku')) return 'haiku'
  return null
}

function priced(decision: RoutingDecision, price: Price): number {
  const total =
    (decision.inputTokens ?? 0) * price.input +
    (decision.outputTokens ?? 0) * price.output +
    (decision.cacheReadTokens ?? 0) * price.cacheRead +
    (decision.cacheCreationTokens ?? 0) * price.cacheWrite
  return total / 1_000_000
}

/** What the decision's tokens cost on the model that ran it; null when that model is unknown. */
export function costOf(decision: RoutingDecision): number | null {
  const family = familyOf(decision.actualModel)
  return family === null ? null : priced(decision, PRICES[family])
}

/** The same tokens billed as if everything had run on opus: what routing is measured against. */
export function opusCostOf(decision: RoutingDecision): number {
  return priced(decision, PRICES.opus)
}

export type Spend = {
  spent: number
  saved: number
  cacheHit: number | null
  cacheRead: number
  cacheWrite: number
  output: number
}

export function spendOf(list: readonly RoutingDecision[]): Spend {
  let spent = 0
  let baseline = 0
  let read = 0
  let fresh = 0
  let written = 0
  let output = 0
  for (const one of list) {
    const cost = costOf(one)
    if (cost === null) continue
    spent += cost
    baseline += opusCostOf(one)
    read += one.cacheReadTokens ?? 0
    fresh += (one.inputTokens ?? 0) + (one.cacheCreationTokens ?? 0)
    written += one.cacheCreationTokens ?? 0
    output += one.outputTokens ?? 0
  }
  const input = read + fresh
  return {
    spent,
    saved: Math.max(0, baseline - spent),
    cacheHit: input === 0 ? null : read / input,
    cacheRead: read,
    cacheWrite: written,
    output,
  }
}

export type Mix = Record<ModelFamily, number>

export function mixOf(list: readonly RoutingDecision[]): Mix {
  const mix: Mix = { haiku: 0, sonnet: 0, opus: 0 }
  for (const one of list) {
    const family = familyOf(one.actualModel)
    if (family !== null) mix[family] += 1
  }
  return mix
}

export function usd(value: number): string {
  if (value === 0) return '$0'
  if (value < 0.01) return '<$0.01'
  return value < 10 ? `$${value.toFixed(2)}` : `$${value.toFixed(1)}`
}

export function tokens(value: number): string {
  if (value < 1000) return String(value)
  return value < 1_000_000 ? `${(value / 1000).toFixed(1)}k` : `${(value / 1_000_000).toFixed(1)}M`
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** A bar drawn to an eighth of a cell, padded with a faint track to `cells`. */
export function smoothBar(fraction: number, cells: number): { fill: string; track: string } {
  const eighths = Math.round(Math.max(0, Math.min(1, fraction)) * cells * 8)
  const whole = Math.floor(eighths / 8)
  const part = EIGHTHS[eighths % 8] ?? ''
  const fill = '█'.repeat(whole) + part
  return { fill, track: '·'.repeat(cells - whole - (part === '' ? 0 : 1)) }
}

const SPARKS = '▁▂▃▄▅▆▇█'

export function sparkline(values: readonly number[]): string {
  if (values.length === 0) return ''
  const max = Math.max(...values)
  if (max <= 0) return '▁'.repeat(values.length)
  return values.map(value => SPARKS[Math.min(7, Math.floor((value / max) * 7.999))] ?? '▁').join('')
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const PULSE = ['◇', '◈', '◆', '◈']

export function spinnerFrame(now: number, frameMs: number): string {
  return SPINNER[Math.floor(now / frameMs) % SPINNER.length] ?? '⠋'
}

export function pulseFrame(now: number, frameMs: number): string {
  return PULSE[Math.floor(now / (frameMs * 2)) % PULSE.length] ?? '◆'
}

/** 0 → 1 over `durationMs` from `start`, eased out so the bar decelerates into place. */
export function easeIn(now: number, start: number, durationMs: number): number {
  const t = Math.max(0, Math.min(1, (now - start) / durationMs))
  return 1 - (1 - t) ** 3
}

/** Most subagents running at once during the run, from their start and end times. */
export function peakParallel(list: readonly RoutingDecision[], now: number): number {
  const edges: [number, number][] = []
  for (const one of list) {
    edges.push([one.at, 1])
    edges.push([one.durationMs === undefined ? (one.status === 'running' ? now : one.at) : one.at + one.durationMs, -1])
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let current = 0
  let peak = 0
  for (const [, delta] of edges) {
    current += delta
    peak = Math.max(peak, current)
  }
  return peak
}
