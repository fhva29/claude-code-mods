import { expect, test } from 'claude-code/testing'

import { DEFAULT_PREFS, parsePrefs, runSkinCommand, TOGGLES, withCalm } from '../hooks/command'
import { foldLines, shellResultOf, shellStatus } from '../hooks/shell'
import { buildCustom, resolveSkin, skinNames, withSlot } from '../hooks/custom'
import { clipLines, diffstat, formatDuration, formatMs, pick, shortenPath } from '../hooks/format'
import { columnWidths, copyOf, cutCell, hardBreaks, padCell, splitReply, widthOf, wrapLines } from '../hooks/markdown'
import { codeSvg, tokenize } from '../hooks/svg-code'
import { CONTROL_SLOT, fitText, measure as measureAt, settled } from '../hooks/svg-kit'
import { diffLines, diffSvg, hunksOf } from '../hooks/svg-diff'
import { fitColumns, kindOfCell, measure, tableSvg, wrapCell } from '../hooks/svg-table'
import { outputLines, shellOutputOf, terminalSvg } from '../hooks/svg-terminal'
import { countdownOf, countdownsOf, limitLabel, meterColor, metersKey, metersOf, usageSvg } from '../hooks/svg-usage'
import { deepen, forTheme, gnomeDark, isLightTheme, macDark, resolveLight, toLight, windowsDark } from '../hooks/light'
import { parseFolders, prefsFor, withFolder, withoutFolder } from '../hooks/folders'
import { kindOf, summarize, toolLabel } from '../hooks/tools'
import { modelLabel } from '../hooks/register'
import { SKINS } from '../hooks/themes'
import { inlineRuns, splitBlocks } from '../hooks/blocks'
import { errorLine, isQuiet, isReadOnlyShell, segmentsOf } from '../hooks/quiet'
import tokyoNight from '../hooks/themes/tokyo-night'
import noir from '../hooks/themes/noir'

const NAMES = ['tokyo-night', 'dracula', 'nord']

test('paths under the session directory show relative, others stay', async () => {
  expect(shortenPath('C:\\work\\app\\src\\a.ts', 'C:\\work\\app')).toBe('src/a.ts')
  expect(shortenPath('/work/app/src/a.ts', '/work/app/')).toBe('src/a.ts')
  expect(shortenPath('/etc/hosts', '/work/app')).toBe('/etc/hosts')
  expect(shortenPath('/work/application/a.ts', '/work/app')).toBe('/work/application/a.ts')
})

test('times read like Claude Code writes them', async () => {
  expect(formatDuration(400)).toBe('<1s')
  expect(formatDuration(64000)).toBe('1m 4s')
  expect(formatMs(340)).toBe('340ms')
  expect(formatMs(2140)).toBe('2.1s')
})

test('a seed always picks the same word, and an empty list picks none', async () => {
  expect(pick(['a', 'b', 'c'], 'Sauteing')).toBe(pick(['a', 'b', 'c'], 'Sauteing'))
  expect(pick([], 'Sauteing')).toBeUndefined()
})

test('long output keeps its head and tail and counts the rest', async () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
  const clipped = clipLines(lines, 8, 4).split('\n')

  expect(clipped[8]).toBe('… 18 lines hidden')
  expect(clipped[12]).toBe('line 29')
  expect(clipLines('a\nb', 8, 4)).toBe('a\nb')
})

test('a patch counts its added and removed lines, anything else counts nothing', async () => {
  const output = { structuredPatch: [{ lines: [' a', '-b', '+c', '+d'] }, { lines: ['-e'] }] }

  expect(diffstat(output)).toEqual({ added: 2, removed: 2 })
  expect(diffstat({ stdout: 'x' })).toBeNull()
  expect(diffstat(null)).toBeNull()
})

test('only the tools a skin can draw faithfully get a kind', async () => {
  expect(kindOf('Bash')).toBe('run')
  expect(kindOf('mcp__github__search_code')).toBe('mcp')
  expect(kindOf('Task')).toBeNull()
  expect(toolLabel('mcp__github__search_code')).toBe('github:search_code')
})

test('a call summarises to the one thing worth a glance', async () => {
  expect(summarize('Bash', { command: 'pnpm test\n  --filter hub' }, '/w')).toBe('pnpm test')
  expect(summarize('Grep', { pattern: 'TODO', path: '/w/src' }, '/w')).toBe('TODO in src')
  expect(summarize('Bash', null, '/w')).toBe('')
})

test('tables and closed code fences are split out of a reply, and a fence keeps its table as code', async () => {
  const reply = [
    'Here:',
    '',
    '| Route | Limit |',
    '|:------|------:|',
    '| /chat | **60** |',
    '| /up | 10 |',
    '',
    'Done.',
    '```',
    '| a | b |',
    '|---|---|',
    '```',
  ].join('\n')
  const segments = splitReply(reply)

  expect(segments.map(segment => segment.kind)).toEqual(['text', 'table', 'text', 'code'])
  expect(segments[3]).toEqual({ kind: 'code', lang: '', code: '| a | b |\n|---|---|', raw: '```\n| a | b |\n|---|---|\n```' })
  expect(segments[1]).toEqual({
    kind: 'table',
    header: ['Route', 'Limit'],
    align: ['left', 'right'],
    rows: [
      ['/chat', '60'],
      ['/up', '10'],
    ],
  })
})

test('columns narrow from the widest until the table fits, and cells pad to their side', async () => {
  const table = { kind: 'table' as const, header: ['a', 'b'], align: ['left' as const, 'right' as const], rows: [['x'.repeat(30), 'yy']] }

  expect(columnWidths(table, 20, 3)).toEqual([15, 2])
  expect(padCell('abc', 6, 'right')).toBe('   abc')
  expect(padCell('abcdefgh', 5, 'left')).toBe('abcd…')
})

