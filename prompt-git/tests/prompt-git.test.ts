import { expect, test } from 'claude-code/testing'

import { countLines, formatSummary } from '../hooks/summary'

test('summary shows counts or clean', async () => {
  expect(formatSummary({ branch: 'main', staged: 1, modified: 3, untracked: 0 })).toBe('⎇ main · +1 ~3')
  expect(formatSummary({ branch: 'main', staged: 0, modified: 0, untracked: 0 })).toBe('⎇ main · ✓ clean')
  expect(countLines('a\nb\n\n')).toBe(2)
})

test('the hint line gets the git tail', async ($, on) => {
  const out: Record<string, string> = {
    'branch --show-current': 'Heitor-Backend\n',
    'diff --cached --name-only': '',
    'diff --name-only': 'a\nb\nc\n',
    'ls-files --others --exclude-standard': 'x.png\n',
  }
  on('process.run', (_$, e) => ({
    value: { exitCode: 0, stdout: out[e.argv.slice(2).join(' ')] ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.start', () => ({ cwd: '/repo' }))
  on('clock.every', () => ({ value: undefined }) as never)
  // Stands in for the engine's own line: draws whatever tail reached it.
  on('ui.render', { component: 'PromptHint' }, ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return Text({ children: `${e.props.hint}|${e.props.tail ?? ''}` })
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'prompt-git',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('? for shortcuts|⎇ Heitor-Backend · ~3 ?1')
    await ui.unmount()
  }
})
