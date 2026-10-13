export type HeroStats = {
  battles: number
  forged: number
  explored: number
  summons: number
  treasures: number
  defeats: number
  turns: number
}

export type HeroSave = { xp: number; stats: HeroStats; unlocked: string[] }

export type QuestScene = {
  active: string | null
  flash: string | null
  flashUntil: number
  startedAt: number
  tools: number
  lastGain: number
}

declare module 'claude-code' {
  interface PluginState {
    'pixel-quest': {
      now: number
      scene: QuestScene
      hero: HeroSave | null
      isHidden: boolean
      isWide: boolean
    }
  }
}
