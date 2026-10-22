import type { ReactElement } from 'react'
import { Label } from '../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { LABEL_CLASS } from './SessionAgentFields'

export interface BaseBranchSelectProps {
  readonly idPrefix: string
  readonly branches: readonly string[]
  readonly value: string | null
  readonly loading: boolean
  /** Why the branches could not be read, or null. */
  readonly error: string | null
  readonly onChange: (branch: string) => void
}

/** Base branch of the new worktree. Shows loading and error states while the repo's branches are read. */
export function BaseBranchSelect(props: BaseBranchSelectProps): ReactElement {
  const { idPrefix, branches, value, loading, error } = props
  const unavailable = loading || error !== null || branches.length === 0
  const placeholder = loading ? 'Loading branches...' : 'No branches'
  return (
    <div className="space-y-1">
      <Label htmlFor={`${idPrefix}-base`} className={LABEL_CLASS}>Base branch</Label>
      <Select
        value={value ?? ''}
        disabled={unavailable}
        onValueChange={(next): void => props.onChange(next)}
      >
        <SelectTrigger id={`${idPrefix}-base`} aria-label="Base branch" size="sm" className="w-full text-xs">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent position="popper">
          {branches.map((branch) => (
            <SelectItem key={branch} value={branch} className="text-xs">
              {branch}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error !== null ? (
        <p role="alert" className="text-[11px] text-destructive">Could not load branches: {error}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">The new branch starts from this one.</p>
      )}
    </div>
  )
}
