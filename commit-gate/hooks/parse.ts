// A newline separates commands too: an agent often sends one multi-line script.
const COMMIT = /(^|&&|\|\||;|\||\n)\s*git(?:\s+-C\s+\S+)?\s+commit\b/
const ADD = /(?:^|&&|\|\||;|\n)\s*git(?:\s+-C\s+\S+)?\s+add\s+([^;&|\n]+)/g
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

// Where the commit runs: the folder the last `cd` before it moved to, then its own `git -C`.
// null is the session's folder. Relative paths stay relative; $.process.run resolves them
// against the session's folder.
// shortcut: `~`, `cd -`, pushd and subshell scopes are not followed; upgrade if commits use them.
export function commitDir(command: string): string | null {
  let dir: string | null = null
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const words = tokenize(segment)
    if (words[0] === 'cd') {
      dir = joinDir(dir, words[1])
      continue
    }
    if (COMMIT.test(`;${segment}`)) {
      const at = words.indexOf('-C')
      return at >= 0 && at < words.indexOf('commit') ? joinDir(dir, words[at + 1]) : dir
    }
  }
  return dir
}

// Words of one segment, honouring quotes; enough to read cd targets and -C.
function tokenize(segment: string): string[] {
  return [...segment.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3] ?? '')
}

function joinDir(dir: string | null, arg: string | undefined): string | null {
  if (arg === undefined || arg === '') return dir
  if (arg.startsWith('/') || dir === null) return arg
  return `${dir}/${arg}`
}

function unquote(arg: string): string {
  return arg.replace(/^['"]|['"]$/g, '')
}
