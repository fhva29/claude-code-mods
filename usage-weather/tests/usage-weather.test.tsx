import { describe, expect, test } from 'claude-code/testing'

import { forecastFor, meter, shortModel, sparkline } from '../hooks/forecast'

describe('forecast', () => {
  test('weather follows the fill', async () => {
    expect(forecastFor(10).label).toBe('Clear')
    expect(forecastFor(60).label).toBe('Showers')
    expect(forecastFor(95).label).toBe('Compact soon')
  })

  test('meter and sparkline draw fixed widths', async () => {
    expect(meter(50, 10)).toBe('▰▰▰▰▰▱▱▱▱▱')
    expect(sparkline([0, 50, 100].map(percent => ({ percent, tokens: 0, window: 1 })), 3)).toBe('▁▅█')
  })

  test('model ids shorten', async () => {
    expect(shortModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(shortModel('custom')).toBe('custom')
  })
})

const BAND = { component: 'AbovePrompt' } as const

test('the band follows the context window on every surface', async ($, on) => {
  let tokens = 36_000
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens, window: 200_000, percent: Math.round(tokens / 2_000) },
      rateLimits: [{ kind: 'five_hour', percentUsed: 72 }],
    },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.start', () => ({ cwd: '/repo' }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', () => ({ value: undefined }) as never)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const props = { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120 } as never
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-weather', surface, ...BAND, props })
    expect(await ui.find({ type: 'Text', text: /Clear/ }), 'check 1: ' + (await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5h 72%/ }), 'check 2: ' + (await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ }), 'check 3: ' + (await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')).toBeDefined()
    await ui.unmount()
  }

  tokens = 120_000
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })
  const ui = await $.ui.mount({ plugin: 'usage-weather', surface: 'terminal', ...BAND, props })
  expect(await ui.find({ type: 'Text', text: /Showers/ }), 'check 4: ' + (await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\+84k/ }), 'check 5: ' + (await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')).toBeDefined()
  await ui.unmount()
})
