import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CommitGateFile, CommitGateHold } from '../types'
import { attributionIn, commitMessage, isCommit, pendingAdds } from './parse'

const PANE_ID = 'commit-gate'
// Path width for the terminal pane; the engine does not hand the pane's width to the hook.
const PANE_COLUMNS = 60

// Where the held review draws. Module-local: a reload drops it along with the waiting hook.
let placement: 'pane' | 'band' = 'band'

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

const touched = atom({ plugin: 'commit-gate', key: 'touched' } as const, [])
const hold = atom({ plugin: 'commit-gate', key: 'hold' } as const, null)

async function git($: EngineInterface, args: string[]): Promise<string> {
  const { exitCode, stdout } = await $.process.run(['git', ...args])
  return exitCode === 0 ? stdout.trim() : ''
}

async function stagedFiles($: EngineInterface, edited: readonly string[]): Promise<CommitGateFile[]> {
  const root = await git($, ['rev-parse', '--show-toplevel'])
  const lines = (await git($, ['diff', '--cached', '--name-status'])).split('\n')
  return lines
    .filter(line => line.trim() !== '')
    .map(line => {
      const [status = '?', ...rest] = line.split('\t')
      const path = rest.at(-1) ?? ''
      return { path, status: status.charAt(0), isTouched: edited.includes(`${root}/${path}`) }
    })
}

// Reads of $.state inside one dispatch see that dispatch's snapshot, so the
// waiting hook and the buttons share the decision through the module instead.
// A reload drops it, which also ends the waiting hook.
const decisions = new Map<string, 'commit' | 'cancel'>()

async function waitForDecision(id: string, $: EngineInterface, signal: AbortSignal): Promise<'commit' | 'cancel'> {
  while (!signal.aborted) {
    const decision = decisions.get(id)
    if (decision !== undefined) return decision
    await $.process.run(['sleep', '0.25'])
  }
  return 'cancel'
}

function decide($: EngineInterface, id: string, decision: 'commit' | 'cancel'): Promise<unknown> {
  decisions.set(id, decision)
  return update($, hold, current => (current === null ? null : { ...current, decision }))
}

function statusColor(status: string): string {
  if (status === 'A') return 'diffAdded'
  if (status === 'D') return 'diffRemoved'
  if (status === 'R') return 'suggestion'
  return 'warning'
}

type RenderEvent = Parameters<EngineInterface['ui']['resolve']>[0]

