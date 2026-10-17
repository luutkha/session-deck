import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement
} from 'react'
import { validateName } from './inlineEditValidation'

export interface InlineEditProps {
  readonly value: string
  readonly onCommit: (value: string) => void
  readonly onCancel: () => void
  readonly ariaLabel: string
}

/**
 * In-place text editor: selects all on mount, Enter commits, Esc cancels, blur
 * commits a valid value. Enter with an invalid value keeps the editor open and
 * shows the validation error; blurring with an invalid value cancels the edit
 * (reverts) instead of trapping focus in the field. Nothing is committed when
 * the trimmed value is unchanged.
 */
export function InlineEdit(props: InlineEditProps): ReactElement {
  const { value, onCommit, onCancel, ariaLabel } = props
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const settledRef = useRef(false)

  useEffect((): void => {
    const input = inputRef.current
    if (input !== null) {
      input.focus()
      input.select()
    }
  }, [])

  function settle(commit: boolean, refocusOnInvalid: boolean): void {
    if (settledRef.current) {
      return
    }
    if (!commit) {
      settledRef.current = true
      onCancel()
      return
    }
    const result = validateName(draft)
    if (!result.ok) {
      if (!refocusOnInvalid) {
        settledRef.current = true
        onCancel()
        return
      }
      setError(result.error)
      const input = inputRef.current
      if (input !== null) {
        input.focus()
        input.select()
      }
      return
    }
    settledRef.current = true
    if (result.value === value.trim()) {
      onCancel()
      return
    }
    onCommit(result.value)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      settle(true, true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      settle(false, false)
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    setDraft(event.target.value)
    if (error !== null) {
      setError(null)
    }
  }

  return (
    <span
      className="inline-edit"
      onMouseDown={(event): void => event.stopPropagation()}
      onClick={(event): void => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        className={error !== null ? 'inline-edit__input inline-edit__input--error' : 'inline-edit__input'}
        type="text"
        value={draft}
        aria-label={ariaLabel}
        aria-invalid={error !== null}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={(): void => settle(true, false)}
      />
      {error !== null && (
        <span className="inline-edit__error" role="alert">
          {error}
        </span>
      )}
    </span>
  )
}
