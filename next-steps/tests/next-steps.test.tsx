import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'next-steps',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 } },
} as const

const LONG = 'Review the unified export changes in services'

test('desktop cuts long labels and keeps the full text for the hover card', async ($, on) => {
  on('command.list', () => ({ value: [] }))
  on('model.fork', () => ({
    value: {
      isAnswered: true,
      text: JSON.stringify([
        { label: 'Run the tests', prompt: 'run the tests' },
        { label: LONG, prompt: 'apply the change' },
      ]),
    },
  }))
  on('prompt.suggest', () => ({ isShown: true }) as never)
  on('turn.complete', () => ({ text: '' }))
  // Stands for the engine beneath the band, which draws nothing of its own here.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.turn.complete({ answer: 'x'.repeat(200), durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  // The fork runs detached; give it a tick to land.
  await new Promise(resolve => setTimeout(resolve, 10))

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  const labels = (await desktop.findAll({ type: 'Button' })).map(button => button.text)
  expect(labels, JSON.stringify(labels)).toContain('Run the tests')
  expect(labels.some(label => label?.endsWith('…') && label.length <= 32), JSON.stringify(labels)).toBe(true)
  const texts = (await desktop.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts, JSON.stringify(texts)).toContain(LONG)
  await desktop.unmount()

  // The terminal keeps the full label and draws no card.
  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect((await terminal.findAll({ type: 'Button' })).map(button => button.text)).toContain(LONG)
  await terminal.unmount()
})
