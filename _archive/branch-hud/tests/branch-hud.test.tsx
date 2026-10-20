import { describe, expect, test } from 'claude-code/testing'

import { parseChanges, parseCommits, parseMigrations } from '../hooks/parse'
import { divergence } from '../hooks/register'

describe('parsers', () => {
  test('porcelain lines become changes', async () => {
    expect(parseChanges(' M FrontEnd/a.jsx\n?? BackEnd/x/migrations/0002_b.py\n')).toEqual([
      { status: 'M', path: 'FrontEnd/a.jsx' },
      { status: '??', path: 'BackEnd/x/migrations/0002_b.py' },
    ])
  })

  test('only numbered migration files count', async () => {
    const paths = 'BackEnd/accounts/migrations/0025_terms.py\nBackEnd/accounts/migrations/__init__.py\nBackEnd/a.py'
    expect(parseMigrations(paths, true)).toEqual([{ app: 'accounts', name: '0025_terms', isCommitted: true }])
  })

  test('log lines become commits', async () => {
    expect(parseCommits('82c0174b\tMerge branch\n378b6f36\tfeat: x')).toEqual([
      { sha: '82c0174b', subject: 'Merge branch' },
      { sha: '378b6f36', subject: 'feat: x' },
    ])
  })

  test('divergence keeps both sides visible', async () => {
    expect(divergence(55, 203, 20)).toEqual([4, 16])
    expect(divergence(1, 1000, 20)).toEqual([1, 19])
    expect(divergence(0, 0, 20)).toEqual([0, 0])
  })
})

const GIT: Record<string, string> = {
  'rev-parse --abbrev-ref HEAD': 'feature-login',
  'rev-parse --verify --quiet main': 'abc',
  'rev-list --left-right --count main...HEAD': '55\t203',
  'diff --name-only --diff-filter=A main...HEAD': 'BackEnd/accounts/migrations/0025_terms.py',
  'status --porcelain --untracked-files=all': ' M FrontEnd/App.jsx\n?? BackEnd/digitalization/migrations/0036_new.py',
  'log -6 --format=%h%x09%s': '82c0174b\tMerge branch',
}

test('the pane draws branch, divergence and migrations on every surface', async ($, on) => {
  on('process.run', (_$, e) => {
    const stdout = GIT[e.argv.slice(1).join(' ')]
    return {
      value: {
        exitCode: stdout === undefined ? 1 : 0,
        stdout: stdout ?? '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'branch', args: '' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'branch-hud',
      surface,
      component: 'Pane',
      requestId: 'branch-hud',
      props: { title: 'Branch', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
    })
    expect(await ui.find({ type: 'Text', text: /feature-login/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↑203/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 migrations on this branch/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /0036_new/ })).toBeDefined()
    await ui.unmount()
  }
})
