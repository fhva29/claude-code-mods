import { describe, expect, test } from 'claude-code/testing'

import { forecastFor, meter, meterSvg, shortModel, sparkline, sparklineSvg } from '../hooks/forecast'

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

  test('svg meter and sparkline stay inside their box', async () => {
    expect(meterSvg(50, 'success')).toContain('<rect width="48"')
    expect(meterSvg(150, 'error')).toContain('<rect width="96"')
    expect(sparklineSvg([0, 100].map(percent => ({ percent, tokens: 0, window: 1 })), 'warning')).toContain('0,16.5 72.0,1.5')
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
  // Stands for the engine beneath the band, which draws nothing of its own here.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const props = { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120 } as never
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-weather', surface, ...BAND, props })
    expect(await ui.find({ type: 'Text', text: /Clear/ }), 'check 1: ' + (await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5h 72%/ }), 'check 2: ' + (await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ }), 'check 3: ' + (await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')).toBeDefined()
    // The desktop swaps the block glyphs for SVG; the terminal keeps its text meter.
    expect(await ui.find({ type: 'Svg' }) !== undefined).toBe(surface === 'desktop')
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
