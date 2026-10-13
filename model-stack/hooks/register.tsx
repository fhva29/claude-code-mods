import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { JEV_ENDPOINT, type JevAnswer, type PastResult, parseTierResponse, tierRequest } from './jev'
import { FRAME_MS, PANE, paneTree, SWEEP_MS } from './panel'
import {
  classifyFollowUp,
  deriveOutcome,
  isInjectedPrompt,
  type EditEntry,
  feedbackFromJev,
  isEditTool,
  isTestCommand,
  mergeFeedback,
  recordTestRun,
  reworkTargets,
  testsLabel,
} from './quality'
import {
  applyPlan,
  asRecommendation,
  decide,
  isStruggling,
  isTier,
  NO_SIGNALS,
  recordToolOutcome,
  shouldRoute,
  skipMainPrompt,
  type MainInputs,
  type MainRouting,
  modelRank,
  raisePlan,
  resolveMain,
  type Signals,
  TIER_ORDER,
  TIERS,
  type Thresholds,
  tierCovering,
  tierForEffort,
} from './routing'
import type { Feedback, MainPlan, Mode, RoutingDecision, Run, Tier, View } from '../types'

const LOG_KEY = 'log'
const LOG_LIMIT = 500
const SESSION_LIMIT = 200
const RUN_LIMIT = 100
const LOGGED_PROMPT_CHARS = 200
const HISTORY_SIZE = 8
const ACTION_CHARS = 60
const RUN_TEXT_CHARS = 80
const MODES: readonly Mode[] = ['off', 'recommend', 'route']

const decisions = atom({ plugin: 'model-stack', key: 'decisions' } as const, [])
const plan = atom({ plugin: 'model-stack', key: 'plan' } as const, null)
const runs = atom({ plugin: 'model-stack', key: 'runs' } as const, [])
const currentRun = atom({ plugin: 'model-stack', key: 'currentRun' } as const, null)
const view = atom({ plugin: 'model-stack', key: 'view' } as const, 'overview')
const modeOverride = atom({ plugin: 'model-stack', key: 'mode' } as const, null)
const tick = atom({ plugin: 'model-stack', key: 'tick' } as const, 0)
const jevAskedAt = atom({ plugin: 'model-stack', key: 'jevAskedAt' } as const, null)

const TIER_PROMPT = [
  'You are a subagent working for an orchestrating Claude session.',
  'Do exactly the task you are given, stay inside its scope, and report back',
  'concisely: what you found or changed, with file paths, and anything left undone.',
].join(' ')

const USAGE = '/stack [details|overview|export|good [note]|bad [note]|mode off|recommend|route]'

function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}

function describeAction(e: { tool: string } & Record<string, unknown>): string {
  const arg = [e.command, e.file_path, e.pattern, e.path, e.url, e.description].find(
    value => typeof value === 'string' && value !== '',
  )
  const text = typeof arg === 'string' ? `${e.tool} ${arg.replace(/\s+/g, ' ')}` : e.tool
  return text.length > ACTION_CHARS ? `${text.slice(0, ACTION_CHARS - 1)}…` : text
}

async function persist($: EngineInterface, decision: RoutingDecision, prompt: string): Promise<void> {
  const previous = await $.store.get(LOG_KEY)
  const log = Array.isArray(previous) ? previous : []
  const entry = { ...decision, prompt: prompt.slice(0, LOGGED_PROMPT_CHARS) }
  await $.store.set(LOG_KEY, [...log, entry].slice(-LOG_LIMIT))
}

async function pastResults($: EngineInterface): Promise<PastResult[]> {
  // History only sharpens Jev's answer; a store that cannot be read leaves it out.
  const previous = await $.store.get(LOG_KEY).catch(() => null)
  if (!Array.isArray(previous)) return []
  return (previous as RoutingDecision[])
    .filter(one => one.status !== 'running')
    .slice(-HISTORY_SIZE)
    .map(one => ({
      subagent_type: one.subagentType,
      task_summary: one.description,
      model: one.actualModel ?? one.applied,
      status: one.status,
      duration_s: one.durationMs === undefined ? null : Math.round(one.durationMs / 1000),
      escalated_to: one.escalatedTo ?? null,
      tests: testsLabel(one.tests),
      rework: one.rework === true,
      user_feedback: one.feedback ?? null,
      outcome: one.outcome ?? 'unknown',
    }))
}

