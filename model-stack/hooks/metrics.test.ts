import { describe, expect, test } from 'claude-code/testing'

import {
  costOf,
  easeIn,
  mixOf,
  peakParallel,
  smoothBar,
  sparkline,
  spendOf,
  usd,
} from './metrics'
import type { RoutingDecision } from '../types'

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1e6) / 1e6
}

function decision(change: Partial<RoutingDecision>): RoutingDecision {
  return {
    id: 'x',
    at: 0,
    scope: 'subagent',
    runId: 'r',
    description: 'task',
    subagentType: 'general-purpose',
    requestedModel: null,
    tier: null,
    probabilities: {},
    confidence: null,
    verdict: 'firm',
    mode: 'route',
    applied: 'sonnet · medium',
    status: 'done',
    ...change,
  }
}

describe('cost', () => {
  test('prices every token kind at the model that ran', () => {
    const one = decision({
      actualModel: 'claude-sonnet-5-5',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    })
    expect(round(costOf(one))).toBe(round(2 + 10 + 0.2 + 2.5))
  })

  test('an unknown model has no cost', () => {
    expect(costOf(decision({ actualModel: undefined, outputTokens: 10 }))).toBeNull()
  })

  test('savings are measured against the same tokens on opus', () => {
    const spend = spendOf([decision({ actualModel: 'haiku', outputTokens: 1_000_000 })])
    expect(round(spend.spent)).toBe(round(0.5))
    expect(round(spend.saved)).toBe(round(19.5))
  })

  test('cache hit is the read share of all input', () => {
    const spend = spendOf([
      decision({ actualModel: 'opus', inputTokens: 100, cacheCreationTokens: 100, cacheReadTokens: 800 }),
    ])
    expect(round(spend.cacheHit)).toBe(round(0.8))
  })

  test('no input leaves the cache hit unknown', () => {
    expect(spendOf([]).cacheHit).toBeNull()
  })
})

describe('formatting', () => {
  test('usd rounds small amounts', () => {
    expect(usd(0)).toBe('$0')
    expect(usd(0.004)).toBe('<$0.01')
    expect(usd(1.234)).toBe('$1.23')
  })

  test('smoothBar fills to an eighth of a cell and keeps the width', () => {
    const half = smoothBar(0.5, 10)
    expect(half.fill).toBe('█████')
    expect(half.fill.length + half.track.length).toBe(10)
    const partial = smoothBar(0.0625, 2)
    expect(partial).toEqual({ fill: '▏', track: '·' })
    expect(smoothBar(1, 4).track).toBe('')
  })

  test('sparkline scales to the largest value', () => {
    expect(sparkline([0, 1])).toBe('▁█')
    expect(sparkline([])).toBe('')
  })

  test('easeIn runs 0 to 1 and clamps', () => {
    expect(easeIn(0, 0, 100)).toBe(0)
    expect(easeIn(100, 0, 100)).toBe(1)
    expect(easeIn(500, 0, 100)).toBe(1)
  })
})

describe('session shape', () => {
  test('mix counts decisions per family', () => {
    const mix = mixOf([decision({ actualModel: 'opus' }), decision({ actualModel: 'claude-haiku-5-5' })])
    expect(mix).toEqual({ haiku: 1, sonnet: 0, opus: 1 })
  })

  test('peak parallel counts overlapping runs', () => {
    const list = [
      decision({ at: 0, durationMs: 100 }),
      decision({ at: 50, durationMs: 100 }),
      decision({ at: 200, status: 'running' }),
    ]
    expect(peakParallel(list, 300)).toBe(2)
  })
})
