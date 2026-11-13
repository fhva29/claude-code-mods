import catppuccin from './catppuccin'
import dracula from './dracula'
import github from './github'
import mono from './mono'
import neon from './neon'
import noir from './noir'
import nord from './nord'
import tokyoNight from './tokyo-night'
import type { Skin } from '../skin'

// A new built-in skin is one file beside these and one line here. The first is the default.
export const SKINS: readonly Skin[] = [github, neon, tokyoNight, dracula, catppuccin, nord, noir, mono]
