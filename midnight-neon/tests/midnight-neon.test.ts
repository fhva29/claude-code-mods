import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { inline, parse } from '../hooks/parse'

type Engine = Parameters<TestBody>[0]
type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }

function leaves(node: unknown): Drawn[] {
  if (typeof node !== 'object' || node === null) return []
  const drawn = node as Drawn
  const children = drawn.children ?? []
  if (drawn.type === 'Text' && children.every(child => typeof child === 'string')) return [drawn]
  return children.flatMap(leaves)
}

const textOf = (node: unknown) => leaves(node).map(leaf => (leaf.children ?? []).join('')).join('')
const find = (node: unknown, text: string) => leaves(node).find(leaf => (leaf.children ?? []).join('').includes(text))

function has(node: unknown, type: string): boolean {
  if (typeof node !== 'object' || node === null) return false
  const drawn = node as Drawn
  return drawn.type === type || (drawn.children ?? []).some(child => has(child, type))
}

async function draw($: Engine, text: string, isFirstOfReply = false): Promise<Drawn> {
  const ui = await $.ui.mount({
    plugin: 'midnight-neon',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply },
    viewport: { columns: 80, rows: 40 },
  })
  return (await ui.drawn()) as Drawn
}

test('parses blocks and inline styles', () => {
  const blocks = parse('# Title\n\nSome **bold** and `code`.\n\n- one\n  - two\n1. three\n> quoted\n---')
  expect(blocks.map(block => block.kind)).toEqual([
    'heading', 'gap', 'paragraph', 'gap', 'item', 'item', 'item', 'quote', 'rule',
  ])
  expect(inline('a **b** `c` snake_case [l](https://x.io)').map(span => span.kind)).toEqual([
    'plain', 'bold', 'plain', 'code', 'plain', 'link',
  ])
})

test('keeps a fence and a table whole', () => {
  const blocks = parse('```py\nprint(1)\n```\n| a | b |\n|---|---|\n| 1 | 2 |')
  expect(blocks).toEqual([
    { kind: 'fence', language: 'py', source: 'print(1)' },
    { kind: 'table', text: '| a | b |\n|---|---|\n| 1 | 2 |' },
  ])
})

test('paints h1 as a filled banner and h2 in the accent color', async $ => {
  const root = await draw($, '# Big\n\n## Medium')
  expect(find(root, 'Big')?.props).toMatchObject({ backgroundColor: '#7C3AED', bold: true })
  expect(find(root, 'Medium')?.props).toMatchObject({ color: '#FF79C6', bold: true })
})

test('colors bold, code and list bullets', async $ => {
  const root = await draw($, '- a **loud** `thing`')
  expect(find(root, 'loud')?.props).toMatchObject({ color: '#FFB86C', bold: true })
  expect(find(root, 'thing')?.props).toMatchObject({ color: '#F1FA8C' })
  expect(find(root, '●')?.props).toMatchObject({ color: '#FF79C6' })
})

test('opens the first block of a reply with the bullet', async $ => {
  expect(textOf(await draw($, 'Hello', true)).startsWith('● Hello')).toBe(true)
  expect(textOf(await draw($, 'Hello', false)).startsWith('  Hello')).toBe(true)
})

test('draws fences as Code and tables as Markdown', async $ => {
  expect(has(await draw($, '```ts\nlet a = 1\n```'), 'Code')).toBe(true)
  expect(has(await draw($, '| a |\n|---|\n| 1 |'), 'Markdown')).toBe(true)
})

test('/neon turns the style off and on again', async ($, on) => {
  mock.store(on)
  // Stands for the engine's own drawing, which answers when the mod steps aside.
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: ['engine row'] }))

  const run = (args: string) =>
    $.command.run({
      command: 'neon',
      args,
      origin: { kind: 'plugin', name: 'midnight-neon' },
      presentation: { isFullscreen: false, columns: 80 },
    })

  await run('off')
  expect(textOf(await draw($, '# Big'))).toBe('engine row')

  await run('')
  expect(find(await draw($, '# Big'), 'Big')?.props).toMatchObject({ backgroundColor: '#7C3AED' })
})
