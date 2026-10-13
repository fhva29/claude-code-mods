import { describe, expect, test } from 'claude-code/testing'

import {
  clip,
  clipLines,
  clipStart,
  diffOf,
  formatDuration,
  lineFor,
  outputTextOf,
  statusOf,
  subjectOf,
  summaryOf,
  textOf,
} from '../hooks/lines'
import type { ToolRow } from '../hooks/lines'

const DONE = { isRunning: false, isErrored: false, isInterrupted: false }

function row(tool: string, input: unknown, output?: unknown, flags: Partial<ToolRow> = {}): ToolRow {
  return { tool, input, output, ...DONE, ...flags }
}

describe('subjectOf', () => {
  test('takes the first non-empty known key', () => {
    expect(subjectOf({ description: 'x', command: 'ls -la' })).toBe('ls -la')
    expect(subjectOf({ command: '', file_path: 'a.py' })).toBe('a.py')
  })

  test('falls back to the input JSON', () => {
    expect(subjectOf({ limit: 3 })).toBe('{"limit":3}')
    expect(subjectOf({})).toBe('')
    expect(subjectOf(null)).toBe('')
  })

  test('collapses whitespace and strips the session cwd', () => {
    expect(subjectOf({ command: 'echo  a\n\tb' })).toBe('echo a b')
    expect(subjectOf({ file_path: '/w/BackEnd/models.py' }, '/w')).toBe('BackEnd/models.py')
    expect(subjectOf({ command: 'cd /w/FrontEnd && npm run lint' }, '/w/')).toBe(
      'cd FrontEnd && npm run lint',
    )
  })
})

describe('clip', () => {
  test('cuts with an ellipsis only when needed', () => {
    expect(clip('abcdef', 6)).toBe('abcdef')
    expect(clip('abcdef', 4)).toBe('abc…')
    expect(clip('abcdef', 1)).toBe('…')
  })
})

describe('formatDuration', () => {
  test('seconds below a minute, minutes and seconds above', () => {
    expect(formatDuration(400)).toBe('0.4s')
    expect(formatDuration(3240)).toBe('3.2s')
    expect(formatDuration(64_000)).toBe('1m 4s')
  })
})

describe('summaryOf', () => {
  const patch = [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' a', '-b', '+c', '+d'] }]

  test('edits count added and removed lines', () => {
    expect(textOf(summaryOf(row('Edit', {}, { structuredPatch: patch })))).toBe('+2 −1')
    expect(textOf(summaryOf(row('Write', {}, { type: 'update', structuredPatch: patch })))).toBe('+2 −1')
    expect(textOf(summaryOf(row('Write', {}, { type: 'create', content: 'a\nb\nc\n', structuredPatch: [] })))).toBe(
      'new · 3 lines',
    )
  })

  test('read, bash and webfetch', () => {
    expect(textOf(summaryOf(row('Read', {}, { type: 'text', file: { numLines: 240 } })))).toBe('240 lines')
    expect(textOf(summaryOf(row('Bash', {}, { stdout: 'a\nb\n', stderr: 'c' })))).toBe('3 lines out')
    expect(textOf(summaryOf(row('Bash', {}, { stdout: '', stderr: '', returnCodeInterpretation: 'No matches found' })))).toBe(
      'No matches found',
    )
    expect(textOf(summaryOf(row('WebFetch', {}, { code: 200, bytes: 2048 })))).toBe('200 · 2.0 KB')
  })

  test('nothing for other tools, errors or a running call', () => {
    expect(summaryOf(row('Skill', {}, { ok: true }))).toBeUndefined()
    expect(summaryOf(row('Bash', {}, 'boom', { isErrored: true }))).toBeUndefined()
    expect(summaryOf(row('Bash', {}, undefined, { isRunning: true }))).toBeUndefined()
  })
})

