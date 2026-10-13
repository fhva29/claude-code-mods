export type Tier = 'light' | 'default' | 'deep' | 'heavy' | 'max'

/** firm: Jev's choice was applied; doubt: below threshold; fallback: Jev unavailable; skipped: not routed. */
export type Verdict = 'firm' | 'doubt' | 'fallback' | 'skipped'

export type DecisionStatus = 'running' | 'done' | 'error' | 'aborted' | 'refused'

/** off: nothing is asked or applied; recommend: Jev's tier is shown, never applied; route: applied. */
export type Mode = 'off' | 'recommend' | 'route'

/** Who the decision is for: the main chat turn or a spawned subagent. */
export type Scope = 'main' | 'subagent'

/**
 * What the person's next move said about the decision. The first three are inferred
 * (Jev reading the follow-up, or a regex for short ones); the manual ones come from
 * `/stack good|bad` and always win.
 */
export type Feedback = 'accepted' | 'correction' | 'new_task' | 'manual_good' | 'manual_bad'

/**
 * Derived from status, escalation, feedback and tests; `unknown` until a signal says otherwise.
 * `good_weak`: the person moved on to a new task with no bad signal, weaker evidence than `good`.
 */
export type Outcome = 'good' | 'good_weak' | 'bad' | 'unknown'

export type RoutingDecision = {
  /** The Agent tool call for a subagent; the turn id for the main chat. */
  id: string
  at: number
  scope: Scope
  /** The main-loop turn the decision happened in; a background subagent stays linked to it. */
  runId: string | null
  description: string
  /** `main` for the chat itself. */
  subagentType: string
  /** The loop that spawned the subagent; absent when main did. */
  parentAgentId?: string
  requestedModel: string | null
  /** Jev's recommended tier, whether or not it was applied. */
  tier: Tier | null
  probabilities: Partial<Record<Tier, number>>
  /** Probability Jev gave the tier it chose: what the threshold is compared with. */
  confidence: number | null
  /** The `confidence` Jev reports on its own for that answer; logged next to `confidence` to compare them when calibrating. */
  jevConfidence?: number | null
  /** Jev's main reason for the tier (a label of its `reason` question). */
  why?: string
  verdict: Verdict
  mode: Mode
  applied: string
  /** The model the engine resolved for the decision. */
  actualModel?: string
  /** The effort of the decision's first main-chat request, next to `actualModel`. */
  actualEffort?: string
  /** After a correction, the previous turn's tier this turn was kept from going below. */
  correctionFloor?: Tier
  /** The confidence Jev's move needed: the upgrade or the downgrade threshold. */
  neededConfidence?: number
  /** Probability Jev gave the task being risky; at or above the risky threshold it ran on the risky tier. */
  risk?: number | null
  reason?: string
  agentId?: string
  status: DecisionStatus
  durationMs?: number
  /** How long Jev took to answer; absent when it was not asked. */
  jevMs?: number
  /** Uncached input tokens of the turn. */
  inputTokens?: number
  outputTokens?: number
  /** Prompt-cache tokens of the turn; a low `cacheReadTokens` after an escalation is its cache cost. */
  cacheReadTokens?: number
  cacheCreationTokens?: number
  /** The tier the turn was raised to after its tool calls kept failing; absent when it never was. */
  escalatedTo?: Tier
  /** Test, lint or eslint runs the decision made through Bash; `lastPassed` is the latest one. */
  tests?: { runs: number; lastPassed: boolean }
  /** A file this decision edited was edited again soon after. Informative only: it never makes the outcome bad. */
  rework?: boolean
  feedback?: Feedback
  /** The note given with `/stack good|bad`. */
  feedbackNote?: string
  outcome?: Outcome
  lastAction?: string
  lastActionAt?: number
}

/** What `turn.step` applies to every main-chat request of one turn. */
export type MainPlan = {
  turnId: string
  tier: Tier
  model: string
  effort: 'low' | 'medium' | 'high'
}

export type Run = { id: string; at: number; text: string }

export type View = 'overview' | 'details'

declare module 'claude-code' {
  interface PluginState {
    'model-stack': {
      decisions: RoutingDecision[]
      plan: MainPlan | null
      runs: Run[]
      currentRun: string | null
      view: View
      mode: Mode | null
      tick: number
      /** When the pending Jev question was asked; null while none is. */
      jevAskedAt: number | null
    }
  }
}
