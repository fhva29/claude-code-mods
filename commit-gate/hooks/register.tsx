import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CommitGateFile, CommitGateHold } from '../types'
import { attributionIn, commitMessage, isCommit, pendingAdds } from './parse'

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

function drawHold($: EngineInterface, e: RenderEvent, current: CommitGateHold, columns: number) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const strangers = current.files.filter(file => !file.isTouched)
  const pathWidth = Math.max(20, columns - 30)

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

    const decision = await waitForDecision(current.id, $, next.signal)
    decisions.delete(current.id)
    await update($, hold, () => null)

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

  // The review always draws above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const current = await read($, hold)
    if (current === null) {
      return below
    }
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        {drawHold($, e, current, e.props.bodyColumns)}
      </Box>
    )
  })
}
