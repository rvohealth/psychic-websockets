import { WebsocketConnectionDuration } from '../types/duration.js'

/**
 * Folds a whole-unit {@link WebsocketConnectionDuration} down to a number of
 * seconds. Mirrors the equivalent helper in `psychic-workers`.
 */
export default function durationToSeconds(duration: WebsocketConnectionDuration): number {
  return (
    (duration.seconds ? duration.seconds : 0) +
    (duration.minutes ? duration.minutes * 60 : 0) +
    (duration.hours ? duration.hours * 60 * 60 : 0) +
    (duration.days ? duration.days * 60 * 60 * 24 : 0)
  )
}
