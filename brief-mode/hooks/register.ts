import type { Register } from 'claude-code'

import { BRIEF_RULES } from './rules'

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)

    return {
      sections: [...sections, { id: 'brief-mode:rules', text: BRIEF_RULES, scope: 'session' }],
    }
  })
}
