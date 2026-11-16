/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
// neon-hud: one band above the prompt with context fill, plan limits, tool calls
// per turn, session stats and the next-step suggestions (next-lite's logic).
// Replaces usage-weather and next-lite.

import type { EngineInterface, Register, RenderElement } from 'claude-code'

import {
  buildPrompt,
  commandNames,
  parseSuggestions,
  pushTrail,
  type Suggestion,
  SYSTEM,
  trailLine,
  type TurnDigest,
  worthSuggesting,
} from './digest'
import { type ContextFill, HISTORY, type Hud, hudLine, hudSvg, joiLine, type Limit, TOOL_TURNS } from './hud'

type View = { kind: 'hidden' } | { kind: 'loading'; token: number } | { kind: 'offer'; items: Suggestion[] }
type Settings = { model: string; suggestsSkills: boolean }

const TIMEOUT_MS = 15_000
const MAX_REPLY_TOKENS = 400
const MAX_DESKTOP_LABEL = 32
const TICK_MS = 30_000

// Session-local; a hot reload starts the counters over.
let sessionStart = 0
let context: ContextFill | null = null
let history: number[] = []
let limits: Limit[] = []
let toolsPerTurn: number[] = []
let toolCalls = 0
let turns = 0
let failed = 0
let lastTurnMs: number | null = null
let turnStartedAt = 0
let turnTools = 0
let currentTool: string | null = null
let isHidden = false

let view: View = { kind: 'hidden' }
let request = ''
let trail: string[] = []
let lastTurn: TurnDigest | null = null
let token = 0

const redraw = ($: EngineInterface): void => $.ui.invalidate('ui.render')

function show($: EngineInterface, nextView: View): void {
  view = nextView
  redraw($)
}

function shortLabel(label: string): string {
  const points = [...label]
  return points.length > MAX_DESKTOP_LABEL ? `${points.slice(0, MAX_DESKTOP_LABEL - 1).join('').trimEnd()}…` : label
}

function fill($: EngineInterface, item: Suggestion): void {
  show($, { kind: 'hidden' })
  void $.prompt.fill({ text: item.prompt }).then(
    r => r.isFilled || $.ui.toast('could not fill the prompt box'),
    error => $.ui.toast(`could not fill: ${String(error)}`),
  )
}

async function measure($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  sessionStart = usage.startedAt
  limits = usage.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
  const c = usage.context
  if (c.window <= 0 || c.tokens === undefined) return
  const b = c.breakdown
  const parts = { messages: 0, system: 0, other: 0 }
  if (b !== undefined && b.maxTokens > 0) {
    for (const row of b.categories) {
      if (row.kind !== 'used') continue
      const share = (row.tokens / b.maxTokens) * 100
      // shortcut: /context labels are the only way to split rows; a renamed label lands in "other".
      if (row.name === 'Messages') parts.messages += share
      else if (row.name === 'System tools') parts.system += share
      else parts.other += share
    }
  }
  context = { percent: c.percent ?? Math.round((c.tokens / c.window) * 100), tokens: c.tokens, window: c.window, ...parts }
}

async function suggest($: EngineInterface, digest: TurnDigest, settings: Settings): Promise<void> {
  const mine = ++token
  show($, { kind: 'loading', token: mine })
  let items: Suggestion[] = []
  try {
    const commands = await $.command.list().catch(() => null)
    const custom = commands?.filter(command => command.source !== 'builtin').map(command => command.name) ?? []
    const known = commands === null ? null : new Set(commands.map(command => command.name))
    const reply = await $.model.complete({
      model: settings.model,
      system: [{ text: SYSTEM, cache: true }],
      prompt: buildPrompt(digest, settings.suggestsSkills ? commandNames(custom) : ''),
      maxTokens: MAX_REPLY_TOKENS,
      effort: 'low',
      timeoutMs: TIMEOUT_MS,
    })
    items = reply.isAnswered ? parseSuggestions(reply.text, known) : []
  } catch (error) {
    $.ui.log(`suggestion failed: ${String(error)}`)
  }
  // A newer turn started, or another request was made, while this one waited.
  if (view.kind !== 'loading' || view.token !== mine) return
  show($, items.length === 0 ? { kind: 'hidden' } : { kind: 'offer', items })
  if (items[0] !== undefined) void $.prompt.suggest({ text: items[0].prompt }).catch(() => undefined)
}

