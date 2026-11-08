import { describe, expect, it } from 'vitest'
import type { WorktreeRemovalInfo } from '../../../shared/types'
import { deleteFromDiskLabel, removeDialogPlan } from './removeWorktreeLogic'

function info(extra: Partial<WorktreeRemovalInfo> = {}): WorktreeRemovalInfo {
  return { worktreeId: 'w1', repoFolder: false, branch: 'fix', baseBranch: 'main', path: 'C:/wt/fix', uncommitted: 0, branchMerged: true, folderExists: true, ...extra }
}

describe('removeDialogPlan (D60)', () => {
  it('without the tick: plain Remove, nothing deleted', () => {
    expect(removeDialogPlan(false, null, false)).toEqual({ warnings: [], confirmLabel: 'Remove', options: {} })
  })

  it('waits for the facts before it can delete', () => {
    expect(removeDialogPlan(true, null, false).options).toBeNull()
    expect(removeDialogPlan(true, null, true).warnings[0]).toContain('Could not check')
  })

  it('a clean, merged worktree deletes without warnings', () => {
    expect(removeDialogPlan(true, info(), false)).toEqual({
      warnings: [], confirmLabel: 'Delete', options: { deleteFromDisk: true, discardChanges: false, deleteUnmergedBranch: false }
    })
  })

  it('uncommitted files and an unmerged branch are warned about and sent as "anyway"', () => {
    const plan = removeDialogPlan(true, info({ uncommitted: 1, branchMerged: false }), false)
    expect(plan.warnings).toEqual(['1 uncommitted file will be lost.', 'Branch fix has commits that main does not have; they will be lost.'])
    expect(plan.confirmLabel).toBe('Delete anyway')
    expect(plan.options).toEqual({ deleteFromDisk: true, discardChanges: true, deleteUnmergedBranch: true })
  })

  it('label names the branch', () => {
    expect(deleteFromDiskLabel('fix')).toBe('Also delete the folder and branch fix from disk')
  })
})