test('wide characters count two cells, so CJK cells are measured and cut in terminal cells', async () => {
  expect(widthOf('레일, 스피너')).toBe(12)
  expect(widthOf('e\u0301')).toBe(1)
  expect(widthOf('中文')).toBe(4)
  expect(widthOf('カタカナ')).toBe(8)
  expect(widthOf('ok 🚀')).toBe(5)
  expect(widthOf('👍🏽')).toBe(2)
  expect(widthOf('🫠')).toBe(2)
  expect(cutCell('레일, 스피너', 12)).toBe('레일, 스피너')
  expect(cutCell('레일, 스피너', 5)).toBe('레일…')
  expect(widthOf(padCell('레일', 8, 'left'))).toBe(8)
  expect(wrapLines('In one place: the orchestrator', 14, 6)).toEqual(['In one place:', 'the', 'orchestrator'])
  expect(wrapLines('레일 스피너 카탈로그', 7, 6).every(line => widthOf(line) <= 7)).toBe(true)
  expect(wrapLines('word '.repeat(40), 10, 2)).toEqual(['word word', 'word word…'])
})

test('a made skin lays its slots over its base, and bad drafts are refused with a reason', async () => {
  const sunset = buildCustom({ name: 'Sunset', base: 'dracula', palette: { user: '#FF8800' } }, undefined)

  expect(typeof sunset).toBe('object')

  const custom = { sunset: sunset as Exclude<typeof sunset, string> }
  const skin = resolveSkin('sunset', custom)

  expect(skin?.palette.user).toBe('#ff8800')
  expect(skin?.palette.run).toBe(resolveSkin('dracula', {})?.palette.run)
  expect(skinNames(custom)).toContain('sunset')
  expect(buildCustom({ name: 'dracula' }, undefined)).toContain('built-in')
  expect(buildCustom({ name: 'x', palette: { user: 'red' } }, undefined)).toContain('bad palette')
  expect(buildCustom({ name: 'x', base: 'nope' }, undefined)).toContain('base must be')
})

test('painting a slot on a built-in skin forks it into my-<name>', async () => {
  const made = withSlot('nord', {}, 'user', '#123456')

  expect(typeof made === 'string' ? made : made.name).toBe('my-nord')
  expect(withSlot('nord', {}, 'user', 'blue')).toContain('#7aa2f7')
})

test('/skin names a skin, switches parts, and refuses what it does not know', async () => {
  expect(runSkinCommand('nord', DEFAULT_PREFS, NAMES).prefs.skin).toBe('nord')
  expect(runSkinCommand('default', DEFAULT_PREFS, NAMES).prefs.skin).toBe('off')
  expect(runSkinCommand('rail off', DEFAULT_PREFS, NAMES).prefs.rail).toBe(false)
  expect(runSkinCommand('clip on', DEFAULT_PREFS, NAMES).prefs.clipOutput).toBe(true)
  expect(runSkinCommand('shimmer maybe', DEFAULT_PREFS, NAMES).prefs).toBe(DEFAULT_PREFS)
  expect(runSkinCommand('plaid', DEFAULT_PREFS, NAMES).channel).toBe('row')
  expect(runSkinCommand('list', { ...DEFAULT_PREFS, skin: 'nord' }, NAMES).message).toContain('nord (current)')
})

test('/skin help lists every command in a table, and changes nothing', async () => {
  const help = runSkinCommand('help', DEFAULT_PREFS, NAMES)
  expect(help.prefs).toBe(DEFAULT_PREFS)
  expect(help.channel).toBe('row')
  expect(help.message).toMatch(/\| Command +\| What it does +\|/)
  for (const word of Object.keys(TOGGLES)) {
    expect(help.message).toContain(`\`/skin ${word} on/off\``)
  }
})

test('stored prefs that are stale or hand-edited fall back to defaults', async () => {
  expect(parsePrefs(undefined, NAMES)).toEqual(DEFAULT_PREFS)
  expect(parsePrefs({ skin: 'gone', icons: 'x', rail: 'yes' }, NAMES)).toEqual(DEFAULT_PREFS)
  expect(parsePrefs({ skin: 'off', rail: false }, NAMES).rail).toBe(false)
})

test('tables are on, text or off, and a stored on/off from before still reads', async () => {
  expect(parsePrefs({ tables: true }, NAMES).tables).toBe('on')
  expect(parsePrefs({ tables: false }, NAMES).tables).toBe('off')
  expect(parsePrefs({ tables: 'text' }, NAMES).tables).toBe('text')
  expect(parsePrefs({ tables: 'grid' }, NAMES).tables).toBe('on')
  expect(runSkinCommand('tables text', DEFAULT_PREFS, NAMES).prefs.tables).toBe('text')
  expect(runSkinCommand('tables maybe', DEFAULT_PREFS, NAMES).message).toBe('usage: /skin tables on|text|off')
  expect(runSkinCommand('list', { ...DEFAULT_PREFS, tables: 'text' }, NAMES).message).toMatch(/\| tables +\| text +\|/)
})

test('the prompt sits left, right or plain, and anything else stored reads as left', async () => {
  expect(DEFAULT_PREFS.prompt).toBe('left')
  expect(parsePrefs({ prompt: 'right' }, NAMES).prompt).toBe('right')
  expect(parsePrefs({ prompt: 'plain' }, NAMES).prompt).toBe('plain')
  expect(parsePrefs({ prompt: 'centre' }, NAMES).prompt).toBe('left')
  expect(parsePrefs({ prompt: true }, NAMES).prompt).toBe('left')
  expect(runSkinCommand('prompt right', DEFAULT_PREFS, NAMES).prefs.prompt).toBe('right')
  expect(runSkinCommand('prompt left', { ...DEFAULT_PREFS, prompt: 'right' }, NAMES).prefs.prompt).toBe('left')
  expect(runSkinCommand('prompt plain', DEFAULT_PREFS, NAMES).prefs.prompt).toBe('plain')
  expect(runSkinCommand('prompt up', DEFAULT_PREFS, NAMES).message).toBe('usage: /skin prompt left|right|plain')
  expect(runSkinCommand('list', { ...DEFAULT_PREFS, prompt: 'right' }, NAMES).message).toMatch(/\| prompt +\| right +\|/)
})