/** Rewrites one persisted entry; a decision that is not in the log yet is saved whole when its turn ends. */
async function amendLog($: EngineInterface, id: string, change: Partial<RoutingDecision>): Promise<void> {
  const previous = await $.store.get(LOG_KEY).catch(() => null)
  if (!Array.isArray(previous) || !previous.some(one => one.id === id)) return
  await $.store.set(
    LOG_KEY,
    previous.map(one => (one.id === id ? { ...one, ...change } : one)),
  )
}

async function modeOf($: EngineInterface, configured: Mode): Promise<Mode> {
  return (await read($, modeOverride)) ?? configured
}

async function patch(
  $: EngineInterface,
  id: string,
  change: Partial<RoutingDecision>,
): Promise<RoutingDecision | undefined> {
  let patched: RoutingDecision | undefined
  await update($, decisions, list =>
    list.map(one => {
      if (one.id !== id) return one
      patched = { ...one, ...change }
      return patched
    }),
  )
  return patched
}

async function loggedDecision($: EngineInterface, id: string): Promise<RoutingDecision | undefined> {
  const previous = await $.store.get(LOG_KEY).catch(() => null)
  return Array.isArray(previous) ? (previous as RoutingDecision[]).find(one => one.id === id) : undefined
}

/** A quality signal arrived: update the decision in the session and in the log, and re-derive its outcome. */
async function annotate(
  $: EngineInterface,
  id: string,
  change: Partial<RoutingDecision>,
): Promise<RoutingDecision | undefined> {
  const live = (await read($, decisions)).find(one => one.id === id)
  const current = live ?? (await loggedDecision($, id))
  if (current === undefined) return undefined
  const merged = { ...current, ...change }
  const full = { ...change, outcome: deriveOutcome(merged) }
  if (live !== undefined) await patch($, id, full)
  await amendLog($, id, full)
  return { ...merged, outcome: full.outcome }
}

/** Infers what the new prompt says about the previous main turn; a label given by hand is kept. */
async function recordFollowUp($: EngineInterface, previousId: string, inferred: Feedback | null): Promise<void> {
  if (inferred === null) return
  const current = (await read($, decisions)).find(one => one.id === previousId) ?? (await loggedDecision($, previousId))
  if (current === undefined) return
  await annotate($, previousId, { feedback: mergeFeedback(current.feedback, inferred) })
}

type Asked = { answer: JevAnswer | null; ms: number }

async function askJev(
  $: EngineInterface,
  question: Parameters<typeof tierRequest>[0],
  timeoutMs: number,
): Promise<Asked> {
  const started = await $.clock.now()
  await update($, jevAskedAt, () => started)
  try {
    const fetched = $.http.fetch(JEV_ENDPOINT, tierRequest(question)).catch(() => null)
    const timeout = $.clock.sleep(timeoutMs).then(() => null)
    const response = await Promise.race([fetched, timeout])
    const answer = response !== null && response.ok ? parseTierResponse(response.text) : null
    return { answer, ms: (await $.clock.now()) - started }
  } finally {
    await update($, jevAskedAt, () => null)
  }
}

/** Something on the pane is moving: a spinner, Jev's pulse, or a bar still sweeping in. */
function isAnimating(list: readonly RoutingDecision[], asked: number | null, now: number): boolean {
  if (asked !== null) return true
  const last = list.at(-1)
  if (last !== undefined && last.jevMs !== undefined && now - (last.at + last.jevMs) < SWEEP_MS + FRAME_MS) return true
  return list.some(one => one.status === 'running')
}

/** After the person corrects a turn, the tier that turn ran on, so the next one does not go below it. */
function correctionFloorOf(
  previous: RoutingDecision | undefined,
  reaction: Feedback | null,
  routing: MainRouting,
): Tier | null {
  if (previous === undefined || reaction !== 'correction') return null
  if (previous.escalatedTo !== undefined) return previous.escalatedTo
  if (routing === 'effort') return tierForEffort(previous.actualEffort)
  return previous.actualModel === undefined ? null : tierCovering(previous.actualModel, previous.actualEffort)
}

