import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentSpawnInput, On } from 'claude-code'

import {
  applyPlan,
  decide,
  isStruggling,
  type JevChoice,
  NO_SIGNALS,
  recordToolOutcome,
  type Signals,
  type SpawnFacts,
  skipMainPrompt,
  type MainInputs,
  raisePlan,
  resolveMain,
  stepRank,
  type Thresholds,
  tierAbove,
  tierCovering,
  tierForEffort,
} from './routing'

const GENERIC: SpawnFacts = { subagentType: 'general-purpose', requestedModel: null, isFork: false, isTeammate: false }
const EXPLORE: SpawnFacts = { ...GENERIC, subagentType: 'Explore' }

function jev(choice: JevChoice['choice'], confidence: number): JevChoice {
  return { choice, confidence, probabilities: { [choice]: confidence } }
}

const SAME: Thresholds = { up: 0.6, down: 0.6 }
const SPLIT: Thresholds = { up: 0.3, down: 0.6 }

describe('decide', () => {
  test('firm on a generic agent swaps in the tier agent', () => {
    const outcome = decide(GENERIC, jev('light', 0.8), SAME, 'default')
    expect(outcome.verdict).toBe('firm')
    expect(outcome.subagentType).toBe('model-stack:haiku-medium')
    expect(outcome.model).toBe('haiku')
  })

  test('firm on max swaps in the opus high tier agent', () => {
    const outcome = decide(GENERIC, jev('max', 0.9), SAME, 'default')
    expect(outcome.subagentType).toBe('model-stack:opus-high')
    expect(outcome.model).toBe('opus')
  })

  test('firm on a specialized agent changes only the model', () => {
    const outcome = decide(EXPLORE, jev('heavy', 0.9), SAME, 'default')
    expect(outcome.subagentType).toBeUndefined()
    expect(outcome.model).toBe('opus')
  })

  test('doubt keeps the model Opus asked for', () => {
    const outcome = decide({ ...GENERIC, requestedModel: 'sonnet' }, jev('light', 0.4), SAME, 'default')
    expect(outcome.verdict).toBe('doubt')
    expect(outcome.subagentType).toBeUndefined()
    expect(outcome.model).toBeUndefined()
  })

  test('doubt with no requested model falls to the default tier', () => {
    const outcome = decide(GENERIC, jev('heavy', 0.3), SAME, 'default')
    expect(outcome.verdict).toBe('doubt')
    expect(outcome.subagentType).toBe('model-stack:sonnet-medium')
  })

  test('Jev unavailable falls to the default tier', () => {
    const outcome = decide(GENERIC, null, SAME, 'default')
    expect(outcome.verdict).toBe('fallback')
    expect(outcome.model).toBe('sonnet')
  })

  test('an explicit Opus request is never downgraded', () => {
    const outcome = decide({ ...GENERIC, requestedModel: 'opus' }, jev('light', 0.95), SAME, 'default')
    expect(outcome.verdict).toBe('firm')
    expect(outcome.model).toBeUndefined()
    expect(outcome.applied).toBe('as requested')
  })

  test('a picked tier agent is raised when Jev asks for more', () => {
    const outcome = decide({ ...GENERIC, subagentType: 'model-stack:haiku-medium' }, jev('deep', 0.9), SAME, 'default')
    expect(outcome.verdict).toBe('firm')
    expect(outcome.subagentType).toBe('model-stack:sonnet-high')
    expect(outcome.model).toBe('sonnet')
  })

  test('a picked tier agent is never lowered', () => {
    const outcome = decide({ ...GENERIC, subagentType: 'model-stack:sonnet-high' }, jev('default', 0.9), SAME, 'default')
    expect(outcome.subagentType).toBeUndefined()
    expect(outcome.applied).toBe('as requested')
  })

  test('a picked tier agent is kept when Jev is in doubt or unavailable', () => {
    const picked = { ...GENERIC, subagentType: 'model-stack:haiku-medium' }
    expect(decide(picked, jev('heavy', 0.3), SAME, 'default').subagentType).toBeUndefined()
    expect(decide(picked, null, SAME, 'default').subagentType).toBeUndefined()
  })

  test('split thresholds: a weak upgrade applies, a weak downgrade falls to the default tier', () => {
    expect(decide(GENERIC, jev('heavy', 0.4), SPLIT, 'default')).toMatchObject({ verdict: 'firm', model: 'opus' })
    expect(decide(GENERIC, jev('light', 0.4), SPLIT, 'default')).toMatchObject({
      verdict: 'doubt',
      subagentType: 'model-stack:sonnet-medium',
    })
    expect(decide(GENERIC, jev('light', 0.7), SPLIT, 'default').model).toBe('haiku')
  })

  test('a risky task runs on the max tier even in doubt or against a cheaper request', () => {
    expect(decide(GENERIC, jev('light', 0.2), SPLIT, 'default', true)).toMatchObject({
      verdict: 'firm',
      subagentType: 'model-stack:opus-high',
    })
    expect(decide({ ...GENERIC, requestedModel: 'haiku' }, null, SPLIT, 'default', true).model).toBe('opus')
    expect(decide(EXPLORE, jev('light', 0.9), SPLIT, 'default', true)).toMatchObject({ model: 'opus' })
  })

  test('an unknown requested model is left alone', () => {
    const outcome = decide({ ...GENERIC, requestedModel: 'some-future-model' }, jev('heavy', 0.95), SAME, 'default')
    expect(outcome.model).toBeUndefined()
  })
})

