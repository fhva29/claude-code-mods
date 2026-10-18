import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { parse, type Block, type Span } from './parse'

// MARK: Palette

const PALETTE = {
  accent: '#FF79C6',
  h1Text: '#F8F8F2',
  h1Fill: '#7C3AED',
  h2: '#FF79C6',
  h3: '#8BE9FD',
  h4: '#50FA7B',
  bold: '#FFB86C',
  italic: '#BD93F9',
  code: '#F1FA8C',
  codeFill: '#2B2D3A',
  link: '#8BE9FD',
  quoteBar: '#6272A4',
  quoteText: '#9AA5CE',
  rule: '#44475A',
} as const

const BULLETS = ['●', '◆', '▸']
const RULE_WIDTH = 40
const GUTTER = 6
const FALLBACK_COLUMNS = 100

const headingColor = (level: number) => (level === 2 ? PALETTE.h2 : level === 3 ? PALETTE.h3 : PALETTE.h4)
const plainText = (spans: Span[]) => spans.map(span => span.text).join('')

// MARK: State

// The quick switch behind /neon; disabling the plugin itself is the coarse one.
const isOn = atom({ plugin: 'midnight-neon', key: 'isOn' } as const, true)
const STORE_KEY = 'isOn'

// MARK: Hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'neon',
      description: 'Turn the midnight-neon reply style on or off',
      argumentHint: '[on|off]',
    })
    const saved = await $.store.get(STORE_KEY)
    if (typeof saved === 'boolean') await update($, isOn, () => saved)

    return next(e)
  })

  on('command.run', { command: 'neon' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const current = await read($, isOn)
    const next = arg === 'on' ? true : arg === 'off' ? false : !current
    await update($, isOn, () => next)
    await $.store.set(STORE_KEY, next)

    return { text: `midnight-neon ${next ? 'on' : 'off'}.` }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // A summary keeps the engine's faint "· summary" mark, which a tree of the mod's own would drop.
    if (e.surface !== 'terminal' || e.props.isSummary || !(await read($, isOn))) return next(e)
    const blocks = parse(e.props.text).filter((block, at, all) => block.kind !== 'gap' || (at > 0 && at < all.length - 1))
    if (blocks.every(block => block.kind === 'gap')) return next(e)

    const { Box, Text, Link, Code, Markdown } = $.ui.resolve(e)
    const columns = e.viewport?.columns ?? FALLBACK_COLUMNS

    const drawSpan = (span: Span) => {
      switch (span.kind) {
        case 'code':
          return <Text color={PALETTE.code} backgroundColor={PALETTE.codeFill}>{` ${span.text} `}</Text>
        case 'bold':
          return <Text bold color={PALETTE.bold}>{span.text}</Text>
        case 'italic':
          return <Text italic color={PALETTE.italic}>{span.text}</Text>
        case 'boldItalic':
          return <Text bold italic color={PALETTE.bold}>{span.text}</Text>
        case 'strike':
          return <Text strikethrough dimColor>{span.text}</Text>
        case 'link':
          return (
            <Link href={span.href ?? span.text}>
              <Text underline color={PALETTE.link}>{span.text}</Text>
            </Link>
          )
        default:
          return <Text>{span.text}</Text>
      }
    }

    const drawHeading = (level: number, spans: Span[]) => {
      const text = plainText(spans)
      if (level === 1) return <Text bold color={PALETTE.h1Text} backgroundColor={PALETTE.h1Fill}>{` ${text} `}</Text>
      const mark = level === 2 ? '▌ ' : level === 3 ? '▸ ' : ''
      return <Text bold color={headingColor(level)}>{`${mark}${text}`}</Text>
    }

    const drawBlock = (block: Block) => {
      switch (block.kind) {
        case 'heading':
          return drawHeading(block.level, block.spans)
        case 'paragraph':
          return <Text>{block.spans.map(drawSpan)}</Text>
        case 'item': {
          const isOrdered = /^\d/.test(block.marker)
          const bullet = isOrdered ? block.marker : (BULLETS[block.depth % BULLETS.length] ?? '●')
          return (
            <Box flexDirection="row">
              <Text>{' '.repeat(block.depth * 2)}</Text>
              <Text bold color={PALETTE.accent}>{`${bullet} `}</Text>
              <Box flexDirection="column" flexGrow={1}>
                <Text>{block.spans.map(drawSpan)}</Text>
              </Box>
            </Box>
          )
        }
        case 'quote':
          return (
            <Box flexDirection="row">
              <Text color={PALETTE.quoteBar}>{'▎ '}</Text>
              <Box flexDirection="column" flexGrow={1}>
                <Text italic color={PALETTE.quoteText}>{plainText(block.spans)}</Text>
              </Box>
            </Box>
          )
        case 'rule':
          return <Text color={PALETTE.rule}>{'─'.repeat(Math.min(RULE_WIDTH, columns - GUTTER))}</Text>
        case 'fence':
          return <Code source={block.source} language={block.language === '' ? undefined : block.language} />
        case 'table':
          return <Markdown text={block.text} />
        default:
          return <Text>{' '}</Text>
      }
    }

    // A blank line above every heading, and above any block that followed one in the source.
    const rows = blocks.flatMap((block, at) => {
      if (block.kind === 'gap') return []
      const afterGap = blocks[at - 1]?.kind === 'gap'
      const isSeparated = at > 0 && (block.kind === 'heading' || afterGap)
      return [<Box flexDirection="column" marginTop={isSeparated ? 1 : 0}>{drawBlock(block)}</Box>]
    })

    return (
      <Box flexDirection="row">
        <Text bold color={PALETTE.accent}>{e.props.isFirstOfReply ? '● ' : '  '}</Text>
        <Box flexDirection="column" flexGrow={1}>{rows}</Box>
      </Box>
    )
  })
}