export const register: Register = (on, options) => {
  const mode = options?.mode === 'manual' ? 'manual' : 'auto'
  const minAnswerChars = typeof options?.minAnswerChars === 'number' ? options.minAnswerChars : 200
  const settings: Settings = {
    model: typeof options?.model === 'string' && options.model !== '' ? options.model : 'sonnet',
    suggestsSkills: options?.suggestSkills !== false,
  }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // A command another plugin (next-lite) already holds is refused; the band still loads.
    for (const command of [
      { name: 'next', description: 'Suggest next prompts from the last turn (neon-hud)' },
      { name: 'hud', description: 'Show or hide the neon HUD band' },
    ]) {
      await $.command.register(command).catch(error => $.ui.log(`command not registered: ${String(error)}`))
    }
    await measure($).catch(error => $.ui.log(`measure failed: ${String(error)}`))
    // Keeps the clock and uptime current between turns.
    $.clock.every(TICK_MS, () => redraw($))
    redraw($)
    return result
  })

  on('command.run', { command: 'hud' }, async $ => {
    isHidden = !isHidden
    redraw($)
    return { text: isHidden ? 'HUD hidden.' : 'HUD shown.' }
  })

  on('command.run', { command: 'next' }, async $ => {
    if (lastTurn === null) return { text: 'neon-hud: no finished turn to suggest from yet.' }
    void suggest($, lastTurn, settings)
    return { text: 'neon-hud: suggesting from the last turn.' }
  })

  on('session.measure', async ($, e, next) => {
    limits = e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
    redraw($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      turnStartedAt = await $.clock.now()
      turnTools = 0
      request = e.text
      trail = []
      token++
      view = { kind: 'hidden' }
      redraw($)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const isMain = e.agentId === undefined
    if (isMain) {
      currentTool = trailLine(e.tool, e as unknown as Readonly<Record<string, unknown>>, false)
      redraw($)
    }
    const result = await next(e).finally(() => {
      if (isMain) currentTool = null
    })
    if (isMain) {
      const isError = result.deny !== undefined || result.isError === true
      toolCalls++
      turnTools++
      if (isError) failed++
      trail = pushTrail(trail, trailLine(e.tool, e as unknown as Readonly<Record<string, unknown>>, isError))
      redraw($)
    }
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    turns++
    lastTurnMs = (await $.clock.now()) - turnStartedAt
    toolsPerTurn = [...toolsPerTurn, turnTools].slice(-TOOL_TURNS)
    await measure($).catch(error => $.ui.log(`measure failed: ${String(error)}`))
    if (context !== null) history = [...history, context.percent].slice(-HISTORY)
    redraw($)
    if (e.reason === 'answer') {
      lastTurn = { request, answer: e.answer, trail }
      if (mode === 'auto' && worthSuggesting(lastTurn, minAnswerChars)) void suggest($, lastTurn, settings)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next): Promise<RenderElement> => {
    const below = await next(e)
    if (e.props.hasSurvey || isHidden) return below
    const now = await $.clock.now()
    const hud: Hud = {
      now,
      context,
      history,
      limits,
      toolsPerTurn,
      toolCalls,
      turns,
      lastTurnMs,
      failed,
      uptimeMs: sessionStart === 0 ? 0 : now - sessionStart,
      isWorking: e.props.isWorking,
      message: joiLine(
        limits,
        lastTurnMs,
        toolsPerTurn.at(-1) ?? 0,
        now,
        e.props.isWorking
          ? { elapsedMs: turnStartedAt === 0 ? null : now - turnStartedAt, tools: turnTools, tool: currentTool ?? trail.at(-1) ?? null }
          : null,
      ),
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const offersNext = !e.props.isWorking && view.kind !== 'hidden'
    const dismiss = () => show($, { kind: 'hidden' })

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {below}
          <Svg source={hudSvg(hud)} alt={hudLine(hud)} />
          {offersNext && (
            <Box flexDirection="row" alignItems="center" gap="sm" marginTop="xs" paddingX="md" paddingY="sm" borderStyle="round" borderColor="subtle">
              <Text size="caption" weight="medium" dimColor>
                {view.kind === 'loading' ? 'Pensando nos próximos passos…' : 'Próximos'}
              </Text>
              {view.kind === 'offer' && (
                <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="xs" flexGrow={1}>
                  {view.items.map((item, index) => (
                    <Button key={`s${index}`} hotkey={String(index + 1)} label={shortLabel(item.label)} onPress={() => fill($, item)} />
                  ))}
                </Box>
              )}
              <Button key="dismiss" hotkey="0" role="dismiss" label="Dispensar" onPress={dismiss} />
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {below}
        <Text color="warning">{hudLine(hud)}</Text>
        {offersNext && view.kind === 'loading' && <Text dimColor>próximos…</Text>}
        {offersNext && view.kind === 'offer' && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
            <Text dimColor>próximos:</Text>
            {view.items.map((item, index) => (
              <Button key={`s${index}`} hotkey={String(index + 1)} plain label={item.label} onPress={() => fill($, item)} />
            ))}
            <Button key="dismiss" hotkey="0" plain label="dispensar" onPress={dismiss} />
          </Box>
        )}
      </Box>
    )
  })
}
