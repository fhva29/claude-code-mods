import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentSpawnInput, On } from 'claude-code'

import { parseTierResponse } from './jev'
import {
  classifyFollowUp,
  deriveOutcome,
  type EditEntry,
  feedbackFromJev,
  isEditTool,
  isInjectedPrompt,
  isTestCommand,
  mergeFeedback,
  recordTestRun,
  reworkTargets,
  testsLabel,
} from './quality'

describe('isTestCommand', () => {
  test('recognises test and lint runners, with or without the rtk prefix', () => {
    expect(isTestCommand('./venv/bin/pytest accounts/tests -q')).toBe(true)
    expect(isTestCommand('rtk pytest accounts/tests')).toBe(true)
    expect(isTestCommand('cd FrontEnd && npm run lint')).toBe(true)
    expect(isTestCommand('npm test')).toBe(true)
    expect(isTestCommand('npx vitest run')).toBe(true)
  })

  test('ignores everything else', () => {
    expect(isTestCommand('git status')).toBe(false)
    expect(isTestCommand('./venv/bin/python manage.py runserver')).toBe(false)
    expect(isTestCommand('npm run dev')).toBe(false)
  })
})

describe('isEditTool', () => {
  test('only the write tools count', () => {
    expect(isEditTool('Edit')).toBe(true)
    expect(isEditTool('Write')).toBe(true)
    expect(isEditTool('Read')).toBe(false)
  })
})

describe('recordTestRun', () => {
  test('counts runs and keeps the latest result', () => {
    const first = recordTestRun(undefined, true)
    expect(first).toEqual({ runs: 1, lastPassed: false })
    expect(recordTestRun(first, false)).toEqual({ runs: 2, lastPassed: true })
  })

  test('labels the result for Jev', () => {
    expect(testsLabel(undefined)).toBeNull()
    expect(testsLabel({ runs: 1, lastPassed: true })).toBe('passed')
    expect(testsLabel({ runs: 2, lastPassed: false })).toBe('failed')
  })
})

describe('classifyFollowUp', () => {
  test('reads short corrections and acknowledgements', () => {
    expect(classifyFollowUp('não, isso está errado, volta')).toBe('correction')
    expect(classifyFollowUp('desfaz isso')).toBe('correction')
    expect(classifyFollowUp('valeu!')).toBe('accepted')
    expect(classifyFollowUp('  Beleza.  ')).toBe('accepted')
  })

  test('says nothing about a new task or a long prompt', () => {
    expect(classifyFollowUp('agora cria o endpoint de listagem de poços')).toBeNull()
    expect(classifyFollowUp(`não ${'precisa de muita coisa, só o essencial '.repeat(3)}`)).toBeNull()
  })

  test('ignores engine-injected prompts', () => {
    expect(isInjectedPrompt('<agent-message from="a1">não</agent-message>')).toBe(true)
    expect(classifyFollowUp('<command-message>frontend-review</command-message>')).toBeNull()
    expect(isInjectedPrompt('revisa a tela')).toBe(false)
  })
})

describe('feedbackFromJev', () => {
  test('takes a confident known label', () => {
    expect(feedbackFromJev('correction', 0.8, 0.6)).toBe('correction')
    expect(feedbackFromJev('new_task', 0.6, 0.6)).toBe('new_task')
  })

  test('drops a doubtful or unknown label', () => {
    expect(feedbackFromJev('accepted', 0.4, 0.6)).toBeNull()
    expect(feedbackFromJev('whatever', 0.9, 0.6)).toBeNull()
  })
})

describe('mergeFeedback', () => {
  test('a manual label is never replaced by an inferred one', () => {
    expect(mergeFeedback('manual_bad', 'accepted')).toBe('manual_bad')
    expect(mergeFeedback('manual_good', 'correction')).toBe('manual_good')
  })

  test('an inferred label replaces an inferred one or none', () => {
    expect(mergeFeedback(undefined, 'accepted')).toBe('accepted')
    expect(mergeFeedback('accepted', 'correction')).toBe('correction')
  })
})

