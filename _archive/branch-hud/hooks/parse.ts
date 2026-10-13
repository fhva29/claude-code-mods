import type { BranchHudChange, BranchHudCommit, BranchHudMigration } from '../types'

const MIGRATION = /^(?:.*\/)?([^/]+)\/migrations\/(\d{4}_[^/]+)\.py$/

export function parseChanges(porcelain: string): BranchHudChange[] {
  return porcelain
    .split('\n')
    .filter(line => line.length > 3)
    .map(line => ({ status: line.slice(0, 2).trim() || '?', path: line.slice(3) }))
}

export function parseMigrations(paths: string, isCommitted: boolean): BranchHudMigration[] {
  return paths
    .split('\n')
    .map(path => MIGRATION.exec(path.trim()))
    .filter(match => match !== null)
    .map(match => ({ app: match[1] ?? '', name: match[2] ?? '', isCommitted }))
}

export function parseCommits(log: string): BranchHudCommit[] {
  return log
    .split('\n')
    .filter(line => line.includes('\t'))
    .map(line => {
      const [sha = '', ...subject] = line.split('\t')
      return { sha, subject: subject.join('\t') }
    })
}