const SPAWN: AgentSpawnInput = {
  tool_use_id: 'toolu_1',
  prompt: 'Find where the depth ranges are validated.',
  description: 'Find depth validation',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
}

function jevBody(choice: string, probability: number): string {
  return JSON.stringify({
    model: 'jev-1.13.0',
    answers: { tier: { type: 'choice', choice, confidence: probability, probabilities: { [choice]: probability } } },
    usage: { input_tokens: 1, output_tokens: 1 },
  })
}

describe('agent.spawn', () => {
  test('asks Jev even when Opus picked a tier agent', async ($, on) => {
    mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
    mock.clock(on)
    let asked = false
    on('http.fetch', () => {
      asked = true
      return { value: { status: 200, ok: true, headers: {}, text: jevBody('heavy', 0.9) } }
    })
    let spawned: AgentSpawnInput | undefined
    on('agent.spawn', ($, e) => {
      spawned = e
      return { model: e.model ?? 'inherit', agentId: 'agent_4' }
    })

    await $.agent.spawn({ ...SPAWN, subagentType: 'model-stack:haiku-medium' })

    expect(asked).toBe(true)
    expect(spawned?.subagentType).toBe('model-stack:opus-medium')
  })

  test('routes a generic spawn to the tier Jev picks', async ($, on) => {
    mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
    mock.clock(on)
    let authorization: string | undefined
    on('http.fetch', ($, e) => {
      authorization = e.init?.headers?.Authorization
      return { value: { status: 200, ok: true, headers: {}, text: jevBody('light', 0.9) } }
    })
    let spawned: AgentSpawnInput | undefined
    on('agent.spawn', ($, e) => {
      spawned = e
      return { model: e.model ?? 'inherit', agentId: 'agent_1' }
    })

    await $.agent.spawn(SPAWN)

    expect(authorization).toBe('Bearer test-key')
    expect(spawned?.subagentType).toBe('model-stack:haiku-medium')
    expect(spawned?.model).toBe('haiku')
  })

  test('falls back to the default tier when Jev fails', async ($, on) => {
    mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
    mock.clock(on)
    on('http.fetch', () => ({ value: { status: 503, ok: false, headers: {}, text: '' } }))
    let spawned: AgentSpawnInput | undefined
    on('agent.spawn', ($, e) => {
      spawned = e
      return { model: e.model ?? 'inherit', agentId: 'agent_2' }
    })

    await $.agent.spawn(SPAWN)

    expect(spawned?.subagentType).toBe('model-stack:sonnet-medium')
  })

  test('leaves forks untouched without asking Jev', async ($, on) => {
    mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
    mock.clock(on)
    let asked = false
    on('http.fetch', () => {
      asked = true
      return { value: { status: 200, ok: true, headers: {}, text: jevBody('heavy', 0.9) } }
    })
    let spawned: AgentSpawnInput | undefined
    on('agent.spawn', ($, e) => {
      spawned = e
      return { model: 'inherit', agentId: 'agent_3' }
    })

    await $.agent.spawn({ ...SPAWN, subagentType: 'fork', fork: true })

    expect(asked).toBe(false)
    expect(spawned?.subagentType).toBe('fork')
  })
})

