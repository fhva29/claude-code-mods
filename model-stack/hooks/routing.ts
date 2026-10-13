import type { MainPlan, Tier, Verdict } from '../types'

export const PLUGIN = 'model-stack'

export type TierSpec = {
  model: 'haiku' | 'sonnet' | 'opus'
  /** Full model id, for the main chat's requests (subagents take the alias). */
  id: string
  effort: 'low' | 'medium' | 'high'
  agent: string
}

export const TIERS: Record<Tier, TierSpec> = {
  light: { model: 'haiku', id: 'claude-haiku-5-5', effort: 'medium', agent: 'haiku-medium' },
  default: { model: 'sonnet', id: 'claude-sonnet-5-5', effort: 'medium', agent: 'sonnet-medium' },
  deep: { model: 'sonnet', id: 'claude-sonnet-5-5', effort: 'high', agent: 'sonnet-high' },
  heavy: { model: 'opus', id: 'claude-opus-5-5', effort: 'medium', agent: 'opus-medium' },
  max: { model: 'opus', id: 'claude-opus-5-5', effort: 'high', agent: 'opus-high' },
}

export const TIER_ORDER: readonly Tier[] = ['light', 'default', 'deep', 'heavy', 'max']

// Agent types whose whole definition may be swapped for a tier agent. Every other
// type keeps its own prompt, tools and effort; only its model is changed.
const GENERIC_TYPES = new Set(['general-purpose', 'claude'])

export type JevChoice = {
  choice: Tier
  confidence: number
  probabilities: Partial<Record<Tier, number>>
}

export type SpawnFacts = {
  subagentType: string
  requestedModel: string | null
  isFork: boolean
  isTeammate: boolean
}

export type RoutingOutcome = {
  verdict: Verdict
  tier: Tier | null
  subagentType?: string
  model?: string
  applied: string
}

export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIER_ORDER as readonly string[]).includes(value)
}

export function tierAgentName(tier: Tier): string {
  return `${PLUGIN}:${TIERS[tier].agent}`
}

export function isTierAgent(subagentType: string): boolean {
  return subagentType.startsWith(`${PLUGIN}:`)
}

export function tierOfAgent(subagentType: string): Tier | null {
  return TIER_ORDER.find(tier => tierAgentName(tier) === subagentType) ?? null
}

/** 0 haiku, 1 sonnet, 2 opus; anything else ranks above all so it is never replaced. */
export function modelRank(model: string): number {
  const name = model.toLowerCase()
  if (name.includes('haiku')) return 0
  if (name.includes('sonnet')) return 1
  if (name.includes('opus')) return 2
  return 3
}

export function shouldRoute(facts: SpawnFacts): boolean {
  return !facts.isFork && !facts.isTeammate
}

function apply(tier: Tier, verdict: Verdict, facts: SpawnFacts): RoutingOutcome {
  const spec = TIERS[tier]
  if (GENERIC_TYPES.has(facts.subagentType) || isTierAgent(facts.subagentType)) {
    const agent = tierAgentName(tier)
    return { verdict, tier, subagentType: agent, model: spec.model, applied: agent }
  }
  return { verdict, tier, model: spec.model, applied: `${facts.subagentType} · ${spec.model}` }
}

function keepRequested(verdict: Verdict, tier: Tier | null): RoutingOutcome {
  return { verdict, tier, applied: 'as requested' }
}

/** Recommend mode: keep Jev's verdict and tier for the record, run the spawn as requested. */
export function asRecommendation(outcome: RoutingOutcome): RoutingOutcome {
  return { verdict: outcome.verdict, tier: outcome.tier, applied: 'as requested' }
}

/** Moving to a dearer tier costs only tokens; moving to a cheaper one risks rework, so it needs more confidence. */
export type Thresholds = { up: number; down: number }

/** The tier a task flagged as risky runs on, whatever else was decided. */
export const RISKY_TIER: Tier = 'max'

/** The confidence a move from `current` to `target` needs; staying put is held to the upgrade bar. */
export function neededConfidence(target: number, current: number, thresholds: Thresholds): number {
  return target < current ? thresholds.down : thresholds.up
}

