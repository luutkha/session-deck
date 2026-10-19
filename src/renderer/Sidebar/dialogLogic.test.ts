import { describe, it, expect } from 'vitest'
import {
  MAX_OPENCODE_MODEL_LENGTH,
  parseClaudeArgs,
  defaultNameFromFolder,
  buildCreateInput,
  validateOpenCodeModel,
  validateStatusDraft,
  initialFolder,
  type CreateSessionForm
} from './dialogLogic'
import type { Session } from '../../shared/types'

function form(overrides: Partial<CreateSessionForm> = {}): CreateSessionForm {
  return {
    folder: '/home/me/project',
    name: '',
    groupId: null,
    statusId: null,
    argsRaw: '',
    ...overrides
  }
}

describe('parseClaudeArgs', () => {
  it('returns ok with an empty list for an empty string', () => {
    expect(parseClaudeArgs('')).toEqual({ ok: true, args: [] })
  })

  it('returns ok with an empty list for whitespace-only input', () => {
    expect(parseClaudeArgs('   \t \n ')).toEqual({ ok: true, args: [] })
  })

  it('splits a single argument', () => {
    expect(parseClaudeArgs('--verbose')).toEqual({ ok: true, args: ['--verbose'] })
  })

  it('splits arguments on spaces, tabs and newlines', () => {
    const result = parseClaudeArgs('  --model\topus\n--resume  ')
    expect(result).toEqual({ ok: true, args: ['--model', 'opus', '--resume'] })
  })

  it('accepts every allowed special character', () => {
    const arg = 'a@b=c:d,e.f/g\\h-i_jk:l'
    expect(parseClaudeArgs(arg)).toEqual({ ok: true, args: [arg] })
  })

  it('rejects an argument containing a double quote', () => {
    expect(parseClaudeArgs('"quoted"')).toEqual({
      ok: false,
      error: 'Unsupported characters in argument: "quoted"'
    })
  })

  it('rejects a quoted argument that contains spaces', () => {
    const result = parseClaudeArgs('"a b"')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('Unsupported characters in argument: "a')
  })

  it('rejects an argument containing an ampersand', () => {
    expect(parseClaudeArgs('a&b')).toEqual({
      ok: false,
      error: 'Unsupported characters in argument: a&b'
    })
  })

  it('rejects an argument containing a single quote', () => {
    expect(parseClaudeArgs("it's")).toEqual({
      ok: false,
      error: "Unsupported characters in argument: it's"
    })
  })

  it('rejects an argument containing non-ascii characters', () => {
    const result = parseClaudeArgs('café')
    expect(result).toEqual({ ok: false, error: 'Unsupported characters in argument: café' })
  })

  it('rejects an argument containing a semicolon and reports only the bad token', () => {
    const result = parseClaudeArgs('--model opus;rm')
    expect(result).toEqual({ ok: false, error: 'Unsupported characters in argument: opus;rm' })
  })
})

describe('defaultNameFromFolder', () => {
  it('returns the last segment of a POSIX path', () => {
    expect(defaultNameFromFolder('/home/me/project')).toBe('project')
  })

  it('returns the last segment of a Windows path', () => {
    expect(defaultNameFromFolder('C:\\Users\\me\\code')).toBe('code')
  })

  it('ignores a trailing forward slash', () => {
    expect(defaultNameFromFolder('/home/me/project/')).toBe('project')
  })

  it('ignores a trailing backslash', () => {
    expect(defaultNameFromFolder('C:\\proj\\')).toBe('proj')
  })

  it('ignores repeated trailing separators', () => {
    expect(defaultNameFromFolder('C:\\proj\\\\')).toBe('proj')
    expect(defaultNameFromFolder('/home/me/project///')).toBe('project')
  })

  it('handles mixed separators', () => {
    expect(defaultNameFromFolder('C:/proj\\sub/')).toBe('sub')
  })

  it('keeps dots in the segment', () => {
    expect(defaultNameFromFolder('/home/me/my.app.v2')).toBe('my.app.v2')
  })

  it('handles a relative path', () => {
    expect(defaultNameFromFolder('proj')).toBe('proj')
  })

  it('handles a UNC share', () => {
    expect(defaultNameFromFolder('\\\\server\\share\\')).toBe('share')
  })

  it('falls back to "session" for an empty path', () => {
    expect(defaultNameFromFolder('')).toBe('session')
  })

  it('falls back to "session" for the filesystem root', () => {
    expect(defaultNameFromFolder('/')).toBe('session')
    expect(defaultNameFromFolder('\\')).toBe('session')
  })

  it('falls back to "session" for a drive root', () => {
    expect(defaultNameFromFolder('C:\\')).toBe('session')
    expect(defaultNameFromFolder('D:/')).toBe('session')
  })

  it('falls back to "session" when the last segment is blank', () => {
    expect(defaultNameFromFolder('   ')).toBe('session')
  })
})

