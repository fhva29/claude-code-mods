import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  clipLines,
  diffOf,
  dotColor,
  lineFor,
  MAX_OUTPUT_LINES,
  outputTextOf,
  ROW_INDENT,
} from './lines'
import type { Tone } from './lines'

const COMMAND = 'lines'
const ENABLED_KEY = 'enabled'
const MODE_KEY = 'mode'
// `lines` draws one compact row per call; `turn` folds a whole turn into one openable row.
const MODES = ['lines', 'turn', 'off'] as const
type Mode = (typeof MODES)[number]
// Enough to cover every row a transcript keeps drawn; older rows simply lose their duration.
const MAX_TIMINGS = 300
// The viewport is absent until the terminal has been measured.
const FALLBACK_COLUMNS = 120

// The theme has no neutral panel color, so the opened output uses a fixed dark panel.
const OUTPUT_BACKGROUND = '#262b33'
const OUTPUT_FOREGROUND = '#c9d1d9'

// Theme keys, so the colors follow the person's theme.
const TONE_STYLE: Record<Tone, { dimColor?: boolean; color?: string }> = {
  dim: { dimColor: true },
  added: { color: 'success' },
  removed: { color: 'error' },
}

const timings = atom({ plugin: 'tidy-tools', key: 'timings' } as const, [])
// tool_use_ids whose output the person opened by clicking the tool name.
const expanded = atom({ plugin: 'tidy-tools', key: 'expanded' } as const, [])
// Which turn each main-loop call ran in, in call order, so a turn's rows can tell who comes first.
const turnOf = atom({ plugin: 'tidy-tools', key: 'turnOf' } as const, [])
// turnIds whose calls the person opened out of the one-line summary.
const openTurns = atom({ plugin: 'tidy-tools', key: 'openTurns' } as const, [])
// tool_use_ids of main-loop calls that errored, were refused or threw.
const failed = atom({ plugin: 'tidy-tools', key: 'failed' } as const, [])
const currentTurn = atom({ plugin: 'tidy-tools', key: 'currentTurn' } as const, '')

// Module variables start over on a reload; session.start fires again and restores them.
let mode: Mode = 'lines'
let sessionCwd = ''
// Tool rows don't say whether the ctrl+o transcript (or --verbose) is open, but the person's own
// prompt rows do; their flag is mirrored here so every tool site leaves that view to the engine.
let isExpandedView = false

function isCompact(surface: string): boolean {
  return mode !== 'off' && surface === 'terminal' && !isExpandedView
}

async function recordTiming($: EngineInterface, id: string, ms: number): Promise<void> {
  await update($, timings, list => [...list.filter(one => one.id !== id), { id, ms }].slice(-MAX_TIMINGS))
}

async function durationOf($: EngineInterface, id: string): Promise<number | undefined> {
  const list = await read($, timings)
  return list.find(one => one.id === id)?.ms
}

function parseMode(value: unknown): Mode | undefined {
  return MODES.find(one => one === value)
}

// Older versions saved a boolean under `enabled`; honour it until a mode has been chosen.
async function loadMode($: EngineInterface): Promise<Mode> {
  const saved = parseMode(await $.store.get(MODE_KEY))
  if (saved !== undefined) return saved
  return (await $.store.get(ENABLED_KEY)) === false ? 'off' : 'lines'
}

const MODE_TEXT: Record<Mode, string> = {
  lines: 'Compact tool lines: one row per call.',
  turn: 'Compact tool lines: one row per turn (press it to open).',
  off: 'Compact tool lines off.',
}

async function isTurnOpen($: EngineInterface, id: string): Promise<boolean> {
  const turn = await turnFor($, id)
  return (await read($, openTurns)).includes(turn.id)
}