describe('deriveOutcome', () => {
  const done = { status: 'done' } as const

  test('a manual label wins over every other signal', () => {
    expect(deriveOutcome({ ...done, feedback: 'manual_good', escalatedTo: 'deep' })).toBe('good')
    expect(deriveOutcome({ ...done, feedback: 'manual_bad', tests: { runs: 1, lastPassed: true } })).toBe('bad')
  })

  test('an abort, an error, an escalation, a correction or failing tests make it bad', () => {
    expect(deriveOutcome({ status: 'aborted' })).toBe('bad')
    expect(deriveOutcome({ status: 'error' })).toBe('bad')
    expect(deriveOutcome({ ...done, escalatedTo: 'default' })).toBe('bad')
    expect(deriveOutcome({ ...done, feedback: 'correction' })).toBe('bad')
    expect(deriveOutcome({ ...done, tests: { runs: 2, lastPassed: false } })).toBe('bad')
  })

  test('accepted is good only when nothing went wrong', () => {
    expect(deriveOutcome({ ...done, feedback: 'accepted' })).toBe('good')
    expect(deriveOutcome({ ...done, feedback: 'accepted', escalatedTo: 'deep' })).toBe('bad')
    expect(deriveOutcome({ ...done, feedback: 'accepted', tests: { runs: 1, lastPassed: false } })).toBe('bad')
  })

  test('a new task with nothing wrong is good_weak; with a bad signal it is bad', () => {
    expect(deriveOutcome({ ...done, feedback: 'new_task' })).toBe('good_weak')
    expect(deriveOutcome({ ...done, feedback: 'new_task', tests: { runs: 1, lastPassed: true } })).toBe('good_weak')
    expect(deriveOutcome({ ...done, feedback: 'new_task', tests: { runs: 1, lastPassed: false } })).toBe('bad')
    expect(deriveOutcome({ ...done, feedback: 'new_task', escalatedTo: 'deep' })).toBe('bad')
    expect(deriveOutcome({ status: 'aborted', feedback: 'new_task' })).toBe('bad')
  })

  test('passing tests or no signal leave it unknown', () => {
    expect(deriveOutcome({ ...done, tests: { runs: 1, lastPassed: true } })).toBe('unknown')
    expect(deriveOutcome(done)).toBe('unknown')
    expect(deriveOutcome({ status: 'running' })).toBe('unknown')
  })
})

describe('reworkTargets', () => {
  const entry = (id: string, runId: string, scope: EditEntry['scope'], ...files: string[]): EditEntry => ({
    id,
    runId,
    scope,
    files: new Set(files),
  })
  const runs = ['r1', 'r2', 'r3', 'r4']

  test('an edit of a file from the previous two runs flags that decision', () => {
    const ledger = [entry('r1', 'r1', 'main', 'a.py'), entry('r2', 'r2', 'main', 'a.py'), entry('r3', 'r3', 'main', 'b.py')]
    expect(reworkTargets(ledger, runs, 'r4', 'a.py')).toEqual(['r2'])
  })

  test('the current run main turn is never its own rework', () => {
    const ledger = [entry('r4', 'r4', 'main', 'a.py')]
    expect(reworkTargets(ledger, runs, 'r4', 'a.py')).toEqual([])
  })

  test('a subagent of the current run is flagged when main edits its file', () => {
    const ledger = [entry('tool_1', 'r4', 'subagent', 'a.py')]
    expect(reworkTargets(ledger, runs, 'r4', 'a.py')).toEqual(['tool_1'])
  })

  test('a run that is not known flags only nothing', () => {
    expect(reworkTargets([entry('r1', 'r1', 'main', 'a.py')], runs, 'unknown', 'a.py')).toEqual([])
  })
})

