import type { Elements } from 'claude-code'

import { REASONS } from './jev'
import {
  costOf,
  easeIn,
  familyOf,
  mixOf,
  type ModelFamily,
  peakParallel,
  pulseFrame,
  smoothBar,
  sparkline,
  spendOf,
  spinnerFrame,
  tokens,
  usd,
} from './metrics'
import { TIER_ORDER, TIERS } from './routing'
import type { Mode, RoutingDecision, Verdict, View } from '../types'

export const PANE = 'model-stack'
/** Redraw period while something on the pane moves. */
export const FRAME_MS = 120
/** How long a fresh decision's bars take to sweep in. */
export const SWEEP_MS = 600

/** Lines the fixed sections take: border, header, session, main, decision, titles, footer. */
const FIXED_LINES = 38
const MIN_AGENTS = 2
const MIN_HISTORY = 3
const LABEL = 9
const JEV_COLOR = '#e86bb0'
const FAMILY_COLOR: Record<ModelFamily, string> = { opus: '#f0a070', sonnet: '#f2c46d', haiku: '#5fd3b0' }
const FAMILIES: readonly ModelFamily[] = ['haiku', 'sonnet', 'opus']

const VERDICT_LABEL: Record<Verdict, string> = {
  firm: 'firme',
  doubt: 'dúvida',
  fallback: 'fallback',
  skipped: 'ignorado',
}

const VERDICT_COLOR: Record<Verdict, string> = {
  firm: 'success',
  doubt: 'warning',
  fallback: 'error',
  skipped: 'subtle',
}

const WHY_LABEL: Record<keyof typeof REASONS, string> = {
  simple: 'tarefa simples',
  depth: 'precisa de profundidade',
  risk: 'mudança arriscada',
  history: 'histórico de tarefas parecidas',
}

const MODE_LABEL: Record<Mode, string> = {
  route: 'rota automática',
  recommend: 'só recomenda',
  off: 'desligado',
}

const MODE_COLOR: Record<Mode, string> = { route: JEV_COLOR, recommend: 'warning', off: 'subtle' }