type EscalationState = { signals: Map<string, Signals>; raisedTurns: Set<string> }

/** Raises the turn's plan one tier once its tool calls keep failing; later steps of the turn use it. */
async function escalateIfStruggling(
  $: EngineInterface,
  state: EscalationState,
  call: { tool: string; filePath?: string; isError: boolean },
  configured: Mode,
  routing: MainRouting,
): Promise<void> {
  const planned = await read($, plan)
  if (planned === null || state.raisedTurns.has(planned.turnId)) return
  const updated = recordToolOutcome(state.signals.get(planned.turnId) ?? NO_SIGNALS, call)
  state.signals.set(planned.turnId, updated)
  if (!isStruggling(updated)) return
  // One raise per turn: every switch costs the prompt cache.
  state.raisedTurns.add(planned.turnId)
  const raised = raisePlan(planned, routing)
  if (raised === null || (await modeOf($, configured)) !== 'route') return
  await update($, plan, (): MainPlan | null => raised)
  await patch($, planned.turnId, {
    escalatedTo: raised.tier,
    applied: `${runLabel(raised.model, raised.effort)} (raised)`,
  })
}

/** `sonnet · high` for a full model id and an effort. */
function runLabel(model: string, effort: string): string {
  return `${['haiku', 'sonnet', 'opus'][modelRank(model)] ?? model} · ${effort}`
}

/** What turn.start learned about a main turn; turn.step resolves it once it sees the model the turn would run on. */
type PendingMain = Omit<MainInputs, 'thresholds' | 'floor' | 'routing'> & { turnId: string }

type QualityState = { edits: Map<string, EditEntry & { files: Set<string> }>; runOrder: string[] }

/** Test and lint runs go to the decision that made them; an edit of a file edited earlier flags that decision as rework. */
async function observeQuality(
  $: EngineInterface,
  state: QualityState,
  owner: RoutingDecision,
  call: { tool: string; command?: string; filePath?: string; isError: boolean },
): Promise<void> {
  if (call.tool === 'Bash' && call.command !== undefined && isTestCommand(call.command)) {
    await annotate($, owner.id, { tests: recordTestRun(owner.tests, call.isError) })
  }
  if (!isEditTool(call.tool) || call.filePath === undefined || owner.runId === null) return
  if (owner.scope === 'main') {
    for (const id of reworkTargets([...state.edits.values()], state.runOrder, owner.runId, call.filePath)) {
      await annotate($, id, { rework: true })
    }
  }
  const entry = state.edits.get(owner.id) ?? { id: owner.id, runId: owner.runId, scope: owner.scope, files: new Set<string>() }
  entry.files.add(call.filePath)
  state.edits.set(owner.id, entry)
}

/** How sure Jev must be of its reading of the previous turn before it labels that turn. */
const FEEDBACK_MIN_CONFIDENCE = 0.6

