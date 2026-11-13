// "Auto" visual effects also back off when many agents are busy (D68). Every working or waiting session pulses its status
// dot in the sidebar, the tab bar and the Hub; with dozens of them the page keeps animating and repainting (measured at 40
// sessions with events: 57% renderer busy with full effects, 38% reduced). Hysteresis keeps it from flipping when the count
// hovers around the limit.
import type { Id, RuntimeState } from '../../shared/types'

/** Animated sessions at or above which Auto turns the effects down. */
export const EFFECTS_FLEET_ENTER = 10
/** ... and at or below which Auto turns them back on. */
export const EFFECTS_FLEET_EXIT = 6

/** Sessions whose status dot pulses: a running session that is working, or one that needs the user. */
export function animatedSessionCount(runtime: ReadonlyMap<Id, RuntimeState>): number {
  let count = 0
  for (const state of runtime.values()) {
    if (state.run === 'running' && (state.activity === 'working' || state.attention !== null)) count += 1
  }
  return count
}

/** Next "the fleet is busy" state: on at ENTER or more, off at EXIT or fewer, otherwise unchanged. */
export function nextFleetBusy(previous: boolean, animated: number): boolean {
  if (animated >= EFFECTS_FLEET_ENTER) return true
  if (animated <= EFFECTS_FLEET_EXIT) return false
  return previous
}
