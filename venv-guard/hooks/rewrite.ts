export type Rewrite = { command: string; changes: string[] }

const ACTIVATE = /(?:source|\.)\s+\S*venv\/bin\/activate\s*(?:&&|;)\s*/g
const RELATIVE_CD = /(^|&&|\|\||;)(\s*)cd\s+(BackEnd|FrontEnd)(?=[\s/;&|]|$)/g

// A command position: the start of the line or right after an operator.
const POSITION = String.raw`(^|&&|\|\||;|\||\(|\$\()(\s*)`
const ALWAYS_VENV = new RegExp(`${POSITION}(pytest|celery|django-admin)(?=\\s|$)`, 'g')
const DJANGO_PYTHON = new RegExp(
  `${POSITION}(python3?)(?=\\s+(?:manage\\.py|-m\\s+(?:pytest|celery|django)))`,
  'g',
)
const ANY_VENV_TOOL = new RegExp(`${POSITION}(python3?|pytest|celery|pip3?|django-admin)(?=\\s|$)`, 'g')

export function rewriteCommand(command: string, root: string): Rewrite {
  const bin = `${root}/BackEnd/venv/bin`
  const changes: string[] = []
  let next = command

  const hadActivate = ACTIVATE.test(next)
  ACTIVATE.lastIndex = 0
  if (hadActivate) {
    next = next.replace(ACTIVATE, '')
    changes.push('dropped `source venv/bin/activate`')
  }

  const toolPattern = hadActivate ? ANY_VENV_TOOL : ALWAYS_VENV
  const prefixed = new Set<string>()
  const prefix = (_: string, op: string, space: string, tool: string): string => {
    prefixed.add(tool)
    return `${op}${space}${bin}/${tool}`
  }
  next = next.replace(toolPattern, prefix)
  if (!hadActivate) {
    next = next.replace(DJANGO_PYTHON, prefix)
  }
  if (prefixed.size > 0) {
    changes.push(`venv ${[...prefixed].join(', ')}`)
  }

  const cdFixed = next.replace(RELATIVE_CD, (_, op: string, space: string, dir: string) => {
    return `${op}${space}cd ${root}/${dir}`
  })
  if (cdFixed !== next) {
    changes.push('absolute `cd`')
    next = cdFixed
  }

  return { command: next, changes }
}
