// MARK: Shape

export type SpanKind = 'plain' | 'code' | 'bold' | 'italic' | 'boldItalic' | 'strike' | 'link'

export type Span = { text: string; kind: SpanKind; href?: string }

export type Block =
  | { kind: 'heading'; level: number; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'item'; depth: number; marker: string; spans: Span[] }
  | { kind: 'quote'; spans: Span[] }
  | { kind: 'rule' }
  | { kind: 'fence'; language: string; source: string }
  | { kind: 'table'; text: string }
  | { kind: 'gap' }

// MARK: Inline

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~>]/
const BARE_URL = /^https?:\/\/[^\s<>]+/
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/

const RULES: { pattern: RegExp; kind: SpanKind; group: number }[] = [
  { pattern: /^(`+)(.+?)\1(?!`)/, kind: 'code', group: 2 },
  { pattern: /^\*\*\*(.+?)\*\*\*/, kind: 'boldItalic', group: 1 },
  { pattern: /^\*\*(.+?)\*\*/, kind: 'bold', group: 1 },
  { pattern: /^__(.+?)__/, kind: 'bold', group: 1 },
  { pattern: /^~~(.+?)~~/, kind: 'strike', group: 1 },
  { pattern: /^\*([^*\s][^*]*?)\*/, kind: 'italic', group: 1 },
]
const UNDERSCORE_ITALIC = /^_([^_\s][^_]*?)_/
const LINK = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/

export function inline(source: string): Span[] {
  const spans: Span[] = []
  let plain = ''
  let at = 0

  const flush = () => {
    if (plain !== '') spans.push({ text: plain, kind: 'plain' })
    plain = ''
  }

  while (at < source.length) {
    const rest = source.slice(at)
    const char = rest[0] ?? ''
    const next = rest[1] ?? ''

    if (char === '\\' && ESCAPABLE.test(next)) {
      plain += next
      at += 2
      continue
    }

    const link = LINK.exec(rest)
    if (link) {
      flush()
      spans.push({ text: link[1] ?? '', kind: 'link', href: link[2] ?? '' })
      at += link[0].length
      continue
    }

    const rule = RULES.map(r => ({ r, m: r.pattern.exec(rest) })).find(hit => hit.m !== null)
    if (rule?.m) {
      flush()
      const text = rule.m[rule.r.group] ?? ''
      spans.push({ text: rule.r.kind === 'code' ? text.trim() : text, kind: rule.r.kind })
      at += rule.m[0].length
      continue
    }

    // An underscore only opens emphasis at a word edge, so snake_case stays plain.
    const underscore = char === '_' && !/\w/.test(source[at - 1] ?? ' ') ? UNDERSCORE_ITALIC.exec(rest) : null
    if (underscore) {
      flush()
      spans.push({ text: underscore[1] ?? '', kind: 'italic' })
      at += underscore[0].length
      continue
    }

    const url = BARE_URL.exec(rest)?.[0]
    if (url !== undefined) {
      const href = url.replace(TRAILING_PUNCTUATION, '')
      flush()
      spans.push({ text: href, kind: 'link', href })
      at += href.length
      continue
    }

    plain += char
    at += 1
  }

  flush()
  return spans
}

// MARK: Blocks

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^\s*>\s?(.*)$/
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const TABLE_ROW = /^\s*\|.*\|\s*$/

type Draft =
  | { kind: 'heading'; level: number; source: string }
  | { kind: 'paragraph'; source: string }
  | { kind: 'item'; depth: number; marker: string; source: string }
  | { kind: 'quote'; source: string }
  | Exclude<Block, { spans: Span[] }>

const startsBlock = (line: string) =>
  FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line) || TABLE_ROW.test(line)

export function parse(text: string): Block[] {
  const lines = text.split('\n')
  const drafts: Draft[] = []
  let at = 0

  while (at < lines.length) {
    const line = lines[at] ?? ''
    at += 1

    if (line.trim() === '') {
      if (drafts.at(-1)?.kind !== 'gap') drafts.push({ kind: 'gap' })
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const mark = fence[1] ?? '```'
      const body: string[] = []
      while (at < lines.length && !(lines[at] ?? '').trim().startsWith(mark)) {
        body.push(lines[at] ?? '')
        at += 1
      }
      at += 1
      drafts.push({ kind: 'fence', language: fence[2] ?? '', source: body.join('\n') })
      continue
    }

    if (TABLE_ROW.test(line)) {
      const rows = [line]
      while (at < lines.length && TABLE_ROW.test(lines[at] ?? '')) {
        rows.push(lines[at] ?? '')
        at += 1
      }
      drafts.push({ kind: 'table', text: rows.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      drafts.push({ kind: 'heading', level: (heading[1] ?? '#').length, source: heading[2] ?? '' })
      continue
    }

    if (RULE.test(line)) {
      drafts.push({ kind: 'rule' })
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote) {
      drafts.push({ kind: 'quote', source: quote[1] ?? '' })
      continue
    }

    const item = ITEM.exec(line)
    if (item) {
      drafts.push({
        kind: 'item',
        depth: Math.floor((item[1] ?? '').length / 2),
        marker: item[2] ?? '-',
        source: item[3] ?? '',
      })
      continue
    }

    // A plain line continues the paragraph or list item above it.
    const previous = drafts.at(-1)
    if (previous && (previous.kind === 'paragraph' || previous.kind === 'item') && !startsBlock(line)) {
      previous.source += ` ${line.trim()}`
      continue
    }
    drafts.push({ kind: 'paragraph', source: line.trim() })
  }

  return drafts.map((draft): Block => {
    switch (draft.kind) {
      case 'heading':
        return { kind: 'heading', level: draft.level, spans: inline(draft.source) }
      case 'paragraph':
        return { kind: 'paragraph', spans: inline(draft.source) }
      case 'item':
        return { kind: 'item', depth: draft.depth, marker: draft.marker, spans: inline(draft.source) }
      case 'quote':
        return { kind: 'quote', spans: inline(draft.source) }
      default:
        return draft
    }
  })
}
