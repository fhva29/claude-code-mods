import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { RewriteEntry } from '../types'
import { rewriteCommand } from './rewrite'

const PANE = 'venv-guard'
const history = atom({ plugin: 'venv-guard', key: 'history' } as const, [])

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'venv-guard',
      description: 'Show the Bash commands venv-guard rewrote in this session',
    })

    return next(e)
  })

  on('command.run', { command: 'venv-guard' }, async $ => {
    await $.ui.open({ id: PANE, title: 'venv-guard' })

    return { text: 'venv-guard pane opened.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const root = await $.session.root()
    const venv = await $.fs.stat(`${root}/BackEnd/venv/bin/python`).catch(() => undefined)
    if (venv === undefined) {
      return next(e)
    }

    const { command, changes } = rewriteCommand(e.command, root)
    if (changes.length === 0) {
      return next(e)
    }

    const entry: RewriteEntry = { before: e.command, after: command, changes }
    await update($, history, list => [...list, entry].slice(-50))
    $.ui.toast(`venv-guard: ${changes.join(' · ')} (/venv-guard for details)`)

    return next({ ...e, command })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, history)

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No rewrites yet.</Text>}
        {list
          .slice()
          .reverse()
          .map(entry => (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold>{entry.changes.join(' · ')}</Text>
              <Text dimColor>- {entry.before}</Text>
              <Text>+ {entry.after}</Text>
            </Box>
          ))}
      </Box>
    )
  })
}
