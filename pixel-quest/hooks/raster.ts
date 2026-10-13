import { PALETTE } from './scenes'
import type { Grid } from './scenes'

const DEFAULT_COLOR = 0x01000000
const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584
const SPACE = 0x20
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function colorOf(pixel: string | undefined): number | null {
  return pixel === undefined ? null : (PALETTE[pixel] ?? null)
}

function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const chunk = (a << 16) | (b << 8) | c
    out += BASE64[(chunk >> 18) & 63]
    out += BASE64[(chunk >> 12) & 63]
    out += i + 1 < bytes.length ? BASE64[(chunk >> 6) & 63] : '='
    out += i + 2 < bytes.length ? BASE64[chunk & 63] : '='
  }
  return out
}

/** Packs a pixel grid into Raster cells: each cell is two stacked pixels drawn with half blocks. */
export function toCells(grid: Grid): { columns: number; rows: number; cells: string } {
  const columns = grid[0]?.length ?? 0
  const rows = Math.ceil(grid.length / 2)
  const words = new Uint32Array(columns * rows * 3)

  for (let row = 0; row < rows; row += 1) {
    for (let x = 0; x < columns; x += 1) {
      const top = colorOf(grid[row * 2]?.[x])
      const bottom = colorOf(grid[row * 2 + 1]?.[x])
      const at = (row * columns + x) * 3
      if (top === null && bottom === null) {
        words.set([SPACE, DEFAULT_COLOR, DEFAULT_COLOR], at)
      } else if (top === null) {
        words.set([LOWER_HALF, bottom ?? DEFAULT_COLOR, DEFAULT_COLOR], at)
      } else {
        words.set([UPPER_HALF, top, bottom ?? DEFAULT_COLOR], at)
      }
    }
  }

  return { columns, rows, cells: toBase64(new Uint8Array(words.buffer)) }
}