describe('buildCreateInput', () => {
  it('returns an error for an empty folder', () => {
    expect(buildCreateInput(form({ folder: '' }))).toEqual({ ok: false, error: 'Folder required' })
  })

  it('returns an error for a whitespace-only folder', () => {
    expect(buildCreateInput(form({ folder: '   ' }))).toEqual({ ok: false, error: 'Folder required' })
  })

  it('trims the folder', () => {
    const result = buildCreateInput(form({ folder: '  /a/b  ' }))
    expect(result.ok).toBe(true)
    expect(result.ok && result.input.cwd).toBe('/a/b')
  })

  it('omits the name when it is empty so the store derives it', () => {
    const result = buildCreateInput(form({ name: '' }))
    expect(result.ok).toBe(true)
    expect(result.ok && 'name' in result.input).toBe(false)
  })

  it('omits the name when it is whitespace only', () => {
    const result = buildCreateInput(form({ name: '   ' }))
    expect(result.ok).toBe(true)
    expect(result.ok && 'name' in result.input).toBe(false)
  })

  it('trims and includes a provided name', () => {
    const result = buildCreateInput(form({ name: '  My work  ' }))
    expect(result.ok).toBe(true)
    expect(result.ok && result.input.name).toBe('My work')
  })

  it('rejects a name longer than 100 characters', () => {
    const result = buildCreateInput(form({ name: 'a'.repeat(101) }))
    expect(result).toEqual({ ok: false, error: 'Name too long' })
  })

  it('accepts a name of exactly 100 characters', () => {
    const result = buildCreateInput(form({ name: 'a'.repeat(100) }))
    expect(result.ok).toBe(true)
  })

  it('propagates the args error', () => {
    const result = buildCreateInput(form({ argsRaw: 'a&b' }))
    expect(result).toEqual({ ok: false, error: 'Unsupported characters in argument: a&b' })
  })

  it('includes parsed args and empty args by default', () => {
    const empty = buildCreateInput(form())
    expect(empty.ok).toBe(true)
    expect(empty.ok && empty.input.claudeArgs).toEqual([])

    const withArgs = buildCreateInput(form({ argsRaw: '--model opus' }))
    expect(withArgs.ok).toBe(true)
    expect(withArgs.ok && withArgs.input.claudeArgs).toEqual(['--model', 'opus'])
  })

  it('passes group and status through', () => {
    const result = buildCreateInput(form({ groupId: 'g1', statusId: 's1' }))
    expect(result.ok).toBe(true)
    expect(result.ok && result.input.groupId).toBe('g1')
    expect(result.ok && result.input.statusId).toBe('s1')
  })

  it('keeps an explicit null group (no group selected)', () => {
    const result = buildCreateInput(form({ groupId: null }))
    expect(result.ok).toBe(true)
    expect(result.ok && result.input.groupId).toBeNull()
  })

  it('reports the folder error before the name error', () => {
    const result = buildCreateInput(form({ folder: '', name: 'a'.repeat(101) }))
    expect(result).toEqual({ ok: false, error: 'Folder required' })
  })
})

