import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { CodeRepoSection } from './CodeRepoSection'
import type { CodeTree } from './codeTree'
import type { CodeTreeView } from './codeTreeView'

export interface CodeTreeListProps {
  readonly tree: CodeTree
  readonly view: CodeTreeView
  readonly onListKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}

/** The repo sections of the Code sidebar (the Closed section is rendered by CodeSidebar). */
export function CodeTreeList({ tree, view, onListKeyDown }: CodeTreeListProps): ReactElement {
  return (
    <div
      role="tree"
      aria-label="Repositories"
      tabIndex={0}
      onKeyDown={onListKeyDown}
      className="flex flex-col gap-0.5 outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
    >
      {tree.repos.map((node): ReactElement => (
        <CodeRepoSection key={node.repo.id} node={node} view={view} />
      ))}
    </div>
  )
}
