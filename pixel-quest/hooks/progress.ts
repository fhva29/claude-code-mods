import type { HeroSave, HeroStats } from '../types'
import type { SceneId } from './scenes'

export const EMPTY_HERO: HeroSave = {
  xp: 0,
  stats: { battles: 0, forged: 0, explored: 0, summons: 0, treasures: 0, defeats: 0, turns: 0 },
  unlocked: [],
}

const XP_BY_SCENE: Partial<Record<SceneId, number>> = {
  battle: 15,
  forge: 10,
  summon: 20,
  treasure: 8,
  mine: 4,
  voyage: 4,
  dungeon: 2,
}

const STAT_BY_SCENE: Partial<Record<SceneId, keyof HeroStats>> = {
  battle: 'battles',
  forge: 'forged',
  dungeon: 'explored',
  summon: 'summons',
  treasure: 'treasures',
}

const TITLES = ['Novice', 'Squire', 'Adventurer', 'Knight', 'Paladin', 'Champion', 'Archmage', 'Hero of Legend']

type Achievement = { id: string; name: string; isEarned: (hero: HeroSave) => boolean }

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-blood', name: 'First Blood: first test battle', isEarned: h => h.stats.battles >= 1 },
  { id: 'slime-slayer', name: 'Slime Slayer: 100 test battles', isEarned: h => h.stats.battles >= 100 },
  { id: 'blacksmith', name: 'Blacksmith: 100 files forged', isEarned: h => h.stats.forged >= 100 },
  { id: 'cartographer', name: 'Cartographer: 500 rooms explored', isEarned: h => h.stats.explored >= 500 },
  { id: 'summoner', name: 'Summoner: 10 allies summoned', isEarned: h => h.stats.summons >= 10 },
  { id: 'phoenix-down', name: 'Phoenix Down: rose from 25 defeats', isEarned: h => h.stats.defeats >= 25 },
  { id: 'veteran', name: 'Veteran: reached level 10', isEarned: h => levelOf(h.xp).level >= 10 },
]

/** XP needed to go from `level` to the next: 50, 141, 260, 400 ... 1581 at level 10. */
export function xpToNext(level: number): number {
  return Math.round(50 * level ** 1.5)
}

export function levelOf(xp: number): { level: number; into: number; needed: number } {
  let level = 1
  let floor = 0
  while (xp >= floor + xpToNext(level)) {
    floor += xpToNext(level)
    level += 1
  }
  return { level, into: xp - floor, needed: xpToNext(level) }
}

export function titleOf(level: number): string {
  return TITLES[Math.min(TITLES.length - 1, Math.floor((level - 1) / 3))] ?? 'Novice'
}

export function xpBar(into: number, needed: number, width = 8): string {
  const filled = Math.min(width, Math.floor((into / needed) * width))
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

export type Reward = { hero: HeroSave; gained: number; levelUp: number | null; earned: string[] }

/** Base XP by scene plus one XP per 5 s the tool ran, the time bonus capped at 4x the base. */
export function toolXp(scene: SceneId, durationMs: number): number {
  const base = XP_BY_SCENE[scene] ?? 1
  const timeBonus = Math.min(base * 4, Math.floor(durationMs / 5000))
  return base + timeBonus
}

/** A finished turn is a quest: 5 XP, 2 per tool used and 1 per 15 s, capped at 80. */
export function questXp(tools: number, durationMs: number): number {
  return Math.min(80, 5 + tools * 2 + Math.floor(durationMs / 15000))
}

function grant(hero: HeroSave, gained: number, stats: HeroStats): Reward {
  const xp = hero.xp + gained
  const before = levelOf(hero.xp).level
  const after = levelOf(xp).level
  const next: HeroSave = { xp, stats, unlocked: hero.unlocked }
  const earned = ACHIEVEMENTS.filter(a => !hero.unlocked.includes(a.id) && a.isEarned(next))

  return {
    hero: { ...next, unlocked: [...hero.unlocked, ...earned.map(a => a.id)] },
    gained,
    levelUp: after > before ? after : null,
    earned: earned.map(a => a.name),
  }
}

/** Applies one finished tool call; a failure counts a defeat and gives 1 XP. */
export function reward(hero: HeroSave, scene: SceneId, isError: boolean, durationMs = 0): Reward {
  const stats = { ...hero.stats }
  const stat = STAT_BY_SCENE[scene]
  if (isError) {
    stats.defeats += 1
  } else if (stat !== undefined) {
    stats[stat] += 1
  }
  return grant(hero, isError ? 1 : toolXp(scene, durationMs), stats)
}

export function questReward(hero: HeroSave, tools: number, durationMs: number): Reward {
  return grant(hero, questXp(tools, durationMs), { ...hero.stats, turns: hero.stats.turns + 1 })
}

export function heroSheet(hero: HeroSave): string {
  const { level, into, needed } = levelOf(hero.xp)
  const s = hero.stats
  const unlocked = ACHIEVEMENTS.filter(a => hero.unlocked.includes(a.id)).map(a => `  ★ ${a.name}`)
  return [
    `Lv ${level} ${titleOf(level)}  ${xpBar(into, needed)} ${into}/${needed} XP (${hero.xp} total)`,
    `Battles ${s.battles} · Forged ${s.forged} · Explored ${s.explored} · Summons ${s.summons} · Treasures ${s.treasures} · Defeats ${s.defeats} · Quests ${s.turns}`,
    `Achievements ${unlocked.length}/${ACHIEVEMENTS.length}`,
    ...unlocked,
  ].join('\n')
}