describe('resolveMain', () => {
  const OPUS_HIGH = { model: 'claude-opus-5-5', effort: 'high' }
  const HAIKU = { model: 'claude-haiku-5-5', effort: 'medium' }
  const inputs = (over: Partial<MainInputs> = {}): MainInputs => ({
    jev: null,
    thresholds: SPLIT,
    floor: null,
    correctionFloor: null,
    risky: false,
    routing: 'model',
    ...over,
  })

  test('a downgrade needs the downgrade threshold', () => {
    expect(resolveMain(OPUS_HIGH, inputs({ jev: jev('default', 0.5) }))).toMatchObject({
      verdict: 'doubt',
      needed: 0.6,
      run: null,
    })
    expect(resolveMain(OPUS_HIGH, inputs({ jev: jev('default', 0.7) })).run).toEqual({
      tier: 'default',
      model: 'claude-sonnet-5-5',
      effort: 'medium',
    })
  })

  test('an upgrade needs only the upgrade threshold', () => {
    expect(resolveMain(HAIKU, inputs({ jev: jev('heavy', 0.35) }))).toMatchObject({
      verdict: 'firm',
      needed: 0.3,
      run: { tier: 'heavy', model: 'claude-opus-5-5', effort: 'medium' },
    })
  })

  test('the floor lifts a confident pick and keeps Jev\'s own tier on record', () => {
    const resolved = resolveMain(OPUS_HIGH, inputs({ jev: jev('light', 0.8), floor: 'deep' }))
    expect(resolved.tier).toBe('light')
    expect(resolved.run?.tier).toBe('deep')
  })

  test('a pick equal to what the step runs on changes nothing', () => {
    expect(resolveMain(OPUS_HIGH, inputs({ jev: jev('max', 0.9) })).run).toBeNull()
  })

  test('doubt and fallback keep the step unless a correction or risk raises it', () => {
    expect(resolveMain(HAIKU, inputs({ jev: jev('light', 0.1) })).run).toBeNull()
    expect(resolveMain(HAIKU, inputs({ correctionFloor: 'heavy' })).run?.tier).toBe('heavy')
    expect(resolveMain(OPUS_HIGH, inputs({ correctionFloor: 'heavy' })).run).toBeNull()
    expect(resolveMain(HAIKU, inputs({ jev: jev('light', 0.1), risky: true })).run?.tier).toBe('max')
  })

  test('a confident downgrade still stops at the corrected turn\'s tier', () => {
    expect(resolveMain(OPUS_HIGH, inputs({ jev: jev('light', 0.9), correctionFloor: 'heavy' })).run?.tier).toBe('heavy')
  })

  test('effort routing keeps the model and moves only the effort', () => {
    const effort = inputs({ routing: 'effort', jev: jev('light', 0.9) })
    expect(resolveMain(OPUS_HIGH, effort).run).toEqual({ tier: 'light', model: 'claude-opus-5-5', effort: 'low' })
    expect(resolveMain({ model: 'claude-opus-5-5', effort: 'medium' }, { ...effort, jev: jev('deep', 0.4) }).run).toEqual({
      tier: 'deep',
      model: 'claude-opus-5-5',
      effort: 'high',
    })
    expect(tierForEffort('low')).toBe('light')
    expect(tierForEffort('high')).toBe('deep')
  })

  test('tierCovering rounds a model and effort up to a tier', () => {
    expect(tierCovering('claude-haiku-5-5', 'low')).toBe('light')
    expect(tierCovering('claude-sonnet-5-5', 'low')).toBe('default')
    expect(tierCovering('claude-sonnet-5-5', 'high')).toBe('deep')
    expect(tierCovering('claude-opus-5-5', 'high')).toBe('max')
    expect(tierCovering('claude-opus-5-5', 'max')).toBe('max')
    expect(stepRank('claude-opus-5-5', 'low')).toBeGreaterThan(stepRank('claude-sonnet-5-5', 'high'))
  })
})

describe('raisePlan', () => {
  test('model routing goes one tier up, effort routing raises only the effort', () => {
    const planned = { turnId: 't1', tier: 'default' as const, model: 'claude-sonnet-5-5', effort: 'medium' as const }
    expect(raisePlan(planned, 'model')).toMatchObject({ tier: 'deep', model: 'claude-sonnet-5-5', effort: 'high' })
    const opus = { turnId: 't1', tier: 'light' as const, model: 'claude-opus-5-5', effort: 'low' as const }
    expect(raisePlan(opus, 'effort')).toMatchObject({ tier: 'default', model: 'claude-opus-5-5', effort: 'medium' })
  })

  test('nothing to raise at the top or when effort would not go up', () => {
    expect(raisePlan({ turnId: 't1', tier: 'max', model: 'claude-opus-5-5', effort: 'high' }, 'model')).toBeNull()
    expect(raisePlan({ turnId: 't1', tier: 'deep', model: 'claude-opus-5-5', effort: 'high' }, 'effort')).toBeNull()
  })
})