function jevBody(choice: string, previous?: { choice: string; probability: number }): string {
  return JSON.stringify({
    model: 'jev-1.13.0',
    answers: {
      tier: { type: 'choice', choice, confidence: 0.9, probabilities: { [choice]: 0.9 } },
      ...(previous !== undefined && {
        previous_outcome: {
          type: 'choice',
          choice: previous.choice,
          probabilities: { [previous.choice]: previous.probability },
        },
      }),
    },
    usage: { input_tokens: 1, output_tokens: 1 },
  })
}

type Logged = {
  id: string
  outcome?: string
  feedback?: string
  tests?: unknown
  rework?: boolean
  correctionFloor?: string
}

describe('quality signals through the mod', () => {
  async function wire(on: On, jevText: () => string) {
    mock.env(on, { TYPESAFE_API_KEY: 'test-key', HOME: '/home/test' })
    mock.clock(on)
    on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: jevText() } }))
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }) as never)
    let stored: unknown
    on('store.get', () => ({ value: stored }))
    on('store.set', (_$, e) => {
      stored = e.value
      return { value: undefined }
    })
    return { log: () => (Array.isArray(stored) ? (stored as Logged[]) : []) }
  }

  const stack = (args: string) =>
    ({ command: 'stack', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const

  const complete = (turnId: string, isAborted = false) =>
    ({ answer: '', durationMs: 1000, isAborted, turnId, reason: isAborted ? 'aborted' : 'answer' }) as never

  test('a failing test run, a correction and the derived outcome reach the log', async ($, on) => {
    const { log } = await wire(on, () => jevBody('default', { choice: 'correction', probability: 0.9 }))
    on('tool.call', (_$, e) => ({ result: {}, text: '', isError: e.tool === 'Bash' }) as never)

    await $.turn.start({ text: 'fix the failing depth validation in the serializers', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: './venv/bin/pytest accounts/tests -q' } as never)
    await $.turn.complete(complete('t1'))
    expect(log().find(one => one.id === 't1')).toMatchObject({ tests: { runs: 1, lastPassed: false }, outcome: 'bad' })

    await $.turn.start({ text: 'isso não resolveu, o teste continua falhando no serializer', turnId: 't2' })
    expect(log().find(one => one.id === 't1')).toMatchObject({ feedback: 'correction', outcome: 'bad' })
  })

  test('editing a file again in the next run flags the earlier decision as rework only', async ($, on) => {
    const { log } = await wire(on, () => jevBody('default', { choice: 'new_task', probability: 0.9 }))
    on('tool.call', () => ({ result: {}, text: '', isError: false }) as never)

    await $.turn.start({ text: 'add the depth validation to the serializer', turnId: 't1' })
    await $.tool.call({ tool: 'Edit', file_path: 'accounts/serializers.py' } as never)
    await $.turn.complete(complete('t1'))
    await $.turn.start({ text: 'now tighten the same validation, one more case', turnId: 't2' })
    await $.tool.call({ tool: 'Edit', file_path: 'accounts/serializers.py' } as never)

    expect(log().find(one => one.id === 't1')).toMatchObject({ rework: true, outcome: 'good_weak' })
  })

  test('/stack bad labels the last finished turn and survives a later inferred label', async ($, on) => {
    const { log } = await wire(on, () => jevBody('default', { choice: 'accepted', probability: 0.9 }))

    await $.turn.start({ text: 'add the depth validation to the serializer', turnId: 't1' })
    await $.turn.complete(complete('t1'))
    const reply = await $.command.run(stack('bad wrong tier, needed opus'))
    expect(JSON.stringify(reply)).toContain('as bad')
    await $.turn.start({ text: 'thanks, now add the matching test for it', turnId: 't2' })

    expect(log().find(one => one.id === 't1')).toMatchObject({ feedback: 'manual_bad', outcome: 'bad' })
  })

  test('after a correction the next turn does not run below the corrected one', async ($, on) => {
    let reply = jevBody('heavy')
    const { log } = await wire(on, () => reply)
    const seen: { model: string; effort?: unknown }[] = []
    on('turn.step', async function* (_$, e) {
      seen.push({ model: e.model, effort: e.effort })
      yield { kind: 'stop', stopReason: 'end_turn', usage: null } as never
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], usage: null, stopReason: null } as never
    })
    const step = async (turnId: string): Promise<void> => {
      const stream = $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })
      for await (const _chunk of stream) {
        // Drain the stream so its result settles.
      }
      await stream.result
    }

    await $.turn.start({ text: 'redesign the depth validation across the serializers', turnId: 't1' })
    await step('t1')
    await $.turn.complete(complete('t1'))
    reply = jevBody('light', { choice: 'correction', probability: 0.9 })
    await $.turn.start({ text: 'ficou errado, volta a validação como estava antes', turnId: 't2' })
    await step('t2')

    expect(seen.at(-1)).toEqual({ model: 'claude-opus-5-5', effort: 'medium' })
    await $.turn.complete(complete('t2'))
    expect(log().find(one => one.id === 't2')).toMatchObject({ correctionFloor: 'heavy' })
  })

  test('/stack good with nothing finished says so', async ($, on) => {
    await wire(on, () => jevBody('default'))
    const reply = await $.command.run(stack('good'))
    expect(JSON.stringify(reply)).toContain('No finished')
  })
})

