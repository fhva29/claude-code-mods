import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { HeroSave, QuestScene } from '../types'
import { EMPTY_HERO, heroSheet, levelOf, questReward, reward, titleOf, xpBar } from './progress'
import type { Reward } from './progress'
import { toCells } from './raster'
import { PX_WIDTH, drawScene, sceneForTool } from './scenes'
import type { SceneId } from './scenes'

const FRAME_MS = 200
const FLASH_MS = 1600
const MAX_COLUMNS = 512
const INDENT = 2
const STORE_HERO = 'hero'
const STORE_HIDDEN = 'isHidden'
const STORE_WIDE = 'isWide'

const now = atom({ plugin: 'pixel-quest', key: 'now' } as const, 0)
const scene = atom({ plugin: 'pixel-quest', key: 'scene' } as const, {
  active: null,
  flash: null,
  flashUntil: 0,
  startedAt: 0,
  tools: 0,
  lastGain: 0,
})
const hero = atom({ plugin: 'pixel-quest', key: 'hero' } as const, null)
const isHidden = atom({ plugin: 'pixel-quest', key: 'isHidden' } as const, false)
const isWide = atom({ plugin: 'pixel-quest', key: 'isWide' } as const, true)

async function loadHero($: EngineInterface): Promise<HeroSave> {
  const held = await read($, hero)
  if (held !== null) return held
  const saved = ((await $.store.get(STORE_HERO)) as HeroSave | undefined) ?? EMPTY_HERO
  const merged: HeroSave = { ...EMPTY_HERO, ...saved, stats: { ...EMPTY_HERO.stats, ...saved.stats } }
  await update($, hero, () => merged)
  return merged
}

async function applyReward($: EngineInterface, outcome: Reward): Promise<void> {
  await update($, hero, () => outcome.hero)
  await $.store.set(STORE_HERO, outcome.hero)
  if (outcome.levelUp !== null) {
    $.ui.toast(`⬆ LEVEL UP! Lv ${outcome.levelUp} ${titleOf(outcome.levelUp)}`)
  }
  for (const name of outcome.earned) {
    $.ui.toast(`★ Achievement unlocked: ${name}`)
  }
}

let timer: Timer | null = null

async function startTicking($: EngineInterface): Promise<void> {
  if (timer !== null || (await read($, isHidden))) return
  timer = $.clock.every(FRAME_MS, () => {
    void $.clock.now().then(ms => update($, now, () => ms))
  })
}

function stopTicking(): void {
  timer?.cancel()
  timer = null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'toons',
      description: 'Toggle the pixel quest spinner; "/toons wide" switches full width, "/toons stats" shows your hero',
    })
    const hidden = (await $.store.get(STORE_HIDDEN)) === true
    const wide = (await $.store.get(STORE_WIDE)) !== false
    await update($, isHidden, () => hidden)
    await update($, isWide, () => wide)
    await loadHero($)
    return result
  })

  on('command.run', { command: 'toons' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'stats') {
      return { text: heroSheet(await loadHero($)) }
    }
    if (arg === 'wide') {
      const wide = await update($, isWide, value => !value)
      await $.store.set(STORE_WIDE, wide)
      return { text: wide ? 'Pixel quest spans the terminal width.' : `Pixel quest is ${PX_WIDTH} columns wide.` }
    }
    const hidden = await update($, isHidden, value => !value)
    await $.store.set(STORE_HIDDEN, hidden)
    if (hidden) stopTicking()
    return { text: hidden ? 'Pixel quest hidden.' : 'Pixel quest shown.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const startedAt = await $.clock.now()
    await update($, now, () => startedAt)
    await update($, scene, held => ({ ...held, active: null, flash: null, startedAt, tools: 0 }))
    await startTicking($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = sceneForTool(e.tool, e.tool === 'Bash' ? e.command : undefined)
    await update($, scene, held => ({ ...held, active: id }))
    await startTicking($)

    const started = await $.clock.now()
    const ran = await next(e)
    const finished = await $.clock.now()
    const isError = ran.deny === undefined && ran.isError === true
    const outcome = reward(await loadHero($), id, isError, finished - started)
    await applyReward($, outcome)

    const flash: SceneId | null = isError ? 'defeat' : id === 'battle' ? 'victory' : null
    await update($, scene, held => ({
      ...held,
      active: held.active === id ? null : held.active,
      flash: flash ?? held.flash,
      flashUntil: flash === null ? held.flashUntil : finished + FLASH_MS,
      tools: held.tools + 1,
      lastGain: outcome.gained,
    }))
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      stopTicking()
      const held = await read($, scene)
      const duration = held.startedAt > 0 ? (await $.clock.now()) - held.startedAt : 0
      await applyReward($, questReward(await loadHero($), held.tools, duration))
    }
    return result
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || (await read($, isHidden))) {
      return next(e)
    }

    const ms = await read($, now)
    const held: QuestScene = await read($, scene)
    const sheet = (await read($, hero)) ?? EMPTY_HERO
    const isFlashing = held.flash !== null && ms < held.flashUntil
    const id = ((isFlashing ? held.flash : held.active) ?? 'camp') as SceneId
    const columns = (await read($, isWide))
      ? Math.min(MAX_COLUMNS, (e.viewport?.columns ?? PX_WIDTH + INDENT) - INDENT)
      : PX_WIDTH
    const raster = toCells(drawScene(id, Math.floor(ms / FRAME_MS), columns))
    const { level, into, needed } = levelOf(sheet.xp)
    const line = await next(e)
    const { Box, Raster, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {line}
        <Box paddingLeft={INDENT}>
          <Raster key="scene" {...raster} />
        </Box>
        <Text>
          <Text dimColor>
            {'  '}Lv {level} {titleOf(level)}{' '}
          </Text>
          <Text color="yellow">{xpBar(into, needed)}</Text>
          <Text dimColor>
            {' '}
            {into}/{needed} XP
          </Text>
          {held.lastGain > 0 && <Text color="green"> +{held.lastGain}</Text>}
        </Text>
      </Box>
    )
  })
}