function drawHold($: EngineInterface, e: RenderEvent, current: CommitGateHold, columns: number, isBand: boolean) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const strangers = current.files.filter(file => !file.isTouched)
  const pathWidth = Math.max(20, columns - 30)

  if (e.surface === 'desktop') {
    return drawHoldDesktop($, e, current, strangers.length, isBand)
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color="permission" bold>
          ⛁ Commit gate
        </Text>
        <Text dimColor> · review before it lands</Text>
      </Box>
      {current.message !== '' && (
        <Box marginTop={1} borderStyle="round" borderColor="subtle" paddingX={1}>
          <Text wrap="truncate-end">{current.message.split('\n')[0]}</Text>
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        {current.files.map(file => (
          <Box>
            <Text color={file.isTouched ? 'success' : 'warning'}>{file.isTouched ? '✓ ' : '⚠ '}</Text>
            <Text color={statusColor(file.status)} bold>
              {file.status}{' '}
            </Text>
            <Text color={file.isTouched ? 'text' : 'warning'} wrap="truncate-start">
              {file.path.length > pathWidth ? `…${file.path.slice(-pathWidth)}` : file.path}
            </Text>
            {!file.isTouched && <Text dimColor>  not edited this session</Text>}
          </Box>
        ))}
        {current.pendingAdds.map(path => (
          <Box>
            <Text color="suggestion">+ </Text>
            <Text dimColor>git add </Text>
            <Text>{path}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {current.files.length} staged
          {current.pendingAdds.length > 0 ? ` · ${current.pendingAdds.length} added by this command` : ''}
        </Text>
        {strangers.length > 0 && (
          <Text color="warning" bold>
            {' '}
            · {strangers.length} not edited this session
          </Text>
        )}
      </Box>
      <Box marginTop={1} gap={1}>
        <Button
          key="commit"
          label="Commit"
          hotkey="1"
          variant="primary"
          autoFocus
          onPress={() => decide($, current.id, 'commit')}
        />
        <Button key="cancel" label="Cancel" hotkey="2" onPress={() => decide($, current.id, 'cancel')} />
      </Box>
    </Box>
  )
}

// The terminal's glyph columns and space-aligned labels read as clutter in a proportional font; the
// desktop gets a rounded card like its own permission prompts: the message as code, a mono file list
// with status badges, and native buttons.
function drawHoldDesktop($: EngineInterface, e: RenderEvent, current: CommitGateHold, strangers: number, isBand: boolean) {
  const { Box, Text, Button, Code } = $.ui.resolve(e)
  const counts = [
    `${current.files.length} staged`,
    current.pendingAdds.length > 0 ? `${current.pendingAdds.length} added by this command` : '',
  ].filter(Boolean)

  return (
    <Box
      flexDirection="column"
      gap="sm"
      paddingX="md"
      paddingY="sm"
      // A pane already has chrome; only the band fallback draws its own card border.
      {...(isBand
        ? { marginTop: 'xs', borderStyle: 'round', borderColor: strangers > 0 ? 'warning' : 'permission' }
        : {})}
    >
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap="sm">
        <Text>
          <Text weight="semibold">Commit gate</Text>
          <Text size="caption" dimColor>
            {'  '}held until you decide
          </Text>
        </Text>
        <Text size="caption" dimColor tabular>
          {counts.join(' · ')}
        </Text>
      </Box>
      {current.message !== '' && <Code source={current.message} />}
      <Box flexDirection="column" gap="xs">
        {current.files.map(file => (
          <Box key={`f:${file.path}`} flexDirection="row" alignItems="center" gap="sm">
            <Text size="caption" mono weight="semibold" color={statusColor(file.status)}>
              {file.status}
            </Text>
            <Text size="footnote" mono wrap="truncate-start" color={file.isTouched ? undefined : 'warning'}>
              {file.path}
            </Text>
            {!file.isTouched && (
              <Text size="caption" color="warning">
                not edited this session
              </Text>
            )}
          </Box>
        ))}
        {current.pendingAdds.map(path => (
          <Box key={`a:${path}`} flexDirection="row" alignItems="center" gap="sm">
            <Text size="caption" mono weight="semibold" color="suggestion">
              +
            </Text>
            <Text size="footnote" mono>
              {path}
            </Text>
            <Text size="caption" dimColor>
              git add
            </Text>
          </Box>
        ))}
      </Box>
      {strangers > 0 && (
        <Text size="caption" color="warning" weight="medium">
          {strangers === 1 ? '1 staged file was' : `${strangers} staged files were`} not edited in this session. Check
          they belong here.
        </Text>
      )}
      <Box flexDirection="row" alignItems="center" gap="xs">
        <Button
          key="commit"
          label="Commit"
          hotkey="1"
          variant="primary"
          autoFocus
          onPress={() => decide($, current.id, 'commit')}
        />
        <Button key="cancel" label="Cancel" hotkey="2" onPress={() => decide($, current.id, 'cancel')} />
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (EDIT_TOOLS.has(String(e.tool)) && result.deny === undefined && result.isError !== true) {
      const input = e as unknown as { file_path?: string; notebook_path?: string }
      const path = input.file_path ?? input.notebook_path
      if (path !== undefined) {
        const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
        const real = stat?.realPath ?? path
        await update($, touched, list => (list.includes(real) ? list : [...list, real]))
      }
    }
    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isCommit(e.command)) {
      return next(e)
    }

    const attribution = attributionIn(e.command)
    if (attribution !== null) {
      $.ui.toast(`commit-gate: blocked "${attribution}" in the commit`)
      return {
        deny: `commit-gate: the commit carries AI attribution ("${attribution}"). Remove every Co-Authored-By / Claude trailer and commit again.`,
      }
    }

    const edited = await read($, touched)
    const files = await stagedFiles($, edited)
    const adds = pendingAdds(e.command)
    if (files.length === 0 && adds.length === 0) {
      return next(e)
    }

    const current: CommitGateHold = {
      id: e.tool_use_id,
      command: e.command,
      message: commitMessage(e.command),
      files,
      pendingAdds: adds,
      decision: null,
    }
    await update($, hold, () => current)

    // Beside the chat when the surface places a pane; a narrow terminal falls back to the band.
    const rows = Math.min(24, 10 + files.length + adds.length)
    const opened = await $.ui.open({ id: PANE_ID, title: 'Commit gate', focus: true, rows }).catch(() => ({ isPlaced: false }))
    placement = opened.isPlaced ? 'pane' : 'band'
    $.ui.invalidate('ui.render')

    let decision: 'commit' | 'cancel'
    try {
      decision = await waitForDecision(current.id, $, next.signal)
    } finally {
      decisions.delete(current.id)
      await update($, hold, () => null)
      if (opened.isPlaced) await $.ui.close({ id: PANE_ID }).catch(() => undefined)
    }

    if (decision === 'commit') {
      return next(e)
    }
    const strangers = files.filter(file => !file.isTouched).map(file => file.path)
    const why = strangers.length > 0 ? ` Files not edited this session: ${strangers.join(', ')}.` : ''
    return {
      deny: `commit-gate: the user pressed Cancel on the staged list.${why} Ask which files belong in this commit.`,
    }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'commit-gate: its check failed, so the commit was held.' },
  )

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    const current = await read($, hold)
    if (e.requestId !== PANE_ID || current === null) {
      return next(e)
    }
    return drawHold($, e, current, PANE_COLUMNS, false)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const current = await read($, hold)
    if (current === null || placement === 'pane') {
      return below
    }
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        {drawHold($, e, current, e.props.bodyColumns, true)}
      </Box>
    )
  })
}
