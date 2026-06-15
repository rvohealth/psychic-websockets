/**
 * A whole-unit duration object, mirroring `psychic-workers`' `DelayedJobDuration`
 * so that configuring a websockets TTL looks the same as configuring a job delay.
 * Folded to seconds via {@link durationToSeconds}.
 */
export interface WebsocketConnectionDuration {
  seconds?: number
  minutes?: number
  hours?: number
  days?: number
}