describe('validateOpenCodeModel', () => {
  it('accepts an empty string (OpenCode uses its own default)', () => {
    expect(validateOpenCodeModel('')).toEqual({ ok: true, value: '' })
  })

  it('accepts a whitespace-only string as empty', () => {
    expect(validateOpenCodeModel('   ')).toEqual({ ok: true, value: '' })
  })

  it('accepts a provider/model with every allowed character', () => {
    const model = 'opencode/deepseek-v4.1-flash-free'
    expect(validateOpenCodeModel(model)).toEqual({ ok: true, value: model })
  })

  it('accepts the . _ : / @ + - punctuation set', () => {
    const model = 'a.b_c:d/e@f+g-h'
    expect(validateOpenCodeModel(model)).toEqual({ ok: true, value: model })
  })

  it('trims surrounding whitespace before validating', () => {
    expect(validateOpenCodeModel('  opencode/model  ')).toEqual({ ok: true, value: 'opencode/model' })
  })

  it('accepts a model of exactly the maximum length', () => {
    const value = 'a'.repeat(MAX_OPENCODE_MODEL_LENGTH)
    expect(validateOpenCodeModel(value)).toEqual({ ok: true, value })
  })

  it('rejects a model longer than the maximum', () => {
    const result = validateOpenCodeModel('a'.repeat(MAX_OPENCODE_MODEL_LENGTH + 1))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('too long')
  })

  it('rejects a model containing spaces', () => {
    const result = validateOpenCodeModel('opencode/bad model')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('only contain')
  })

  it('rejects a model containing non-ascii characters', () => {
    expect(validateOpenCodeModel('modèle').ok).toBe(false)
  })

  it('rejects a model containing a semicolon', () => {
    expect(validateOpenCodeModel('a;b').ok).toBe(false)
  })
})

describe('buildCreateInput (agent)', () => {
  it('defaults to claude and keeps the parsed claude args', () => {
    const result = buildCreateInput(form({ argsRaw: '--model opus' }))
    expect(result.ok).toBe(true)
    expect(result.ok && result.input.agent).toBe('claude')
    expect(result.ok && result.input.claudeArgs).toEqual(['--model', 'opus'])
    expect(result.ok && 'model' in result.input).toBe(false)
  })

  it('sends agent opencode and the trimmed model, and omits claude args', () => {
    const result = buildCreateInput(
      form({ agent: 'opencode', modelRaw: '  opencode/deepseek-v4.1-flash-free  ' })
    )
    expect(result.ok).toBe(true)
    expect(result.ok && result.input.agent).toBe('opencode')
    expect(result.ok && result.input.model).toBe('opencode/deepseek-v4.1-flash-free')
    expect(result.ok && 'claudeArgs' in result.input).toBe(false)
  })

  it('omits the model when the opencode model is empty', () => {
    const result = buildCreateInput(form({ agent: 'opencode', modelRaw: '   ' }))
    expect(result.ok).toBe(true)
    expect(result.ok && 'model' in result.input).toBe(false)
  })

  it('ignores claude args for opencode (they are invalid for claude only)', () => {
    const result = buildCreateInput(form({ agent: 'opencode', argsRaw: 'a&b', modelRaw: 'x/y' }))
    expect(result.ok).toBe(true)
    expect(result.ok && result.input.model).toBe('x/y')
  })

  it('reports a bad opencode model before the args are considered', () => {
    const result = buildCreateInput(form({ agent: 'opencode', modelRaw: 'bad model' }))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('only contain')
  })

  it('still propagates claude arg errors for the claude agent', () => {
    const result = buildCreateInput(form({ agent: 'claude', argsRaw: 'a&b' }))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('Unsupported characters')
  })
})

