// Pure parts of neon-hud: the figures the band shows and the SVG drawn from them.
// The look follows the Engawa backdrop at night: lamp-lit dark wood, warm accents,
// square pixel bars and a pixel developer. Words on screen are Brazilian Portuguese.

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** Context fill, with the parts as percentages of the measured window. */
export type ContextFill = {
  percent: number
  tokens: number
  window: number
  messages: number
  system: number
  other: number
}

export type Hud = {
  now: number
  context: ContextFill | null
  /** Context percent after each recent main-loop turn. */
  history: readonly number[]
  limits: readonly Limit[]
  /** Tool calls of each recent main-loop turn. */
  toolsPerTurn: readonly number[]
  toolCalls: number
  turns: number
  lastTurnMs: number | null
  failed: number
  uptimeMs: number
  isWorking: boolean
  message: string
}

export const HISTORY = 12
export const TOOL_TURNS = 10

const W = 1040
const H = 160

// Engawa's roles: indigo cushion, maple red, moss green, lamp amber, wisteria.
const INDIGO = '#5b7bb0'
const MAPLE = '#c0442f'
const MOSS = '#6f9c5c'
const AMBER = '#d9902f'
const WISTERIA = '#9a6ab8'

type Palette = { bg: string; bgOpacity: number; text: string; muted: string; track: string; wood: string; woodDark: string }

const NIGHT: Palette = {
  bg: '#1c1916',
  bgOpacity: 0.86,
  text: '#f1e8da',
  muted: '#b2a692',
  track: '#3a332c',
  wood: '#6b4a30',
  woodDark: '#3e2b1d',
}

