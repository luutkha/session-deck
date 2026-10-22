import type { ReactElement } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { sessionWord, type QuotaToastAction } from './quotaAlertLogic'

export interface QuotaToastControlsProps {
  readonly toastId: number
  readonly action: QuotaToastAction
  readonly busy: boolean
  /** Wake only: whether "continue" is typed into the cut-off sessions. */
  readonly sendContinue: boolean
  readonly onSendContinueChange: (value: boolean) => void
  readonly onRun: () => void
}

const BUTTON_CLASS = 'mt-2 h-6 text-xs'

function Spinner(): ReactElement {
  return <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
}

function SleepButton(props: Pick<QuotaToastControlsProps, 'action' | 'busy' | 'onRun'>): ReactElement {
  const { action, busy, onRun } = props
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      data-quota-action="sleep"
      className={BUTTON_CLASS}
      disabled={busy}
      onClick={onRun}
    >
      {busy ? <Spinner /> : null}
      {busy ? 'Sleeping…' : `Sleep ${String(action.count)} idle ${sessionWord(action.count)}`}
    </Button>
  )
}

function WakeControls(props: QuotaToastControlsProps): ReactElement {
  const { action, busy, toastId, sendContinue, onSendContinueChange, onRun } = props
  const checkboxId = `quota-continue-${String(toastId)}`
  return (
    <div className="flex flex-col gap-1.5">
      <div className="mt-2 flex items-center gap-2">
        <Checkbox
          id={checkboxId}
          data-quota-continue
          checked={sendContinue}
          disabled={busy}
          onCheckedChange={(checked): void => onSendContinueChange(checked === true)}
        />
        <Label htmlFor={checkboxId} className="text-xs font-normal text-muted-foreground">
          Type “continue” where a turn was cut off
        </Label>
      </div>
      <Button
        type="button"
        variant="outline"
        size="xs"
        data-quota-action="wake"
        className="h-6 w-fit text-xs"
        disabled={busy}
        onClick={onRun}
      >
        {busy ? <Spinner /> : null}
        {busy ? 'Waking…' : `Wake ${String(action.count)} ${sessionWord(action.count)}`}
      </Button>
    </div>
  )
}

/** The action button(s) on a quota toast: sleep idle sessions, or wake held sessions with the continue option. */
export function QuotaToastControls(props: QuotaToastControlsProps): ReactElement {
  if (props.action.kind === 'sleep') {
    return <SleepButton action={props.action} busy={props.busy} onRun={props.onRun} />
  }
  return <WakeControls {...props} />
}
