import { expect, test } from 'claude-code/testing'

import { type Hud, hudSvg, joiLine, resetCaption, timeGone } from '../hooks/hud'

const NOW = Date.parse('2026-11-13T22:23:00')

const base: Hud = {
  now: NOW,
  context: { percent: 11, tokens: 109_000, window: 1_000_000, messages: 5, system: 2, other: 4 },
  history: [3, 6, 9, 11],
  limits: [
    { kind: 'five_hour', percentUsed: 96, resetsAt: new Date(NOW + 130 * 60_000).toISOString() },
    { kind: 'seven_day', percentUsed: 38, resetsAt: new Date(NOW + (3 * 24 + 5) * 3600_000).toISOString() },
  ],
  toolsPerTurn: [0, 3, 7, 2],
  toolCalls: 12,
  turns: 10,
  lastTurnMs: 3000,
  failed: 1,
  uptimeMs: 14 * 60_000,
  isWorking: false,
  message: 'a < b & "c"',
}

test('limit pace and captions', async () => {
  const five = base.limits[0]!
  expect(Math.round(timeGone(five, NOW)! * 100)).toBe(57)
  expect(resetCaption(five, NOW).endsWith('FALTAM 2H 10M · ACIMA DO RITMO')).toBe(true)
  expect(resetCaption(base.limits[1]!, NOW).includes('FALTAM 3D 5H · ABAIXO DO RITMO')).toBe(true)
  expect(timeGone({ kind: 'spend_limit', percentUsed: 5 }, NOW)).toBe(null)
})

test('the developer speaks of a hot limit first, else the last turn', async () => {
  expect(joiLine(base.limits, 3000, 2, NOW).startsWith('Você usou 96% do limite de 5 horas. Renova às')).toBe(true)
  expect(joiLine([], 3000, 1, NOW)).toBe('O último turno levou 3s com 1 chamada de ferramenta.')
})

test('svg escapes text, draws with and without data', async () => {
  const svg = hudSvg(base)
  expect(svg.includes('a &#60; b &#38; &#34;c&#34;')).toBe(true)
  expect(svg.includes('11%')).toBe(true)
  expect(svg.length < 131_072).toBe(true)
  const empty = hudSvg({ ...base, context: null, history: [], limits: [], toolsPerTurn: [], lastTurnMs: null })
  expect(empty.includes('NENHUMA FERRAMENTA AINDA')).toBe(true)
  expect(empty.includes('SEM LEITURA DE LIMITE AINDA')).toBe(true)
})

test('the developer narrates the turn in flight', async () => {
  expect(joiLine(base.limits, 3000, 2, NOW, { elapsedMs: 12_000, tools: 0, tool: null })).toBe('Pensando há 12s…')
  expect(joiLine(base.limits, 3000, 2, NOW, { elapsedMs: 75_000, tools: 3, tool: 'Bash pytest -q' })).toBe(
    'Trabalhando há 1m 15s · 3 chamadas de ferramenta · agora: Bash pytest -q',
  )
  expect(joiLine([], null, 0, NOW, { elapsedMs: null, tools: 1, tool: null })).toBe('Trabalhando · 1 chamada de ferramenta')
})
