export type SceneId =
  | 'battle'
  | 'forge'
  | 'dungeon'
  | 'summon'
  | 'treasure'
  | 'mine'
  | 'voyage'
  | 'camp'
  | 'victory'
  | 'defeat'

export const SCENE_IDS: readonly SceneId[] = [
  'battle',
  'forge',
  'dungeon',
  'summon',
  'treasure',
  'mine',
  'voyage',
  'camp',
  'victory',
  'defeat',
]

/** Scene size in pixels; two pixels stack in one terminal cell. */
export const PX_WIDTH = 48
export const PX_HEIGHT = 10

/** Sweetie-16 based palette; `.` is transparent. */
export const PALETTE: Record<string, number> = {
  K: 0x1a1c2c,
  S: 0xffcd9e,
  H: 0x8f563b,
  n: 0x5a3a2a,
  B: 0x3b5dc9,
  b: 0x41a6f6,
  U: 0x29366f,
  W: 0xf4f4f4,
  w: 0x94b0c2,
  d: 0x566c86,
  e: 0x333c57,
  G: 0x38b764,
  g: 0xa7f070,
  D: 0x257179,
  Y: 0xffcd75,
  F: 0xffe478,
  O: 0xef7d57,
  R: 0xb13e53,
  P: 0x5d275d,
  p: 0xc64cc6,
  C: 0x73eff7,
}

export type Grid = string[][]

const HERO = [
  '..KKKKK..',
  '.KHHHHHK.',
  '.KHSSSSK.',
  '.KSKSKSK.',
  '..KSSSK..',
  '.KBBBBBK.',
  'KSKBBBKSK',
  '.KBYYYBK.',
  '..KUKUK..',
]
const HERO_STEP = [...HERO.slice(0, 8), '.KU...UK.']
const HERO_CHEER = [
  'S.KKKKK.S',
  'KKHHHHHKK',
  '.KHSSSSK.',
  '.KSKSKSK.',
  '..KSSSK..',
  '.KBBBBBK.',
  '..KBBBK..',
  '.KBYYYBK.',
  '.KU...UK.',
]
const HERO_SIT = [
  '..KKKKK..',
  '.KHHHHHK.',
  '.KHSSSSK.',
  '.KSKSKSK.',
  '..KSSSK..',
  '.KBBBBBK.',
  'KUUUUUUUK',
]

const SWORD_UP = ['.W.', '.W.', '.W.', '.W.', 'KYK', '.n.']
const SWORD_SLASH = ['....w.', '.....w', 'nYWWWW', '.....w', '....w.']

const SLIME = [
  '...KKKK...',
  '..KggGGK..',
  '.KgGGGGGK.',
  '.KGKGGKGK.',
  'KGGGGGGGGK',
  'KGGGGGGGGK',
  '.KKKKKKKK.',
]
const SLIME_SQUASH = [
  '..KKKKKK..',
  '.KggGGGGK.',
  'KGGKGGKGGK',
  'KGGGGGGGGK',
  'KGGGGGGGGK',
  '.KKKKKKKK.',
]

const ANVIL = ['KKKKKKKKK.', 'KeddddddeK', '.KKeeeKK..', '..KeeeK...', '.KKKKKKK..']
const HAMMER_UP = ['KdK', 'KdK', '.n.', '.n.']
const HAMMER_DOWN = ['..KK', 'nnKd', '..KK']

const FLAMES = [
  ['..F..', '.FYF.', '.YOY.', 'FOROF', '.ROR.'],
  ['.F...', '..FY.', '.YOY.', 'YORO.', '.ROR.'],
  ['...F.', '.YF..', '.YOY.', '.OROY', '.ROR.'],
]
const LOGS = ['nKnKnKn', 'KnnnnnK']

