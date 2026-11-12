import { describe, expect, test } from 'claude-code/testing'

import { attributionIn, commitDir, commitMessage, isCommit, pendingAdds } from '../hooks/parse'

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

  test('spots a commit and its adds on later lines of a script', async () => {
    const command = 'set -e\ngit add a.py b.py\ngit commit -q -m "feat: x"\ngit add c.py\ngit commit -m "fix: y"'
    expect(isCommit(command)).toBe(true)
    expect(pendingAdds(command)).toEqual(['a.py', 'b.py', 'c.py'])
  })

  test('follows cd and git -C to the folder the commit runs in', async () => {
    expect(commitDir('git commit -m "x"')).toBe(null)
    expect(commitDir('cd /home/me/mods && set -e\ngit add a\ngit commit -m "x"')).toBe('/home/me/mods')
    expect(commitDir('cd BackEnd && cd app && git commit')).toBe('BackEnd/app')
    expect(commitDir('cd /repo && git -C sub commit -m "x"')).toBe('/repo/sub')
    expect(commitDir('cd "my mods" && git commit')).toBe('my mods')
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