test('words are the skin’s or Claude Code’s, and anything else stored reads as the skin’s', async () => {
  expect(DEFAULT_PREFS.words).toBe('skin')
  expect(parsePrefs({ words: 'claude' }, NAMES).words).toBe('claude')
  expect(parsePrefs({ words: 'mine' }, NAMES).words).toBe('skin')
  expect(parsePrefs({ words: true }, NAMES).words).toBe('skin')
  expect(parsePrefs({}, NAMES).words).toBe('skin')
  expect(runSkinCommand('words claude', DEFAULT_PREFS, NAMES).prefs.words).toBe('claude')
  expect(runSkinCommand('words skin', { ...DEFAULT_PREFS, words: 'claude' }, NAMES).prefs.words).toBe('skin')
  expect(runSkinCommand('words mine', DEFAULT_PREFS, NAMES).message).toBe('usage: /skin words claude|skin')
  expect(runSkinCommand('words', DEFAULT_PREFS, NAMES).prefs.words).toBe('skin')
  expect(runSkinCommand('list', { ...DEFAULT_PREFS, words: 'claude' }, NAMES).message).toMatch(/\| words +\| claude +\|/)
})

test('expand opens every tool group, is off by default, and anything but a boolean stored reads as off', async () => {
  expect(DEFAULT_PREFS.expand).toBe(false)
  expect(parsePrefs({ expand: true }, NAMES).expand).toBe(true)
  expect(parsePrefs({ expand: 'yes' }, NAMES).expand).toBe(false)
  expect(parsePrefs({}, NAMES).expand).toBe(false)
  expect(runSkinCommand('expand on', DEFAULT_PREFS, NAMES).prefs.expand).toBe(true)
  expect(runSkinCommand('expand off', { ...DEFAULT_PREFS, expand: true }, NAMES).prefs.expand).toBe(false)
  expect(runSkinCommand('expand maybe', DEFAULT_PREFS, NAMES).message).toBe('usage: /skin expand on|off')
  expect(runSkinCommand('list', { ...DEFAULT_PREFS, expand: true }, NAMES).message).toMatch(/\| expand +\| on +\|/)
})

test('compact keeps the band’s Compact button by default, and anything but a boolean stored reads as on', async () => {
  expect(DEFAULT_PREFS.compact).toBe(true)
  expect(parsePrefs({ compact: false }, NAMES).compact).toBe(false)
  expect(parsePrefs({ compact: 'no' }, NAMES).compact).toBe(true)
  expect(parsePrefs({}, NAMES).compact).toBe(true)
  expect(runSkinCommand('compact off', DEFAULT_PREFS, NAMES).prefs.compact).toBe(false)
  expect(runSkinCommand('compact on', { ...DEFAULT_PREFS, compact: false }, NAMES).prefs.compact).toBe(true)
  expect(runSkinCommand('compact maybe', DEFAULT_PREFS, NAMES).message).toBe('usage: /skin compact on|off')
  expect(runSkinCommand('list', { ...DEFAULT_PREFS, compact: false }, NAMES).message).toMatch(/\| compact +\| off +\|/)
})

test('cells are read as colours, diffs, numbers, code or text', async () => {
  expect(kindOfCell('#7aa2f7')).toBe('colour')
  expect(kindOfCell('+18 −3')).toBe('diff')
  expect(kindOfCell('120')).toBe('number')
  expect(kindOfCell('2.1s')).toBe('number')
  expect(kindOfCell('apps/hub/server.ts')).toBe('code')
  expect(kindOfCell('Added a limiter')).toBe('text')
  expect(measure('MMMM', false)).toBeDefined()
})

test('a vector table stays within its width and escapes what it draws', async () => {
  const card = tableSvg(
    { kind: 'table', header: ['a', 'b'], align: ['left', 'right'], rows: [['<b>', 'Q'.repeat(400)]] },
    tokyoNight.palette,
    5000,
  )

  expect(card.width).toBe(1600)
  expect(tableSvg({ kind: 'table', header: ['a'], align: ['left'], rows: [['b']] }, tokyoNight.palette, 700).width).toBe(700)
  // A long cell wraps instead of being cut: every one of its 400 characters is drawn.
  expect(card.source).not.toContain('…')
  expect((card.source.match(/Q+/g) ?? []).join('').length).toBe(400)
  expect(card.source).toContain('&lt;b&gt;')
  expect(card.source).not.toContain('<b>')
  expect(card.source).toContain('prefers-reduced-motion')
})

test('a patch numbers its lines on each side and marks the gap between hunks', async () => {
  const lines = diffLines([
    { oldStart: 10, newStart: 10, lines: [' a', '-b', '+c', '+d'] },
    { oldStart: 40, newStart: 41, lines: [' e', '\\ No newline at end of file'] },
  ])

  expect(lines).toEqual([
    { kind: 'ctx', text: 'a', old: 10, new: 10 },
    { kind: 'del', text: 'b', old: 11 },
    { kind: 'add', text: 'c', new: 11 },
    { kind: 'add', text: 'd', new: 12 },
    { kind: 'gap', at: 41 },
    { kind: 'ctx', text: 'e', old: 40, new: 41 },
  ])
})

test('a new file with an empty patch shows its content as added lines', async () => {
  const diff = hunksOf({ type: 'create', filePath: '/w/a.ts', content: 'x\ny', structuredPatch: [] })

  expect(diff?.isNewFile).toBe(true)
  expect(diff?.hunks[0]?.lines).toEqual(['+x', '+y'])
  expect(hunksOf({ stdout: '' })).toBeNull()

  const card = diffSvg(diff!, 'a.ts', tokyoNight.palette, 600)

  expect(card.source).toContain('new file')
  expect(card.alt).toBe('a.ts: +2 −0')
})

test('shell output loses its colour codes, keeps stderr apart and folds the middle', async () => {
  const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
  const shell = shellOutputOf({ stdout: `\u001b[32mok\u001b[0m\n${long}\n\n`, stderr: 'warn: x', interrupted: false })
  const lines = outputLines(shell!)

  expect(lines[0]).toEqual({ text: 'ok', isErr: false })
  expect(lines[6]).toEqual({ fold: 30 })
  expect(lines.at(-1)).toEqual({ text: 'warn: x', isErr: true })
  expect(terminalSvg(shell!, true, tokyoNight.palette, 600).source).toContain('failed')
  expect(shellOutputOf({ content: 'x' })).toBeNull()
})

