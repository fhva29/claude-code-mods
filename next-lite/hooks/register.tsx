/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
// next-lite: when a main-loop turn ends, send a small digest of it (the typed
// request, the tool calls it made, the answer's head and tail) to a cheap model
// and offer up to three next prompts as 1/2/3 buttons above the composer. A
// press fills the composer as a draft; 0 dismisses; the top one is also the
// Tab-to-take ghost text. Unlike next-steps it never forks the session, so the
// cost of a suggestion does not grow with the conversation.

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

type View = { kind: 'hidden' } | { kind: 'loading'; token: number } | { kind: 'offer'; items: Suggestion[] }

type Settings = { model: string; suggestsSkills: boolean }

const TIMEOUT_MS = 15_000
const MAX_REPLY_TOKENS = 400

// Session-local; a hot reload forgets the turn in flight, which only skips one suggestion.
let view: View = { kind: 'hidden' }
let request = ''
let trail: string[] = []
let lastTurn: TurnDigest | null = null
let token = 0

function show($: EngineInterface, nextView: View): void {
  view = nextView
  $.ui.invalidate('ui.render')
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
    await $.command.register({ name: 'next', description: 'Suggest next prompts from the last turn (next-lite)' })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    request = e.text
    trail = []
    token++
    if (view.kind !== 'hidden') show($, { kind: 'hidden' })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const input = e as unknown as Readonly<Record<string, unknown>>
      trail = pushTrail(trail, trailLine(e.tool, input, result.deny !== undefined || result.isError === true))
    }
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return result
    lastTurn = { request, answer: e.answer, trail }
    if (mode === 'auto' && worthSuggesting(lastTurn, minAnswerChars)) void suggest($, lastTurn, settings)
    return result
  })

  on('command.run', { command: 'next' }, async $ => {
    if (lastTurn === null) return { text: 'next-lite: no finished turn to suggest from yet.' }
    void suggest($, lastTurn, settings)
    return { text: 'next-lite: suggesting from the last turn.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next): Promise<RenderElement> => {
    const below = await next(e)
    if (e.props.hasSurvey || e.props.isWorking || view.kind === 'hidden') return below
    const { Box, Text, Button } = $.ui.resolve(e)

    if (view.kind === 'loading') {
      return (
        <Box flexDirection="column">
          {below}
          <Box marginTop={1}>
            <Text dimColor>next…</Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {below}
        <Box marginTop={1} />
        <Text dimColor>next:</Text>
        {view.items.map((item, index) => (
          <Box key={`s${index}`} marginLeft={2}>
            <Button
              hotkey={String(index + 1)}
              plain
              label={item.label}
              onPress={() => {
                show($, { kind: 'hidden' })
                void $.prompt.fill({ text: item.prompt }).then(
                  r => r.isFilled || $.ui.toast('could not fill the prompt box'),
                  error => $.ui.toast(`could not fill: ${String(error)}`),
                )
              }}
            />
          </Box>
        ))}
        <Box marginLeft={2}>
          <Button hotkey="0" plain label="dismiss" onPress={() => show($, { kind: 'hidden' })} />
        </Box>
      </Box>
    )
  })
}