const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3600_000, seven_day: 7 * 86400_000 }
const DAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']
const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function clock(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function dateLabel(ms: number): string {
  const d = new Date(ms)
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '').replace('.', ',')}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export function uptime(ms: number): string {
  const m = Math.floor(ms / 60_000)
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

export function limitLabel(kind: string): string {
  if (kind === 'five_hour') return '5 HORAS'
  if (kind === 'seven_day') return 'SEMANAL'
  return kind.replace(/_/g, ' ').toUpperCase()
}

export function limitColor(percent: number): string {
  if (percent >= 90) return MAPLE
  if (percent >= 70) return AMBER
  return MOSS
}

/** Share of the window already gone, 0 to 1, or null when the window's length or reset is unknown. */
export function timeGone(limit: Limit, now: number): number | null {
  const length = WINDOW_MS[limit.kind]
  if (length === undefined || limit.resetsAt === undefined) return null
  const resets = Date.parse(limit.resetsAt)
  if (Number.isNaN(resets)) return null
  return Math.min(1, Math.max(0, 1 - (resets - now) / length))
}

export function resetCaption(limit: Limit, now: number): string {
  if (limit.resetsAt === undefined) return ''
  const resets = Date.parse(limit.resetsAt)
  if (Number.isNaN(resets)) return ''
  const leftMin = Math.max(0, Math.round((resets - now) / 60_000))
  const when = limit.kind === 'five_hour' ? clock(resets) : `${DAYS[new Date(resets).getDay()]} ${clock(resets)}`
  const left =
    leftMin >= 1440
      ? `${Math.floor(leftMin / 1440)}D ${Math.floor((leftMin % 1440) / 60)}H`
      : `${Math.floor(leftMin / 60)}H ${leftMin % 60}M`
  const gone = timeGone(limit, now)
  const pace = gone === null ? '' : limit.percentUsed > gone * 100 ? ' · ACIMA DO RITMO' : ' · ABAIXO DO RITMO'
  return `RENOVA ${when} · FALTAM ${left}${pace}`
}

/** The turn in flight, as the developer narrates it. */
export type Working = { elapsedMs: number | null; tools: number; tool: string | null }

const TOOL_MAX = 48

/** What the developer says: the turn in flight, else a limit past 75%, else what the last turn did. */
export function joiLine(
  limits: readonly Limit[],
  lastTurnMs: number | null,
  lastTools: number,
  now: number,
  working: Working | null = null,
): string {
  if (working !== null) {
    const since = working.elapsedMs === null ? '' : ` há ${duration(working.elapsedMs)}`
    if (working.tools === 0 && working.tool === null) return `Pensando${since}…`
    const calls = `${working.tools} chamada${working.tools === 1 ? '' : 's'} de ferramenta`
    const tool = working.tool === null ? '' : ` · agora: ${working.tool.length > TOOL_MAX ? `${working.tool.slice(0, TOOL_MAX - 1)}…` : working.tool}`
    return `Trabalhando${since} · ${calls}${tool}`
  }
  const hot = [...limits].sort((a, b) => b.percentUsed - a.percentUsed)[0]
  if (hot !== undefined && hot.percentUsed >= 75) {
    const name = hot.kind === 'five_hour' ? 'de 5 horas' : hot.kind === 'seven_day' ? 'semanal' : hot.kind.replace(/_/g, ' ')
    const resets = hot.resetsAt === undefined ? NaN : Date.parse(hot.resetsAt)
    const at = Number.isNaN(resets) ? '' : ` Renova ${hot.kind === 'five_hour' ? `às ${clock(resets)}` : `em ${dateLabel(resets).toLowerCase()}`}.`
    return `Você usou ${Math.round(hot.percentUsed)}% do limite ${name}.${at}`
  }
  if (lastTurnMs !== null) {
    return `O último turno levou ${duration(lastTurnMs)} com ${lastTools} chamada${lastTools === 1 ? '' : 's'} de ferramenta.`
  }
  return `Tudo calmo às ${clock(now)}. Esperando o primeiro prompt.`
}

// ---- SVG pieces ----

function text(x: number, y: number, body: string, cls: string, anchor: 'start' | 'end' = 'start', fill?: string): string {
  // Inline style, since the stylesheet's text fill outranks a fill attribute.
  const color = fill === undefined ? '' : ` style="fill:${fill}"`
  return `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}"${color}>${escapeXml(body)}</text>`
}

function rect(x: number, y: number, w: number, h: number, fill: string): string {
  return `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${Math.max(0, w).toFixed(0)}" height="${h.toFixed(0)}" fill="${fill}"/>`
}

/** Square pixel blocks with a one-pixel gap, as the scene's tiles. */
function blocks(x: number, y: number, w: number, h: number, count: number, frac: number, on: string, off: string): string {
  const gap = 2
  const seg = Math.floor((w - gap * (count - 1)) / count)
  const lit = Math.round(Math.min(1, Math.max(0, frac)) * count)
  let out = ''
  for (let i = 0; i < count; i++) out += rect(x + i * (seg + gap), y, seg, h, i < lit ? on : off)
  return out
}

// A developer in an indigo hoodie behind a laptop, 4px pixels.
const DEV = [
  '...hhhhhh...',
  '..hhhhhhhh..',
  '..hsssssshh.',
  '..sggssggs..',
  '..ssssssss..',
  '...ssmmss...',
  '..cccccccc..',
  '.cccccccccc.',
  'llllllllllll',
  'llllloolllll',
  'llllllllllll',
]
const DEV_INK: Record<string, string> = {
  h: '#3e2b1d',
  s: '#e0b48a',
  g: '#2b241e',
  m: '#a0583c',
  c: '#3e5a8a',
  l: '#8a8f98',
  o: '#d9902f',
}

const PX = 5

function sprite(x: number, y: number, from: number, to: number): string {
  let out = ''
  DEV.slice(from, to).forEach((row, r) => {
    ;[...row].forEach((ch, c) => {
      const ink = DEV_INK[ch]
      if (ink !== undefined) out += rect(x + c * PX, y + (from + r) * PX, PX, PX, ink)
    })
  })
  return out
}

// The developer's motions, CSS keyframes the desktop plays inside the SVG image.
export const DEV_MOTION =
  '@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(1px)}}' +
  '@keyframes nod{0%,100%{transform:translateY(0)}50%{transform:translateY(2px)}}' +
  '@keyframes blink{0%,93%,100%{opacity:0}95%,98%{opacity:1}}' +
  '@keyframes tap{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}' +
  '@keyframes glow{0%,100%{opacity:.06}50%{opacity:.24}}' +
  '@keyframes rise{0%{transform:translateY(0);opacity:0}20%{opacity:1}100%{transform:translateY(-16px);opacity:0}}' +
  '.bob{animation:bob 3.2s steps(2) infinite}.nod{animation:nod .8s steps(2) infinite}' +
  '.blink{animation:blink 4.5s infinite}.tap{animation:tap .3s steps(1) infinite}.tap2{animation-delay:.15s}' +
  '.glow{animation:glow 1.2s steps(3) infinite}.rise{animation:rise 2s linear infinite}.late{animation-delay:1s}' +
  '.steam{animation:rise 2.8s steps(7) infinite}.steam2{animation-delay:.9s}.steam3{animation-delay:1.8s}' +
  '.code{font-size:9px;font-weight:700}'

/**
 * A developer behind a laptop. Working: types with both hands, nods, the screen
 * flickers on the face and code floats up. Idle: breathes, blinks, coffee steams.
 */
function developer(x: number, y: number, wood: string, isWorking: boolean): string {
  const skin = DEV_INK.s!
  const lenses = rect(x + 3 * PX, y + 3 * PX, 2 * PX, PX, skin) + rect(x + 7 * PX, y + 3 * PX, 2 * PX, PX, skin)
  const head = `<g class="${isWorking ? 'nod' : 'bob'}">${sprite(x, y, 0, 6)}<g class="blink">${lenses}</g></g>`
  const body = `<g class="${isWorking ? '' : 'bob'}">${sprite(x, y, 6, 8)}</g>`
  let out = head + body + sprite(x, y, 8, DEV.length)
  // The desk the laptop sits on.
  out += rect(x - 6, y + DEV.length * PX, DEV[0]!.length * PX + 12, 4, wood)
  if (isWorking) {
    const handY = y + 8 * PX - 2
    out += `<g class="tap">${rect(x + 2 * PX, handY, PX, PX, skin)}</g>`
    out += `<g class="tap tap2">${rect(x + 9 * PX, handY, PX, PX, skin)}</g>`
    out += `<rect class="glow" x="${x + 2 * PX}" y="${y + 2 * PX}" width="${8 * PX}" height="${4 * PX}" fill="${AMBER}"/>`
    out += `<text class="code rise" x="${x + 56}" y="${y + 4}" style="fill:${MOSS}">&lt;/&gt;</text>`
    out += `<text class="code rise late" x="${x - 8}" y="${y + 8}" style="fill:${INDIGO}">{}</text>`
  } else {
    // A mug of coffee beside the laptop, steam rising off it.
    const mx = x + 52
    const my = y + 9 * PX
    out += rect(mx, my, 8, 8, MAPLE) + rect(mx + 8, my + 2, 2, 4, MAPLE)
    for (const [i, cls] of ['steam', 'steam steam2', 'steam steam3'].entries()) {
      out += `<rect class="${cls}" x="${mx + 1 + i * 3}" y="${my - 4}" width="2" height="2" fill="#d3c7b5"/>`
    }
  }
  return out
}

function contextPanel(x: number, hud: Hud, p: Palette): string {
  const w = 300
  let out = text(x, 26, 'CONTEXTO', 'title')
  const c = hud.context
  if (c === null) return out + text(x, 50, 'ESPERANDO A PRIMEIRA RESPOSTA', 'cap')
  out += text(x + w, 26, `${compactTokens(c.tokens)} DE ${compactTokens(c.window)} TOKENS`, 'cap', 'end')
  out += text(x, 58, `${c.percent}%`, 'big', 'start', limitColor(c.percent))
  out += text(x + 66, 58, 'USADO', 'cap')

  // Context after each recent turn, a small step line beside the figure.
  const values = hud.history.slice(-HISTORY)
  if (values.length > 1) {
    const sx = x + 120
    const sw = w - 120
    const hi = Math.max(...values, 1)
    const step = sw / (values.length - 1)
    const points = values.map((v, i) => `${(sx + i * step).toFixed(0)},${(58 - (v / hi) * 20).toFixed(0)}`)
    out += `<polyline points="${points.join(' ')}" fill="none" stroke="${INDIGO}" stroke-width="2" shape-rendering="crispEdges"/>`
    out += rect(sx + sw - 3, Number(points.at(-1)!.split(',')[1]) - 3, 6, 6, INDIGO)
  }

  // Stacked bar: messages, system tools, other; the free rest is the track.
  out += rect(x, 68, w, 12, p.track)
  let cx = x
  for (const [share, color] of [
    [c.messages, INDIGO],
    [c.system, AMBER],
    [c.other, WISTERIA],
  ] as const) {
    const pw = (Math.max(0, share) / 100) * w
    if (pw > 0) out += rect(cx, 68, Math.max(3, pw), 12, color)
    cx += pw
  }
  const legend = [
    [INDIGO, `MENSAGENS ${Math.round(c.messages)}%`],
    [AMBER, `FERRAMENTAS ${Math.round(c.system)}%`],
    [WISTERIA, `OUTROS ${Math.round(c.other)}%`],
  ] as const
  let lx = x
  for (const [color, label] of legend) {
    out += rect(lx, 88, 7, 7, color) + text(lx + 11, 95, label, 'cap')
    lx += 11 + label.length * 6.6 + 14
  }
  return out
}

function limitsPanel(x: number, hud: Hud, p: Palette): string {
  const w = 300
  let out = text(x, 26, 'LIMITES DO PLANO', 'title') + text(x + w, 26, '▼ TEMPO DECORRIDO', 'cap', 'end')
  const shown = hud.limits.filter(l => l.kind === 'five_hour' || l.kind === 'seven_day').slice(0, 2)
  if (shown.length === 0) return out + text(x, 50, 'SEM LEITURA DE LIMITE AINDA', 'cap')
  const barX = x + 70
  const barW = w - 70 - 44
  shown.forEach((limit, i) => {
    const top = 38 + i * 36
    const color = limitColor(limit.percentUsed)
    out += text(x, top + 10, limitLabel(limit.kind), 'label')
    out += blocks(barX, top + 1, barW, 11, 20, limit.percentUsed / 100, color, p.track)
    out += text(x + w, top + 11, `${Math.round(limit.percentUsed)}%`, 'mid', 'end', color)
    const gone = timeGone(limit, hud.now)
    if (gone !== null) {
      const mx = barX + gone * barW
      out += `<path d="M${(mx - 4).toFixed(0)},${top - 4} L${(mx + 4).toFixed(0)},${top - 4} L${mx.toFixed(0)},${top + 1} Z" fill="${p.text}"/>`
    }
    out += text(x, top + 25, resetCaption(limit, hud.now), 'tiny')
  })
  return out
}

function toolsPanel(x: number, hud: Hud, p: Palette): string {
  const w = 268
  const turns = hud.toolsPerTurn.slice(-TOOL_TURNS)
  const peak = Math.max(0, ...turns)
  const avg = turns.length === 0 ? 0 : turns.reduce((a, b) => a + b, 0) / turns.length
  let out = text(x, 26, 'FERRAMENTAS POR TURNO', 'title') + text(x + w, 26, `PICO ${peak}`, 'cap', 'end')
  const base = 82
  const top = 36
  const slot = w / TOOL_TURNS
  if (peak === 0) out += text(x, 66, 'NENHUMA FERRAMENTA AINDA', 'cap')
  for (let i = 0; i < TOOL_TURNS; i++) {
    const v = turns[i - (TOOL_TURNS - turns.length)]
    if (v === undefined) continue
    const bh = peak === 0 ? 2 : Math.max(2, Math.round((v / peak) * (base - top) / 4) * 4)
    out += rect(x + i * slot + 3, base - bh, slot - 6, bh, v === peak && peak > 0 ? AMBER : MOSS)
  }
  out += rect(x, base, w, 2, p.track)
  out += text(x, 98, `ÚLTIMOS ${TOOL_TURNS} TURNOS · MÉDIA ${avg.toFixed(avg >= 10 ? 0 : 1).replace(/\.0$/, '').replace('.', ',')}`, 'cap')
  return out
}

export function hudSvg(hud: Hud): string {
  const p = NIGHT
  const status = hud.isWorking ? '● TRABALHANDO' : '○ EM ESPERA'
  const stats = [
    ['FERRAMENTAS', String(hud.toolCalls)],
    ['TURNOS', String(hud.turns)],
    ['ÚLTIMO TURNO', hud.lastTurnMs === null ? '—' : duration(hud.lastTurnMs)],
    ['FALHAS', String(hud.failed)],
    ['SESSÃO', uptime(hud.uptimeMs)],
  ]
  let footer = ''
  let fx = 14
  for (const [label, value] of stats) {
    footer += `<text x="${fx}" y="149" class="foot">${escapeXml(label!)} <tspan class="val">${escapeXml(value!)}</tspan></text>`
    fx += (label!.length + value!.length + 1) * 7.6 + 18
  }
  // Wood planks along the top edge, the veranda's beam.
  let beam = ''
  for (let bx = 0; bx < W; bx += 64) beam += rect(bx, 0, 62, 6, p.wood) + rect(bx + 62, 0, 2, 6, p.woodDark)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">` +
    `<defs><style>text{font-family:'Pixelify Sans','Press Start 2P','JetBrains Mono','Cascadia Mono',Consolas,ui-monospace,monospace;fill:${p.muted}}` +
    `.title{font-size:13px;font-weight:700;fill:${p.text};letter-spacing:.08em}.cap{font-size:10.5px}.tiny{font-size:10px}` +
    `.big{font-size:28px;font-weight:700}.mid{font-size:15px;font-weight:700}.label{font-size:12px;font-weight:700;fill:${p.text}}` +
    `.foot{font-size:12px}.val{font-weight:700;fill:${p.text}}.say{font-size:13.5px;fill:${p.text}}${DEV_MOTION}</style></defs>` +
    `<rect width="${W}" height="${H}" fill="${p.bg}" fill-opacity="${p.bgOpacity}"/>` +
    beam +
    rect(0, H - 4, W, 4, p.woodDark) +
    developer(16, 26, p.wood, hud.isWorking) +
    rect(84, 16, 2, 88, p.track) +
    contextPanel(98, hud, p) +
    rect(410, 16, 2, 88, p.track) +
    limitsPanel(426, hud, p) +
    rect(742, 16, 2, 88, p.track) +
    toolsPanel(758, hud, p) +
    rect(12, 110, W - 24, 2, p.track) +
    `<text x="14" y="130" class="say"><tspan fill="${AMBER}" font-weight="700">DEV ▸ </tspan>${escapeXml(hud.message)}</text>` +
    footer +
    `<text x="${W - 14}" y="149" class="foot" text-anchor="end">${escapeXml(`${clock(hud.now)} ${dateLabel(hud.now)}  `)}<tspan class="val" fill="${hud.isWorking ? MOSS : AMBER}">${status}</tspan></text>` +
    `</svg>`
  )
}

/** One line for the terminal, where the band is text. */
export function hudLine(hud: Hud): string {
  const parts: string[] = []
  if (hud.context !== null) parts.push(`CONTEXTO ${hud.context.percent}%`)
  for (const l of hud.limits) parts.push(`${limitLabel(l.kind)} ${Math.round(l.percentUsed)}%`)
  parts.push(`FERRAMENTAS ${hud.toolCalls}`, `TURNOS ${hud.turns}`, `FALHAS ${hud.failed}`, `SESSÃO ${uptime(hud.uptimeMs)}`)
  parts.push(hud.isWorking ? '● TRABALHANDO' : '○ EM ESPERA')
  return parts.join(' · ')
}