test('code is split into comments, strings, numbers and keywords by language', async () => {
  expect(tokenize('const x = "hi" // note', 'ts').map(token => token.role)).toEqual([
    'keyword', 'plain', 'plain', 'plain', 'string', 'plain', 'comment',
  ])
  expect(tokenize('x = 1  # note', 'python').at(-1)).toEqual({ text: '# note', role: 'comment' })
  expect(codeSvg('a\nb', 'ts', tokyoNight.palette, 600).source).toContain('TS')
})

test('plan limits read as 5h and 7d, and a meter warns as it fills', async () => {
  expect(limitLabel('five_hour')).toBe('5h')
  expect(limitLabel('seven_day')).toBe('7d')
  expect(metersOf({ context: 42.4, limits: [{ label: '5h', percent: 120 }] })).toEqual([
    { label: 'context', percent: 42 },
    { label: '5h', percent: 100 },
  ])
  expect(meterColor(85, tokyoNight.palette)).toBe(tokyoNight.palette.warn)
  expect(usageSvg([{ label: 'context', percent: 42 }], tokyoNight.palette).alt).toBe('context 42%')
})

test('a countdown reads to the minute, rounding up, and only for the limits that reset', async () => {
  const minutes = (n: number) => n * 60_000

  expect(countdownOf(minutes(3 * 1440 + 4 * 60 + 30))).toBe('3d4h')
  expect(countdownOf(minutes(65))).toBe('1h05')
  expect(countdownOf(minutes(11) + 1)).toBe('12m')
  expect(countdownOf(0)).toBe('now')
  expect(countdownOf(-5000)).toBe('now')
  expect(countdownsOf({ context: 10, limits: [{ label: '5h', percent: 1, resetsAt: minutes(100) }, { label: '7d', percent: 2 }] }, 0)).toEqual({ '5h': '1h40' })
  expect(metersKey(metersOf({ context: null, limits: [{ label: '5h', percent: 1 }] }, { '5h': '1h40' }))).toBe(metersKey(metersOf({ context: null, limits: [{ label: '5h', percent: 1 }] })))
})

test('a long cell wraps on its words, breaks a word too long for the column, and caps its lines', async () => {
  expect(wrapCell('the quick brown fox jumps', 90, false)).toEqual(['the quick', 'brown fox', 'jumps'])
  expect(wrapCell('x'.repeat(30), 60, true).every(line => measure(line, true) <= 60)).toBe(true)
  expect(wrapCell('word '.repeat(80), 60, false, 2).at(-1)).toMatch(/…$/)
})

test('a Hangul, kana or Han character measures about one em, twice a Latin letter, so wide cells wrap in their column', async () => {
  const korean = '둘째 칸에도 한글 문장을 길게 넣으면 글자가 옆 칸과 겹치고 카드 오른쪽에서 잘린다'

  expect(measure('한', false)).toBeGreaterThan(measure('a', false) * 1.6)
  expect(measure('漢字', true)).toBe(measure('abcd', true))
  expect(measure('é', false)).toBe(measure('e', false))
  expect(wrapCell(korean, 200, false).every(line => measure(line, false) <= 200)).toBe(true)
})

test('short columns keep their width and long ones share the rest', async () => {
  const [hash, why, who] = fitColumns([20, 900, 60], 700)

  expect(hash).toBe(20)
  expect(who).toBe(60)
  expect(Math.round((why ?? 0) + 20 + 60 + 2 * 28 + 2 * 24)).toBe(700)
})

test('a long cell keeps every line unless asked to cap them', async () => {
  const lines = wrapCell('word '.repeat(80).trim(), 60, false)

  expect(lines.length > 6).toBe(true)
  expect(lines.join(' ')).toBe('word '.repeat(80).trim())
})

test('crowded columns start from their longest word, give the fullest the most, and stay inside the card', async () => {
  const least = [56, 65, 60, 70, 100]
  const widths = fitColumns([56, 120, 110, 105, 2000], 760, 84, least)
  const room = 760 - 2 * 24 - 84 - 4 * 28

  expect(Math.round(widths.reduce((sum, w) => sum + w, 0))).toBe(room)
  expect(widths.every((w, i) => w >= (least[i] ?? 0))).toBe(true)
  expect((widths[4] ?? 0) > 2 * (widths[1] ?? 0)).toBe(true)
})

test('a crowded table shows every word of every cell and header, and splits none', async () => {
  const note =
    'It accepts every reading that corrects the storage-gauge misread: 21.5 (Sol) up to 27.2–27.7 (the DC on the start-up day). ' +
    'It fails the three wrong answers: 63.2 (the published winter record), 15 (no overwintering) and 18.8 (the sheet total), and ends on FINISHED'
  const header = ['#', 'Where it appears', 'What it measures', 'Expected range', 'Note']
  const row = ['27', 'Season summary', 'TSK starting DC', 'about 20.0–28.0', note]
  const card = tableSvg({ kind: 'table', header, align: header.map(() => 'left' as const), rows: [row] }, tokyoNight.palette, 760, true)
  const words = new Set([...card.source.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].flatMap(match => (match[1] ?? '').split(' ')))

  expect(card.source).not.toContain('…')
  expect([...header.map(cell => cell.toUpperCase()), ...row].flatMap(cell => cell.split(' ')).every(word => words.has(word))).toBe(true)
})

const textsOf = (source: string, cls: string): { x: number; text: string }[] =>
  [...source.matchAll(/<text x="([\d.]+)"[^>]*class="([^"]*)"[^>]*>([^<]*)<\/text>/g)]
    .filter(match => match[2] === cls)
    .map(match => ({ x: Number(match[1]), text: match[3] ?? '' }))

