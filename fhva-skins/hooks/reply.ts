import type { RenderSurface } from 'claude-code'

import type { Prefs } from '../types'
import { drawsBlocks, hasBlocks } from './blocks'
import { hardBreaks, isShell, splitReply } from './markdown'
import type { Segment } from './markdown'

// Which markdown the skin draws itself: a reply's blocks, or null to leave the text to
// Claude Code's own drawing. Used by replies.

// Markdown takes at most 10000 characters a block; a longer one keeps Claude Code's own
// drawing.
export const MAX_MARKDOWN = 9000

export function replySegments(text: string, prefs: Prefs, surface: RenderSurface): Segment[] | null {
  const cards = prefs.tables !== 'off' && /\||```|~~~/.test(text)
  // The terminal draws every paragraph itself; elsewhere only alerts and task lists.
  const blocks = prefs.markdown && (surface === 'terminal' || hasBlocks(text))

  if (!cards && !blocks) {
    return null
  }

  const segments: Segment[] = cards ? splitReply(text, { tables: true, fence: () => true }) : [{ kind: 'text', text }]
  // Measured as Markdown will take it: hard breaks add two characters a line, and a
  // segment that grows past the cap is left to Claude Code whole.
  const fits = segments.every(segment => segment.kind === 'table' || (segment.kind === 'text' ? hardBreaks(segment.text) : segment.raw).length <= MAX_MARKDOWN)
  // Off the terminal a shell fence keeps the app's drawing, for its Run button; a reply
  // with nothing else to draw is left to the app whole.
  const kept = surface === 'terminal' ? segments : segments.filter(segment => !isShell(segment))
  const drawn = kept.some(
    segment =>
      segment.kind !== 'text' ||
      (prefs.markdown && drawsBlocks(segment.text, surface)),
  )

  return fits && drawn ? segments : null
}
