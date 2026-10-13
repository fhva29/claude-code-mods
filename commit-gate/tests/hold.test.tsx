import { expect, test } from 'claude-code/testing'

// The test runner has timers; the hooks environment's typings leave them out.
declare const setTimeout: (fn: () => void, ms: number) => unknown

const BAND = { component: 'AbovePrompt' } as const
const BAND_PROPS = { bodyColumns: 100 } as never

for (const choice of ['commit', 'cancel'] as const) {
  test(`pressing ${choice} decides the held commit`, async ($, on) => {
    let ran = false
    on('process.run', async (_$, e) => {
      const argv = e.argv.join(' ')
      if (e.argv[0] === 'sleep') {
        await new Promise<void>(resolve => setTimeout(resolve, 5))
      }
      if (argv === 'git rev-parse --show-toplevel') {
        return { value: { exitCode: 0, stdout: '/repo\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      if (argv.startsWith('git diff --cached')) {
        return { value: { exitCode: 0, stdout: 'M\tApp.jsx\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    // What the engine draws beneath the plugin above the prompt; the plugin's own band sits on top.
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })
    on('tool.call', { tool: 'Bash' }, () => {
      ran = true
      return { result: { stdout: '', stderr: '', interrupted: false } } as never
    })

    const call = $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' })

    let pressed = false
    for (let attempt = 0; attempt < 200 && !pressed; attempt += 1) {
      const ui = await $.ui.mount({ plugin: 'commit-gate', surface: 'terminal', ...BAND, props: BAND_PROPS })
      if ((await ui.find({ key: choice })) !== undefined) {
        expect(await ui.find({ type: 'Text', text: /not edited this session/ })).toBeDefined()
        await ui.press({ key: choice })
        pressed = true
      }
      await ui.unmount()
    }
    expect(pressed).toBe(true)

    const result = await call
    expect(ran).toBe(choice === 'commit')
    if (choice === 'cancel') {
      expect(String(result.text ?? result.deny ?? '')).toContain('App.jsx')
    }
  })
}