const CHEST_SHUT = [
  '.KKKKKKKK.',
  'KnHHHHHHnK',
  'KHHHHHHHHK',
  'KKKKYYKKKK',
  'KnHHYYHHnK',
  'KHHHHHHHHK',
  'KKKKKKKKKK',
]
const CHEST_OPEN = [
  '.KKKKKKKK.',
  'KnHHHHHHnK',
  'KKKKKKKKKK',
  'KYFYFYFYYK',
  'KnHHYYHHnK',
  'KHHHHHHHHK',
  'KKKKKKKKKK',
]

const ROCK = [
  '....KKKK....',
  '..KKdddwKK..',
  '.KddwddddeK.',
  '.KdeddYdddK.',
  'KddddddeddeK',
  'KdYddddddddK',
  'KKKKKKKKKKKK',
]
const PICK_UP = ['.www.', 'w.n.w', '..n..', '..n..']
const PICK_DOWN = ['...w', 'nnnw', '...w']

const TOMB = [
  '..KKKK..',
  '.KwwwwK.',
  'KwwddwwK',
  'KwddddwK',
  'KwwddwwK',
  'KwwddwwK',
  'KwwwwwwK',
  'KwwwwwwK',
  'KKKKKKKK',
]
const GHOST = ['..KKK..', '.KWWWK.', 'KWKWKWK', 'KWWWWWK', 'KWWWWWK', 'KW.W.WK', '.K...K.']

const ORB = ['.KKK.', 'KCWCK', 'KWWWK', 'KCWCK', '.KKK.']
const ORB_SMALL = ['.C.', 'CWC', '.C.']

const BOAT = [
  '.......K......',
  '......KWK.....',
  '.....KWWWK....',
  '....KWWWWWK...',
  '.......K......',
  'KKKKKKKKKKKKKK',
  'KnHHHHHHHHHHnK',
  '.KnHHHHHHHHnK.',
  '..KKKKKKKKKK..',
]
const GULL = ['W.W', '.W.']
const MOON = ['.YY.', 'YFFY', 'YFFY', '.YY.']

/** A scene's drawing surface: sprite coordinates are relative to the centered 48 px stage. */
class Canvas {
  readonly grid: Grid
  readonly width: number
  readonly ox: number

  constructor(width: number) {
    this.width = width
    this.ox = Math.floor((width - PX_WIDTH) / 2)
    this.grid = Array.from({ length: PX_HEIGHT }, () => Array.from({ length: width }, () => '.'))
  }

  /** Sets one pixel in absolute grid coordinates. */
  set(x: number, y: number, pixel: string): void {
    const line = this.grid[y]
    if (line !== undefined && x >= 0 && x < this.width) line[x] = pixel
  }

  dot(x: number, y: number, pixel: string): void {
    this.set(this.ox + x, y, pixel)
  }

  dots(points: readonly (readonly [number, number])[], pixel: string): void {
    for (const [x, y] of points) this.dot(x, y, pixel)
  }

  paint(x: number, y: number, sprite: readonly string[], recolor?: string): void {
    sprite.forEach((row, dy) => {
      ;[...row].forEach((pixel, dx) => {
        if (pixel !== '.') this.dot(x + dx, y + dy, recolor !== undefined && pixel !== 'K' ? recolor : pixel)
      })
    })
  }

  /** Paints a sprite so its last row rests just above the ground row. */
  stand(x: number, sprite: readonly string[], lift = 0, recolor?: string): void {
    this.paint(x, PX_HEIGHT - 1 - sprite.length - lift, sprite, recolor)
  }

  /** Fills the ground row across the whole width. */
  ground(shift = 0, a = 'G', b = 'D'): void {
    for (let x = 0; x < this.width; x += 1) this.set(x, PX_HEIGHT - 1, (x - this.ox + shift + 4000) % 4 === 0 ? b : a)
  }

  /** Repeats stage-relative decorations every 48 px so wide scenes stay populated. */
  tiled(draw: (offset: number) => void): void {
    const first = -Math.ceil(this.ox / PX_WIDTH) * PX_WIDTH
    for (let offset = first; this.ox + offset < this.width; offset += PX_WIDTH) draw(offset)
  }
}

