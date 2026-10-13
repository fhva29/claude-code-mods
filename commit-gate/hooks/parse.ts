const COMMIT = /(^|&&|\|\||;|\|)\s*git(?:\s+-C\s+\S+)?\s+commit\b/
const ADD = /(?:^|&&|\|\||;)\s*git(?:\s+-C\s+\S+)?\s+add\s+([^;&|]+)/g
const ATTRIBUTION = [
  /co-authored-by:/i,
  /generated with \[?claude/i,
  /claude-session/i,
  /🤖/,
]

export function isCommit(command: string): boolean {
  return COMMIT.test(command)
}

export function attributionIn(command: string): string | null {
  const hit = ATTRIBUTION.find(pattern => pattern.test(command))
  return hit === undefined ? null : (command.match(hit)?.[0] ?? null)
}

// Paths a `git add` in the same command will stage before the commit runs.
export function pendingAdds(command: string): string[] {
  const paths: string[] = []
  for (const match of command.matchAll(ADD)) {
    const args = (match[1] ?? '').trim().split(/\s+/)
    paths.push(...args.filter(arg => arg !== '' && !arg.startsWith('-')).map(unquote))
  }
  return paths
}

// The first line of `-m "..."`, or of a heredoc body, when the command shows one.
export function commitMessage(command: string): string {
  const heredoc = /<<-?\s*'?(\w+)'?\s*\n([\s\S]*?)\n\s*\1\b/.exec(command)
  if (heredoc !== null) {
    return heredoc[2]?.trim() ?? ''
  }
  const inline = /\s-m\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(command)
  return (inline?.[1] ?? inline?.[2] ?? '').trim()
}

function unquote(arg: string): string {
  return arg.replace(/^['"]|['"]$/g, '')
}
