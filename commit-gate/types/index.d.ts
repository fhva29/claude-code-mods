export type CommitGateFile = { path: string; status: string; isTouched: boolean }

export type CommitGateHold = {
  id: string
  command: string
  message: string
  files: CommitGateFile[]
  pendingAdds: string[]
  decision: 'commit' | 'cancel' | null
}

declare module 'claude-code' {
  interface PluginState {
    'commit-gate': {
      touched: string[]
      hold: CommitGateHold | null
    }
  }
}
