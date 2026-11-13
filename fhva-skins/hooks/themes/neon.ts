import type { Skin } from '../skin'

// The default: the dark neon palette of the midnight-neon mod, with a light twin.
const skin: Skin = {
  name: 'neon',
  label: 'Midnight Neon',
  palette: {
    read: '#8be9fd',
    write: '#ffb86c',
    run: '#f1fa8c',
    search: '#bd93f9',
    web: '#ff79c6',
    mcp: '#50fa7b',
    other: '#9aa5ce',
    user: '#ff79c6',
    fg: '#f8f8f2',
    muted: '#6272a4',
    surface: '#2b2d3a',
    zebra: '#252733',
    ok: '#50fa7b',
    err: '#ff5555',
    warn: '#ffb86c',
  },
  light: {
    read: '#0e7490',
    write: '#c2410c',
    run: '#a16207',
    search: '#7c3aed',
    web: '#db2777',
    mcp: '#15803d',
    other: '#475569',
    user: '#7c3aed',
    fg: '#1e1b2e',
    muted: '#6b7280',
    surface: '#f3f0ff',
    zebra: '#faf8ff',
    ok: '#15803d',
    err: '#dc2626',
    warn: '#c2410c',
  },
  spinner: ['Glowing', 'Pulsing', 'Wiring', 'Overclocking', 'Rendering', 'Buzzing'],
  done: ['Lit', 'Wired', 'Charged', 'Shipped'],
}

export default skin