// Jev's own `confidence` is not the probability of the label it chose; the log keeps both.
const DIVERGENT = JSON.stringify({
  model: 'jev-1.13.0',
  answers: {
    tier: {
      type: 'choice',
      choice: 'deep',
      confidence: 0.34,
      probabilities: { light: 0, default: 0.04, deep: 0.47, heavy: 0.42, max: 0.07 },
    },
  },
})

describe('Jev reported confidence', () => {
  test('is parsed apart from the probability of the chosen label', () => {
    const answer = parseTierResponse(DIVERGENT)
    expect(answer?.confidence).toBe(0.47)
    expect(answer?.reported).toBe(0.34)
  })

  test('is null when Jev does not report one', () => {
    const body = JSON.stringify({ answers: { tier: { choice: 'light', probabilities: { light: 0.8 } } } })
    expect(parseTierResponse(body)?.reported).toBeNull()
  })

  test('reaches the persisted log next to the probability of a main turn', async ($, on) => {
    mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
    mock.clock(on)
    on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: DIVERGENT } }))
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }) as never)
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent_1' }))
    let stored: unknown
    on('store.get', () => ({ value: stored }))
    on('store.set', (_$, e) => {
      stored = e.value
      return { value: undefined }
    })

    await $.turn.start({ text: 'fix the failing depth validation in the serializers', turnId: 't1' })
    await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as never)

    const log = Array.isArray(stored) ? (stored as { id: string; confidence: number; jevConfidence: number }[]) : []
    expect(log.find(one => one.id === 't1')).toMatchObject({ confidence: 0.47, jevConfidence: 0.34 })
  })

  test('reaches the persisted log for a subagent finished through its agentId', async ($, on) => {
    mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
    mock.clock(on)
    on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: DIVERGENT } }))
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent_1' }))
    on('turn.complete', () => ({ text: '' }) as never)
    let stored: unknown
    on('store.get', () => ({ value: stored }))
    on('store.set', (_$, e) => {
      stored = e.value
      return { value: undefined }
    })

    const spawn: AgentSpawnInput = {
      tool_use_id: 'toolu_1',
      prompt: 'Find where the depth ranges are validated.',
      description: 'Find depth validation',
      subagentType: 'general-purpose',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: false,
      fork: false,
    }
    await $.agent.spawn(spawn)
    await $.turn.complete({
      answer: '',
      durationMs: 1000,
      isAborted: false,
      turnId: 't1',
      agentId: 'agent_1',
      reason: 'answer',
    } as never)

    const log = Array.isArray(stored) ? (stored as { id: string; scope: string; confidence: number; jevConfidence: number }[]) : []
    expect(log.find(one => one.id === 'toolu_1')).toMatchObject({
      scope: 'subagent',
      confidence: 0.47,
      jevConfidence: 0.34,
    })
  })
})