test('rows run under the Copy button while the last header label stays clear of it', async () => {
  const note = 'a long note that fills its column from one side to the other '.repeat(8).trim()
  const header = ['#', 'What the row actually says about the reading']
  const card = tableSvg({ kind: 'table', header, align: ['left', 'left'], rows: [['1', note]] }, tokyoNight.palette, 760, true)
  const copyEdge = 760 - 24 - CONTROL_SLOT
  const headWidth = (line: string) => measureAt(line, false, 12) + [...line].length * 1.2

  expect(textsOf(card.source, '').some(line => line.x + measure(line.text, false) > copyEdge)).toBe(true)
  expect(textsOf(card.source, 'head').every(line => line.x + headWidth(line.text) <= copyEdge)).toBe(true)
  expect(card.source).toContain(`x2="${760 - 24}"`)
})

test('a last column too narrow to clear the Copy button keeps the gutter', async () => {
  const card = tableSvg({ kind: 'table', header: ['Note', 'N'], align: ['left', 'left'], rows: [['word '.repeat(60).trim(), '12']] }, tokyoNight.palette, 760, true)
  const [count] = textsOf(card.source, 'num')

  expect(Math.round(count?.x ?? 0)).toBe(760 - 24 - CONTROL_SLOT - 56)
})

test('a right-aligned last column keeps the gutter, so its label and its numbers end on one line', async () => {
  const card = tableSvg({ kind: 'table', header: ['Note', 'Count'], align: ['left', 'right'], rows: [['word '.repeat(60).trim(), '12']] }, tokyoNight.palette, 760, true)
  const [count] = textsOf(card.source, 'num')
  const [, label] = textsOf(card.source, 'head')

  expect(Math.round(count?.x ?? 0)).toBe(760 - 24 - CONTROL_SLOT)
  expect(Math.round(label?.x ?? 0)).toBe(Math.round(count?.x ?? 0))
})

test('a light palette is derived with dark text, light bands and deepened colours', async () => {
  const light = toLight(tokyoNight.palette)

  expect(light.fg).toBe('#1f1f1f')
  expect(light.surface).toBe('#ffffff')
  expect(light.run).toBe(deepen(tokyoNight.palette.run, 0.45))
  expect(deepen('#ffffff', 0.5)).toBe('#808080')
  expect(isLightTheme('light-daltonized')).toBe(true)
  expect(isLightTheme('dark')).toBe(false)
})

test('SKINS_THEME wins, then the theme, then the terminal and the system for auto', async () => {
  expect(resolveLight({ override: 'dark', theme: 'light' })).toBe(false)
  expect(resolveLight({ override: 'Light', theme: 'dark' })).toBe(true)
  expect(resolveLight({ override: '', theme: 'light-daltonized' })).toBe(true)
  expect(resolveLight({ theme: 'auto', colorfgbg: '0;15' })).toBe(true)
  expect(resolveLight({ theme: 'auto', colorfgbg: '15;default;0' })).toBe(false)
  expect(resolveLight({ theme: 'auto', systemDark: false })).toBe(true)
  expect(resolveLight({ theme: 'auto', systemDark: true })).toBe(false)
  expect(resolveLight({ theme: 'auto' })).toBe(false)
})

test('a pinned folder keeps its own prefs, others follow the default', async () => {
  const pinned = { ...DEFAULT_PREFS, skin: 'nord' }
  const folders = parseFolders({ '/a': pinned, '/b': { skin: 'nope' } }, NAMES)

  expect(prefsFor('/a', folders, DEFAULT_PREFS).skin).toBe('nord')
  expect(prefsFor('/b', folders, DEFAULT_PREFS).skin).toBe(DEFAULT_PREFS.skin)
  expect(prefsFor('/c', folders, DEFAULT_PREFS)).toBe(DEFAULT_PREFS)
  expect(Object.keys(withoutFolder(withFolder(folders, '/c', pinned), '/a'))).toEqual(['/b', '/c'])
  expect(parseFolders('junk', NAMES)).toEqual({})
})

test('every built-in skin names itself once and fills every slot with a colour, light palette too', async () => {
  const hex = /^#[0-9a-f]{6}$/
  const slots = Object.keys(tokyoNight.palette)

  expect(SKINS.length).toBe(8)
  expect(new Set(SKINS.map(skin => skin.name)).size).toBe(SKINS.length)

  for (const skin of SKINS) {
    for (const palette of [skin.palette, ...(skin.light === undefined ? [] : [skin.light])]) {
      expect(Object.keys(palette).sort()).toEqual([...slots].sort())
      expect(Object.values(palette).every(value => hex.test(value))).toBe(true)
    }

    expect(skin.spinner.length).toBeGreaterThan(0)
    expect(skin.done.length).toBeGreaterThan(0)
  }
})

test('the markdown pack lifts alerts, task lists and headings out of a reply and leaves links to markdown', async () => {
  const blocks = splitBlocks(
    [
      '## Plan',
      '',
      'Ran 54 tests in 3.2s on v1.4.0, see hooks/blocks.ts.',
      '',
      '> [!WARNING]',
      '> This deletes the cache.',
      '',
      '- [x] parse',
      '  - [ ] draw',
      '',
      'More in [the docs](https://example.com).',
      '',
      '```ts',
      '# not a heading',
      '```',
    ].join('\n'),
    { prose: true },
  )

  expect(blocks.map(block => block.kind)).toEqual(['heading', 'paragraph', 'alert', 'tasks', 'markdown'])
  expect(blocks[0]).toEqual({ kind: 'heading', level: 2, text: 'Plan' })
  expect(blocks[2]).toEqual({ kind: 'alert', type: 'warning', body: 'This deletes the cache.' })
  expect(blocks[3]).toEqual({ kind: 'tasks', items: [{ done: true, depth: 0, text: 'parse' }, { done: false, depth: 1, text: 'draw' }] })
  // The link and the fence after it stay one stretch of Claude Code's markdown.
  expect(blocks[4]).toEqual({ kind: 'markdown', text: 'More in [the docs](https://example.com).\n\n```ts\n# not a heading\n```' })

  const prose = splitBlocks('## Plan\n\nRan 54 tests.\n\n- [ ] ship', { prose: false })
  expect(prose.map(block => block.kind)).toEqual(['markdown', 'tasks'])
})

