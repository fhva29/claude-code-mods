export type BranchHudChange = { status: string; path: string }

export type BranchHudMigration = { app: string; name: string; isCommitted: boolean }

export type BranchHudCommit = { sha: string; subject: string }

export type BranchHudSnapshot = {
  branch: string
  base: string
  ahead: number
  behind: number
  changes: BranchHudChange[]
  migrations: BranchHudMigration[]
  commits: BranchHudCommit[]
}

declare module 'claude-code' {
  interface PluginState {
    'branch-hud': { snapshot: BranchHudSnapshot | null }
  }
}
