import { describe, expect, it, vi } from 'vitest'
import { createTreeKiller, NOOP_TREE_KILLER, taskkillArgs } from './treeKiller'

describe('taskkillArgs', () => {
  it('kills the whole tree and forces it, for one or many pids', () => {
    expect(taskkillArgs([123])).toEqual(['/PID', '123', '/T', '/F'])
    expect(taskkillArgs([1, 2, 3])).toEqual(['/PID', '1', '/PID', '2', '/PID', '3', '/T', '/F'])
  })
})

describe('createTreeKiller (win32)', () => {
  it('runs taskkill /T /F and reports completion even when taskkill fails (process already gone)', () => {
    const execFileFake = vi.fn((_file: string, _args: string[], _opts: unknown, cb: (e: Error | null) => void) => cb(new Error('not found')))
    const killer = createTreeKiller('win32', { execFile: execFileFake as never })
    const done = vi.fn()
    killer.killAsync([4242], done)
    expect(execFileFake).toHaveBeenCalledWith('taskkill', ['/PID', '4242', '/T', '/F'], { windowsHide: true }, expect.any(Function))
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('does not spawn anything for an empty pid list but still completes', () => {
    const execFileFake = vi.fn()
    const done = vi.fn()
    createTreeKiller('win32', { execFile: execFileFake as never }).killAsync([], done)
    expect(execFileFake).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('kills many sessions with ONE blocking taskkill call and tolerates a non-zero exit', () => {
    const execFileSyncFake = vi.fn(() => { throw new Error('exit 128') })
    const killer = createTreeKiller('win32', { execFileSync: execFileSyncFake as never })
    expect(() => killer.killSync([10, 20])).not.toThrow()
    expect(execFileSyncFake).toHaveBeenCalledTimes(1)
    expect(execFileSyncFake).toHaveBeenCalledWith('taskkill', ['/PID', '10', '/PID', '20', '/T', '/F'], expect.objectContaining({ windowsHide: true }))
  })
})

describe('createTreeKiller (posix)', () => {
  it('signals the process group first and then the pid, ignoring already-dead targets', () => {
    const kill = vi.fn((pid: number) => { if (pid > 0) throw new Error('ESRCH') })
    const done = vi.fn()
    createTreeKiller('linux', { kill }).killAsync([77], done)
    expect(kill).toHaveBeenNthCalledWith(1, -77, 'SIGKILL')
    expect(kill).toHaveBeenNthCalledWith(2, 77, 'SIGKILL')
    expect(done).toHaveBeenCalledTimes(1)
  })
})

describe('NOOP_TREE_KILLER', () => {
  it('only completes; it never touches processes (used with fake PTYs in tests)', () => {
    const done = vi.fn()
    NOOP_TREE_KILLER.killAsync([1], done)
    NOOP_TREE_KILLER.killSync([1])
    expect(done).toHaveBeenCalledTimes(1)
  })
})
