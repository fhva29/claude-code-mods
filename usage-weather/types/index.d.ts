export type UsageWeatherReading = { tokens: number; window: number; percent: number }

export type UsageWeatherLimit = { kind: string; percentUsed: number }

export type UsageWeatherSnapshot = {
  limits: UsageWeatherLimit[]
  model: string
  effort: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-weather': {
      readings: UsageWeatherReading[]
      snapshot: UsageWeatherSnapshot | null
      isHidden: boolean
    }
  }
}
