import { isTier, type JevChoice, TIER_ORDER } from './routing'
import type { Outcome, Tier } from '../types'

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
export const JEV_MODEL = 'jev-latest'
const TASK_CHARS = 1500

const CRITERIA: Record<Tier, string> = {
  light: 'Haiku, medium effort: simple lookup, file search, reading or summarizing code',
  default: 'Sonnet, medium effort: typical implementation, tests, review or analysis',
  deep: 'Sonnet, high effort: subtle analysis or a careful change across several files',
  heavy: 'Opus, medium effort: hard reasoning or architecture',
  max: 'Opus, high effort: a risky or hard-to-reverse change that needs the most careful reasoning',
}

export const REASONS: Record<string, string> = {
  simple: 'The task is simple or narrow enough for a cheap tier',
  depth: 'The task needs more reasoning or care than a cheaper tier gives',
  risk: 'The task is risky: wide changes, architecture, or hard-to-reverse effects',
  history: 'Past results for similar tasks point to this tier',
}

/** A finished earlier subagent, as Jev sees it. */
export type PastResult = {
  subagent_type: string
  task_summary: string
  model: string
  status: string
  duration_s: number | null
  /** The tier the task had to be raised to mid-turn: the first pick was too low. */
  escalated_to: Tier | null
  /** Result of the last test or lint run the task made; null when it ran none. */
  tests: 'passed' | 'failed' | null
  /** Files the task edited were edited again soon after. */
  rework: boolean
  /** What the person's next move said about it. */
  user_feedback: string | null
  outcome: Outcome
}

/** The previous main-chat turn, so Jev can say how the new prompt reacts to it. */
export type PreviousTurn = { summary: string; status: string }

const RISK_CRITERIA: Record<string, string> = {
  risky:
    'It touches production, deploys, infrastructure, money, credentials, database migrations or schema, ' +
    'or other state that is hard to reverse',
  safe: 'It reads, explains, or changes code that is easy to review and undo',
}

const OUTCOME_HINT =
  'A past result with outcome "bad" is evidence that its tier was too low for a task like it; ' +
  '"good_weak" means the person moved on without complaint, weaker evidence than "good".'

const FEEDBACK_CRITERIA: Record<string, string> = {
  accepted: 'The prompt accepts, thanks or approves the previous result',
  correction: 'The prompt says the previous result was wrong, asks to undo, redo or fix it',
  new_task: 'The prompt moves on to something unrelated to the previous result',
}

export type TierQuestion = {
  apiKey: string
  /** `main` asks about the chat's own next turn; `subagent` about a spawn. */
  scope: 'main' | 'subagent'
  prompt: string
  description: string
  subagentType: string
  history: readonly PastResult[]
  /** Main scope only: asks how this prompt reacts to the previous turn. */
  previousTurn?: PreviousTurn
}

export type JevAnswer = JevChoice & {
  /** The `confidence` Jev itself reports for the tier, kept apart from the label's probability the threshold uses. */
  reported: number | null
  why: string | null
  /** How the prompt reacts to the previous turn, when it was asked. */
  previous: { choice: string; confidence: number } | null
  /** Probability that the task is risky; null when Jev gave none. */
  risk: number | null
}

function parseAnswer(body: unknown): JevAnswer | null {
  if (typeof body !== 'object' || body === null) return null
  const { answers } = body as {
    answers?: Record<
      string,
      { choice?: unknown; confidence?: unknown; probabilities?: Record<string, unknown> } | undefined
    >
  }
  const tier = answers?.tier
  if (tier === undefined || !isTier(tier.choice)) return null

  const probabilities: Partial<Record<Tier, number>> = {}
  for (const name of TIER_ORDER) {
    const value = tier.probabilities?.[name]
    if (typeof value === 'number') probabilities[name] = value
  }
  // The chosen label's probability is the confidence the threshold compares against.
  const confidence = probabilities[tier.choice]
  if (confidence === undefined) return null

  const why = answers?.reason?.choice

  const reaction = answers?.previous_outcome
  const reactionChoice = reaction?.choice
  const reactionConfidence = typeof reactionChoice === 'string' ? reaction?.probabilities?.[reactionChoice] : undefined
  const previous =
    typeof reactionChoice === 'string' && typeof reactionConfidence === 'number'
      ? { choice: reactionChoice, confidence: reactionConfidence }
      : null

  const risk = answers?.risky?.probabilities?.risky

  return {
    choice: tier.choice,
    confidence,
    probabilities,
    reported: typeof tier.confidence === 'number' ? tier.confidence : null,
    why: typeof why === 'string' && why in REASONS ? why : null,
    previous,
    risk: typeof risk === 'number' ? risk : null,
  }
}

export function tierRequest(question: TierQuestion): { method: string; headers: Record<string, string>; body: string } {
  const body = JSON.stringify({
    model: JEV_MODEL,
    state: {
      scope: question.scope,
      subagent_type: question.subagentType,
      task_summary: question.description,
      task: question.prompt.slice(0, TASK_CHARS),
      past_results: question.history,
      ...(question.previousTurn !== undefined && { previous_turn: question.previousTurn }),
    },
    questions: {
      tier: {
        type: 'choice',
        instructions:
          question.scope === 'main'
            ? 'Which model tier should answer this request in the main chat? Pick the tier whose model and ' +
              `effort fit how hard the task is, weighing how past results of similar tasks went. ${OUTCOME_HINT}`
            : 'Which model tier should run this subagent task? Pick the tier whose model and effort fit ' +
              `how hard the task is, weighing how past results of similar tasks went. ${OUTCOME_HINT}`,
        criteria: CRITERIA,
      },
      reason: {
        type: 'choice',
        instructions: 'What is the main reason for that tier?',
        criteria: REASONS,
      },
      risky: {
        type: 'choice',
        instructions: 'Is this task risky?',
        criteria: RISK_CRITERIA,
      },
      ...(question.previousTurn !== undefined && {
        previous_outcome: {
          type: 'choice',
          instructions: 'How does this prompt react to the result of the previous turn in state.previous_turn?',
          criteria: FEEDBACK_CRITERIA,
        },
      }),
    },
  })
  return {
    method: 'POST',
    headers: { Authorization: `Bearer ${question.apiKey}`, 'Content-Type': 'application/json' },
    body,
  }
}

export function parseTierResponse(text: string): JevAnswer | null {
  try {
    return parseAnswer(JSON.parse(text))
  } catch {
    return null
  }
}
