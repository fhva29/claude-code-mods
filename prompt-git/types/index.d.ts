export type PromptGitSummary = string | null

declare module 'claude-code' {
  interface PluginState {
    'prompt-git': { summary: PromptGitSummary }
  }
}