test('hard breaks keep the line breaks a reply was written with, and stay out of fences', async () => {
  // Two lines of one paragraph: Markdown would run them together without the break.
  expect(hardBreaks('Ran the tests.\nAll 54 passed.')).toBe('Ran the tests.  \nAll 54 passed.')
  // A blank line already parts two paragraphs, and the last line has nothing to carry on to.
  expect(hardBreaks('First.\n\nSecond.')).toBe('First.\n\nSecond.')
  // A fence is code: two spaces there would be part of it.
  expect(hardBreaks('Run it:\n```sh\nnpm test\nnpm run build\n```\nThen look.')).toBe(
    'Run it:  \n```sh\nnpm test\nnpm run build\n```\nThen look.',
  )
  // A line that already ends in a break, either way of writing one, is left as it is.
  expect(hardBreaks('Kept.  \nAnd.')).toBe('Kept.  \nAnd.')
  expect(hardBreaks('Kept.\\\nAnd.')).toBe('Kept.\\\nAnd.')
})

test('inline runs pick out code, emphasis, numbers, versions, paths and durations', async () => {
  const styled = (text: string) => inlineRuns(text).filter(run => run.style !== 'plain').map(run => `${run.style}:${run.text}`)

  expect(styled('Ran **54 tests** in 3.2s, `pnpm test` on v1.4.0.')).toEqual(['bold:54 tests', 'duration:3.2s', 'code:pnpm test', 'version:v1.4.0'])
  expect(styled('Edited hooks/rows.tsx and ./scripts/run.sh, 12% of 340 lines, took 140ms.')).toEqual([
    'path:hooks/rows.tsx',
    'path:./scripts/run.sh',
    'number:12%',
    'number:340',
    'duration:140ms',
  ])
  // Words with digits and snake_case stay plain.
  expect(styled('utf8 e2e my_var_name and/or')).toEqual([])
  expect(styled('*quiet* and ~~gone~~')).toEqual(['italic:quiet', 'strike:gone'])
})

test('inline runs colour both numbers of a range or date, but not a digit hyphenated onto a word', () => {
  const numbers = (text: string) => inlineRuns(text).filter(run => run.style === 'number').map(run => run.text)

  expect(numbers('timestamp (10-20 16:01)')).toEqual(['10', '20', '16', '01'])
  expect(numbers('see lines 10-20 on 2026-10-20')).toEqual(['10', '20', '2026', '10', '20'])
  expect(numbers('1-2-3')).toEqual(['1', '2', '3'])
  // A hyphen after a word, or after digits that are part of one, still guards the number.
  expect(numbers('gpt-4 utf-8 sha-256 x86-64 mp3-128')).toEqual([])
  expect(numbers('a -5 offset')).toEqual([])
})

test('inline runs keep a comma or underscore in a number only between digits', () => {
  const numbers = (text: string) => inlineRuns(text).filter(run => run.style === 'number').map(run => run.text)

  expect(numbers('3, 4 and 5')).toEqual(['3', '4', '5'])
  expect(numbers('rows 10, then (3, 4)')).toEqual(['10', '3', '4'])
  expect(numbers('on 2026-10-20, at 16:01')).toEqual(['2026', '10', '20', '16', '01'])
  expect(numbers('1_000, 3,,4')).toEqual(['1_000', '3', '4'])
  // Thousands groups and decimals stay whole.
  expect(numbers('3,301 and 12,345,678 and 1,000.50 and 12,345%')).toEqual(['3,301', '12,345,678', '1,000.50', '12,345%'])
})

test('quiet output splits a command on its separators and leaves quoted ones alone', () => {
  expect(segmentsOf('git status && ls -la | head; echo "a; b && c"')).toEqual(['git status', 'ls -la', 'head', 'echo "a; b && c"'])
  expect(segmentsOf("grep 'x|y' file")).toEqual(["grep 'x|y' file"])
  expect(segmentsOf('echo "never closed')).toBeNull()
})

test('quiet output only folds a command it is sure only reads', () => {
  const reads = [
    'git status',
    'git -C ../repo --no-pager log --oneline -5',
    'git diff HEAD~1 -- hooks/ | head -40',
    'rg -n "TODO|FIXME" hooks 2>/dev/null',
    'ls -la && cat package.json',
    'find . -name "*.ts" -not -path "./node_modules/*"',
    'sed -n 10,40p hooks/rows.tsx',
    'gh pr view 12 --json title',
    'grep -c ">" notes.md',
    'git branch --show-current',
  ]
  const writes = [
    'echo hi > out.txt',
    'cat a >> b',
    'ls $(pwd)',
    'ls `pwd`',
    'cat <<EOF\nx\nEOF',
    'sed -i s/a/b/ file',
    'sed -n -e 1p -e "w out" file',
    'sed -n 1p -i file',
    'find . -name "*.tmp" -delete',
    'find . -exec rm {} \;',
    'git checkout main',
    'git branch -D old',
    'git stash',
    'gh pr merge 12',
    'npm test',
    'rm -rf dist',
    'FOO=1 ls',
    'ls && rm a',
    'sort -o out.txt in.txt',
    'diff <(ls a) <(ls b)',
    'echo "unclosed',
    '',
  ]

  for (const command of reads) {
    expect([command, isReadOnlyShell(command)]).toEqual([command, true])
  }

  for (const command of writes) {
    expect([command, isReadOnlyShell(command)]).toEqual([command, false])
  }

  expect(isReadOnlyShell('Get-Content a.txt | Select-String foo', 'powershell')).toBe(true)
  expect(isReadOnlyShell('Get-ChildItem | Where-Object { $_.Length -gt 0 }', 'powershell')).toBe(false)
  expect(isReadOnlyShell('Remove-Item a.txt', 'powershell')).toBe(false)
  expect(isReadOnlyShell('git status 2>$null', 'powershell')).toBe(true)
})