export function decide(
  facts: SpawnFacts,
  jev: JevChoice | null,
  thresholds: Thresholds,
  defaultTier: Tier,
  risky = false,
): RoutingOutcome {
  // Risk overrides doubt and a requested model alike: the risky tier is the top one, so it never lowers.
  if (risky) return apply(RISKY_TIER, 'firm', facts)
  // A tier agent picked by Opus is a floor: Jev may raise it, never lower it.
  const floor = tierOfAgent(facts.subagentType)
  if (floor !== null) {
    if (jev === null) return keepRequested('fallback', null)
    if (TIER_ORDER.indexOf(jev.choice) <= TIER_ORDER.indexOf(floor)) {
      return keepRequested(jev.confidence < thresholds.up ? 'doubt' : 'firm', jev.choice)
    }
    if (jev.confidence < thresholds.up) return keepRequested('doubt', jev.choice)
    return apply(jev.choice, 'firm', facts)
  }
  if (facts.requestedModel !== null) {
    if (jev === null) return keepRequested('fallback', null)
    if (jev.confidence < thresholds.up) return keepRequested('doubt', jev.choice)
    // Jev may raise or keep what Opus asked for, never lower it.
    if (modelRank(facts.requestedModel) > modelRank(TIERS[jev.choice].model)) {
      return keepRequested('firm', jev.choice)
    }
    return apply(jev.choice, 'firm', facts)
  }
  if (jev === null) return apply(defaultTier, 'fallback', facts)
  const needed = neededConfidence(TIER_ORDER.indexOf(jev.choice), TIER_ORDER.indexOf(defaultTier), thresholds)
  if (jev.confidence < needed) return apply(defaultTier, 'doubt', facts)
  return apply(jev.choice, 'firm', facts)
}

const MAIN_MIN_CHARS = 15

/** Short acknowledgements, slash commands and empty continuations keep the current model. */
export function skipMainPrompt(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length < MAIN_MIN_CHARS || trimmed.startsWith('/')
}

/** The higher of two tiers; null counts as no bound. */
export function higherTier(a: Tier | null, b: Tier | null): Tier | null {
  if (a === null) return b
  if (b === null) return a
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b
}

type Effort = MainPlan['effort']

const EFFORT_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 }

/** Effort-only routing keeps the model, so each tier stands for an effort alone. */
export const EFFORT_BY_TIER: Record<Tier, Effort> = {
  light: 'low',
  default: 'medium',
  deep: 'high',
  heavy: 'high',
  max: 'high',
}

/** low 0, medium 1, high 2; efforts above high count as high, and a numeric or missing one as medium. */
export function effortRank(effort: unknown): number {
  return typeof effort === 'string' ? (EFFORT_RANK[effort] ?? 2) : 1
}

/** Orders a model and effort pair the way TIER_ORDER orders tiers. */
export function stepRank(model: string, effort: unknown): number {
  return modelRank(model) * 3 + effortRank(effort)
}

/** The lowest tier at or above a model and effort, so a floor built from it never goes below them. */
export function tierCovering(model: string, effort: unknown): Tier {
  const rank = stepRank(model, effort)
  return TIER_ORDER.find(tier => stepRank(TIERS[tier].model, TIERS[tier].effort) >= rank) ?? 'max'
}

/** The lowest tier whose effort-only setting is at or above `effort`. */
export function tierForEffort(effort: unknown): Tier {
  const rank = effortRank(effort)
  return TIER_ORDER.find(tier => effortRank(EFFORT_BY_TIER[tier]) >= rank) ?? 'max'
}

/** `model` rewrites the main chat's model and effort; `effort` keeps the model, so the prompt cache survives. */
export type MainRouting = 'model' | 'effort'

export type MainInputs = {
  jev: JevChoice | null
  thresholds: Thresholds
  /** Lifts a confident pick; doubt and fallback keep the picked model. */
  floor: Tier | null
  /** After a correction, the previous turn's tier: no verdict runs below it. */
  correctionFloor: Tier | null
  risky: boolean
  routing: MainRouting
}