describe('skipMainPrompt', () => {
  test('skips acknowledgements, slash commands and empty continuations', () => {
    expect(skipMainPrompt('sim')).toBe(true)
    expect(skipMainPrompt('  ok, pode fazer ')).toBe(true)
    expect(skipMainPrompt('/stack details')).toBe(true)
    expect(skipMainPrompt('')).toBe(true)
  })

  test('asks Jev about a real task', () => {
    expect(skipMainPrompt('corrige o bug de validação de profundidade no serializer')).toBe(false)
  })
})

describe('main chat routing', () => {
  const STEP = { turnId: 'turn_1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 } as const

  async function runTurn($: Engine, on: On, text: string) {
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    await $.turn.start({ text, turnId: 'turn_1' })
    const stream = $.turn.step(STEP)
    for await (const _chunk of stream) {
      // Drain the stream so its result settles.
    }
    await stream.result
  }

  test('rewrites the model and effort of every step of the turn to the tier Jev picks', async ($, on) => {
    mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
    mock.clock(on)
    on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: jevBody('heavy', 0.9) } }))
    let seen: { model: string; effort?: unknown } | undefined
    on('turn.step', async function* ($, e) {
      seen = { model: e.model, effort: e.effort }
      yield { kind: 'stop', stopReason: 'end_turn', usage: null } as never
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], usage: null, stopReason: null } as never
    })

    await runTurn($, on, 'find where the depth ranges are validated in the serializers')

    expect(seen).toEqual({ model: 'claude-opus-5-5', effort: 'medium' })
  })

  test('lifts a confident pick below the floor to the floor', async ($, on) => {
    mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
    mock.clock(on)
    on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: jevBody('light', 0.9) } }))
    let seen: { model: string; effort?: unknown } | undefined
    on('turn.step', async function* ($, e) {
      seen = { model: e.model, effort: e.effort }
      yield { kind: 'stop', stopReason: 'end_turn', usage: null } as never
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], usage: null, stopReason: null } as never
    })

    await runTurn($, on, 'find where the depth ranges are validated in the serializers')

    expect(seen).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  })

  test('keeps the picked model for a short prompt without asking Jev', async ($, on) => {
    mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
    mock.clock(on)
    let asked = false
    on('http.fetch', () => {
      asked = true
      return { value: { status: 200, ok: true, headers: {}, text: jevBody('light', 0.9) } }
    })
    let seen: string | undefined
    on('turn.step', async function* ($, e) {
      seen = e.model
      yield { kind: 'stop', stopReason: 'end_turn', usage: null } as never
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], usage: null, stopReason: null } as never
    })

    await runTurn($, on, 'sim')

    expect(asked).toBe(false)
    expect(seen).toBe('claude-opus-5-5')
  })
})

describe('risky main turn', () => {
  test('a risky prompt runs on opus high even when Jev picks a cheap tier', async ($, on) => {
    mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
    mock.clock(on)
    const body = JSON.stringify({
      model: 'jev-1.13.0',
      answers: {
        tier: { type: 'choice', choice: 'light', confidence: 0.9, probabilities: { light: 0.9 } },
        risky: { type: 'choice', choice: 'risky', probabilities: { risky: 0.85, safe: 0.15 } },
      },
    })
    let questions: string[] = []
    on('http.fetch', (_$, e) => {
      const { init } = e as unknown as { init: { body: string } }
      questions = Object.keys((JSON.parse(init.body) as { questions: object }).questions)
      return { value: { status: 200, ok: true, headers: {}, text: body } }
    })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    let seen: { model: string; effort?: unknown } | undefined
    on('turn.step', async function* ($, e) {
      seen = { model: e.model, effort: e.effort }
      yield { kind: 'stop', stopReason: 'end_turn', usage: null } as never
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], usage: null, stopReason: null } as never
    })

    await $.turn.start({ text: 'run the pending migrations on the production database', turnId: 'turn_1' })
    const stream = $.turn.step({ turnId: 'turn_1', index: 0, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1 })
    for await (const _chunk of stream) {
      // Drain the stream so its result settles.
    }
    await stream.result

    expect(questions).toContain('risky')
    expect(seen).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  })
})