test('quiet output covers reads, searches and read-only shell calls, and finds the failing line', () => {
  expect(isQuiet('Read', { file_path: '/a' })).toBe(true)
  expect(isQuiet('Grep', { pattern: 'x' })).toBe(true)
  expect(isQuiet('Bash', { command: 'git log -3' })).toBe(true)
  expect(isQuiet('Bash', { command: 'pnpm build' })).toBe(false)
  expect(isQuiet('PowerShell', { command: 'Get-Content a' })).toBe(true)
  expect(isQuiet('Edit', { file_path: '/a' })).toBe(false)
  expect(isQuiet('WebFetch', { url: 'https://a' })).toBe(false)

  expect(errorLine('<tool_use_error>File does not exist.</tool_use_error>')).toBe('File does not exist.')
  expect(errorLine({ stdout: 'Exit code 128', stderr: 'warning: x\nfatal: not a git repository\n' })).toBe('fatal: not a git repository')
  expect(errorLine({ stdout: '', stderr: '' })).toBe('Failed')
  expect(errorLine('one\ntwo\n')).toBe('two')
})

test('/skin copy takes the whole reply, or with code its last code block', async () => {
  const reply = 'Try:\n\n```ts\nconst a = 1\n```\n\nor:\n\n```bash\npnpm build\n```'

  expect(copyOf(reply, false)).toEqual({ text: reply })
  expect(copyOf(reply, true)).toEqual({ text: 'pnpm build' })
  expect(copyOf('No code here.', true)).toEqual({ message: 'No code block in the last reply' })
  expect(copyOf('  \n', false)).toEqual({ message: 'Nothing to copy yet' })
})

const DAY = 86_400_000

const SAMPLES = [
  'gantt\n  dateFormat YYYY-MM-DD\n  Parser :p1, 2026-10-01, 4d\n  Cards :after p1, 3d',
  'timeline\n  2002 : LinkedIn\n  2004 : Facebook',
  'journey\n  section Work\n    Make tea: 5: Me\n    Do work: 1: Me',
  "kanban\n  Todo\n    [Write docs]@{ assigned: 'sverre', priority: 'High' }\n  Done\n    [Pie]",
  'mindmap\n  root((Skins))\n    Charts\n    Themes',
  'quadrantChart\n  x-axis Low --> High\n  y-axis Cold --> Hot\n  A: [0.3, 0.6]',
  'radar-beta\n  axis a["Speed"], b["Power"], c["Range"]\n  curve x["Ship"]{3, 4, 5}',
  'sankey-beta\nFarm,Mill,120\nMill,Bread,80',
  'gitGraph\n  commit\n  branch dev\n  commit\n  checkout main\n  merge dev',
  'treemap-beta\n"Compute"\n    "EC2": 420\n    "Lambda": 160\n"Storage"\n    "S3": 210\n"Network": 75',
  'packet-beta\n  0-15: "Source Port"\n  16-31: "Destination Port"\n  32: "URG"\n  33: "ACK"\n  34-63: "Rest"',
  'block-beta\n  columns 3\n  a["Web"]:2 b(("CDN"))\n  block:back:3\n    c[("DB")] d{"Cache"}\n  end\n  a --> c\n  b -- "push" --> a',
  'architecture-beta\n  group cloud(cloud)[Cloud]\n  service api(server)[API] in cloud\n  service db(database)[Database] in cloud\n  junction mid\n  api:R --> L:db\n  api:B -- T:mid',
  'C4Context\n  Person(u, "User", "Signs in")\n  System_Boundary(s, "Shop") {\n    System(web, "Web", "Sells things")\n  }\n  Rel(u, web, "Buys", "HTTPS")',
]

test('splitReply can leave tables and turned-down fences as text', async () => {
  const reply = '| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nx\n```\n\n```mermaid\npie\n  "a" : 1\n```'
  const segments = splitReply(reply, { tables: false, fence: lang => lang === 'mermaid' })

  expect(segments.map(segment => segment.kind)).toEqual(['text', 'code'])
  expect(segments[0]?.kind === 'text' && segments[0].text).toContain('```ts')
})

test('each system says dark, light, or nothing', async () => {
  const ran = (exitCode: number, stdout: string, stderr = '') => ({ exitCode, stdout, stderr })
  const windows = (value: string) =>
    ran(0, `\r\nHKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\r\n    AppsUseLightTheme    REG_DWORD    ${value}\r\n\r\n`)

  expect(macDark(ran(0, 'Dark\n'))).toBe(true)
  expect(macDark(ran(1, '', 'The domain/default pair of (kCFPreferencesAnyApplication, AppleInterfaceStyle) does not exist'))).toBe(false)
  expect(macDark(ran(1, '', "Error: Could not find key 'AppleInterfaceStyle' in domain 'kCFPreferencesAnyApplication'."))).toBe(false)
  expect(macDark(ran(127, '', 'command not found'))).toBe(undefined)

  expect(windowsDark(windows('0x0'))).toBe(true)
  expect(windowsDark(windows('0x1'))).toBe(false)
  expect(windowsDark(ran(1, '', 'ERROR: The system was unable to find the specified registry key or value.'))).toBe(undefined)

  expect(gnomeDark(ran(0, "'prefer-dark'\n"))).toBe(true)
  expect(gnomeDark(ran(0, "'default'\n"))).toBe(false)
  expect(gnomeDark(ran(1, '', 'No such schema'))).toBe(undefined)
})

function animationEndsMs(source: string): number {
  const timings = new Map(
    [...source.matchAll(/\.([\w-]+)\{[^}]*?animation:[\w-]+ (\d+)ms([^;}]*)/g)].map(([, name = '', duration = '0', rest = '']) => [
      name,
      Number(duration) + Number(/ (\d+)ms/.exec(rest)?.[1] ?? 0),
    ]),
  )

  return Math.max(
    0,
    ...[...source.matchAll(/<\w+([^>]*)>/g)].map(([, attributes = '']) => {
      const timing = timings.get(/class="([\w-]+)"/.exec(attributes)?.[1] ?? '')

      return timing === undefined ? 0 : timing + Number(/animation-delay:(\d+)ms/.exec(attributes)?.[1] ?? 0)
    }),
  )
}

