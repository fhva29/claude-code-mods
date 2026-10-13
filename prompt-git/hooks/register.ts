import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { countLines, formatSummary } from './summary'

const REFRESH_MS = 10_000

const summary = atom({ plugin: 'prompt-git', key: 'summary' } as const, null)

async function git($: EngineInterface, args: string[]): Promise<string | null> {
  const { exitCode, stdout } = await $.process.run(['git', '--no-optional-locks', ...args])
  return exitCode === 0 ? stdout : null
}

async function refresh($: EngineInterface): Promise<void> {
  const branch = await git($, ['branch', '--show-current'])
  if (branch === null) {
    await update($, summary, () => null)
    return
  }
  const text = formatSummary({
    branch: branch.trim() || 'detached',
    staged: countLines((await git($, ['diff', '--cached', '--name-only'])) ?? ''),
    modified: countLines((await git($, ['diff', '--name-only'])) ?? ''),
    untracked: countLines((await git($, ['ls-files', '--others', '--exclude-standard'])) ?? ''),
  })
  await update($, summary, () => text)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await refresh($)
    }
    return result
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const text = await read($, summary)
    if (text === null) {
      return next(e)
    }
    const tail = e.props.tail === undefined ? text : `${e.props.tail} · ${text}`
    return next({ ...e, props: { ...e.props, tail } })
  })
}
