// Pure helpers behind the compact tool line; nothing here touches `$`.

export type ToolRow = {
  tool: string
  input: unknown
  output?: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
}

export type Tone = 'dim' | 'added' | 'removed'
export type Span = { text: string; tone: Tone }

export type ToolLine = {
  tool: string
  // A path subject is split so its folders can be drawn faint and its file name plain.
  subjectDir: string
  subjectName: string
  tail: Span[]
  status: string
}

// The engine indents transcript rows, so a line sized to the full width would spill onto a second row.
const GUTTER = 4
// The row's own left margin, which lines it up with the reply text.
export const ROW_INDENT = 2
// The dot's own column plus the space after it.
const DOT_WIDTH = 2
const MIN_WIDTH = 20
// A capped subject keeps durations and summaries in roughly one column, so the list scans vertically.
const MAX_SUBJECT_CHARS = 50

// Input fields that name what a call acts on, most telling first.
const SUBJECT_KEYS = [
  'command',
  'file_path',
  'notebook_path',
  'pattern',
  'url',
  'query',
  'skill',
  'description',
  'path',
  'action',
  'prompt',
]
const PATH_KEYS = new Set(['file_path', 'notebook_path', 'path'])

type Subject = { text: string; isPath: boolean }

function pickSubject(input: unknown, cwd: string): Subject {
  if (typeof input !== 'object' || input === null) return { text: '', isPath: false }
  const fields = input as Record<string, unknown>
  const key = SUBJECT_KEYS.find(name => typeof fields[name] === 'string' && fields[name] !== '')
  const raw =
    key !== undefined
      ? String(fields[key])
      : Object.keys(fields).length > 0
        ? JSON.stringify(fields)
        : ''
  return {
    text: relativeTo(raw.replace(/\s+/g, ' ').trim(), cwd),
    isPath: key !== undefined && PATH_KEYS.has(key),
  }
}

export function subjectOf(input: unknown, cwd = ''): string {
  return pickSubject(input, cwd).text
}

function relativeTo(text: string, cwd: string): string {
  if (cwd === '' || cwd === '/') return text
  const root = cwd.endsWith('/') ? cwd : `${cwd}/`
  return text.split(root).join('')
}

export function clip(text: string, room: number): string {
  if (text.length <= room) return text
  return room <= 1 ? '…' : `${text.slice(0, room - 1)}…`
}