export const register: Register = (on, options) => {
  const thresholds: Thresholds = {
    up: typeof options.minUpgradeConfidence === 'number' ? options.minUpgradeConfidence : 0.3,
    down: typeof options.minDowngradeConfidence === 'number' ? options.minDowngradeConfidence : 0.6,
  }
  const riskyThreshold = typeof options.riskyThreshold === 'number' ? options.riskyThreshold : 0.7
  const mainRouting: MainRouting = options.mainRouting === 'effort' ? 'effort' : 'model'
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 2000
  const defaultTier: Tier = isTier(options.defaultTier) ? options.defaultTier : 'default'
  const configuredMode: Mode = isMode(options.mode) ? options.mode : 'route'
  // Until the threshold is calibrated, Jev may not take the main chat below this tier; 'none' lifts it.
  const mainFloor: Tier | null = options.mainFloor === 'none' ? null : isTier(options.mainFloor) ? options.mainFloor : 'deep'
  // Prompts only feed the persisted log; losing them on a reload trims that log's text, nothing else.
  const prompts = new Map<string, string>()
  // A reload between a turn's start and its first step leaves that one turn unrouted.
  const pendingMain = new Map<string, PendingMain>()
  // Per main-chat turn; a reload restarts the count, which only delays an escalation.
  const escalation: EscalationState = { signals: new Map(), raisedTurns: new Set() }
  // Files each decision edited, to spot the next runs editing them again. A reload only forgets older edits,
  // which at worst misses a rework flag.
  const quality: QualityState = { edits: new Map(), runOrder: [] }

  on('session.start', async ($, e, next) => {
    for (const tier of TIER_ORDER) {
      const spec = TIERS[tier]
      await $.agent.register({
        name: spec.agent,
        description: `General-purpose subagent on ${spec.model} at ${spec.effort} effort (${tier} tier).`,
        prompt: TIER_PROMPT,
        model: spec.model,
        effort: spec.effort,
      })
    }
    await $.command.register({ name: 'stack', description: `Model stack pane: ${USAGE}` })
    $.clock.every(FRAME_MS, async () => {
      const now = await $.clock.now()
      if (isAnimating(await read($, decisions), await read($, jevAskedAt), now)) {
        await update($, tick, () => now)
      }
    })
    void $.ui.open({ id: PANE, title: 'Model stack' })

    return next(e)
  })

  on('command.run', { command: 'stack' }, async ($, e) => {
    const [verb, arg] = e.args.trim().split(/\s+/)
    if (verb === 'details' || verb === 'overview') {
      await update($, view, (): View => verb)
    } else if (verb === 'mode') {
      if (!isMode(arg)) return { text: 'Usage: /stack mode off|recommend|route' }
      await update($, modeOverride, (): Mode => arg)
      await $.ui.open({ id: PANE, title: 'Model stack' })
      return { text: `Model stack mode: ${arg} (this session).` }
    } else if (verb === 'export') {
      const now = await $.clock.now()
      const home = (await $.env.get('HOME')) ?? '.'
      const path = `${home}/.claude/model-stack/exports/decisions-${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`
      const payload = { exportedAt: new Date(now).toISOString(), runs: await read($, runs), decisions: await read($, decisions) }
      await $.fs.write(path, JSON.stringify(payload, null, 2))
      return { text: `Decisions exported to ${path}` }
    } else if (verb === 'good' || verb === 'bad') {
      const target = (await read($, decisions)).filter(one => one.scope === 'main' && one.status !== 'running').at(-1)
      if (target === undefined) return { text: 'No finished main-chat decision to label yet.' }
      const note = e.args.trim().slice(verb.length).trim()
      await annotate($, target.id, {
        feedback: verb === 'good' ? 'manual_good' : 'manual_bad',
        ...(note !== '' && { feedbackNote: note }),
      })
      return { text: `Marked "${target.description.slice(0, 40)}" as ${verb}.` }
    } else if (verb !== undefined && verb !== '') {
      return { text: `Usage: ${USAGE}` }
    }
    await $.ui.open({ id: PANE, title: 'Model stack' })
    return { text: 'Model stack pane opened.' }
  })

  on('turn.start', async ($, e, next) => {
    const at = await $.clock.now()
    const run: Run = { id: e.turnId, at, text: e.text.slice(0, RUN_TEXT_CHARS) }
    await update($, currentRun, () => e.turnId)
    await update($, runs, list => [...list, run].slice(-RUN_LIMIT))
    await update($, plan, (): MainPlan | null => null)
    quality.runOrder.push(e.turnId)
    if (quality.runOrder.length > RUN_LIMIT) quality.runOrder.shift()
    for (const [id, entry] of quality.edits) {
      if (entry.runId !== null && !quality.runOrder.includes(entry.runId)) quality.edits.delete(id)
    }

    const mode = await modeOf($, configuredMode)
    if (mode === 'off') return next(e)

    // The turn before this one is what the prompt reacts to; engine-injected prompts are not a reaction.
    const previousMain = isInjectedPrompt(e.text)
      ? undefined
      : (await read($, decisions)).filter(one => one.scope === 'main' && one.status !== 'running').at(-1)
    let reaction: Feedback | null = classifyFollowUp(e.text)

    const base: RoutingDecision = {
      id: e.turnId,
      at,
      scope: 'main',
      runId: e.turnId,
      description: e.text.trim().replace(/\s+/g, ' ').slice(0, RUN_TEXT_CHARS) || '(continuação)',
      subagentType: 'main',
      requestedModel: null,
      tier: null,
      probabilities: {},
      confidence: null,
      verdict: 'skipped',
      mode,
      applied: 'as picked',
      status: 'running',
    }

    let decision = base
    let jev: JevAnswer | null = null
    const apiKey = await $.env.get('TYPESAFE_API_KEY')
    if (skipMainPrompt(e.text)) {
      decision = { ...base, reason: 'prompt curto: mantém o modelo atual' }
    } else if (!apiKey) {
      decision = { ...base, verdict: 'fallback', reason: 'TYPESAFE_API_KEY not set' }
    } else {
      const asked = await askJev(
        $,
        {
          apiKey,
          scope: 'main',
          prompt: e.text,
          description: base.description,
          subagentType: 'main',
          history: await pastResults($),
          ...(previousMain !== undefined && {
            previousTurn: { summary: previousMain.description, status: previousMain.status },
          }),
        },
        timeoutMs,
      )
      jev = asked.answer
      if (jev?.previous != null) {
        reaction = feedbackFromJev(jev.previous.choice, jev.previous.confidence, FEEDBACK_MIN_CONFIDENCE) ?? reaction
      }
      decision = {
        ...base,
        tier: jev?.choice ?? null,
        probabilities: jev?.probabilities ?? {},
        confidence: jev?.confidence ?? null,
        jevConfidence: jev?.reported ?? null,
        why: jev?.why ?? undefined,
        jevMs: asked.ms,
        risk: jev?.risk ?? null,
        verdict: jev === null ? 'fallback' : 'doubt',
      }
    }
    // A prompt Jev was not asked about still may not drop below a corrected turn.
    const correctionFloor = correctionFloorOf(previousMain, reaction, mainRouting)
    if (correctionFloor !== null) decision = { ...decision, correctionFloor }
    pendingMain.set(e.turnId, {
      turnId: e.turnId,
      jev,
      correctionFloor,
      risky: jev?.risk != null && jev.risk >= riskyThreshold,
    })

    await update($, decisions, list => [...list, decision].slice(-SESSION_LIMIT))
    prompts.set(decision.id, e.text)
    if (previousMain !== undefined) await recordFollowUp($, previousMain.id, reaction)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const pending = e.agentId === undefined ? pendingMain.get(e.turnId) : undefined
    if (pending !== undefined) {
      pendingMain.delete(e.turnId)
      // Up or down depends on what the turn would run on, which only the step knows.
      const resolved = resolveMain(e, { ...pending, thresholds, floor: mainFloor, routing: mainRouting })
      const route = (await modeOf($, configuredMode)) === 'route' && resolved.run !== null
      if (route && resolved.run !== null) {
        const run = resolved.run
        await update($, plan, (): MainPlan | null => ({ turnId: e.turnId, ...run }))
      }
      await patch($, e.turnId, {
        ...(pending.jev !== null && { verdict: resolved.verdict }),
        ...(resolved.needed !== null && { neededConfidence: resolved.needed }),
        applied: route && resolved.run !== null ? runLabel(resolved.run.model, resolved.run.effort) : 'as picked',
      })
    }
    const request = applyPlan(e, e.agentId === undefined ? await read($, plan) : null)
    if (e.agentId === undefined && e.index === 0) {
      await patch($, e.turnId, {
        actualModel: request.model,
        ...(typeof request.effort === 'string' && { actualEffort: request.effort }),
      })
    }
    return yield* next(request)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    try {
      const input: Record<string, unknown> = e
      const call = {
        tool: e.tool,
        command: typeof input.command === 'string' ? input.command : undefined,
        filePath: typeof input.file_path === 'string' ? input.file_path : undefined,
        isError: result.isError === true,
      }
      if (e.agentId !== undefined) {
        const owner = (await read($, decisions)).find(one => one.agentId === e.agentId)
        if (owner !== undefined) {
          await patch($, owner.id, {
            lastAction: describeAction(e as { tool: string } & Record<string, unknown>),
            lastActionAt: await $.clock.now(),
          })
          await observeQuality($, quality, owner, call)
        }
      } else {
        await escalateIfStruggling($, escalation, call, configuredMode, mainRouting)
        const turn = (await read($, decisions)).find(one => one.id === (quality.runOrder.at(-1) ?? '') && one.scope === 'main')
        if (turn !== undefined) await observeQuality($, quality, turn, call)
      }
    } catch {
      // Observing the call never blocks it.
    }
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const facts = {
      subagentType: e.subagentType,
      requestedModel: e.model ?? null,
      isFork: e.fork,
      isTeammate: e.isTeammate === true,
    }
    const mode = await modeOf($, configuredMode)

    const base: RoutingDecision = {
      id: e.tool_use_id,
      at: await $.clock.now(),
      scope: 'subagent',
      runId: await read($, currentRun),
      description: e.description,
      subagentType: e.subagentType,
      parentAgentId: e.parentAgentId,
      requestedModel: facts.requestedModel,
      tier: null,
      probabilities: {},
      confidence: null,
      verdict: 'skipped',
      mode,
      applied: 'as requested',
      status: 'running',
    }

    let decision = base
    let rewritten = e
    if (mode !== 'off' && shouldRoute(facts)) {
      const apiKey = await $.env.get('TYPESAFE_API_KEY')
      const asked = apiKey
        ? await askJev(
            $,
            {
              apiKey,
              scope: 'subagent',
              prompt: e.prompt,
              description: e.description,
              subagentType: e.subagentType,
              history: await pastResults($),
            },
            timeoutMs,
          )
        : null
      const jev = asked?.answer ?? null
      const risky = jev?.risk != null && jev.risk >= riskyThreshold
      const decided = decide(facts, jev, thresholds, defaultTier, risky)
      const outcome = mode === 'route' ? decided : asRecommendation(decided)
      decision = {
        ...base,
        tier: jev?.choice ?? outcome.tier,
        probabilities: jev?.probabilities ?? {},
        confidence: jev?.confidence ?? null,
        jevConfidence: jev?.reported ?? null,
        why: jev?.why ?? undefined,
        jevMs: asked?.ms,
        risk: jev?.risk ?? null,
        verdict: outcome.verdict,
        applied: outcome.applied,
        reason: apiKey ? undefined : 'TYPESAFE_API_KEY not set',
      }
      rewritten = {
        ...e,
        ...(outcome.subagentType !== undefined && { subagentType: outcome.subagentType }),
        ...(outcome.model !== undefined && { model: outcome.model }),
      }
    }

    await update($, decisions, list => [...list, decision].slice(-SESSION_LIMIT))
    prompts.set(decision.id, e.prompt)

    const result = await next(rewritten)
    if (result.deny !== undefined) {
      await patch($, decision.id, { status: 'refused', reason: result.deny })
    } else if (result.agentId !== undefined) {
      await patch($, decision.id, { agentId: result.agentId, actualModel: result.model })
    }
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    const list = await read($, decisions)
    const match =
      e.agentId === undefined
        ? list.find(one => one.id === e.turnId && one.scope === 'main')
        : list.find(one => one.agentId === e.agentId && one.status === 'running')
    if (match === undefined) return result

    const status = e.isAborted ? 'aborted' : e.reason === 'answer' ? 'done' : 'error'
    const finished = await patch($, match.id, {
      status,
      outcome: deriveOutcome({ ...match, status }),
      durationMs: e.durationMs,
      inputTokens: e.usage?.input_tokens,
      // The last response's model: after an escalation it is the raised one.
      ...(e.usage?.model !== undefined && { actualModel: e.usage.model }),
      outputTokens: e.usage?.output_tokens,
      cacheReadTokens: e.usage?.cache_read_input_tokens,
      cacheCreationTokens: e.usage?.cache_creation_input_tokens,
    })
    escalation.signals.delete(match.id)
    escalation.raisedTurns.delete(match.id)
    if (finished !== undefined) {
      await persist($, finished, prompts.get(match.id) ?? '')
      prompts.delete(match.id)
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    return paneTree($.ui.resolve(e), {
      list: await read($, decisions),
      currentRun: await read($, currentRun),
      view: await read($, view),
      mode: await modeOf($, configuredMode),
      jevAskedAt: await read($, jevAskedAt),
      // Reading `tick` redraws the pane every frame while something on it moves.
      now: Math.max(await read($, tick), await $.clock.now()),
      thresholds,
      columns: e.viewport?.columns ?? 100,
      rows: e.viewport?.rows ?? 40,
    })
  })
}
