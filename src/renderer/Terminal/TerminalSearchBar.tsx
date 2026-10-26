// The terminal search bar (W3): a small Orca-style widget in the bottom-right corner of the terminal
// area. It only owns markup; state and the xterm search addon live in useTerminalSearch.
import { X } from 'lucide-react'
import type { ChangeEvent, KeyboardEvent, ReactElement, RefObject } from 'react'
import { Input } from '../components/ui/input'

export interface TerminalSearchBarProps {
  readonly query: string
  readonly label: string
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly onQueryChange: (query: string) => void
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  readonly onClose: () => void
}

export function TerminalSearchBar(props: TerminalSearchBarProps): ReactElement {
  return (
    <div className="terminal-search" data-testid="terminal-search">
      <Input
        ref={props.inputRef}
        className="terminal-search__input"
        type="text"
        value={props.query}
        placeholder="Find in terminal"
        aria-label="Find in terminal"
        autoComplete="off"
        spellCheck={false}
        onChange={(event: ChangeEvent<HTMLInputElement>): void => {
          props.onQueryChange(event.target.value)
        }}
        onKeyDown={props.onKeyDown}
      />
      <span className="terminal-search__count" data-testid="terminal-search-count" aria-live="polite">
        {props.label}
      </span>
      <button type="button" className="terminal-search__close" aria-label="Close search" onClick={props.onClose}>
        <X size={14} />
      </button>
    </div>
  )
}
