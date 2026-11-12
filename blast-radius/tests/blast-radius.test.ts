import { expect, test } from 'claude-code/testing'

declare const setTimeout: (fn: () => void, ms: number) => unknown

const ok = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a held rm -rf draws its report and Cancel refuses it (${surface})`, async ($, on) => {
    let ran = false
    on('process.run', async (_$, e) => {
      if (e.argv[0] === 'sleep') {
        await new Promise<void>(resolve => setTimeout(resolve, 5))
        return ok('')
      }
      // The rm measuring script: files, bytes, paths found, then the file list.
      if (e.argv[0] === 'bash' && e.argv.includes('build')) return ok('2 2048 1\nbuild/a.js\nbuild/b.js\n')
      return ok('')
    })
    on('tool.call', { tool: 'Bash' }, () => {
      ran = true
      return { result: { stdout: '', stderr: '', interrupted: false } } as never
    })

    on('session.cwd', () => ({ value: '/repo' }) as never)
    on('ui.open', () => ({ value: { isPlaced: true } }) as never)
    on('clock.now', () => ({ value: 0 }) as never)
    on('ui.close', () => ({ value: undefined }) as never)
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })

    let pressed = false
    for (let attempt = 0; attempt < 200 && !pressed; attempt += 1) {
      const ui = await $.ui.mount({ plugin: 'blast-radius', surface, component: 'Pane', props: {} as never, requestId: 'blast-radius' })
      if ((await ui.find({ key: 'cancel' })) !== undefined) {
        expect(await ui.find({ type: 'Text', text: /delete 2 files/ })).toBeDefined()
        await ui.press({ key: 'cancel' })
        pressed = true
      }
      await ui.unmount()
    }
    const result = await call
    expect(String(result.deny ?? ''), String(result.deny)).toContain('pressed Cancel')
    expect(pressed).toBe(true)
    expect(ran).toBe(false)
    expect(String(result.deny ?? '')).toContain('pressed Cancel')
  })
}
