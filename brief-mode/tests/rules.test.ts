import { describe, expect, test } from 'claude-code/testing'

import { BRIEF_RULES } from '../hooks/rules'

describe('BRIEF_RULES', () => {
  test('keeps the core rules and the overrides', async () => {
    expect(BRIEF_RULES).toContain('Lead with the answer')
    expect(BRIEF_RULES).toContain('at most 5 items')
    expect(BRIEF_RULES).toContain('Destructive or irreversible')
    expect(BRIEF_RULES).toContain('never changes the reply language')
  })
})
