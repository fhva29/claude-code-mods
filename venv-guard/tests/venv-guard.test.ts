import { describe, expect, test } from 'claude-code/testing'

import { rewriteCommand } from '../hooks/rewrite'

const ROOT = '/repo'
const BIN = '/repo/BackEnd/venv/bin'

describe('rewriteCommand', () => {
  test('drops activate and pins the venv tools that follow it', async () => {
    const { command, changes } = rewriteCommand(
      'cd BackEnd && source venv/bin/activate && pytest accounts -q && python manage.py check',
      ROOT,
    )
    expect(command).toBe(
      `cd /repo/BackEnd && ${BIN}/pytest accounts -q && ${BIN}/python manage.py check`,
    )
    expect(changes.length).toBe(3)
  })

  test('pins bare pytest and manage.py without activate', async () => {
    const { command } = rewriteCommand('pytest -q; python3 manage.py migrate --plan', ROOT)
    expect(command).toBe(`${BIN}/pytest -q; ${BIN}/python3 manage.py migrate --plan`)
  })

  test('leaves unrelated python alone', async () => {
    const input = 'python3 -I /tmp/script.py && git status'
    expect(rewriteCommand(input, ROOT)).toEqual({ command: input, changes: [] })
  })

  test('leaves already pinned commands alone', async () => {
    const input = './venv/bin/pytest -q'
    expect(rewriteCommand(input, ROOT).changes).toEqual([])
  })
})

test('the hook rewrites the Bash call before it runs', async ($, on) => {
  let ran = ''
  on('session.root', () => ({ value: ROOT }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    ran = e.command
    return { result: { stdout: '', stderr: '', interrupted: false } } as never
  })
  await $.tool.call({ tool: 'Bash', command: 'source venv/bin/activate && pytest -q' })
  expect(ran).toBe(`${BIN}/pytest -q`)
})