const pick = <T,>(list: readonly T[], index: number): T => list[index % list.length] as T

type Scene = { frames: number; draw: (c: Canvas, frame: number) => void }

const SCENES: Record<SceneId, Scene> = {
  battle: {
    frames: 6,
    draw: (c, frame) => {
      c.ground()
      const heroX = pick([3, 8, 13, 20, 20, 16], frame)
      c.stand(heroX, frame % 2 === 0 ? HERO : HERO_STEP)
      if (frame === 3 || frame === 4) {
        c.paint(heroX + 7, 3, SWORD_SLASH)
      } else {
        c.paint(heroX + 7, 0, SWORD_UP)
      }
      const isHit = frame === 4
      c.stand(31, frame % 2 === 0 ? SLIME : SLIME_SQUASH, 0, isHit ? 'W' : undefined)
      if (isHit || frame === 5) c.dots([[29, 1], [42, 0], [44, 4], [28, 5]], 'Y')
    },
  },
  forge: {
    frames: 4,
    draw: (c, frame) => {
      c.ground(0, 'e', 'd')
      c.stand(8, HERO)
      c.stand(18, ANVIL)
      c.paint(20, PX_HEIGHT - 1 - ANVIL.length - 1, ['OOOOF'])
      if (frame % 2 === 1) {
        c.paint(16, 2, HAMMER_DOWN)
        c.dots(frame === 1 ? [[25, 1], [27, 3], [23, 0], [29, 2]] : [[26, 0], [28, 2], [24, 1], [30, 4]], frame === 1 ? 'F' : 'Y')
      } else {
        c.paint(15, 0, HAMMER_UP)
      }
      c.stand(34, pick(FLAMES, frame))
    },
  },
  dungeon: {
    frames: 6,
    draw: (c, frame) => {
      const shift = frame * 2
      for (let y = 0; y < PX_HEIGHT - 1; y += 1) {
        for (let x = 0; x < c.width; x += 1) {
          const offset = Math.floor(y / 3) % 2 === 0 ? 0 : 3
          const isMortar = y % 3 === 2 || (x + shift + offset) % 6 === 0
          c.set(x, y, isMortar ? 'K' : 'e')
        }
      }
      c.ground(shift, 'd', 'e')
      for (let base = 6; base < c.width + 24; base += 24) {
        const x = base - (shift % 24)
        c.set(x, 2, 'K')
        c.set(x, 3, 'n')
        const flame = frame % 2 === 0 ? ['.F.', 'YOY'] : ['F..', 'OYY']
        flame.forEach((row, dy) => [...row].forEach((p, dx) => p !== '.' && c.set(x - 1 + dx, dy, p)))
      }
      c.stand(19, frame % 2 === 0 ? HERO : HERO_STEP)
    },
  },
  summon: {
    frames: 4,
    draw: (c, frame) => {
      c.ground(0, 'P', 'P')
      for (let x = 22; x < 40; x += 1) c.dot(x, PX_HEIGHT - 1, (x + frame) % 3 === 0 ? 'p' : 'C')
      c.stand(6, HERO)
      c.paint(13, 0, SWORD_UP, 'p')
      if (frame === 0) {
        c.dots([[27, 6], [33, 4], [30, 2]], 'C')
      } else if (frame === 1) {
        c.paint(29, 4, ORB_SMALL)
      } else {
        c.paint(28, 2 + (frame % 2), ORB)
        if (frame === 3) c.dots([[26, 1], [34, 1], [25, 5], [35, 5]], 'F')
      }
    },
  },
  treasure: {
    frames: 4,
    draw: (c, frame) => {
      c.ground()
      c.stand(frame === 0 ? 6 : 14, frame % 2 === 0 ? HERO : HERO_STEP)
      c.stand(26, frame < 2 ? CHEST_SHUT : CHEST_OPEN)
      if (frame === 3) c.dots([[25, 0], [31, 0], [37, 1], [29, 1], [34, 0]], 'F')
    },
  },
  mine: {
    frames: 4,
    draw: (c, frame) => {
      c.ground(0, 'n', 'e')
      c.stand(10, HERO)
      c.stand(22, ROCK)
      if (frame % 2 === 1) {
        c.paint(17, 5, PICK_DOWN)
        c.dots(frame === 1 ? [[22, 1], [20, 3]] : [[21, 0], [23, 2]], 'Y')
      } else {
        c.paint(15, 0, PICK_UP)
      }
    },
  },
  voyage: {
    frames: 4,
    draw: (c, frame) => {
      c.paint(40, 0, ['.FF.', 'FYYF', '.FF.'])
      c.tiled(offset => c.paint(offset + 6 + frame * 2, 1, GULL))
      for (let y = 7; y < PX_HEIGHT; y += 1) {
        for (let x = 0; x < c.width; x += 1) {
          const crest = (x + frame * 2 + y * 3) % 8
          const isEmpty = y === 7 && crest > 2
          if (!isEmpty) c.set(x, y, crest === 0 ? 'C' : y === 9 ? 'U' : 'b')
        }
      }
      const bob = frame % 2
      c.paint(16, bob, BOAT)
      c.paint(19, 3 + bob, ['KSK'])
    },
  },
  camp: {
    frames: 3,
    draw: (c, frame) => {
      c.ground(0, 'D', 'e')
      const stars = [[3, 1], [12, 0], [20, 2], [28, 0], [34, 3], [46, 2]] as const
      c.tiled(offset =>
        stars.forEach(([x, y], i) => {
          if ((i + frame) % 3 !== 0) c.dot(offset + x, y, 'W')
        }),
      )
      c.paint(40, 0, MOON)
      c.stand(10, HERO_SIT)
      c.stand(22, pick(FLAMES, frame), 1)
      c.stand(21, LOGS)
    },
  },
  victory: {
    frames: 2,
    draw: (c, frame) => {
      c.ground()
      c.stand(18, HERO_CHEER, frame)
      c.paint(26, -frame, SWORD_UP)
      const sparkles = frame === 0 ? [[10, 2], [36, 1], [14, 6], [32, 5]] : [[12, 0], [38, 3], [8, 5], [34, 7]]
      c.tiled(offset => c.dots(sparkles.map(([x, y]) => [offset + (x ?? 0), y ?? 0] as const), 'F'))
    },
  },
  defeat: {
    frames: 3,
    draw: (c, frame) => {
      c.ground(0, 'e', 'd')
      c.stand(18, TOMB)
      c.paint(28, 2 - frame, GHOST)
    },
  },
}

export function sceneFrames(id: SceneId): number {
  return SCENES[id].frames
}

/** Draws a scene `width` pixels wide (at least the 48 px stage), the action centered. */
export function drawScene(id: SceneId, tick: number, width = PX_WIDTH): Grid {
  const canvas = new Canvas(Math.max(PX_WIDTH, Math.floor(width)))
  const scene = SCENES[id]
  scene.draw(canvas, tick % scene.frames)
  return canvas.grid
}

const TEST_COMMAND = /\b(pytest|jest|vitest|ruff|basedpyright|eslint|tsc|npm (run )?(test|lint))\b/
const GIT_COMMAND = /^\s*(rtk\s+)?git\b/

export function sceneForTool(tool: string, command?: string): SceneId {
  if (tool === 'Bash') {
    if (command !== undefined && TEST_COMMAND.test(command)) return 'battle'
    if (command !== undefined && GIT_COMMAND.test(command)) return 'treasure'
    return 'mine'
  }
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return 'forge'
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return 'dungeon'
  if (tool === 'Agent' || tool === 'Task') return 'summon'
  if (tool === 'WebFetch' || tool === 'WebSearch' || tool.startsWith('mcp__')) return 'voyage'
  return 'camp'
}
