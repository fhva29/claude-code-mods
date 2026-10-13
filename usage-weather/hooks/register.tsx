import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { UsageWeatherReading, UsageWeatherSnapshot } from '../types'
import {
  compactTokens,
  forecastFor,
  limitColor,
  limitLabel,
  meter,
  shortModel,
  signedTokens,
  sparkline,
} from './forecast'

const HISTORY = 24

const readings = atom({ plugin: 'usage-weather', key: 'readings' } as const, [])
const snapshot = atom({ plugin: 'usage-weather', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'usage-weather', key: 'isHidden' } as const, false)

async function takeReading($: EngineInterface, effort?: string | null): Promise<void> {
  const usage = await $.session.usage()
  const model = await $.session.model()
  const { context } = usage

  if (context.window > 0) {
    const tokens = context.tokens ?? 0
    const percent = context.percent ?? Math.round((tokens / context.window) * 100)
    const reading: UsageWeatherReading = { tokens, window: context.window, percent }
    await update($, readings, list => {
      const last = list.at(-1)
      const isSame = last !== undefined && last.tokens === reading.tokens
      return isSame ? list : [...list, reading].slice(-HISTORY)
    })
  }

  await update($, snapshot, previous => {
    const next: UsageWeatherSnapshot = {
      limits: usage.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed })),
      model,
      effort: effort === undefined ? (previous?.effort ?? null) : effort,
    }
    return next
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'weather',
      description: 'Show or hide the usage forecast band',
    })
    await takeReading($)
    return result
  })

  on('command.run', { command: 'weather' }, async $ => {
    const hidden = await update($, isHidden, value => !value)
    return { text: hidden ? 'Usage weather hidden.' : 'Usage weather shown.' }
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = e.effort === undefined ? null : String(e.effort)
      await update($, snapshot, previous =>
        previous === null ? previous : { ...previous, model: e.model, effort },
      )
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await takeReading($)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const history = await read($, readings)
    const snap = await read($, snapshot)
    const latest = history.at(-1)
    if (e.props.hasSurvey || latest === undefined || (await read($, isHidden))) {
      return below
    }

    const { Box, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const isWide = columns >= 100
    const isMedium = columns >= 70
    const forecast = forecastFor(latest.percent)
    const previous = history.at(-2)
    const delta = previous === undefined ? null : latest.tokens - previous.tokens
    const sep = <Text dimColor> │ </Text>

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" paddingX={1}>
        <Text color={forecast.color} bold>
          {forecast.glyph} {forecast.label}
        </Text>
        <Text> </Text>
        <Text color={forecast.color}>{meter(latest.percent, isMedium ? 10 : 6)}</Text>
        <Text bold> {latest.percent}%</Text>
        {isMedium && (
          <Text dimColor>
            {' '}
            {compactTokens(latest.tokens)}/{compactTokens(latest.window)}
          </Text>
        )}
        {isWide && history.length > 1 && (
          <Text color="claude"> {sparkline(history, 12)}</Text>
        )}
        {isWide && delta !== null && (
          <Text color={delta > 20_000 ? 'warning' : 'subtle'}> {signedTokens(delta)}</Text>
        )}
        {snap !== null &&
          snap.limits.length > 0 && [
            sep,
            ...snap.limits.map((limit, index) => (
              <Text color={limitColor(limit.percentUsed)}>
                {index > 0 ? ' · ' : ''}
                {limitLabel(limit)} {Math.round(limit.percentUsed)}%
              </Text>
            )),
          ]}
        {snap !== null && [
          sep,
          <Text color="claude">{shortModel(snap.model)}</Text>,
          snap.effort !== null && <Text dimColor> · {snap.effort}</Text>,
        ]}
        </Box>
      </Box>
    )
  })
}
