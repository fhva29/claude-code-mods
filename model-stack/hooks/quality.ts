import type { Feedback, Outcome, RoutingDecision, Scope } from '../types'

const TEST_COMMAND = /\b(pytest|vitest|jest|eslint)\b|\bnpm\s+(run\s+)?(test|lint)\b/
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

/** How many main-chat runs after an edit still count as reworking it. */
const REWORK_RUNS = 2

export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command)
}

export function isEditTool(tool: string): boolean {
  return EDIT_TOOLS.has(tool)
}

export type TestRuns = NonNullable<RoutingDecision['tests']>

export function recordTestRun(previous: TestRuns | undefined, isError: boolean): TestRuns {
  return { runs: (previous?.runs ?? 0) + 1, lastPassed: !isError }
}

const CORRECTION = /\b(n[aã]o|errado|errada|volta|desfaz|reverte|revert|undo|wrong|incorreto)\b/i
const ACCEPTED = /^\s*(ok|okay|beleza|valeu|boa|show|perfeito|isso|certo|top|legal|thanks|obrigado)\b[\s!.]*$/i

/** Longer prompts say too many things for a regex to read them as a reaction. */
const FOLLOW_UP_CHARS = 80

/** Engine-injected prompts (`<agent-message …>`, `<command-message …>`) are not the person reacting. */
export function isInjectedPrompt(text: string): boolean {
  return text.trimStart().startsWith('<')
}

/** Regex reading of a short follow-up, for when Jev is not asked or does not answer. */
export function classifyFollowUp(text: string): Feedback | null {
  if (isInjectedPrompt(text) || text.trim().length > FOLLOW_UP_CHARS) return null
  if (CORRECTION.test(text)) return 'correction'
  if (ACCEPTED.test(text)) return 'accepted'
  return null
}

/** Jev's label for the previous turn; anything else, or a doubtful pick, says nothing. */
export function feedbackFromJev(choice: string, confidence: number, threshold: number): Feedback | null {
  if (confidence < threshold) return null
  return choice === 'accepted' || choice === 'correction' || choice === 'new_task' ? choice : null
}

/** A label the person gave by hand is never replaced by an inferred one. */
export function mergeFeedback(current: Feedback | undefined, inferred: Feedback): Feedback {
  return current === 'manual_good' || current === 'manual_bad' ? current : inferred
}

type Judged = Pick<RoutingDecision, 'status' | 'escalatedTo' | 'feedback' | 'tests'>

/** Rework is left out on purpose: iterating on a file is normal, so it only informs. */
export function deriveOutcome(decision: Judged): Outcome {
  if (decision.feedback === 'manual_bad') return 'bad'
  if (decision.feedback === 'manual_good') return 'good'
  if (
    decision.status === 'aborted' ||
    decision.status === 'error' ||
    decision.escalatedTo !== undefined ||
    decision.feedback === 'correction' ||
    decision.tests?.lastPassed === false
  ) {
    return 'bad'
  }
  if (decision.feedback === 'accepted') return 'good'
  return decision.feedback === 'new_task' ? 'good_weak' : 'unknown'
}

export type EditEntry = { id: string; runId: string | null; scope: Scope; files: ReadonlySet<string> }

/**
 * Decisions whose edit of `file` the main chat is now editing again: those from
 * the previous few runs, plus subagents of the current run. The current run's own
 * main turn is never its own rework.
 */
export function reworkTargets(
  ledger: readonly EditEntry[],
  runOrder: readonly string[],
  currentRun: string,
  file: string,
): string[] {
  const at = runOrder.indexOf(currentRun)
  const earlier = at === -1 ? [] : runOrder.slice(Math.max(0, at - REWORK_RUNS), at)
  return ledger
    .filter(entry => {
      if (!entry.files.has(file) || entry.id === currentRun) return false
      if (entry.runId === currentRun) return entry.scope === 'subagent'
      return entry.runId !== null && earlier.includes(entry.runId)
    })
    .map(entry => entry.id)
}

export type TestsLabel = 'passed' | 'failed' | null

export function testsLabel(tests: TestRuns | undefined): TestsLabel {
  if (tests === undefined) return null
  return tests.lastPassed ? 'passed' : 'failed'
}