async function turnFor($: EngineInterface, id: string): Promise<{ id: string }> {
  const known = (await read($, turnOf)).find(one => one.id === id)
  return { id: known?.turn ?? (await read($, currentTurn)) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    sessionCwd = e.cwd
    mode = await loadMode($)
    await $.command.register({
      name: COMMAND,
      description: 'Cycle tool rows: lines, turn, off (or /lines <mode>)',
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const asked = parseMode(e.args.trim())
    if (e.args.trim() !== '' && asked === undefined) {
      return { text: `Unknown mode "${e.args.trim()}". Use: ${MODES.join(', ')}.` }
    }
    mode = asked ?? MODES[(MODES.indexOf(mode) + 1) % MODES.length]
    await $.store.set(MODE_KEY, mode)
    $.ui.invalidate('ui.render')
    return { text: MODE_TEXT[mode] }
  })

  on('turn.start', async ($, e, next) => {
    await update($, currentTurn, () => e.turnId)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now()
    if (e.agentId === undefined) {
      const turn = await read($, currentTurn)
      await update($, turnOf, list =>
        [...list.filter(one => one.id !== e.tool_use_id), { id: e.tool_use_id, turn }].slice(-MAX_TIMINGS),
      )
    }
    let isFailed = false
    try {
      const result = await next(e)
      isFailed = result.deny !== undefined || result.isError === true
      return result
    } catch (error) {
      isFailed = true
      throw error
    } finally {
      // Recorded before the timing, which is what redraws the summary as finished.
      if (isFailed && e.agentId === undefined) {
        await update($, failed, list => [...list.filter(id => id !== e.tool_use_id), e.tool_use_id].slice(-MAX_TIMINGS))
      }
      await recordTiming($, e.tool_use_id, (await $.clock.now()) - startedAt)
    }
  }).catch(($, e, next) => next(e))

  on(
    'ui.render',
    { component: 'UserMessage', props: { origin: { kind: 'composer' } } },
    async ($, e, next) => {
      if (e.surface === 'terminal' && e.props.isExpanded !== isExpandedView) {
        isExpandedView = e.props.isExpanded
        // Tool rows keep their last answer until asked again, so the switch has to redraw them.
        $.ui.invalidate('ui.render')
      }
      if (!isCompact(e.surface)) return next(e)
      // Compact rows carry no margins of their own, so the prompt keeps a blank line off the calls below it.
      const { Box } = $.ui.resolve(e)
      return Box({ flexDirection: 'column', marginBottom: 1, children: [await next(e)] })
    },
  )

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!isCompact(e.surface)) return next(e)
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const compact = async () => {
      const line = lineFor(e.props, {
        columns: e.viewport?.columns ?? FALLBACK_COLUMNS,
        cwd: sessionCwd,
        durationMs: await durationOf($, e.props.tool_use_id),
      })
      const id = e.props.tool_use_id
      const diff = diffOf(e.props)
      const output = diff === undefined ? outputTextOf(e.props) : undefined
      const hasDetail = diff !== undefined || output !== undefined
      const isOpen = hasDetail && (await read($, expanded)).includes(id)
      const filePath = (e.props.input as { file_path?: unknown } | null)?.file_path
      const toggle = (): void => {
        void update($, expanded, list =>
          list.includes(id) ? list.filter(one => one !== id) : [...list, id],
        )
      }
      const row = Box({
        flexDirection: 'row',
        marginLeft: ROW_INDENT,
        children: [
          Box({
            minWidth: 2,
            flexShrink: 0,
            children: [Text({ color: dotColor(e.props), children: ['●'] })],
          }),
          // Only a finished call with output has something to open.
          !hasDetail
            ? Text({ bold: true, children: [line.tool] })
            : Button({ key: 'toggle', label: line.tool, plain: true, onPress: toggle }),
          Text({
            wrap: 'truncate-end',
            children: [
              '(',
              ...(line.subjectDir === '' ? [] : [Text({ dimColor: true, children: [line.subjectDir] })]),
              line.subjectName,
              ')',
              ...line.tail.map(span => Text({ ...TONE_STYLE[span.tone], children: [span.text] })),
              ...(line.status === ''
                ? []
                : [Text({ color: 'error', children: [` - ${line.status}`] })]),
            ],
          }),
        ],
      })
      if (!isOpen) return row
      if (diff !== undefined) {
        return Box({
          flexDirection: 'column',
          children: [
            row,
            Box({
              marginLeft: ROW_INDENT + 2,
              flexDirection: 'column',
              children: [
                Code({
                  source: diff.source,
                  format: 'diff',
                  path: typeof filePath === 'string' ? filePath : undefined,
                }),
                ...(diff.hiddenLines === 0
                  ? []
                  : [Text({ dimColor: true, children: [`… ${diff.hiddenLines} more lines`] })]),
              ],
            }),
          ],
        })
      }
      return Box({
        flexDirection: 'column',
        children: [
          row,
          Box({
            marginLeft: ROW_INDENT + 2,
            paddingX: 1,
            backgroundColor: OUTPUT_BACKGROUND,
            children: [
              Text({ color: OUTPUT_FOREGROUND, children: [clipLines(output ?? '', MAX_OUTPUT_LINES)] }),
            ],
          }),
        ],
      })
    }
    if (mode !== 'turn') return compact()
    const turn = await turnFor($, e.props.tool_use_id)
    const members = (await read($, turnOf)).filter(one => one.turn === turn.id)
    const isFirst = (members[0]?.id ?? e.props.tool_use_id) === e.props.tool_use_id
    const isOpen = (await read($, openTurns)).includes(turn.id)
    if (!isFirst) return isOpen ? compact() : Box({})
    const finished = await read($, timings)
    const pending = members.filter(one => !finished.some(done => done.id === one.id)).length
    const count = Math.max(members.length, 1)
    const failedIds = await read($, failed)
    const failures = members.filter(one => failedIds.includes(one.id)).length
    const toggle = (): void => {
      void update($, openTurns, list =>
        list.includes(turn.id) ? list.filter(one => one !== turn.id) : [...list, turn.id],
      )
    }
    const summary = Box({
      flexDirection: 'row',
      marginLeft: ROW_INDENT,
      children: [
        Box({
          minWidth: 2,
          flexShrink: 0,
          children: [Text({ color: pending > 0 ? 'warning' : failures > 0 ? 'error' : undefined, dimColor: pending === 0 && failures === 0, children: [pending > 0 || failures > 0 ? '●' : '○'] })],
        }),
        Button({
          key: 'turn-toggle',
          label: `${count} ${count === 1 ? 'step' : 'steps'} this turn ${isOpen ? '⌄' : '›'}`,
          plain: true,
          onPress: toggle,
        }),
        ...(failures === 0 ? [] : [Text({ color: 'error', children: [`  ✗ ${failures} failed`] })]),
      ],
    })
    if (!isOpen) return summary
    return Box({ flexDirection: 'column', children: [summary, await compact()] })
  })

  // Unfolding hands each grouped read or search to the ToolUse hook, so it gets its own line.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!isCompact(e.surface)) return next(e)
    return next({ ...e, props: { ...e.props, isExpanded: true } })
  })

  // The compact line already carries what a successful result block would say; errors stay visible.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!isCompact(e.surface)) return next(e)
    // Folded in a turn summary, an error stays out of sight with the rest until the turn is opened.
    if (e.props.isErrored && (mode !== 'turn' || (await isTurnOpen($, e.props.tool_use_id)))) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)
    return Box({})
  })
}