describe('escalation', () => {
  test('raises the turn one tier after two failing tool calls, once', async ($, on) => {
    mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
    mock.clock(on)
    on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: jevBody('deep', 0.9) } }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    const seen: { model: string; effort?: unknown }[] = []
    on('turn.step', async function* ($, e) {
      seen.push({ model: e.model, effort: e.effort })
      yield { kind: 'stop', stopReason: 'end_turn', usage: null } as never
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], usage: null, stopReason: null } as never
    })
    on('tool.call', () => ({ result: {}, text: 'boom', isError: true }) as never)

    const step = async (index: number): Promise<void> => {
      const stream = $.turn.step({ turnId: 'turn_1', index, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })
      for await (const _chunk of stream) {
        // Drain the stream so its result settles.
      }
      await stream.result
    }

    await $.turn.start({ text: 'fix the failing depth validation tests in the serializers', turnId: 'turn_1' })
    await step(0)
    await $.tool.call({ tool: 'Bash', command: 'pytest' } as never)
    await step(1)
    await $.tool.call({ tool: 'Bash', command: 'pytest' } as never)
    await step(2)
    await $.tool.call({ tool: 'Bash', command: 'pytest' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pytest' } as never)
    await step(3)

    expect(seen.map(one => one.effort)).toEqual(['high', 'high', 'medium', 'medium'])
    expect(seen.map(one => one.model)).toEqual([
      'claude-sonnet-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-opus-5-5',
    ])
  })
})

describe('pane', () => {
  test('draws after a routed turn and a subagent spawn', async ($, on) => {
    mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
    mock.clock(on)
    on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: jevBody('deep', 0.9) } }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('agent.spawn', () => ({ model: 'haiku', agentId: 'agent_1' }))

    await $.turn.start({ text: 'refactor the depth validation across the serializers', turnId: 'turn_1' })
    await $.agent.spawn({ ...SPAWN, subagentType: 'general-purpose' })
    const tree = await $.ui.render({
      component: 'Pane',
      requestId: 'model-stack',
      surface: 'terminal',
      viewport: { columns: 120, rows: 40 },
    } as never)

    expect(JSON.stringify(tree)).toContain('Agentes')
    expect(JSON.stringify(tree)).toContain('Decisão')
  })
})

describe('applyPlan', () => {
  const plan = { turnId: 't1', tier: 'deep' as const, model: 'claude-sonnet-5-5', effort: 'high' as const }

  test('rewrites model and effort of a main-chat step of the planned turn', () => {
    const step = applyPlan({ turnId: 't1', index: 2, model: 'claude-opus-5-5', effort: 'low' as const }, plan)
    expect(step.model).toBe('claude-sonnet-5-5')
    expect(step.effort).toBe('high')
    expect(step.index).toBe(2)
  })

  test('leaves a subagent step, another turn and a missing plan untouched', () => {
    const base = { turnId: 't1', model: 'claude-opus-5-5' }
    expect(applyPlan({ ...base, agentId: 'a1' }, plan)).toEqual({ ...base, agentId: 'a1' })
    expect(applyPlan({ ...base, turnId: 't2' }, plan)).toEqual({ ...base, turnId: 't2' })
    expect(applyPlan(base, null)).toEqual(base)
  })
})

describe('escalation signals', () => {
  const fail = (s: Signals): Signals => recordToolOutcome(s, { tool: 'Bash', isError: true })
  const edit = (s: Signals, filePath: string): Signals =>
    recordToolOutcome(s, { tool: 'Edit', filePath, isError: false })

  test('two failures in a row are struggling, one is not', () => {
    expect(isStruggling(fail(NO_SIGNALS))).toBe(false)
    expect(isStruggling(fail(fail(NO_SIGNALS)))).toBe(true)
  })

  test('a success resets the failure streak', () => {
    const ok = recordToolOutcome(fail(NO_SIGNALS), { tool: 'Read', isError: false })
    expect(isStruggling(fail(ok))).toBe(false)
  })

  test('the third edit of the same file is struggling, edits of different files are not', () => {
    expect(isStruggling(edit(edit(NO_SIGNALS, 'a.py'), 'a.py'))).toBe(false)
    expect(isStruggling(edit(edit(edit(NO_SIGNALS, 'a.py'), 'a.py'), 'a.py'))).toBe(true)
    expect(isStruggling(edit(edit(edit(NO_SIGNALS, 'a.py'), 'b.py'), 'c.py'))).toBe(false)
  })

  test('tierAbove goes one up and stops at max', () => {
    expect(tierAbove('default')).toBe('deep')
    expect(tierAbove('max')).toBeNull()
  })
})
