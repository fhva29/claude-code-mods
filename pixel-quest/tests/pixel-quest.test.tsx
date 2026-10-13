import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_HERO, levelOf, questXp, reward, toolXp, xpBar } from '../hooks/progress'
import { toCells } from '../hooks/raster'
import { PALETTE, PX_HEIGHT, PX_WIDTH, SCENE_IDS, drawScene, sceneForTool } from '../hooks/scenes'

describe('scenes', () => {
  test('tools pick their scene', async () => {
    expect(sceneForTool('Bash', 'rtk pytest accounts/tests -q')).toBe('battle')
    expect(sceneForTool('Bash', 'npm run lint')).toBe('battle')
    expect(sceneForTool('Bash', 'git status')).toBe('treasure')
    expect(sceneForTool('Bash', 'ls -la')).toBe('mine')
    expect(sceneForTool('Edit')).toBe('forge')
    expect(sceneForTool('Grep')).toBe('dungeon')
    expect(sceneForTool('Agent')).toBe('summon')
    expect(sceneForTool('mcp__sentry__search_issues')).toBe('voyage')
    expect(sceneForTool('TodoWrite')).toBe('camp')
  })

  test('every frame fills the grid with known colors', async () => {
    for (const id of SCENE_IDS) {
      for (let tick = 0; tick < 6; tick += 1) {
        const grid = drawScene(id, tick)
        expect(grid.length).toBe(PX_HEIGHT)
        for (const row of grid) {
          expect(row.length).toBe(PX_WIDTH)
          expect(row.every(pixel => pixel === '.' || PALETTE[pixel] !== undefined)).toBe(true)
        }
      }
    }
  })

  test('wide scenes span the asked width', async () => {
    for (const id of SCENE_IDS) {
      const grid = drawScene(id, 1, 130)
      expect(grid.every(row => row.length === 130)).toBe(true)
      expect(grid[PX_HEIGHT - 1]?.[129] === '.' && id !== 'voyage').toBe(false)
    }
  })

  test('cells pack two pixels per terminal row', async () => {
    const { columns, rows, cells } = toCells(drawScene('camp', 0))
    expect(columns).toBe(PX_WIDTH)
    expect(rows).toBe(PX_HEIGHT / 2)
    expect(cells.length).toBe(Math.ceil((columns * rows * 12) / 3) * 4)
  })
})

describe('progress', () => {
  test('longer and harder tools give more XP, capped', async () => {
    expect(toolXp('dungeon', 0)).toBe(2)
    expect(toolXp('battle', 0)).toBe(15)
    expect(toolXp('battle', 30_000)).toBe(21)
    expect(toolXp('dungeon', 600_000)).toBe(10)
    expect(questXp(10, 60_000)).toBe(29)
    expect(questXp(100, 0)).toBe(80)
  })

  test('each level needs more XP than the last', async () => {
    expect(levelOf(0)).toEqual({ level: 1, into: 0, needed: 50 })
    expect(levelOf(50)).toEqual({ level: 2, into: 0, needed: 141 })
    expect(levelOf(216)).toEqual({ level: 3, into: 25, needed: 260 })
    expect(xpBar(25, 50, 8)).toBe('▰▰▰▰▱▱▱▱')
  })

  test('a won battle gives XP and the first achievement once', async () => {
    const first = reward(EMPTY_HERO, 'battle', false)
    expect(first.hero.xp).toBe(15)
    expect(first.hero.stats.battles).toBe(1)
    expect(first.earned).toEqual(['First Blood: first test battle'])

    const second = reward(first.hero, 'battle', false)
    expect(second.earned).toEqual([])
  })

  test('a failure counts a defeat and still levels up eventually', async () => {
    const lost = reward(EMPTY_HERO, 'forge', true)
    expect(lost.hero.xp).toBe(1)
    expect(lost.hero.stats.defeats).toBe(1)
    expect(lost.hero.stats.forged).toBe(0)

    const near = { ...EMPTY_HERO, xp: 45 }
    expect(reward(near, 'forge', false).levelUp).toBe(2)
  })
})

test('the spinner keeps its line and draws the scene and the hero line under it', async ($, on) => {
  on('session.start', () => ({ cwd: '/repo' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('store.get', () => ({ value: undefined }) as never)
  on('ui.render', () => h('Text', {}, 'Questing… (3s · ↓ 120 tokens)') as never)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const props = { word: 'Questing', message: null, suffix: '…', mode: 'thinking' } as const
  const ui = await $.ui.mount({ plugin: 'pixel-quest', surface: 'terminal', component: 'Spinner', props })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')
  expect(await ui.find({ type: 'Text', text: /Questing… \(3s/ }), texts).toBeDefined()
  expect(await ui.find({ type: 'Raster' }), texts).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Lv 1 Novice/ }), texts).toBeDefined()
  await ui.unmount()
})
