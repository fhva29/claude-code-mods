import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { UsageWeatherReading, UsageWeatherSnapshot } from '../types'
import {
  compactTokens,
  dividerSvg,
  forecastFor,
  limitColor,
  limitLabel,
  meter,
  meterSvg,
  shortModel,
  signedTokens,
  sparkline,
  sparklineSvg,
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

    // A proportional font misaligns the block-glyph meter and sparkline, so the desktop draws them as SVG,
    // in a quiet caption-sized strip of groups split by hairlines, like the app's own composer footer.
    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      const divider = <Svg source={dividerSvg()} alt="" />
      const groups = [
        <Box key="fill" flexDirection="row" alignItems="center" gap="sm">
          <Text size="footnote" weight="semibold" color={forecast.color}>
            {forecast.label}
          </Text>
          <Svg source={meterSvg(latest.percent, forecast.color)} alt={`Context ${latest.percent}% full`} />
          <Text size="footnote" weight="medium" tabular>
            {latest.percent}%
          </Text>
          <Text size="footnote" dimColor tabular>
            {compactTokens(latest.tokens)} of {compactTokens(latest.window)}
          </Text>
        </Box>,
        history.length > 1 && (
          <Box key="trend" flexDirection="row" alignItems="center" gap="xs">
            <Svg source={sparklineSvg(history, forecast.color)} alt="Context fill over recent turns" />
            {delta !== null && (
              <Text size="footnote" tabular color={delta > 20_000 ? 'warning' : undefined} dimColor={delta <= 20_000}>
                {signedTokens(delta)}
              </Text>
            )}
          </Box>
        ),
        snap !== null && snap.limits.length > 0 && (
          <Box key="limits" flexDirection="row" alignItems="center" gap="sm">
            {snap.limits.map(limit => (
              <Text size="footnote" tabular>
                <Text dimColor>{limitLabel(limit)} </Text>
                <Text weight="medium" color={limitColor(limit.percentUsed)}>
                  {Math.round(limit.percentUsed)}%
                </Text>
              </Text>
            ))}
          </Box>
        ),
        snap !== null && (
          <Text key="model" size="footnote">
            <Text weight="medium">{shortModel(snap.model)}</Text>
            {snap.effort !== null && <Text dimColor> · {snap.effort}</Text>}
          </Text>
        ),
      ].filter(Boolean)
      return (
        <Box flexDirection="column">
          {below}
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="md" rowGap="xs" paddingX="sm" paddingY="xs">
            {groups.flatMap((group, index) => (index === 0 ? [group] : [divider, group]))}
          </Box>
        </Box>
      )
    }

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
