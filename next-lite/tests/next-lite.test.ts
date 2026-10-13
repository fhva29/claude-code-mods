import { expect, test } from 'claude-code/testing'

import { buildPrompt, parseSuggestions, pushTrail, trailLine, worthSuggesting } from '../hooks/digest'

declare function setTimeout(callback: () => void, ms: number): unknown

// The suggestion runs detached from turn.complete, so the test waits for it.
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setTimeout(resolve, 5))
}

const LONG_ANSWER = `${'Done. '.repeat(50)}Want me to run the tests?`

test('digest helpers', async () => {
  expect(trailLine('Edit', { file_path: 'a.py' }, false)).toBe('Edit a.py')
  expect(trailLine('Bash', { command: 'pytest\n -q' }, true)).toBe('Bash pytest -q (failed)')
  expect(pushTrail(['Edit a.py'], 'Edit a.py')).toEqual(['Edit a.py'])
  expect(pushTrail([], 'x').length).toBe(1)

  expect(worthSuggesting({ request: 'x', answer: 'short', trail: ['Edit a.py'] }, 200)).toBe(false)
  expect(worthSuggesting({ request: 'x', answer: 'a'.repeat(300), trail: [] }, 200)).toBe(false)
  expect(worthSuggesting({ request: 'x', answer: LONG_ANSWER, trail: [] }, 200)).toBe(true)

  const prompt = buildPrompt({ request: 'fix it', answer: 'b'.repeat(5000), trail: [] }, '/code-review')
  expect(prompt.includes('[…]')).toBe(true)
  expect(prompt.includes('/code-review')).toBe(true)

  const known = new Set(['code-review'])
  const reply = 'sure [{"label":"Review","prompt":"/code-review high"},{"prompt":"/made-up x"},{"label":"Tests","prompt":"run\\u001b[31m pytest"}]'
  expect(parseSuggestions(reply, known)).toEqual([
    { label: 'Review', prompt: '/code-review high' },
    { label: 'Tests', prompt: 'run pytest' },
  ])
  expect(parseSuggestions('no json', known)).toEqual([])
})

test('a qualifying turn offers buttons from one small completion', async ($, on) => {
  const asked: string[] = []
  on('model.complete', (_$, e) => {
    asked.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        text: '[{"label":"Run tests","prompt":"rode o pytest em accounts"}]',
        usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('command.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/repo' }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.invalidate', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: { ok: true } }) as never)
  on('prompt.suggest', () => ({ isShown: true }) as never)
  // Stands in for the engine's own band beneath the plugin.
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => $$.ui.resolve(e).Text({ children: '' }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'corrige o serializer', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: 'accounts/serializers.py', old_string: 'a', new_string: 'b' } as never)
  await $.turn.complete({ answer: LONG_ANSWER, durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  await settle()

  expect(asked.length).toBe(1)
  expect(asked[0]?.includes('Edit accounts/serializers.py')).toBe(true)
  expect(asked[0]?.includes('corrige o serializer')).toBe(true)

  const ui = await $.ui.mount({
    plugin: 'next-lite',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false } as never,
  })
  expect((await ui.find({ type: 'Button', text: 'Run tests' })) !== undefined).toBe(true)
  expect(await ui.find({ type: 'Button', text: 'Not offered' })).toBeUndefined()
  await ui.unmount()
})

test('a subagent turn and a bare short answer ask nothing', async ($, on) => {
  let calls = 0
  on('model.complete', () => {
    calls++
    const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    return { value: { isAnswered: false, reason: 'empty-reply', usage } } as never
  })
  on('command.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/repo' }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.invalidate', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await $.turn.complete({ answer: 'Oi!', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.turn.complete({ answer: LONG_ANSWER, durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'a1' })
  await settle()
  expect(calls).toBe(0)
})
