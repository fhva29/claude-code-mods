export type RewriteEntry = { before: string; after: string; changes: string[] }

declare module 'claude-code' {
  interface PluginState {
    'venv-guard': { history: RewriteEntry[] }
  }
}
