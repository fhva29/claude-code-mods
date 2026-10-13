import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BranchHudChange, BranchHudMigration, BranchHudSnapshot } from '../types'
import { parseChanges, parseCommits, parseMigrations } from './parse'

const PANE = 'branch-hud'
const REFRESH_MS = 60_000
const BASES = ['main', 'origin/main', 'master', 'origin/master']

const snapshot = atom({ plugin: 'branch-hud', key: 'snapshot' } as const, null)

async function git($: EngineInterface, args: string[]): Promise<{ ok: boolean; out: string }> {
  const { exitCode, stdout } = await $.process.run(['git', ...args])
  return { ok: exitCode === 0, out: stdout.trim() }
}

async function takeSnapshot($: EngineInterface): Promise<BranchHudSnapshot | null> {
  const branch = await git($, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!branch.ok) return null

  let base = ''
  for (const candidate of BASES) {
    if ((await git($, ['rev-parse', '--verify', '--quiet', candidate])).ok) {
      base = candidate
      break
    }
  }

  let ahead = 0
  let behind = 0
  let committed: BranchHudMigration[] = []
  if (base !== '' && base !== branch.out) {
    const counts = await git($, ['rev-list', '--left-right', '--count', `${base}...HEAD`])
    const [left = '0', right = '0'] = counts.out.split(/\s+/)
    behind = Number(left)
    ahead = Number(right)
    const added = await git($, ['diff', '--name-only', '--diff-filter=A', `${base}...HEAD`])
    committed = parseMigrations(added.out, true)
  }

  const status = await git($, ['status', '--porcelain', '--untracked-files=all'])
  const changes = parseChanges(status.out)
  const pending = parseMigrations(
    changes.filter(change => change.status === '??' || change.status === 'A').map(c => c.path).join('\n'),
    false,
  )
  const log = await git($, ['log', '-6', '--format=%h%x09%s'])

  return {
    branch: branch.out,
    base,
    ahead,
    behind,
    changes,
    migrations: [...committed, ...pending],
    commits: parseCommits(log.out),
  }
}

function statusLine(snap: BranchHudSnapshot): string {
  const parts = [`⎇ ${snap.branch}`]
  if (snap.base !== '') parts.push(`↑${snap.ahead} ↓${snap.behind}`)
  if (snap.changes.length > 0) parts.push(`●${snap.changes.length}`)
  if (snap.migrations.length > 0) parts.push(`⛁${snap.migrations.length}`)
  return parts.join(' ')
}

function migrationKey(m: BranchHudMigration): string {
  return `${m.app}/${m.name}`
}

async function refresh($: EngineInterface): Promise<void> {
  const next = await takeSnapshot($)
  if (next === null) return
  const previous = await read($, snapshot)
  await update($, snapshot, () => next)
  $.ui.status(statusLine(next))

  if (previous !== null) {
    const known = new Set(previous.migrations.map(migrationKey))
    const fresh = next.migrations.filter(m => !known.has(migrationKey(m)))
    if (fresh.length > 0) {
      $.ui.toast(`⛁ New migration: ${fresh.map(migrationKey).join(', ')}`)
    }
  }
}

function changeColor(change: BranchHudChange): string {
  if (change.status === '??') return 'subtle'
  if (change.status.includes('D')) return 'diffRemoved'
  if (change.status.includes('A')) return 'diffAdded'
  return 'warning'
}

// Splits `width` cells between behind (left) and ahead (right), each side at least one
// cell when it is non-zero.
export function divergence(behind: number, ahead: number, width: number): [number, number] {
  const total = behind + ahead
  if (total === 0) return [0, 0]
  let left = Math.round((behind / total) * width)
  if (behind > 0) left = Math.max(1, left)
  if (ahead > 0) left = Math.min(width - 1, left)
  return [left, width - left]
}

function groupByApp(migrations: readonly BranchHudMigration[]): Map<string, BranchHudMigration[]> {
  const groups = new Map<string, BranchHudMigration[]>()
  for (const m of migrations) {
    groups.set(m.app, [...(groups.get(m.app) ?? []), m])
  }
  return groups
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'branch', description: 'Open the branch HUD pane' })
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))
    void $.ui.open({ id: PANE, title: 'Branch' })
    return result
  })

  on('command.run', { command: 'branch' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Branch' })
    return { text: 'Branch HUD opened.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    if (/\bgit\b|makemigrations/.test(e.command)) {
      await refresh($)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await refresh($)
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    if (snap === null) {
      return <Text dimColor>Not a git repository.</Text>
    }

    const columns = e.props.bodyColumns
    const [left, right] = divergence(snap.behind, snap.ahead, Math.max(10, Math.min(40, columns - 20)))
    const rows = Math.max(4, (e.viewport?.rows ?? 30) - 18)
    const shownChanges = snap.changes.slice(0, Math.ceil(rows / 2))
    const apps = groupByApp(snap.migrations)

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text color="claude" bold>
            ⎇ {snap.branch}
          </Text>
          {snap.base !== '' && <Text dimColor> vs {snap.base}</Text>}
        </Box>

        {snap.base !== '' && (
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text color="diffRemoved" bold>
                ↓{snap.behind}{' '}
              </Text>
              <Text color="diffRemoved">{'▮'.repeat(left)}</Text>
              <Text dimColor>│</Text>
              <Text color="diffAdded">{'▮'.repeat(right)}</Text>
              <Text color="diffAdded" bold>
                {' '}
                ↑{snap.ahead}
              </Text>
            </Box>
            <Text dimColor>
              {snap.behind > 0 ? `${snap.behind} behind ${snap.base}` : `up to date with ${snap.base}`}
              {snap.ahead > 0 ? ` · ${snap.ahead} ahead` : ''}
            </Text>
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text bold>
            {snap.changes.length === 0 ? '✓ Clean tree' : `● ${snap.changes.length} uncommitted`}
          </Text>
          {shownChanges.map(change => (
            <Box>
              <Text color={changeColor(change)} bold>
                {change.status.padEnd(3)}
              </Text>
              <Text wrap="truncate-start">{change.path}</Text>
            </Box>
          ))}
          {snap.changes.length > shownChanges.length && (
            <Text dimColor>  … {snap.changes.length - shownChanges.length} more</Text>
          )}
        </Box>

        {snap.migrations.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text color="warning" bold>
              ⛁ {snap.migrations.length} migration{snap.migrations.length === 1 ? '' : 's'} on this branch
            </Text>
            {[...apps.entries()].map(([app, list]) => (
              <Box flexDirection="column">
                <Text color="suggestion">  {app}</Text>
                {list.map(m => (
                  <Box>
                    <Text color={m.isCommitted ? 'success' : 'warning'}>{m.isCommitted ? '    ✓ ' : '    ○ '}</Text>
                    <Text dimColor={m.isCommitted} wrap="truncate-end">
                      {m.name}
                    </Text>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text bold>Recent commits</Text>
          {snap.commits.map(commit => (
            <Box>
              <Text color="claude">{commit.sha} </Text>
              <Text dimColor wrap="truncate-end">
                {commit.subject}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
