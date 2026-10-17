import { describe, expect, it } from 'vitest'
import { insertCheckbox, parseSteps } from './parseSteps'

describe('parseSteps', () => {
  it('strips checkbox and bullet prefixes and splits lines', () => {
    expect(parseSteps('- [ ] write tests\n* [x] ship\n  plain\n\n- bullet')).toEqual([
      'write tests',
      'ship',
      'plain',
      'bullet'
    ])
  })
  it('returns nothing for blank input', () => {
    expect(parseSteps('  \n ')).toEqual([])
  })
})

describe('insertCheckbox', () => {
  it('prefixes the caret line', () => {
    expect(insertCheckbox('a\nbc', 3)).toEqual({ text: 'a\n- [ ] bc', caret: 9 })
  })
  it('works on an empty note', () => {
    expect(insertCheckbox('', 0)).toEqual({ text: '- [ ] ', caret: 6 })
  })
  it('does not double up', () => {
    expect(insertCheckbox('- [ ] x', 3)).toEqual({ text: '- [ ] x', caret: 3 })
  })
})