describe('validateStatusDraft', () => {
  it('accepts a valid name and color', () => {
    expect(validateStatusDraft({ name: 'Todo', color: '#9e9e9e' })).toEqual({ ok: true })
  })

  it('accepts uppercase hex color', () => {
    expect(validateStatusDraft({ name: 'Todo', color: '#AABBCC' })).toEqual({ ok: true })
  })

  it('accepts a name of exactly 100 characters', () => {
    expect(validateStatusDraft({ name: 'a'.repeat(100), color: '#ffffff' })).toEqual({ ok: true })
  })

  it('rejects an empty name', () => {
    expect(validateStatusDraft({ name: '', color: '#ffffff' })).toEqual({
      ok: false,
      error: 'Name required'
    })
  })

  it('rejects a whitespace-only name', () => {
    expect(validateStatusDraft({ name: '   ', color: '#ffffff' })).toEqual({
      ok: false,
      error: 'Name required'
    })
  })

  it('rejects a name of 101 characters', () => {
    expect(validateStatusDraft({ name: 'a'.repeat(101), color: '#ffffff' })).toEqual({
      ok: false,
      error: 'Name too long'
    })
  })

  it('trims the name before the length check', () => {
    expect(validateStatusDraft({ name: `  ${'a'.repeat(100)}  `, color: '#ffffff' })).toEqual({
      ok: true
    })
  })

  it('rejects a short hex color', () => {
    expect(validateStatusDraft({ name: 'Todo', color: '#FFF' })).toEqual({
      ok: false,
      error: 'Invalid color: #FFF (expected #rrggbb)'
    })
  })

  it('rejects a named color', () => {
    expect(validateStatusDraft({ name: 'Todo', color: 'red' })).toEqual({
      ok: false,
      error: 'Invalid color: red (expected #rrggbb)'
    })
  })

  it('rejects a hex color without the hash', () => {
    expect(validateStatusDraft({ name: 'Todo', color: '9e9e9e' })).toEqual({
      ok: false,
      error: 'Invalid color: 9e9e9e (expected #rrggbb)'
    })
  })

  it('rejects an 8-digit hex color', () => {
    expect(validateStatusDraft({ name: 'Todo', color: '#99999999' })).toEqual({
      ok: false,
      error: 'Invalid color: #99999999 (expected #rrggbb)'
    })
  })
})

describe('buildCreateInput (remote control)', () => {
  it('appends --remote-control last so it cannot swallow another value', () => {
    const result = buildCreateInput(form({ argsRaw: '--model opus', remoteControl: true }))
    expect(result.ok && result.input.claudeArgs).toEqual(['--model', 'opus', '--remote-control'])
  })

  it('does not duplicate a flag the user typed', () => {
    const result = buildCreateInput(form({ argsRaw: '--remote-control', remoteControl: true }))
    expect(result.ok && result.input.claudeArgs).toEqual(['--remote-control'])
  })

  it('is ignored for OpenCode sessions', () => {
    const result = buildCreateInput(form({ agent: 'opencode', remoteControl: true }))
    expect(result.ok && 'claudeArgs' in result.input).toBe(false)
  })
})

describe('initialFolder', () => {
  const at = (cwd: string, createdAt: number): Pick<Session, 'cwd' | 'createdAt'> => ({ cwd, createdAt })

  it('is empty the very first time (no sessions yet)', () => {
    expect(initialFolder(undefined, [])).toBe('')
  })

  it('defaults to the folder of the most recently created session', () => {
    const sessions = [at('C:/a', 10), at('C:/newest', 30), at('C:/b', 20)]
    expect(initialFolder(undefined, sessions)).toBe('C:/newest')
  })

  it('prefers a folder passed by the caller (workspace header)', () => {
    expect(initialFolder('D:/workspace', [at('C:/newest', 30)])).toBe('D:/workspace')
  })

  it('ignores blank folders', () => {
    expect(initialFolder('  ', [at('  ', 50), at('C:/real', 10)])).toBe('C:/real')
  })
})
