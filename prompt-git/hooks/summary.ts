export type GitCounts = { branch: string; staged: number; modified: number; untracked: number }

export function countLines(text: string): number {
  return text.split('\n').filter(line => line.trim() !== '').length
}

export function formatSummary(counts: GitCounts): string {
  const parts = [`⎇ ${counts.branch}`]
  const changes = [
    counts.staged > 0 ? `+${counts.staged}` : '',
    counts.modified > 0 ? `~${counts.modified}` : '',
    counts.untracked > 0 ? `?${counts.untracked}` : '',
  ].filter(part => part !== '')
  parts.push(changes.length === 0 ? '✓ clean' : changes.join(' '))
  return parts.join(' · ')
}