test('a card says when its entrance ends, and no entrance lasts past a second', async () => {
  const many = (count: number) => Array.from({ length: count }, (_, i) => `line ${i}`)
  const table = (rows: number) => tableSvg({ kind: 'table', header: ['n'], align: ['left'], rows: many(rows).map(line => [line]) }, tokyoNight.palette, 700)
  const diff = (lines: number) =>
    diffSvg(hunksOf({ filePath: '/work/a.ts', structuredPatch: [{ oldStart: 1, newStart: 1, lines: many(lines).map(line => `+${line}`) }] })!, 'a.ts', tokyoNight.palette, 700)
  const shell = (lines: number) => terminalSvg(shellOutputOf({ stdout: many(lines).join('\n'), stderr: '', interrupted: false })!, false, tokyoNight.palette, 700)
  const cards = {
    table1: table(1),
    table5: table(5),
    table120: table(120),
    code1: codeSvg('a', 'ts', tokyoNight.palette, 700),
    code200: codeSvg(many(200).join('\n'), 'ts', tokyoNight.palette, 700),
    diff2: diff(2),
    diff100: diff(100),
    shell0: shell(0),
    shell100: shell(100),
    usage: usageSvg([{ label: 'context', percent: 42 }], tokyoNight.palette),
  }

  for (const [name, card] of Object.entries(cards)) {
    expect(card.entranceMs, `${name} settles only after its last animation ends`).toBeGreaterThanOrEqual(animationEndsMs(card.source))
    expect(card.entranceMs, `${name} entrance stays short`).toBeLessThanOrEqual(1000)
  }
})

test('a settled usage band keeps its rings full and still', async () => {
  const source = settled(usageSvg([{ label: 'context', percent: 42 }], tokyoNight.palette).source)

  expect(source).toContain('class="fill"')
  expect(source).toContain('.fill{animation:none!important')
})

test('calm saves what it changes and calm off puts exactly that back', () => {
  const mine = { ...DEFAULT_PREFS, rail: false, quiet: false, shimmer: true, skin: 'nord' }
  const calm = withCalm(mine, true)

  expect(calm).toEqual({ ...mine, shimmer: false, rail: false, quiet: true, calm: { shimmer: true, rail: false, quiet: false } })
  expect(withCalm(calm, true)).toBe(calm)
  expect(withCalm({ ...calm, skin: 'dracula' }, false)).toEqual({ ...mine, skin: 'dracula' })
  expect(withCalm(mine, false)).toBe(mine)
  expect(runSkinCommand('calm', mine, NAMES).prefs).toEqual(calm)
  expect(runSkinCommand('calm off', calm, NAMES).prefs).toEqual(mine)
  expect(runSkinCommand('calm maybe', mine, NAMES).channel).toBe('row')
  // A stored snapshot survives the round trip; a broken one reads as calm off.
  expect(parsePrefs(JSON.parse(JSON.stringify(calm)), NAMES).calm).toEqual(calm.calm)
  expect(parsePrefs({ calm: { shimmer: 'yes' } }, NAMES).calm).toBeNull()
  expect(runSkinCommand('shell off', DEFAULT_PREFS, NAMES).prefs.shell).toBe(false)
})

test('shell output folds per stream, and a failure names its exit code when it has one', () => {
  expect(foldLines([1, 2, 3, 4, 5], 2, 2)).toEqual([1, 2, 3, 4, 5])
  expect(foldLines([1, 2, 3, 4, 5, 6], 2, 2)).toEqual([1, 2, { fold: 2 }, 5, 6])

  expect(shellResultOf('Exit code 127\nbash: nope: command not found', true)).toEqual({ stdout: '', stderr: 'bash: nope: command not found', interrupted: false, exitCode: 127 })
  expect(shellResultOf('<tool_use_error>blocked</tool_use_error>', true)).toEqual({ stdout: '', stderr: 'blocked', interrupted: false })
  expect(shellResultOf({ content: 'x' }, false)).toBeNull()

  const ok = { stdout: '', stderr: '', interrupted: false }
  expect(shellStatus(ok, false, false)).toEqual({ tone: 'ok', text: '✓' })
  expect(shellStatus({ ...ok, returnCodeInterpretation: 'No matches found' }, false, true)).toEqual({ tone: 'ok', text: 'ok No matches found' })
  expect(shellStatus({ ...ok, exitCode: 1 }, true, false)).toEqual({ tone: 'err', text: '✗ exit 1' })
  expect(shellStatus({ ...ok, interrupted: true }, true, false).tone).toBe('warn')
})

test('text cut to a width keeps what fits beside the ellipsis, and at least one character', () => {
  // Mono at 12.5 is 7.5 a character: 4000 leaves room for 532 and the ellipsis.
  expect(fitText('x'.repeat(5000), 4000, true, 12.5)).toBe(`${'x'.repeat(532)}…`)
  expect(fitText('short', 4000, true, 12.5)).toBe('short')
  expect(fitText('mmmm', 10, false, 12.5)).toBe('m…')
  expect(fitText('iiii mmmm', 30, false, 10)).toBe('iiii m…')
})


test('fhva-skins ships neon, quiet reads and no alerts, charts, math or hints', () => {
  expect(DEFAULT_PREFS.skin).toBe('neon')
  expect(SKINS[0]?.name).toBe('neon')
  expect(DEFAULT_PREFS.quiet).toBe(true)
  expect(DEFAULT_PREFS.markdown).toBe(false)
  expect(Object.keys(DEFAULT_PREFS)).not.toContain('charts')
  expect(Object.keys(TOGGLES)).not.toContain('hints')
})

test('the band names the model and effort the main loop runs on', () => {
  expect(modelLabel('claude-opus-5-5', 'high')).toBe('Opus 5.5 · high')
  expect(modelLabel('claude-haiku-5-5', null)).toBe('Haiku 5.5')
  expect(modelLabel('some-other-model', null)).toBe('some-other-model')
  expect(modelLabel(undefined, 'high')).toBe('')
})
