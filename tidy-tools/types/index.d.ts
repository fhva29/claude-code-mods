export type ToolTiming = { id: string; ms: number }
export type ToolTurn = { id: string; turn: string }

declare module 'claude-code' {
  interface PluginState {
    'tidy-tools': {
      timings: ToolTiming[]
      expanded: string[]
      turnOf: ToolTurn[]
      openTurns: string[]
      failed: string[]
      currentTurn: string
    }
  }
}
