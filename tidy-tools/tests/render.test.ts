import { expect, mock, test } from 'claude-code/testing'

const VIEWPORT = { columns: 120, rows: 40 }

test('a finished Bash call draws as one compact line', async ($, on) => {
  mock.store(on)
  const ui = await $.ui.mount({
    plugin: 'tidy-tools',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'tu_1',
    viewport: VIEWPORT,
    props: {
      tool_use_id: 'tu_1',
      tool: 'Bash',
      input: { command: 'npm run lint' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: { stdout: 'ok\n', stderr: '', interrupted: false },
    },
  })
  expect(await ui.find({ key: 'toggle' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\(npm run lint\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 line out/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '●' }))?.props.color).toBe('success')
  await ui.unmount()
})

test('the duration measured at tool.call shows on the row', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  let release = (): void => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  on('tool.call', async () => {
    await gate
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  const call = $.tool.call({ tool: 'Bash', tool_use_id: 'tu_3', command: 'sleep 3' })
  await clock.advance(0)
  await clock.advance(3200)
  release()
  await call

  const ui = await $.ui.mount({
    plugin: 'tidy-tools',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'tu_3',
    viewport: VIEWPORT,
    props: {
      tool_use_id: 'tu_3',
      tool: 'Bash',
      input: { command: 'sleep 3' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: { stdout: '', stderr: '', interrupted: false },
    },
  })
  expect(await ui.find({ type: 'Text', text: /3\.2s · 0 lines out/ })).toBeDefined()
  await ui.unmount()
})

test('a successful result is hidden and an errored one is left to the engine', async ($, on) => {
  mock.store(on)
  on('ui.render', { component: 'ToolResult' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: ['engine result'] })
  })
  const base = { tool_use_id: 'tu_2', tool: 'Bash', output: { stdout: 'x', stderr: '' } }

  const ok = await $.ui.mount({
    plugin: 'tidy-tools',
    surface: 'terminal',
    component: 'ToolResult',
    viewport: VIEWPORT,
    props: { ...base, isErrored: false },
  })
  expect(await ok.find({ text: 'engine result' })).toBeUndefined()
  await ok.unmount()

  const failed = await $.ui.mount({
    plugin: 'tidy-tools',
    surface: 'terminal',
    component: 'ToolResult',
    viewport: VIEWPORT,
    props: { ...base, output: 'exit 1', isErrored: true },
  })
  expect(await failed.find({ text: 'engine result' })).toBeDefined()
  await failed.unmount()
})

test('pressing the tool name opens its output and pressing again closes it', async ($, on) => {
  mock.store(on)
  const ui = await $.ui.mount({
    plugin: 'tidy-tools',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'tu_9',
    viewport: VIEWPORT,
    props: {
      tool_use_id: 'tu_9',
      tool: 'Bash',
      input: { command: 'echo hello' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: { stdout: 'hello-output\n', stderr: '', interrupted: false },
    },
  })
  expect(await ui.find({ type: 'Text', text: /hello-output/ })).toBeUndefined()
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /hello-output/ })).toBeDefined()
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /hello-output/ })).toBeUndefined()
  await ui.unmount()
})

test('pressing an edit row opens a diff view', async ($, on) => {
  mock.store(on)
  const ui = await $.ui.mount({
    plugin: 'tidy-tools',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'tu_edit',
    viewport: VIEWPORT,
    props: {
      tool_use_id: 'tu_edit',
      tool: 'Edit',
      input: { file_path: '/w/a.py', old_string: 'old', new_string: 'new' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: { structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['-old', '+new'] }] },
    },
  })
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ type: 'Code' }))?.props.format).toBe('diff')
  await ui.unmount()
})

function toolProps(id: string) {
  return {
    tool_use_id: id,
    tool: 'Bash',
    input: { command: `echo ${id}` },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    output: { stdout: 'ok\n', stderr: '', interrupted: false },
  }
}

test('turn mode folds a turn into one summary row that opens in place', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'lines' } }))
  on('session.start', () => ({ cwd: '/repo' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({
    command: 'lines',
    args: 'turn',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  await $.turn.start({ text: 'go', turnId: 'turn_1' })
  for (const id of ['a1', 'a2', 'a3']) {
    await $.tool.call({ tool: 'Bash', tool_use_id: id, command: `echo ${id}` })
  }

  const mountRow = (id: string) =>
    $.ui.mount({
      plugin: 'tidy-tools',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: id,
      viewport: VIEWPORT,
      props: toolProps(id),
    })
  const first = await mountRow('a1')
  const second = await mountRow('a2')
  const texts = async (ui: typeof first): Promise<string> =>
    (await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')

  expect(await first.find({ key: 'turn-toggle' }), await texts(first)).toBeDefined()
  expect(await first.find({ type: 'Text', text: /echo a1/ })).toBeUndefined()
  expect(await second.findAll({ type: 'Text' })).toHaveLength(0)

  await first.press({ key: 'turn-toggle' })
  expect(await first.find({ type: 'Text', text: /echo a1/ }), await texts(first)).toBeDefined()
  expect(await second.find({ type: 'Text', text: /echo a2/ }), await texts(second)).toBeDefined()
  await first.unmount()
  await second.unmount()
})

test('turn summary counts calls that failed', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'lines' } }))
  on('session.start', () => ({ cwd: '/repo' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', (_$, e) =>
    e.tool_use_id === 'b2'
      ? { isError: true, result: 'exit 1' }
      : e.tool_use_id === 'b3'
        ? { deny: 'refused' }
        : { result: { stdout: '', stderr: '', interrupted: false } },
  )
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({
    command: 'lines',
    args: 'turn',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  await $.turn.start({ text: 'go', turnId: 'turn_2' })
  for (const id of ['b1', 'b2', 'b3']) {
    await $.tool.call({ tool: 'Bash', tool_use_id: id, command: `echo ${id}` })
  }
  const ui = await $.ui.mount({
    plugin: 'tidy-tools',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'b1',
    viewport: VIEWPORT,
    props: toolProps('b1'),
  })
  const failedText = await ui.find({ type: 'Text', text: /✗ 2 failed/ })
  expect(failedText).toBeDefined()
  expect(failedText?.props.color).toBe('error')
  expect(await ui.find({ key: 'turn-toggle' })).toBeDefined()
  await ui.unmount()
})