describe('statusOf', () => {
  test('names each notable end', () => {
    expect(statusOf(row('Bash', {}, { stdout: '' }))).toBe('')
    expect(statusOf(row('Bash', {}, 'x', { isErrored: true }))).toBe('error')
    expect(statusOf(row('Bash', {}, 'x', { isErrored: true, isInterrupted: true }))).toBe('interrupted')
    expect(statusOf(row('Bash', {}, { timedOutAfterMs: 1000 }))).toBe('timed out')
    expect(statusOf(row('Bash', {}, { backgroundTaskId: 'b1' }))).toBe('background')
  })
})

describe('lineFor', () => {
  test('a long subject is capped and only the subject is clipped', () => {
    const long = row('Bash', { command: 'x'.repeat(200) }, { stdout: 'a' })
    const wide = lineFor(long, { columns: 200, cwd: '', durationMs: 1200 })
    expect(wide.subjectName.length).toBe(50)
    expect(textOf(wide.tail)).toBe('  1.2s · 1 line out')
    const narrow = lineFor(long, { columns: 60, cwd: '', durationMs: 1200 })
    const drawn = `${narrow.tool}(${narrow.subjectName})${textOf(narrow.tail)}`
    expect(drawn.length).toBe(60 - 4 - 2 - 2)
  })

  test('a path splits into faint folders and a file name, cut from its start', () => {
    const read = row('Read', { file_path: '/w/BackEnd/accounts/models.py' }, { file: { numLines: 9 } })
    const line = lineFor(read, { columns: 120, cwd: '/w', durationMs: undefined })
    expect(line.subjectDir).toBe('BackEnd/accounts/')
    expect(line.subjectName).toBe('models.py')
    expect(clipStart('BackEnd/accounts/models.py', 11)).toBe('…/models.py')
  })

  test('edits color added and removed counts', () => {
    const patch = [{ lines: ['+a', '-b'] }]
    const tones = summaryOf(row('Edit', {}, { structuredPatch: patch }))?.map(span => span.tone)
    expect(tones).toEqual(['added', 'dim', 'removed'])
  })
})

describe('outputTextOf', () => {
  test('joins Bash stdout and stderr', () => {
    expect(outputTextOf(row('Bash', {}, { stdout: 'a\n', stderr: 'b\n' }))).toBe('a\n\nb')
  })

  test('has nothing for running, errored or empty calls', () => {
    expect(outputTextOf(row('Bash', {}))).toBeUndefined()
    expect(outputTextOf(row('Bash', {}, { stdout: '', stderr: '' }))).toBeUndefined()
    expect(outputTextOf(row('Bash', {}, 'boom', { isErrored: true }))).toBeUndefined()
  })
})

describe('clipLines', () => {
  test('cuts long output and counts the rest', () => {
    expect(clipLines('1\n2\n3', 2)).toBe('1\n2\n… 1 more lines')
    expect(clipLines('1\n2', 2)).toBe('1\n2')
  })
})

describe('diffOf', () => {
  const patch = [{ oldStart: 3, newStart: 3, lines: [' keep', '-old', '+new', '+extra'] }]

  test('rebuilds a unified diff with header counts', () => {
    const view = diffOf(row('Edit', {}, { structuredPatch: patch }))
    expect(view?.source).toBe('@@ -3,2 +3,3 @@\n keep\n-old\n+new\n+extra')
    expect(view?.hiddenLines).toBe(0)
  })

  test('cuts at the limit and recomputes the header', () => {
    const view = diffOf(row('Edit', {}, { structuredPatch: patch }), 2)
    expect(view?.source).toBe('@@ -3,2 +3,1 @@\n keep\n-old')
    expect(view?.hiddenLines).toBe(2)
  })

  test('has no diff for other tools or errored calls', () => {
    expect(diffOf(row('Bash', {}, { stdout: 'x' }))).toBeUndefined()
    expect(diffOf(row('Edit', {}, { structuredPatch: patch }, { isErrored: true }))).toBeUndefined()
  })
})
