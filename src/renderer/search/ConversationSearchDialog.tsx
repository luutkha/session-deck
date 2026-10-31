// "Search conversations" (D52): text search in the saved Claude conversations of SessionDeck's sessions.
import { Search } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { ConversationHit, ConversationSearchResult, Id, Session } from '../../shared/types'
import { errorMessage } from '../../shared/guards'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { ScrollArea } from '../components/ui/scroll-area'

export interface ConversationSearchDialogProps {
  readonly open: boolean
  readonly sessions: readonly Session[]
  readonly onOpenChange: (open: boolean) => void
  readonly onOpenSession: (id: Id) => void
}

const DEBOUNCE_MS = 250
const MIN_QUERY = 2

function when(at: number | null): string {
  if (at === null) return ''
  return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function HitRow({ hit, name, onOpen }: { readonly hit: ConversationHit; readonly name: string; readonly onOpen: () => void }): ReactElement {
  const before = hit.snippet.slice(0, hit.matchStart)
  const match = hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)
  const after = hit.snippet.slice(hit.matchStart + hit.matchLength)
  return (
    <li>
      <button
        type="button"
        data-search-hit={name}
        onClick={onOpen}
        className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
      >
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="truncate font-medium text-foreground">{name}</span>
          <span>{hit.role === 'user' ? 'You' : 'Claude'}</span>
          <span className="ml-auto shrink-0 tabular-nums">{when(hit.at)}</span>
        </span>
        <span className="break-words text-[12px] leading-snug text-foreground/90">
          {before}
          <mark className="rounded-sm bg-amber-400/25 px-0.5 text-foreground">{match}</mark>
          {after}
        </span>
      </button>
    </li>
  )
}

export function ConversationSearchDialog({ open, sessions, onOpenChange, onOpenSession }: ConversationSearchDialogProps): ReactElement {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<ConversationSearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const names = useMemo(() => new Map(sessions.map((s) => [s.id, s.name])), [sessions])

  useEffect((): (() => void) | undefined => {
    const text = query.trim()
    if (text.length < MIN_QUERY) {
      setResult(null)
      setError(null)
      return undefined
    }
    let cancelled = false
    const timer = window.setTimeout((): void => {
      setBusy(true)
      window.api.searchConversations(text).then(
        (found): void => {
          if (cancelled) return
          setResult(found)
          setError(null)
          setBusy(false)
        },
        (err: unknown): void => {
          if (cancelled) return
          setError(errorMessage(err))
          setBusy(false)
        }
      )
    }, DEBOUNCE_MS)
    return (): void => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  const status =
    query.trim().length < MIN_QUERY
      ? 'Type at least 2 characters.'
      : busy && result === null
        ? 'Searching…'
        : result === null
          ? ''
          : result.hits.length === 0
            ? `No matches in ${result.searchedSessions} conversation${result.searchedSessions === 1 ? '' : 's'}.`
            : `${result.hits.length}${result.truncated ? '+' : ''} match${result.hits.length === 1 ? '' : 'es'} in ${result.searchedSessions} conversation${result.searchedSessions === 1 ? '' : 's'}${result.truncated ? ' (showing the first ones)' : ''}.`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]" data-search-dialog="">
        <DialogHeader>
          <DialogTitle>Search conversations</DialogTitle>
          <DialogDescription>
            Finds text in the saved Claude Code conversations of your sessions (read-only). OpenCode conversations are not
            searched yet.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event): void => setQuery(event.target.value)}
            placeholder="Search text…"
            aria-label="Search text"
            autoFocus
            maxLength={200}
            className="h-9 pl-8 text-[13px]"
          />
        </div>
        {error !== null ? (
          <p role="alert" className="text-xs text-destructive">{error}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground" data-search-status="">{status}</p>
        )}
        {result !== null && result.hits.length > 0 ? (
          <ScrollArea className="max-h-[360px]">
            <ol className="flex flex-col gap-0.5" aria-label="Matches">
              {result.hits.map((hit, index) => (
                <HitRow
                  key={`${hit.sessionId}-${index}`}
                  hit={hit}
                  name={names.get(hit.sessionId) ?? 'Removed session'}
                  onOpen={(): void => {
                    onOpenSession(hit.sessionId)
                    onOpenChange(false)
                  }}
                />
              ))}
            </ol>
          </ScrollArea>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