function clock(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function seconds(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`
}

/** `claude-sonnet-5-5` → `sonnet-5-5`; an alias stays as it is. */
function shortModel(model: string): string {
  return model.replace(/^claude-/, '')
}

function modelColor(model: string): string {
  const family = familyOf(model)
  return family === null ? 'text' : FAMILY_COLOR[family]
}

function recommended(decision: RoutingDecision): string {
  return decision.tier === null ? '—' : TIERS[decision.tier].model
}

function actual(decision: RoutingDecision): string {
  if (decision.actualModel !== undefined) return shortModel(decision.actualModel)
  if (decision.applied === 'as requested') return decision.requestedModel ?? 'herdado'
  if (decision.applied === 'as picked') return 'atual'
  return decision.tier === null ? '?' : TIERS[decision.tier].model
}

function elapsed(decision: RoutingDecision, now: number): string {
  if (decision.durationMs !== undefined) return seconds(decision.durationMs)
  return decision.status === 'running' ? seconds(now - decision.at) : '—'
}

function statusIcon(decision: RoutingDecision, now: number): { icon: string; color: string } {
  if (decision.status === 'running') return { icon: spinnerFrame(now, FRAME_MS), color: modelColor(actual(decision)) }
  if (decision.status === 'done') return { icon: '✓', color: 'success' }
  if (decision.status === 'aborted') return { icon: '◌', color: 'warning' }
  return { icon: '✗', color: 'error' }
}

function cost(decision: RoutingDecision): string {
  const value = costOf(decision)
  return value === null || decision.status === 'running' ? '' : usd(value)
}

export type PaneData = {
  list: readonly RoutingDecision[]
  currentRun: string | null
  view: View
  mode: Mode
  jevAskedAt: number | null
  now: number
  thresholds: { up: number; down: number }
  columns: number
  rows: number
}

type Parts = Pick<Elements['terminal'], 'Box' | 'Text'>

function mainOf(data: PaneData): RoutingDecision | undefined {
  return (
    data.list.findLast(one => one.scope === 'main' && one.id === data.currentRun) ??
    data.list.findLast(one => one.scope === 'main')
  )
}

function label({ Text }: Parts, text: string) {
  return <Text dimColor>{text.padEnd(LABEL)}</Text>
}

/** Continuation line aligned under a label's value. */
function under({ Text }: Parts, text: string) {
  return <Text dimColor wrap="truncate-end">{`${' '.repeat(LABEL)}${text}`}</Text>
}

function header({ Box, Text }: Parts, data: PaneData) {
  const asking = data.jevAskedAt !== null
  return (
    <Box flexDirection="column">
      <Text color="claude" bold>
        Model stack
      </Text>
      <Text wrap="truncate-end">
        <Text color={MODE_COLOR[data.mode]} bold>
          {asking ? pulseFrame(data.now, FRAME_MS) : '◆'} Jev
        </Text>
        <Text dimColor>{` · ${asking ? 'pensando…' : MODE_LABEL[data.mode]}`}</Text>
      </Text>
    </Box>
  )
}

/** The session's model mix as one stacked bar, each family in its color. */
function mixBar(parts: Parts, data: PaneData, cells: number) {
  const { Box, Text } = parts
  const mix = mixOf(data.list)
  const total = FAMILIES.reduce((sum, family) => sum + mix[family], 0)
  let used = 0
  const widths = FAMILIES.map((family, index) => {
    const width = index === FAMILIES.length - 1 ? cells - used : Math.round((mix[family] / Math.max(1, total)) * cells)
    used += width
    return Math.max(0, width)
  })
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        {label(parts, 'modelos')}
        {total === 0 ? (
          <Text dimColor>{'·'.repeat(cells)}</Text>
        ) : (
          FAMILIES.map((family, index) => <Text color={FAMILY_COLOR[family]}>{'▆'.repeat(widths[index] ?? 0)}</Text>)
        )}
      </Text>
      <Text wrap="truncate-end">
        {' '.repeat(LABEL)}
        {FAMILIES.map((family, index) => (
          <Text>
            <Text dimColor>{index === 0 ? '' : ' · '}</Text>
            <Text color={FAMILY_COLOR[family]}>{`${family[0]} ${mix[family]}`}</Text>
          </Text>
        ))}
      </Text>
    </Box>
  )
}

function sessionSection(parts: Parts, data: PaneData, cells: number) {
  const { Box, Text } = parts
  const spend = spendOf(data.list)
  const costs = data.list
    .filter(one => one.status !== 'running')
    .map(one => costOf(one) ?? 0)
    .slice(-cells)
  const total = spend.spent + spend.saved
  const cacheColor =
    spend.cacheHit === null ? 'subtle' : spend.cacheHit >= 0.7 ? 'success' : spend.cacheHit >= 0.4 ? 'warning' : 'error'
  const cacheBar = smoothBar(spend.cacheHit ?? 0, cells)
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Sessão</Text>
      <Text wrap="truncate-end">
        {label(parts, 'gasto')}
        <Text bold>{usd(spend.spent)}</Text>
      </Text>
      <Text wrap="truncate-end">
        {label(parts, 'poupado')}
        <Text color={spend.saved > 0 ? 'success' : 'subtle'} bold>
          {usd(spend.saved)}
        </Text>
        {spend.saved > 0 && <Text dimColor>{` (${Math.round((spend.saved / total) * 100)}%)`}</Text>}
      </Text>
      {under(parts, 'vs. tudo no opus')}
      <Text wrap="truncate-end">
        {label(parts, 'cache')}
        <Text color={cacheColor}>{cacheBar.fill}</Text>
        <Text dimColor>{cacheBar.track}</Text>
        <Text color={cacheColor} bold>
          {spend.cacheHit === null ? ' —' : ` ${Math.round(spend.cacheHit * 100)}%`}
        </Text>
      </Text>
      {under(parts, `lido ${tokens(spend.cacheRead)} · escrito ${tokens(spend.cacheWrite)}`)}
      {mixBar(parts, data, cells)}
      <Text wrap="truncate-end">
        {label(parts, 'custo')}
        {costs.length > 1 ? <Text color="claude">{sparkline(costs)}</Text> : <Text dimColor>{'·'.repeat(cells)}</Text>}
      </Text>
      {under(parts, `por turno · ${tokens(spend.output)} gerados`)}
    </Box>
  )
}

function mainSection(parts: Parts, data: PaneData) {
  const { Box, Text } = parts
  const main = mainOf(data)
  if (main === undefined) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Main</Text>
        <Text dimColor>aguardando o primeiro prompt</Text>
      </Box>
    )
  }
  const { icon, color } = statusIcon(main, data.now)
  const spent = cost(main)
  const stats = [
    elapsed(main, data.now),
    main.outputTokens !== undefined ? `${tokens(main.outputTokens)} out` : '',
    spent,
  ].filter(part => part !== '')
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Main</Text>
      <Text wrap="truncate-end">
        <Text color={color}>{`${icon} `}</Text>
        <Text color={modelColor(actual(main))} bold>
          {actual(main)}
        </Text>
        <Text dimColor>{main.applied === 'as picked' ? ' · fixo' : ` · tier ${main.tier ?? '—'}`}</Text>
      </Text>
      {main.escalatedTo !== undefined && <Text color="warning" wrap="truncate-end">{`↑ escalou p/ ${main.escalatedTo}`}</Text>}
      <Text dimColor wrap="truncate-end">{stats.join(' · ')}</Text>
      <Text dimColor italic wrap="truncate-end">{`“${main.description}”`}</Text>
    </Box>
  )
}

function jevSection({ Box, Text }: Parts, data: PaneData, cells: number) {
  const last = data.list.findLast(one => one.verdict !== 'skipped')
  if (last === undefined) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={JEV_COLOR} bold>
          Decisão
        </Text>
        <Text dimColor>Nada roteado ainda.</Text>
      </Box>
    )
  }
  const decidedAt = last.at + (last.jevMs ?? 0)
  const sweep = easeIn(data.now, decidedAt, SWEEP_MS)
  const ran = actual(last)
  const changed = last.tier !== null && familyOf(ran) !== familyOf(recommended(last))
  const why = last.why === undefined ? undefined : (WHY_LABEL[last.why] ?? last.why)
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text wrap="truncate-end">
        <Text color={JEV_COLOR} bold>
          Decisão
        </Text>
        <Text dimColor>{` · ${last.jevMs !== undefined ? `${last.jevMs}ms · ` : ''}há ${seconds(data.now - decidedAt)}`}</Text>
      </Text>
      <Text dimColor wrap="truncate-end">
        {`${last.scope === 'main' ? 'main' : last.subagentType.replace(/^model-stack:/, '')}: “${last.description}”`}
      </Text>
      {TIER_ORDER.map(tier => {
        const value = (last.probabilities[tier] ?? 0) * sweep
        const isChosen = last.tier === tier
        const { fill, track } = smoothBar(value, cells)
        const spec = TIERS[tier]
        return (
          <Text wrap="truncate-end">
            <Text color={isChosen ? VERDICT_COLOR[last.verdict] : 'subtle'}>{isChosen ? '▸' : ' '}</Text>
            <Text bold={isChosen} dimColor={!isChosen}>
              {tier.padEnd(8)}
            </Text>
            <Text color={FAMILY_COLOR[spec.model]} dimColor={!isChosen}>
              {fill}
            </Text>
            <Text dimColor>{track}</Text>
            <Text bold={isChosen} dimColor={!isChosen}>
              {` ${value.toFixed(2)}`}
            </Text>
          </Text>
        )
      })}
      <Text wrap="truncate-end">
        <Text color={VERDICT_COLOR[last.verdict]} bold>
          {VERDICT_LABEL[last.verdict]}
        </Text>
        <Text dimColor>{changed ? ' · rec. ' : ' → '}</Text>
        {changed && <Text color={modelColor(recommended(last))}>{recommended(last)}</Text>}
        {changed && <Text dimColor> → </Text>}
        <Text color={modelColor(ran)}>{ran}</Text>
      </Text>
      {last.tier !== null && (
        <Text dimColor wrap="truncate-end">{`${TIERS[last.tier].model} ${TIERS[last.tier].effort}${why === undefined ? '' : ` · ${why}`}`}</Text>
      )}
      {last.verdict === 'doubt' && last.confidence !== null && (
        <Text dimColor wrap="truncate-end">{`conf ${last.confidence.toFixed(2)} < limiar ${(last.neededConfidence ?? data.thresholds.down).toFixed(2)}`}</Text>
      )}
      {last.risk != null && last.risk >= 0.5 && (
        <Text color="warning" wrap="truncate-end">{`risco ${last.risk.toFixed(2)}`}</Text>
      )}
      {last.reason !== undefined && <Text color="error" wrap="truncate-end">{last.reason}</Text>}
    </Box>
  )
}

type TreeRow = { decision: RoutingDecision; prefix: string; indent: string }

/** Spawns of the current run as a tree: a subagent hangs under the agent that spawned it. */
function treeRows(data: PaneData): TreeRow[] {
  const spawns = data.list.filter(one => one.scope === 'subagent' && one.runId === data.currentRun)
  const rows: TreeRow[] = []
  const walk = (parent: string | undefined, indent: string): void => {
    const children = spawns.filter(one => one.parentAgentId === parent)
    children.forEach((one, index) => {
      const isLast = index === children.length - 1
      const below = `${indent}${isLast ? '   ' : '│  '}`
      rows.push({ decision: one, prefix: `${indent}${isLast ? '└─ ' : '├─ '}`, indent: below })
      if (one.agentId !== undefined) walk(one.agentId, below)
    })
  }
  walk(undefined, '')
  return rows
}

/** The agent's last line: what it is doing while it runs, why it got its model once it ended. */
function detail(decision: RoutingDecision): string {
  if (decision.status === 'running') return decision.lastAction ?? 'iniciando…'
  const parts = [VERDICT_LABEL[decision.verdict]]
  if (decision.tier !== null) parts.push(`tier ${decision.tier}`)
  if (decision.why !== undefined) parts.push(WHY_LABEL[decision.why] ?? decision.why)
  if (decision.reason !== undefined) parts.push(decision.reason)
  return parts.join(' · ')
}

function agentGraph({ Box, Text }: Parts, data: PaneData, limit: number) {
  const main = mainOf(data)
  const rows = treeRows(data)
  const running = rows.filter(one => one.decision.status === 'running').length
  const peak = peakParallel(
    rows.map(one => one.decision),
    data.now,
  )
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text wrap="truncate-end">
        <Text bold>Agentes</Text>
        <Text dimColor>{running > 0 ? '' : ' · ocioso'}</Text>
        {running > 0 && <Text color="claude">{` · ${running} rodando`}</Text>}
        {peak > 1 && <Text dimColor>{` · pico ${peak}`}</Text>}
      </Text>
      <Text wrap="truncate-end">
        <Text color={main === undefined ? 'subtle' : modelColor(actual(main))}>● </Text>
        <Text bold>main</Text>
      </Text>
      {rows.length === 0 && <Text dimColor>└─ nenhum subagent neste turno</Text>}
      {rows.slice(-limit).map(({ decision, prefix, indent }) => {
        const { icon, color } = statusIcon(decision, data.now)
        const isRunning = decision.status === 'running'
        const stats = [
          elapsed(decision, data.now),
          decision.outputTokens !== undefined ? `${tokens(decision.outputTokens)} out` : '',
          cost(decision),
        ].filter(part => part !== '')
        return (
          <Box flexDirection="column">
            <Text wrap="truncate-end">
              <Text dimColor>{prefix}</Text>
              <Text color={color} bold={isRunning}>{`${icon} `}</Text>
              <Text dimColor={!isRunning}>{decision.description}</Text>
            </Text>
            <Text wrap="truncate-end">
              <Text dimColor>{`${indent}   `}</Text>
              <Text color={modelColor(actual(decision))}>{actual(decision)}</Text>
              {decision.escalatedTo !== undefined && <Text color="warning"> ↑</Text>}
              <Text dimColor>{` · ${stats.join(' · ')}`}</Text>
            </Text>
            <Text dimColor wrap="truncate-end">{`${indent}   ↳ ${detail(decision)}`}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

/** The newest decisions of the session, newest first, two lines each. */
function history({ Box, Text }: Parts, data: PaneData, limit: number) {
  const rows = data.list.slice(-limit).reverse()
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Histórico</Text>
      {rows.length === 0 && <Text dimColor>vazio</Text>}
      {rows.map(one => {
        const { icon, color } = statusIcon(one, data.now)
        const spent = cost(one)
        return (
          <Box flexDirection="column">
            <Text wrap="truncate-end">
              <Text dimColor>{`${clock(one.at)} `}</Text>
              <Text color={color}>{`${icon} `}</Text>
              <Text color={modelColor(actual(one))}>{actual(one)}</Text>
              <Text dimColor>{` · ${elapsed(one, data.now)}${spent === '' ? '' : ` · ${spent}`}`}</Text>
            </Text>
            <Text dimColor wrap="truncate-end">{`      ${one.scope === 'main' ? 'main' : 'sub'}: ${one.description}`}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

/** The technical log: recommended → real, verdict and reason, three lines per decision. */
function log({ Box, Text }: Parts, data: PaneData, limit: number) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Log da sessão</Text>
      {data.list.length === 0 && <Text dimColor>vazio</Text>}
      {data.list.slice(-limit).map(one => {
        const { icon, color } = statusIcon(one, data.now)
        const spent = cost(one)
        const why = one.why === undefined ? '' : ` · ${WHY_LABEL[one.why] ?? one.why}`
        return (
          <Box flexDirection="column">
            <Text wrap="truncate-end">
              <Text dimColor>{`${clock(one.at)} `}</Text>
              <Text color={color}>{`${icon} `}</Text>
              <Text>{one.description}</Text>
            </Text>
            <Text wrap="truncate-end">
              <Text dimColor>{'      '}</Text>
              <Text color={VERDICT_COLOR[one.verdict]}>{VERDICT_LABEL[one.verdict]}</Text>
              <Text dimColor>{` ${recommended(one)} → ${actual(one)}`}</Text>
              {one.escalatedTo !== undefined && <Text color="warning">{` ↑${one.escalatedTo}`}</Text>}
            </Text>
            <Text dimColor wrap="truncate-end">
              {`      ${one.scope === 'main' ? 'main' : 'sub'} · ${elapsed(one, data.now)}${spent === '' ? '' : ` · ${spent}`}${why}`}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

export function paneTree(parts: Parts, data: PaneData) {
  const { Box, Text } = parts
  // Bars follow the pane width: the label column and the border take what is left of it.
  const cells = Math.max(6, Math.min(24, data.columns - 22))
  // What the fixed sections leave goes to the lists: an agent takes three lines, a history entry two.
  const spare = Math.max(0, data.rows - FIXED_LINES)
  const agents = Math.max(MIN_AGENTS, Math.floor((spare * 0.55) / 3))
  const historyRows = Math.max(MIN_HISTORY, Math.floor((spare - agents * 3) / 2))
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
      {header(parts, data)}
      {sessionSection(parts, data, cells)}
      {mainSection(parts, data)}
      {jevSection(parts, data, cells)}
      {data.view === 'details' ? (
        log(parts, data, Math.max(MIN_HISTORY, Math.floor(spare / 3)))
      ) : (
        <Box flexDirection="column">
          {agentGraph(parts, data, agents)}
          {history(parts, data, historyRows)}
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor wrap="truncate-end">{`/stack ${data.view === 'details' ? 'overview' : 'details'}`}</Text>
        <Text dimColor wrap="truncate-end">/stack export</Text>
        <Text dimColor wrap="truncate-end">/stack mode off|recommend|route</Text>
      </Box>
    </Box>
  )
}
