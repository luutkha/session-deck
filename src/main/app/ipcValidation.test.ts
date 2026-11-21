import { describe, it, expect } from 'vitest'
import {
  isId,
  isNonEmptyString,
  isFiniteInt,
  assertId,
  assertNonEmptyString,
  assertFiniteInt,
  asCreateSessionInput,
  assertGroup,
  assertStatusDef,
  assertPtyWriteData,
  assertDimension,
  assertNullableId,
  assertBoolean,
  assertIndex,
  assertIdList,
  assertStatusOrder,
  MAX_PTY_WRITE_CHARS,
  MAX_TERMINAL_DIMENSION
} from './ipcValidation'

describe('ipcValidation', () => {
  describe('isId', () => {
    it('returns true for valid non-empty string', () => {
      expect(isId('abc')).toBe(true)
      expect(isId('a')).toBe(true)
    })

    it('returns false for empty string', () => {
      expect(isId('')).toBe(false)
    })

    it('returns false for non-string', () => {
      expect(isId(123)).toBe(false)
      expect(isId(null)).toBe(false)
      expect(isId(undefined)).toBe(false)
      expect(isId({})).toBe(false)
    })

    it('returns false for string exceeding max length', () => {
      const long = 'a'.repeat(257)
      expect(isId(long)).toBe(false)
    })
  })

  describe('isNonEmptyString', () => {
    it('returns true for valid string within default max', () => {
      expect(isNonEmptyString('hello')).toBe(true)
    })

    it('returns false for empty string', () => {
      expect(isNonEmptyString('')).toBe(false)
    })

    it('returns false for non-string', () => {
      expect(isNonEmptyString(123)).toBe(false)
      expect(isNonEmptyString(null)).toBe(false)
    })

    it('respects custom maxLength', () => {
      expect(isNonEmptyString('abc', 3)).toBe(true)
      expect(isNonEmptyString('abcd', 3)).toBe(false)
    })
  })

  describe('isFiniteInt', () => {
    it('returns true for valid integer within default range', () => {
      expect(isFiniteInt(0)).toBe(true)
      expect(isFiniteInt(42)).toBe(true)
      expect(isFiniteInt(-1)).toBe(true)
    })

    it('returns false for non-integer', () => {
      expect(isFiniteInt(1.5)).toBe(false)
      expect(isFiniteInt(NaN)).toBe(false)
      expect(isFiniteInt(Infinity)).toBe(false)
      expect(isFiniteInt(-Infinity)).toBe(false)
    })

    it('returns false for non-number', () => {
      expect(isFiniteInt('42')).toBe(false)
      expect(isFiniteInt(null)).toBe(false)
    })

    it('respects custom min/max', () => {
      expect(isFiniteInt(5, 0, 10)).toBe(true)
      expect(isFiniteInt(-1, 0, 10)).toBe(false)
      expect(isFiniteInt(11, 0, 10)).toBe(false)
    })
  })

  describe('assertId', () => {
    it('returns the value for valid id', () => {
      expect(assertId('valid-id', 'field')).toBe('valid-id')
    })

    it('throws for empty string', () => {
      expect(() => assertId('', 'field')).toThrow('Invalid field: must be a non-empty string')
    })

    it('throws for non-string', () => {
      expect(() => assertId(123, 'field')).toThrow('Invalid field: must be a non-empty string')
    })
  })

  describe('assertNonEmptyString', () => {
    it('returns the value for valid string', () => {
      expect(assertNonEmptyString('hello', 'field')).toBe('hello')
    })

    it('throws for empty string', () => {
      expect(() => assertNonEmptyString('', 'field')).toThrow('Invalid field: must be a non-empty string')
    })

    it('throws for non-string', () => {
      expect(() => assertNonEmptyString(123, 'field')).toThrow('Invalid field: must be a non-empty string')
    })

    it('throws for string exceeding maxLength', () => {
      expect(() => assertNonEmptyString('abc', 'field', 2)).toThrow('Invalid field: must be a non-empty string up to 2 characters')
    })
  })

  describe('assertFiniteInt', () => {
    it('returns the value for valid integer', () => {
      expect(assertFiniteInt(42, 'field')).toBe(42)
    })

    it('throws for non-integer', () => {
      expect(() => assertFiniteInt(1.5, 'field')).toThrow('Invalid field: must be an integer')
    })

    it('throws for NaN/Infinity', () => {
      expect(() => assertFiniteInt(NaN, 'field')).toThrow('Invalid field: must be an integer')
      expect(() => assertFiniteInt(Infinity, 'field')).toThrow('Invalid field: must be an integer')
    })

    it('throws for out of range', () => {
      expect(() => assertFiniteInt(11, 'field', 0, 10)).toThrow('Invalid field: must be an integer between 0 and 10')
      expect(() => assertFiniteInt(-1, 'field', 0, 10)).toThrow('Invalid field: must be an integer between 0 and 10')
    })
  })

  describe('asCreateSessionInput', () => {
    it('accepts minimal valid input', () => {
      const input = asCreateSessionInput({ cwd: '/home/user' })
      expect(input).toEqual({ cwd: '/home/user', name: undefined, groupId: null, statusId: null, claudeArgs: undefined })
    })

    it('accepts all optional fields', () => {
      const input = asCreateSessionInput({
        cwd: '/home/user',
        name: 'My Session',
        groupId: 'group-1',
        statusId: 'status-1',
        claudeArgs: ['--arg1', '--arg2']
      })
      expect(input).toEqual({
        cwd: '/home/user',
        name: 'My Session',
        groupId: 'group-1',
        statusId: 'status-1',
        claudeArgs: ['--arg1', '--arg2']
      })
    })

    it('allows null for groupId and statusId', () => {
      const input = asCreateSessionInput({ cwd: '/home/user', groupId: null, statusId: null })
      expect(input.groupId).toBeNull()
      expect(input.statusId).toBeNull()
    })

    it('D79: accepts the OpenCode permission policy for OpenCode sessions only, and rejects anything else', () => {
      expect(asCreateSessionInput({ cwd: '/home', agent: 'opencode', opencodePermissions: 'ask' }).opencodePermissions).toBe('ask')
      expect(asCreateSessionInput({ cwd: '/home', agent: 'opencode', opencodePermissions: 'yolo' }).opencodePermissions).toBe('yolo')
      expect(asCreateSessionInput({ cwd: '/home', agent: 'claude', opencodePermissions: 'ask' }).opencodePermissions).toBeUndefined()
      expect(() => asCreateSessionInput({ cwd: '/home', agent: 'opencode', opencodePermissions: 'always' })).toThrow(
        'opencodePermissions must be "yolo" or "ask"'
      )
    })

    it('throws for missing cwd', () => {
      expect(() => asCreateSessionInput({})).toThrow('Invalid cwd: must be a non-empty string')
    })

    it('throws for empty cwd', () => {
      expect(() => asCreateSessionInput({ cwd: '' })).toThrow('Invalid cwd: must be a non-empty string')
    })

    it('throws for unknown keys', () => {
      expect(() => asCreateSessionInput({ cwd: '/home', unknown: 'value' })).toThrow('Invalid createSession input: unknown key "unknown"')
      // D53: only main creates the Jarvis session.
      expect(() => asCreateSessionInput({ cwd: '/home', role: 'jarvis' })).toThrow('unknown key "role"')
    })

    it('throws for non-array claudeArgs', () => {
      expect(() => asCreateSessionInput({ cwd: '/home', claudeArgs: 'not-array' })).toThrow('Invalid createSession input: claudeArgs must be an array')
    })

    it('throws for non-string elements in claudeArgs', () => {
      expect(() => asCreateSessionInput({ cwd: '/home', claudeArgs: ['valid', 123] })).toThrow('Invalid createSession input: claudeArgs must contain only strings')
    })

    it('throws for non-object input', () => {
      expect(() => asCreateSessionInput('not-object')).toThrow('Invalid createSession input: must be an object')
      expect(() => asCreateSessionInput(null)).toThrow('Invalid createSession input: must be an object')
    })
  })

  describe('assertGroup', () => {
    it('returns valid group', () => {
      const group = assertGroup({ id: 'g1', name: 'Group 1', collapsed: true })
      expect(group).toEqual({ id: 'g1', name: 'Group 1', collapsed: true })
    })

    it('defaults collapsed to false', () => {
      const group = assertGroup({ id: 'g1', name: 'Group 1' })
      expect(group.collapsed).toBe(false)
    })

    it('throws for missing id', () => {
      expect(() => assertGroup({ name: 'Group 1' })).toThrow('Invalid group.id')
    })

    it('throws for missing name', () => {
      expect(() => assertGroup({ id: 'g1' })).toThrow('Invalid group.name')
    })

    it('throws for non-object', () => {
      expect(() => assertGroup('not-object')).toThrow('Invalid group: must be an object')
      expect(() => assertGroup(null)).toThrow('Invalid group: must be an object')
    })
  })

  describe('assertStatusDef', () => {
    it('returns valid status', () => {
      const status = assertStatusDef({ id: 's1', name: 'Status 1', color: '#ff0000' })
      expect(status).toEqual({ id: 's1', name: 'Status 1', color: '#ff0000' })
    })

    it('throws for missing fields', () => {
      expect(() => assertStatusDef({ name: 'Status 1', color: '#ff0000' })).toThrow('Invalid status.id')
      expect(() => assertStatusDef({ id: 's1', color: '#ff0000' })).toThrow('Invalid status.name')
      expect(() => assertStatusDef({ id: 's1', name: 'Status 1' })).toThrow('Invalid status.color')
    })

    it('throws for non-object', () => {
      expect(() => assertStatusDef('not-object')).toThrow('Invalid status: must be an object')
      expect(() => assertStatusDef(null)).toThrow('Invalid status: must be an object')
    })
  })

  describe('pty and list helpers', () => {
    it('assertPtyWriteData accepts strings up to the limit, including empty', () => {
      expect(assertPtyWriteData('')).toBe('')
      expect(assertPtyWriteData('ls\r')).toBe('ls\r')
      expect(assertPtyWriteData('x'.repeat(MAX_PTY_WRITE_CHARS))).toHaveLength(MAX_PTY_WRITE_CHARS)
    })

    it('assertPtyWriteData rejects non-strings and oversize data', () => {
      expect(() => assertPtyWriteData(42)).toThrow('Invalid pty data: must be a string')
      expect(() => assertPtyWriteData(undefined)).toThrow('Invalid pty data: must be a string')
      expect(() => assertPtyWriteData('x'.repeat(MAX_PTY_WRITE_CHARS + 1))).toThrow('Invalid pty data')
    })

    it('assertDimension accepts integers from 1 to the maximum', () => {
      expect(assertDimension(80, 'cols')).toBe(80)
      expect(assertDimension(1, 'cols')).toBe(1)
      expect(assertDimension(MAX_TERMINAL_DIMENSION, 'cols')).toBe(MAX_TERMINAL_DIMENSION)
    })

    it('assertDimension rejects 0, negatives, fractions, NaN and huge values', () => {
      expect(() => assertDimension(0, 'cols')).toThrow('Invalid cols')
      expect(() => assertDimension(-5, 'rows')).toThrow('Invalid rows')
      expect(() => assertDimension(10.5, 'cols')).toThrow('Invalid cols')
      expect(() => assertDimension(NaN, 'cols')).toThrow('Invalid cols')
      expect(() => assertDimension('80', 'cols')).toThrow('Invalid cols')
      expect(() => assertDimension(MAX_TERMINAL_DIMENSION + 1, 'cols')).toThrow('Invalid cols')
    })

    it('assertNullableId accepts null and valid ids only', () => {
      expect(assertNullableId(null, 'id')).toBeNull()
      expect(assertNullableId('s1', 'id')).toBe('s1')
      expect(() => assertNullableId('', 'id')).toThrow('Invalid id')
      expect(() => assertNullableId(undefined, 'id')).toThrow('Invalid id')
    })

    it('assertBoolean accepts only booleans', () => {
      expect(assertBoolean(true, 'enabled')).toBe(true)
      expect(() => assertBoolean('true', 'enabled')).toThrow('Invalid enabled: must be a boolean')
    })

    it('assertIndex accepts non-negative integers only', () => {
      expect(assertIndex(0, 'index')).toBe(0)
      expect(() => assertIndex(-1, 'index')).toThrow('Invalid index')
      expect(() => assertIndex(1.5, 'index')).toThrow('Invalid index')
    })

    it('assertIdList accepts an array of valid ids and rejects anything else', () => {
      expect(assertIdList(['a', 'b'], 'order')).toEqual(['a', 'b'])
      expect(() => assertIdList('a', 'order')).toThrow('Invalid order: must be an array of ids')
      expect(() => assertIdList(['a', ''], 'order')).toThrow('Invalid order[1]')
    })

    it('assertStatusOrder accepts up to 200 non-empty string ids', () => {
      expect(assertStatusOrder(['todo', 'working'], 'status order')).toEqual(['todo', 'working'])
      expect(assertStatusOrder([], 'status order')).toEqual([])
      const max = Array.from({ length: 200 }, (_, i) => `s${i}`)
      expect(assertStatusOrder(max, 'status order')).toHaveLength(200)
    })

    it('assertStatusOrder rejects non-arrays, more than 200 entries, and bad ids', () => {
      expect(() => assertStatusOrder('todo', 'status order')).toThrow('Invalid status order: must be an array of ids')
      const tooMany = Array.from({ length: 201 }, (_, i) => `s${i}`)
      expect(() => assertStatusOrder(tooMany, 'status order')).toThrow(
        'Invalid status order: must have at most 200 entries'
      )
      expect(() => assertStatusOrder(['a', ''], 'status order')).toThrow('Invalid status order[1]')
      expect(() => assertStatusOrder(['a', 1], 'status order')).toThrow('Invalid status order[1]')
    })
  })

  describe('createSession claudeArgs safety', () => {
    it('accepts safe claude arguments such as flags, values and paths', () => {
      const input = asCreateSessionInput({ cwd: '/home/user', claudeArgs: ['--model', 'opus-4.1', '--add-dir=/tmp/x'] })
      expect(input.claudeArgs).toEqual(['--model', 'opus-4.1', '--add-dir=/tmp/x'])
    })

    it('rejects arguments with shell metacharacters', () => {
      expect(() => asCreateSessionInput({ cwd: '/home', claudeArgs: ['--x', 'a&calc'] })).toThrow(
        'Invalid createSession input: Unsafe claude argument: a&calc'
      )
      expect(() => asCreateSessionInput({ cwd: '/home', claudeArgs: ['$(whoami)'] })).toThrow('Unsafe claude argument')
      expect(() => asCreateSessionInput({ cwd: '/home', claudeArgs: ['a b'] })).toThrow('Unsafe claude argument')
    })

    it('rejects an empty claude argument', () => {
      expect(() => asCreateSessionInput({ cwd: '/home', claudeArgs: [''] })).toThrow('Unsafe claude argument')
    })

    it('rejects too many claude arguments', () => {
      const args = Array.from({ length: 101 }, () => '--x')
      expect(() => asCreateSessionInput({ cwd: '/home', claudeArgs: args })).toThrow('at most 100 entries')
    })
  })
})