// A path is cut from its start, so the file name survives.
export function clipStart(text: string, room: number): string {
  if (text.length <= room) return text
  return room <= 1 ? '…' : `…${text.slice(text.length - room + 1)}`
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(ms, 0) / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}m ${whole % 60}s`
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function countLines(text: unknown): number {
  if (typeof text !== 'string' || text.trim() === '') return 0
  return text.replace(/\n+$/, '').split('\n').length
}

// An errored call's output is the plain text the model read, so only an object carries result fields.
function fieldsOf(output: unknown): Record<string, unknown> | undefined {
  return typeof output === 'object' && output !== null
    ? (output as Record<string, unknown>)
    : undefined
}

function dim(text: string): Span[] {
  return [{ text, tone: 'dim' }]
}

function diffStat(patch: unknown): Span[] | undefined {
  if (!Array.isArray(patch)) return undefined
  let added = 0
  let removed = 0
  for (const hunk of patch) {
    const lines = fieldsOf(hunk)?.lines
    if (!Array.isArray(lines)) continue
    for (const line of lines) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
  }
  return [
    { text: `+${added}`, tone: 'added' },
    { text: ' ', tone: 'dim' },
    { text: `−${removed}`, tone: 'removed' },
  ]
}

function formatKilobytes(bytes: number): string {
  const kb = bytes / 1024
  return kb < 10 ? kb.toFixed(1) : String(Math.round(kb))
}

export function summaryOf(row: ToolRow): Span[] | undefined {
  if (row.isErrored || row.isInterrupted) return undefined
  const out = fieldsOf(row.output)
  if (out === undefined) return undefined
  switch (row.tool) {
    case 'Write':
      if (out.type === 'create') return dim(`new · ${plural(countLines(out.content), 'line')}`)
      return diffStat(out.structuredPatch)
    case 'Edit':
    case 'NotebookEdit':
      return diffStat(out.structuredPatch)
    case 'Read': {
      const lines = fieldsOf(out.file)?.numLines
      return typeof lines === 'number' ? dim(plural(lines, 'line')) : undefined
    }
    case 'Bash': {
      const note = out.returnCodeInterpretation
      if (typeof note === 'string' && note !== '') return dim(note)
      return dim(`${plural(countLines(out.stdout) + countLines(out.stderr), 'line')} out`)
    }
    case 'WebFetch':
      if (typeof out.code !== 'number' || typeof out.bytes !== 'number') return undefined
      return dim(`${out.code} · ${formatKilobytes(out.bytes)} KB`)
    default:
      return undefined
  }
}

export function textOf(spans: readonly Span[] | undefined): string {
  return (spans ?? []).map(span => span.text).join('')
}

export function statusOf(row: ToolRow): string {
  const out = fieldsOf(row.output)
  const notes = [
    row.isInterrupted ? 'interrupted' : undefined,
    out?.timedOutAfterMs !== undefined ? 'timed out' : undefined,
    row.isErrored && !row.isInterrupted ? 'error' : undefined,
    out?.backgroundTaskId !== undefined ? 'background' : undefined,
  ]
  return notes.filter(note => note !== undefined).join(', ')
}

export type DotColor = 'warning' | 'success' | 'error'

export function dotColor(row: ToolRow): DotColor {
  if (row.isErrored || row.isInterrupted) return 'error'
  // isRunning is false while a call waits its turn or its approval, so only a stored result marks it done.
  return row.isRunning || row.output === undefined ? 'warning' : 'success'
}

function tailOf(row: ToolRow, durationMs: number | undefined): Span[] {
  const parts: Span[][] = []
  if (durationMs !== undefined) parts.push(dim(formatDuration(durationMs)))
  const summary = summaryOf(row)
  if (summary !== undefined) parts.push(summary)
  if (parts.length === 0) return []
  const joined: Span[] = [{ text: '  ', tone: 'dim' }]
  parts.forEach((part, index) => {
    if (index > 0) joined.push({ text: ' · ', tone: 'dim' })
    joined.push(...part)
  })
  return joined
}

function splitPath(path: string): { dir: string; name: string } {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? { dir: '', name: path } : { dir: path.slice(0, cut + 1), name: path.slice(cut + 1) }
}

// The subject is the only part cut, so the tool name, duration and summary always stay readable.
export function lineFor(
  row: ToolRow,
  options: { columns: number; cwd: string; durationMs: number | undefined },
): ToolLine {
  const tail = tailOf(row, options.durationMs)
  const status = statusOf(row)
  const width = Math.max(options.columns - GUTTER - ROW_INDENT - DOT_WIDTH, MIN_WIDTH)
  const frame =
    `${row.tool}()`.length + textOf(tail).length + (status === '' ? 0 : ` - ${status}`.length)
  const room = Math.max(Math.min(MAX_SUBJECT_CHARS, width - frame), 1)
  const subject = pickSubject(row.input, options.cwd)
  if (subject.isPath) {
    const { dir, name } = splitPath(clipStart(subject.text, room))
    return { tool: row.tool, subjectDir: dir, subjectName: name, tail, status }
  }
  return { tool: row.tool, subjectDir: '', subjectName: clip(subject.text, room), tail, status }
}

// Lines of output an expanded row shows; the rest is summarized so one call cannot flood the transcript.
export const MAX_OUTPUT_LINES = 15

// The plain text a person would read for a finished call; undefined when there is nothing to show.
export function outputTextOf(row: ToolRow): string | undefined {
  if (row.output === undefined || row.isErrored) return undefined
  const out = fieldsOf(row.output)
  let text: string
  if (typeof row.output === 'string') {
    text = row.output
  } else if (out === undefined) {
    return undefined
  } else if (row.tool === 'Bash') {
    text = [out.stdout, out.stderr].filter(part => typeof part === 'string' && part !== '').join('\n')
  } else if (typeof out.content === 'string') {
    text = out.content
  } else if (typeof fieldsOf(out.file)?.content === 'string') {
    text = String(fieldsOf(out.file)?.content)
  } else {
    text = JSON.stringify(out, null, 2)
  }
  text = text.replace(/\n+$/, '')
  return text === '' ? undefined : text
}

export function clipLines(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  return [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more lines`].join('\n')
}

// Diff lines an expanded edit shows before the rest is summarized.
export const MAX_DIFF_LINES = 60

export type DiffView = { source: string; hiddenLines: number }

// Rebuilds a unified diff from the structured patch an edit stores, cut to `maxLines` body lines.
// A cut hunk gets its header counts recomputed, since the diff view only parses consistent hunks.
export function diffOf(row: ToolRow, maxLines = MAX_DIFF_LINES): DiffView | undefined {
  if (row.isErrored || row.isInterrupted) return undefined
  const patch = fieldsOf(row.output)?.structuredPatch
  if (!Array.isArray(patch)) return undefined
  let budget = maxLines
  let hiddenLines = 0
  const chunks: string[] = []
  for (const raw of patch) {
    const hunk = fieldsOf(raw)
    if (hunk === undefined || !Array.isArray(hunk.lines)) continue
    const lines = hunk.lines.filter((line): line is string => typeof line === 'string')
    const kept = lines.slice(0, Math.max(budget, 0))
    hiddenLines += lines.length - kept.length
    budget -= kept.length
    if (kept.length === 0) continue
    const oldCount = kept.filter(line => !line.startsWith('+')).length
    const newCount = kept.filter(line => !line.startsWith('-')).length
    const oldStart = typeof hunk.oldStart === 'number' ? hunk.oldStart : 1
    const newStart = typeof hunk.newStart === 'number' ? hunk.newStart : 1
    chunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${kept.join('\n')}`)
  }
  return chunks.length === 0 ? undefined : { source: chunks.join('\n'), hiddenLines }
}
