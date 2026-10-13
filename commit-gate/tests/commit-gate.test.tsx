import { describe, expect, test } from 'claude-code/testing'

import { attributionIn, commitMessage, isCommit, pendingAdds } from '../hooks/parse'

describe('parse', () => {
  test('spots commits behind cd and git -C', async () => {
    expect(isCommit('cd BackEnd && git commit -m "x"')).toBe(true)
    expect(isCommit('git -C /repo commit')).toBe(true)
    expect(isCommit('git log --grep commit')).toBe(false)
  })

  test('finds attribution trailers', async () => {
    expect(attributionIn('git commit -m "feat: x\n\nCo-Authored-By: Claude"')).toBe('Co-Authored-By:')
    expect(attributionIn('git commit -m "feat: x"')).toBe(null)
  })

  test('reads the message and the files a chained add stages', async () => {
    const command = `git add BackEnd/a.py "FrontEnd/b.jsx" && git commit -m "fix(api): handle nulls"`
    expect(pendingAdds(command)).toEqual(['BackEnd/a.py', 'FrontEnd/b.jsx'])
    expect(commitMessage(command)).toBe('fix(api): handle nulls')
  })

  test('reads a heredoc message', async () => {
    const command = `git commit -m "$(cat <<'EOF'\nfeat: heredoc\n\nbody\nEOF\n)"`
    expect(commitMessage(command)).toBe('feat: heredoc\n\nbody')
  })
})

test('a commit with an attribution trailer is denied', async ($, on) => {
  let ran = false
  on('tool.call', { tool: 'Bash' }, () => {
    ran = true
    return { result: { stdout: '', stderr: '', interrupted: false } } as never
  })
  const result = await $.tool.call({
    tool: 'Bash',
    command: 'git commit -m "feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>"',
  })
  expect(ran).toBe(false)
  expect(String(result.text ?? result.deny ?? '')).toContain('attribution')
})