export type MainResolution = {
  verdict: Verdict
  /** Jev's own choice, kept for the record. */
  tier: Tier | null
  /** The confidence the move needed; null when Jev did not answer. */
  needed: number | null
  /** What to run instead of the step's own model and effort; null keeps them. */
  run: { tier: Tier; model: string; effort: Effort } | null
}

/**
 * Decides a main-chat turn against the model and effort it would run on: a dearer
 * tier needs `thresholds.up`, a cheaper one `thresholds.down`. Risk and a correction
 * only ever raise.
 */
export function resolveMain(step: { model: string; effort?: unknown }, inputs: MainInputs): MainResolution {
  const { jev, thresholds, routing } = inputs
  const rank = (tier: Tier): number =>
    routing === 'model' ? stepRank(TIERS[tier].model, TIERS[tier].effort) : effortRank(EFFORT_BY_TIER[tier])
  const current = routing === 'model' ? stepRank(step.model, step.effort) : effortRank(step.effort)

  let verdict: Verdict = 'fallback'
  let needed: number | null = null
  let target: Tier | null = null
  if (jev !== null) {
    const picked = higherTier(jev.choice, inputs.floor) ?? jev.choice
    needed = neededConfidence(rank(picked), current, thresholds)
    verdict = jev.confidence < needed ? 'doubt' : 'firm'
    if (verdict === 'firm') target = picked
  }
  const minimum = higherTier(inputs.risky ? RISKY_TIER : null, inputs.correctionFloor)
  if (minimum !== null && rank(minimum) > (target === null ? current : rank(target))) target = minimum

  if (target === null || rank(target) === current) return { verdict, tier: jev?.choice ?? null, needed, run: null }
  const run =
    routing === 'model'
      ? { tier: target, model: TIERS[target].id, effort: TIERS[target].effort }
      : { tier: target, model: step.model, effort: EFFORT_BY_TIER[target] }
  return { verdict, tier: jev?.choice ?? null, needed, run }
}

/** The model and effort a main-chat step runs on: the turn's plan, or the request as the engine built it. */
export function applyPlan<T extends { turnId: string; agentId?: string }>(
  step: T,
  planned: MainPlan | null,
): T | (T & { model: string; effort: Effort }) {
  if (step.agentId !== undefined || planned === null || planned.turnId !== step.turnId) return step
  return { ...step, model: planned.model, effort: planned.effort }
}

/** The plan one tier up, or null when nothing is left to raise. Effort routing raises the effort alone. */
export function raisePlan(planned: MainPlan, routing: MainRouting): MainPlan | null {
  const raised = tierAbove(planned.tier)
  if (raised === null) return null
  if (routing === 'model') return { ...planned, tier: raised, model: TIERS[raised].id, effort: TIERS[raised].effort }
  const effort = EFFORT_BY_TIER[raised]
  if (effortRank(effort) <= effortRank(planned.effort)) return null
  return { ...planned, tier: raised, effort }
}

const ERROR_STREAK_LIMIT = 2
const EDITS_PER_FILE_LIMIT = 3
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

/** What the turn's tool calls say about whether the chosen tier is coping. */
export type Signals = {
  errorStreak: number
  editsByFile: Readonly<Record<string, number>>
}

export const NO_SIGNALS: Signals = { errorStreak: 0, editsByFile: {} }

export function recordToolOutcome(
  signals: Signals,
  outcome: { tool: string; filePath?: string; isError: boolean },
): Signals {
  const errorStreak = outcome.isError ? signals.errorStreak + 1 : 0
  if (!EDIT_TOOLS.has(outcome.tool) || outcome.filePath === undefined) return { ...signals, errorStreak }
  const edits = (signals.editsByFile[outcome.filePath] ?? 0) + 1
  return { errorStreak, editsByFile: { ...signals.editsByFile, [outcome.filePath]: edits } }
}

export function isStruggling(signals: Signals): boolean {
  return (
    signals.errorStreak >= ERROR_STREAK_LIMIT ||
    Object.values(signals.editsByFile).some(count => count >= EDITS_PER_FILE_LIMIT)
  )
}

/** One tier up, or null at the top. Escalation never goes down. */
export function tierAbove(tier: Tier): Tier | null {
  return TIER_ORDER[TIER_ORDER.indexOf(tier) + 1] ?? null
}
